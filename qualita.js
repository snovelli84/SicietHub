/*
 * CONTROLLO QUALITÀ COMPONENTI
 * ----------------------------
 * Per ogni componente di una commessa (JOB) si crea una scheda identificata
 * dal TAG, con foto, note, stato e documenti. Tutto viene salvato nella
 * cartella condivisa di OneDrive/SharePoint indicata in "cartella":
 *
 *   <cartella>/<JOB>/<TAG>/scheda.json         dati della scheda (usati dalla pagina)
 *                          Scheda.txt          gli stessi dati, leggibili dall'ufficio
 *                          Etichetta QR.png    etichetta da stampare
 *                          Foto/2026-10-30 14.32.05 Installazione.jpg
 *                          Documenti/<nome originale del file>
 *
 * L'accesso è con l'account Microsoft 365 aziendale (Microsoft Graph): serve
 * una registrazione dell'app in Microsoft Entra ID, vedi README.
 * Se clientId, tenantId o cartella sono vuoti la pagina funziona in prova:
 * salva tutto solo nel browser di questo dispositivo.
 */
var QUALITA_CONFIG = {
  // ID applicazione (client) e ID directory (tenant) della registrazione in Entra ID.
  clientId: "",
  tenantId: "",
  // Link di condivisione della cartella che contiene le schede
  // (OneDrive o SharePoint → Condividi → Copia collegamento).
  cartella: "",

  // Dati aggiuntivi della scheda, tutti facoltativi.
  campi: [
    { id: "descrizione", nome: "Descrizione componente" },
    { id: "fornitore", nome: "Fornitore" },
    { id: "posizione", nome: "Posizione / area" },
    { id: "ddt", nome: "DDT / ordine" }
  ],
  // tipo: ok (verde), warn (giallo), ko (rosso). Il primo è lo stato iniziale proposto.
  stati: [
    { nome: "Da verificare", tipo: "warn" },
    { nome: "Conforme", tipo: "ok" },
    { nome: "Non conforme", tipo: "ko" }
  ],
  // Fasi delle foto: finiscono nel nome del file. La prima è usata per la
  // foto della targhetta scattata con "Leggi TAG".
  fasi: ["Targhetta", "Ricevimento", "Installazione", "Collaudo", "Non conformità", "Altro"],
  // Le foto vengono ridotte a questo lato massimo (pixel) e qualità JPEG.
  foto: { latoMax: 2560, qualita: 0.85 },
  // Misure dell'etichetta adesiva (mm), per la stampa.
  etichetta: { larghezzaMm: 62, altezzaMm: 40 }
};

