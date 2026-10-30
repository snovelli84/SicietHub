/*
 * SICIET QUALITY – CONTROLLO QUALITÀ COMPONENTI
 * ----------------------------------------------
 * Per ogni componente di una commessa (JOB) si crea una scheda identificata
 * dal TAG, con foto, note, stato e documenti. Tutto viene salvato nella
 * cartella "Schede componenti" del sito SharePoint "SICIET Qualità":
 *
 *   <COMMESSA>/<JOB>/<TAG>/scheda.json      dati della scheda (usati dalla pagina)
 *                          Scheda.txt          gli stessi dati, leggibili dall'ufficio
 *                          Etichetta QR.png    etichetta da stampare
 *                          Foto/2026-10-30 14.32.05 Installazione - Mario Rossi.jpg
 *                          Documenti/<nome originale del file>
 *
 * Chi usa la pagina non accede a Microsoft 365: inserisce una volta il
 * proprio nome. A leggere e scrivere su SharePoint è il servizio in
 * quality/api (indirizzo in "api"), con le credenziali dell'azienda; vedi
 * quality/README.md. Se nel servizio è impostato un PIN, la pagina lo chiede
 * una volta per dispositivo.
 * Se "api" è vuoto la pagina funziona in prova: salva tutto solo nel
 * browser di questo dispositivo.
 */
var QUALITA_CONFIG = {
  // Indirizzo del servizio quality/api, es. "https://siciet-quality.azurewebsites.net/api".
  api: "https://siciet-quality.amministrazione-c44.workers.dev/api",

  // Chiede il nome di chi usa l'app (memorizzato sul dispositivo): finisce
  // nelle note e nei nomi delle foto.
  chiediOperatore: true,

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
  fasi: ["Targhetta", "Ricevimento", "Installazione", "Collaudo", "Non conformità", "Risoluzione", "Altro"],
  // Le foto vengono ridotte a questo lato massimo (pixel) e qualità JPEG.
  foto: { latoMax: 2560, qualita: 0.85 },
  // Etichetta per stampanti a nastro Brother con nastro TZe da 24 mm: l'area
  // stampabile è alta 18 mm, a 180 punti per pollice, in un solo colore.
  // La lunghezza si adatta al TAG (al massimo lunghezzaMaxMm).
  etichetta: { altezzaMm: 18, dpi: 180, lunghezzaMaxMm: 110 }
};

