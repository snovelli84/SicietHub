/*
 * SICIET SHAREDOCS – SERVIZIO PER SHAREPOINT
 * -------------------------------------------
 * La pagina (hub.siciet.it/sharedoc/) fa accedere l'utente con Entra ID e
 * manda a questo servizio il suo token. Il servizio:
 *   1. verifica il token (firma Microsoft, tenant SICIET, destinatario = app
 *      "SICIET ShareDocs") e legge i ruoli app: DocControl, Engineer, Client;
 *   2. legge e scrive su SharePoint con le credenziali dell'app (permesso
 *      applicazione Sites.Selected, limitato al sito SICIET Docs);
 *   3. per i file grandi apre una sessione di caricamento: la pagina invia il
 *      file a blocchi direttamente a SharePoint, senza limite pratico;
 *   4. tiene il registro della commessa in un file JSON nella cartella dei
 *      dati e aggiorna da solo VDRL e CRS in Excel nella cartella della commessa.
 * Il cliente (ospite, ruolo Client) non ha permessi su SharePoint: vede solo
 * i transmittal emessi della sua commessa e i loro file, attraverso il servizio.
 *
 * È un Cloudflare Worker: il file si incolla così com'è nell'editor di Cloudflare.
 *
 * Impostazioni (variabili d'ambiente):
 *   TENANT_ID      ID directory (tenant) SICIET
 *   CLIENT_ID      ID applicazione (client) di "SICIET ShareDocs"
 *   CLIENT_SECRET  segreto client dell'app (tipo Segreto)
 *   SITE           sito SharePoint, es. srlsiciet.sharepoint.com:/sites/SICIETDocs
 *   ORIGIN         sito autorizzato a chiamare il servizio, es. https://hub.siciet.it
 *   FOLDER_DATI    (facoltativo) cartella dei dati nella raccolta Documenti;
 *                  di base "ShareDocs - dati (non modificare)"
 *   APP_URL        (facoltativo) indirizzo della pagina, di base ORIGIN + "/sharedoc/"
 *
 * Struttura su SharePoint (raccolta Documenti del sito):
 *   <cartella commessa>/Transmittals/<n. transmittal>/<file con nome standard>
 *   <cartella commessa>/VDRL <commessa>.xlsx      aggiornato a ogni modifica
 *   <cartella commessa>/CRS <commessa>.xlsx       registro commenti, idem
 *   ShareDocs - dati (non modificare)/commesse.json      elenco delle commesse
 *   ShareDocs - dati (non modificare)/<commessa>/registro.json
 *
 * Richieste (tutte con "Authorization: Bearer <token>", tranne /ping):
 *   GET  /api/ping                        verifica il servizio
 *   GET  /api/ping?sharepoint=1           verifica anche l'accesso al sito SharePoint
 *   GET  /api/me                          utente, ruoli e commesse visibili
 *   GET  /api/registro?c=ID               registro della commessa (filtrato per il cliente)
 *   POST /api/op?c=ID   { op, … }         modifica il registro (vedi OPERAZIONI)
 *   POST /api/upload?c=ID { tr, nome, dimensione }   sessione di caricamento di un file del transmittal
 *   POST /api/upload-risposta?c=ID { tr, k, nome, dimensione }   sessione per un allegato della
 *                                         risposta del cliente (cartella "Client reply" del transmittal)
 *   GET  /api/file?c=ID&item=ID           link temporaneo per scaricare un file
 *   POST /api/excel?c=ID                  rigenera subito VDRL e CRS in Excel (colleghi SICIET)
 *   POST /api/commessa  { id, nome, … }   crea una commessa (Document Controller)
 */

// Aumentare a ogni modifica: la pagina la mostra in fondo, così si vede se su Cloudflare c'è l'ultima.
const VERSIONE_SERVIZIO = 7;
const GRAPH = "https://graph.microsoft.com/v1.0";
const MB = 1024 * 1024;
const MAX_FILE = 2048 * MB;
const DATI = "ShareDocs - dati (non modificare)";
const VIETATE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|mjs|jse|wsf|wsh|msi|msp|scr|pif|cpl|jar|hta|html?|xhtml|svg|lnk|reg|dll|sh|apk|app|dmg|iso)$/i;

const POI = { IFI: "Issued For Information", IFA: "Issued For Approval", IFD: "Issued For Design", IFH: "Issued For HAZOP", IFC: "Issued For Construction", ASB: "Issued as As-Built" };
const RET = {
  "1": { en: "Document Approved", stato: "approved" },
  "2": { en: "Accepted for Information only", stato: "info" },
  "3": { en: "Accepted with Comments (work may proceed)", stato: "comments" },
  "4": { en: "Returned with Comments (work not proceeding)", stato: "resubmit" },
  "C": { en: "Rejected (revise & resubmit, work may not proceed)", stato: "resubmit" },
  "S": { en: "Superseded", stato: "closed" }
};
const STATI = {
  late: "First issue overdue", todo: "Not yet issued", review: "Under client review", overdue: "Client reply overdue",
  replied: "Reply received, code to log", resubmit: "To be resubmitted", comments: "Approved with comments",
  approved: "Approved", info: "Accepted for information", closed: "Closed / not applicable"
};

let tokenCache = null, siteCache = null, chiaviCache = null;

class Errore extends Error {
  constructor(status, msg){ super(msg); this.status = status; }
}

/* ---------- Risposte ---------- */

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
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

/* ---------- Utente: verifica del token Entra ID ---------- */

