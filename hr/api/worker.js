/*
 * SICIET HR – SERVIZIO DI INVIO EMAIL
 * -----------------------------------
 * La pagina hub.siciet.it/hr prepara le email delle nuove assunzioni (una per
 * ciascun gruppo di destinatari, con i dati e gli allegati di sua competenza)
 * e le manda a questo servizio, che le spedisce da una casella Microsoft 365
 * (MITTENTE) con le credenziali dell'app "SICIET HR" registrata in Entra ID
 * (permessi applicazione Mail.ReadWrite e Mail.Send di Microsoft Graph,
 * limitati alla sola casella MITTENTE). Vedi hr/README.md.
 *
 * È un Cloudflare Worker: il file si incolla così com'è nell'editor di Cloudflare.
 * Il servizio non conserva nulla: dati e documenti passano e finiscono nelle
 * email (una copia resta in "Posta inviata" della casella MITTENTE).
 *
 * Impostazioni (variabili d'ambiente):
 *   PASSWORD       password del Responsabile del Personale (obbligatoria): senza
 *                  password corretta non si invia nulla
 *   TENANT_ID      ID directory (tenant)
 *   CLIENT_ID      ID applicazione (client) di "SICIET HR"
 *   CLIENT_SECRET  segreto client dell'app (serve anche a firmare i passaggi dell'invio)
 *   MITTENTE       casella da cui partono le email, es. hr@siciet.it
 *   DOMINI         (facoltativo) domini a cui si può scrivere, separati da virgola;
 *                  di base "siciet.it"
 *   ESTERNI        (facoltativo) indirizzi esterni ammessi, separati da virgola,
 *                  es. m.fiorentini@cna-gr.it (consulente del lavoro)
 *   ORIGIN         (facoltativo) sito autorizzato a chiamare il servizio, es. https://hub.siciet.it
 *
 * I destinatari si configurano nella pagina (hr/hr.js), ma il servizio accetta
 * solo indirizzi dei DOMINI o elencati in ESTERNI: così, anche conoscendo la
 * password, non si possono mandare dati o documenti a indirizzi qualsiasi.
 *
 * Richieste (tutte con intestazione X-Password):
 *   GET  /ping                     verifica servizio e password
 *   POST /invio                    { compilatore, firmaAzienda, file, messaggi }:
 *                                  crea le bozze, risponde { token, messaggi }
 *   PUT  /allegato?m=<i>&f=<j>     allega il file j alla bozza i (intestazione X-Token);
 *                                  sotto i 3 MB corpo in base64 (X-Encoding: base64),
 *                                  oltre il file così com'è (X-Encoding: raw)
 *   POST /invia                    spedisce le bozze (X-Token)
 *   POST /annulla                  cancella le bozze non spedite (X-Token)
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const MB = 1024 * 1024;
const LIMITE_BASE64 = 3 * MB;   // sotto: allegato in un'unica chiamata; sopra: sessione di caricamento
const CHUNK = 3 * MB;           // pezzi della sessione di caricamento (Graph ammette fino a 4 MB)
const MAX_FILE = 15 * MB;
const MAX_TOTALE = 25 * MB;     // per singola email
const MAX_MESSAGGI = 12;
const MAX_DESTINATARI = 40;
const DURATA_TOKEN = 60 * 60 * 1000;
// Estensioni mai ammesse tra gli allegati.
const VIETATE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|mjs|jse|wsf|wsh|msi|msp|scr|pif|cpl|jar|hta|html?|xhtml|svg|lnk|reg|dll|sh|apk|app|dmg|iso)$/i;

let tokenCache = null;

class Errore extends Error {
  constructor(status, msg){ super(msg); this.status = status; }
}

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "X-Password, X-Token, X-Encoding, Content-Type",
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

// Confronto a tempo costante, per non far indovinare la password un carattere alla volta.
function uguale(a, b){
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for(let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0 && b.length > 0;
}

/* ---------- Token dei passaggi dell'invio (firmato con HMAC) ---------- */

