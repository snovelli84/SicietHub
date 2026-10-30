/*
 * SICIET QUALITY – SERVIZIO PER SHAREPOINT
 * ----------------------------------------
 * La pagina non accede a Microsoft 365: manda le richieste a questo servizio
 * con il PIN aziendale (intestazione X-Pin). Il servizio controlla il PIN e
 * legge/scrive nella cartella delle schede con le credenziali dell'app
 * "SICIET Quality" registrata in Entra ID (permesso applicazione di Microsoft
 * Graph, limitato al sito SICIET Qualità). Vedi quality/README.md.
 *
 * Funziona su Azure Functions (index.js) e, così com'è, su Cloudflare Workers.
 *
 * Impostazioni (variabili d'ambiente):
 *   PIN            PIN aziendale chiesto dalla pagina
 *   TENANT_ID      ID directory (tenant)
 *   CLIENT_ID      ID applicazione (client) di "SICIET Quality"
 *   CLIENT_SECRET  segreto client dell'app
 *   SITE           sito SharePoint, es. srlsiciet.sharepoint.com:/sites/SICIETQualit
 *   FOLDER         cartella delle schede nella raccolta Documenti, es. Qualità/Schede componenti
 *   ORIGIN         (facoltativo) sito autorizzato a chiamare il servizio, es. https://hub.siciet.it
 *
 * Richieste (path = percorso relativo alla cartella delle schede):
 *   GET /ping                      verifica il PIN
 *   GET /list?path=…               contenuto di una cartella
 *   GET /item?path=…               { etag, webUrl } di un file o cartella
 *   GET /json?path=…               { data, etag } di un file JSON
 *   PUT /file?path=…[&rename=1]    carica il corpo della richiesta (If-Match: etag facoltativo)
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const SIMPLE_UPLOAD_MAX = 4000000; // oltre si usa una sessione di caricamento
const CHUNK = 10 * 327680;         // multiplo di 320 KiB, come richiesto da Graph

let tokenCache = null;
let rootCache = null;

class Errore extends Error {
  constructor(status, msg){ super(msg); this.status = status; }
}

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "X-Pin, Content-Type, If-Match",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(env, status, obj){
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, cors(env))
  });
}

// Confronto a tempo costante, per non far indovinare il PIN un carattere alla volta.
function pinUguale(a, b){
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for(let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0 && b.length > 0;
}

// Percorso relativo alla cartella delle schede: niente "..", niente percorsi assoluti.
function percorsoValido(p){
  p = String(p || "").replace(/^\/+|\/+$/g, "");
  if(p.length > 400) throw new Errore(400, "Percorso troppo lungo.");
  const parti = p ? p.split("/") : [];
  for(const x of parti){
    if(!x || x === "." || x === ".." || /[\\:*?"<>|#%]/.test(x)) throw new Errore(400, "Percorso non valido.");
  }
  return parti;
}

async function token(env){
  if(tokenCache && tokenCache.scade > Date.now() + 60000) return tokenCache.valore;
  const res = await fetch("https://login.microsoftonline.com/" + env.TENANT_ID + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  });
  const j = await res.json().catch(() => ({}));
  if(!res.ok) throw new Errore(500, "Accesso a Microsoft 365 non riuscito: " + (j.error_description || j.error || res.status));
  tokenCache = { valore: j.access_token, scade: Date.now() + j.expires_in * 1000 };
  return tokenCache.valore;
}

// Chiamata a Graph; restituisce la Response (404 compreso).
async function graph(env, method, url, body, headers){
  const h = Object.assign({ Authorization: "Bearer " + await token(env) }, headers || {});
  if(body && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)){
    body = JSON.stringify(body);
    h["Content-Type"] = "application/json";
  }
  const res = await fetch(url.startsWith("https://") ? url : GRAPH + url, { method, headers: h, body });
  if(res.ok || res.status === 404) return res;
  const info = await res.json().catch(() => ({}));
  const msg = (info.error && info.error.message) || res.statusText;
  if(res.status === 412) throw new Errore(412, "La scheda è stata modificata da un altro utente.");
  if(res.status === 401 || res.status === 403) throw new Errore(500, "Il servizio non ha accesso al sito SharePoint (" + msg + ").");
  throw new Errore(502, "SharePoint: " + msg);
}
async function graphJson(env, method, url, body, headers){
  const res = await graph(env, method, url, body, headers);
  return res.status === 404 ? null : res.json();
}

// Cartella delle schede: sito → raccolta Documenti → FOLDER.
async function radice(env){
  if(rootCache) return rootCache;
  const sito = await graphJson(env, "GET", "/sites/" + env.SITE + "?$select=id");
  if(!sito) throw new Errore(500, "Sito SharePoint non trovato: controlla SITE.");
  const enc = env.FOLDER.split("/").map(encodeURIComponent).join("/");
  const it = await graphJson(env, "GET", "/sites/" + sito.id + "/drive/root:/" + enc + "?$select=id,parentReference");
  if(!it) throw new Errore(500, "Cartella delle schede non trovata: controlla FOLDER.");
  rootCache = { drive: it.parentReference.driveId, id: it.id };
  return rootCache;
}
async function urlItem(env, parti, suffisso){
  const r = await radice(env);
  const p = parti.length ? ":/" + parti.map(encodeURIComponent).join("/") + ":" : "";
  return "/drives/" + r.drive + "/items/" + r.id + p + (suffisso || "");
}

async function elenco(env, parti){
  const out = [];
  let next = await urlItem(env, parti, "/children?$expand=thumbnails&$top=500");
  while(next){
    const r = await graphJson(env, "GET", next);
    if(!r) return null;
    for(const it of r.value){
      const th = (it.thumbnails && it.thumbnails[0]) || {};
      out.push({
        name: it.name,
        folder: !!it.folder,
        size: it.size,
        modified: it.lastModifiedDateTime,
        by: it.createdBy && it.createdBy.user && it.createdBy.user.displayName,
        thumb: th.medium && th.medium.url,
        large: th.large && th.large.url,
        url: it["@microsoft.graph.downloadUrl"],
        webUrl: it.webUrl
      });
    }
    next = r["@odata.nextLink"];
  }
  return out;
}

async function carica(env, parti, dati, tipo, etag, rename){
  if(!parti.length) throw new Errore(400, "Manca il nome del file.");
  if(dati.byteLength <= SIMPLE_UPLOAD_MAX){
    const h = { "Content-Type": tipo || "application/octet-stream" };
    if(etag) h["If-Match"] = etag;
    const q = rename ? "?@microsoft.graph.conflictBehavior=rename" : "";
    const it = await graphJson(env, "PUT", await urlItem(env, parti, "/content" + q), dati, h);
    return { name: it.name, etag: it.eTag };
  }
  const s = await graphJson(env, "POST", await urlItem(env, parti, "/createUploadSession"), {
    item: { "@microsoft.graph.conflictBehavior": rename ? "rename" : "replace" }
  });
  let it = null;
  for(let start = 0; start < dati.byteLength; start += CHUNK){
    const end = Math.min(start + CHUNK, dati.byteLength);
    const res = await fetch(s.uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": "bytes " + start + "-" + (end - 1) + "/" + dati.byteLength },
      body: dati.slice(start, end)
    });
    if(!res.ok) throw new Errore(502, "Caricamento su SharePoint non riuscito (" + res.status + ").");
    if(res.status === 200 || res.status === 201) it = await res.json();
  }
  return it ? { name: it.name, etag: it.eTag } : {};
}

export async function handle(request, env){
  if(request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  try{
    if(!env.PIN || !env.TENANT_ID || !env.CLIENT_ID || !env.CLIENT_SECRET || !env.SITE || !env.FOLDER){
      throw new Errore(500, "Servizio non configurato: mancano PIN, TENANT_ID, CLIENT_ID, CLIENT_SECRET, SITE o FOLDER.");
    }
    if(!pinUguale(request.headers.get("X-Pin"), env.PIN)){
      await new Promise(r => setTimeout(r, 800)); // rallenta i tentativi
      throw new Errore(401, "PIN non corretto.");
    }
    const url = new URL(request.url);
    const azione = url.pathname.split("/").filter(Boolean).pop();
    const parti = percorsoValido(url.searchParams.get("path"));

    if(request.method === "GET" && azione === "ping") return json(env, 200, { ok: true });

    if(request.method === "GET" && azione === "list"){
      const v = await elenco(env, parti);
      return v ? json(env, 200, v) : json(env, 404, { errore: "Non trovato." });
    }

    if(request.method === "GET" && (azione === "item" || azione === "json")){
      const it = await graphJson(env, "GET", await urlItem(env, parti));
      if(!it) return json(env, 404, { errore: "Non trovato." });
      if(azione === "item") return json(env, 200, { etag: it.eTag, webUrl: it.webUrl });
      const res = await fetch(it["@microsoft.graph.downloadUrl"]);
      if(!res.ok) throw new Errore(502, "Lettura da SharePoint non riuscita.");
      return json(env, 200, { data: await res.json(), etag: it.eTag });
    }

    if(request.method === "PUT" && azione === "file"){
      const dati = await request.arrayBuffer();
      if(dati.byteLength > 60 * 1024 * 1024) throw new Errore(413, "File troppo grande (massimo 60 MB).");
      const r = await carica(env, parti, dati, request.headers.get("Content-Type"),
        request.headers.get("If-Match"), url.searchParams.get("rename") === "1");
      return json(env, 200, r);
    }

    throw new Errore(404, "Richiesta sconosciuta.");
  }catch(e){
    const status = e instanceof Errore ? e.status : 500;
    if(!(e instanceof Errore)) console.error(e);
    return json(env, status, { errore: e instanceof Errore ? e.message : "Errore interno del servizio." });
  }
}

// Cloudflare Workers
export default { fetch: handle };
