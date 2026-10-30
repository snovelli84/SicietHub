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
  fasi: ["Targhetta", "Ricevimento", "Installazione", "Collaudo", "Non conformità", "Altro"],
  // Le foto vengono ridotte a questo lato massimo (pixel) e qualità JPEG.
  foto: { latoMax: 2560, qualita: 0.85 },
  // Misure dell'etichetta adesiva (mm), per la stampa.
  etichetta: { larghezzaMm: 62, altezzaMm: 40 }
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
      if(opts.body) h["Content-Type"] = opts.body.type || "application/octet-stream";
      var q = "?path=" + encodeURIComponent(path || "") + (opts.rename ? "&rename=1" : "");
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
      r.push(fmtData(n.il) + " – " + n.da + (n.stato ? "  [Stato: " + n.stato + "]" : "") +
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

  // dir: cartella della scheda (vedi cartellaScheda); cartella: "Foto", "Documenti" o "".
  async function accoda(dir, cartella, nome, blob){
    // Copia in memoria: alcuni browser non salvano in IndexedDB i file di <input type=file>.
    var copy = new Blob([await blob.arrayBuffer()], { type: blob.type });
    await idb("coda", "readwrite", function(s){
      return s.add({ dir: dir, cartella: cartella, nome: nome, blob: copy, il: Date.now() });
    });
  }

  // Gli elementi accodati dalle prime versioni avevano job e tag invece di dir.
  function dirCoda(it){ return it.dir || percorso([it.job, it.tag]); }

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
        await B.put(percorso([dirCoda(it), it.cartella, it.nome]), it.blob, { rename: true });
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

  // Riquadro per aggiungere foto: fase, scatto/galleria, anteprima (con "×" per
  // togliere le foto venute male) e nota facoltativa. Usato nel nuovo
  // componente e nella scheda.
  function PannelloFoto(box, onCambio){
    var self = this, n = ++PannelloFoto.n;
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
      el("fieldset", null, [el("legend", { class: "hint", text: "Fase" }), this.fasi]),
      el("div", { class: "btns" }, [this.btnCam, el("button", { type: "button", class: "btn", text: "🖼️ Dalla galleria", onclick: function(){ gal.click(); } })]),
      cam, gal, this.griglia, this.notaBox
    ].forEach(function(x){ box.appendChild(x); });
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
    if(!s || !p.sel.length) return;
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

  // Disegna l'etichetta (QR a sinistra, commessa, JOB e TAG a destra) a 300 dpi.
  function disegnaEtichetta(s){
    var job = s.job, tag = s.tag;
    var mm = 300 / 25.4;
    var W = Math.round(cfg.etichetta.larghezzaMm * mm), H = Math.round(cfg.etichetta.altezzaMm * mm);
    var c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    var g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);

    var qr = qrcode(0, "M");
    qr.addData(urlScheda(s));
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
    testo("SICIET QUALITY" + (s.commessa ? " · " + s.commessa : ""), Math.round(2.4 * mm), "600", y, "#005baa");
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
    var url = disegnaEtichetta(s).toDataURL("image/png");
    $("etichettaImg").src = url;
    $("etichettaUrl").textContent = urlScheda(s);
    $("etichettaScarica").href = url;
    $("etichettaScarica").download = "Etichetta " + nomeFile([s.commessa, s.job, s.tag].filter(Boolean).join(" ")) + ".png";
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
    ["viewPin", "viewOperatore", "viewElenco", "viewNuovo", "viewScheda"].forEach(function(v){ $(v).hidden = v !== id; });
  }

  function mostra(){
    var q = new URLSearchParams(location.search);
    var c = q.get("c"), job = q.get("job"), tag = q.get("tag");
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
    if(cfg.chiediOperatore && !operatore()){
      stato.vista = "operatore";
      soloVista("viewOperatore");
      $("operatoreNome").focus();
      return;
    }
    if(q.has("nuovo")) return mostraNuovo(c, job);
    if(c && job && tag) return mostraScheda(c, job, tag);
    return mostraElenco(c, c && job);
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
      cr.appendChild(link("?", "Tutte le commesse"));
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
    $("filtroLabel").textContent = job ? "Cerca un TAG nel JOB " + job : c ? "Cerca un JOB nella commessa " + c : "Cerca una commessa";
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

  function disegnaElenco(){
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
    $("elencoVuoto").hidden = voci.length > 0;
    $("elencoVuoto").textContent = elencoVoci.length
      ? "Nessun risultato."
      : (job ? "Nessun componente in questo JOB." : c ? "Nessun JOB in questa commessa." : "Nessuna commessa: crea la prima scheda con \"Nuovo componente\".");
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
    cr.appendChild(link("?", "Tutte le commesse"));
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
  }

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
          var u = URL.createObjectURL(x.coda.blob);
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
  $("docInput").addEventListener("change", async function(){
    var files = Array.prototype.slice.call(this.files), s = stato.scheda;
    this.value = "";
    if(!s) return;
    try{
      for(var i = 0; i < files.length; i++) await accoda(cartellaScheda(s), "Documenti", nomeFile(files[i].name), files[i]);
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
      stato.scheda = await aggiornaScheda(s, function(d){
        var n = { il: new Date().toISOString(), da: autore() };
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
      stato.scheda = await aggiornaScheda(s, function(d){ d.campi = campi; });
      $("modificaForm").hidden = true;
      disegnaScheda();
    }catch(e){ mostraErrore(e); }
  });

  /* ---------- Avvio ---------- */

  fotoNuovo = new PannelloFoto($("fotoNuovo"));
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
