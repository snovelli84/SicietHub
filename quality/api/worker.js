/*
 * SICIET QUALITY – SERVIZIO PER SHAREPOINT
 * ----------------------------------------
 * La pagina non accede a Microsoft 365: manda le richieste a questo servizio,
 * che legge/scrive nella cartella delle schede con le credenziali dell'app
 * "SICIET Quality" registrata in Entra ID (permesso applicazione di Microsoft
 * Graph, limitato al sito SICIET Qualità). Vedi quality/README.md.
 *
 * È un Cloudflare Worker: il file si incolla così com'è nell'editor di Cloudflare.
 *
 * Senza PIN chiunque abbia il link può usare la pagina: per questo le
 * scritture sono ammesse solo dentro <COMMESSA>/<JOB>/<TAG>/ e solo per i
 * file che la pagina crea (vedi controllaScrittura).
 *
 * Impostazioni (variabili d'ambiente):
 *   PIN            (facoltativo) PIN aziendale: se impostato la pagina lo chiede
 *                  una volta per dispositivo (intestazione X-Pin)
 *   TENANT_ID      ID directory (tenant)
 *   CLIENT_ID      ID applicazione (client) di "SICIET Quality"
 *   CLIENT_SECRET  segreto client dell'app
 *   SITE           sito SharePoint, es. srlsiciet.sharepoint.com:/sites/SICIETQualit
 *   FOLDER         cartella delle schede nella raccolta Documenti, es. Qualità/Schede componenti
 *   FOLDER_DATI    (facoltativo) cartella dei dati della pagina (scheda.json di ogni
 *                  scheda e indice.json), fuori dalle cartelle che usano le persone;
 *                  di base "SICIET Quality - dati (non modificare)" nella raccolta Documenti
 *   ORIGIN         (facoltativo) sito autorizzato a chiamare il servizio, es. https://hub.siciet.it
 *   PASSWORD_LETTURA  (facoltativo) password dei tecnici per vedere le schede entrando
 *                  dal QR di un'etichetta
 *   PASSWORD_MODIFICA (facoltativo) password dei tecnici per modificare, sempre dal QR
 *   APP_URL        (facoltativo) indirizzo della pagina, per i link nei riepiloghi;
 *                  di base ORIGIN + "/quality/"
 *
 * Richieste (path = percorso relativo alla cartella delle schede):
 *   GET /ping                      verifica il servizio (e il PIN, se impostato)
 *   GET /list?path=…               contenuto di una cartella
 *   GET /item?path=…               { etag, webUrl } di un file o cartella
 *   GET /json?path=…               { data, etag } di un file JSON
 *   PUT /file?path=…[&rename=1]    carica il corpo della richiesta (If-Match: etag facoltativo)
 *   GET /aggiorna?path=C/J/T       aggiorna i riepiloghi Excel per una scheda
 *   GET /aggiorna?azzera=1         svuota l'indice (prima di ricostruire tutti i riepiloghi)
 *   GET /schede                    elenco sintetico di tutte le schede (ricerca nella pagina)
 *   GET /verifica?livello=lettura|modifica   controlla la password dei tecnici
 *                                  (intestazione X-Password); { protetto: false } se non impostata
 *
 * La pagina legge e scrive <C>/<J>/<T>/scheda.json, ma il file sta in
 * FOLDER_DATI/<C>/<J>/<T>/scheda.json (lo stesso per indice.json): così nelle
 * cartelle dei componenti restano solo i file utili alle persone. Le schede
 * create prima, con scheda.json nella cartella del TAG, vengono spostate la
 * prima volta che si leggono.
 *
 * Riepiloghi Excel, aggiornati a ogni salvataggio di scheda, foto o documento:
 *   Riepilogo componenti.xlsx                 tutte le schede (cartella principale)
 *   <C>/Riepilogo commessa <C>.xlsx           le schede della commessa
 *   <C>/<J>/Riepilogo JOB <J>.xlsx            le schede del JOB
 * I dati vengono da indice.json nella cartella principale (una riga per scheda),
 * così non serve rileggere tutte le schede ogni volta.
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
    "Access-Control-Allow-Headers": "X-Pin, X-Password, Content-Type, If-Match",
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
// Estensioni mai ammesse tra i documenti.
const VIETATE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|mjs|jse|wsf|wsh|msi|msp|scr|pif|cpl|jar|hta|html?|xhtml|svg|lnk|reg|dll|sh|apk|app|dmg|iso)$/i;
const MB = 1024 * 1024;

// Cosa si può scrivere, e come: la struttura è <COMMESSA>/<JOB>/<TAG>/…
//   scheda.json, Scheda.txt, Etichetta QR.png   nella cartella del TAG
//   Foto/<file immagine>                        mai sovrascritte
//   Documenti/<file>                            mai sovrascritti, niente eseguibili
function controllaScrittura(parti, tipo, dimensione){
  const nome = parti[parti.length - 1];
  if(parti.length === 4){
    if(nome === "scheda.json"){ if(dimensione > MB) throw new Errore(413, "Scheda troppo grande."); return { rename: false, json: true }; }
    if(nome === "Scheda.txt"){ if(dimensione > MB) throw new Errore(413, "Scheda troppo grande."); return { rename: false }; }
    if(nome === "Etichetta QR.png"){
      // Si sostituisce (le etichette si possono rigenerare), ma solo con un PNG.
      if(tipo !== "image/png") throw new Errore(415, "L'etichetta deve essere un'immagine PNG.");
      if(dimensione > 2 * MB) throw new Errore(413, "Etichetta troppo grande.");
      return { rename: false };
    }
  }
  if(parti.length === 5 && parti[3] === "Foto"){
    if(!/^image\//.test(tipo || "") || !/\.(jpe?g|png|heic|webp)$/i.test(nome)) throw new Errore(415, "Nella cartella Foto si possono caricare solo immagini.");
    if(dimensione > 25 * MB) throw new Errore(413, "Foto troppo grande (massimo 25 MB).");
    return { rename: true };
  }
  if(parti.length === 5 && parti[3] === "Documenti"){
    if(VIETATE.test(nome)) throw new Errore(415, "Tipo di file non ammesso.");
    if(dimensione > 50 * MB) throw new Errore(413, "File troppo grande (massimo 50 MB).");
    return { rename: true };
  }
  throw new Errore(403, "Scrittura non ammessa in questo percorso.");
}

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
// File dei dati della pagina, conservati in FOLDER_DATI.
function inDati(parti){
  return (parti.length === 4 && parti[3] === "scheda.json") || (parti.length === 1 && parti[0] === "indice.json");
}
async function urlItem(env, parti, suffisso){
  const r = await radice(env);
  if(inDati(parti)){
    const tutto = (env.FOLDER_DATI || "SICIET Quality - dati (non modificare)").split("/").concat(parti);
    return "/drives/" + r.drive + "/root:/" + tutto.map(encodeURIComponent).join("/") + ":" + (suffisso || "");
  }
  return urlVecchio(env, parti, suffisso);
}
// Indirizzo relativo alla cartella delle schede (dove stavano anche i dati).
async function urlVecchio(env, parti, suffisso){
  const r = await radice(env);
  const p = parti.length ? ":/" + parti.map(encodeURIComponent).join("/") + ":" : "";
  return "/drives/" + r.drive + "/items/" + r.id + p + (suffisso || "");
}
// Sposta un file dei dati dalla vecchia posizione a FOLDER_DATI; null se non c'è.
async function spostaInDati(env, parti){
  const vecchio = await graphJson(env, "GET", await urlVecchio(env, parti));
  if(!vecchio) return null;
  const res = await fetch(vecchio["@microsoft.graph.downloadUrl"]);
  if(!res.ok) throw new Errore(502, "Lettura da SharePoint non riuscita.");
  await graphJson(env, "PUT", await urlItem(env, parti, "/content"), await res.arrayBuffer(), { "Content-Type": "application/json" });
  await graph(env, "DELETE", await urlVecchio(env, parti));
  return graphJson(env, "GET", await urlItem(env, parti));
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
    return { name: it.name, etag: it.eTag, webUrl: it.webUrl };
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
  return it ? { name: it.name, etag: it.eTag, webUrl: it.webUrl } : {};
}

/* ---------- File Excel (.xlsx) ----------
 * Un .xlsx è un archivio zip di file XML: lo si scrive a mano, senza
 * librerie (il worker deve restare un file unico da incollare).
 */

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b){
  let c = 0xFFFFFFFF;
  for(let i = 0; i < b.length; i++) c = CRC_TAB[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// Archivio zip senza compressione: [{ nome, testo }] → Uint8Array.
function zip(files){
  const enc = new TextEncoder(), parti = [], centrale = [];
  let off = 0;
  for(const f of files){
    const nome = enc.encode(f.nome), dati = enc.encode(f.testo), crc = crc32(dati);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint16(8, 0, true); loc.setUint16(10, 0, true); loc.setUint16(12, 0x21, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, dati.length, true); loc.setUint32(22, dati.length, true);
    loc.setUint16(26, nome.length, true); loc.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, 0, true); cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, dati.length, true); cen.setUint32(24, dati.length, true);
    cen.setUint16(28, nome.length, true); cen.setUint32(42, off, true);
    parti.push(new Uint8Array(loc.buffer), nome, dati);
    centrale.push(new Uint8Array(cen.buffer), nome);
    off += 30 + nome.length + dati.length;
  }
  const dimC = centrale.reduce((a, b) => a + b.length, 0);
  const fine = new DataView(new ArrayBuffer(22));
  fine.setUint32(0, 0x06054b50, true); fine.setUint16(8, files.length, true); fine.setUint16(10, files.length, true);
  fine.setUint32(12, dimC, true); fine.setUint32(16, off, true);
  const tutto = parti.concat(centrale, [new Uint8Array(fine.buffer)]);
  const out = new Uint8Array(tutto.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for(const x of tutto){ out.set(x, p); p += x.length; }
  return out;
}

const XML_SPECIALI = /[&<>"\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
function xml(s){
  s = String(s);
  if(!XML_SPECIALI.test(s)) return s;
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function colonna(i){ let s = ""; i++; while(i){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }

// Data ISO → numero di serie Excel, nell'ora italiana (ora legale europea:
// dall'ultima domenica di marzo all'ultima di ottobre, alle 01:00 UTC).
// Calcolata a mano perché Intl è lento e il piano gratuito dà pochi ms.
function ultimaDomenica(anno, mese){ const d = new Date(Date.UTC(anno, mese + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); }
function serieExcel(iso){
  const t = Date.parse(iso);
  if(isNaN(t)) return null;
  const anno = new Date(t).getUTCFullYear();
  const legale = t >= ultimaDomenica(anno, 2) && t < ultimaDomenica(anno, 9);
  return (t + (legale ? 2 : 1) * 3600000) / 86400000 + 25569;
}

/*
 * Riga del foglio come XML, senza indirizzi di cella (le celle vuote sono
 * <c/>): così la si può conservare nell'indice e riusare in qualsiasi
 * posizione e in qualsiasi file. colonne: [{ titolo, larghezza, tipo:
 * "testo"|"numero"|"data"|"link" }]; valori: per "link" { testo, url }.
 * Restituisce { x: xml, l: [[colonna, url], …] }.
 */
function rigaXml(colonne, valori){
  const out = ["<row>"], link = [];
  for(let i = 0; i < colonne.length; i++){
    const v = valori[i], tipo = colonne[i].tipo;
    if(v === null || v === undefined || v === "" || (tipo === "link" && !v.url)){ out.push("<c/>"); continue; }
    if(tipo === "numero") out.push("<c><v>", +v || 0, "</v></c>");
    else if(tipo === "data"){ const x = serieExcel(v); out.push(x === null ? "<c/>" : '<c s="2"><v>' + x + "</v></c>"); }
    else if(tipo === "link"){ link.push([i, v.url]); out.push('<c t="inlineStr" s="3"><is><t>', xml(v.testo), "</t></is></c>"); }
    else out.push('<c t="inlineStr" s="4"><is><t xml:space="preserve">', xml(v), "</t></is></c>");
  }
  out.push("</row>");
  return { x: out.join(""), l: link };
}

// File .xlsx con un foglio: intestazione + righe preparate con rigaXml.
function xlsx(nomeFoglio, colonne, righe){
  const ultima = colonna(colonne.length - 1), fine = Math.max(1, righe.length + 1);
  const rels = [];
  righe.forEach((r, k) => { for(const [i, url] of r.l) rels.push({ ref: colonna(i) + (k + 2), url }); });
  const dati = "<row>" + colonne.map(c => '<c t="inlineStr" s="1"><is><t>' + xml(c.titolo) + "</t></is></c>").join("") + "</row>" +
    righe.map(r => r.x).join("");
  const area = "A1:" + ultima + fine;
  const foglio = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="' + area + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    "<cols>" + colonne.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.larghezza || 14) + '" customWidth="1"/>').join("") + "</cols>" +
    "<sheetData>" + dati + "</sheetData>" +
    '<autoFilter ref="' + area + '"/>' +
    (rels.length ? "<hyperlinks>" + rels.map((h, i) => '<hyperlink ref="' + h.ref + '" r:id="rId' + (i + 1) + '"/>').join("") + "</hyperlinks>" : "") +
    '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    "</worksheet>";
  const nf = xml(nomeFoglio.slice(0, 31));
  const files = [
    { nome: "[Content_Types].xml", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nome: "_rels/.rels", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nome: "xl/workbook.xml", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + nf + '" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + nf.replace(/'/g, "''") + "\'!$A$1:$" + ultima + "$" + fine + "</definedName></definedNames></workbook>" },
    { nome: "xl/_rels/workbook.xml.rels", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nome: "xl/worksheets/sheet1.xml", testo: foglio },
    { nome: "xl/styles.xml", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF005BAA"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF005BAA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
  ];
  if(rels.length) files.push({ nome: "xl/worksheets/_rels/sheet1.xml.rels", testo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.map((h, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xml(h.url) + '" TargetMode="External"/>').join("") + "</Relationships>" });
  return zip(files);
}

/* ---------- Riepiloghi ---------- */

const INDICE = "indice.json";
const NOMI_CAMPI = { descrizione: "Descrizione componente", fornitore: "Fornitore", posizione: "Posizione / area", ddt: "DDT / ordine" };
const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function leggiJson(env, parti){
  let it = await graphJson(env, "GET", await urlItem(env, parti));
  if(!it && inDati(parti)) it = await spostaInDati(env, parti);
  if(!it) return null;
  const res = await fetch(it["@microsoft.graph.downloadUrl"]);
  if(!res.ok) throw new Errore(502, "Lettura da SharePoint non riuscita.");
  return { data: await res.json(), etag: it.eTag, webUrl: it.webUrl };
}
async function contaFile(env, parti){
  const r = await graphJson(env, "GET", await urlItem(env, parti, "?$select=folder"));
  return r && r.folder ? r.folder.childCount : 0;
}

// Riga dell'indice da una scheda.
function rigaDa(s, vecchia){
  const ultima = s.note && s.note.length ? s.note[s.note.length - 1] : null;
  return Object.assign({}, vecchia, {
    commessa: s.commessa, job: s.job, tag: s.tag,
    tagOriginale: s.tagOriginale || "",
    campi: s.campi || {},
    stato: s.stato || "",
    creataIl: s.creata && s.creata.il, creataDa: s.creata && s.creata.da,
    aggiornataIl: (s.aggiornata && s.aggiornata.il) || (s.creata && s.creata.il),
    aggiornataDa: (s.aggiornata && s.aggiornata.da) || (s.creata && s.creata.da),
    note: (s.note || []).filter(n => n.testo).length,
    // Passaggi di stato (il primo è lo stato alla creazione).
    storicoStati: (s.note || []).filter(n => n.stato).map(n => ({ stato: n.stato, il: n.il })),
    ultimaNota: ultima ? (ultima.testo || (ultima.stato ? "Stato: " + ultima.stato : "")) : ""
  });
}

// Colonne dei riepiloghi: i dati della scheda (campi standard sempre presenti,
// più eventuali altri campi usati), poi stato, conteggi, date e link.
function colonneRiepilogo(righe){
  const campi = Object.keys(NOMI_CAMPI);
  for(const r of righe) for(const k of Object.keys(r.campi || {})) if(!campi.includes(k)) campi.push(k);
  return [
    { titolo: "Commessa SICIET", larghezza: 16 }, { titolo: "JOB", larghezza: 14 }, { titolo: "TAG", larghezza: 16 },
    { titolo: "TAG scritto come", larghezza: 16 }
  ].concat(campi.map(k => ({ campo: k, titolo: NOMI_CAMPI[k] || k.charAt(0).toUpperCase() + k.slice(1), larghezza: 24 })), [
    { titolo: "Stato", larghezza: 14 },
    { titolo: "Variazioni di stato", larghezza: 11, tipo: "numero" },
    { titolo: "Non conformità", larghezza: 15 },
    { titolo: "Ultima non conformità il", larghezza: 17, tipo: "data" },
    { titolo: "Risolta il", larghezza: 17, tipo: "data" },
    { titolo: "Foto", larghezza: 7, tipo: "numero" }, { titolo: "Documenti", larghezza: 11, tipo: "numero" },
    { titolo: "Note", larghezza: 7, tipo: "numero" }, { titolo: "Ultima nota", larghezza: 40 },
    { titolo: "Storico stati", larghezza: 60 },
    { titolo: "Creata il", larghezza: 17, tipo: "data" }, { titolo: "Creata da", larghezza: 18 },
    { titolo: "Ultimo aggiornamento", larghezza: 20, tipo: "data" }, { titolo: "Aggiornata da", larghezza: 18 },
    { titolo: "Scheda", larghezza: 13, tipo: "link" }, { titolo: "Cartella", larghezza: 13, tipo: "link" }
  ]);
}
// Data ISO → "gg/mm/aaaa" (ora italiana), per i testi.
function dataIt(iso){
  const x = serieExcel(iso);
  if(x === null) return "";
  const d = new Date((x - 25569) * 86400000);
  return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
}
// Non conformità dallo storico degli stati: se c'è stata, quando l'ultima, e
// quando è tornata "Conforme" dopo l'ultima.
const NON_CONFORME = "Non conforme", CONFORME = "Conforme";
function nonConformita(storico){
  let ultima = -1;
  storico.forEach((p, i) => { if(p.stato === NON_CONFORME) ultima = i; });
  if(ultima < 0) return { si: "No", il: "", risolta: "" };
  const dopo = storico.slice(ultima + 1).find(p => p.stato === CONFORME);
  return { si: dopo ? "Sì, risolta" : "Sì, aperta", il: storico[ultima].il, risolta: dopo ? dopo.il : "" };
}
function valoriRiga(env, colonne, r){
  const app = env.APP_URL || (env.ORIGIN || "https://hub.siciet.it") + "/quality/";
  const storico = r.storicoStati || [], nc = nonConformita(storico);
  return [r.commessa, r.job, r.tag, r.tagOriginale]
    .concat(colonne.filter(c => c.campo).map(c => (r.campi || {})[c.campo] || ""), [
      r.stato, Math.max(0, storico.length - 1), storico.length ? nc.si : "", nc.il, nc.risolta,
      r.foto || 0, r.documenti || 0, r.note || 0, r.ultimaNota,
      storico.map(p => p.stato + " " + dataIt(p.il)).join(" → "),
      r.creataIl, r.creataDa, r.aggiornataIl, r.aggiornataDa,
      { testo: "Apri scheda", url: app + "?c=" + encodeURIComponent(r.commessa) + "&job=" + encodeURIComponent(r.job) + "&tag=" + encodeURIComponent(r.tag) },
      { testo: "Apri cartella", url: r.cartella }
    ]);
}

// Prepara (o riprende dalla cache dell'indice) l'XML di ogni riga. La cache
// si azzera se cambiano le colonne o l'indirizzo della pagina.
function preparaRighe(env, indice, colonne){
  const firma = colonne.map(c => c.titolo).join("|") + "|" + (env.APP_URL || env.ORIGIN || "");
  if(!indice.cache || indice.cache.firma !== firma) indice.cache = { firma, righe: {} };
  const cache = indice.cache.righe;
  for(const k of Object.keys(cache)) if(!indice.schede[k]) delete cache[k];
  for(const [k, r] of Object.entries(indice.schede)) if(!cache[k]) cache[k] = rigaXml(colonne, valoriRiga(env, colonne, r));
}

/*
 * Aggiorna la riga di una scheda nell'indice (rileggendo scheda.json e
 * contando foto e documenti) e rigenera i tre riepiloghi interessati.
 * Se un file Excel è aperto e bloccato, verrà aggiornato la volta successiva.
 */
async function aggiornaRiepiloghi(env, dir){
  const [c, j] = dir;
  const chiave = dir.join("/");
  const scheda = await leggiJson(env, dir.concat("scheda.json"));
  const cartella = scheda ? await graphJson(env, "GET", await urlItem(env, dir, "?$select=webUrl")) : null;
  const foto = scheda ? await contaFile(env, dir.concat("Foto")) : 0;
  const documenti = scheda ? await contaFile(env, dir.concat("Documenti")) : 0;
  let indice;
  for(let tentativo = 0; ; tentativo++){
    const letto = await leggiJson(env, [INDICE]);
    indice = letto ? letto.data : { versione: 1, schede: {} };
    if(scheda){
      indice.schede[chiave] = Object.assign(rigaDa(scheda.data, indice.schede[chiave]), {
        foto, documenti, cartella: cartella && cartella.webUrl
      });
    }else{
      delete indice.schede[chiave];
    }
    if(indice.cache) delete indice.cache.righe[chiave];
    var colonne = colonneRiepilogo(Object.values(indice.schede));
    preparaRighe(env, indice, colonne);
    const dati = new TextEncoder().encode(JSON.stringify(indice));
    try{
      await carica(env, [INDICE], dati.buffer, "application/json", letto && letto.etag, false);
      break;
    }catch(e){
      if(e.status !== 412 || tentativo >= 3) throw e;
    }
  }
  // Righe nell'ordine di inserimento: una scheda nuova va in fondo, una
  // modificata resta al suo posto (per ordinare, i filtri di Excel).
  const tutte = Object.values(indice.schede);
  const chiaveDi = r => r.commessa + "/" + r.job + "/" + r.tag;
  const file = [
    { parti: ["Riepilogo componenti.xlsx"], righe: tutte, titolo: "Componenti" },
    { parti: [c, "Riepilogo commessa " + c + ".xlsx"], righe: tutte.filter(r => r.commessa === c), titolo: "Commessa " + c },
    { parti: [c, j, "Riepilogo JOB " + j + ".xlsx"], righe: tutte.filter(r => r.commessa === c && r.job === j), titolo: "JOB " + j }
  ];
  for(const f of file){
    if(!f.righe.length) continue;
    try{
      const x = xlsx(f.titolo, colonne, f.righe.map(r => indice.cache.righe[chiaveDi(r)]));
      await carica(env, f.parti, x.buffer, TIPO_XLSX, null, false);
    }catch(e){
      console.warn("Riepilogo non aggiornato:", f.parti.join("/"), e.message);
    }
  }
}

export async function handle(request, env, ctx){
  if(request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  try{
    if(!env.TENANT_ID || !env.CLIENT_ID || !env.CLIENT_SECRET || !env.SITE || !env.FOLDER){
      throw new Errore(500, "Servizio non configurato: mancano TENANT_ID, CLIENT_ID, CLIENT_SECRET, SITE o FOLDER.");
    }
    // Richieste da altri siti web (il browser indica sempre l'Origin).
    const origine = request.headers.get("Origin");
    if(env.ORIGIN && origine && origine !== env.ORIGIN) throw new Errore(403, "Origine non ammessa.");
    if(env.PIN && !pinUguale(request.headers.get("X-Pin"), env.PIN)){
      await new Promise(r => setTimeout(r, 800)); // rallenta i tentativi
      throw new Errore(401, "PIN non corretto.");
    }
    const url = new URL(request.url);
    const azione = url.pathname.split("/").filter(Boolean).pop();
    const parti = percorsoValido(url.searchParams.get("path"));

    if(request.method === "GET" && azione === "ping") return json(env, 200, { ok: true });

    // Password dei tecnici per chi entra dal QR. La pagina libera resta libera:
    // è un filtro per chi inquadra l'etichetta, non una protezione dei dati.
    if(request.method === "GET" && azione === "verifica"){
      const livello = url.searchParams.get("livello") === "modifica" ? "modifica" : "lettura";
      const attesa = livello === "modifica" ? env.PASSWORD_MODIFICA : env.PASSWORD_LETTURA;
      if(!attesa) return json(env, 200, { ok: true, protetto: false });
      if(!pinUguale(request.headers.get("X-Password"), attesa)){
        await new Promise(r => setTimeout(r, 800)); // rallenta i tentativi
        throw new Errore(403, "Password non corretta.");
      }
      return json(env, 200, { ok: true, protetto: true });
    }

    if(request.method === "GET" && azione === "list"){
      const v = await elenco(env, parti);
      return v ? json(env, 200, v) : json(env, 404, { errore: "Non trovato." });
    }

    if(request.method === "GET" && azione === "item"){
      const it = await graphJson(env, "GET", await urlItem(env, parti));
      return it ? json(env, 200, { etag: it.eTag, webUrl: it.webUrl }) : json(env, 404, { errore: "Non trovato." });
    }

    if(request.method === "GET" && azione === "json"){
      const r = await leggiJson(env, parti);
      return r ? json(env, 200, { data: r.data, etag: r.etag }) : json(env, 404, { errore: "Non trovato." });
    }

    if(request.method === "GET" && azione === "schede"){
      const r = await leggiJson(env, [INDICE]);
      const righe = r ? Object.values(r.data.schede) : [];
      return json(env, 200, righe.map(x => ({
        commessa: x.commessa, job: x.job, tag: x.tag, descrizione: (x.campi || {}).descrizione || "",
        stato: x.stato, aggiornataIl: x.aggiornataIl, aggiornataDa: x.aggiornataDa
      })));
    }

    if(request.method === "PUT" && azione === "file"){
      const tipo = request.headers.get("Content-Type");
      const dichiarata = +request.headers.get("Content-Length") || 0;
      controllaScrittura(parti, tipo, dichiarata);
      const dati = await request.arrayBuffer();
      const regola = controllaScrittura(parti, tipo, dati.byteLength);
      if(regola.json){
        let s;
        try{ s = JSON.parse(new TextDecoder().decode(dati)); }catch(e){ throw new Errore(400, "Scheda non valida."); }
        if(!s || s.commessa !== parti[0] || s.job !== parti[1] || s.tag !== parti[2] || !Array.isArray(s.note)) throw new Errore(400, "Scheda non valida.");
      }
      const r = await carica(env, parti, dati, tipo, request.headers.get("If-Match"), regola.rename);
      // Riepiloghi Excel (scheda, foto, documenti): su Cloudflare dopo aver
      // risposto, così l'invio non rallenta.
      if(regola.json || parti.length === 5){
        const lavoro = aggiornaRiepiloghi(env, parti.slice(0, 3)).catch(e => console.warn("Riepiloghi:", e.message));
        if(ctx && ctx.waitUntil) ctx.waitUntil(lavoro); else await lavoro;
      }
      return json(env, 200, r);
    }

    if(request.method === "GET" && azione === "aggiorna"){
      if(url.searchParams.get("azzera") === "1"){
        const letto = await leggiJson(env, [INDICE]);
        await carica(env, [INDICE], new TextEncoder().encode(JSON.stringify({ versione: 1, schede: {} })).buffer, "application/json", letto && letto.etag, false);
        return json(env, 200, { ok: true });
      }
      if(parti.length !== 3) throw new Errore(400, "Indicare commessa/JOB/TAG.");
      await aggiornaRiepiloghi(env, parti);
      return json(env, 200, { ok: true });
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