function b64u(s){
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while(s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function chiavi(env, forza){
  if(!forza && chiaviCache && chiaviCache.t > Date.now() - 6 * 3600000) return chiaviCache.k;
  const r = await fetch("https://login.microsoftonline.com/" + env.TENANT_ID + "/discovery/v2.0/keys");
  if(!r.ok) throw new Errore(503, "Chiavi di Microsoft non disponibili, riprova tra poco.");
  chiaviCache = { t: Date.now(), k: (await r.json()).keys || [] };
  return chiaviCache.k;
}
async function utente(request, env){
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]+)$/);
  if(!m) throw new Errore(401, "Accesso richiesto.");
  const dec = new TextDecoder();
  let testa, p;
  try { testa = JSON.parse(dec.decode(b64u(m[1]))); p = JSON.parse(dec.decode(b64u(m[2]))); }
  catch(e){ throw new Errore(401, "Token non valido."); }
  if(testa.alg !== "RS256") throw new Errore(401, "Token non valido.");
  let k = (await chiavi(env)).find(x => x.kid === testa.kid);
  if(!k) k = (await chiavi(env, true)).find(x => x.kid === testa.kid);
  if(!k) throw new Errore(401, "Token non valido (chiave sconosciuta).");
  const key = await crypto.subtle.importKey("jwk", { kty: k.kty, n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(m[3]), new TextEncoder().encode(m[1] + "." + m[2]));
  if(!ok) throw new Errore(401, "Token non valido (firma).");
  const ora = Date.now() / 1000;
  if(!p.exp || p.exp < ora - 60) throw new Errore(401, "Sessione scaduta: ricarica la pagina.");
  if(p.nbf && p.nbf > ora + 300) throw new Errore(401, "Token non ancora valido.");
  if(p.tid !== env.TENANT_ID) throw new Errore(401, "Token di un'altra organizzazione.");
  const aud = [env.CLIENT_ID, "api://" + env.CLIENT_ID];
  if(!aud.includes(p.aud)) throw new Errore(401, "Token non destinato a SICIET ShareDocs.");
  const iss = ["https://login.microsoftonline.com/" + env.TENANT_ID + "/v2.0", "https://sts.windows.net/" + env.TENANT_ID + "/"];
  if(!iss.includes(p.iss)) throw new Errore(401, "Emittente del token non valido.");
  const ruoli = Array.isArray(p.roles) ? p.roles : [];
  if(!ruoli.length) throw new Errore(403, "Nessun ruolo ShareDocs assegnato a questo utente.");
  const email = String(p.email || p.preferred_username || p.upn || p.unique_name || "").toLowerCase().replace(/^live\.com#/, "");
  return {
    id: p.oid, nome: p.name || email, email, ruoli,
    dc: ruoli.includes("DocControl"),
    siciet: ruoli.includes("DocControl") || ruoli.includes("Engineer"),
    cliente: ruoli.includes("Client") && !ruoli.includes("DocControl") && !ruoli.includes("Engineer")
  };
}
function chi(u){ return { nome: u.nome, email: u.email }; }

/* ---------- Microsoft Graph con le credenziali dell'app ---------- */

async function token(env){
  if(tokenCache && tokenCache.scade > Date.now() + 60000) return tokenCache.valore;
  const res = await fetch("https://login.microsoftonline.com/" + env.TENANT_ID + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
  });
  const j = await res.json().catch(() => ({}));
  if(!res.ok) throw new Errore(500, "Accesso a Microsoft 365 non riuscito: " + (j.error_description || j.error || res.status));
  tokenCache = { valore: j.access_token, scade: Date.now() + j.expires_in * 1000 };
  return tokenCache.valore;
}
async function graph(env, method, url, body, headers){
  const h = Object.assign({ Authorization: "Bearer " + await token(env) }, headers || {});
  if(body && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)){ body = JSON.stringify(body); h["Content-Type"] = "application/json"; }
  const res = await fetch(url.startsWith("https://") ? url : GRAPH + url, { method, headers: h, body });
  if(res.ok || res.status === 404) return res;
  const info = await res.json().catch(() => ({}));
  const msg = (info.error && info.error.message) || res.statusText;
  if(res.status === 412) throw new Errore(412, "Registro modificato nel frattempo.");
  if(res.status === 401 || res.status === 403) throw new Errore(500, "Il servizio non ha accesso al sito SharePoint (" + msg + ").");
  throw new Errore(502, "SharePoint: " + msg);
}
async function graphJson(env, method, url, body, headers){
  const res = await graph(env, method, url, body, headers);
  return res.status === 404 ? null : (res.status === 204 ? {} : res.json());
}
async function drive(env){
  if(siteCache) return siteCache;
  const sito = await graphJson(env, "GET", "/sites/" + env.SITE + "?$select=id");
  if(!sito) throw new Errore(500, "Sito SharePoint non trovato: controlla SITE.");
  const d = await graphJson(env, "GET", "/sites/" + sito.id + "/drive?$select=id");
  siteCache = { site: sito.id, drive: d.id };
  return siteCache;
}
function enc(parti){ return parti.map(encodeURIComponent).join("/"); }
async function urlPercorso(env, parti, suffisso){
  const d = await drive(env);
  return "/drives/" + d.drive + "/root:/" + enc(parti) + ":" + (suffisso || "");
}
function cartellaDati(env){ return (env.FOLDER_DATI || DATI).split("/"); }

async function leggiJson(env, parti){
  const it = await graphJson(env, "GET", await urlPercorso(env, parti));
  if(!it) return null;
  const res = await fetch(it["@microsoft.graph.downloadUrl"], { cf: { cacheTtl: 0 } });
  if(!res.ok) throw new Errore(502, "Lettura da SharePoint non riuscita.");
  return { data: await res.json(), etag: it.eTag };
}
async function scriviFile(env, parti, dati, tipo, etag){
  const h = { "Content-Type": tipo };
  if(etag) h["If-Match"] = etag;
  return graphJson(env, "PUT", await urlPercorso(env, parti, "/content"), dati, h);
}

/* ---------- Controlli dei dati ---------- */