(function(){
  "use strict";

  var cfg = QUALITA_CONFIG;
  var configured = !!(cfg.clientId && cfg.tenantId && cfg.cartella);
  var MSAL_URL = "https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js";
  var TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var GRAPH = "https://graph.microsoft.com/v1.0";
  var SCOPES = ["User.Read", "Files.ReadWrite.All"];
  var LAST_JOB_KEY = "siciet-qualita-job";
  var SIMPLE_UPLOAD_MAX = 4000000; // oltre si usa una sessione di caricamento

  var $ = function(id){ return document.getElementById(id); };

  /* ---------- Utilità ---------- */

  function el(tag, props, children){
    var e = document.createElement(tag);
    if(props) Object.keys(props).forEach(function(k){
      if(k === "text") e.textContent = props[k];
      else if(k === "class") e.className = props[k];
      else if(k.indexOf("on") === 0) e.addEventListener(k.slice(2), props[k]);
      else if(props[k] != null) e.setAttribute(k, props[k]);
    });
    (children || []).forEach(function(c){ if(c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  // Nome valido per una cartella di OneDrive/SharePoint: maiuscolo, senza
  // i caratteri vietati (\ / : * ? " < > | # %), senza punti finali.
  function nomeCartella(s){
    return String(s || "").toUpperCase()
      .replace(/[\\\/:*?"<>|#%]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80);
  }
  function nomeFile(s){
    return String(s || "file").replace(/[\\\/:*?"<>|#%]+/g, "_").replace(/^[.\s]+/, "").slice(0, 120) || "file";
  }

  function due(n){ return String(n).padStart(2, "0"); }
  function fmtData(iso){
    var d = new Date(iso);
    if(isNaN(d)) return "";
    return due(d.getDate()) + "/" + due(d.getMonth() + 1) + "/" + d.getFullYear() + " " + due(d.getHours()) + ":" + due(d.getMinutes());
  }
  function timbro(d){
    return d.getFullYear() + "-" + due(d.getMonth() + 1) + "-" + due(d.getDate()) + " " +
      due(d.getHours()) + "." + due(d.getMinutes()) + "." + due(d.getSeconds());
  }
  // "2026-10-30 14.32.05 Installazione.jpg" → { data, fase }
  function leggiNomeFoto(nome){
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2}) (.+?)(?: \d+)?\.[a-z0-9]+$/i.exec(nome);
    if(!m) return { data: null, fase: "Altro" };
    return { data: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), fase: m[7] };
  }

  function percorso(parti){ return parti.filter(Boolean).join("/"); }

  function caricaScript(src){
    caricaScript.p = caricaScript.p || {};
    if(!caricaScript.p[src]) caricaScript.p[src] = new Promise(function(res, rej){
      var s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = function(){ delete caricaScript.p[src]; rej(new Error("Impossibile caricare " + src + ": controlla la connessione.")); };
      document.head.appendChild(s);
    });
    return caricaScript.p[src];
  }

  function mostraErrore(e){
    if(e) console.error(e);
    $("msg").textContent = e ? (e.message || String(e)) : "";
    if(e) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function storage(fn){ try{ return fn(); }catch(e){ return null; } }

  /* ---------- IndexedDB: coda dei file da inviare e archivio della modalità prova ---------- */

  var dbPromise = null;
  function db(){
    if(!dbPromise) dbPromise = new Promise(function(res, rej){
      var r = indexedDB.open("siciet-qualita", 1);
      r.onupgradeneeded = function(){
        r.result.createObjectStore("coda", { keyPath: "id", autoIncrement: true });
        r.result.createObjectStore("prova");
      };
      r.onsuccess = function(){ res(r.result); };
      r.onerror = function(){ rej(r.error); };
    });
    return dbPromise;
  }
  // Esegue fn(store) in una transazione; restituisce il risultato della richiesta fatta da fn.
  function idb(store, mode, fn){
    return db().then(function(d){
      return new Promise(function(res, rej){
        var t = d.transaction(store, mode);
        var req = fn(t.objectStore(store));
        t.oncomplete = function(){ res(req ? req.result : undefined); };
        t.onerror = function(){ rej(t.error); };
        t.onabort = function(){ rej(t.error || new Error("Spazio insufficiente sul dispositivo")); };
      });
    });
  }

  /* ---------- Archivio OneDrive / SharePoint (Microsoft Graph) ---------- */

  function errore(msg, status){ var e = new Error(msg); e.status = status; return e; }

  var Graph = {
    pca: null, account: null, drive: null, root: null,

    init: async function(){
      await caricaScript(MSAL_URL);
      this.pca = new msal.PublicClientApplication({
        auth: {
          clientId: cfg.clientId,
          authority: "https://login.microsoftonline.com/" + cfg.tenantId,
          redirectUri: location.origin + location.pathname
        },
        cache: { cacheLocation: "localStorage" }
      });
      await this.pca.initialize();
      var r = await this.pca.handleRedirectPromise();
      this.account = (r && r.account) || this.pca.getAllAccounts()[0] || null;
    },
    signedIn: function(){ return !!this.account; },
    userName: function(){ return this.account ? (this.account.name || this.account.username) : ""; },
    login: function(){
      return this.pca.loginRedirect({ scopes: SCOPES, redirectStartPage: location.href, prompt: "select_account" });
    },
    logout: function(){
      return this.pca.logoutRedirect({ account: this.account, postLogoutRedirectUri: location.origin + location.pathname });
    },
    token: async function(){
      try{
        return (await this.pca.acquireTokenSilent({ scopes: SCOPES, account: this.account })).accessToken;
      }catch(e){
        if(e instanceof msal.InteractionRequiredAuthError){
          await this.pca.acquireTokenRedirect({ scopes: SCOPES, account: this.account, redirectStartPage: location.href });
        }
        throw e;
      }
    },
    // Chiamata a Graph. 404 → null.
    api: async function(method, url, body, headers){
      var h = Object.assign({ Authorization: "Bearer " + await this.token() }, headers || {});
      if(body && !(body instanceof Blob)){ body = JSON.stringify(body); h["Content-Type"] = "application/json"; }
      var res;
      try{
        res = await fetch(url.indexOf("https://") === 0 ? url : GRAPH + url, { method: method, headers: h, body: body });
      }catch(e){
        throw errore("Connessione assente o instabile: riprova.", 0);
      }
      if(res.status === 404) return null;
      if(!res.ok){
        var info = await res.json().catch(function(){ return {}; });
        var msg = (info.error && info.error.message) || res.statusText;
        if(res.status === 401 || res.status === 403) msg = "Accesso negato alla cartella condivisa (" + msg + "). Chiedi di essere aggiunto alla cartella.";
        throw errore(msg, res.status);
      }
      return res.status === 204 ? null : res.json();
    },
    // La cartella principale si ricava dal link di condivisione.
    apriCartella: async function(){
      if(this.root) return;
      var key = "siciet-qualita-root:" + cfg.cartella;
      var c = storage(function(){ return JSON.parse(sessionStorage.getItem(key)); });
      if(!c){
        var id = "u!" + btoa(unescape(encodeURIComponent(cfg.cartella))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
        var it = await this.api("GET", "/shares/" + id + "/driveItem");
        if(!it) throw errore("Cartella condivisa non trovata: controlla il link in QUALITA_CONFIG.cartella.", 404);
        c = { d: it.parentReference.driveId, r: it.id };
        storage(function(){ sessionStorage.setItem(key, JSON.stringify(c)); });
      }
      this.drive = c.d;
      this.root = c.r;
    },
    url: function(path, suffix){
      var p = path ? ":/" + path.split("/").map(encodeURIComponent).join("/") + ":" : "";
      return "/drives/" + this.drive + "/items/" + this.root + p + (suffix || "");
    },
    list: async function(path){
      await this.apriCartella();
      var out = [], next = this.url(path, "/children?$expand=thumbnails&$top=500");
      while(next){
        var r = await this.api("GET", next);
        if(!r) break;
        r.value.forEach(function(it){
          var th = (it.thumbnails && it.thumbnails[0]) || {};
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
        });
        next = r["@odata.nextLink"];
      }
      return out;
    },
    info: async function(path){
      await this.apriCartella();
      var it = await this.api("GET", this.url(path));
      return it && { etag: it.eTag, url: it["@microsoft.graph.downloadUrl"], webUrl: it.webUrl };
    },
    readJson: async function(path){
      var i = await this.info(path);
      if(!i) return null;
      var res = await fetch(i.url, { cache: "no-store" });
      if(!res.ok) throw errore("Lettura della scheda non riuscita.", res.status);
      return { data: await res.json(), etag: i.etag };
    },
    // opts: { etag (sovrascrive solo se invariato), rename (non sovrascrive file esistenti) }
    put: async function(path, blob, opts){
      opts = opts || {};
      await this.apriCartella();
      if(blob.size <= SIMPLE_UPLOAD_MAX){
        var h = { "Content-Type": blob.type || "application/octet-stream" };
        if(opts.etag) h["If-Match"] = opts.etag;
        return this.api("PUT", this.url(path, "/content" + (opts.rename ? "?@microsoft.graph.conflictBehavior=rename" : "")), blob, h);
      }
      var s = await this.api("POST", this.url(path, "/createUploadSession"), {
        item: { "@microsoft.graph.conflictBehavior": opts.rename ? "rename" : "replace" }
      });
      var CHUNK = 10 * 327680; // multiplo di 320 KiB, come richiesto da Graph
      for(var start = 0; start < blob.size; start += CHUNK){
        var end = Math.min(start + CHUNK, blob.size);
        var res = await fetch(s.uploadUrl, {
          method: "PUT",
          headers: { "Content-Range": "bytes " + start + "-" + (end - 1) + "/" + blob.size },
          body: blob.slice(start, end)
        }).catch(function(){ throw errore("Connessione assente o instabile: riprova.", 0); });
        if(!res.ok) throw errore("Caricamento non riuscito (" + res.status + ").", res.status);
      }
    }
  };

  /* ---------- Archivio della modalità prova (solo su questo dispositivo) ---------- */

  var Prova = {
    init: async function(){},
    signedIn: function(){ return true; },
    userName: function(){ return "Prova"; },
    list: async function(path){
      var prefix = path ? path + "/" : "";
      var all = await idb("prova", "readonly", function(s){ return s.getAll(); });
      var keys = await idb("prova", "readonly", function(s){ return s.getAllKeys(); });
      var seen = {}, out = [];
      keys.forEach(function(k, i){
        if(k.indexOf(prefix) !== 0) return;
        var rest = k.slice(prefix.length), slash = rest.indexOf("/");
        var name = slash < 0 ? rest : rest.slice(0, slash);
        if(seen[name]){ if(all[i].modified > seen[name].modified) seen[name].modified = all[i].modified; return; }
        var f = all[i], url = slash < 0 ? URL.createObjectURL(f.blob) : null;
        seen[name] = { name: name, folder: slash >= 0, size: f.blob.size, modified: f.modified, by: f.by, thumb: url, large: url, url: url };
        out.push(seen[name]);
      });
      return out;
    },
    info: async function(path){
      var f = await idb("prova", "readonly", function(s){ return s.get(path); });
      return f ? { etag: f.modified, url: URL.createObjectURL(f.blob) } : null;
    },
    readJson: async function(path){
      var f = await idb("prova", "readonly", function(s){ return s.get(path); });
      return f ? { data: JSON.parse(await f.blob.text()), etag: f.modified } : null;
    },
    put: async function(path, blob, opts){
      opts = opts || {};
      var old = await idb("prova", "readonly", function(s){ return s.get(path); });
      if(old && opts.etag && old.modified !== opts.etag) throw errore("Modificata da un altro utente", 412);
      if(old && opts.rename){
        var m = /^(.*?)(\.[^.\/]*)?$/.exec(path), n = 1;
        while(await idb("prova", "readonly", function(s){ return s.get(m[1] + " " + n + (m[2] || "")); })) n++;
        path = m[1] + " " + n + (m[2] || "");
      }
      // Copia in memoria: i Blob di <input type=file> non sempre si salvano in IndexedDB su iOS.
      var copy = new Blob([await blob.arrayBuffer()], { type: blob.type });
      await idb("prova", "readwrite", function(s){ return s.put({ blob: copy, modified: new Date().toISOString(), by: "Prova" }, path); });
    }
  };

  var B = configured ? Graph : Prova;

  /* ---------- Schede ---------- */

  function statoInfo(nome){
    return cfg.stati.filter(function(s){ return s.nome === nome; })[0] || { nome: nome || "—", tipo: "warn" };
  }

  function urlScheda(job, tag){
    return location.origin + location.pathname + "?job=" + encodeURIComponent(job) + "&tag=" + encodeURIComponent(tag);
  }

  function testoScheda(s){
    var r = [
      "SCHEDA CONTROLLO QUALITÀ",
      "",
      "JOB:    " + s.job,
      "TAG:    " + s.tag + (s.tagOriginale ? " (scritto come " + s.tagOriginale + ")" : "")
    ];
    cfg.campi.forEach(function(c){ if(s.campi && s.campi[c.id]) r.push(c.nome + ": " + s.campi[c.id]); });
    r.push("Stato:  " + s.stato);
    r.push("Creata il " + fmtData(s.creata.il) + " da " + s.creata.da);
    if(s.aggiornata) r.push("Ultimo aggiornamento " + fmtData(s.aggiornata.il) + " da " + s.aggiornata.da);
    r.push("Scheda online: " + urlScheda(s.job, s.tag));
    r.push("", "NOTE", "");
    if(!s.note.length) r.push("(nessuna)");
    s.note.forEach(function(n){
      r.push(fmtData(n.il) + " – " + n.da + (n.stato ? "  [Stato: " + n.stato + "]" : ""));
      if(n.testo) r.push(n.testo);
      r.push("");
    });
    r.push("Foto nella cartella Foto, documenti nella cartella Documenti.");
    return r.join("\r\n");
  }

  async function scriviScheda(s, etag){
    var json = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    await B.put(percorso([s.job, s.tag, "scheda.json"]), json, { etag: etag });
    var txt = new Blob(["﻿" + testoScheda(s)], { type: "text/plain;charset=utf-8" });
    await B.put(percorso([s.job, s.tag, "Scheda.txt"]), txt);
  }

  // Rilegge la scheda, applica la modifica e salva; se nel frattempo qualcun
  // altro l'ha cambiata (412) riprova sulla versione aggiornata.
  async function aggiornaScheda(job, tag, modifica){
    for(var i = 0; ; i++){
      var r = await B.readJson(percorso([job, tag, "scheda.json"]));
      if(!r) throw errore("Scheda non trovata.", 404);
      modifica(r.data);
      r.data.aggiornata = { il: new Date().toISOString(), da: B.userName() };
      try{
        await scriviScheda(r.data, r.etag);
        return r.data;
      }catch(e){
        if(e.status !== 412 || i >= 2) throw e;
      }
    }
  }

  /* ---------- Coda di invio di foto e documenti ----------
   * Foto e documenti vengono prima salvati sul dispositivo e poi inviati:
   * se in cantiere manca la rete restano in coda e partono appena torna.
   */

  var inviando = false, erroreInvio = "";

  async function accoda(job, tag, cartella, nome, blob){
    // Copia in memoria: alcuni browser non salvano in IndexedDB i file di <input type=file>.
    var copy = new Blob([await blob.arrayBuffer()], { type: blob.type });
    await idb("coda", "readwrite", function(s){
      return s.add({ job: job, tag: tag, cartella: cartella, nome: nome, blob: copy, il: Date.now() });
    });
  }

  async function elementiInCoda(){
    return idb("coda", "readonly", function(s){ return s.getAll(); }).catch(function(){ return []; });
  }

  async function mostraCoda(){
    var n = (await elementiInCoda()).length;
    $("queue").hidden = !n;
    $("queueText").textContent = (n === 1 ? "1 file in attesa di invio" : n + " file in attesa di invio") +
      (erroreInvio ? " (" + erroreInvio + ")" : "");
  }

  async function svuotaCoda(){
    if(inviando || !B.signedIn()) return;
    inviando = true;
    var inviati = false;
    try{
      var items = await elementiInCoda();
      for(var i = 0; i < items.length; i++){
        var it = items[i];
        $("queueText").textContent = "Invio " + (i + 1) + " di " + items.length + "…";
        $("queue").hidden = false;
        await B.put(percorso([it.job, it.tag, it.cartella, it.nome]), it.blob, { rename: true });
        await idb("coda", "readwrite", function(s){ return s.delete(it.id); });
        inviati = true;
      }
      erroreInvio = "";
    }catch(e){
      console.warn("Invio rimandato", e);
      erroreInvio = e.message || String(e);
    }finally{
      inviando = false;
      await mostraCoda();
      if(inviati && stato.vista === "scheda") caricaFileScheda();
    }
  }

  /* ---------- Foto ---------- */

  function caricaImmagine(file){
    return new Promise(function(res, rej){
      var img = new Image();
      img.onload = function(){ res(img); };
      img.onerror = function(){ rej(new Error("Immagine non leggibile")); };
      img.src = URL.createObjectURL(file);
    });
  }
  function canvasBlob(canvas, tipo, q){
    return new Promise(function(res){ canvas.toBlob(res, tipo, q); });
  }

  // Riduce la foto (lato massimo e qualità da configurazione). Se il browser
  // non riesce a leggerla (es. HEIC da PC) la invia così com'è.
  async function comprimi(file){
    var img;
    try{ img = await caricaImmagine(file); }catch(e){ return file; }
    var w = img.naturalWidth, h = img.naturalHeight;
    var k = Math.min(1, cfg.foto.latoMax / Math.max(w, h));
    if(k === 1 && file.type === "image/jpeg" && file.size < 2500000) return file;
    var c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return (await canvasBlob(c, "image/jpeg", cfg.foto.qualita)) || file;
  }

  async function aggiungiFoto(files, fase){
    var s = stato.scheda;
    if(!files.length || !s) return;
    try{
      var base = new Date();
      for(var i = 0; i < files.length; i++){
        var blob = await comprimi(files[i]);
        var nome = timbro(base) + " " + nomeFile(fase) + (files.length > 1 ? " " + (i + 1) : "") + ".jpg";
        await accoda(s.job, s.tag, "Foto", nome, blob);
      }
      await mostraCoda();
      caricaFileScheda();
      svuotaCoda();
    }catch(e){ mostraErrore(e); }
  }

  /* ---------- Lettura del TAG da foto (OCR) ---------- */

  var ocr = { img: null, file: null, sel: null, worker: null, scala: 1 };

  function apriOcr(file){
    caricaImmagine(file).then(function(img){
      ocr.img = img;
      ocr.file = file;
      ocr.sel = null;
      var c = $("ocrCanvas");
      ocr.scala = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * ocr.scala);
      c.height = Math.round(img.naturalHeight * ocr.scala);
      disegnaOcr();
      $("ocrRisultati").textContent = "";
      $("ocrStato").textContent = "";
      $("ocrFase").textContent = cfg.fasi[0];
      $("ocrDlg").hidden = false;
    }).catch(mostraErrore);
  }

  function disegnaOcr(){
    var c = $("ocrCanvas"), g = c.getContext("2d");
    g.drawImage(ocr.img, 0, 0, c.width, c.height);
    var r = ocr.sel;
    if(r && r.w > 4 && r.h > 4){
      g.fillStyle = "rgba(0,0,0,.5)";
      g.fillRect(0, 0, c.width, r.y);
      g.fillRect(0, r.y + r.h, c.width, c.height - r.y - r.h);
      g.fillRect(0, r.y, r.x, r.h);
      g.fillRect(r.x + r.w, r.y, c.width - r.x - r.w, r.h);
      g.strokeStyle = "#ffd400";
      g.lineWidth = Math.max(2, c.width / 300);
      g.strokeRect(r.x, r.y, r.w, r.h);
    }
  }

  (function(){
    var c = $("ocrCanvas"), start = null;
    function pos(ev){
      var b = c.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(c.width, (ev.clientX - b.left) * c.width / b.width)),
        y: Math.max(0, Math.min(c.height, (ev.clientY - b.top) * c.height / b.height))
      };
    }
    c.addEventListener("pointerdown", function(ev){ start = pos(ev); c.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    c.addEventListener("pointermove", function(ev){
      if(!start) return;
      var p = pos(ev);
      ocr.sel = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      disegnaOcr();
    });
    c.addEventListener("pointerup", function(){
      start = null;
      if(ocr.sel && (ocr.sel.w < 10 || ocr.sel.h < 10)){ ocr.sel = null; disegnaOcr(); }
    });
  })();

  // Ritaglio in scala di grigi con contrasto aumentato: Tesseract legge meglio.
  function ritaglioOcr(){
    var img = ocr.img, k = 1 / ocr.scala;
    var r = ocr.sel ? { x: ocr.sel.x * k, y: ocr.sel.y * k, w: ocr.sel.w * k, h: ocr.sel.h * k }
                    : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    var z = Math.min(3, 1800 / r.w, 1800 / r.h);
    if(z > 1 && r.w * z < 600) z = Math.min(3, 600 / r.w);
    var c = document.createElement("canvas");
    c.width = Math.round(r.w * z);
    c.height = Math.round(r.h * z);
    var g = c.getContext("2d");
    g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data, min = 255, max = 0, i, v;
    for(i = 0; i < p.length; i += 4){
      v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      p[i] = v;
      if(v < min) min = v;
      if(v > max) max = v;
    }
    var span = Math.max(1, max - min);
    for(i = 0; i < p.length; i += 4){
      v = (p[i] - min) * 255 / span;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  // Righe lette → possibili TAG, prima quelle con lettere e numeri.
  function candidatiTag(testo){
    var seen = {}, out = [];
    testo.split(/\n+/).forEach(function(riga){
      var t = riga.toUpperCase().replace(/\s+/g, " ").replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "").trim();
      [t, t.replace(/ /g, "")].forEach(function(x){
        if(x.length >= 2 && x.length <= 40 && !seen[x]){ seen[x] = 1; out.push(x); }
      });
    });
    function punti(x){ return (/[A-Z]/.test(x) && /\d/.test(x) ? 2 : 0) + (/[-\/.]/.test(x) ? 1 : 0) - (x.indexOf(" ") >= 0 ? 1 : 0); }
    return out.sort(function(a, b){ return punti(b) - punti(a); }).slice(0, 8);
  }

  async function leggiTesto(){
    var btn = $("ocrLeggi");
    btn.disabled = true;
    $("ocrRisultati").textContent = "";
    try{
      if(!ocr.worker){
        $("ocrStato").textContent = "Preparazione della lettura (solo la prima volta può richiedere qualche secondo)…";
        await caricaScript(TESSERACT_URL);
        ocr.worker = await Tesseract.createWorker("eng");
        await ocr.worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/. ",
          preserve_interword_spaces: "1"
        });
      }
      $("ocrStato").textContent = "Lettura in corso…";
      var r = await ocr.worker.recognize(ritaglioOcr());
      var cand = candidatiTag(r.data.text || "");
      $("ocrStato").textContent = cand.length
        ? "Tocca il TAG corretto (potrai comunque correggerlo):"
        : "Nessun testo riconosciuto. Prova a riquadrare solo il TAG, con più luce, oppure scrivilo a mano.";
      cand.forEach(function(x){
        $("ocrRisultati").appendChild(el("button", { type: "button", class: "btn small", text: x, onclick: function(){ scegliTag(x); } }));
      });
    }catch(e){
      $("ocrStato").textContent = "Lettura non riuscita: " + (e.message || e);
    }finally{
      btn.disabled = false;
    }
  }

  function scegliTag(x){
    $("tag").value = x;
    $("tag").classList.remove("invalid");
    stato.fotoTarghetta = $("ocrAllega").checked ? ocr.file : null;
    $("ocrHint").textContent = stato.fotoTarghetta
      ? "TAG letto dalla foto: controllalo. La foto della targhetta verrà allegata alla scheda."
      : "TAG letto dalla foto: controllalo.";
    $("ocrDlg").hidden = true;
    $("tag").focus();
  }

  $("ocrBtn").addEventListener("click", function(){ $("ocrInput").click(); });
  $("ocrAltra").addEventListener("click", function(){ $("ocrInput").click(); });
  $("ocrInput").addEventListener("change", function(){
    var f = this.files[0];
    this.value = "";
    if(f) apriOcr(f);
  });
  $("ocrLeggi").addEventListener("click", leggiTesto);
  $("ocrAnnulla").addEventListener("click", function(){ $("ocrDlg").hidden = true; });

  /* ---------- Etichetta QR ---------- */

  // Disegna l'etichetta (QR a sinistra, JOB e TAG a destra) a 300 dpi.
  function disegnaEtichetta(job, tag){
    var mm = 300 / 25.4;
    var W = Math.round(cfg.etichetta.larghezzaMm * mm), H = Math.round(cfg.etichetta.altezzaMm * mm);
    var c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    var g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);

    var qr = qrcode(0, "M");
    qr.addData(urlScheda(job, tag));
    qr.make();
    var n = qr.getModuleCount(), pad = Math.round(2.5 * mm);
    var size = H - 2 * pad, cell = Math.floor(size / n), q = cell * n, ox = pad, oy = Math.round((H - q) / 2);
    g.fillStyle = "#000";
    for(var r = 0; r < n; r++) for(var col = 0; col < n; col++){
      if(qr.isDark(r, col)) g.fillRect(ox + col * cell, oy + r * cell, cell, cell);
    }

    var x = ox + q + Math.round(2.5 * mm), maxW = W - x - pad;
    var font = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
    function testo(t, px, peso, y, colore){
      var s = px;
      g.font = peso + " " + s + "px " + font;
      while(s > 10 && g.measureText(t).width > maxW){ s -= 2; g.font = peso + " " + s + "px " + font; }
      g.fillStyle = colore || "#000";
      g.fillText(t, x, y);
      return s;
    }
    g.textBaseline = "top";
    var y = pad;
    testo("SICIET · CONTROLLO QUALITÀ", Math.round(2.4 * mm), "600", y, "#005baa");
    y += Math.round(5 * mm);
    testo("JOB", Math.round(2.2 * mm), "400", y, "#555");
    y += Math.round(2.8 * mm);
    y += testo(job, Math.round(4.2 * mm), "700", y) + Math.round(1.5 * mm);
    testo("TAG", Math.round(2.2 * mm), "400", y, "#555");
    y += Math.round(2.8 * mm);
    testo(tag, Math.round(6 * mm), "700", y);
    g.textBaseline = "bottom";
    testo("Scansiona per foto e documenti", Math.round(2 * mm), "400", H - pad, "#555");
    return c;
  }

  function apriEtichetta(){
    var s = stato.scheda;
    var url = disegnaEtichetta(s.job, s.tag).toDataURL("image/png");
    $("etichettaImg").src = url;
    $("etichettaUrl").textContent = urlScheda(s.job, s.tag);
    $("etichettaScarica").href = url;
    $("etichettaScarica").download = "Etichetta " + nomeFile(s.job + " " + s.tag) + ".png";
    $("etichettaDlg").hidden = false;
  }

  function stampaEtichetta(){
    var a = $("printArea");
    a.textContent = "";
    a.style.width = cfg.etichetta.larghezzaMm + "mm";
    a.style.height = cfg.etichetta.altezzaMm + "mm";
    a.appendChild(el("img", { src: $("etichettaImg").src, alt: "" }));
    var st = $("pageSize") || document.head.appendChild(el("style", { id: "pageSize" }));
    st.textContent = "@page{size:" + cfg.etichetta.larghezzaMm + "mm " + cfg.etichetta.altezzaMm + "mm;margin:0}";
    window.print();
  }

  $("etichettaBtn").addEventListener("click", apriEtichetta);
  $("etichettaStampa").addEventListener("click", stampaEtichetta);
  $("etichettaChiudi").addEventListener("click", function(){ $("etichettaDlg").hidden = true; });

  /* ---------- Navigazione ---------- */

  var stato = { vista: null, job: null, tag: null, scheda: null, fotoTarghetta: null };

  function vai(query){
    history.pushState(null, "", location.pathname + query);
    mostra();
  }
  // Link interni: aprono la vista senza ricaricare la pagina.
  function link(query, testo, cls){
    return el("a", { href: location.pathname + query, class: cls, text: testo, onclick: function(ev){
      if(ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      ev.preventDefault();
      vai(query);
    } });
  }
  document.addEventListener("click", function(ev){
    var a = ev.target.closest && ev.target.closest("a[data-vai]");
    if(!a || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    ev.preventDefault();
    vai(a.getAttribute("href"));
  });
  window.addEventListener("popstate", mostra);

  function soloVista(id){
    ["viewLogin", "viewElenco", "viewNuovo", "viewScheda"].forEach(function(v){ $(v).hidden = v !== id; });
  }

  function mostra(){
    var q = new URLSearchParams(location.search);
    var job = q.get("job"), tag = q.get("tag");
    mostraErrore(null);
    $("ocrDlg").hidden = $("etichettaDlg").hidden = $("lightbox").hidden = true;

    if(!B.signedIn()){
      stato.vista = "login";
      $("loginText").textContent = job && tag
        ? "Per vedere la scheda del TAG " + tag + " (JOB " + job + ") accedi con il tuo account Microsoft aziendale."
        : "Per vedere e aggiungere schede accedi con il tuo account Microsoft aziendale.";
      soloVista("viewLogin");
      return;
    }
    if(q.has("nuovo")) return mostraNuovo(job);
    if(job && tag) return mostraScheda(job, tag);
    return mostraElenco(job);
  }

  /* ---------- Elenco JOB / TAG ---------- */

  var elencoVoci = [];

  async function mostraElenco(job){
    stato.vista = "elenco";
    stato.job = job;
    soloVista("viewElenco");
    var cr = $("elencoCrumbs");
    cr.textContent = "";
    if(job){
      cr.appendChild(link("?", "Tutti i JOB"));
      cr.appendChild(document.createTextNode(" › JOB " + job));
    }else{
      cr.appendChild(document.createTextNode("Tutti i JOB"));
    }
    $("nuovoBtn").href = "?nuovo" + (job ? "&job=" + encodeURIComponent(job) : "");
    $("nuovoBtn").setAttribute("data-vai", "");
    $("filtroLabel").textContent = job ? "Cerca un TAG nel JOB " + job : "Cerca un JOB";
    $("filtro").value = "";
    $("elenco").textContent = "";
    $("elencoVuoto").hidden = false;
    $("elencoVuoto").textContent = "Caricamento…";
    try{
      var voci = (await B.list(job || "")).filter(function(v){ return v.folder; });
      if(stato.vista !== "elenco" || stato.job !== job) return;
      elencoVoci = voci.sort(function(a, b){ return a.name.localeCompare(b.name, "it", { numeric: true }); });
      disegnaElenco();
    }catch(e){
      $("elencoVuoto").textContent = "";
      mostraErrore(e);
    }
  }

  function disegnaElenco(){
    var f = nomeCartella($("filtro").value), job = stato.job, ul = $("elenco");
    ul.textContent = "";
    var voci = elencoVoci.filter(function(v){ return !f || v.name.indexOf(f) >= 0; });
    voci.forEach(function(v){
      var q = job ? "?job=" + encodeURIComponent(job) + "&tag=" + encodeURIComponent(v.name) : "?job=" + encodeURIComponent(v.name);
      var a = link(q, "");
      a.appendChild(el("span", { class: "name", text: (job ? "" : "JOB ") + v.name }));
      a.appendChild(el("span", { class: "meta", text: v.modified ? fmtData(v.modified).slice(0, 10) : "" }));
      ul.appendChild(el("li", null, [a]));
    });
    $("elencoVuoto").hidden = voci.length > 0;
    $("elencoVuoto").textContent = elencoVoci.length
      ? "Nessun risultato."
      : (job ? "Nessun componente in questo JOB." : "Nessun JOB: crea la prima scheda con \"Nuovo componente\".");
  }
  $("filtro").addEventListener("input", disegnaElenco);

  /* ---------- Nuova scheda ---------- */

  function campiForm(contenitore, prefisso, valori){
    contenitore.textContent = "";
    cfg.campi.forEach(function(c){
      var id = prefisso + c.id;
      contenitore.appendChild(el("div", { class: "field" }, [
        el("label", { for: id, text: c.nome }),
        el("input", { type: "text", id: id, maxlength: "200", value: (valori && valori[c.id]) || "" })
      ]));
    });
  }
  function leggiCampi(prefisso){
    var o = {};
    cfg.campi.forEach(function(c){ var v = $(prefisso + c.id).value.trim(); if(v) o[c.id] = v; });
    return o;
  }
  function sceltaStati(contenitore, nome, attuale){
    contenitore.textContent = "";
    cfg.stati.forEach(function(s){
      contenitore.appendChild(el("label", { class: "choice" }, [
        el("input", { type: "radio", name: nome, value: s.nome }),
        el("span", { text: s.nome })
      ]));
    });
    var r = contenitore.querySelector("input[value=\"" + (attuale || cfg.stati[0].nome).replace(/"/g, "") + "\"]");
    if(r) r.checked = true;
  }
  function valoreScelto(contenitore){
    var r = contenitore.querySelector("input:checked");
    return r ? r.value : "";
  }

  function mostraNuovo(job){
    stato.vista = "nuovo";
    stato.fotoTarghetta = null;
    soloVista("viewNuovo");
    $("nuovoForm").reset();
    $("nuovoErr").textContent = "";
    $("job").value = job || storage(function(){ return localStorage.getItem(LAST_JOB_KEY); }) || "";
    $("tag").value = "";
    $("ocrHint").textContent = "Con \"📷 Leggi\" scatti una foto della targhetta e il TAG viene letto in automatico (controllalo sempre).";
    campiForm($("campiNuovo"), "n-");
    sceltaStati($("statiNuovo"), "statoNuovo");
    (job || $("job").value ? $("tag") : $("job")).focus();
    // Suggerimenti per il campo JOB.
    B.list("").then(function(v){
      var dl = $("jobList");
      dl.textContent = "";
      v.filter(function(x){ return x.folder; }).forEach(function(x){ dl.appendChild(el("option", { value: x.name })); });
    }).catch(function(){});
  }

  $("nuovoForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var job = nomeCartella($("job").value), tag = nomeCartella($("tag").value), err = $("nuovoErr");
    $("job").classList.toggle("invalid", !job);
    $("tag").classList.toggle("invalid", !tag);
    if(!job || !tag){ err.textContent = "Indica JOB e TAG."; return; }
    err.textContent = "";
    var btn = $("nuovoSubmit");
    btn.disabled = true;
    btn.textContent = "Creazione…";
    try{
      if(await B.readJson(percorso([job, tag, "scheda.json"]))){
        err.textContent = "Esiste già una scheda per il TAG " + tag + " nel JOB " + job + ": la apro, puoi aggiungere foto e note.";
        setTimeout(function(){ vai("?job=" + encodeURIComponent(job) + "&tag=" + encodeURIComponent(tag)); }, 1800);
        return;
      }
      var adesso = new Date().toISOString(), chi = B.userName();
      var tagScritto = $("tag").value.trim(), statoIniz = valoreScelto($("statiNuovo")), nota = $("notaNuovo").value.trim();
      var s = {
        versione: 1,
        job: job,
        tag: tag,
        campi: leggiCampi("n-"),
        stato: statoIniz,
        creata: { il: adesso, da: chi },
        note: [{ il: adesso, da: chi, stato: statoIniz, testo: nota || "Scheda creata." }]
      };
      if(tagScritto.toUpperCase() !== tag) s.tagOriginale = tagScritto;
      await scriviScheda(s);
      storage(function(){ localStorage.setItem(LAST_JOB_KEY, job); });

      var etichetta = await canvasBlob(disegnaEtichetta(job, tag), "image/png");
      await accoda(job, tag, "", "Etichetta QR.png", etichetta);
      if(stato.fotoTarghetta){
        await accoda(job, tag, "Foto", timbro(new Date()) + " " + nomeFile(cfg.fasi[0]) + ".jpg", await comprimi(stato.fotoTarghetta));
        stato.fotoTarghetta = null;
      }
      vai("?job=" + encodeURIComponent(job) + "&tag=" + encodeURIComponent(tag));
      svuotaCoda();
    }catch(e){
      err.textContent = e.message || String(e);
    }finally{
      btn.disabled = false;
      btn.textContent = "Crea scheda";
    }
  });

  /* ---------- Scheda ---------- */

  async function mostraScheda(job, tag){
    stato.vista = "scheda";
    stato.job = job;
    stato.tag = tag;
    stato.scheda = null;
    soloVista("viewScheda");
    var cr = $("schedaCrumbs");
    cr.textContent = "";
    cr.appendChild(link("?", "Tutti i JOB"));
    cr.appendChild(document.createTextNode(" › "));
    cr.appendChild(link("?job=" + encodeURIComponent(job), "JOB " + job));
    $("schedaTag").textContent = tag;
    $("schedaStato").textContent = "";
    $("schedaStato").className = "badge";
    $("schedaDati").textContent = "";
    $("note").textContent = "";
    $("galleria").textContent = "";
    $("documenti").textContent = "";
    $("modificaForm").hidden = true;
    $("cartellaBtn").hidden = true;
    disegnaFasi();
    sceltaStati($("statiNota"), "statoNota");
    try{
      var r = await B.readJson(percorso([job, tag, "scheda.json"]));
      if(stato.vista !== "scheda" || stato.tag !== tag || stato.job !== job) return;
      if(!r){
        mostraErrore(new Error("Nessuna scheda per il TAG " + tag + " nel JOB " + job + "."));
        return;
      }
      stato.scheda = r.data;
      disegnaScheda();
      caricaFileScheda();
      if(B.info) B.info(percorso([job, tag])).then(function(i){
        if(i && i.webUrl && stato.tag === tag){ $("cartellaBtn").href = i.webUrl; $("cartellaBtn").hidden = false; }
      }).catch(function(){});
    }catch(e){ mostraErrore(e); }
  }

  function disegnaScheda(){
    var s = stato.scheda, si = statoInfo(s.stato);
    $("schedaStato").textContent = si.nome;
    $("schedaStato").className = "badge " + si.tipo;
    var dl = $("schedaDati");
    dl.textContent = "";
    function riga(k, v){ if(v){ dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: v })); } }
    riga("JOB", s.job);
    riga("TAG scritto come", s.tagOriginale);
    cfg.campi.forEach(function(c){ riga(c.nome, s.campi && s.campi[c.id]); });
    riga("Creata", fmtData(s.creata.il) + " – " + s.creata.da);
    if(s.aggiornata) riga("Aggiornata", fmtData(s.aggiornata.il) + " – " + s.aggiornata.da);

    var ul = $("note");
    ul.textContent = "";
    s.note.slice().reverse().forEach(function(n){
      var li = el("li", null, [el("span", { class: "who", text: fmtData(n.il) + " – " + n.da })]);
      if(n.stato) li.appendChild(el("span", null, [el("span", { class: "badge " + statoInfo(n.stato).tipo, text: n.stato })]));
      if(n.testo) li.appendChild(el("span", { class: "txt", text: n.testo }));
      ul.appendChild(li);
    });
    sceltaStati($("statiNota"), "statoNota", s.stato);
  }

  function disegnaFasi(){
    var box = $("fasi"), attuale = valoreScelto(box) || cfg.fasi[1] || cfg.fasi[0];
    box.textContent = "";
    cfg.fasi.forEach(function(f){
      box.appendChild(el("label", { class: "choice" }, [
        el("input", { type: "radio", name: "fase", value: f }),
        el("span", { text: f })
      ]));
    });
    box.querySelector("input[value=\"" + attuale.replace(/"/g, "") + "\"]").checked = true;
  }

  async function caricaFileScheda(){
    var s = stato.scheda;
    if(!s) return;
    var job = s.job, tag = s.tag;
    try{
      var res = await Promise.all([
        B.list(percorso([job, tag, "Foto"])),
        B.list(percorso([job, tag, "Documenti"])),
        elementiInCoda()
      ]);
      if(!stato.scheda || stato.scheda.tag !== tag || stato.scheda.job !== job) return;
      var coda = res[2].filter(function(c){ return c.job === job && c.tag === tag; });
      disegnaGalleria(res[0].filter(function(f){ return !f.folder; }), coda.filter(function(c){ return c.cartella === "Foto"; }));
      disegnaDocumenti(res[1].filter(function(f){ return !f.folder; }), coda.filter(function(c){ return c.cartella === "Documenti"; }));
    }catch(e){ mostraErrore(e); }
  }

  function disegnaGalleria(foto, inCoda){
    var box = $("galleria"), gruppi = {};
    box.textContent = "";
    foto.forEach(function(f){
      var i = leggiNomeFoto(f.name);
      (gruppi[i.fase] = gruppi[i.fase] || []).push({ f: f, data: i.data || new Date(f.modified) });
    });
    inCoda.forEach(function(c){
      var i = leggiNomeFoto(c.nome);
      (gruppi[i.fase] = gruppi[i.fase] || []).push({ coda: c, data: i.data || new Date(c.il) });
    });
    var ordine = cfg.fasi.concat(Object.keys(gruppi).filter(function(k){ return cfg.fasi.indexOf(k) < 0; }));
    ordine.forEach(function(fase){
      var g = gruppi[fase];
      if(!g) return;
      g.sort(function(a, b){ return a.data - b.data; });
      var grid = el("div", { class: "gallery" });
      g.forEach(function(x){
        var when = fmtData(x.data);
        if(x.coda){
          var u = URL.createObjectURL(x.coda.blob);
          grid.appendChild(el("button", { type: "button", class: "thumb pending", onclick: function(){ apriFoto(u, u, when + " (in attesa di invio)"); } }, [
            el("img", { src: u, alt: fase + " " + when, loading: "lazy" })
          ]));
          return;
        }
        var f = x.f;
        grid.appendChild(el("button", { type: "button", class: "thumb", onclick: function(){ apriFoto(f.large || f.url, f.webUrl || f.url, when + (f.by ? " – " + f.by : "")); } }, [
          f.thumb ? el("img", { src: f.thumb, alt: fase + " " + when, loading: "lazy" }) : el("span", { class: "when", text: f.name }),
          el("span", { class: "when", text: when.slice(0, 10) })
        ]));
      });
      box.appendChild(el("div", { class: "gallery-group" }, [el("h4", { text: fase + " (" + g.length + ")" }), grid]));
    });
    if(!box.childNodes.length) box.appendChild(el("p", { class: "empty", text: "Nessuna foto. Scegli la fase e scatta le foto che attestano lo stato del componente." }));
  }

  function disegnaDocumenti(docs, inCoda){
    var ul = $("documenti");
    ul.textContent = "";
    docs.sort(function(a, b){ return a.name.localeCompare(b.name, "it"); }).forEach(function(d){
      ul.appendChild(el("li", null, [
        el("a", { href: d.webUrl || d.url, target: "_blank", rel: "noopener", text: d.name }),
        el("span", { class: "hint", text: " – " + fmtData(d.modified) + (d.by ? ", " + d.by : "") })
      ]));
    });
    inCoda.forEach(function(c){
      ul.appendChild(el("li", { class: "hint", text: c.nome + " – in attesa di invio" }));
    });
    if(!ul.childNodes.length) ul.appendChild(el("li", { class: "empty", text: "Nessun documento (es. DDT, certificati, schede tecniche, verbali)." }));
  }

  function apriFoto(src, originale, testo){
    $("lightboxImg").src = src;
    $("lightboxApri").href = originale;
    $("lightboxText").textContent = testo;
    $("lightbox").hidden = false;
  }
  $("lightboxChiudi").addEventListener("click", function(){ $("lightbox").hidden = true; $("lightboxImg").removeAttribute("src"); });
  $("lightbox").addEventListener("click", function(ev){ if(ev.target === this) $("lightboxChiudi").click(); });

  $("fotoCamera").addEventListener("click", function(){ $("fotoCameraInput").click(); });
  $("fotoGalleria").addEventListener("click", function(){ $("fotoGalleriaInput").click(); });
  ["fotoCameraInput", "fotoGalleriaInput"].forEach(function(id){
    $(id).addEventListener("change", function(){
      var files = Array.prototype.slice.call(this.files);
      this.value = "";
      aggiungiFoto(files, valoreScelto($("fasi")));
    });
  });

  $("docBtn").addEventListener("click", function(){ $("docInput").click(); });
  $("docInput").addEventListener("change", async function(){
    var files = Array.prototype.slice.call(this.files), s = stato.scheda;
    this.value = "";
    if(!s) return;
    try{
      for(var i = 0; i < files.length; i++) await accoda(s.job, s.tag, "Documenti", nomeFile(files[i].name), files[i]);
      await mostraCoda();
      caricaFileScheda();
      svuotaCoda();
    }catch(e){ mostraErrore(e); }
  });

  $("notaForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var s = stato.scheda, testo = $("notaTesto").value.trim(), nuovo = valoreScelto($("statiNota"));
    if(!s) return;
    var cambio = nuovo && nuovo !== s.stato;
    if(!testo && !cambio){ $("notaTesto").focus(); return; }
    var btn = $("notaSubmit");
    btn.disabled = true;
    try{
      stato.scheda = await aggiornaScheda(s.job, s.tag, function(d){
        var n = { il: new Date().toISOString(), da: B.userName() };
        if(nuovo && nuovo !== d.stato){ n.stato = nuovo; d.stato = nuovo; }
        if(testo) n.testo = testo;
        d.note.push(n);
      });
      $("notaTesto").value = "";
      disegnaScheda();
    }catch(e){ mostraErrore(e); }
    finally{ btn.disabled = false; }
  });

  $("modificaBtn").addEventListener("click", function(){
    campiForm($("campiModifica"), "m-", stato.scheda && stato.scheda.campi);
    $("modificaForm").hidden = false;
  });
  $("modificaAnnulla").addEventListener("click", function(){ $("modificaForm").hidden = true; });
  $("modificaForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var s = stato.scheda, campi = leggiCampi("m-");
    if(!s) return;
    try{
      stato.scheda = await aggiornaScheda(s.job, s.tag, function(d){ d.campi = campi; });
      $("modificaForm").hidden = true;
      disegnaScheda();
    }catch(e){ mostraErrore(e); }
  });

  /* ---------- Avvio ---------- */

  $("queueRetry").addEventListener("click", svuotaCoda);
  $("login").addEventListener("click", function(){ B.login().catch(mostraErrore); });
  $("logout").addEventListener("click", function(){ B.logout().catch(mostraErrore); });
  window.addEventListener("online", svuotaCoda);
  setInterval(svuotaCoda, 60000);

  (async function(){
    $("demo").hidden = configured;
    try{
      await B.init();
    }catch(e){
      mostraErrore(e);
      return;
    }
    if(configured && B.signedIn()){
      $("userName").textContent = B.userName();
      $("user").hidden = false;
    }
    mostra();
    await mostraCoda();
    svuotaCoda();
  })();
})();
