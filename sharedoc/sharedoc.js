/*
 * SICIET SHAREDOCS – transmittal e ciclo di revisione documentale con i clienti
 * -----------------------------------------------------------------------------
 * Pagina pubblicata su https://hub.siciet.it/sharedoc/ (vedi README.md).
 * L'utente accede con l'account Microsoft (colleghi SICIET e ospiti del cliente);
 * la pagina chiede al servizio (api/worker.js, su Cloudflare) i dati della
 * commessa e gli manda le modifiche. Il servizio controlla ruolo e dati e scrive
 * sul sito SharePoint SICIET Docs. I file si caricano a blocchi direttamente su
 * SharePoint, nella cartella del transmittal.
 *
 * A ogni modifica di questo file aumentare VERSIONE e il numero in
 * "sharedoc.js?v=…" in index.html (altrimenti i browser usano la copia vecchia).
 */
var SHAREDOCS_CONFIG = {
  clientId: "9e9b873b-2e7c-4011-aebd-7470627d55ec",          // app "SICIET ShareDocs" in Entra ID
  tenantId: "5c055224-300a-4b03-8742-552b7dd79f62",          // tenant SICIET
  api: "https://siciet-sharedocs.amministrazione-c44.workers.dev/api",   // servizio su Cloudflare
  scope: "api://9e9b873b-2e7c-4011-aebd-7470627d55ec/access_as_user"
};
const VERSIONE = 4;
const LOGO_URL = new URL("icons/siciet-mark.png", location.href).href;

/* ---------- Lingua dell'interfaccia (per utente) ----------
   L'interfaccia segue la scelta IT/EN di chi la usa.
   Le comunicazioni ufficiali (foglio transmittal, file scaricati, export VDRL e CRS) sono sempre in inglese. */
let LANG = "it";
try { const s = localStorage.getItem("sd-lang"); LANG = s === "en" || s === "it" ? s : ((navigator.language || "it").toLowerCase().startsWith("it") ? "it" : "en"); } catch (_) {}
const isClient = () => typeof S!=="undefined" && S.mode==="client";
const effLang = () => isClient() ? "en" : LANG;
const tx = (it, en) => effLang() === "en" ? en : it;
function setLang(l){ LANG = l; try { localStorage.setItem("sd-lang", l); } catch (_) {} document.documentElement.lang = l; render(); if (S.drawer && !FORM_DRAWERS.includes(S.drawer.type) && !S.drawer.respond && !S.drawer.replying) renderDrawer(); }
document.documentElement.lang = LANG;

/* ---------- Codifiche ---------- */
const POI = {
  IFI:{it:"Per informazione",en:"Issued For Information"},
  IFA:{it:"Per approvazione",en:"Issued For Approval"},
  IFD:{it:"Per progettazione",en:"Issued For Design"},
  IFH:{it:"Per HAZOP",en:"Issued For HAZOP"},
  IFC:{it:"Per costruzione",en:"Issued For Construction"},
  ASB:{it:"As-built",en:"Issued as As-Built"}
};
/* Codici di ritorno del cliente (VDRL PEG/BH, foglio Notes) */
const RET = {
  "1":{it:"Approvato",en:"Document Approved",tone:"ok",state:"approved"},
  "2":{it:"Accettato solo per informazione",en:"Accepted for Information only",tone:"info",state:"info"},
  "3":{it:"Accettato con commenti, il lavoro può procedere",en:"Accepted with Comments (work may proceed)",tone:"warn",state:"comments"},
  "4":{it:"Restituito con commenti, lavoro fermo",en:"Returned with Comments (work not proceeding)",tone:"bad",state:"resubmit"},
  "C":{it:"Respinto, rivedere e riemettere",en:"Rejected (revise & resubmit, work may not proceed)",tone:"bad",state:"resubmit"},
  "S":{it:"Superato",en:"Superseded",tone:"muted",state:"closed"}
};
const STATES = {
  late:{it:"Emissione in ritardo",en:"First issue overdue",tone:"bad",color:"var(--bad)"},
  todo:{it:"Da emettere",en:"Not yet issued",tone:"muted",color:"var(--line-strong)"},
  review:{it:"In revisione cliente",en:"Under client review",tone:"pend",color:"var(--pend)"},
  overdue:{it:"Risposta scaduta",en:"Client reply overdue",tone:"warn",color:"var(--warn)"},
  resubmit:{it:"Da riemettere",en:"To be resubmitted",tone:"bad",color:"var(--bad)"},
  comments:{it:"Approvato con commenti",en:"Approved with comments",tone:"warn",color:"var(--warn)"},
  approved:{it:"Approvato",en:"Approved",tone:"ok",color:"var(--ok)"},
  info:{it:"Accettato per informazione",en:"Accepted for information",tone:"info",color:"var(--info)"},
  replied:{it:"Risposta ricevuta, codice da inserire",en:"Reply received, code to log",tone:"pend",color:"var(--accent)"},
  closed:{it:"Chiuso / non applicabile",en:"Closed / not applicable",tone:"muted",color:"var(--line)"}
};
const STATE_ORDER = ["late","overdue","resubmit","replied","review","comments","todo","approved","info","closed"];
const stLabel = k => tx(STATES[k].it, STATES[k].en);
const DEFAULT_CFG = {project:"",projectName:"",customer:"",endClient:"",client:"",attn:"",prefix:"S-T",startSeq:1,dueDays:14,cartella:"",clienti:[]};
/* Intestazione societaria, come nei transmittal SICIET in uso */
const COMPANY = {name:"S.I.C.I.E.T. s.r.l.",addr:"Via Puglia 6, Fraz. Albinia – 58015 Orbetello (GR) – Italy",ids:"VAT IT01164350538 · Tel. +39 0564 870512 · www.siciet.it · info@siciet.it"};
const TABS = [["cruscotto","Cruscotto","Dashboard"],["documenti","Registro documenti","Document register"],["transmittal","Transmittal","Transmittals"],["commenti","Commenti","Comments"]];
const FORM_DRAWERS = ["newTr","newDoc","import","newCmt","settings","newCommessa","pdf"];

/* ---------- Stato ---------- */
const S = {docs:[],trs:[],cmts:[],cfg:{...DEFAULT_CFG},screen:"avvio",errore:"",me:null,commesse:[],c:null,canWrite:false,canComment:false,realClient:false,
  view:"cruscotto",filter:{q:"",state:"",disc:""},cfilter:"aperti",drawer:null,pendingDel:null};
try { S.mode = localStorage.getItem("sd-mode")==="client" ? "client" : "siciet"; } catch(_) { S.mode="siciet"; }
function setMode(m){ if(S.realClient) m="client"; S.mode=m; try{ localStorage.setItem("sd-mode",m); }catch(_){} closeDrawer(); render(); window.scrollTo(0,0); }