(function(){
  "use strict";

  var cfg = QUALITA_CONFIG;
  var configured = !!cfg.api;
  var TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var LAST_JOB_KEY = "siciet-qualita-job";
  var COMMESSA_KEY = "siciet-qualita-commessa";
  var OPERATORE_KEY = "siciet-qualita-operatore";
  var PIN_KEY = "siciet-qualita-pin";
  var PIN_SERVE_KEY = "siciet-qualita-pin-richiesto";
  var QR_KEY = "siciet-qualita-qr";            // sessione aperta da un QR
  var ACCESSO_KEY = "siciet-qualita-accesso";  // scadenze delle password dei tecnici
  var ORE_ACCESSO = 12;
  // Indirizzo dell'app senza "index.html", scritto nei QR code.
  var BASE_URL = location.origin + location.pathname.replace(/index\.html$/, "");

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
  // "2026-10-30 14.32.05 Installazione 2 - Mario Rossi.jpg" → { data, fase, operatore }
  function leggiNomeFoto(nome){
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2}) (.+?)(?: \d+)?(?: - (.+?))?\.[a-z0-9]+$/i.exec(nome);
    if(!m) return { data: null, fase: "Altro" };
    return { data: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), fase: m[7], operatore: m[8] };
  }

  function percorso(parti){ return parti.filter(Boolean).join("/"); }
  // Cartella di una scheda: <COMMESSA>/<JOB>/<TAG>.
  function cartellaScheda(s){ return percorso([s.commessa, s.job, s.tag]); }
  // Indirizzo (parte dopo "?") di commessa, JOB e TAG.
  function qs(c, job, tag, extra){
    var p = extra ? [extra] : [];
    if(c) p.push("c=" + encodeURIComponent(c));
    if(job) p.push("job=" + encodeURIComponent(job));
    if(tag) p.push("tag=" + encodeURIComponent(tag));
    return "?" + p.join("&");
  }

  function operatore(){ return storage(function(){ return localStorage.getItem(OPERATORE_KEY); }) || ""; }
  // Chi ha fatto la modifica: l'operatore indicato sul dispositivo.
  function autore(){ return (cfg.chiediOperatore && operatore()) || "Operatore"; }

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

  // Avviso di conferma in basso, per qualche secondo.
  function conferma(testo){
    var t = $("toast");
    t.textContent = "✓ " + testo;
    t.hidden = false;
    t.classList.remove("via");
    clearTimeout(conferma.timer);
    conferma.timer = setTimeout(function(){ t.classList.add("via"); setTimeout(function(){ t.hidden = true; }, 400); }, 5000);
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

  /* ---------- Archivio SharePoint, tramite il servizio quality/api ---------- */

  function errore(msg, status){ var e = new Error(msg); e.status = status; return e; }

  var Server = {
    init: async function(){},
    pin: function(){ return storage(function(){ return localStorage.getItem(PIN_KEY); }) || ""; },
    // Il PIN si chiede solo se il servizio ha risposto che serve (401).
    signedIn: function(){ return !!this.pin() || !storage(function(){ return localStorage.getItem(PIN_SERVE_KEY); }); },
    // Chiamata al servizio. 404 → null; PIN mancante o sbagliato → richiesta del PIN.
    api: async function(method, azione, path, opts){
      opts = opts || {};
      var h = { "X-Pin": opts.pin || this.pin() };
      if(opts.etag) h["If-Match"] = opts.etag;
      if(opts.password !== undefined) h["X-Password"] = opts.password;
      if(opts.body) h["Content-Type"] = opts.body.type || "application/octet-stream";
      var q = "?path=" + encodeURIComponent(path || "") + (opts.rename ? "&rename=1" : "") + (opts.query || "");
      var res;
      try{
        res = await fetch(cfg.api.replace(/\/$/, "") + "/" + azione + q, { method: method, headers: h, body: opts.body, cache: "no-store" });
      }catch(e){
        throw errore("Connessione assente o instabile: riprova.", 0);
      }
      if(res.status === 404) return null;
      var info = await res.json().catch(function(){ return {}; });
      if(res.status === 401 && !opts.pin){
        storage(function(){ localStorage.removeItem(PIN_KEY); localStorage.setItem(PIN_SERVE_KEY, "1"); });
        setTimeout(mostra, 0);
      }
      if(!res.ok) throw errore(info.errore || "Errore del servizio (" + res.status + ").", res.status);
      return info;
    },
    // Verifica il PIN; se è giusto lo memorizza sul dispositivo.
    entra: async function(pin){
      await this.api("GET", "ping", "", { pin: pin });
      storage(function(){ localStorage.setItem(PIN_KEY, pin); });
    },
    list: async function(path){ return (await this.api("GET", "list", path)) || []; },
    // Password dei tecnici (accesso dal QR). { protetto: false } se non impostata.
    verifica: function(livello, password){
      return this.api("GET", "verifica", "", { query: "&livello=" + livello, password: password || "" });
    },
    // Elenco sintetico di tutte le schede (dall'indice del servizio), per la ricerca.
    schede: async function(){ return (await this.api("GET", "schede", "")) || []; },
    info: function(path){ return this.api("GET", "item", path); },
    readJson: function(path){ return this.api("GET", "json", path); },
    // opts: { etag (sovrascrive solo se invariato), rename (non sovrascrive file esistenti) }
    put: function(path, blob, opts){
      opts = opts || {};
      return this.api("PUT", "file", path, { body: blob, etag: opts.etag, rename: opts.rename });
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
        var f = all[i], b = datoBlob(f), url = slash < 0 ? URL.createObjectURL(b) : null;
        seen[name] = { name: name, folder: slash >= 0, size: b.size, modified: f.modified, by: f.by, thumb: url, large: url, url: url };
        out.push(seen[name]);
      });
      return out;
    },
    info: async function(path){
      var f = await idb("prova", "readonly", function(s){ return s.get(path); });
      return f ? { etag: f.modified, url: URL.createObjectURL(datoBlob(f)) } : null;
    },
    readJson: async function(path){
      var f = await idb("prova", "readonly", function(s){ return s.get(path); });
      return f ? { data: JSON.parse(await datoBlob(f).text()), etag: f.modified } : null;
    },
    schede: async function(){
      var keys = await idb("prova", "readonly", function(s){ return s.getAllKeys(); });
      var out = [];
      for(var i = 0; i < keys.length; i++){
        if(!/^[^\/]+\/[^\/]+\/[^\/]+\/scheda\.json$/.test(keys[i])) continue;
        var d = (await this.readJson(keys[i])).data;
        out.push({ commessa: d.commessa, job: d.job, tag: d.tag, descrizione: (d.campi || {}).descrizione || "", stato: d.stato,
          aggiornataIl: (d.aggiornata || d.creata).il, aggiornataDa: (d.aggiornata || d.creata).da });
      }
      return out;
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
      var buf = await blob.arrayBuffer();
      await idb("prova", "readwrite", function(s){ return s.put({ buf: buf, type: blob.type, modified: new Date().toISOString(), by: "Prova" }, path); });
    }
  };

  var B = configured ? Server : Prova;

  /* ---------- Schede ---------- */

  function statoInfo(nome){
    return cfg.stati.filter(function(s){ return s.nome === nome; })[0] || { nome: nome || "—", tipo: "warn" };
  }

  function urlScheda(s){ return BASE_URL + qs(s.commessa, s.job, s.tag); }

  function testoScheda(s){
    var r = [
      "SCHEDA CONTROLLO QUALITÀ",
      "",
      "Commessa SICIET: " + (s.commessa || "—"),
      "JOB:    " + s.job,
      "TAG:    " + s.tag + (s.tagOriginale ? " (scritto come " + s.tagOriginale + ")" : "")
    ];
    cfg.campi.forEach(function(c){ if(s.campi && s.campi[c.id]) r.push(c.nome + ": " + s.campi[c.id]); });
    r.push("Stato:  " + s.stato);
    r.push("Creata il " + fmtData(s.creata.il) + " da " + s.creata.da);
    if(s.aggiornata) r.push("Ultimo aggiornamento " + fmtData(s.aggiornata.il) + " da " + s.aggiornata.da);
    r.push("Scheda online: " + urlScheda(s));
    r.push("", "NOTE", "");
    if(!s.note.length) r.push("(nessuna)");
    s.note.forEach(function(n){
      r.push(fmtData(n.il) + " – " + n.da + (n.stato ? "  [Stato: " + (n.statoPrecedente ? n.statoPrecedente + " → " : "") + n.stato + "]" : "") +
        (n.foto ? "  [" + n.foto.length + " foto" + (n.fase ? ", " + n.fase : "") + "]" : ""));
      if(n.testo) r.push(n.testo);
      r.push("");
    });
    r.push("Foto nella cartella Foto, documenti nella cartella Documenti.");
    return r.join("\r\n");
  }

  async function scriviScheda(s, etag){
    var json = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    await B.put(percorso([cartellaScheda(s), "scheda.json"]), json, { etag: etag });
    var txt = new Blob(["﻿" + testoScheda(s)], { type: "text/plain;charset=utf-8" });
    await B.put(percorso([cartellaScheda(s), "Scheda.txt"]), txt);
  }

  // Rilegge la scheda, applica la modifica e salva; se nel frattempo qualcun
  // altro l'ha cambiata (412) riprova sulla versione aggiornata.
  async function aggiornaScheda(s, modifica){
    for(var i = 0; ; i++){
      var r = await B.readJson(percorso([cartellaScheda(s), "scheda.json"]));
      if(!r) throw errore("Scheda non trovata.", 404);
      modifica(r.data);
      r.data.aggiornata = { il: new Date().toISOString(), da: autore() };
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

  /*
   * I file si conservano come ArrayBuffer e non come Blob: Safari su iPhone
   * salva i Blob in IndexedDB ma a volte non riesce più a rileggerli, senza
   * dare errori, e le foto non partivano mai.
   */
  function datoBlob(it){ return it.blob || new Blob([it.buf], { type: it.type || "" }); }

  // dir: cartella della scheda (vedi cartellaScheda); cartella: "Foto", "Documenti" o "".
  // Se la memoria del browser non funziona il file viene inviato subito.
  async function accoda(dir, cartella, nome, blob){
    var buf = await blob.arrayBuffer();
    try{
      await idb("coda", "readwrite", function(s){
        return s.add({ dir: dir, cartella: cartella, nome: nome, buf: buf, type: blob.type, il: Date.now() });
      });
    }catch(e){
      console.warn("Coda non disponibile, invio diretto", e);
      await B.put(percorso([dir, cartella, nome]), new Blob([buf], { type: blob.type }), { rename: true });
    }
  }

  // Gli elementi accodati dalle prime versioni avevano job e tag invece di dir.
  function dirCoda(it){ return it.dir || percorso([it.job, it.tag]); }

  // Elementi in coda. Se la lettura di tutti insieme non riesce si leggono uno
  // alla volta; quelli illeggibili vengono scartati e segnalati.
  async function elementiInCoda(){
    try{
      return await idb("coda", "readonly", function(s){ return s.getAll(); });
    }catch(e){
      var chiavi = await idb("coda", "readonly", function(s){ return s.getAllKeys(); }).catch(function(){ return []; });
      var out = [], persi = 0;
      for(var i = 0; i < chiavi.length; i++){
        var k = chiavi[i];
        try{
          out.push(await idb("coda", "readonly", function(s){ return s.get(k); }));
        }catch(e2){
          persi++;
          await idb("coda", "readwrite", function(s){ return s.delete(k); }).catch(function(){});
        }
      }
      if(persi) erroreInvio = persi + (persi === 1 ? " file non recuperabile dalla memoria del telefono" : " file non recuperabili dalla memoria del telefono");
      return out;
    }
  }

  async function mostraCoda(){
    var n = (await elementiInCoda()).length;
    $("queue").hidden = !n && !erroreInvio;
    if(!n && erroreInvio){ $("queueText").textContent = erroreInvio; return; }
    $("queueText").textContent = (n === 1 ? "1 file in attesa di invio" : n + " file in attesa di invio") +
      (erroreInvio ? " (" + erroreInvio + ")" : "");
  }

  async function svuotaCoda(){
    if(inviando || !B.signedIn()) return;
    inviando = true;
    var inviati = false;
    try{
      erroreInvio = "";
      var items = await elementiInCoda();
      for(var i = 0; i < items.length; i++){
        var it = items[i];
        $("queueText").textContent = "Invio " + (i + 1) + " di " + items.length + "…";
        $("queue").hidden = false;
        await B.put(percorso([dirCoda(it), it.cartella, it.nome]), datoBlob(it), { rename: true });
        await idb("coda", "readwrite", function(s){ return s.delete(it.id); });
        inviati = true;
      }
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

  // Riquadro per aggiungere foto: fase, scatto/galleria, anteprima (con "×" per
  // togliere le foto venute male) e nota facoltativa. Usato nel nuovo
  // componente e nella scheda.
  // opts: { senzaFase: true (la fase la decide chi lo usa), senzaNota: true }
  function PannelloFoto(box, onCambio, opts){
    var self = this, n = ++PannelloFoto.n;
    opts = opts || {};
    this.sel = [];
    this.onCambio = onCambio || function(){};
    this.fasi = el("div", { class: "choices" });
    cfg.fasi.forEach(function(f){
      self.fasi.appendChild(el("label", { class: "choice" }, [
        el("input", { type: "radio", name: "fase-" + n, value: f }),
        el("span", { text: f })
      ]));
    });
    var cam = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: "" });
    var gal = el("input", { type: "file", accept: "image/*", multiple: "", hidden: "" });
    [cam, gal].forEach(function(inp){
      inp.addEventListener("change", function(){
        Array.prototype.slice.call(this.files).forEach(function(f){ self.sel.push({ file: f, url: URL.createObjectURL(f) }); });
        this.value = "";
        self.disegna();
      });
    });
    this.btnCam = el("button", { type: "button", class: "btn primary", text: "📷 Scatta foto", onclick: function(){ cam.click(); } });
    this.griglia = el("div", { class: "gallery" });
    this.nota = el("textarea", { id: "fotoNota-" + n, maxlength: "4000", placeholder: "Es. imballo integro, graffio sul lato sinistro, flange montate…" });
    this.notaBox = el("div", { class: "field", hidden: "" }, [
      el("label", { for: "fotoNota-" + n }, ["Nota sulle foto ", el("span", { class: "hint", text: "(facoltativa)" })]),
      this.nota
    ]);
    box.textContent = "";
    [
      opts.senzaFase ? null : el("fieldset", null, [el("legend", { class: "hint", text: "Fase" }), this.fasi]),
      el("div", { class: "btns" }, [this.btnCam, el("button", { type: "button", class: "btn", text: "🖼️ Dalla galleria", onclick: function(){ gal.click(); } })]),
      cam, gal, this.griglia, opts.senzaNota ? null : this.notaBox
    ].forEach(function(x){ if(x) box.appendChild(x); });
    this.reset();
  }
  PannelloFoto.n = 0;
  PannelloFoto.prototype.disegna = function(){
    var self = this, n = this.sel.length;
    this.griglia.textContent = "";
    this.sel.forEach(function(x, i){
      self.griglia.appendChild(el("div", { class: "sel" }, [
        el("span", { class: "thumb" }, [el("img", { src: x.url, alt: "Foto " + (i + 1) })]),
        el("button", { type: "button", class: "togli", "aria-label": "Togli la foto " + (i + 1), text: "×", onclick: function(){
          self.sel.splice(i, 1);
          self.disegna();
        } })
      ]));
    });
    this.notaBox.hidden = !n;
    this.btnCam.textContent = n ? "📷 Scatta un'altra foto" : "📷 Scatta foto";
    this.onCambio(n);
  };
  PannelloFoto.prototype.fase = function(){ return valoreScelto(this.fasi); };
  PannelloFoto.prototype.testo = function(){ return this.nota.value.trim(); };
  PannelloFoto.prototype.reset = function(){
    this.sel = [];
    this.nota.value = "";
    var r = this.fasi.querySelectorAll("input");
    r[r.length > 1 ? 1 : 0].checked = true;
    this.disegna();
  };

  // Nomi dei file: "2026-10-30 14.32.05 Installazione 2 - Mario Rossi.jpg".
  function nomiFoto(base, fase, n){
    var out = [], op = cfg.chiediOperatore && operatore() ? " - " + nomeFile(operatore()) : "";
    for(var i = 0; i < n; i++) out.push(timbro(base) + " " + nomeFile(fase) + (n > 1 ? " " + (i + 1) : "") + op + ".jpg");
    return out;
  }
  async function accodaFoto(dir, files, nomi){
    for(var i = 0; i < files.length; i++) await accoda(dir, "Foto", nomi[i], await comprimi(files[i]));
  }

  var fotoNuovo, fotoScheda;

  // Salva le foto scelte nella scheda (in coda di invio) e, se c'è, la nota che le accompagna.
  async function salvaFoto(){
    var s = stato.scheda, p = fotoScheda, fase = p.fase(), testo = p.testo();
    if(!s || !p.sel.length || solaLettura()) return;
    var btn = $("fotoSalva"), salvate = false;
    btn.disabled = true;
    $("fotoErr").textContent = "";
    try{
      var base = new Date(), nomi = nomiFoto(base, fase, p.sel.length);
      await accodaFoto(cartellaScheda(s), p.sel.map(function(x){ return x.file; }), nomi);
      salvate = true;
      p.reset();
      await mostraCoda();
      caricaFileScheda();
      svuotaCoda();
      if(testo){
        stato.scheda = await aggiornaScheda(s, function(d){
          d.note.push({ il: base.toISOString(), da: autore(), fase: fase, foto: nomi, testo: testo });
        });
        disegnaScheda();
        caricaFileScheda();
      }
      conferma((nomi.length === 1 ? "1 foto salvata" : nomi.length + " foto salvate") + " (" + fase + ")" + (testo ? ", con la nota" : "") + ".");
    }catch(e){
      $("fotoErr").textContent = (salvate ? "Foto salvate, ma la nota no: " : "") + (e.message || e);
      if(salvate) p.nota.value = testo;
    }finally{
      btn.disabled = false;
    }
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

  /*
   * Tesseract legge bene testo scuro su fondo bianco, nitido, alto qualche
   * decina di pixel, con margine attorno. Il ritaglio viene quindi
   * ridimensionato in base alla sua altezza, portato in bianco e nero (soglia
   * di Otsu, con il fondo sempre bianco anche per scritte chiare su targhe
   * scure) e circondato da un bordo bianco.
   */
  function ritaglioOcr(altezza){
    var img = ocr.img, k = 1 / ocr.scala;
    var r = ocr.sel ? { x: ocr.sel.x * k, y: ocr.sel.y * k, w: ocr.sel.w * k, h: ocr.sel.h * k }
                    : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    var z = Math.min(altezza / r.h, 2400 / r.w);
    var W = Math.max(1, Math.round(r.w * z)), H = Math.max(1, Math.round(r.h * z)), pad = Math.round(Math.max(20, H * 0.15));
    var c = document.createElement("canvas");
    c.width = W + 2 * pad;
    c.height = H + 2 * pad;
    var g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, r.x, r.y, r.w, r.h, pad, pad, W, H);
    var d = g.getImageData(pad, pad, W, H), p = d.data, n = W * H, grigi = new Uint8Array(n), hist = new Array(256).fill(0), i, v;
    for(i = 0; i < n; i++){
      v = (0.299 * p[4 * i] + 0.587 * p[4 * i + 1] + 0.114 * p[4 * i + 2]) | 0;
      grigi[i] = v;
      hist[v]++;
    }
    var somma = 0, sB = 0, wB = 0, best = -1, soglia = 127;
    for(i = 0; i < 256; i++) somma += i * hist[i];
    for(i = 0; i < 256; i++){
      wB += hist[i];
      if(!wB) continue;
      var wF = n - wB;
      if(!wF) break;
      sB += i * hist[i];
      var dm = sB / wB - (somma - sB) / wF, sep = wB * wF * dm * dm;
      if(sep > best){ best = sep; soglia = i; }
    }
    var scuri = 0;
    for(i = 0; i < n; i++) if(grigi[i] <= soglia) scuri++;
    var inverti = scuri > n / 2; // il fondo è la parte più estesa: deve diventare bianco
    for(i = 0; i < n; i++){
      v = (grigi[i] <= soglia) !== inverti ? 0 : 255;
      p[4 * i] = p[4 * i + 1] = p[4 * i + 2] = v;
      p[4 * i + 3] = 255;
    }
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.putImageData(d, pad, pad);
    return c;
  }

  // Punteggio di un possibile TAG: lettere e numeri, trattini, lettura
  // sicura e scritta grande (sulle targhette il TAG è di solito la più grande).
  var FORMA_TAG = /^[A-Z0-9]{1,8}(?:[-\/. ]?[A-Z0-9]{1,8}){0,5}$/;
  function puntiTag(t, conf, alt, maxAlt){
    var s = conf / 100 + 0.8 * alt / maxAlt;
    if(/\d/.test(t)) s += 0.6;
    if(/[A-Z]/.test(t) && /\d/.test(t)) s += 0.4;
    if(/[-\/.]/.test(t)) s += 0.3;
    if(!FORMA_TAG.test(t)) s -= 1;
    if(t.length < 3) s -= 0.8;
    return s;
  }

  // Possibili TAG da una lettura: il testo dopo la scritta "TAG", le righe
  // intere, le singole parole e le coppie di parole vicine.
  function candidatiTag(data, out){
    var righe = data.lines || [], maxAlt = 1;
    righe.forEach(function(l){ l.words.forEach(function(w){ maxAlt = Math.max(maxAlt, w.bbox.y1 - w.bbox.y0); }); });
    function aggiungi(t, conf, alt, bonus){
      t = t.toUpperCase().replace(/\s+/g, " ").replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "").trim();
      if(t.length < 2 || t.length > 30) return;
      var s = puntiTag(t, conf, alt, maxAlt) + (bonus || 0);
      if(!(t in out) || out[t] < s) out[t] = s;
    }
    righe.forEach(function(l){
      var w = l.words.filter(function(x){ return x.text.trim(); });
      if(!w.length) return;
      var alt = Math.max.apply(null, w.map(function(x){ return x.bbox.y1 - x.bbox.y0; }));
      var conf = w.reduce(function(a, x){ return a + x.confidence; }, 0) / w.length;
      var testo = w.map(function(x){ return x.text; }).join(" ");
      var m = /\bTAG\s*(?:N[O0]?\.?|NR\.?)?\s*[:.]?\s*(.+)$/i.exec(testo);
      if(m) aggiungi(m[1], conf, alt, 1.2);
      aggiungi(testo, conf, alt);
      if(w.length > 1) w.forEach(function(x){ aggiungi(x.text, x.confidence, x.bbox.y1 - x.bbox.y0, -0.2); });
      for(var i = 0; i + 1 < w.length; i++) aggiungi(w[i].text + w[i + 1].text, (w[i].confidence + w[i + 1].confidence) / 2, alt, -0.1);
    });
  }

  // Più letture a dimensioni diverse (riquadro largo e basso = una riga sola);
  // ci si ferma appena una lettura è abbastanza sicura.
  async function leggiTesto(){
    var btn = $("ocrLeggi");
    btn.disabled = true;
    $("ocrRisultati").textContent = "";
    try{
      if(!ocr.worker){
        $("ocrStato").textContent = "Preparazione della lettura (solo la prima volta può richiedere qualche secondo)…";
        await caricaScript(TESSERACT_URL);
        ocr.worker = await Tesseract.createWorker("eng");
      }
      var sel = ocr.sel, tentativi;
      if(!sel) tentativi = [{ alt: 1600, psm: "11" }];
      else if(sel.w / sel.h > 2.2) tentativi = [{ alt: 90, psm: "7" }, { alt: 160, psm: "6" }, { alt: 300, psm: "6" }];
      else tentativi = [{ alt: 250, psm: "6" }, { alt: 500, psm: "6" }, { alt: 900, psm: "11" }];
      var punti = {}, ordina = function(){ return Object.keys(punti).sort(function(a, b){ return punti[b] - punti[a]; }); };
      for(var i = 0; i < tentativi.length; i++){
        $("ocrStato").textContent = "Lettura in corso…" + (i ? " (tentativo " + (i + 1) + ")" : "");
        await ocr.worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/. ",
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: tentativi[i].psm,
          user_defined_dpi: "300"
        });
        var r = await ocr.worker.recognize(ritaglioOcr(tentativi[i].alt));
        candidatiTag(r.data, punti);
        var primo = ordina()[0];
        if(primo && punti[primo] > 2.6) break;
      }
      var cand = ordina().slice(0, 6);
      $("ocrStato").textContent = cand.length
        ? "Tocca il TAG corretto (il primo è il più probabile; potrai comunque correggerlo):"
        : "Nessun testo riconosciuto. Riquadra solo il TAG, con più luce e la foto dritta, oppure scrivilo a mano.";
      if(cand.length && !sel) $("ocrStato").textContent += " Per una lettura migliore riquadra solo il TAG.";
      cand.forEach(function(x, k){
        $("ocrRisultati").appendChild(el("button", { type: "button", class: "btn small" + (k ? "" : " primary"), text: x, onclick: function(){ scegliTag(x); } }));
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
    $("ocrHint").textContent = "TAG letto dalla foto: controllalo prima di creare la scheda.";
    $("ocrDlg").hidden = true;
    $("tag").focus();
  }

  // La foto della targhetta viene sempre salvata con la scheda, anche se il TAG si scrive a mano.
  function mostraTarghetta(){
    var f = stato.fotoTarghetta;
    $("targhetta").hidden = !f;
    $("ocrBtn").hidden = !!f;
    if(f) $("targhettaImg").src = URL.createObjectURL(f);
    else $("targhettaImg").removeAttribute("src");
  }

  $("ocrBtn").addEventListener("click", function(){ $("ocrInput").click(); });
  $("ocrAltra").addEventListener("click", function(){ $("ocrInput").click(); });
  $("targhettaCambia").addEventListener("click", function(){ $("ocrInput").click(); });
  $("targhettaRileggi").addEventListener("click", function(){ if(stato.fotoTarghetta) apriOcr(stato.fotoTarghetta); });
  $("targhettaTogli").addEventListener("click", function(){ stato.fotoTarghetta = null; mostraTarghetta(); });
  $("ocrInput").addEventListener("change", function(){
    var f = this.files[0];
    this.value = "";
    if(!f) return;
    stato.fotoTarghetta = f;
    mostraTarghetta();
    apriOcr(f);
  });
  $("ocrLeggi").addEventListener("click", leggiTesto);
  $("ocrAnnulla").addEventListener("click", function(){ $("ocrDlg").hidden = true; });

  /* ---------- Etichetta QR ---------- */

  /*
   * Etichetta per nastro Brother: QR a sinistra, a destra il TAG grande, sotto
   * JOB e commessa. Tutto nero pieno su bianco (niente grigi né colori, che sul
   * nastro diventerebbero puntinati). Il QR usa moduli di un numero intero di
   * punti della stampante, così resta nitido; l'immagine è a doppia
   * risoluzione (360 dpi) e l'app Brother la riduce all'altezza del nastro.
   */
  function disegnaEtichetta(s){
    var e = cfg.etichetta, k = 2;
    var punti = Math.round(e.altezzaMm / 25.4 * e.dpi);   // 128 punti per 18 mm a 180 dpi
    var H = punti * k, mm = H / e.altezzaMm;
    // Correzione d'errore M (regge graffi e sporco); L solo se con M i
    // quadratini scenderebbero sotto i 3 punti di stampa.
    var qr;
    ["M", "L"].some(function(liv){
      qr = qrcode(0, liv);
      qr.addData(urlScheda(s) + "&qr=1");
      qr.make();
      return Math.floor(punti / qr.getModuleCount()) >= 3;
    });
    var n = qr.getModuleCount(), cell = Math.floor(punti / n) * k, q = cell * n;
    var bordo = 2 * cell;                                 // zona di rispetto del QR
    var x = bordo + q + Math.round(2.5 * mm), destra = Math.round(2 * mm);
    var font = "Arial, Helvetica, sans-serif";
    var righe = [
      { t: s.tag, px: Math.round(8.5 * mm), peso: "700" },
      { t: "JOB " + s.job, px: Math.round(4 * mm), peso: "700" },
      { t: "Commessa " + (s.commessa || "—") + " · SICIET Quality", px: Math.round(3 * mm), peso: "400" }
    ];
    var c = document.createElement("canvas"), g = c.getContext("2d");
    // Larghezza: quella del testo più lungo, entro il massimo; il TAG si riduce se non ci sta.
    var maxTesto = Math.round(e.lunghezzaMaxMm * mm) - x - destra, larg = 0;
    righe.forEach(function(r){
      g.font = r.peso + " " + r.px + "px " + font;
      while(r.px > 2.5 * mm && g.measureText(r.t).width > maxTesto){ r.px -= 2; g.font = r.peso + " " + r.px + "px " + font; }
      larg = Math.max(larg, g.measureText(r.t).width);
    });
    c.width = Math.max(Math.round(45 * mm), Math.ceil(x + larg + destra));
    c.height = H;
    g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, H);
    g.fillStyle = "#000";
    var oy = Math.round((H - q) / 2);
    for(var r = 0; r < n; r++) for(var col = 0; col < n; col++){
      if(qr.isDark(r, col)) g.fillRect(bordo + col * cell, oy + r * cell, cell, cell);
    }
    // Righe di testo distribuite sull'altezza.
    var alt = righe.reduce(function(a, r){ return a + r.px; }, 0), spazio = (H - alt) / (righe.length + 1), y = spazio;
    g.textBaseline = "top";
    righe.forEach(function(r){
      g.font = r.peso + " " + r.px + "px " + font;
      g.fillText(r.t, x, y);
      y += r.px + spazio;
    });
    // Solo bianco o nero.
    var d = g.getImageData(0, 0, c.width, H), p = d.data;
    for(var i = 0; i < p.length; i += 4){
      var v = p[i] + p[i + 1] + p[i + 2] < 384 ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = v;
      p[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  // Misure in mm dell'etichetta disegnata (per la stampa dal browser).
  function misureEtichetta(c){
    var mmPerPx = cfg.etichetta.altezzaMm / c.height;
    return { w: Math.round(c.width * mmPerPx * 10) / 10, h: cfg.etichetta.altezzaMm };
  }

  var fileEtichetta = null;

  function apriEtichetta(){
    var s = stato.scheda, c = disegnaEtichetta(s), url = c.toDataURL("image/png");
    var nome = "Etichetta " + nomeFile([s.commessa, s.job, s.tag].filter(Boolean).join(" ")) + ".png";
    $("etichettaImg").src = url;
    $("etichettaImg").dataset.w = misureEtichetta(c).w;
    $("etichettaUrl").textContent = urlScheda(s) + "&qr=1";
    $("etichettaMisure").textContent = "Misure: " + misureEtichetta(c).w + " × " + cfg.etichetta.altezzaMm + " mm di stampa (nastro da 24 mm).";
    $("etichettaScarica").href = url;
    $("etichettaScarica").download = nome;
    // Il file per "Condividi" si prepara subito: Safari permette di condividere
    // solo nel momento del tocco, senza attese.
    fileEtichetta = null;
    $("etichettaCondividi").hidden = true;
    c.toBlob(function(b){
      if(!b || !window.File || !navigator.canShare) return;
      var f = new File([b], nome, { type: "image/png" });
      if(navigator.canShare({ files: [f] })){ fileEtichetta = f; $("etichettaCondividi").hidden = false; }
    }, "image/png");
    $("etichettaDlg").hidden = false;
  }

  function condividiEtichetta(){
    if(!fileEtichetta) return;
    navigator.share({ files: [fileEtichetta], title: fileEtichetta.name }).catch(function(e){
      if(e && e.name !== "AbortError") mostraErrore(e);
    });
  }

  function stampaEtichetta(){
    var a = $("printArea"), w = $("etichettaImg").dataset.w, h = cfg.etichetta.altezzaMm;
    a.textContent = "";
    a.style.width = w + "mm";
    a.style.height = h + "mm";
    a.appendChild(el("img", { src: $("etichettaImg").src, alt: "" }));
    var st = $("pageSize") || document.head.appendChild(el("style", { id: "pageSize" }));
    st.textContent = "@page{size:" + w + "mm " + h + "mm;margin:0}";
    window.print();
  }

  $("etichettaBtn").addEventListener("click", apriEtichetta);
  $("etichettaStampa").addEventListener("click", stampaEtichetta);
  $("etichettaCondividi").addEventListener("click", condividiEtichetta);
  $("etichettaChiudi").addEventListener("click", function(){ $("etichettaDlg").hidden = true; });

  /* ---------- Navigazione ---------- */

  var stato = { vista: null, job: null, tag: null, scheda: null, fotoTarghetta: null, inseriti: [], dopo: null };

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
    ["viewPin", "viewAccesso", "viewOperatore", "viewElenco", "viewNuovo", "viewScheda"].forEach(function(v){ $(v).hidden = v !== id; });
    // Pulsante fisso per tornare all'inizio: non nella pagina iniziale né nelle richieste di accesso.
    $("homeFab").hidden = (id === "viewElenco" && !stato.c) || ["viewPin", "viewAccesso", "viewOperatore"].indexOf(id) >= 0;
  }

  function mostra(){
    var q = new URLSearchParams(location.search);
    var c = q.get("c"), job = q.get("job"), tag = q.get("tag");
    // Arrivo da un QR: la sessione resta "da QR" e il segno sparisce dall'indirizzo.
    if(q.get("qr") === "1"){
      storage(function(){ sessionStorage.setItem(QR_KEY, "1"); });
      history.replaceState(null, "", location.pathname + qs(c, job, tag));
    }
    mostraErrore(null);
    $("ocrDlg").hidden = $("etichettaDlg").hidden = $("lightbox").hidden = true;

    if(!B.signedIn()){
      stato.vista = "pin";
      $("pinTesto").textContent = job && tag
        ? "Per vedere la scheda del TAG " + tag + " (JOB " + job + ") inserisci il PIN aziendale. Va inserito una volta sola su questo telefono."
        : "Inserisci il PIN aziendale. Va inserito una volta sola su questo telefono.";
      soloVista("viewPin");
      $("pin").focus();
      return;
    }
    if(daQr() && !accesso("lettura")) return mostraAccesso("lettura");
    if(stato.chiediModifica && !accesso("modifica")) return mostraAccesso("modifica");
    stato.chiediModifica = false;
    applicaSolaLettura();
    if(cfg.chiediOperatore && !operatore() && !solaLettura()){
      stato.vista = "operatore";
      soloVista("viewOperatore");
      $("operatoreNome").focus();
      return;
    }
    if(q.has("nuovo") && !solaLettura()) return mostraNuovo(c, job);
    if(c && job && tag) return mostraScheda(c, job, tag);
    return mostraElenco(c, c && job);
  }

  /* ---------- Accesso dei tecnici dal QR ----------
   * Chi entra da un QR deve inserire la password di visualizzazione (vede
   * tutte le schede senza modificarle) e, per modificare, quella di modifica.
   * Le password le controlla il servizio; valgono ORE_ACCESSO ore sul dispositivo.
   * Chi apre la pagina normalmente non vede nessuna richiesta.
   */
  function daQr(){ return configured && storage(function(){ return sessionStorage.getItem(QR_KEY); }) === "1"; }
  function accessi(){ return storage(function(){ return JSON.parse(localStorage.getItem(ACCESSO_KEY)); }) || {}; }
  function accesso(livello){ return (accessi()[livello] || 0) > Date.now(); }
  function concediAccesso(livello){
    var a = accessi(), scade = Date.now() + ORE_ACCESSO * 3600000;
    a[livello] = scade;
    if(livello === "modifica") a.lettura = Math.max(a.lettura || 0, scade);
    storage(function(){ localStorage.setItem(ACCESSO_KEY, JSON.stringify(a)); });
  }
  function solaLettura(){ return daQr() && !accesso("modifica"); }

  function mostraAccesso(livello){
    stato.vista = "accesso";
    stato.livelloAccesso = livello;
    soloVista("viewAccesso");
    $("accessoTitolo").textContent = livello === "modifica" ? "Password di modifica" : "Accesso tecnici";
    $("accessoTesto").textContent = livello === "modifica"
      ? "Per modificare la scheda (foto, note, documenti, dati) inserisci la password di modifica dei tecnici."
      : "Per vedere le schede inserisci la password di visualizzazione dei tecnici.";
    $("accessoAnnulla").hidden = livello !== "modifica";
    $("accessoErr").textContent = "";
    $("accessoPassword").value = "";
    // Se il servizio non ha password impostate si entra direttamente
    // (senza password di modifica, anche con la modifica abilitata).
    B.verifica(livello, "").then(async function(r){
      if(!r || r.protetto !== false || stato.vista !== "accesso") return;
      concediAccesso(livello);
      if(livello === "lettura"){
        var m = await B.verifica("modifica", "").catch(function(){ return null; });
        if(m && m.protetto === false) concediAccesso("modifica");
      }
      stato.chiediModifica = false;
      mostra();
    }).catch(function(){});
    $("accessoPassword").focus();
  }
  $("accessoForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var livello = stato.livelloAccesso, pwd = $("accessoPassword").value, btn = this.querySelector("button[type=submit]");
    if(!pwd){ $("accessoPassword").focus(); return; }
    btn.disabled = true;
    $("accessoErr").textContent = "";
    try{
      await B.verifica(livello, pwd);
      concediAccesso(livello);
      stato.chiediModifica = false;
      mostra();
    }catch(e){
      $("accessoErr").textContent = e.status === 403 ? "Password non corretta." : e.message;
    }finally{
      btn.disabled = false;
    }
  });
  $("accessoAnnulla").addEventListener("click", function(){ stato.chiediModifica = false; mostra(); });
  $("qrModifica").addEventListener("click", function(){ stato.chiediModifica = true; mostra(); });

  // In sola visualizzazione spariscono i comandi che modificano.
  function applicaSolaLettura(){
    var ro = solaLettura();
    $("qrBar").hidden = !ro;
    document.body.classList.toggle("sola-lettura", ro);
  }

  /* ---------- Operatore ---------- */

  function mostraOperatore(){
    var op = cfg.chiediOperatore && operatore();
    $("operatore").hidden = !op;
    $("operatoreTesto").textContent = op ? "Operatore: " + op : "";
  }
  $("operatoreForm").addEventListener("submit", function(ev){
    ev.preventDefault();
    var nome = $("operatoreNome").value.replace(/\s+/g, " ").trim();
    if(nome.length < 3){ $("operatoreNome").classList.add("invalid"); $("operatoreNome").focus(); return; }
    $("operatoreNome").classList.remove("invalid");
    storage(function(){ localStorage.setItem(OPERATORE_KEY, nome); });
    mostraOperatore();
    mostra();
  });
  $("operatoreCambia").addEventListener("click", function(){
    $("operatoreNome").value = operatore();
    storage(function(){ localStorage.removeItem(OPERATORE_KEY); });
    mostraOperatore();
    mostra();
  });

  /* ---------- Elenco commesse / JOB / TAG ---------- */

  var elencoVoci = [];

  async function mostraElenco(c, job){
    stato.vista = "elenco";
    stato.c = c;
    stato.job = job;
    soloVista("viewElenco");
    var cr = $("elencoCrumbs");
    cr.textContent = "";
    if(c){
      cr.appendChild(link("?", "🏠 Inizio"));
      cr.appendChild(document.createTextNode(" › "));
      if(job){
        cr.appendChild(link(qs(c), "Commessa " + c));
        cr.appendChild(document.createTextNode(" › JOB " + job));
      }else{
        cr.appendChild(document.createTextNode("Commessa " + c));
      }
    }else{
      cr.appendChild(document.createTextNode("Tutte le commesse"));
    }
    $("nuovoBtn").href = qs(c, job, null, "nuovo");
    $("nuovoBtn").setAttribute("data-vai", "");
    $("filtroLabel").textContent = job ? "Cerca un TAG nel JOB " + job : c ? "Cerca un JOB nella commessa " + c : "Cerca TAG, JOB, commessa o descrizione";
    stato.schede = null;
    $("schedeBox").hidden = true;
    if(!c) B.schede().then(function(v){
      if(stato.vista !== "elenco" || stato.c) return;
      stato.schede = v;
      disegnaElenco();
    }).catch(function(){});
    $("filtro").value = "";
    $("elenco").textContent = "";
    $("elencoVuoto").hidden = false;
    $("elencoVuoto").textContent = "Caricamento…";
    try{
      var voci = (await B.list(percorso([c, job]))).filter(function(v){ return v.folder; });
      if(stato.vista !== "elenco" || stato.c !== c || stato.job !== job) return;
      elencoVoci = voci.sort(function(a, b){ return a.name.localeCompare(b.name, "it", { numeric: true }); });
      disegnaElenco();
    }catch(e){
      $("elencoVuoto").textContent = "";
      mostraErrore(e);
    }
  }

  // Nella pagina iniziale: schede trovate dalla ricerca, o le ultime aggiornate.
  function disegnaSchede(){
    var box = $("schedeBox"), ul = $("schede"), cerca = $("filtro").value.trim().toUpperCase(), tutte = stato.schede || [];
    var voci = cerca
      ? tutte.filter(function(x){ return [x.tag, x.job, x.commessa, x.descrizione].join(" ").toUpperCase().indexOf(cerca) >= 0; }).slice(0, 30)
      : tutte.slice().sort(function(a, b){ return String(b.aggiornataIl).localeCompare(String(a.aggiornataIl)); }).slice(0, 5);
    ul.textContent = "";
    voci.forEach(function(x){
      var a = link(qs(x.commessa, x.job, x.tag), "");
      a.appendChild(el("span", { class: "name" }, [x.tag, el("span", { class: "sub", text: "JOB " + x.job + " · commessa " + x.commessa + (x.descrizione ? " · " + x.descrizione : "") })]));
      a.appendChild(el("span", { class: "meta" }, [el("span", { class: "badge " + statoInfo(x.stato).tipo, text: x.stato })]));
      ul.appendChild(el("li", null, [a]));
    });
    $("schedeTitolo").textContent = cerca ? (voci.length ? "Schede trovate" : "Nessuna scheda trovata") : "Ultime schede aggiornate";
    box.hidden = !tutte.length || (!cerca && !voci.length);
  }

  function disegnaElenco(){
    if(!stato.c) disegnaSchede();
    var f = nomeCartella($("filtro").value), c = stato.c, job = stato.job, ul = $("elenco");
    ul.textContent = "";
    var voci = elencoVoci.filter(function(v){ return !f || v.name.indexOf(f) >= 0; });
    voci.forEach(function(v){
      var q = job ? qs(c, job, v.name) : c ? qs(c, v.name) : qs(v.name);
      var a = link(q, "");
      a.appendChild(el("span", { class: "name", text: (job ? "" : c ? "JOB " : "Commessa ") + v.name }));
      a.appendChild(el("span", { class: "meta", text: v.modified ? fmtData(v.modified).slice(0, 10) : "" }));
      ul.appendChild(el("li", null, [a]));
    });
    $("elencoVuoto").hidden = voci.length > 0 || (!c && !!$("filtro").value.trim());
    $("riepiloghi").hidden = !configured || !!c;
    $("elencoVuoto").textContent = elencoVoci.length
      ? "Nessun risultato."
      : (job ? "Nessun componente in questo JOB." : c ? "Nessun JOB in questa commessa." : "Nessuna commessa: crea la prima scheda con \"Nuovo componente\".");
  }
  $("filtro").addEventListener("input", disegnaElenco);

  /* ---------- Riepiloghi Excel ed etichette ----------
   * Il servizio aggiorna da solo i riepiloghi a ogni salvataggio. Questi
   * pulsanti (per l'ufficio) rifanno tutto da zero: riepiloghi (schede create
   * prima, o cancellate a mano su SharePoint) ed etichette QR (formato nuovo,
   * o mancanti).
   */

  // Cartelle delle schede, cercate su SharePoint: [[commessa, JOB, TAG], …].
  async function trovaSchede(st){
    st.textContent = "Ricerca delle schede…";
    var schede = [];
    var commesse = (await B.list("")).filter(function(x){ return x.folder; });
    for(var i = 0; i < commesse.length; i++){
      var jobs = (await B.list(commesse[i].name)).filter(function(x){ return x.folder; });
      for(var k = 0; k < jobs.length; k++){
        var tags = (await B.list(percorso([commesse[i].name, jobs[k].name]))).filter(function(x){ return x.folder; });
        tags.forEach(function(t){ schede.push([commesse[i].name, jobs[k].name, t.name]); });
      }
    }
    return schede;
  }

  $("etichetteBtn").addEventListener("click", async function(){
    if(!confirm("Ricreare l'etichetta QR (Etichetta QR.png) di tutte le schede, nel formato attuale? Quelle presenti vengono sostituite, quelle mancanti create. Tieni aperta la pagina.")) return;
    var btn = this, st = $("riepiloghiStato");
    btn.disabled = true;
    try{
      var schede = await trovaSchede(st);
      for(var n = 0; n < schede.length; n++){
        var x = { commessa: schede[n][0], job: schede[n][1], tag: schede[n][2] };
        st.textContent = "Etichetta " + (n + 1) + " di " + schede.length + ": " + percorso(schede[n]);
        var png = await canvasBlob(disegnaEtichetta(x), "image/png");
        await B.put(percorso(schede[n].concat("Etichetta QR.png")), png);
      }
      st.textContent = "Etichette ricreate (" + schede.length + (schede.length === 1 ? " scheda)." : " schede).");
    }catch(e){
      st.textContent = "Etichette non completate: " + (e.message || e);
    }finally{
      btn.disabled = false;
    }
  });

  $("riepiloghiBtn").addEventListener("click", async function(){
    if(!confirm("Ricostruire i riepiloghi Excel di tutte le schede? Può richiedere qualche minuto: tieni aperta la pagina.")) return;
    var btn = this, st = $("riepiloghiStato");
    btn.disabled = true;
    try{
      var schede = (await trovaSchede(st)).map(percorso);
      await B.api("GET", "aggiorna", "", { query: "&azzera=1" });
      for(var n = 0; n < schede.length; n++){
        st.textContent = "Aggiornamento " + (n + 1) + " di " + schede.length + ": " + schede[n];
        await B.api("GET", "aggiorna", schede[n]);
      }
      st.textContent = "Riepiloghi aggiornati (" + schede.length + (schede.length === 1 ? " scheda)." : " schede).");
    }catch(e){
      st.textContent = "Ricostruzione non completata: " + (e.message || e);
    }finally{
      btn.disabled = false;
    }
  });

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

  function mostraNuovo(c, job){
    stato.vista = "nuovo";
    soloVista("viewNuovo");
    $("nuovoOk").hidden = true;
    pulisciNuovo(
      c || storage(function(){ return localStorage.getItem(COMMESSA_KEY); }) || "",
      job || (c ? "" : storage(function(){ return localStorage.getItem(LAST_JOB_KEY); })) || ""
    );
    if(!$("commessa").value) $("commessa").focus();
    else if(!$("job").value) $("job").focus();
    suggerimenti($("commessaList"), "");
    suggerimenti($("jobList"), nomeCartella($("commessa").value));
  }

  // Suggerimenti per i campi commessa e JOB: le cartelle già presenti.
  function suggerimenti(dl, path){
    dl.textContent = "";
    if(path === null) return;
    B.list(path).then(function(v){
      v.filter(function(x){ return x.folder; }).forEach(function(x){ dl.appendChild(el("option", { value: x.name })); });
    }).catch(function(){});
  }
  $("commessa").addEventListener("change", function(){
    var c = nomeCartella(this.value);
    suggerimenti($("jobList"), c || null);
  });

  // Svuota il modulo per un nuovo componente, tenendo commessa SICIET e JOB.
  function pulisciNuovo(c, job){
    stato.fotoTarghetta = null;
    $("nuovoForm").reset();
    $("nuovoErr").textContent = "";
    $("commessa").value = c;
    $("job").value = job;
    $("tag").value = "";
    $("ocrHint").textContent = "Letto dalla foto oppure scritto a mano: controllalo sempre.";
    document.querySelector("#viewNuovo details").open = false;
    fotoNuovo.reset();
    mostraTarghetta();
    campiForm($("campiNuovo"), "n-");
    sceltaStati($("statiNuovo"), "statoNuovo");
  }

  // Componenti inseriti di seguito: elenco con il link a ciascuna scheda.
  function mostraInseriti(){
    var box = $("nuovoOk"), ul = el("ul", { class: "inseriti" });
    box.textContent = "";
    var ultimo = stato.inseriti[stato.inseriti.length - 1];
    box.appendChild(el("strong", { text: "✓ Scheda del TAG " + ultimo.tag + " salvata. Puoi inserire il prossimo componente." }));
    stato.inseriti.slice().reverse().forEach(function(x){
      var a = link(qs(x.c, x.job, x.tag), x.tag);
      ul.appendChild(el("li", null, [a, " – JOB " + x.job + ", commessa " + x.c]));
    });
    box.appendChild(el("span", { class: "hint", text: "Inseriti finora (" + stato.inseriti.length + "):" }));
    box.appendChild(ul);
    box.hidden = false;
  }

  // Ricorda quale pulsante ha inviato il modulo (event.submitter manca sui Safari meno recenti).
  ["nuovoApri", "nuovoSubmit"].forEach(function(id){
    $(id).addEventListener("click", function(){ stato.dopo = this.getAttribute("data-dopo"); });
  });

  $("nuovoForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var commessa = nomeCartella($("commessa").value), job = nomeCartella($("job").value), tag = nomeCartella($("tag").value), err = $("nuovoErr");
    var dopo = stato.dopo || "prossimo";
    stato.dopo = null;
    $("commessa").classList.toggle("invalid", !commessa);
    $("job").classList.toggle("invalid", !job);
    $("tag").classList.toggle("invalid", !tag);
    if(!commessa || !job || !tag){ err.textContent = "Indica commessa SICIET, JOB e TAG."; return; }
    err.textContent = "";
    var btn = dopo === "apri" ? $("nuovoApri") : $("nuovoSubmit"), testoBtn = btn.textContent;
    $("nuovoApri").disabled = $("nuovoSubmit").disabled = true;
    btn.textContent = "Salvataggio…";
    try{
      var dir = percorso([commessa, job, tag]);
      if(await B.readJson(percorso([dir, "scheda.json"]))){
        err.textContent = "Esiste già una scheda per il TAG " + tag + " nel JOB " + job + " (commessa " + commessa + "): la apro, puoi aggiungere foto e note.";
        setTimeout(function(){ vai(qs(commessa, job, tag)); }, 1800);
        return;
      }
      var ora = new Date(), adesso = ora.toISOString(), chi = autore();
      var fasePrima = fotoNuovo.fase(), filePrima = fotoNuovo.sel.map(function(x){ return x.file; });
      var nomiPrima = nomiFoto(new Date(ora.getTime() + 1000), fasePrima, filePrima.length), notaFoto = fotoNuovo.testo();
      var tagScritto = $("tag").value.trim(), statoIniz = valoreScelto($("statiNuovo")), nota = $("notaNuovo").value.trim();
      var s = {
        versione: 1,
        commessa: commessa,
        job: job,
        tag: tag,
        campi: leggiCampi("n-"),
        stato: statoIniz,
        creata: { il: adesso, da: chi },
        note: [{ il: adesso, da: chi, stato: statoIniz, testo: nota || "Scheda creata." }]
      };
      if(filePrima.length) s.note.push({ il: adesso, da: chi, fase: fasePrima, foto: nomiPrima, testo: notaFoto || undefined });
      if(tagScritto.toUpperCase() !== tag) s.tagOriginale = tagScritto;
      await scriviScheda(s);
      storage(function(){ localStorage.setItem(LAST_JOB_KEY, job); localStorage.setItem(COMMESSA_KEY, commessa); });

      var etichetta = await canvasBlob(disegnaEtichetta(s), "image/png");
      await accoda(dir, "", "Etichetta QR.png", etichetta);
      if(stato.fotoTarghetta){
        await accoda(dir, "Foto", nomiFoto(ora, cfg.fasi[0], 1)[0], await comprimi(stato.fotoTarghetta));
        stato.fotoTarghetta = null;
      }
      await accodaFoto(dir, filePrima, nomiPrima);
      fotoNuovo.reset();
      stato.inseriti.push({ c: commessa, job: job, tag: tag });
      svuotaCoda();
      if(dopo === "apri"){
        vai(qs(commessa, job, tag));
      }else{
        pulisciNuovo(commessa, job);
        mostraInseriti();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }catch(e){
      err.textContent = e.message || String(e);
    }finally{
      $("nuovoApri").disabled = $("nuovoSubmit").disabled = false;
      btn.textContent = testoBtn;
    }
  });

  /* ---------- Scheda ---------- */

  async function mostraScheda(c, job, tag){
    var dir = percorso([c, job, tag]);
    stato.vista = "scheda";
    stato.c = c;
    stato.job = job;
    stato.tag = tag;
    stato.scheda = null;
    soloVista("viewScheda");
    var cr = $("schedaCrumbs");
    cr.textContent = "";
    cr.appendChild(link("?", "🏠 Inizio"));
    cr.appendChild(document.createTextNode(" › "));
    cr.appendChild(link(qs(c), "Commessa " + c));
    cr.appendChild(document.createTextNode(" › "));
    cr.appendChild(link(qs(c, job), "JOB " + job));
    $("schedaTag").textContent = tag;
    $("schedaStato").textContent = "";
    $("schedaStato").className = "badge";
    $("schedaDati").textContent = "";
    $("note").textContent = "";
    $("galleria").textContent = "";
    $("documenti").textContent = "";
    $("modificaForm").hidden = true;
    fotoScheda.reset();
    $("cartellaBtn").hidden = true;
    sceltaStati($("statiNota"), "statoNota");
    try{
      var r = await B.readJson(percorso([dir, "scheda.json"]));
      if(stato.vista !== "scheda" || stato.tag !== tag || stato.job !== job || stato.c !== c) return;
      if(!r){
        mostraErrore(new Error("Nessuna scheda per il TAG " + tag + " nel JOB " + job + " (commessa " + c + ")."));
        return;
      }
      stato.scheda = r.data;
      disegnaScheda();
      caricaFileScheda();
      if(B.info) B.info(dir).then(function(i){
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
    riga("Commessa SICIET", s.commessa);
    riga("JOB", s.job);
    riga("TAG scritto come", s.tagOriginale);
    cfg.campi.forEach(function(c){ riga(c.nome, s.campi && s.campi[c.id]); });
    riga("Creata", fmtData(s.creata.il) + " – " + s.creata.da);
    if(s.aggiornata) riga("Aggiornata", fmtData(s.aggiornata.il) + " – " + s.aggiornata.da);

    var ul = $("note");
    ul.textContent = "";
    s.note.slice().reverse().forEach(function(n){
      var li = el("li", null, [el("span", { class: "who", text: fmtData(n.il) + " – " + n.da +
        (n.foto ? " · 📷 " + (n.foto.length === 1 ? "1 foto" : n.foto.length + " foto") + (n.fase ? " (" + n.fase + ")" : "") : "") })]);
      if(n.stato) li.appendChild(el("span", null, [el("span", { class: "badge " + statoInfo(n.stato).tipo, text: n.stato })]));
      if(n.testo) li.appendChild(el("span", { class: "txt", text: n.testo }));
      ul.appendChild(li);
    });
    sceltaStati($("statiNota"), "statoNota", s.stato);
    disegnaStorico();
    aggiornaFormNota();
  }

  // Storico dello stato: solo i passaggi, dal primo (creazione) all'ultimo.
  function disegnaStorico(){
    var ol = $("storico"), passi = stato.scheda.note.filter(function(n){ return n.stato; });
    ol.textContent = "";
    passi.forEach(function(n, i){
      var li = el("li", { class: "passo " + statoInfo(n.stato).tipo }, [
        el("span", { class: "badge " + statoInfo(n.stato).tipo, text: n.stato }),
        el("span", { class: "who", text: fmtData(n.il) + " – " + n.da + (i === 0 ? " · scheda creata" : "") +
          (n.foto ? " · 📷 " + (n.foto.length === 1 ? "1 foto" : n.foto.length + " foto") : "") })
      ]);
      if(n.testo && !(i === 0 && n.testo === "Scheda creata.")) li.appendChild(el("span", { class: "txt", text: n.testo }));
      ol.appendChild(li);
    });
    $("storicoBox").hidden = !passi.length;
  }

  /*
   * Nuova nota o cambio di stato. Un cambio di stato richiede sempre la
   * motivazione; da "Non conforme" a "Conforme" la domanda è "Come è stata
   * risolta?". Si possono aggiungere foto (fase Risoluzione o Non conformità).
   */
  var fotoStato;
  function tipoCambio(){
    var s = stato.scheda, nuovo = valoreScelto($("statiNota"));
    if(!s || !nuovo || nuovo === s.stato) return null;
    var da = statoInfo(s.stato).tipo, a = statoInfo(nuovo).tipo;
    if(a === "ok" && da === "ko") return { nuovo: nuovo, fase: "Risoluzione", domanda: "Come è stata risolta la non conformità?", esempio: "Es. flangia sostituita con una nuova, verificata la tenuta." };
    if(a === "ko") return { nuovo: nuovo, fase: "Non conformità", domanda: "Descrivi la non conformità", esempio: "Es. flangia lato mandata danneggiata durante il trasporto." };
    return { nuovo: nuovo, fase: "Altro", domanda: "Motivo del cambio di stato", esempio: "Es. verifica completata, nessun difetto." };
  }
  function aggiornaFormNota(){
    var t = tipoCambio();
    $("notaLabel").textContent = t ? t.domanda + " (obbligatorio)" : "Nuova nota";
    $("notaTesto").placeholder = t ? t.esempio : "";
    $("notaFotoBox").hidden = !t;
    $("notaFotoTitolo").textContent = t && t.fase === "Risoluzione" ? "Foto della risoluzione" : "Foto";
    $("notaSubmit").textContent = t ? "✅ Conferma: stato " + t.nuovo : "✅ Aggiungi nota";
    $("notaSubmit").classList.toggle("cambio", !!t);
    $("notaErr").textContent = "";
  }
  $("statiNota").addEventListener("change", function(){ $("notaOk").hidden = true; aggiornaFormNota(); });

  async function caricaFileScheda(){
    var s = stato.scheda;
    if(!s) return;
    var dir = cartellaScheda(s);
    try{
      var res = await Promise.all([
        B.list(percorso([dir, "Foto"])),
        B.list(percorso([dir, "Documenti"])),
        elementiInCoda()
      ]);
      if(!stato.scheda || cartellaScheda(stato.scheda) !== dir) return;
      var coda = res[2].filter(function(c){ return dirCoda(c) === dir; });
      disegnaGalleria(res[0].filter(function(f){ return !f.folder; }), coda.filter(function(c){ return c.cartella === "Foto"; }));
      disegnaDocumenti(res[1].filter(function(f){ return !f.folder; }), coda.filter(function(c){ return c.cartella === "Documenti"; }));
    }catch(e){ mostraErrore(e); }
  }

  function disegnaGalleria(foto, inCoda){
    var box = $("galleria"), gruppi = {}, noteFoto = {};
    box.textContent = "";
    // Nota che accompagna ciascuna foto, mostrata quando la si ingrandisce.
    stato.scheda.note.forEach(function(n){ (n.foto || []).forEach(function(f){ noteFoto[f] = n.testo; }); });
    foto.forEach(function(f){
      var i = leggiNomeFoto(f.name);
      (gruppi[i.fase] = gruppi[i.fase] || []).push({ f: f, data: i.data || new Date(f.modified), op: i.operatore || f.by });
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
          var u = URL.createObjectURL(datoBlob(x.coda));
          grid.appendChild(el("button", { type: "button", class: "thumb pending", onclick: function(){ apriFoto(u, u, when + " (in attesa di invio)", noteFoto[x.coda.nome]); } }, [
            el("img", { src: u, alt: fase + " " + when, loading: "lazy" })
          ]));
          return;
        }
        var f = x.f;
        grid.appendChild(el("button", { type: "button", class: "thumb", onclick: function(){ apriFoto(f.large || f.url, f.url || f.webUrl, when + (x.op ? " – " + x.op : ""), noteFoto[f.name]); } }, [
          f.thumb ? el("img", { src: f.thumb, alt: fase + " " + when, loading: "lazy" }) : el("span", { class: "when", text: f.name }),
          el("span", { class: "when", text: when.slice(0, 10) })
        ]));
      });
      box.appendChild(el("div", { class: "gallery-group" }, [el("h4", { text: fase + " (" + g.length + ")" }), grid]));
    });
    if(!box.childNodes.length) box.appendChild(el("p", { class: "empty", text: "Nessuna foto: aggiungile dalla sezione qui sopra." }));
  }

  function disegnaDocumenti(docs, inCoda){
    var ul = $("documenti");
    ul.textContent = "";
    docs.sort(function(a, b){ return a.name.localeCompare(b.name, "it"); }).forEach(function(d){
      ul.appendChild(el("li", null, [
        el("a", { href: d.url || d.webUrl, target: "_blank", rel: "noopener", text: d.name }),
        el("span", { class: "hint", text: " – " + fmtData(d.modified) + (d.by ? ", " + d.by : "") })
      ]));
    });
    inCoda.forEach(function(c){
      ul.appendChild(el("li", { class: "hint", text: c.nome + " – in attesa di invio" }));
    });
    if(!ul.childNodes.length) ul.appendChild(el("li", { class: "empty", text: "Nessun documento (es. DDT, certificati, schede tecniche, verbali)." }));
  }

  function apriFoto(src, originale, testo, nota){
    $("lightboxImg").src = src;
    $("lightboxApri").href = originale;
    $("lightboxText").textContent = testo;
    $("lightboxNota").textContent = nota || "";
    $("lightbox").hidden = false;
  }
  $("lightboxChiudi").addEventListener("click", function(){ $("lightbox").hidden = true; $("lightboxImg").removeAttribute("src"); });
  $("lightbox").addEventListener("click", function(ev){ if(ev.target === this) $("lightboxChiudi").click(); });

  $("fotoForm").addEventListener("submit", function(ev){ ev.preventDefault(); salvaFoto(); });

  $("docBtn").addEventListener("click", function(){ $("docInput").click(); });
  async function aggiungiDocumenti(files){
    var s = stato.scheda;
    if(!s || !files.length || solaLettura()) return;
    try{
      for(var i = 0; i < files.length; i++) await accoda(cartellaScheda(s), "Documenti", nomeFile(files[i].name), files[i]);
      await mostraCoda();
      caricaFileScheda();
      svuotaCoda();
      conferma(files.length === 1 ? "Documento caricato: " + files[0].name : files.length + " documenti caricati.");
    }catch(e){ mostraErrore(e); }
  }
  $("docInput").addEventListener("change", function(){
    var files = Array.prototype.slice.call(this.files);
    this.value = "";
    aggiungiDocumenti(files);
  });
  // Dal PC i documenti si possono trascinare sul riquadro.
  (function(){
    var box = $("docBox");
    box.addEventListener("dragover", function(ev){ ev.preventDefault(); box.classList.add("drop"); });
    box.addEventListener("dragleave", function(ev){ if(!box.contains(ev.relatedTarget)) box.classList.remove("drop"); });
    box.addEventListener("drop", function(ev){
      ev.preventDefault();
      box.classList.remove("drop");
      aggiungiDocumenti(Array.prototype.slice.call(ev.dataTransfer.files || []));
    });
  })();

  $("notaForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var s = stato.scheda, testo = $("notaTesto").value.trim(), t = tipoCambio();
    if(!s || solaLettura()) return;
    $("notaOk").hidden = true;
    if(!testo){
      $("notaErr").textContent = t ? "Scrivi il motivo del cambio di stato: è obbligatorio e resta nello storico." : "Scrivi la nota.";
      $("notaTesto").classList.add("invalid");
      $("notaTesto").focus();
      return;
    }
    $("notaTesto").classList.remove("invalid");
    $("notaErr").textContent = "";
    var btn = $("notaSubmit"), testoBtn = btn.textContent, precedente = s.stato;
    btn.disabled = true;
    btn.textContent = "Salvataggio…";
    try{
      var base = new Date(), nomi = [];
      if(t && fotoStato.sel.length){
        nomi = nomiFoto(base, t.fase, fotoStato.sel.length);
        await accodaFoto(cartellaScheda(s), fotoStato.sel.map(function(x){ return x.file; }), nomi);
      }
      stato.scheda = await aggiornaScheda(s, function(d){
        var n = { il: base.toISOString(), da: autore(), testo: testo };
        if(t && t.nuovo !== d.stato){ n.statoPrecedente = d.stato; n.stato = t.nuovo; d.stato = t.nuovo; }
        if(nomi.length){ n.foto = nomi; n.fase = t.fase; }
        d.note.push(n);
      });
      $("notaTesto").value = "";
      fotoStato.reset();
      disegnaScheda();
      if(nomi.length){ await mostraCoda(); caricaFileScheda(); svuotaCoda(); }
      var msg = t
        ? "Stato cambiato da «" + precedente + "» a «" + t.nuovo + "»" + (nomi.length ? " con " + (nomi.length === 1 ? "1 foto" : nomi.length + " foto") : "") + ". Registrato nello storico il " + fmtData(base.toISOString()) + " da " + autore() + "."
        : "Nota aggiunta il " + fmtData(base.toISOString()) + " da " + autore() + ".";
      $("notaOk").textContent = "✓ " + msg;
      $("notaOk").hidden = false;
      conferma(msg);
    }catch(e){
      $("notaErr").textContent = "Non salvato: " + (e.message || e) + " Riprova.";
    }finally{
      btn.disabled = false;
      btn.textContent = testoBtn;
      aggiornaFormNota();
    }
  });

  $("modificaBtn").addEventListener("click", function(){
    campiForm($("campiModifica"), "m-", stato.scheda && stato.scheda.campi);
    $("modificaForm").hidden = false;
  });
  $("modificaAnnulla").addEventListener("click", function(){ $("modificaForm").hidden = true; });
  $("modificaForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var s = stato.scheda, campi = leggiCampi("m-");
    if(!s || solaLettura()) return;
    try{
      stato.scheda = await aggiornaScheda(s, function(d){ d.campi = campi; });
      $("modificaForm").hidden = true;
      disegnaScheda();
    }catch(e){ mostraErrore(e); }
  });

  /* ---------- Avvio ---------- */

  fotoNuovo = new PannelloFoto($("fotoNuovo"));
  fotoStato = new PannelloFoto($("fotoNota"), null, { senzaFase: true, senzaNota: true });
  fotoScheda = new PannelloFoto($("fotoScheda"), function(n){
    $("fotoSalva").hidden = !n;
    $("fotoSalva").textContent = n === 1 ? "Salva 1 foto" : "Salva " + n + " foto";
  });

  $("queueRetry").addEventListener("click", svuotaCoda);
  $("pinForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var pin = $("pin").value.trim(), btn = this.querySelector("button");
    if(!pin){ $("pin").focus(); return; }
    btn.disabled = true;
    $("pinErr").textContent = "";
    try{
      await B.entra(pin);
      $("pin").value = "";
      mostra();
      svuotaCoda();
    }catch(e){
      $("pinErr").textContent = e.status === 401 ? "PIN non corretto." : e.message;
    }finally{
      btn.disabled = false;
    }
  });
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
    mostraOperatore();
    mostra();
    await mostraCoda();
    svuotaCoda();
  })();
})();