const enc = new TextEncoder();
function b64url(bytes){
  let s = "";
  for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function daB64url(s){
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function chiave(env){
  return crypto.subtle.importKey("raw", enc.encode("siciet-hr|" + env.CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function firma(env, dati){
  const corpo = b64url(enc.encode(JSON.stringify(dati)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await chiave(env), enc.encode(corpo)));
  return corpo + "." + b64url(sig);
}
async function verifica(env, token){
  const [corpo, sig] = String(token || "").split(".");
  if(!corpo || !sig) throw new Errore(400, "Invio non valido: ricomincia.");
  const ok = await crypto.subtle.verify("HMAC", await chiave(env), daB64url(sig), enc.encode(corpo));
  if(!ok) throw new Errore(400, "Invio non valido: ricomincia.");
  const dati = JSON.parse(new TextDecoder().decode(daB64url(corpo)));
  if(dati.exp < Date.now()) throw new Errore(400, "Invio scaduto: ricomincia.");
  return dati;
}

/* ---------- Microsoft Graph ---------- */

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

// Chiamata a Graph sulla casella MITTENTE. body: oggetto (JSON) o stringa JSON già pronta.
async function graph(env, method, percorso, body){
  const url = GRAPH + "/users/" + encodeURIComponent(env.MITTENTE) + percorso;
  for(let tentativo = 0; ; tentativo++){
    const h = { Authorization: "Bearer " + await token(env) };
    let b;
    if(body !== undefined){ h["Content-Type"] = "application/json"; b = typeof body === "string" ? body : JSON.stringify(body); }
    const res = await fetch(url, { method, headers: h, body: b });
    if(res.ok) return res;
    if((res.status === 429 || res.status === 503) && tentativo < 2){
      const attesa = Math.min(Number(res.headers.get("Retry-After")) || 2, 10);
      await new Promise(r => setTimeout(r, attesa * 1000));
      continue;
    }
    const info = await res.json().catch(() => ({}));
    const msg = (info.error && info.error.message) || res.statusText;
    if(res.status === 401 || res.status === 403) throw new Errore(500, "Il servizio non può usare la casella " + env.MITTENTE + " (" + msg + ").");
    throw new Errore(502, "Microsoft 365: " + msg);
  }
}

/* ---------- Controllo dei dati ricevuti ---------- */

function testo(v, max){
  if(v === undefined || v === null) return "";
  if(typeof v !== "string" && typeof v !== "number") throw new Errore(400, "Dati non validi.");
  v = String(v);
  if(v.length > (max || 2000)) throw new Errore(400, "Testo troppo lungo.");
  return v;
}
function elenco(v, max, fn){
  if(v === undefined) return [];
  if(!Array.isArray(v) || v.length > max) throw new Errore(400, "Dati non validi.");
  return v.map(fn);
}
function indirizzoAmmesso(env, email){
  email = String(email || "").trim().toLowerCase();
  if(!/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/.test(email)) return false;
  const esterni = String(env.ESTERNI || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  if(esterni.includes(email)) return true;
  const domini = String(env.DOMINI || "siciet.it").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  return domini.includes(email.split("@")[1]);
}
function persona(env, p){
  const email = testo(p && p.email, 200).trim().toLowerCase();
  if(!indirizzoAmmesso(env, email)) throw new Errore(400, "Destinatario non ammesso: " + email + ". Aggiungilo a ESTERNI nelle impostazioni del servizio.");
  return { nome: testo(p.nome, 200).trim(), email };
}
function nomeFile(n){
  n = testo(n, 200).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  if(!n || VIETATE.test(n)) throw new Errore(415, "Tipo di file non ammesso: " + n);
  return n;
}

function leggiInvio(env, d){
  if(!d || typeof d !== "object") throw new Errore(400, "Dati non validi.");
  const c = d.compilatore || {};
  const compilatore = {
    nome: testo(c.nome, 200).trim(),
    ruolo: testo(c.ruolo, 200).trim(),
    telefono: testo(c.telefono, 100).trim(),
    email: testo(c.email, 200).trim().toLowerCase()
  };
  if(!compilatore.nome) throw new Errore(400, "Manca il nome di chi compila.");
  const firmaAzienda = elenco(d.firmaAzienda, 10, x => testo(x, 300));
  const file = elenco(d.file, 40, f => {
    const dimensione = Number(f && f.dimensione);
    if(!Number.isInteger(dimensione) || dimensione <= 0) throw new Errore(400, "File non valido.");
    if(dimensione > MAX_FILE) throw new Errore(413, "File troppo grande (massimo " + MAX_FILE / MB + " MB): " + f.nome);
    return { nome: nomeFile(f.nome), tipo: testo(f.tipo, 100) || "application/octet-stream", dimensione, categoria: testo(f.categoria, 200) };
  });
  let destinatari = 0;
  const messaggi = elenco(d.messaggi, MAX_MESSAGGI, m => {
    if(!m || typeof m !== "object") throw new Errore(400, "Dati non validi.");
    const to = elenco(m.to, 20, p => persona(env, p));
    const cc = elenco(m.cc, 20, p => persona(env, p));
    if(!to.length) throw new Errore(400, "Email senza destinatari.");
    destinatari += to.length + cc.length;
    const allegati = elenco(m.allegati, 40, j => {
      if(!Number.isInteger(j) || j < 0 || j >= file.length) throw new Errore(400, "Allegato non valido.");
      return j;
    });
    if(new Set(allegati).size !== allegati.length) throw new Errore(400, "Allegato ripetuto.");
    const totale = allegati.reduce((s, j) => s + file[j].dimensione, 0);
    if(totale > MAX_TOTALE) throw new Errore(413, "Allegati troppo grandi per una email (massimo " + MAX_TOTALE / MB + " MB in tutto).");
    return {
      gruppo: testo(m.gruppo, 200),
      to, cc,
      oggetto: testo(m.oggetto, 300).trim() || "Nuova assunzione",
      intro: elenco(m.intro, 20, x => testo(x, 3000)),
      titolo: testo(m.titolo, 300),
      sottotitolo: testo(m.sottotitolo, 500),
      sezioni: elenco(m.sezioni, 20, s => ({
        titolo: testo(s && s.titolo, 200),
        righe: elenco(s && s.righe, 80, r => {
          if(!Array.isArray(r) || r.length !== 2) throw new Errore(400, "Dati non validi.");
          return [testo(r[0], 200), testo(r[1], 3000)];
        })
      })),
      allegati,
      notaAllegati: testo(m.notaAllegati, 1000),
      chiusura: elenco(m.chiusura, 20, x => testo(x, 3000)),
      piede: testo(m.piede, 2000)
    };
  });
  if(!messaggi.length) throw new Errore(400, "Nessuna email da inviare.");
  if(destinatari > MAX_DESTINATARI) throw new Errore(400, "Troppi destinatari.");
  return { compilatore, firmaAzienda, file, messaggi };
}

/* ---------- Testo dell'email ----------
 * La stessa funzione è in hr/hr.js per l'anteprima nella pagina: se si cambia qui,
 * cambiarla anche lì. Tutto il testo ricevuto viene sempre "escapato". */

function emailHtml(m, file, compilatore, firmaAzienda){
  const e = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const br = s => e(s).replace(/\r?\n/g, "<br>");
  const font = "font-family:Segoe UI,Arial,Helvetica,sans-serif;";
  const blu = "#005baa";
  let h = '<div style="' + font + 'font-size:14px;line-height:1.5;color:#1d2430">';
  for(const p of m.intro) h += '<p style="margin:0 0 10px">' + br(p) + "</p>";
  if(m.titolo){
    h += '<div style="margin:16px 0 12px;padding:12px 16px;border-left:4px solid ' + blu + ';background:#eef4fb">' +
      '<div style="font-size:18px;font-weight:bold;color:' + blu + '">' + e(m.titolo) + "</div>" +
      (m.sottotitolo ? '<div style="color:#3a4555">' + br(m.sottotitolo) + "</div>" : "") + "</div>";
  }
  for(const s of m.sezioni){
    if(!s.righe.length) continue;
    h += '<h3 style="' + font + 'font-size:15px;color:' + blu + ';margin:18px 0 6px">' + e(s.titolo) + "</h3>" +
      '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:680px">';
    for(const [l, v] of s.righe){
      h += "<tr>" +
        '<td style="' + font + 'font-size:13px;color:#5d6878;padding:5px 12px 5px 0;border-bottom:1px solid #e3e7ee;vertical-align:top;width:38%">' + e(l) + "</td>" +
        '<td style="' + font + 'font-size:14px;padding:5px 0;border-bottom:1px solid #e3e7ee;vertical-align:top;font-weight:600">' + br(v) + "</td></tr>";
    }
    h += "</table>";
  }
  if(m.allegati.length){
    h += '<h3 style="' + font + 'font-size:15px;color:' + blu + ';margin:18px 0 6px">Allegati (' + m.allegati.length + ")</h3><ul style=\"margin:0 0 0 18px;padding:0\">";
    for(const j of m.allegati) h += "<li>" + e(file[j].nome) + "</li>";
    h += "</ul>";
  }
  if(m.notaAllegati) h += '<p style="margin:14px 0 0;color:#5d6878;font-size:13px">' + br(m.notaAllegati) + "</p>";
  for(const p of m.chiusura) h += '<p style="margin:14px 0 0">' + br(p) + "</p>";
  h += '<p style="margin:22px 0 0">' +
    (compilatore.nome ? "<strong>" + e(compilatore.nome) + "</strong>" : "") +
    (compilatore.ruolo ? "<br>" + e(compilatore.ruolo) : "") +
    (compilatore.telefono ? "<br>" + e(compilatore.telefono) : "") +
    (compilatore.email ? "<br>" + e(compilatore.email) : "") + "</p>";
  if(firmaAzienda.length) h += '<p style="margin:10px 0 0;color:#5d6878;font-size:12px">' + firmaAzienda.map(e).join("<br>") + "</p>";
  if(m.piede) h += '<p style="margin:22px 0 0;padding-top:10px;border-top:1px solid #e3e7ee;color:#8a94a3;font-size:12px">' + br(m.piede) + "</p>";
  return h + "</div>";
}

/* ---------- Passaggi dell'invio ---------- */

async function creaBozze(env, invio){
  const ids = [];
  const replyTo = invio.compilatore.email && indirizzoAmmesso(env, invio.compilatore.email)
    ? [{ emailAddress: { address: invio.compilatore.email, name: invio.compilatore.nome } }] : [];
  const r = p => ({ emailAddress: { address: p.email, name: p.nome || p.email } });
  try{
    for(const m of invio.messaggi){
      const res = await graph(env, "POST", "/messages", {
        subject: m.oggetto,
        body: { contentType: "HTML", content: emailHtml(m, invio.file, invio.compilatore, invio.firmaAzienda) },
        toRecipients: m.to.map(r),
        ccRecipients: m.cc.map(r),
        replyTo
      });
      ids.push((await res.json()).id);
    }
  }catch(err){
    await cancella(env, ids);
    throw err;
  }
  return ids;
}
async function cancella(env, ids){
  for(const id of ids){
    try{ await graph(env, "DELETE", "/messages/" + encodeURIComponent(id)); }catch(_){ /* già spedita o già cancellata */ }
  }
}

async function allega(env, req, dati, i, j){
  const id = dati.ids[i];
  const f = dati.file[j];
  if(!id || !f || !dati.att[i] || !dati.att[i].includes(j)) throw new Errore(400, "Allegato non previsto.");
  const base = "/messages/" + encodeURIComponent(id) + "/attachments";
  const codifica = req.headers.get("X-Encoding");
  if(f.s < LIMITE_BASE64){
    if(codifica !== "base64") throw new Errore(400, "Codifica dell'allegato non valida.");
    const b64 = (await req.text()).trim();
    if(b64.length !== 4 * Math.ceil(f.s / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Errore(400, "Allegato incompleto: riprova.");
    // JSON costruito a mano: il base64 non ha caratteri da "escapare".
    await graph(env, "POST", base,
      '{"@odata.type":"#microsoft.graph.fileAttachment","name":' + JSON.stringify(f.n) +
      ',"contentType":' + JSON.stringify(f.t) + ',"contentBytes":"' + b64 + '"}');
    return;
  }
  if(codifica !== "raw") throw new Errore(400, "Codifica dell'allegato non valida.");
  const dati_ = new Uint8Array(await req.arrayBuffer());
  if(dati_.byteLength !== f.s) throw new Errore(400, "Allegato incompleto: riprova.");
  const sess = await (await graph(env, "POST", base + "/createUploadSession", {
    AttachmentItem: { attachmentType: "file", name: f.n, size: f.s, contentType: f.t }
  })).json();
  for(let da = 0; da < f.s; da += CHUNK){
    const a = Math.min(da + CHUNK, f.s);
    const res = await fetch(sess.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Content-Range": "bytes " + da + "-" + (a - 1) + "/" + f.s },
      body: dati_.subarray(da, a)
    });
    if(!res.ok){
      const info = await res.json().catch(() => ({}));
      throw new Errore(502, "Caricamento allegato non riuscito: " + ((info.error && info.error.message) || res.status));
    }
  }
}

async function invia(env, dati){
  const inviati = [], errori = [];
  for(let i = 0; i < dati.ids.length; i++){
    try{
      await graph(env, "POST", "/messages/" + encodeURIComponent(dati.ids[i]) + "/send");
      inviati.push(i);
    }catch(err){
      errori.push({ i, errore: err.message });
    }
  }
  return { inviati, errori };
}

/* ---------- Richieste ---------- */

async function handle(req, env){
  if(req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  try{
    const url = new URL(req.url);
    const azione = url.pathname.replace(/\/+$/, "").split("/").pop();
    for(const v of ["PASSWORD", "TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "MITTENTE"]){
      if(!env[v]) throw new Errore(503, "Servizio non configurato (manca " + v + ").");
    }
    if(!uguale(req.headers.get("X-Password"), env.PASSWORD)){
      await new Promise(r => setTimeout(r, 1000));
      throw new Errore(401, "Password errata.");
    }

    if(req.method === "GET" && azione === "ping") return json(env, 200, { ok: true, mittente: env.MITTENTE });

    if(req.method === "POST" && azione === "invio"){
      const invio = leggiInvio(env, await req.json().catch(() => null));
      const ids = await creaBozze(env, invio);
      const t = await firma(env, {
        ids,
        file: invio.file.map(f => ({ n: f.nome, t: f.tipo, s: f.dimensione })),
        att: invio.messaggi.map(m => m.allegati),
        exp: Date.now() + DURATA_TOKEN
      });
      return json(env, 200, { token: t, messaggi: invio.messaggi.map((m, i) => ({ i, allegati: m.allegati })) });
    }

    const dati = await verifica(env, req.headers.get("X-Token"));
    if(req.method === "PUT" && azione === "allegato"){
      await allega(env, req, dati, Number(url.searchParams.get("m")), Number(url.searchParams.get("f")));
      return json(env, 200, { ok: true });
    }
    if(req.method === "POST" && azione === "invia") return json(env, 200, await invia(env, dati));
    if(req.method === "POST" && azione === "annulla"){
      await cancella(env, dati.ids);
      return json(env, 200, { ok: true });
    }
    throw new Errore(404, "Richiesta sconosciuta.");
  }catch(err){
    const status = err instanceof Errore ? err.status : 500;
    return json(env, status, { error: err instanceof Errore ? err.message : "Errore del servizio: " + err.message });
  }
}

export default { fetch: handle };