function testo(v, max, obbl, nome){
  v = String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if(obbl && !v) throw new Errore(400, "Manca " + (nome || "un campo obbligatorio") + ".");
  if(v.length > max) throw new Errore(400, (nome || "Un campo") + " troppo lungo (massimo " + max + " caratteri).");
  return v;
}
function codiceDoc(v){ return testo(v, 60, true, "il numero documento").replace(/\s+/g, "").toUpperCase(); }
function data(v){ v = String(v || ""); if(!v) return ""; if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Errore(400, "Data non valida: " + v); return v; }
function rev(v){ v = String(v || "").trim().toUpperCase(); if(!/^[A-Z0-9]{1,3}$/.test(v)) throw new Errore(400, "Revisione non valida: " + v); return v; }
function nomeCartella(v){
  v = testo(v, 120, true, "la cartella");
  if(/[\\/:*?"<>|#%]/.test(v) || v === "." || v === ".." || /\.$/.test(v)) throw new Errore(400, "Nome di cartella non valido: " + v);
  return v;
}
function idCommessa(v){ v = String(v || "").trim(); if(!/^[A-Za-z0-9_-]{1,40}$/.test(v)) throw new Errore(400, "Codice commessa non valido."); return v; }
function nuovoId(){ return crypto.randomUUID().replace(/-/g, "").slice(0, 16); }

// Data di oggi in Italia (ora legale europea calcolata a mano, come in SICIET Quality).
function ultimaDomenica(anno, mese){ const d = new Date(Date.UTC(anno, mese + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); }
function oggi(){
  const t = Date.now(), anno = new Date(t).getUTCFullYear();
  const legale = t >= ultimaDomenica(anno, 2) && t < ultimaDomenica(anno, 9);
  return new Date(t + (legale ? 2 : 1) * 3600000).toISOString().slice(0, 10);
}
function piuGiorni(iso, n){ const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + Number(n || 0)); return d.toISOString().slice(0, 10); }

/* ---------- Commesse e registro ---------- */

async function commesse(env){
  const r = await leggiJson(env, cartellaDati(env).concat("commesse.json"));
  return r ? r : { data: { commesse: [] }, etag: null };
}
function vedeCommessa(u, c){
  if(u.siciet) return true;
  if(!u.cliente) return false;
  const e = u.email, dom = e.slice(e.indexOf("@"));
  return (c.clienti || []).some(x => { x = String(x).toLowerCase().trim(); return x && (x === e || (x.startsWith("@") && x === dom)); });
}
async function commessaPer(env, u, id){
  id = idCommessa(id);
  const c = (await commesse(env)).data.commesse.find(x => x.id === id);
  if(!c || !vedeCommessa(u, c)) throw new Errore(404, "Commessa non trovata.");
  return c;
}
function registroVuoto(c){
  return { v: 1, cfg: { id: c.id, project: c.nome, projectName: c.nome, customer: "", endClient: "", attn: "", prefix: "S" + c.id + "-T", startSeq: 1, dueDays: 14, cartella: c.cartella, clienti: c.clienti || [] }, docs: [], trs: [], cmts: [], log: [] };
}
async function leggiRegistro(env, c){
  const r = await leggiJson(env, cartellaDati(env).concat(c.id, "registro.json"));
  // Documenti senza numero del cliente: il numero provvisorio TBA-nnn li identifica sempre.
  if(r) for(const d of r.data.docs || []) if(/^TBA-\d+$/.test(d.num || "")) d.tba = true;
  return r || { data: registroVuoto(c), etag: null };
}
function trNum(reg, tr){ return (tr.prefix || reg.cfg.prefix) + String(tr.seq).padStart(2, "0"); }
function prossimoSeq(reg){
  const p = reg.cfg.prefix;
  return Math.max(Number(reg.cfg.startSeq || 1) - 1, ...reg.trs.filter(t => (t.prefix || p) === p).map(t => Number(t.seq) || 0)) + 1;
}

// Vista del cliente: solo transmittal emessi, i loro documenti e commenti; niente percorsi SharePoint.
function vistaCliente(reg){
  const trs = reg.trs.filter(t => t.status !== "bozza").map(t => ({
    id: t.id, seq: t.seq, prefix: t.prefix, status: t.status, date: t.date, dueDays: t.dueDays, note: t.note, attn: t.attn, to: t.to, endClient: t.endClient, projectName: t.projectName,
    items: (t.items || []).map(i => ({ docId: i.docId, rev: i.rev, poi: i.poi, ret: i.ret ? { code: i.ret.code, date: i.ret.date } : null, file: i.file ? { id: i.file.id, name: i.file.name, size: i.file.size } : null, clientFiles: (i.clientFiles || []).map(f => ({ id: f.id, name: f.name, size: f.size })) }))
  }));
  const ids = new Set(trs.flatMap(t => t.items.map(i => i.docId)));
  return {
    cliente: true,
    cfg: { id: reg.cfg.id, projectName: reg.cfg.projectName, customer: reg.cfg.customer, endClient: reg.cfg.endClient, prefix: reg.cfg.prefix, dueDays: reg.cfg.dueDays },
    docs: reg.docs.filter(d => ids.has(d.id)).map(d => ({ id: d.id, num: d.num, titleEn: d.titleEn || d.title, cls: d.cls })),
    trs,
    cmts: reg.cmts.filter(x => ids.has(x.docId)).map(x => ({ id: x.id, docId: x.docId, rev: x.rev, trId: x.trId, n: x.n, ref: x.ref, text: x.text, reply: x.status === "chiuso" ? x.reply : "", status: x.status, origin: x.origin }))
  };
}
function vistaPer(u, reg){ const v = u.cliente ? vistaCliente(reg) : Object.assign({}, reg, { log: undefined }); return v; }

/* ---------- Operazioni sul registro ---------- */

function serve(u, ruolo){
  const ok = ruolo === "dc" ? u.dc : ruolo === "siciet" ? u.siciet : ruolo === "cliente" ? u.cliente : false;
  if(!ok) throw new Errore(403, "Operazione non consentita al tuo ruolo.");
}
function trovaTr(reg, id){ const t = reg.trs.find(x => x.id === id); if(!t) throw new Errore(404, "Transmittal non trovato."); return t; }
function trovaDoc(reg, id){ const d = reg.docs.find(x => x.id === id); if(!d) throw new Errore(404, "Documento non trovato."); return d; }
function datiDoc(x, vecchio){
  const d = Object.assign({}, vecchio || {});
  if(!vecchio) d.num = codiceDoc(x.num);
  for(const [k, max] of [["supNum", 60], ["title", 300], ["titleEn", 300], ["disc", 60], ["type", 60], ["note", 2000]]) if(x[k] !== undefined) d[k] = testo(x[k], max);
  if(x.cls !== undefined){ d.cls = String(x.cls || "").toUpperCase(); if(d.cls && !POI[d.cls]) throw new Errore(400, "Classe non valida."); }
  if(x.planned !== undefined) d.planned = data(x.planned);
  if(x.forecast !== undefined) d.forecast = data(x.forecast);
  if(x.closed !== undefined) d.closed = !!x.closed;
  if(x.tba !== undefined) d.tba = !!x.tba;   // numero del cliente non ancora assegnato
  if(x.vid !== undefined) d.vid = Number(x.vid) || null;
  if(!d.titleEn && !d.title) throw new Errore(400, "Manca il titolo del documento.");
  return d;
}
function nuoviCommenti(reg, u, lista, trId, origine){
  const conta = {};
  for(const c of lista || []){
    const doc = trovaDoc(reg, c.docId), r = rev(c.rev), t = testo(c.text, 4000, true, "il testo del commento");
    const k = doc.id + "|" + r;
    conta[k] = (conta[k] ?? reg.cmts.filter(x => x.docId === doc.id && x.rev === r).length) + 1;
    reg.cmts.push({ id: nuovoId(), docId: doc.id, rev: r, trId: trId || "", n: conta[k], ref: testo(c.ref, 200), text: t, reply: "", status: "aperto", origin: origine, by: chi(u), createdAt: new Date().toISOString() });
  }
}
const CARTELLA_RISPOSTA = "Client reply";
const MAX_ALLEGATI = 20;
async function controllaFile(env, reg, tr, f, sotto){
  // Il file deve essere stato caricato nella cartella di questo transmittal (o nella sua sottocartella).
  const d = await drive(env);
  const it = await graphJson(env, "GET", "/drives/" + d.drive + "/items/" + encodeURIComponent(String(f.id || "")) + "?$select=id,name,size,webUrl,parentReference");
  if(!it) throw new Errore(400, "File allegato non trovato su SharePoint.");
  const atteso = "/" + [reg.cfg.cartella, "Transmittals", trNum(reg, tr)].concat(sotto ? [sotto] : []).join("/");
  const path = decodeURIComponent(String((it.parentReference && it.parentReference.path) || "")).replace(/^.*?root:/, "");
  if(path !== atteso) throw new Errore(400, "Il file " + it.name + " non è nella cartella del transmittal.");
  return { id: it.id, name: it.name, size: it.size, webUrl: it.webUrl, path: atteso + "/" + it.name, orig: testo(f.orig, 255), uploadedAt: new Date().toISOString() };
}
// Allegati della risposta (disegni commentati, documenti di riferimento) per un documento del transmittal.
async function aggiungiAllegati(env, u, reg, tr, it, files){
  const lista = (files || []).filter(f => f && f.id).slice(0, MAX_ALLEGATI);
  if(!lista.length) return 0;
  const gia = new Set((it.clientFiles || []).map(f => f.id));
  const nuovi = [];
  for(const f of lista){ if(gia.has(f.id)) continue; nuovi.push(Object.assign(await controllaFile(env, reg, tr, f, CARTELLA_RISPOSTA), { by: chi(u) })); }
  it.clientFiles = (it.clientFiles || []).concat(nuovi).slice(-MAX_ALLEGATI);
  return nuovi.length;
}

const OPERAZIONI = {
  // --- Document Controller ---
  async cfgSave(env, u, reg, x){
    serve(u, "dc");
    const c = reg.cfg;
    for(const [k, max] of [["project", 120], ["projectName", 200], ["customer", 120], ["endClient", 120], ["attn", 120], ["vdrl", 60]]) if(x[k] !== undefined) c[k] = testo(x[k], max);
    if(x.prefix !== undefined){ c.prefix = testo(x.prefix, 20, true, "il prefisso"); if(!/^[A-Za-z0-9-]+$/.test(c.prefix)) throw new Errore(400, "Prefisso non valido."); }
    if(x.startSeq !== undefined) c.startSeq = Math.max(1, Math.min(9999, Number(x.startSeq) || 1));
    if(x.dueDays !== undefined) c.dueDays = Math.max(1, Math.min(90, Number(x.dueDays) || 14));
    if(Array.isArray(x.clienti)) c.clienti = x.clienti.map(v => testo(v, 120).toLowerCase()).filter(Boolean).slice(0, 50);
    return "Impostazioni salvate";
  },
  async docAdd(env, u, reg, x){
    serve(u, "dc");
    const d = datiDoc(x.doc || {});
    if(reg.docs.some(y => y.num === d.num)) throw new Errore(409, d.num + " è già a registro.");
    d.id = nuovoId(); reg.docs.push(d);
    return d.num + " aggiunto";
  },
  async docUpdate(env, u, reg, x){
    serve(u, "dc");
    const i = reg.docs.findIndex(y => y.id === x.id);
    if(i < 0) throw new Errore(404, "Documento non trovato.");
    reg.docs[i] = datiDoc(x.doc || {}, reg.docs[i]);
    return reg.docs[i].num + " aggiornato";
  },
  async docImport(env, u, reg, x){
    serve(u, "dc");
    let n = 0;
    for(const y of (x.docs || []).slice(0, 2000)){
      const d = datiDoc(y);
      if(reg.docs.some(z => z.num === d.num)) continue;
      d.id = nuovoId(); reg.docs.push(d); n++;
    }
    return n + " documenti importati";
  },
  // Migrazione una tantum (es. dal prototipo): solo su registro senza transmittal.
  async registroImport(env, u, reg, x){
    serve(u, "dc");
    if(reg.trs.length || reg.cmts.length) throw new Errore(409, "Il registro contiene già transmittal o commenti: importazione non ammessa.");
    const src = x.registro || {};
    if(!Array.isArray(src.docs) || !Array.isArray(src.trs)) throw new Errore(400, "File di importazione non valido.");
    reg.docs = src.docs.map(d => Object.assign(datiDoc(d), { id: testo(d.id, 40, true, "l'ID") }));
    reg.trs = src.trs.map(t => ({
      id: testo(t.id, 40, true, "l'ID"), seq: Number(t.seq) || 0, prefix: testo(t.prefix, 20, true, "il prefisso"), status: ["bozza", "emesso", "risposto"].includes(t.status) ? t.status : "emesso",
      date: data(t.date), to: testo(t.to, 120), endClient: testo(t.endClient, 120), attn: testo(t.attn, 120), dueDays: Number(t.dueDays) || 14, note: testo(t.note, 2000), projectName: testo(t.projectName, 200),
      items: (t.items || []).map(i => ({ docId: testo(i.docId, 40, true), rev: rev(i.rev), poi: POI[i.poi] ? i.poi : "IFA", ret: i.ret && RET[i.ret.code] ? { code: String(i.ret.code), date: data(i.ret.date), origin: "import" } : null, replied: !!i.replied, file: null })),
      source: testo(t.source, 120)
    }));
    reg.cmts = (src.cmts || []).map(c => ({ id: nuovoId(), docId: c.docId, rev: rev(c.rev), trId: c.trId || "", n: Number(c.n) || 1, ref: testo(c.ref, 200), text: testo(c.text, 4000, true), reply: testo(c.reply, 4000), status: c.status === "chiuso" ? "chiuso" : "aperto", origin: "import" }));
    if(src.cfg) await OPERAZIONI.cfgSave(env, u, reg, src.cfg);
    return "Registro importato: " + reg.docs.length + " documenti, " + reg.trs.length + " transmittal";
  },
  async trSave(env, u, reg, x){
    serve(u, "dc");
    let tr = x.id ? trovaTr(reg, x.id) : null;
    if(tr && tr.status !== "bozza") throw new Errore(409, "Il transmittal è già emesso e non si modifica.");
    if(!tr){ tr = { id: nuovoId(), seq: prossimoSeq(reg), prefix: reg.cfg.prefix, status: "bozza", date: "", createdAt: new Date().toISOString(), by: chi(u), items: [] }; reg.trs.push(tr); }
    tr.to = testo(x.to, 120) || reg.cfg.customer; tr.endClient = testo(x.endClient, 120) || reg.cfg.endClient;
    tr.attn = testo(x.attn, 120); tr.note = testo(x.note, 2000); tr.projectName = reg.cfg.projectName;
    tr.dueDays = Math.max(1, Math.min(90, Number(x.dueDays) || reg.cfg.dueDays));
    const vecchi = new Map(tr.items.map(i => [i.docId, i]));
    const items = [];
    for(const i of (x.items || []).slice(0, 300)){
      const doc = trovaDoc(reg, i.docId);
      if(doc.closed) throw new Errore(400, doc.num + " è chiuso.");
      const it = { docId: doc.id, rev: rev(i.rev), poi: POI[i.poi] ? i.poi : "IFA", ret: null };
      const old = vecchi.get(doc.id);
      if(i.file && i.file.id && (!old || !old.file || old.file.id !== i.file.id)) it.file = await controllaFile(env, reg, tr, i.file);
      else if(i.file && old && old.file) it.file = old.file;
      items.push(it);
    }
    if(!items.length) throw new Errore(400, "Seleziona almeno un documento.");
    tr.items = items;
    if(x.emetti) return OPERAZIONI.trIssue(env, u, reg, { id: tr.id }).then(m => ({ msg: m, id: tr.id }));
    return { msg: "Bozza " + trNum(reg, tr) + " salvata", id: tr.id };
  },
  async trIssue(env, u, reg, x){
    serve(u, "dc");
    const tr = trovaTr(reg, x.id);
    if(tr.status !== "bozza") throw new Errore(409, "Il transmittal è già emesso.");
    const manca = tr.items.filter(i => !i.file).map(i => trovaDoc(reg, i.docId).num);
    if(manca.length) throw new Errore(400, "Allega il file prima di emettere: " + manca.join(", "));
    tr.status = "emesso"; tr.date = oggi(); tr.issuedBy = chi(u); tr.issuedAt = new Date().toISOString();
    return trNum(reg, tr) + " emesso";
  },
  async trDelete(env, u, reg, x){
    serve(u, "dc");
    const tr = trovaTr(reg, x.id);
    if(tr.status !== "bozza") throw new Errore(409, "Si eliminano solo le bozze.");
    reg.trs = reg.trs.filter(t => t !== tr);
    return "Bozza " + trNum(reg, tr) + " eliminata (i file restano su SharePoint)";
  },
  // Risposta del cliente arrivata per altre vie (email, PDF), registrata da SICIET.
  async respond(env, u, reg, x){
    serve(u, "dc");
    const tr = trovaTr(reg, x.trId);
    if(tr.status === "bozza") throw new Errore(409, "Il transmittal non è ancora emesso.");
    for(const r of x.items || []){
      const it = tr.items[Number(r.k)]; if(!it) continue;
      it.ret = r.code ? (RET[r.code] ? { code: String(r.code), date: data(r.date) || oggi(), origin: "siciet", by: chi(u) } : (() => { throw new Errore(400, "Codice di ritorno non valido."); })()) : null;
      await aggiungiAllegati(env, u, reg, tr, it, r.files);
    }
    tr.status = tr.items.every(i => i.ret) ? "risposto" : "emesso";
    nuoviCommenti(reg, u, x.comments, tr.id, "siciet");
    return "Risposta di " + trNum(reg, tr) + " registrata";
  },
  // --- Tecnici e Document Controller ---
  async cmtAdd(env, u, reg, x){
    serve(u, "siciet");
    nuoviCommenti(reg, u, [x], x.trId, "siciet");
    return "Commento registrato";
  },
  async cmtReply(env, u, reg, x){
    serve(u, "siciet");
    const c = reg.cmts.find(y => y.id === x.id); if(!c) throw new Errore(404, "Commento non trovato.");
    c.reply = testo(x.reply, 4000); c.replyBy = chi(u); c.replyAt = new Date().toISOString();
    if(x.close){ if(!c.reply) throw new Errore(400, "Scrivi la risposta prima di chiudere il commento."); c.status = "chiuso"; c.closedAt = oggi(); }
    return x.close ? "Commento chiuso" : "Risposta salvata";
  },
  async cmtReopen(env, u, reg, x){
    serve(u, "siciet");
    const c = reg.cmts.find(y => y.id === x.id); if(!c) throw new Errore(404, "Commento non trovato.");
    c.status = "aperto"; c.closedAt = "";
    return "Commento riaperto";
  },
  // --- Cliente ---
  // Risposta dal portale. La invia il cliente; dalla vista "Client" può inviarla anche il
  // Document Controller (prova o risposta dettata al telefono): resta registrata come sua.
  async clientReply(env, u, reg, x){
    if(!u.cliente && !u.dc) throw new Errore(403, "Operazione non consentita al tuo ruolo.");
    const origine = u.cliente ? "client" : "siciet";
    const tr = trovaTr(reg, x.trId);
    if(tr.status === "bozza") throw new Errore(404, "Transmittal non trovato.");
    let n = 0, allegati = 0;
    for(const r of x.items || []){
      const it = tr.items[Number(r.k)];
      if(!it || it.ret || !r.code) continue;
      if(!RET[r.code]) throw new Errore(400, "Return code not valid.");
      it.ret = { code: String(r.code), date: oggi(), origin: origine, by: chi(u) }; n++;
      allegati += await aggiungiAllegati(env, u, reg, tr, it, r.files);
    }
    const risposti = new Set(tr.items.filter(i => i.ret).map(i => i.docId));
    const commenti = (x.comments || []).filter(c => risposti.has(c.docId));
    if(!n && !commenti.length) throw new Errore(400, "Select at least one return code.");
    tr.status = tr.items.every(i => i.ret) ? "risposto" : "emesso";
    nuoviCommenti(reg, u, commenti, tr.id, origine);
    return { msg: u.cliente ? "Review sent to SICIET" : "Risposta registrata a nome di SICIET (" + u.nome + ")", n, comments: commenti.length, attachments: allegati };
  }
};

async function applica(env, ctx, u, c, op){
  const f = OPERAZIONI[op && op.op];
  if(!f) throw new Errore(400, "Operazione sconosciuta.");
  // Lettura-modifica-scrittura con controllo di versione: se un altro utente
  // ha salvato nel frattempo, si rilegge e si riapplica (fino a 3 volte).
  for(let tentativo = 0; tentativo < 3; tentativo++){
    const { data: reg, etag } = await leggiRegistro(env, c);
    const esito = await f(env, u, reg, op);
    reg.log = (reg.log || []).concat({ t: new Date().toISOString(), op: op.op, by: chi(u), esito: typeof esito === "string" ? esito : esito.msg }).slice(-3000);
    try {
      await scriviFile(env, cartellaDati(env).concat(c.id, "registro.json"), new TextEncoder().encode(JSON.stringify(reg)), "application/json", etag);
    } catch(e){ if(e.status === 412) continue; throw e; }
    ctx.waitUntil(aggiornaExcel(env, reg).catch(e => console.log("Excel: " + e.message)));
    return { esito, registro: vistaPer(u, reg) };
  }
  throw new Errore(409, "Troppe modifiche contemporanee, riprova.");
}

/* ---------- File: caricamento e scaricamento ---------- */

async function caricamento(env, u, c, x){
  serve(u, "dc");
  const { data: reg } = await leggiRegistro(env, c);
  const tr = trovaTr(reg, x.tr);
  if(tr.status !== "bozza") throw new Errore(409, "Il transmittal è già emesso: i file non si cambiano.");
  const nome = testo(x.nome, 150, true, "il nome del file");
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,140}\.[A-Za-z0-9]{1,6}$/.test(nome) || VIETATE.test(nome)) throw new Errore(415, "Nome o tipo di file non ammesso: " + nome);
  const dim = Number(x.dimensione) || 0;
  if(dim <= 0 || dim > MAX_FILE) throw new Errore(413, "Dimensione del file non ammessa.");
  const parti = [reg.cfg.cartella, "Transmittals", trNum(reg, tr), nome];
  const s = await graphJson(env, "POST", await urlPercorso(env, parti, "/createUploadSession"), { item: { "@microsoft.graph.conflictBehavior": "replace" } });
  return { uploadUrl: s.uploadUrl, scade: s.expirationDateTime, percorso: parti.join("/") };
}
// Allegato della risposta: il cliente mentre risponde (documenti ancora senza codice),
// il Document Controller quando registra una risposta arrivata per altre vie.
async function caricamentoRisposta(env, u, c, x){
  if(!u.cliente && !u.dc) throw new Errore(403, "Operazione non consentita al tuo ruolo.");
  const { data: reg } = await leggiRegistro(env, c);
  const tr = trovaTr(reg, x.tr);
  if(tr.status === "bozza") throw new Errore(404, "Transmittal non trovato.");
  const it = tr.items[Number(x.k)];
  if(!it) throw new Errore(400, "Documento non trovato nel transmittal.");
  if(u.cliente && it.ret) throw new Errore(409, "This document has already been reviewed.");
  if((it.clientFiles || []).length >= MAX_ALLEGATI) throw new Errore(409, "Too many attachments for this document.");
  const orig = testo(x.nome, 255, true, "il nome del file");
  const est = (orig.match(/\.([A-Za-z0-9]{1,6})$/) || [])[1];
  if(!est || VIETATE.test(orig)) throw new Errore(415, "File type not allowed: " + orig);
  const base = orig.replace(/\.[A-Za-z0-9]{1,6}$/, "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  const doc = trovaDoc(reg, it.docId);
  const nome = String(doc.num).replace(/[^A-Za-z0-9._-]/g, "-") + "_Rev" + it.rev + "_Client_" + base + "." + est.toLowerCase();
  const dim = Number(x.dimensione) || 0;
  if(dim <= 0 || dim > MAX_FILE) throw new Errore(413, "File size not allowed.");
  const parti = [reg.cfg.cartella, "Transmittals", trNum(reg, tr), CARTELLA_RISPOSTA, nome];
  // Mai sovrascrivere: se il nome esiste già SharePoint aggiunge un numero.
  const s = await graphJson(env, "POST", await urlPercorso(env, parti, "/createUploadSession"), { item: { "@microsoft.graph.conflictBehavior": "rename" } });
  return { uploadUrl: s.uploadUrl, scade: s.expirationDateTime, nome };
}
async function linkFile(env, u, c, itemId){
  const { data: reg } = await leggiRegistro(env, c);
  const trs = u.cliente ? reg.trs.filter(t => t.status !== "bozza") : reg.trs;
  let f = null;
  for(const t of trs) for(const i of t.items || []){
    if(i.file && i.file.id === itemId) f = i.file;
    for(const a of i.clientFiles || []) if(a.id === itemId) f = a;
  }
  if(!f) throw new Errore(404, "File non trovato.");
  const d = await drive(env);
  // Niente $select: con $select SharePoint non restituisce il link temporaneo di download.
  const it = await graphJson(env, "GET", "/drives/" + d.drive + "/items/" + encodeURIComponent(itemId));
  if(!it) throw new Errore(404, "Il file non c'è più su SharePoint.");
  if(!it["@microsoft.graph.downloadUrl"]) throw new Errore(502, "SharePoint non ha fornito il link di download.");
  return { url: it["@microsoft.graph.downloadUrl"], name: f.name, size: it.size, webUrl: u.siciet ? it.webUrl : undefined };
}

/* ---------- VDRL e CRS in Excel (comunicazioni ufficiali: in inglese) ---------- */

function infoDoc(reg, d){
  const issues = [];
  for(const t of reg.trs) if(t.status !== "bozza") for(const i of t.items || []) if(i.docId === d.id) issues.push({ t, i });
  issues.sort((a, b) => (a.t.date || "").localeCompare(b.t.date || "") || a.t.seq - b.t.seq);
  const last = issues[issues.length - 1], o = oggi();
  let k;
  if(d.closed) k = "closed";
  else if(!last) k = d.planned && d.planned < o ? "late" : "todo";
  else if(!last.i.ret) k = last.i.replied ? "replied" : (o > piuGiorni(last.t.date, last.t.dueDays || reg.cfg.dueDays) ? "overdue" : "review");
  else k = (RET[last.i.ret.code] || {}).stato || "review";
  return { k, last, issues };
}
const CRC_TAB = (() => { const t = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b){ let c = 0xFFFFFFFF; for(let i = 0; i < b.length; i++) c = CRC_TAB[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files){
  const en = new TextEncoder(), parti = [], centrale = [];
  let off = 0;
  for(const f of files){
    const nome = en.encode(f.nome), dati = en.encode(f.testo), crc = crc32(dati);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(12, 0x21, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, dati.length, true); loc.setUint32(22, dati.length, true); loc.setUint16(26, nome.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, dati.length, true); cen.setUint32(24, dati.length, true); cen.setUint16(28, nome.length, true); cen.setUint32(42, off, true);
    parti.push(new Uint8Array(loc.buffer), nome, dati); centrale.push(new Uint8Array(cen.buffer), nome);
    off += 30 + nome.length + dati.length;
  }
  const dimC = centrale.reduce((a, b) => a + b.length, 0);
  const fine = new DataView(new ArrayBuffer(22));
  fine.setUint32(0, 0x06054b50, true); fine.setUint16(8, files.length, true); fine.setUint16(10, files.length, true); fine.setUint32(12, dimC, true); fine.setUint32(16, off, true);
  const tutto = parti.concat(centrale, [new Uint8Array(fine.buffer)]);
  const out = new Uint8Array(tutto.reduce((a, b) => a + b.length, 0));
  let p = 0; for(const x of tutto){ out.set(x, p); p += x.length; }
  return out;
}
function xml(s){ return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function colonna(i){ let s = ""; i++; while(i){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
function serieData(iso){ const t = Date.parse(iso + "T00:00:00Z"); return isNaN(t) ? null : t / 86400000 + 25569; }
// colonne: [{ titolo, larghezza, tipo: "testo"|"numero"|"data" }]; righe: array di valori.
function xlsx(nomeFoglio, colonne, righe){
  const ultima = colonna(colonne.length - 1), fine = Math.max(1, righe.length + 1), area = "A1:" + ultima + fine;
  const cella = (v, tipo) => {
    if(v === null || v === undefined || v === "") return "<c/>";
    if(tipo === "numero") return "<c><v>" + (+v || 0) + "</v></c>";
    if(tipo === "data"){ const x = serieData(v); return x === null ? "<c/>" : '<c s="2"><v>' + x + "</v></c>"; }
    return '<c t="inlineStr" s="3"><is><t xml:space="preserve">' + xml(v) + "</t></is></c>";
  };
  const dati = "<row>" + colonne.map(c => '<c t="inlineStr" s="1"><is><t>' + xml(c.titolo) + "</t></is></c>").join("") + "</row>" +
    righe.map(r => "<row>" + colonne.map((c, i) => cella(r[i], c.tipo)).join("") + "</row>").join("");
  const foglio = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="' + area + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
    "<cols>" + colonne.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.larghezza || 14) + '" customWidth="1"/>').join("") + "</cols>" +
    "<sheetData>" + dati + '</sheetData><autoFilter ref="' + area + '"/><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  const nf = xml(nomeFoglio.slice(0, 31));
  return zip([
    { nome: "[Content_Types].xml", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nome: "_rels/.rels", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nome: "xl/workbook.xml", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + nf + '" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + nf.replace(/'/g, "''") + "'!$A$1:$" + ultima + "$" + fine + "</definedName></definedNames></workbook>" },
    { nome: "xl/_rels/workbook.xml.rels", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nome: "xl/worksheets/sheet1.xml", testo: foglio },
    { nome: "xl/styles.xml", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF005BAA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
  ]);
}
const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function aggiornaExcel(env, reg){
  const docs = reg.docs.slice().sort((a, b) => (a.vid ?? 1e9) - (b.vid ?? 1e9) || String(a.num).localeCompare(String(b.num)));
  const vdrl = docs.map(d => {
    const { k, last, issues } = infoDoc(reg, d);
    const aperti = reg.cmts.filter(c => c.docId === d.id && c.status !== "chiuso").length;
    return [d.vid ?? "", d.num, d.supNum || "", d.titleEn || d.title, d.disc || "", d.cls || "", d.planned || "", d.forecast || "",
      last ? last.i.rev : "", STATI[k], last ? trNum(reg, last.t) : "", last ? last.t.date : "", last ? last.i.poi : "",
      last && last.i.ret ? last.i.ret.code : "", last && last.i.ret ? last.i.ret.date : "", last ? (last.i.clientFiles || []).length : "", aperti,
      issues.map(x => x.i.rev + " (" + trNum(reg, x.t) + (x.i.ret ? ", code " + x.i.ret.code : "") + ")").join("; ")];
  });
  const colV = [
    { titolo: "VDRL ID", larghezza: 9, tipo: "numero" }, { titolo: "Document No.", larghezza: 18 }, { titolo: "Supplier Doc. No.", larghezza: 16 },
    { titolo: "Title", larghezza: 60 }, { titolo: "Discipline", larghezza: 18 }, { titolo: "Class", larghezza: 8 },
    { titolo: "Planned submission", larghezza: 14, tipo: "data" }, { titolo: "Forecast", larghezza: 14, tipo: "data" },
    { titolo: "Current rev.", larghezza: 10 }, { titolo: "Status", larghezza: 26 }, { titolo: "Last transmittal", larghezza: 15 },
    { titolo: "Issue date", larghezza: 14, tipo: "data" }, { titolo: "Purpose", larghezza: 9 }, { titolo: "Return code", larghezza: 10 },
    { titolo: "Return date", larghezza: 14, tipo: "data" }, { titolo: "Client attachments", larghezza: 11, tipo: "numero" }, { titolo: "Open comments", larghezza: 10, tipo: "numero" }, { titolo: "Revision history", larghezza: 60 }
  ];
  const byId = new Map(reg.docs.map(d => [d.id, d])), trById = new Map(reg.trs.map(t => [t.id, t]));
  const crs = reg.cmts.slice().sort((a, b) => { const x = byId.get(a.docId) || {}, y = byId.get(b.docId) || {}; return (x.vid ?? 1e9) - (y.vid ?? 1e9) || String(a.rev).localeCompare(String(b.rev)) || a.n - b.n; })
    .map(c => { const d = byId.get(c.docId) || {}, t = trById.get(c.trId); return [d.num || "", d.titleEn || d.title || "", c.rev, c.n, c.ref || "", c.text, c.reply || "", c.status === "chiuso" ? "Closed" : "Open", t ? trNum(reg, t) : "", c.closedAt || ""]; });
  const colC = [
    { titolo: "Document No.", larghezza: 18 }, { titolo: "Title", larghezza: 45 }, { titolo: "Rev.", larghezza: 6 }, { titolo: "Comment No.", larghezza: 9, tipo: "numero" },
    { titolo: "Reference", larghezza: 14 }, { titolo: "Client comment", larghezza: 60 }, { titolo: "SICIET reply", larghezza: 60 }, { titolo: "Status", larghezza: 9 },
    { titolo: "Transmittal", larghezza: 14 }, { titolo: "Closed on", larghezza: 13, tipo: "data" }
  ];
  const c = reg.cfg.cartella;
  await scriviFile(env, [c, "VDRL " + reg.cfg.id + ".xlsx"], xlsx("VDRL", colV, vdrl), TIPO_XLSX);
  await scriviFile(env, [c, "CRS " + reg.cfg.id + ".xlsx"], xlsx("CRS", colC, crs), TIPO_XLSX);
}

/* ---------- Richieste ---------- */

async function corpo(request){
  const t = await request.text();
  if(t.length > 5 * MB) throw new Errore(413, "Richiesta troppo grande.");
  try { return t ? JSON.parse(t) : {}; } catch(e){ throw new Errore(400, "JSON non valido."); }
}

export async function handle(request, env, ctx){
  if(request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  try {
    if(!env.TENANT_ID || !env.CLIENT_ID || !env.CLIENT_SECRET || !env.SITE) throw new Errore(500, "Servizio non configurato: mancano variabili d'ambiente.");
    const origine = request.headers.get("Origin");
    if(env.ORIGIN && origine && origine !== env.ORIGIN) throw new Errore(403, "Origine non ammessa.");
    const url = new URL(request.url), via = url.pathname.replace(/^\/api/, "") || "/";
    const q = k => url.searchParams.get(k);

    if(via === "/ping"){
      // /api/ping?sharepoint=1 verifica anche che il servizio raggiunga il sito con le credenziali dell'app.
      if(!q("sharepoint")) return json(env, 200, { ok: true, servizio: "SICIET ShareDocs", versione: VERSIONE_SERVIZIO });
      try {
        const d = await drive(env);
        const r = await graphJson(env, "GET", "/drives/" + d.drive + "/root?$select=webUrl");
        return json(env, 200, { ok: true, servizio: "SICIET ShareDocs", sharepoint: "ok", documenti: r && r.webUrl });
      } catch(e){ return json(env, 200, { ok: false, servizio: "SICIET ShareDocs", sharepoint: e.message }); }
    }

    const u = await utente(request, env);

    if(via === "/me" && request.method === "GET"){
      const elenco = (await commesse(env)).data.commesse.filter(c => vedeCommessa(u, c)).map(c => ({ id: c.id, nome: c.nome }));
      return json(env, 200, { nome: u.nome, email: u.email, ruoli: u.ruoli, cliente: u.cliente, documentController: u.dc, commesse: elenco, versione: VERSIONE_SERVIZIO });
    }
    if(via === "/registro" && request.method === "GET"){
      const c = await commessaPer(env, u, q("c"));
      return json(env, 200, vistaPer(u, (await leggiRegistro(env, c)).data));
    }
    if(via === "/op" && request.method === "POST"){
      const c = await commessaPer(env, u, q("c"));
      return json(env, 200, await applica(env, ctx, u, c, await corpo(request)));
    }
    if(via === "/upload-risposta" && request.method === "POST"){
      const c = await commessaPer(env, u, q("c"));
      return json(env, 200, await caricamentoRisposta(env, u, c, await corpo(request)));
    }
    if(via === "/upload" && request.method === "POST"){
      const c = await commessaPer(env, u, q("c"));
      return json(env, 200, await caricamento(env, u, c, await corpo(request)));
    }
    if(via === "/excel" && request.method === "POST"){
      serve(u, "siciet");
      const c = await commessaPer(env, u, q("c"));
      const { data: reg } = await leggiRegistro(env, c);
      await aggiornaExcel(env, reg);
      const d = await drive(env);
      const vdrl = await graphJson(env, "GET", await urlPercorso(env, [reg.cfg.cartella, "VDRL " + reg.cfg.id + ".xlsx"], "?$select=webUrl"));
      const dati = await graphJson(env, "GET", await urlPercorso(env, cartellaDati(env).concat(c.id, "registro.json"), "?$select=webUrl"));
      return json(env, 200, { esito: "VDRL e CRS aggiornati", vdrl: vdrl && vdrl.webUrl, registro: dati && dati.webUrl, drive: d.drive ? "ok" : "" });
    }
    if(via === "/file" && request.method === "GET"){
      const c = await commessaPer(env, u, q("c"));
      return json(env, 200, await linkFile(env, u, c, String(q("item") || "")));
    }
    if(via === "/commessa" && request.method === "POST"){
      serve(u, "dc");
      const x = await corpo(request);
      const nuova = { id: idCommessa(x.id), nome: testo(x.nome, 200, true, "il nome della commessa"), cartella: nomeCartella(x.cartella || x.nome), clienti: (x.clienti || []).map(v => testo(v, 120).toLowerCase()).filter(Boolean) };
      for(let i = 0; i < 3; i++){
        const { data, etag } = await commesse(env);
        if(data.commesse.some(c => c.id === nuova.id)) throw new Errore(409, "La commessa " + nuova.id + " esiste già.");
        data.commesse.push(nuova);
        try { await scriviFile(env, cartellaDati(env).concat("commesse.json"), new TextEncoder().encode(JSON.stringify(data)), "application/json", etag); }
        catch(e){ if(e.status === 412){ data.commesse.pop(); continue; } throw e; }
        const reg = registroVuoto(nuova);
        await scriviFile(env, cartellaDati(env).concat(nuova.id, "registro.json"), new TextEncoder().encode(JSON.stringify(reg)), "application/json");
        return json(env, 200, { esito: "Commessa " + nuova.id + " creata", commessa: { id: nuova.id, nome: nuova.nome } });
      }
      throw new Errore(409, "Riprova.");
    }
    throw new Errore(404, "Richiesta sconosciuta.");
  } catch(e){
    const status = e instanceof Errore ? e.status : 500;
    if(!(e instanceof Errore)) console.log(e && e.stack || e);
    return json(env, status, { errore: e instanceof Errore ? e.message : "Errore interno del servizio." });
  }
}

export default { fetch: handle };