/* ---------- Utilità ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayISO = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const addDays = (iso,n) => { const d=new Date(iso+"T12:00:00"); d.setDate(d.getDate()+Number(n||0)); return d.toISOString().slice(0,10); };
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtEn = iso => iso ? `${iso.slice(8,10)}-${MON[Number(iso.slice(5,7))-1]}-${iso.slice(0,4)}` : "—";   // formato del cliente DD-MMM-YYYY
const fmt = iso => !iso ? "—" : effLang()==="en" ? fmtEn(iso) : iso.slice(8,10)+"/"+iso.slice(5,7)+"/"+iso.slice(0,4);
const daysBetween = (a,b) => Math.round((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/864e5);
const chip = k => `<span class="chip t-${STATES[k].tone}">${stLabel(k)}</span>`;
const retCode = c => c ? `<span class="code" style="color:var(--${RET[c].tone})" title="${esc(tx(RET[c].it,RET[c].en))}">${c}</span>` : `<span class="muted">—</span>`;
const demoTag = o => o && o.demo ? `<span class="demo" title="${tx("Dato di esempio","Sample data")}">${tx("esempio","sample")}</span>` : "";
const docById = id => S.docs.find(d=>d.id===id);
const titleUi = d => !d ? "" : effLang()==="en" ? (d.titleEn||d.title||"") : (d.title||d.titleEn||"");
const titleOff = d => !d ? "" : (d.titleEn||d.title||"");
const trNum = tr => (tr.prefix||S.cfg.prefix) + String(tr.seq).padStart(2,"0");
function toast(msg){ const r=document.getElementById("toastRoot"); r.innerHTML=`<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t=setTimeout(()=>r.innerHTML="",2800); }
function fail(e){ console.error(e); toast((e && e.message) || tx("Operazione non riuscita. Riprova tra poco.","Operation failed. Try again in a moment.")); }

/* ---------- Accesso Microsoft (Entra ID) e servizio ---------- */
const MSAL_URL = "https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js";
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");
let pca = null, account = null;
function caricaScript(src){ return new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => ko(new Error(tx("Impossibile caricare l'accesso Microsoft (MSAL). Controlla la connessione.","Could not load Microsoft sign-in (MSAL). Check your connection."))); document.head.appendChild(s); }); }
async function initAuth(){
  await caricaScript(MSAL_URL);
  pca = new msal.PublicClientApplication({
    auth: { clientId: SHAREDOCS_CONFIG.clientId, authority: "https://login.microsoftonline.com/" + SHAREDOCS_CONFIG.tenantId, redirectUri: REDIRECT },
    cache: { cacheLocation: "localStorage" }
  });
  await pca.initialize();
  const r = await pca.handleRedirectPromise();
  account = (r && r.account) || pca.getAllAccounts()[0] || null;
}
function login(){ pca.loginRedirect({ scopes: [SHAREDOCS_CONFIG.scope], prompt: "select_account" }); }
function logout(){ pca.logoutRedirect({ account, postLogoutRedirectUri: REDIRECT }); }
async function token(){
  try { return (await pca.acquireTokenSilent({ scopes: [SHAREDOCS_CONFIG.scope], account })).accessToken; }
  catch(e){ if(e instanceof msal.InteractionRequiredAuthError){ await pca.acquireTokenRedirect({ scopes: [SHAREDOCS_CONFIG.scope], account }); } throw e; }
}
async function api(method, path, body){
  const t = await token();
  let r;
  try { r = await fetch(SHAREDOCS_CONFIG.api + path, { method, headers: Object.assign({ Authorization: "Bearer " + t }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined }); }
  catch(e){ throw new Error(tx("Servizio non raggiungibile: controlla la connessione e riprova.","Service unreachable: check your connection and try again.")); }
  const j = await r.json().catch(() => ({}));
  if(!r.ok){ const e = new Error(j.errore || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return j;
}
const qc = () => "?c=" + encodeURIComponent(S.c);
function setReg(reg){
  S.reg = reg; S.docs = reg.docs || []; S.trs = reg.trs || []; S.cmts = reg.cmts || [];
  S.cfg = Object.assign({}, DEFAULT_CFG, reg.cfg || {});
  render();
  if(S.drawer && !FORM_DRAWERS.includes(S.drawer.type) && !S.drawer.respond && !S.drawer.replying && !S.drawer.edit) renderDrawer();
}
async function caricaRegistro(){ setReg(await api("GET", "/registro" + qc())); }
async function op(body, opts){
  const r = await api("POST", "/op" + qc(), body);
  setReg(r.registro);
  const m = typeof r.esito === "string" ? r.esito : (r.esito && r.esito.msg);
  if(m && !(opts && opts.quiet)) toast(m);
  return r;
}

/* ---------- File su SharePoint ---------- */
const CHUNK = 10 * 327680;   // multiplo di 320 KiB, come richiesto da Microsoft Graph
const fsize = n => !n ? "" : n>1048576 ? (n/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(n/1024))+" KB";
const extOf = name => { const m=String(name||"").match(/\.[A-Za-z0-9]{1,6}$/); return m?m[0].toLowerCase():""; };
const stdName = (docNum, rev, orig) => `${String(docNum).replace(/[^A-Za-z0-9._-]/g,"-")}_Rev${rev}${extOf(orig)}`;
function fileCell(f, opts){
  opts=opts||{};
  if(!f) return `<span class="muted">${tx("nessun file","no file")}</span>`;
  return `<div class="file"><span class="mono fname">${esc(f.name)}</span><span class="muted">${fsize(f.size)}</span>
    <span class="factions"><button type="button" class="link" data-act="viewFile" data-id="${esc(f.id)}">${tx("Visualizza","View")}</button> · <button type="button" class="link" data-act="dlFile" data-id="${esc(f.id)}">${tx("Scarica","Download")}</button></span>
    ${opts.sp&&f.path?`<span class="sp" title="${tx("Percorso su SharePoint","SharePoint path")}">${esc(f.path)}</span>`:""}</div>`;
}
// Caricamento a blocchi direttamente su SharePoint, con la sessione aperta dal servizio.
async function caricaFile(trId, file, nome, avanzamento){
  if(!file.size) throw new Error(tx(`${file.name} è vuoto.`,`${file.name} is empty.`));
  const s = await api("POST", "/upload" + qc(), { tr: trId, nome, dimensione: file.size });
  let ultimo = null;
  for(let start = 0; start < file.size; start += CHUNK){
    const end = Math.min(start + CHUNK, file.size);
    let r;
    try { r = await fetch(s.uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end-1}/${file.size}` }, body: file.slice(start, end) }); }
    catch(e){ throw new Error(tx("Connessione interrotta durante il caricamento di ","Connection lost while uploading ") + nome); }
    if(!r.ok) throw new Error(tx("Caricamento non riuscito (","Upload failed (") + r.status + "): " + nome);
    if(r.status === 200 || r.status === 201) ultimo = await r.json();
    if(avanzamento) avanzamento(end / file.size);
  }
  if(!ultimo || !ultimo.id) throw new Error(tx("SharePoint non ha confermato il file ","SharePoint did not confirm the file ") + nome);
  return ultimo;
}
// Anteprima dentro ShareDocs: il PDF viene scaricato dal link temporaneo e mostrato in un
// pannello con il visualizzatore del browser. Niente schede aperte "in ritardo" (che i browser
// bloccano) e niente accesso a SharePoint: funziona uguale per i colleghi e per il cliente.
// Scarica il contenuto dal link temporaneo e controlla che sia davvero il file (non una pagina d'errore).
async function scaricaContenuto(r){
  if(!r || !r.url) throw new Error(tx("Il servizio non ha fornito il link del file: aggiorna il servizio su Cloudflare.","The service did not provide the file link: update the service on Cloudflare."));
  let res;
  try { res = await fetch(r.url); } catch(e){ throw new Error(tx("Scaricamento del file non riuscito: controlla la connessione.","File download failed: check your connection.")); }
  if(!res.ok) throw new Error(tx("SharePoint ha rifiutato lo scaricamento (","SharePoint refused the download (") + res.status + ").");
  const b = await res.blob();
  if(/\.pdf$/i.test(r.name)){
    const testa = new Uint8Array(await b.slice(0, 5).arrayBuffer());
    if(String.fromCharCode(...testa) !== "%PDF-") throw new Error(tx("Il file ricevuto non è un PDF valido.","The received file is not a valid PDF."));
  }
  return b;
}
async function viewFile(id){
  const back = S.drawer ? (S.drawer.type === "pdf" ? S.drawer.back : Object.assign({}, S.drawer)) : null;
  openDrawer({ type: "pdf", id, name: "", back });
  try {
    const r = await api("GET", "/file" + qc() + "&item=" + encodeURIComponent(id));
    if(!S.drawer || S.drawer.id !== id) return;
    Object.assign(S.drawer, { name: r.name, size: r.size, webUrl: !isClient() && r.webUrl, pdf: /\.pdf$/i.test(r.name) });
    if(!S.drawer.pdf){ renderDrawer(); return; }
    renderDrawer();
    const b = await scaricaContenuto(r);
    if(!S.drawer || S.drawer.id !== id) return;
    if(S.pdfUrl) URL.revokeObjectURL(S.pdfUrl);
    S.pdfUrl = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
    S.drawer.url = S.pdfUrl; renderDrawer();
  } catch(e){ fail(e); if(S.drawer && S.drawer.id === id){ S.drawer.errore = e.message || "errore"; renderDrawer(); } }
}
function pdfPanel(d){
  const head = `${d.url ? `<a class="btn small" href="${d.url}" target="_blank" rel="noopener">${tx("Apri in nuova scheda","Open in new tab")}</a>` : ""}
    ${d.webUrl ? `<a class="btn small" href="${esc(d.webUrl)}" target="_blank" rel="noopener">${tx("Apri su SharePoint","Open on SharePoint")}</a>` : ""}
    <button class="btn small" data-act="dlFile" data-id="${esc(d.id)}">${tx("Scarica","Download")}</button>
    ${d.back ? `<button class="btn small" data-act="pdfBack">${tx("Indietro","Back")}</button>` : ""}`;
  let body;
  if(d.errore) body = `<div class="notice warn">${esc(d.errore)}</div>`;
  else if(d.name && !d.pdf) body = `<div class="notice">${tx("L'anteprima è disponibile solo per i PDF. Usa «Scarica» per aprire il file con il programma adatto.","Preview is available for PDFs only. Use “Download” to open the file with the right program.")}</div>`;
  else if(d.url) body = `<iframe class="pdfview" src="${d.url}" title="${esc(d.name)}"></iframe>`;
  else body = `<div class="empty">${tx("Caricamento del documento…","Loading document…")}${d.size ? " (" + fsize(d.size) + ")" : ""}</div>`;
  return { title: `<span class="mono" style="font-size:15px">${esc(d.name || tx("Documento","Document"))}</span>`, head, body };
}
async function dlFile(id){
  try {
    const r = await api("GET", "/file" + qc() + "&item=" + encodeURIComponent(id));
    toast(tx("Scaricamento di ","Downloading ") + r.name + "…");
    const b = await scaricaContenuto(r);
    salvaBlob(r.name, b);
  } catch(e){ fail(e); }
}
function salvaBlob(nome, blob){
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/* ---------- Logica documenti ---------- */
function issuesOf(docId){
  const out=[];
  for(const tr of S.trs){ if(tr.status==="bozza") continue;
    (tr.items||[]).forEach(it=>{ if(it.docId===docId) out.push({tr,it}); }); }
  return out.sort((a,b)=> (a.tr.date||"").localeCompare(b.tr.date||"") || a.tr.seq-b.tr.seq);
}
function docInfo(d){
  const issues=issuesOf(d.id), last=issues[issues.length-1], t=todayISO();
  let key;
  if(d.closed) key = "closed";
  else if(!last) key = d.planned && d.planned < t ? "late" : "todo";
  else if(!last.it.ret){ const due=addDays(last.tr.date,last.tr.dueDays ?? S.cfg.dueDays); key = last.it.replied ? "replied" : t>due ? "overdue" : "review"; }
  else key = (RET[last.it.ret.code]||{}).state || "review";
  return {key,issues,last,rev:last?last.it.rev:"",next:nextRev(issues)};
}
function nextRev(issues){
  if(!issues.length) return "A";
  const l=issues[issues.length-1], r=String(l.it.rev||"").trim().toUpperCase(), code=l.it.ret && l.it.ret.code;
  if(/^[A-Z]$/.test(r)) return (code=="1"||code=="3") ? "0" : String.fromCharCode(r.charCodeAt(0)+1);
  if(/^\d+$/.test(r)) return String(Number(r)+1);
  return r;
}
function trDue(tr){ return tr.date ? addDays(tr.date, tr.dueDays ?? S.cfg.dueDays) : ""; }
function trState(tr){
  if(tr.status==="bozza") return {label:tx("Bozza","Draft"),tone:"muted"};
  const items=tr.items||[], done=items.filter(i=>i.ret).length;
  if(done===items.length && items.length) return {label:tx("Risposta completa","Fully answered"),tone:"ok"};
  if(todayISO()>trDue(tr)) return {label: done? tx(`Risposta parziale ${done}/${items.length}, scaduta`,`Partial reply ${done}/${items.length}, overdue`) : tx("Risposta scaduta","Reply overdue"),tone:"warn"};
  return {label: done? tx(`Risposta parziale ${done}/${items.length}`,`Partial reply ${done}/${items.length}`) : tx("In attesa del cliente","Awaiting client"),tone:"pend"};
}
const nextSeq = () => Math.max(Number(S.cfg.startSeq||1)-1, ...S.trs.filter(t=>(t.prefix||S.cfg.prefix)===S.cfg.prefix).map(t=>Number(t.seq)||0)) + 1;
/* Ordine del VDRL del cliente (ID#), poi numero */
const docSort = (a,b) => (a.vid??1e9)-(b.vid??1e9) || String(a.num||"").localeCompare(String(b.num||""));
const tbaTag = d => d && d.tba ? `<span class="demo" title="${tx("Il cliente non ha ancora assegnato un numero","The client has not assigned a number yet")}">${tx("n. da assegnare","no. TBA")}</span>` : "";

/* ---------- Render principale ---------- */
function render(){
  const cfg=S.cfg;
  document.getElementById("jobCode").textContent = cfg.project;
  document.getElementById("jobClient").textContent = [cfg.customer, cfg.endClient].filter(Boolean).join(" / ");
  document.querySelectorAll("[data-lang]").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.lang===LANG)));
  document.querySelectorAll("[data-view-mode]").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.viewMode===S.mode)));
  document.getElementById("langBox").hidden = isClient();
  document.documentElement.lang = effLang();
  const infos = S.docs.map(d=>({d,i:docInfo(d)}));
  const alerts = infos.filter(x=>["late","overdue","resubmit"].includes(x.i.key)).length;
  const openC = S.cmts.filter(c=>c.status!=="chiuso").length;
  document.getElementById("tabs").setAttribute("aria-label", tx("Sezioni","Sections"));
  if(isClient()) document.getElementById("tabs").innerHTML = `<a href="#portale" aria-current="page">Transmittals</a>`;
  else document.getElementById("tabs").innerHTML = TABS.map(([k,it,en])=>{
    const n = k==="cruscotto"&&alerts ? alerts : k==="commenti"&&openC ? openC : 0;
    return `<a href="#${k}" ${S.view===k?'aria-current="page"':""}>${tx(it,en)}${n?`<span class="n">${n}</span>`:""}</a>`;}).join("");

  const main=document.getElementById("main");
  const keep={}; main.querySelectorAll("input[id],select[id],textarea[id]").forEach(e=>keep[e.id]=e.type==="checkbox"?e.checked:e.value);
  const act=document.activeElement, actId=act&&main.contains(act)?act.id:null, sel=actId&&act.selectionStart!=null?[act.selectionStart,act.selectionEnd]:null;

  const sc=screenHtml(); if(sc){ main.innerHTML=sc; return; }

  main.innerHTML = isClient() ? viewClient() : ({cruscotto:viewDash,documenti:viewDocs,transmittal:viewTrs,commenti:viewCmts}[S.view]||viewDash)(infos);

  for(const [id,v] of Object.entries(keep)){ const e=document.getElementById(id); if(!e) continue; if(e.type==="checkbox") e.checked=v; else if(v!=="") e.value=v; }
  if(actId){ const e=document.getElementById(actId); if(e){ e.focus(); if(sel&&e.setSelectionRange) try{e.setSelectionRange(sel[0],sel[1])}catch(_){} } }
}

/* ---------- Cruscotto ---------- */
function viewDash(infos){
  if(!S.docs.length) return firstRun();
  const cnt={}; STATE_ORDER.forEach(k=>cnt[k]=0); infos.forEach(x=>cnt[x.i.key]++);
  const openC=S.cmts.filter(c=>c.status!=="chiuso").length, inRev=cnt.review+cnt.overdue;
  const kp=(v,l,cls,go)=>`<button class="kpi ${cls}" data-go="${go}"><span class="v">${v}</span><span class="l">${l}</span></button>`;
  const t=todayISO(), todo=[];
  infos.forEach(({d,i})=>{
    if(i.key==="replied") todo.push({tone:"pend",w:1.5,d,title:tx(`Inserire il codice di ritorno: ${d.num}`,`Log the return code: ${d.num}`),sub:tx(`Il cliente ha risposto a ${trNum(i.last.tr)} ma il codice non è registrato`,`The client replied to ${trNum(i.last.tr)} but the code isn't logged`),tr:i.last.tr.id});
    if(i.key==="overdue"){ const due=addDays(i.last.tr.date,i.last.tr.dueDays??S.cfg.dueDays), late=daysBetween(due,t);
      todo.push({tone:"warn",w:1,d,title:tx(`Sollecitare il cliente: ${d.num}`,`Chase the client: ${d.num}`),sub:tx(`${trNum(i.last.tr)} rev ${i.last.it.rev}, risposta attesa entro il ${fmt(due)} (${late} gg di ritardo)`,`${trNum(i.last.tr)} rev ${i.last.it.rev}, reply due ${fmt(due)} (${late} days late)`),tr:i.last.tr.id}); }
    if(i.key==="resubmit") todo.push({tone:"bad",w:0,d,title:tx(`Riemettere ${d.num} in rev ${i.next}`,`Resubmit ${d.num} as rev ${i.next}`),sub:tx(`Codice 3 su rev ${i.last.it.rev} (${trNum(i.last.tr)})`,`Code 3 on rev ${i.last.it.rev} (${trNum(i.last.tr)})`)});
    if(i.key==="late"){ const n=daysBetween(d.planned,t); todo.push({tone:"bad",w:2,d,title:tx(`Prima emissione in ritardo: ${d.num}`,`First issue overdue: ${d.num}`),sub:tx(`Prevista il ${fmt(d.planned)}, ${n} gg fa`,`Planned for ${fmt(d.planned)}, ${n} days ago`)}); }
    if(i.key==="comments"){ const n=S.cmts.filter(c=>c.docId===d.id&&c.status!=="chiuso").length;
      todo.push({tone:"warn",w:3,d,title:tx(`Recepire i commenti e riemettere ${d.num} in rev ${i.next}`,`Address comments and reissue ${d.num} as rev ${i.next}`),sub:n?tx(`${n} commenti ancora aperti`,`${n} comments still open`):tx("Commenti chiusi, pronto per la riemissione","Comments closed, ready to reissue")}); }
  });
  todo.sort((a,b)=>a.w-b.w);
  S.trs.filter(x=>x.status==="bozza").forEach(tr=>todo.push({tone:"pend",w:4,title:tx(`Bozza da emettere: ${trNum(tr)}`,`Draft to issue: ${trNum(tr)}`),sub:tx(`${(tr.items||[]).length} documenti`,`${(tr.items||[]).length} documents`),tr:tr.id}));
  const tot=S.docs.length;
  return `
  <div class="pagehead"><div><h1>${tx("Cruscotto commessa","Project dashboard")}</h1><p>${tx(`Situazione al ${fmt(t)}. Tempo di risposta concordato con il cliente: ${S.cfg.dueDays} giorni dal transmittal.`,`Status as of ${fmt(t)}. Agreed client reply time: ${S.cfg.dueDays} days from the transmittal.`)}</p></div>
    <div class="actions"><button class="btn primary" data-act="newTr" ${S.canWrite?"":"disabled"}>${tx("Nuovo transmittal","New transmittal")}</button></div></div>
  <div class="kpis">
    ${kp(tot,tx("Documenti a registro","Documents in register"),"","documenti:")}
    ${kp(inRev,tx("In revisione cliente","Under client review"),"","documenti:review")}
    ${kp(cnt.overdue,tx("Risposte scadute","Overdue replies"),cnt.overdue?"warnv":"","documenti:overdue")}
    ${kp(cnt.late+cnt.resubmit,tx("In ritardo o da riemettere","Late or to resubmit"),cnt.late+cnt.resubmit?"alert":"","documenti:late")}
    ${kp(openC,tx("Commenti aperti","Open comments"),openC?"warnv":"","commenti:")}
  </div>
  <div class="grid2">
    <section class="panel"><h2>${tx("Da fare","To do")}</h2><p class="sub">${tx("Azioni del Document Controller, dalla più urgente.","Document Controller actions, most urgent first.")}</p>
      ${todo.length?`<ul class="todo">${todo.map(x=>`<li><span class="stripe" style="color:var(--${x.tone})"></span>
        <div class="what"><b>${esc(x.title)}</b><span>${x.d?esc(titleUi(x.d))+" · ":""}${esc(x.sub)}</span></div>
        ${x.tr?`<button class="btn small" data-tr="${esc(x.tr)}">${tx("Apri","Open")}</button>`:x.d?`<button class="btn small" data-act="newTr" data-doc="${esc(x.d.id)}" ${S.canWrite?"":"disabled"}>${tx("Emetti","Issue")}</button>`:""}</li>`).join("")}</ul>`
      :`<div class="empty">${tx("Nessuna azione in sospeso.","Nothing pending.")}</div>`}
    </section>
    <section class="panel"><h2>${tx("Stato del registro","Register status")}</h2><p class="sub">${tx(`${tot} documenti, per stato dell’ultima emissione.`,`${tot} documents, by status of their latest issue.`)}</p>
      <div class="stack" role="img" aria-label="${tx("Distribuzione documenti per stato","Documents by status")}">${STATE_ORDER.filter(k=>cnt[k]).map(k=>`<i style="width:${cnt[k]/tot*100}%;background:${STATES[k].color}" title="${stLabel(k)}: ${cnt[k]}"></i>`).join("")}</div>
      <ul class="legend">${STATE_ORDER.map(k=>`<li><span class="sw" style="background:${STATES[k].color}"></span>${stLabel(k)}<span class="c">${cnt[k]}</span></li>`).join("")}</ul>
    </section>
  </div>`;
}
function firstRun(){
  return `<div class="pagehead"><div><h1>${tx("Benvenuto in SICIET ShareDocs","Welcome to SICIET ShareDocs")}</h1><p>${tx("Il registro della commessa è vuoto. Inizia caricando l’elenco documenti (VDRL): ogni documento avrà il suo storico di revisioni, transmittal e commenti del cliente.","The project register is empty. Start by loading the document list (VDRL): each document gets its own history of revisions, transmittals and client comments.")}</p></div></div>
  <div class="panel"><div class="empty">${tx("Nessun documento a registro.","No documents in the register.")}<br><br>
  <button class="btn primary" data-act="newDoc" ${S.canWrite?"":"disabled"}>${tx("Aggiungi il primo documento","Add the first document")}</button>
  <button class="btn" data-act="importDocs" ${S.canWrite?"":"disabled"}>${tx("Incolla elenco da Excel","Paste list from Excel")}</button></div></div>`;
}

/* ---------- Registro documenti (VDRL) ---------- */
function viewDocs(infos){
  if(!S.docs.length) return firstRun();
  const f=S.filter, q=f.q.toLowerCase();
  const discs=[...new Set(S.docs.map(d=>d.disc).filter(Boolean))].sort();
  let rows=infos.filter(({d,i})=>(!q||[d.num,d.supNum,d.title,d.titleEn].join(" ").toLowerCase().includes(q))&&(!f.disc||d.disc===f.disc)&&
    (!f.state||(f.state==="review"?["review","overdue"].includes(i.key):f.state==="late"?["late","resubmit"].includes(i.key):i.key===f.state)));
  rows.sort((a,b)=>docSort(a.d,b.d));
  return `
  <div class="pagehead"><div><h1>${tx("Registro documenti","Document register")}</h1><p>${tx("VDRL sempre aggiornato: revisione, stato e storico si calcolano dai transmittal emessi e dalle risposte del cliente.","Always up-to-date VDRL: revision, status and history come from the issued transmittals and the client's replies.")}</p></div>
    <div class="actions">
      <button class="btn" data-act="csv" title="${tx("File ufficiale in inglese","Official file, in English")}">${tx("Esporta VDRL (CSV, EN)","Export VDRL (CSV)")}</button>
      <button class="btn" data-act="importDocs" ${S.canWrite?"":"disabled"}>${tx("Incolla da Excel","Paste from Excel")}</button>
      <button class="btn" data-act="newDoc" ${S.canWrite?"":"disabled"}>${tx("Nuovo documento","New document")}</button>
      <button class="btn primary" data-act="newTr" ${S.canWrite?"":"disabled"}>${tx("Nuovo transmittal","New transmittal")}</button></div></div>
  <div class="toolbar">
    <input type="search" id="fq" placeholder="${tx("Cerca per numero o titolo","Search by number or title")}" aria-label="${tx("Cerca documenti","Search documents")}" value="${esc(f.q)}">
    <select id="fstate" aria-label="${tx("Filtra per stato","Filter by status")}"><option value="">${tx("Tutti gli stati","All statuses")}</option>
      <option value="review" ${f.state==="review"?"selected":""}>${tx("In revisione (incluse scadute)","Under review (incl. overdue)")}</option>
      <option value="late" ${f.state==="late"?"selected":""}>${tx("In ritardo o da riemettere","Late or to resubmit")}</option>
      ${STATE_ORDER.map(k=>`<option value="${k}" ${f.state===k?"selected":""}>${stLabel(k)}</option>`).join("")}</select>
    <select id="fdisc" aria-label="${tx("Filtra per disciplina","Filter by discipline")}"><option value="">${tx("Tutte le discipline","All disciplines")}</option>${discs.map(x=>`<option ${f.disc===x?"selected":""}>${esc(x)}</option>`).join("")}</select>
    <span class="count">${tx(`${rows.length} di ${S.docs.length}`,`${rows.length} of ${S.docs.length}`)}</span></div>
  <div class="tablebox"><table>
    <thead><tr><th>${tx("N. documento","Document no.")}</th><th>${tx("N. SICIET","SICIET no.")}</th><th>${tx("Titolo","Title")}</th><th>${tx("Disc.","Disc.")}</th><th>Rev</th><th>${tx("Stato","Status")}</th><th>${tx("Ultimo transmittal","Last transmittal")}</th><th>${tx("Ritorno","Return")}</th><th>${tx("Storico emissioni","Issue history")}</th></tr></thead>
    <tbody>${rows.length?rows.map(({d,i})=>`<tr class="clickable" data-doc-open="${esc(d.id)}">
      <td class="mono num">${esc(d.num)}${demoTag(d)}${tbaTag(d)}</td><td class="mono num">${esc(d.supNum||"—")}</td><td>${esc(titleUi(d))}${!d.titleEn?`<br><span class="muted" style="font-size:12px">${tx("Manca il titolo in inglese","English title missing")}</span>`:""}</td><td>${esc(d.disc||"")}</td>
      <td class="mono">${esc(i.rev||"—")}</td><td>${chip(i.key)}</td>
      <td class="mono num">${i.last?`${esc(trNum(i.last.tr))}<br><span class="muted">${fmt(i.last.tr.date)} · ${esc(i.last.it.poi)}</span>`:`<span class="muted">${tx("prevista","planned")} ${fmt(d.planned)}</span>`}</td>
      <td>${i.last&&i.last.it.ret?`${retCode(i.last.it.ret.code)} <span class="muted mono">${fmt(i.last.it.ret.date)}</span>`:`<span class="muted">—</span>`}</td>
      <td><div class="hist">${i.issues.map(x=>`<span title="${esc(trNum(x.tr))} · ${fmt(x.tr.date)}">${esc(x.it.rev)}${x.it.ret?"·"+x.it.ret.code:""}</span>`).join("")||`<span class="muted">${tx("nessuna","none")}</span>`}</div></td></tr>`).join("")
      :`<tr><td colspan="9" class="empty">${tx("Nessun documento corrisponde ai filtri.","No documents match the filters.")}</td></tr>`}</tbody></table></div>
  <p class="hint" style="margin-top:10px">${tx("Storico: revisione emessa e, dopo il punto, codice di ritorno del cliente. Clicca una riga per la scheda completa del documento.","History: issued revision and, after the dot, the client's return code. Click a row for the full document record.")}</p>`;
}

/* ---------- Transmittal ---------- */
function viewTrs(){
  const list=[...S.trs].sort((a,b)=>((b.status==="bozza")-(a.status==="bozza"))||String(b.date||"").localeCompare(String(a.date||""))||b.seq-a.seq);   // bozze in cima, poi dal più recente
  return `
  <div class="pagehead"><div><h1>${tx("Transmittal","Transmittals")}</h1><p>${S.excelUrl?`<a href="${esc(S.excelUrl)}" target="_blank" rel="noopener">${tx("Apri VDRL su SharePoint","Open VDRL on SharePoint")}</a> · `:""}${tx(`Registro di tutti i transmittal della commessa, numerati in automatico ${esc(S.cfg.prefix)}nn. Il foglio inviato al cliente è sempre in inglese.`,`Log of all project transmittals, numbered automatically ${esc(S.cfg.prefix)}nn. The sheet sent to the client is always in English.`)}</p></div>
    <div class="actions">${S.canComment?`<button class="btn" data-act="excel" title="${tx("Rigenera subito VDRL e CRS nella cartella SharePoint della commessa","Regenerate VDRL and CRS now in the project's SharePoint folder")}">${tx("Aggiorna Excel","Update Excel")}</button>`:""}<button class="btn" data-act="settings">${tx("Impostazioni commessa","Project settings")}</button><button class="btn primary" data-act="newTr" ${S.canWrite&&S.docs.length?"":"disabled"}>${tx("Nuovo transmittal","New transmittal")}</button></div></div>
  <div class="tablebox"><table>
    <thead><tr><th>${tx("Numero","Number")}</th><th>${tx("Data","Date")}</th><th>${tx("Destinatario","To")}</th><th>${tx("Documenti","Documents")}</th><th>${tx("Scopo","Purpose")}</th><th>${tx("Risposta entro","Reply due")}</th><th>${tx("Stato","Status")}</th></tr></thead>
    <tbody>${list.length?list.map(tr=>{const st=trState(tr), pois=[...new Set((tr.items||[]).map(i=>i.poi))];
      return `<tr class="clickable" data-tr="${esc(tr.id)}"><td class="mono num"><b>${esc(trNum(tr))}</b>${demoTag(tr)}</td><td class="mono num">${tr.status==="bozza"?'<span class="muted">—</span>':fmt(tr.date)}</td>
      <td>${esc(tr.to||S.cfg.client)}</td><td class="mono">${(tr.items||[]).length}</td><td class="mono">${esc(pois.join(", "))}</td>
      <td class="mono num">${tr.status==="bozza"?"—":fmt(trDue(tr))}</td><td><span class="chip t-${st.tone}">${esc(st.label)}</span></td></tr>`}).join("")
    :`<tr><td colspan="7" class="empty">${tx("Nessun transmittal ancora. Crea il primo dal pulsante “Nuovo transmittal”.","No transmittals yet. Create the first one with “New transmittal”.")}</td></tr>`}</tbody></table></div>`;
}

/* ---------- Commenti (CRS) ---------- */
function viewCmts(){
  const f=S.cfilter;
  let list=S.cmts.filter(c=>f==="tutti"||(f==="aperti"?c.status!=="chiuso":c.status==="chiuso"));
  list.sort((a,b)=>{const da=docById(a.docId),dbb=docById(b.docId);return docSort(da||{},dbb||{})||String(a.rev).localeCompare(String(b.rev))||(a.n||0)-(b.n||0)});
  const open=S.cmts.filter(c=>c.status!=="chiuso").length;
  return `
  <div class="pagehead"><div><h1>${tx("Registro commenti","Comment register")}</h1><p>${tx("Comment Resolution Sheet della commessa: ogni commento del cliente riceve una risposta SICIET, scritta in inglese, e si chiude prima della riemissione.","The project's Comment Resolution Sheet: every client comment gets a SICIET reply, written in English, and is closed before the document is reissued.")}</p></div>
    <div class="actions"><button class="btn" data-act="crs" ${S.cmts.length?"":"disabled"} title="${tx("File ufficiale in inglese","Official file, in English")}">${tx("Esporta CRS (CSV, EN)","Export CRS (CSV)")}</button><button class="btn primary" data-act="newCmt" ${S.canComment&&S.docs.length?"":"disabled"}>${tx("Registra commento","Log comment")}</button></div></div>
  <div class="toolbar">
    <select id="cf" aria-label="${tx("Filtra commenti","Filter comments")}"><option value="aperti" ${f==="aperti"?"selected":""}>${tx("Aperti","Open")} (${open})</option><option value="chiusi" ${f==="chiusi"?"selected":""}>${tx("Chiusi","Closed")} (${S.cmts.length-open})</option><option value="tutti" ${f==="tutti"?"selected":""}>${tx("Tutti","All")} (${S.cmts.length})</option></select>
    <span class="count">${tx(`${list.length} commenti`,`${list.length} comments`)}</span></div>
  <div class="tablebox"><table>
    <thead><tr><th>${tx("Documento","Document")}</th><th>Rev</th><th>${tx("N.","No.")}</th><th>${tx("Commento del cliente","Client comment")}</th><th>${tx("Risposta SICIET (EN)","SICIET reply")}</th><th>${tx("Stato","Status")}</th></tr></thead>
    <tbody>${list.length?list.map(c=>{const d=docById(c.docId);
      return `<tr><td class="mono num">${esc(d?d.num:tx("(documento rimosso)","(document removed)"))}${demoTag(c)}<br><span class="muted" style="font-family:var(--f-body)">${esc(titleUi(d))}</span></td>
      <td class="mono">${esc(c.rev)}</td><td class="mono">${esc(c.n)}</td><td style="min-width:220px">${c.origin==="client"?`<span class="chip t-pend" style="margin-bottom:4px">${tx("dal portale","from portal")}</span><br>`:""}${esc(c.text)}${c.ref?`<br><span class="muted">${tx("Rif.","Ref.")}: ${esc(c.ref)}</span>`:""}</td>
      <td>${c.status==="chiuso"||!S.canComment?(c.reply?esc(c.reply):'<span class="muted">—</span>'):
        `<div class="cmt-reply"><textarea id="rep-${esc(c.id)}" lang="en" aria-label="${tx("Risposta al commento, in inglese","Reply to the comment")}" placeholder="${tx("Risposta in inglese, es. Noted, updated in rev. 0.","e.g. Noted, updated in rev. 0.")}">${esc(c.reply||"")}</textarea>
        <div class="actions"><button class="btn small" data-cmt-save="${esc(c.id)}">${tx("Salva risposta","Save reply")}</button><button class="btn small primary" data-cmt-close="${esc(c.id)}">${tx("Salva e chiudi","Save and close")}</button></div></div>`}</td>
      <td>${c.status==="chiuso"?`<span class="chip t-ok">${tx("Chiuso","Closed")}</span>${S.canComment?`<br><button class="link" data-cmt-reopen="${esc(c.id)}" style="margin-top:6px">${tx("Riapri","Reopen")}</button>`:""}`:`<span class="chip t-warn">${tx("Aperto","Open")}</span>`}</td></tr>`}).join("")
    :`<tr><td colspan="6" class="empty">${f==="aperti"?tx("Nessun commento aperto.","No open comments."):tx("Nessun commento.","No comments.")}</td></tr>`}</tbody></table></div>`;
}

/* ---------- Portale cliente (sempre in inglese) ---------- */
function clientState(tr){
  const items=tr.items||[], done=items.filter(i=>i.ret).length;
  if(done===items.length&&items.length) return {label:"Replied",tone:"ok"};
  if(todayISO()>trDue(tr)) return {label:done?`Reply overdue (${done}/${items.length} answered)`:"Reply overdue",tone:"warn"};
  return {label:done?`Reply in progress (${done}/${items.length})`:"Reply required",tone:"pend"};
}
function viewClient(){
  const list=S.trs.filter(t=>t.status!=="bozza").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||b.seq-a.seq);
  const open=list.filter(t=>(t.items||[]).some(i=>!i.ret)).length;
  return `
  ${S.realClient?"":`<div class="notice preview">${LANG==="en"?"<b>Client portal preview.</b> This is what PEG Italy / BH see. In production the client signs in with their own Microsoft account (guest access) and files come from SharePoint.":"<b>Anteprima del portale cliente.</b> È ciò che vedranno PEG Italy e BH. In produzione il cliente entra con il proprio account Microsoft (accesso ospite) e i file arrivano da SharePoint."} <button class="link" data-view-mode="siciet">${LANG==="en"?"Back to SICIET view":"Torna alla vista SICIET"}</button></div>`}
  <div class="pagehead"><div><h1>Transmittals from SICIET</h1><p>${esc(S.cfg.projectName)} · ${esc(S.cfg.customer)} / ${esc(S.cfg.endClient)}. Open a transmittal to view or download the documents and send your review.</p></div>
    <div class="actions"><span class="chip t-${open?"pend":"ok"}">${open?`${open} awaiting your review`:"Nothing awaiting review"}</span></div></div>
  <div class="tablebox"><table>
    <thead><tr><th>Transmittal</th><th>Date</th><th>Documents</th><th>Files</th><th>Reply due</th><th>Status</th></tr></thead>
    <tbody>${list.length?list.map(tr=>{const st=clientState(tr), n=(tr.items||[]).length, nf=(tr.items||[]).filter(i=>i.file).length;
      return `<tr class="clickable" data-ctr="${esc(tr.id)}"><td class="mono num"><b>${esc(trNum(tr))}</b></td><td class="mono num">${fmtEn(tr.date)}</td><td class="mono">${n}</td>
      <td class="mono">${nf}/${n}</td><td class="mono num">${fmtEn(trDue(tr))}</td><td><span class="chip t-${st.tone}">${esc(st.label)}</span></td></tr>`}).join("")
    :`<tr><td colspan="6" class="empty">No transmittals received yet.</td></tr>`}</tbody></table></div>`;
}
function clientTr(tr, replying){
  const items=tr.items||[], canReply=items.some(i=>!i.ret);
  const rows=items.map((it,k)=>{const d=docById(it.docId)||{};
    return `<tr><td class="mono">${k+1}</td><td class="mono num">${esc(d.num||"?")}</td><td>${esc(titleOff(d))}</td><td class="mono">${esc(it.rev)}</td><td class="mono">${esc(it.poi)}</td>
      <td style="min-width:200px">${fileCell(it.file)}</td>
      <td style="min-width:${replying&&!it.ret?260:120}px">${it.ret?`${retCode(it.ret.code)} <span class="muted">${esc(RET[it.ret.code]?.en||"")}</span><br><span class="muted mono">${fmtEn(it.ret.date)}</span>`
        : replying ? `<select id="cc-${k}" aria-label="Return code"><option value="">Select a return code</option>${Object.entries(RET).map(([c,v])=>`<option value="${c}">${c} – ${v.en}</option>`).join("")}</select>
          <textarea id="cm-${k}" lang="en" aria-label="Comments" placeholder="Comments, one per line (optional)" style="margin-top:6px"></textarea>`
        : `<span class="muted">Pending</span>`}</td></tr>`}).join("");
  return `<div class="form">
    <div class="sh-meta" style="border-top:1px solid var(--line-strong)">
      <div><i>Project</i><b>${esc(tr.projectName||S.cfg.projectName)}</b></div><div><i>Date</i><b class="mono">${fmtEn(tr.date)}</b></div>
      <div><i>From</i><b>SICIET – Document Control</b></div><div><i>Reply due by</i><b class="mono">${fmtEn(trDue(tr))}</b></div></div>
    ${tr.note?`<p style="margin:0"><b>Remarks:</b> ${esc(tr.note)}</p>`:""}
    <form id="crf" data-id="${esc(tr.id)}"><div class="tablebox"><table>
      <thead><tr><th>ID</th><th>Document No.</th><th>Description</th><th>Rev.</th><th>Purpose</th><th>File</th><th>Your review</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      ${replying?`<div class="actions" style="margin-top:12px"><button class="btn" type="button" data-act="crCancel">Cancel</button><button class="btn primary" type="submit">Send review to SICIET</button></div>
        <p class="hint" style="margin-top:8px">Only documents with a return code are sent. You can review the others later.</p>`:""}
    </form>
    ${!replying&&canReply?`<div class="actions"><button class="btn primary" data-act="crStart">Review documents</button></div>`:""}
    <div class="sh-legend"><div><b>Return codes</b>${Object.entries(RET).map(([k,v])=>`<div><span class="mono" style="min-width:14px">${k}</span>${v.en}</div>`).join("")}</div>
      <div><b>Purpose of issue</b>${Object.entries(POI).map(([k,v])=>`<div><span class="mono" style="min-width:34px">${k}</span>${v.en}</div>`).join("")}</div></div>
  </div>`;
}
async function saveClientReply(form){
  const tr=S.trs.find(t=>t.id===form.dataset.id); if(!tr) return;
  const items=[], comments=[];
  (tr.items||[]).forEach((it,k)=>{ if(it.ret) return; const c=val("cc-"+k); const lines=val("cm-"+k).split(/\n+/).map(x=>x.trim()).filter(Boolean);
    if(c) items.push({k,code:c}); if(c) lines.forEach(text=>comments.push({docId:it.docId,rev:it.rev,text}));
    if(!c&&lines.length) items.push({k,missing:true}); });
  if(items.some(i=>i.missing)){ toast("Select a return code for every document you comment on."); return; }
  if(!items.length){ toast("Select at least one return code."); return; }
  try{ const r=await op({op:"clientReply",trId:tr.id,items,comments}); openDrawer({type:"ctr",id:tr.id}); return r; }catch(e){ fail(e); }
}

/* ---------- Foglio transmittal: comunicazione ufficiale, sempre in inglese ---------- */
function sheetHtml(tr){
  const items=tr.items||[], issued=tr.status!=="bozza", due=tr.dueDays??S.cfg.dueDays, to=tr.to||S.cfg.customer, endClient=tr.endClient||S.cfg.endClient;
  return `<div class="sheet" lang="en">
    <div class="sh-head"><div class="sh-brand"><span class="lockup"><img src="${LOGO_URL}" alt="SICIET"><span class="rule"></span><span class="wm">ShareDocs</span></span><small>Document Control</small></div>
      <div class="sh-title"><div class="sh-co"><b>${COMPANY.name}</b><br>${COMPANY.addr}<br>${COMPANY.ids}</div><div class="k">CUSTOMER TRANSMITTAL</div><div class="no">${esc(trNum(tr))}</div>${issued?"":'<span class="stamp" style="color:var(--muted)">Draft</span>'}</div></div>
    <div class="sh-meta">
      <div><i>Project</i><b>${esc(tr.projectName||S.cfg.projectName)}</b></div>
      <div><i>Date</i><b class="mono">${issued?fmtEn(tr.date):"—"}</b></div>
      <div><i>Customer</i><b>${esc(to)}</b></div>
      <div><i>Client</i><b>${esc(endClient)}</b></div>
      <div><i>To kind attn.</i><b>${esc(tr.attn||S.cfg.attn)}</b></div>
      <div><i>From</i><b>SICIET – Document Control</b></div>
      <div><i>Reply due by</i><b class="mono">${issued?fmtEn(trDue(tr)):`${due} days from issue`}</b></div>
      <div><i>SICIET job</i><b>${esc(S.cfg.project)}</b></div>
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>ID</th><th>Document No.</th><th>Supplier Doc. No.</th><th>Description</th><th>Rev.</th><th>Purpose</th><th>Return code</th><th>Return date</th></tr></thead>
      <tbody>${items.map((it,k)=>{const d=docById(it.docId)||{};return `<tr><td class="mono">${k+1}</td><td class="mono num">${esc(d.num||"?")}</td><td class="mono num">${esc(d.supNum||"—")}</td><td>${esc(titleOff(d))}</td>
        <td class="mono">${esc(it.rev)}</td><td class="mono">${esc(it.poi)}</td><td>${it.ret?retCode(it.ret.code):""}</td><td class="mono num">${it.ret?fmtEn(it.ret.date):""}</td></tr>`}).join("")}</tbody></table></div>
    <p style="margin:12px 0 0">Please review the documents listed above and return them with the applicable return code within ${esc(due)} calendar days of the transmittal date.</p>
    ${tr.note?`<p style="margin:8px 0 0"><b>Remarks:</b> ${esc(tr.note)}</p>`:""}
    <div class="sh-legend">
      <div><b>Purpose of issue</b>${Object.entries(POI).map(([k,v])=>`<div><span class="mono" style="min-width:34px">${k}</span>${v.en}</div>`).join("")}</div>
      <div><b>Return codes</b>${Object.entries(RET).map(([k,v])=>`<div><span class="mono" style="min-width:14px">${k}</span>${v.en}</div>`).join("")}</div>
    </div>
    ${items.some(i=>i.file)?`<div class="sh-files"><b>Attached files</b>${items.map((it,k)=>it.file?`<div><span class="mono">${k+1}.</span> <span class="mono">${esc(it.file.name)}</span> <span class="muted">(${fsize(it.file.size)})</span></div>`:"").join("")}<div class="muted">Files are available for download on the SICIET ShareDocs client portal.</div></div>`:""}
    <div class="sh-sign"><div>Issued by (SICIET) – name, date and signature</div><div>Received by (${esc(to)} / ${esc(endClient)}) – name, date and signature</div></div>
  </div>`;
}

/* ---------- Pannelli ---------- */
function openDrawer(d){ S.drawer=d; renderDrawer(); }
function closeDrawer(){ S.drawer=null; S.pendingDel=null; document.getElementById("drawerRoot").innerHTML=""; }
function renderDrawer(){
  const root=document.getElementById("drawerRoot"), d=S.drawer;
  if(!d){ root.innerHTML=""; return; }
  let title="", body="", head="";
  if(d.type==="tr"){
    const tr=S.trs.find(t=>t.id===d.id); if(!tr){ closeDrawer(); return; }
    const st=trState(tr);
    title=`Transmittal ${esc(trNum(tr))}`;
    head=`<span class="chip t-${st.tone}">${esc(st.label)}</span>
      <button class="btn small" data-act="dlTr" data-id="${esc(tr.id)}">${tx("Scarica (.html)","Download (.html)")}</button>
      ${S.canWrite&&tr.status==="bozza"?`<button class="btn small" data-act="editTr" data-id="${esc(tr.id)}">${tx("Modifica","Edit")}</button><button class="btn small primary" data-act="issueTr" data-id="${esc(tr.id)}">${tx("Emetti oggi","Issue today")}</button>`:""}
      ${S.canWrite&&tr.status!=="bozza"&&!d.respond?`<button class="btn small primary" data-act="respond" data-id="${esc(tr.id)}">${tx("Registra risposta cliente","Log client reply")}</button>`:""}`;
    const missing=(tr.items||[]).filter(i=>{const x=docById(i.docId);return x&&!x.titleEn;}).length;
    body = d.respond ? respondForm(tr) :
      (missing?`<div class="notice warn" style="margin-bottom:14px">${tx(`${missing} documenti non hanno il titolo in inglese: nel foglio compare il titolo italiano. Aggiungilo dalla scheda del documento.`,`${missing} documents have no English title, so the Italian title appears on the sheet. Add it from the document record.`)}</div>`:"")
      + `<p class="hint" style="margin:0 0 10px">${tx("Foglio ufficiale per il cliente, sempre in inglese.","Official sheet for the client, always in English.")}</p>`
      + sheetHtml(tr)
      + (tr.status==="bozza"&&S.canWrite?`<p style="margin-top:16px">${S.pendingDel===tr.id?`<span class="confirm">${tx(`Eliminare la bozza ${esc(trNum(tr))}?`,`Delete draft ${esc(trNum(tr))}?`)} <button class="btn small danger" data-act="delTrYes" data-id="${esc(tr.id)}">${tx("Elimina","Delete")}</button><button class="btn small" data-act="delNo">${tx("Annulla","Cancel")}</button></span>`:`<button class="link" style="color:var(--bad)" data-act="delTr" data-id="${esc(tr.id)}">${tx("Elimina bozza","Delete draft")}</button>`}</p>`:"")
      + (tr.status!=="bozza"?`<p class="hint" style="margin-top:12px">${tx(`Emesso il ${fmt(tr.date)}`,`Issued on ${fmt(tr.date)}`)}${(tr.issuedBy||tr.by)?` ${tx("da","by")} ${esc((tr.issuedBy||tr.by).nome||"")}`:""}. ${tx("Il file scaricato si può stampare in PDF e allegare alla mail per il cliente.","The downloaded file can be printed to PDF and attached to the email to the client.")}</p>`:"")
      + ((tr.items||[]).length?`<h3 style="font-size:14px;margin:18px 0 8px">${tx("File allegati","Attached files")}</h3><div class="tablebox"><table><thead><tr><th>${tx("Documento","Document")}</th><th>Rev</th><th>${tx("File e percorso SharePoint","File and SharePoint path")}</th></tr></thead><tbody>${(tr.items||[]).map(it=>{const x=docById(it.docId)||{};return `<tr><td class="mono num">${esc(x.num||"?")}</td><td class="mono">${esc(it.rev)}</td><td>${fileCell(it.file,{sp:true})}</td></tr>`}).join("")}</tbody></table></div>`:"");
  } else if(d.type==="ctr") {
    const tr=S.trs.find(t=>t.id===d.id); if(!tr){ closeDrawer(); return; }
    const st=clientState(tr);
    title=`Transmittal ${esc(trNum(tr))}`;
    head=`<span class="chip t-${st.tone}">${esc(st.label)}</span><button class="btn small" data-act="dlTr" data-id="${esc(tr.id)}">Transmittal sheet (.html)</button>`;
    body=clientTr(tr, d.replying);
  } else if(d.type==="newTr") { title=d.editId?tx("Modifica bozza transmittal","Edit draft transmittal"):tx("Nuovo transmittal","New transmittal"); body=trForm(d); }
  else if(d.type==="newCommessa") { title=tx("Nuova commessa","New project"); body=commessaForm(); }
  else if(d.type==="pdf") { ({title, head, body} = pdfPanel(d)); }
  else if(d.type==="newDoc") { title=tx("Nuovo documento","New document"); body=docForm(); }
  else if(d.type==="import") { title=tx("Incolla elenco documenti","Paste document list"); body=importForm(); }
  else if(d.type==="newCmt") { title=tx("Registra commento del cliente","Log client comment"); body=cmtForm(d); }
  else if(d.type==="settings") { title=tx("Impostazioni commessa","Project settings"); body=settingsForm(); }
  else if(d.type==="doc") { const doc=docById(d.id); if(!doc){closeDrawer();return;} title=`<span class="mono">${esc(doc.num)}</span>`; body=docCard(doc); }
  root.innerHTML=`<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${tx("Dettaglio","Details")}">
    <div class="dh"><h2>${title}</h2>${head}<button class="btn small" data-act="close">${tx("Chiudi","Close")}</button></div><div class="db">${body}</div></aside>`;
}

function trForm(d){
  const tr=d.editId?S.trs.find(t=>t.id===d.editId):null;
  const pre=new Map((tr?.items||[]).map(i=>[i.docId,i]));
  const infos=S.docs.filter(doc=>!doc.closed).map(doc=>({doc,i:docInfo(doc)})).sort((a,b)=>docSort(a.doc,b.doc));
  const pick=d.doc?new Set([d.doc]):null;
  return `<form class="form" id="trf">
    <div class="row"><label class="f">${tx("Numero","Number")}<input class="mono" value="${esc(tr?trNum(tr):S.cfg.prefix+String(nextSeq()).padStart(2,"0"))}" disabled></label>
      <label class="f">Customer<input id="t_to" value="${esc(tr?.to||S.cfg.customer)}"></label><label class="f">Client<input id="t_ec" value="${esc(tr?.endClient||S.cfg.endClient)}"></label>
      <label class="f">${tx("Alla c.a.","To kind attn.")}<input id="t_attn" value="${esc(tr?.attn||S.cfg.attn)}"></label>
      <label class="f">${tx("Giorni per la risposta","Days to reply")}<input id="t_due" type="number" min="1" max="90" value="${esc(tr?.dueDays??S.cfg.dueDays)}"></label></div>
    <label class="f">${tx("Note per il cliente (in inglese, compaiono sul foglio)","Remarks for the client (shown on the sheet)")}<textarea id="t_note" lang="en" placeholder="e.g. Documents reissued as rev. 0 following the comments received with ${esc(S.cfg.prefix)}08.">${esc(tr?.note||"")}</textarea></label>
    <div><b style="font-size:13px">${tx("Documenti da trasmettere","Documents to transmit")}</b><p class="hint">${tx("Schema revisioni del cliente: A per approvazione, B riemissione per approvazione, 0 per progettazione/costruzione, 1 riemissione o As-built, X annullato. La revisione proposta segue questo schema; puoi correggerla riga per riga.","Client revision scheme: A issued for approval, B re-issued for approval, 0 for design/construction, 1 re-issued or As-Built, X cancelled. The proposed revision follows this scheme; you can change it on each row.")}</p></div>
    <div class="tablebox"><table><thead><tr><th></th><th>${tx("Documento","Document")}</th><th>${tx("Stato attuale","Current status")}</th><th>Rev</th><th>${tx("Scopo","Purpose")}</th><th>${tx("File da allegare","File to attach")}</th></tr></thead><tbody>
    ${infos.map(({doc,i})=>{const p=pre.get(doc.id), on=p||pick?.has(doc.id); const suggest=p?p.rev:i.next;
      const defPoi=p?p.poi:(doc.cls||"IFA");
      return `<tr><td><input type="checkbox" id="ck-${esc(doc.id)}" data-doc="${esc(doc.id)}" ${on?"checked":""} aria-label="${tx("Includi","Include")} ${esc(doc.num)}"></td>
      <td><span class="mono">${esc(doc.num)}</span><br><span class="muted">${esc(titleUi(doc))}</span></td><td>${chip(i.key)}${i.rev?` <span class="mono muted">rev ${esc(i.rev)}</span>`:""}</td>
      <td><input id="rv-${esc(doc.id)}" class="mono" value="${esc(suggest)}" aria-label="${tx("Revisione","Revision")}" style="width:62px"></td>
      <td><select id="po-${esc(doc.id)}" aria-label="${tx("Scopo di emissione","Purpose of issue")}">${Object.entries(POI).map(([k,v])=>`<option value="${k}" ${k===defPoi?"selected":""}>${k} – ${tx(v.it,v.en)}</option>`).join("")}</select></td>
      <td style="min-width:220px">${p&&p.file?`<div class="muted" style="font-size:12px">${tx("Allegato","Attached")}: <span class="mono">${esc(p.file.name)}</span></div>`:""}<input type="file" id="fl-${esc(doc.id)}" class="fileinput" ${S.canWrite?"":"disabled"} aria-label="${tx("File del documento","Document file")} ${esc(doc.num)}"></td></tr>`}).join("")}
    </tbody></table></div>
    <p class="hint">${tx(`Il file viene rinominato in modo standard (numero documento_Rev, es. SOK976701376_Rev5.pdf) e caricato su SharePoint in ${esc(S.cfg.cartella)}/Transmittals/<n. transmittal>/, senza limite di dimensione. Per emettere servono i file di tutti i documenti selezionati; la bozza si può salvare anche senza.`,`Files are renamed to a standard name (document no._Rev, e.g. SOK976701376_Rev5.pdf) and uploaded to SharePoint in ${esc(S.cfg.cartella)}/Transmittals/<transmittal no.>/, with no size limit. Every selected document needs a file to issue; drafts can be saved without.`)}</p>
    <div class="actions"><button class="btn" type="submit" data-mode="draft">${tx("Salva bozza","Save draft")}</button><button class="btn primary" type="submit" data-mode="issue">${tx("Emetti oggi","Issue today")}</button></div>
  </form>`;
}
function respondForm(tr){
  return `<form class="form" id="rf" data-id="${esc(tr.id)}">
    <p class="hint">${tx("Riporta per ogni documento il codice restituito dal cliente. I commenti scritti, uno per riga e nella lingua in cui li ha scritti il cliente, finiscono nel registro commenti legati a quella revisione.","Enter the code the client returned for each document. Written comments, one per line and as the client wrote them, go to the comment register under that revision.")}</p>
    <div class="tablebox"><table><thead><tr><th>${tx("Documento","Document")}</th><th>Rev</th><th>${tx("Codice","Code")}</th><th>${tx("Data ritorno","Return date")}</th><th>${tx("Commenti del cliente (uno per riga)","Client comments (one per line)")}</th></tr></thead><tbody>
    ${(tr.items||[]).map((it,k)=>{const d=docById(it.docId)||{};return `<tr><td><span class="mono">${esc(d.num||"?")}</span><br><span class="muted">${esc(titleUi(d))}</span></td><td class="mono">${esc(it.rev)}</td>
      <td><select id="rc-${k}" aria-label="${tx("Codice di ritorno","Return code")}"><option value="">—</option>${Object.entries(RET).map(([c,v])=>`<option value="${c}" ${it.ret&&String(it.ret.code)===c?"selected":""}>${c} – ${tx(v.it,v.en)}</option>`).join("")}</select></td>
      <td><input id="rd-${k}" type="date" value="${esc(it.ret?.date||todayISO())}" aria-label="${tx("Data di ritorno","Return date")}"></td>
      <td><textarea id="rt-${k}" aria-label="${tx("Commenti","Comments")}" placeholder="${tx("Nessun commento","No comments")}" style="min-width:220px"></textarea></td></tr>`}).join("")}
    </tbody></table></div>
    <div class="actions"><button class="btn" type="button" data-act="respondCancel">${tx("Annulla","Cancel")}</button><button class="btn primary" type="submit">${tx("Salva risposta","Save reply")}</button></div></form>`;
}
function docFields(doc){
  doc=doc||{};
  return `<div class="row"><label class="f">${tx("N. documento (cliente) *","Document no. (client) *")}<input id="d_num" class="mono" required placeholder="SOK976701376" value="${esc(doc.num||"")}" ${doc.id?"disabled":""}></label><label class="f">${tx("N. documento SICIET","SICIET doc. no.")}<input id="d_cnum" class="mono" value="${esc(doc.supNum||"")}"></label></div>
    <div class="row"><label class="f">${tx("Titolo in italiano","Italian title")}<input id="d_title" value="${esc(doc.title||"")}"></label><label class="f">${tx("Titolo in inglese * (per il cliente)","English title * (for the client)")}<input id="d_titleEn" lang="en" required value="${esc(doc.titleEn||"")}"></label></div>
    <div class="row"><label class="f">${tx("Disciplina","Discipline")}<input id="d_disc" placeholder="HVAC, Electrical, Quality…" list="discs" value="${esc(doc.disc||"")}"></label><label class="f">${tx("Tipo","Type")}<input id="d_type" placeholder="${tx("Disegno, Calcolo, Datasheet…","Drawing, Calculation, Datasheet…")}" value="${esc(doc.type||"")}"></label><label class="f">${tx("Prima emissione prevista","Planned first issue")}<input id="d_plan" type="date" value="${esc(doc.planned||"")}"></label></div>
    <datalist id="discs">${[...new Set(S.docs.map(d=>d.disc).filter(Boolean))].map(x=>`<option value="${esc(x)}">`).join("")}</datalist>`;
}
function docForm(){
  return `<form class="form" id="df">${docFields()}
    <div class="actions"><button class="btn primary" type="submit">${tx("Aggiungi al registro","Add to register")}</button></div></form>`;
}
function importForm(){
  return `<form class="form" id="impf">
    <p class="hint">${tx("Copia le colonne dal VDRL in Excel e incollale qui, in quest’ordine:","Copy the columns from the VDRL in Excel and paste them here, in this order:")} <b>${tx("N. documento","Document no.")}</b>, <b>${tx("N. SICIET","SICIET no.")}</b>, <b>${tx("Titolo IT","Italian title")}</b>, <b>${tx("Titolo EN","English title")}</b>, <b>${tx("Disciplina","Discipline")}</b>, <b>${tx("Data prevista","Planned date")}</b> (${tx("gg/mm/aaaa","dd/mm/yyyy")}). ${tx("Gli spazi nei codici vengono rimossi; i numeri già a registro vengono saltati.","Spaces in codes are removed; numbers already in the register are skipped.")}</p>
    <label class="f">${tx("Righe da Excel","Rows from Excel")}<textarea id="imp" rows="10" class="mono" placeholder="SOK976701383&#9;&#9;Disegni di montaggio canali&#9;HVAC Ducts &amp; supports Erection Drawings&#9;HVAC&#9;07/12/2026"></textarea></label>
    <div class="actions"><button class="btn primary" type="submit">${tx("Importa","Import")}</button></div></form>`;
}
function cmtForm(d){
  return `<form class="form" id="cmf">
    <div class="row"><label class="f">${tx("Documento","Document")}<select id="c_doc">${[...S.docs].sort(docSort).map(x=>`<option value="${esc(x.id)}" ${d.doc===x.id?"selected":""}>${esc(x.num)} – ${esc(titleUi(x))}</option>`).join("")}</select></label>
      <label class="f">${tx("Revisione commentata","Revision commented")}<input id="c_rev" class="mono" placeholder="A"></label><label class="f">${tx("Riferimento (pagina, sezione)","Reference (page, section)")}<input id="c_ref"></label></div>
    <label class="f">${tx("Commento del cliente *, come ricevuto","Client comment *, as received")}<textarea id="c_text" required></textarea></label>
    <div class="actions"><button class="btn primary" type="submit">${tx("Registra","Log comment")}</button></div></form>`;
}
function settingsForm(){
  const c=S.cfg, vuoto=!S.trs.length&&!S.cmts.length;
  return `<form class="form" id="sf">
    <div class="notice">${tx("Le comunicazioni ufficiali (foglio transmittal, file scaricati, VDRL e CRS) escono sempre in inglese. VDRL e CRS in Excel sono aggiornati da soli nella cartella SharePoint della commessa.","Official communications (transmittal sheet, downloaded files, VDRL and CRS) are always in English. VDRL and CRS in Excel are updated automatically in the project's SharePoint folder.")}</div>
    <div class="row"><label class="f">${tx("Commessa SICIET","SICIET job")}<input id="s_proj" value="${esc(c.project)}"></label><label class="f">${tx("Nome progetto (sul transmittal)","Project name (on the transmittal)")}<input id="s_pname" value="${esc(c.projectName)}"></label></div>
    <div class="row"><label class="f">Customer<input id="s_cust" value="${esc(c.customer)}"></label><label class="f">Client<input id="s_ec" value="${esc(c.endClient)}"></label><label class="f">${tx("Alla c.a. predefinito","Default attention")}<input id="s_attn" value="${esc(c.attn)}"></label></div>
    <div class="row"><label class="f">${tx("Prefisso transmittal","Transmittal prefix")}<input id="s_pre" class="mono" value="${esc(c.prefix)}"></label><label class="f">${tx("Primo numero progressivo","First sequence number")}<input id="s_seq" type="number" min="1" value="${esc(c.startSeq)}"></label><label class="f">${tx("Giorni per la risposta","Days to reply")}<input id="s_due" type="number" min="1" max="90" value="${esc(c.dueDays)}"></label></div>
    <label class="f">${tx("Clienti ammessi al portale (indirizzi email o domini come @cliente.com, uno per riga)","Clients allowed on the portal (email addresses or domains like @client.com, one per line)")}<textarea id="s_cli" class="mono" rows="4" placeholder="@pegitaly.it">${esc((c.clienti||[]).join("\n"))}</textarea></label>
    <p class="hint">${tx(`Cartella SharePoint: SICIET Docs / Documenti / ${esc(c.cartella)}. Gli ospiti con ruolo Cliente vedono questa commessa solo se il loro indirizzo o dominio è nell'elenco.`,`SharePoint folder: SICIET Docs / Documents / ${esc(c.cartella)}. Guests with the Client role see this project only if their address or domain is listed.`)}</p>
    <div class="actions"><button class="btn primary" type="submit" ${S.canWrite?"":"disabled"}>${tx("Salva impostazioni","Save settings")}</button></div></form>
    ${S.canWrite&&vuoto?`<div class="notice" style="margin-top:24px"><b>${tx("Importazione iniziale","Initial import")}</b><p class="hint" style="margin:4px 0 10px">${tx("Carica il file JSON con registro e transmittal esistenti (es. sharedoc-import-2040.json). Si può fare solo finché la commessa non ha transmittal né commenti.","Load the JSON file with the existing register and transmittals. Allowed only while the project has no transmittals or comments.")}</p>
      <input type="file" id="impJson" accept=".json,application/json"></div>`:""}
    ${S.canWrite?`<div class="notice" style="margin-top:16px"><b>${tx("Nuova commessa","New project")}</b><p class="hint" style="margin:4px 0 10px">${tx("Crea un'altra commessa con il suo registro e la sua cartella su SharePoint.","Create another project with its own register and SharePoint folder.")}</p><button class="btn small" type="button" data-act="newCommessa">${tx("Crea commessa","Create project")}</button></div>`:""}`;
}
function docCard(doc){
  const i=docInfo(doc), cm=S.cmts.filter(c=>c.docId===doc.id);
  if(S.drawer.edit) return `<form class="form" id="def" data-id="${esc(doc.id)}">${docFields(doc)}<div class="actions"><button class="btn" type="button" data-act="editDocCancel">${tx("Annulla","Cancel")}</button><button class="btn primary" type="submit">${tx("Salva","Save")}</button></div></form>`;
  return `<div class="form">
    <div class="sheet" style="display:grid;gap:6px"><h3 style="font-size:17px">${esc(titleUi(doc))}${demoTag(doc)}</h3>
      <div class="muted">${LANG==="en"?(doc.title?`IT: ${esc(doc.title)}`:""):(doc.titleEn?`EN: ${esc(doc.titleEn)}`:`<span style="color:var(--warn)">${tx("Manca il titolo in inglese per il cliente","English title for the client is missing")}</span>`)}</div>
      <div class="muted">${tbaTag(doc)} ${tx("N. SICIET","SICIET no.")} <span class="mono">${esc(doc.supNum||"—")}</span> · ${esc(doc.disc||"")} ${doc.type?"· "+esc(doc.type):""} ${doc.cls?"· "+tx("Classe","Class")+" "+esc(doc.cls):""} · ${tx("Emissione prevista","Planned submission")} ${fmt(doc.planned)}${doc.forecast?" · "+tx("previsione","forecast")+" "+fmt(doc.forecast):""}</div>
      ${doc.note?`<div class="notice" style="font-size:13px">${esc(doc.note)}</div>`:""}
      <div>${chip(i.key)} ${i.rev?`<span class="mono">rev ${esc(i.rev)}</span>`:""} <span class="muted">· ${tx("prossima revisione","next revision")}: <span class="mono">${esc(i.next)}</span></span></div></div>
    <h3 style="font-size:14px">${tx("Storico emissioni","Issue history")}</h3>
    <div class="tablebox"><table><thead><tr><th>Rev</th><th>Transmittal</th><th>${tx("Data","Date")}</th><th>${tx("Scopo","Purpose")}</th><th>${tx("Ritorno","Return")}</th><th>${tx("Data ritorno","Return date")}</th><th>File</th></tr></thead><tbody>
    ${i.issues.length?i.issues.map(x=>`<tr class="clickable" data-tr="${esc(x.tr.id)}"><td class="mono">${esc(x.it.rev)}</td><td class="mono">${esc(trNum(x.tr))}</td><td class="mono">${fmt(x.tr.date)}</td><td class="mono">${esc(x.it.poi)}</td><td>${x.it.ret?retCode(x.it.ret.code)+" "+esc(tx(RET[x.it.ret.code].it,RET[x.it.ret.code].en)):`<span class="muted">${tx("in attesa","pending")}</span>`}</td><td class="mono">${x.it.ret?fmt(x.it.ret.date):""}</td><td>${x.it.file?fileCell(x.it.file):`<span class="muted">—</span>`}</td></tr>`).join("")
      :`<tr><td colspan="7" class="empty">${tx("Non ancora emesso.","Not issued yet.")}</td></tr>`}</tbody></table></div>
    <h3 style="font-size:14px">${tx("Commenti del cliente","Client comments")} (${cm.length})</h3>
    ${cm.length?`<div class="tablebox"><table><thead><tr><th>Rev</th><th>${tx("N.","No.")}</th><th>${tx("Commento","Comment")}</th><th>${tx("Risposta","Reply")}</th><th>${tx("Stato","Status")}</th></tr></thead><tbody>${cm.sort((a,b)=>String(a.rev).localeCompare(String(b.rev))||a.n-b.n).map(c=>`<tr><td class="mono">${esc(c.rev)}</td><td class="mono">${esc(c.n)}</td><td>${esc(c.text)}</td><td>${esc(c.reply||"—")}</td><td>${c.status==="chiuso"?`<span class="chip t-ok">${tx("Chiuso","Closed")}</span>`:`<span class="chip t-warn">${tx("Aperto","Open")}</span>`}</td></tr>`).join("")}</tbody></table></div>`:`<p class="hint">${tx("Nessun commento registrato.","No comments logged.")}</p>`}
    <div class="actions">${S.canWrite?`<button class="btn primary" data-act="newTr" data-doc="${esc(doc.id)}">${tx(`Emetti in rev ${esc(i.next)}`,`Issue as rev ${esc(i.next)}`)}</button><button class="btn" data-act="newCmt" data-doc="${esc(doc.id)}">${tx("Registra commento","Log comment")}</button><button class="btn" data-act="editDoc">${tx("Modifica dati","Edit details")}</button>`:""}</div></div>`;
}


/* Export ufficiali: sempre in inglese */
const csvQ = s => `"${String(s ?? "").replace(/"/g,'""')}"`;
const csvFile = (head,rows) => "﻿"+[head,...rows].map(r=>r.map(csvQ).join(";")).join("\r\n");
const filePrefix = () => S.cfg.prefix.replace(/-?T$/i,"").replace(/[^A-Za-z0-9]/g,"") || "SICIET";
async function csvVdrl(){
  const head=["VDRL ID","Document No.","Supplier Doc. No.","Title","Discipline","Class","Planned submission","Current rev.","Status","Last transmittal","Issue date","Purpose","Return code","Return date","Revision history"];
  const rows=[...S.docs].sort(docSort).map(d=>{const i=docInfo(d),l=i.last;
    return [d.vid??"",d.num,d.supNum,titleOff(d),d.disc,d.cls||"",fmtEn(d.planned),i.rev,STATES[i.key].en,l?trNum(l.tr):"",l?fmtEn(l.tr.date):"",l?l.it.poi:"",l&&l.it.ret?l.it.ret.code:"",l&&l.it.ret?fmtEn(l.it.ret.date):"",i.issues.map(x=>`${x.it.rev} (${trNum(x.tr)}${x.it.ret?", code "+x.it.ret.code:""})`).join("; ")];});
  await save(`${filePrefix()}_VDRL_${todayISO()}.csv`, csvFile(head,rows));
}
async function csvCrs(){
  const head=["Document No.","Title","Rev.","Comment No.","Reference","Client comment","SICIET reply","Status","Transmittal"];
  const rows=[...S.cmts].sort((a,b)=>{const da=docById(a.docId),dbb=docById(b.docId);return docSort(da||{},dbb||{})||String(a.rev).localeCompare(String(b.rev))||(a.n||0)-(b.n||0)})
    .map(c=>{const d=docById(c.docId)||{}, tr=S.trs.find(t=>t.id===c.trId); return [d.num,titleOff(d),c.rev,c.n,c.ref,c.text,c.reply,c.status==="chiuso"?"Closed":"Open",tr?trNum(tr):""];});
  await save(`${filePrefix()}_CRS_${todayISO()}.csv`, csvFile(head,rows));
}

async function dlTr(id){
  const tr=S.trs.find(t=>t.id===id); if(!tr) return;
  const css=[...document.querySelectorAll("style")].map(s=>s.textContent).join("\n");
  const html=`<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>${esc(trNum(tr))}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Oxanium:wght@800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"><style>${css}\nbody{padding:24px;background:#fff}@media print{body{padding:0}}</style></head><body>${sheetHtml(tr)}</body></html>`;
  await save(`${trNum(tr)}.html`, html);
}
async function save(filename, data){ salvaBlob(filename, new Blob([data], { type: /\.csv$/.test(filename) ? "text/csv;charset=utf-8" : "text/html;charset=utf-8" })); }

/* ---------- Schermate di accesso ---------- */
function commessaForm(){
  return `<form class="form" id="ncf">
    <div class="row"><label class="f">${tx("Codice commessa *","Project code *")}<input id="n_id" class="mono" required placeholder="2040" pattern="[A-Za-z0-9_\\-]{1,40}"></label>
      <label class="f">${tx("Nome commessa *","Project name *")}<input id="n_nome" required placeholder="2040 PEG ITALY HVAC NGFGT IRAQ"></label></div>
    <label class="f">${tx("Cartella su SharePoint (SICIET Docs / Documenti)","Folder on SharePoint (SICIET Docs / Documents)")}<input id="n_cart" placeholder="${tx("uguale al nome commessa","same as the project name")}"></label>
    <label class="f">${tx("Clienti ammessi (email o @dominio, uno per riga; si possono aggiungere dopo)","Allowed clients (email or @domain, one per line; can be added later)")}<textarea id="n_cli" class="mono" rows="3"></textarea></label>
    <div class="actions"><button class="btn primary" type="submit">${tx("Crea commessa","Create project")}</button></div></form>`;
}
function screenHtml(){
  const sc = S.screen;
  if(!sc) return null;
  if(sc === "avvio" || sc === "caricamento") return `<div class="empty">${tx("Caricamento…","Loading…")}</div>`;
  if(sc === "login") return `<div class="panel" style="max-width:560px;margin:24px auto;padding:24px;display:grid;gap:14px">
    <h1 style="font-size:22px">SICIET ShareDocs</h1>
    <p style="margin:0">${tx("Transmittal e revisione documentale tra SICIET e i clienti. Accedi con il tuo account Microsoft aziendale; i clienti accedono con l'account invitato da SICIET.","Document transmittals and review between SICIET and its clients. Sign in with your company Microsoft account; clients sign in with the account invited by SICIET.")}</p>
    <div><button class="btn primary" data-act="login">${tx("Accedi con Microsoft","Sign in with Microsoft")}</button></div></div>`;
  if(sc === "errore") return `<div class="notice warn" style="display:grid;gap:10px"><b>${tx("Qualcosa non ha funzionato","Something went wrong")}</b><span>${esc(S.errore)}</span>
    <span class="actions"><button class="btn small" data-act="retry">${tx("Riprova","Try again")}</button>${account?`<button class="btn small" data-act="logout">${tx("Esci","Sign out")}</button>`:""}</span></div>`;
  if(sc === "nessunaCommessa") return `<div class="notice">${S.realClient?"No project is available for your account yet. Please contact SICIET Document Control.":tx("Nessuna commessa disponibile per il tuo account.","No project available for your account.")}</div>`;
  if(sc === "nuovaCommessa") return `<div class="panel" style="max-width:720px;margin:0 auto;padding:20px;display:grid;gap:12px"><h1 style="font-size:20px">${tx("Crea la prima commessa","Create the first project")}</h1>
    <p class="hint">${tx("Il registro e la cartella su SICIET Docs vengono creati dal servizio. Dopo puoi importare il registro esistente da Impostazioni commessa.","The service creates the register and the folder on SICIET Docs. Then you can import the existing register from Project settings.")}</p>${commessaForm()}</div>`;
  return null;
}
// Testata: commessa, utente, vista. Chiamata dopo ogni render.
function dopoRender(){
  const job = document.getElementById("jobCode"), cl = document.getElementById("jobClient");
  if(isClient()){ job.textContent = S.cfg.projectName || ""; cl.textContent = [S.cfg.customer, S.cfg.endClient].filter(Boolean).join(" / "); }
  else if(S.commesse.length > 1 && S.c){
    job.innerHTML = `<select id="selCommessa" aria-label="${tx("Commessa","Project")}">${S.commesse.map(c=>`<option value="${esc(c.id)}" ${c.id===S.c?"selected":""}>${esc(c.nome)}</option>`).join("")}</select>`;
  }
  const who = document.getElementById("who");
  who.innerHTML = S.me ? `<span>${esc(S.me.nome)}</span> <button class="link" data-act="logout">${tx("Esci","Sign out")}</button>` : "";
  document.getElementById("modeBox").hidden = !S.me || S.realClient;
  if(S.screen){ document.getElementById("tabs").innerHTML = ""; }
}

/* ---------- Azioni ---------- */
const val = id => (document.getElementById(id)?.value ?? "").trim();
const cleanCode = s => String(s||"").replace(/\s+/g,"").toUpperCase();
function parseDate(s){ s=String(s||"").trim(); let m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/); if(m){ const y=m[3].length===2?"20"+m[3]:m[3]; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; } m=s.match(/^\d{4}-\d{2}-\d{2}$/); return m?s:""; }
const docData = () => ({supNum:cleanCode(val("d_cnum")),title:val("d_title"),titleEn:val("d_titleEn"),disc:val("d_disc"),type:val("d_type"),planned:val("d_plan")});
const linee = id => val(id).split(/\n+/).map(s=>s.trim()).filter(Boolean);

async function saveTr(mode){
  const form=document.getElementById("trf");
  const prevTr=S.drawer.editId?S.trs.find(t=>t.id===S.drawer.editId):null;
  const prev=new Map((prevTr?.items||[]).map(i=>[i.docId,i]));
  const items=[], uploads=[];
  document.querySelectorAll('#trf input[type=checkbox][data-doc]').forEach(ck=>{ if(!ck.checked) return; const id=ck.dataset.doc;
    const rev=cleanCode(val("rv-"+id))||"A", f=document.getElementById("fl-"+id)?.files?.[0]||null, old=prev.get(id);
    const item={docId:id,rev,poi:val("po-"+id)||"IFA"};
    if(old&&old.file) item.file={id:old.file.id};
    if(f) uploads.push({item,f});
    items.push(item); });
  if(!items.length){ toast(tx("Seleziona almeno un documento.","Select at least one document.")); return; }
  if(mode==="issue"){ const miss=items.filter(i=>!i.file&&!uploads.find(u=>u.item===i)).map(i=>docById(i.docId)?.num);
    if(miss.length){ toast(tx(`Allega il file prima di emettere: ${miss.join(", ")}`,`Attach the file before issuing: ${miss.join(", ")}`)); return; } }
  const base={to:val("t_to"),endClient:val("t_ec"),attn:val("t_attn"),note:val("t_note"),dueDays:Number(val("t_due"))||S.cfg.dueDays};
  form.querySelectorAll("button").forEach(b=>b.disabled=true);
  try{
    let id=prevTr&&prevTr.id;
    // Un transmittal nuovo si salva prima come bozza: serve il numero per la cartella dei file.
    if(!id){ const r=await op(Object.assign({op:"trSave",items:items.map(i=>({docId:i.docId,rev:i.rev,poi:i.poi}))},base),{quiet:uploads.length>0||mode==="issue"}); id=r.esito.id; S.drawer.editId=id; }
    for(let k=0;k<uploads.length;k++){
      const {item,f}=uploads[k], nome=stdName(docById(item.docId)?.num||"DOC", item.rev, f.name);
      const it=await caricaFile(id, f, nome, p=>toast(tx(`File ${k+1} di ${uploads.length}: ${nome} – ${Math.round(p*100)}%`,`File ${k+1} of ${uploads.length}: ${nome} – ${Math.round(p*100)}%`)));
      item.file={id:it.id,orig:f.name};
    }
    await op(Object.assign({op:"trSave",id,items,emetti:mode==="issue"},base));
    openDrawer({type:"tr",id});
  }catch(e){ form.querySelectorAll("button").forEach(b=>b.disabled=false); fail(e); }
}
async function saveResponse(form){
  const tr=S.trs.find(t=>t.id===form.dataset.id); if(!tr) return;
  const items=(tr.items||[]).map((it,k)=>({k,code:val("rc-"+k),date:val("rd-"+k)}));
  const comments=[]; (tr.items||[]).forEach((it,k)=>linee("rt-"+k).forEach(text=>comments.push({docId:it.docId,rev:it.rev,text})));
  try{ await op({op:"respond",trId:tr.id,items,comments}); openDrawer({type:"tr",id:tr.id}); }catch(e){ fail(e); }
}
async function importDocs(){
  const docs=val("imp").split(/\r?\n/).filter(l=>l.trim()).map(l=>{ const c=l.split("\t"); return {num:cleanCode(c[0]),supNum:cleanCode(c[1]),title:String(c[2]||"").trim(),titleEn:String(c[3]||"").trim(),disc:String(c[4]||"").trim(),planned:parseDate(c[5])}; }).filter(d=>d.num);
  if(!docs.length){ toast(tx("Nessuna riga da importare.","No rows to import.")); return; }
  try{ await op({op:"docImport",docs}); closeDrawer(); }catch(e){ fail(e); }
}
async function importaRegistro(file){
  try{
    const j=JSON.parse(await file.text());
    if(!j.registro) throw new Error(tx("Il file non contiene un registro ShareDocs.","The file does not contain a ShareDocs register."));
    if(j.commessa && j.commessa!==S.c) throw new Error(tx(`Il file è della commessa ${j.commessa}, non di ${S.c}.`,`The file belongs to project ${j.commessa}, not ${S.c}.`));
    await op({op:"registroImport",registro:j.registro}); closeDrawer();
  }catch(e){ fail(e); }
}
async function creaCommessa(){
  const x={id:val("n_id"),nome:val("n_nome"),cartella:val("n_cart")||val("n_nome"),clienti:linee("n_cli")};
  try{
    const r=await api("POST","/commessa",x); toast(r.esito);
    S.me=await api("GET","/me"); S.commesse=S.me.commesse||[];
    await apriCommessa(r.commessa.id); closeDrawer();
  }catch(e){ fail(e); }
}
async function apriCommessa(id){
  S.c=id; try{ localStorage.setItem("sd-commessa",id); }catch(_){}
  S.screen="caricamento"; render();
  try{ await caricaRegistro(); S.screen=""; render(); }
  catch(e){ S.screen="errore"; S.errore=e.message; render(); }
}

/* ---------- Eventi ---------- */
document.addEventListener("click", async e=>{
  const t=e.target.closest("[data-act],[data-tr],[data-go],[data-doc-open],[data-cmt-save],[data-cmt-close],[data-cmt-reopen],[data-lang],[data-view-mode],[data-ctr]"); if(!t) return;
  if(t.dataset.lang){ setLang(t.dataset.lang); return; }
  if(t.dataset.viewMode){ setMode(t.dataset.viewMode); return; }
  if(t.dataset.ctr){ openDrawer({type:"ctr",id:t.dataset.ctr}); return; }
  if(t.dataset.go!==undefined){ const [v,s]=t.dataset.go.split(":"); if(v==="documenti") S.filter={q:"",disc:"",state:s||""}; location.hash=v; return; }
  if(t.dataset.docOpen){ openDrawer({type:"doc",id:t.dataset.docOpen}); return; }
  if(t.dataset.tr && !t.dataset.act){ openDrawer({type:"tr",id:t.dataset.tr}); return; }
  if(t.dataset.cmtSave||t.dataset.cmtClose){ const id=t.dataset.cmtSave||t.dataset.cmtClose, ta=document.getElementById("rep-"+id);
    const reply=(ta?.value||"").trim(); if(t.dataset.cmtClose&&!reply){ toast(tx("Scrivi la risposta prima di chiudere il commento.","Write the reply before closing the comment.")); ta?.focus(); return; }
    try{ if(ta) ta.dataset.fresh="1"; await op({op:"cmtReply",id,reply,close:!!t.dataset.cmtClose}); }catch(err){ fail(err); } return; }
  if(t.dataset.cmtReopen){ try{ await op({op:"cmtReopen",id:t.dataset.cmtReopen}); }catch(err){ fail(err); } return; }
  const a=t.dataset.act, id=t.dataset.id;
  if(a==="close") closeDrawer();
  else if(a==="login") login();
  else if(a==="logout") logout();
  else if(a==="retry") location.reload();
  else if(a==="newTr") openDrawer({type:"newTr",doc:t.dataset.doc});
  else if(a==="editTr") openDrawer({type:"newTr",editId:id});
  else if(a==="newDoc") openDrawer({type:"newDoc"});
  else if(a==="importDocs") openDrawer({type:"import"});
  else if(a==="newCmt") openDrawer({type:"newCmt",doc:t.dataset.doc});
  else if(a==="settings") openDrawer({type:"settings"});
  else if(a==="newCommessa") openDrawer({type:"newCommessa"});
  else if(a==="editDoc"){ S.drawer.edit=true; renderDrawer(); }
  else if(a==="editDocCancel"){ S.drawer.edit=false; renderDrawer(); }
  else if(a==="respond"){ S.drawer.respond=true; renderDrawer(); }
  else if(a==="respondCancel"){ S.drawer.respond=false; renderDrawer(); }
  else if(a==="issueTr"){ const trx=S.trs.find(x=>x.id===id); const miss=(trx?.items||[]).filter(i=>!i.file).map(i=>docById(i.docId)?.num);
    if(miss.length){ toast(tx(`Allega il file prima di emettere: ${miss.join(", ")}. Usa "Modifica".`,`Attach the file before issuing: ${miss.join(", ")}. Use "Edit".`)); return; }
    try{ await op({op:"trIssue",id}); }catch(err){ fail(err); } }
  else if(a==="delTr"){ S.pendingDel=id; renderDrawer(); }
  else if(a==="delTrYes"){ try{ await op({op:"trDelete",id}); closeDrawer(); }catch(err){ fail(err); } }
  else if(a==="delNo"){ S.pendingDel=null; renderDrawer(); }
  else if(a==="dlTr") dlTr(id);
  else if(a==="csv") csvVdrl();
  else if(a==="crs") csvCrs();
  else if(a==="excel"){ t.disabled=true; toast(tx("Aggiornamento di VDRL e CRS in corso…","Updating VDRL and CRS…"));
    try{ const r=await api("POST","/excel"+qc()); toast(r.esito); if(r.vdrl) S.excelUrl=r.vdrl; render(); }catch(err){ fail(err); } finally{ t.disabled=false; } }
  else if(a==="dlFile") dlFile(id);
  else if(a==="viewFile") viewFile(id);
  else if(a==="pdfBack"){ const b=S.drawer&&S.drawer.back; if(b) openDrawer(b); else closeDrawer(); }
  else if(a==="crStart"){ S.drawer.replying=true; renderDrawer(); }
  else if(a==="crCancel"){ S.drawer.replying=false; renderDrawer(); }
});
document.addEventListener("submit", async e=>{
  e.preventDefault(); const f=e.target;
  if(f.id==="trf") return saveTr(e.submitter?.dataset.mode||"draft");
  if(f.id==="rf") return saveResponse(f);
  if(f.id==="crf") return saveClientReply(f);
  if(f.id==="impf") return importDocs();
  if(f.id==="ncf") return creaCommessa();
  if(f.id==="df"){ try{ await op({op:"docAdd",doc:Object.assign({num:cleanCode(val("d_num"))},docData())}); closeDrawer(); }catch(err){ fail(err); } }
  if(f.id==="def"){ try{ await op({op:"docUpdate",id:f.dataset.id,doc:docData()}); S.drawer.edit=false; renderDrawer(); }catch(err){ fail(err); } }
  if(f.id==="cmf"){ const docId=val("c_doc"), rev=cleanCode(val("c_rev"))||docInfo(docById(docId)).rev||"A";
    try{ await op({op:"cmtAdd",docId,rev,ref:val("c_ref"),text:val("c_text")}); closeDrawer(); }catch(err){ fail(err); } }
  if(f.id==="sf"){ try{ await op({op:"cfgSave",project:val("s_proj"),projectName:val("s_pname"),customer:val("s_cust"),endClient:val("s_ec"),attn:val("s_attn"),prefix:val("s_pre"),startSeq:Number(val("s_seq"))||1,dueDays:Number(val("s_due"))||14,clienti:linee("s_cli")}); closeDrawer(); }catch(err){ fail(err); } }
});
document.addEventListener("input", e=>{ if(e.target.id==="fq"){ S.filter.q=e.target.value; render(); } });
document.addEventListener("change", e=>{
  const id=e.target.id;
  if(id==="fstate"){ S.filter.state=e.target.value; render(); }
  if(id==="fdisc"){ S.filter.disc=e.target.value; render(); }
  if(id==="cf"){ S.cfilter=e.target.value; render(); }
  if(id==="selCommessa") apriCommessa(e.target.value);
  if(id==="impJson" && e.target.files[0]) importaRegistro(e.target.files[0]);
});
document.addEventListener("keydown", e=>{ if(e.key==="Escape"&&S.drawer) closeDrawer(); });
function route(){ const h=location.hash.slice(1); S.view=TABS.some(([k])=>k===h)?h:"cruscotto"; render(); window.scrollTo(0,0); }
window.addEventListener("hashchange", route);

/* ---------- Avvio ---------- */
(async()=>{
  const renderBase = render;
  render = function(){ renderBase(); dopoRender(); };
  route();
  try { await initAuth(); }
  catch(e){ S.screen="errore"; S.errore=e.message; render(); return; }
  if(!account){ S.screen="login"; render(); return; }
  S.screen="caricamento"; render();
  try { S.me = await api("GET","/me"); }
  catch(e){ S.screen="errore"; S.errore = e.status===403 ? tx("Il tuo account non ha un ruolo in SICIET ShareDocs. Chiedi a SICIET di abilitarti.","Your account has no role in SICIET ShareDocs. Ask SICIET to enable you.") : e.message; render(); return; }
  S.canWrite = !!S.me.documentController;
  S.canComment = S.me.ruoli.some(r=>r==="DocControl"||r==="Engineer");
  S.realClient = !!S.me.cliente;
  if(S.realClient) S.mode = "client";
  S.commesse = S.me.commesse || [];
  if(!S.commesse.length){ S.screen = S.canWrite ? "nuovaCommessa" : "nessunaCommessa"; render(); return; }
  let salvata = null; try { salvata = localStorage.getItem("sd-commessa"); } catch(_){}
  await apriCommessa(S.commesse.some(c=>c.id===salvata) ? salvata : S.commesse[0].id);
  // Aggiornamento automatico ogni minuto, se nessuno sta compilando un modulo.
  setInterval(()=>{
    if(document.visibilityState!=="visible" || S.screen) return;
    if(S.drawer && (FORM_DRAWERS.includes(S.drawer.type)||S.drawer.respond||S.drawer.replying||S.drawer.edit)) return;
    caricaRegistro().catch(()=>{});
  }, 60000);
})();
