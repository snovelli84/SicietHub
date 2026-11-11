/*
 * SICIET INVENTRACK – INVENTARIO DI MAGAZZINO
 * -------------------------------------------
 * Si carica il report delle giacenze del gestionale, si contano gli articoli
 * (dal telefono, scrivendo il codice o fotografando la targhetta) e dal PC si
 * scarica l'Excel con quantità reali e differenze. Vedi README.md.
 */
var INVENTRACK_CONFIG = {
  // Indirizzo del servizio (Cloudflare Worker, vedi api/worker.js), es.
  // "https://siciet-inventrack.<nome-account>.workers.dev/api".
  // Finché è vuoto la pagina funziona IN PROVA: gli inventari restano solo
  // sul dispositivo su cui sono stati creati.
  api: "https://siciet-inventrack.amministrazione-c44.workers.dev/api",

  // Ogni quanti secondi si inviano i conteggi in attesa e si leggono quelli
  // fatti dagli altri dispositivi.
  aggiornaOgniSecondi: 20,

  // Righe mostrate nell'elenco prima di "Mostra altri".
  righeElenco: 150,

  // File per il gestionale: una riga per articolo, nel formato
  //   "CODICE" ; quantità; valore unitario
  // con 15 decimali e il punto come separatore decimale.
  csvDecimali: 15,

  // Versione mostrata in fondo alla pagina: aumentarla a ogni modifica,
  // insieme al numero ?v= di inventrack.js in index.html.
  versione: "1.9"
};

(function(){
  "use strict";

  var CONFIG = INVENTRACK_CONFIG, R = InvReport;
  var CDN = "https://cdn.jsdelivr.net/npm/";
  var PDFJS_URL = CDN + "pdfjs-dist@3.11.174/build/pdf.min.js";
  var PDFJS_WORKER_URL = CDN + "pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  var EXCELJS_URL = CDN + "exceljs@4.4.0/dist/exceljs.min.js";
  var TESSERACT_URL = CDN + "tesseract.js@5.1.1/dist/tesseract.min.js";
  var TOLLERANZA = 1e-7;

  /* ---------- Utilità ---------- */

  function $(id){ return document.getElementById(id); }
  function el(tag, attr){
    var n = document.createElement(tag);
    Object.keys(attr || {}).forEach(function(k){
      var v = attr[k];
      if(v === undefined || v === null || v === false) return;
      if(k === "text") n.textContent = v;
      else if(k === "class") n.className = v;
      else if(k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else if(v === true) n.setAttribute(k, "");
      else n.setAttribute(k, v);
    });
    for(var i = 2; i < arguments.length; i++){
      var f = arguments[i];
      if(f === undefined || f === null || f === false) continue;
      n.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
    }
    return n;
  }
  function svuota(n){ while(n.firstChild) n.removeChild(n.firstChild); return n; }
  // Come append, ma salta gli elementi vuoti (append scriverebbe "null" come testo).
  function accoda(n){
    for(var i = 1; i < arguments.length; i++) if(arguments[i]) n.appendChild(arguments[i]);
    return n;
  }

  function memoria(chiave, valore){
    try{
      if(valore === undefined) return localStorage.getItem("inventrack." + chiave) || "";
      if(valore === null) localStorage.removeItem("inventrack." + chiave);
      else localStorage.setItem("inventrack." + chiave, valore);
    }catch(_){}
    return valore;
  }

  function due(n){ return (n < 10 ? "0" : "") + n; }
  function oggi(){ var d = new Date(); return d.getFullYear() + "-" + due(d.getMonth() + 1) + "-" + due(d.getDate()); }
  function giornoDi(iso){ var d = new Date(iso); return d.getFullYear() + "-" + due(d.getMonth() + 1) + "-" + due(d.getDate()); }
  function dataIt(g){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(g || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function oraIt(iso){ var d = new Date(iso); return isNaN(d) ? "" : dataIt(giornoDi(iso)) + " " + due(d.getHours()) + ":" + due(d.getMinutes()); }
  function fmt(n){
    // Sempre con il punto delle migliaia (anche 5.000), dove il browser lo permette.
    try{ return Number(n).toLocaleString("it-IT", { maximumFractionDigits: 3, useGrouping: "always" }); }
    catch(_){ return Number(n).toLocaleString("it-IT", { maximumFractionDigits: 3 }); }
  }
  function fmtDiff(n){ return (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n)); }
  function euro(n){ return Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
  function arrotonda(n){ return Math.round(n * 1e6) / 1e6; }

  // Quantità scritta dall'operatore: la virgola o il punto sono i decimali
  // ("12,5" o "12.5"); il punto delle migliaia vale solo insieme alla virgola ("1.250,5").
  function quantitaScritta(s){
    s = String(s || "").replace(/\s/g, "");
    if(!s) return null;
    if(/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
    if(/^\d+([.,]\d+)?$/.test(s)) return Number(s.replace(",", "."));
    return null;
  }

  var toastTimer = null;
  function toast(msg, errore){
    var t = $("toast");
    t.textContent = msg;
    t.className = errore ? "errore" : "";
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.hidden = true; }, errore ? 6000 : 2600);
  }

  var script = {};
  function caricaScript(url){
    if(!script[url]) script[url] = new Promise(function(ok, no){
      var s = el("script", { src: url });
      s.onload = ok;
      s.onerror = function(){ delete script[url]; no(new Error("Non riesco a scaricare un componente da cdn.jsdelivr.net: controlla la connessione.")); };
      document.head.appendChild(s);
    });
    return script[url];
  }

  function scarica(nome, blob){
    var a = el("a", { href: URL.createObjectURL(blob), download: nome });
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ---------- Archivio sul dispositivo (IndexedDB) ----------
   * Tiene una copia degli inventari aperti e dei conteggi non ancora inviati:
   * in magazzino si continua a contare anche senza rete. */
  var kv = (function(){
    var promessa = null, riserva = {};
    function db(){
      if(!promessa) promessa = new Promise(function(ok, no){
        var r = indexedDB.open("siciet-inventrack", 1);
        r.onupgradeneeded = function(){ r.result.createObjectStore("kv"); };
        r.onsuccess = function(){ ok(r.result); };
        r.onerror = function(){ no(r.error); };
      });
      return promessa;
    }
    function op(modo, fn){
      return db().then(function(d){
        return new Promise(function(ok, no){
          var t = d.transaction("kv", modo), rq = fn(t.objectStore("kv"));
          t.oncomplete = function(){ ok(rq.result); };
          t.onerror = t.onabort = function(){ no(t.error); };
        });
      });
    }
    return {
      get: function(k){ return op("readonly", function(s){ return s.get(k); }).catch(function(){ return riserva[k]; }); },
      set: function(k, v){ riserva[k] = v; return op("readwrite", function(s){ return s.put(v, k); }).catch(function(){}); },
      del: function(k){ delete riserva[k]; return op("readwrite", function(s){ return s.delete(k); }).catch(function(){}); }
    };
  })();

  /* ---------- Servizio ---------- */

  function inProva(){ return !CONFIG.api; }

  async function api(metodo, percorso, corpo){
    var res, h = { "X-Password": memoria("password") };
    if(corpo !== undefined) h["Content-Type"] = "application/json";
    try{
      res = await fetch(CONFIG.api + percorso, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    }catch(_){
      var e = new Error("Connessione assente o servizio non raggiungibile.");
      e.rete = true;
      throw e;
    }
    var d = await res.json().catch(function(){ return {}; });
    if(!res.ok){
      var e2 = new Error(d.error || ("Errore " + res.status + " del servizio."));
      e2.status = res.status;
      if(res.status === 401){ memoria("password", null); mostraAccesso(e2.message); }
      throw e2;
    }
    return d;
  }

  /* ---------- Stato della pagina ---------- */

  var S = {
    inv: null,        // inventario aperto
    righe: [],        // righe del report
    indice: {},       // chiave → riga del report
    conteggi: {},     // chiave → conteggio
    da: 0,            // momento dell'ultima lettura dei conteggi dal servizio
    coda: [],         // conteggi da inviare: { inv, c }
    tab: "conta",
    filtro: "tutti",
    mostrati: 0,
    scheda: null,     // riga aperta nella scheda Conta
    ultimi: [],       // chiavi degli ultimi conteggi fatti qui
    fuoriData: {},    // inventari non di oggi su cui si è scelto di continuare
    nuovo: null,      // report letto nel modulo "Nuovo inventario"
    invio: false,
    senzaRete: false
  };

  function operatore(){ return memoria("operatore"); }

  /* ---------- Accesso ---------- */

  function mostra(vista){
    ["vAccesso", "vHome", "vNuovo", "vInv"].forEach(function(v){ $(v).hidden = v !== vista; });
    window.scrollTo(0, 0);
  }
  function intestazione(titolo, sotto){
    $("titolo").textContent = titolo;
    $("sottotitolo").textContent = sotto;
    $("utente").hidden = !operatore();
    $("utenteNome").textContent = operatore();
  }

  function mostraAccesso(errore){
    intestazione("Inventario di magazzino", "Magazzino aziendale e magazzini di commessa");
    $("utente").hidden = true;
    $("operatore").value = operatore();
    $("pwd").value = "";
    $("pwdCampo").hidden = inProva() || !!memoria("password");
    $("accessoErr").hidden = !errore;
    $("accessoErr").textContent = errore || "";
    mostra("vAccesso");
    (operatore() && !$("pwdCampo").hidden ? $("pwd") : $("operatore")).focus();
  }

  $("accessoForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var nome = R.pulisci($("operatore").value);
    if(!nome) return;
    memoria("operatore", nome);
    if(!inProva() && !$("pwdCampo").hidden){
      if(!$("pwd").value){ $("pwd").focus(); return; }
      memoria("password", $("pwd").value);
      $("accessoBtn").disabled = true;
      try{ await api("GET", "/ping"); }
      catch(e){
        if(e.status !== 401){ $("accessoErr").hidden = false; $("accessoErr").textContent = e.message; }
        if(!e.rete) memoria("password", null);
        return;
      }
      finally{ $("accessoBtn").disabled = false; }
    }
    naviga();
  });
  $("utenteCambia").addEventListener("click", function(){ mostraAccesso(); });

  /* ---------- Navigazione ---------- */

  function naviga(){
    if(!operatore() || (!inProva() && !memoria("password"))){ mostraAccesso(); return; }
    var h = location.hash.replace(/^#/, "");
    if(h === "nuovo") apriNuovo();
    else if(h.indexOf("i=") === 0) apriInventario(decodeURIComponent(h.slice(2)));
    else apriHome();
  }
  window.addEventListener("hashchange", naviga);

  /* ---------- Elenco degli inventari ---------- */

  function titoloInv(inv){ return inv.tipo === "commessa" ? "Commessa " + inv.commessa : "Magazzino aziendale"; }

  async function contaLocale(inv){
    var d = await kv.get("cnt:" + inv.id), n = { contati: 0, differenze: 0 };
    Object.keys((d && d.conteggi) || {}).forEach(function(k){
      var c = d.conteggi[k];
      if(c.reale === null) return;
      n.contati++;
      if(Math.abs(c.reale - c.attesa) > TOLLERANZA) n.differenze++;
    });
    return n;
  }

  async function apriHome(){
    S.inv = null;
    intestazione("Inventario di magazzino", "Magazzino aziendale e magazzini di commessa");
    $("provaAvviso").hidden = !inProva();
    $("offlineAvviso").hidden = true;
    mostra("vHome");
    var lista = $("lista");
    svuota(lista).appendChild(el("p", { class: "hint", text: "Caricamento…" }));
    var inventari = [];
    try{
      if(inProva()) inventari = (await kv.get("lista")) || [];
      else{
        inventari = (await api("GET", "/inventari")).inventari;
        kv.set("lista", inventari);
      }
    }catch(e){
      if(e.status === 401) return;
      inventari = (await kv.get("lista")) || [];
      $("offlineAvviso").hidden = false;
      $("offlineAvviso").textContent = e.message + " Qui sotto gli inventari già aperti su questo dispositivo.";
    }
    if(!$("offlineAvviso").hidden || inProva()){
      for(var i = 0; i < inventari.length; i++) Object.assign(inventari[i], await contaLocale(inventari[i]));
    }
    svuota(lista);
    if(!inventari.length){
      lista.appendChild(el("div", { class: "card" },
        el("h2", { text: "Nessun inventario" }),
        el("p", { class: "hint", text: "Stampa dal gestionale il report delle giacenze (Analisi Andamento Giacenza) e tocca “Nuovo inventario”." })));
      return;
    }
    inventari.forEach(function(inv){
      var contati = Math.min(inv.contati || 0, inv.righe), perc = inv.righe ? Math.round(100 * contati / inv.righe) : 0;
      var stato = inv.stato === "chiuso" ? el("span", { class: "chip", text: "Chiuso" })
        : inv.data === oggi() ? el("span", { class: "chip ok", text: "Oggi" })
        : el("span", { class: "chip warn", text: "Non di oggi" });
      lista.appendChild(el("div", { class: "invbox" }, el("button", { type: "button", class: "inv", onclick: function(){ location.hash = "i=" + encodeURIComponent(inv.id); } },
        el("div", { class: "riga spazio" }, el("strong", { text: titoloInv(inv) }), stato),
        el("div", { class: "hint", text: [dataIt(inv.data), inv.deposito && "deposito " + inv.deposito, inv.creatoDa].filter(Boolean).join(" · ") }),
        el("div", { class: "barra" }, el("i", { style: "width:" + perc + "%" })),
        el("div", { class: "riga spazio hint" },
          el("span", { text: fmt(inv.contati || 0) + " contati su " + fmt(inv.righe) + " articoli" }),
          inv.differenze ? el("span", { class: "chip diff", text: fmt(inv.differenze) + " differenze" }) : null)),
        el("div", { class: "riga" }, el("button", { type: "button", class: "linkbtn elimina", text: "🗑 Elimina inventario", onclick: function(){ elimina(inv); } }))));
    });
  }
  $("nuovoBtn").addEventListener("click", function(){ location.hash = "nuovo"; });

  /* ---------- Nuovo inventario ---------- */

  function tipoScelto(){ var r = document.querySelector("input[name=tipo]:checked"); return r ? r.value : ""; }

  function apriNuovo(){
    intestazione("Nuovo inventario", "Carica il report delle giacenze del gestionale");
    $("nuovoForm").reset();
    $("nData").value = oggi();
    $("nErr").hidden = true;
    S.nuovo = null;
    aggiornaNuovo.firma = null;
    aggiornaNuovo();
    mostra("vNuovo");
  }

  async function leggiPdf(file){
    await caricaScript(PDFJS_URL);
    var lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    var doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise, pagine = [];
    for(var n = 1; n <= doc.numPages; n++){
      var tc = await (await doc.getPage(n)).getTextContent();
      pagine.push({ items: tc.items.map(function(i){ return { s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }; }) });
    }
    return R.daPdf(pagine);
  }
  async function leggiExcel(file){
    await caricaScript(EXCELJS_URL);
    var wb = new window.ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    var tabella = [];
    wb.worksheets[0].eachRow({ includeEmpty: true }, function(row){
      var riga = [];
      row.eachCell({ includeEmpty: true }, function(cell, col){
        var v = cell.value;
        if(v && typeof v === "object") v = v instanceof Date ? "" : v.result !== undefined ? v.result : cell.text;
        riga[col - 1] = v === null || v === undefined ? "" : v;
      });
      tabella.push(riga);
    });
    return R.daTabella(tabella);
  }
  async function leggiReport(file){
    var nome = file.name.toLowerCase();
    if(/\.pdf$/.test(nome) || file.type === "application/pdf") return leggiPdf(file);
    if(/\.xlsx$/.test(nome)) return leggiExcel(file);
    if(/\.(csv|txt)$/.test(nome)) return R.daTabella(R.csv(await file.text()));
    throw new Error("Formato non riconosciuto: carica il PDF del report, oppure un file .xlsx o .csv.");
  }

  $("nFile").addEventListener("change", async function(){
    var f = this.files[0];
    S.nuovo = null;
    aggiornaNuovo.firma = null;
    $("nErr").hidden = true;
    svuota($("nEsito"));
    if(!f){ aggiornaNuovo(); return; }
    $("nEsito").appendChild(el("p", { class: "hint", text: "Lettura del report…" }));
    try{
      var r = await leggiReport(f);
      if(!r.righe.length) throw new Error("Nel file non ho trovato articoli: serve il report “Analisi Andamento Giacenza” con le colonne Articolo, Descrizione, Commessa e Saldo.");
      r.nome = f.name;
      S.nuovo = r;
      var commesse = Object.keys(r.info.commesse).filter(Boolean);
      // Una commessa sola, oppure una commessa con le sue varianti (tutte iniziano con il suo codice).
      var base = commesse.slice().sort(function(x, y){ return x.length - y.length; })[0] || "";
      var famiglia = commesse.length > 0 && commesse.length === Object.keys(r.info.commesse).length && commesse.every(function(x){ return x.indexOf(base) === 0; });
      if(!tipoScelto()) document.querySelector("input[name=tipo][value=" + (famiglia ? "commessa" : "generale") + "]").checked = true;
      if(!$("nCommessa").value && famiglia) $("nCommessa").value = base;
      if(!$("nDeposito").value && r.info.deposito) $("nDeposito").value = r.info.deposito;
    }catch(e){
      $("nErr").hidden = false;
      $("nErr").textContent = e.message || String(e);
    }
    aggiornaNuovo.firma = null;
    aggiornaNuovo();
  });

  // Righe del report che entrano nell'inventario: per una commessa solo le sue
  // (anche con la variante, es. S1852V31 per la commessa S1852).
  function righeNuovo(){
    var r = S.nuovo;
    if(!r) return { righe: [], scartate: 0, varianti: [] };
    if(tipoScelto() !== "commessa") return { righe: r.righe, scartate: 0, varianti: [] };
    var c = R.codice($("nCommessa").value);
    var righe = r.righe.filter(function(x){ return c && (x.commessa === c || x.commessa.indexOf(c) === 0); });
    var scartate = r.righe.length - righe.length, varianti = {};
    var scartateElenco = r.righe.filter(function(x){ return righe.indexOf(x) < 0; }).map(function(x){ return x.codice + " — commessa " + (x.commessa || "(nessuna)") + ", giacenza " + fmt(x.attesa); });
    righe.forEach(function(x){ if(x.commessa !== c) varianti[x.commessa] = 1; });
    varianti = Object.keys(varianti).sort();
    // Con le varianti nel report, la giacenza attesa di ogni articolo è la somma di commessa e varianti.
    var sommate = varianti.length > 0 && $("nSomma").checked;
    if(sommate) righe = R.sommaVarianti(righe, c);
    return { righe: righe, scartate: scartate, scartateElenco: scartateElenco, varianti: varianti, sommate: sommate };
  }

  function aggiornaNuovo(){
    // Se non è cambiato nulla il riepilogo non si ridisegna: altrimenti, uscendo da
    // un campo, il primo tocco su un elenco andrebbe perso.
    var firma = [tipoScelto(), $("nCommessa").value, $("nData").value, $("nSomma").checked, S.nuovo ? S.nuovo.nome + S.nuovo.righe.length : "", $("nErr").hidden].join("|");
    if(firma === aggiornaNuovo.firma && $("nEsito").firstChild) return;
    aggiornaNuovo.firma = firma;
    // Gli elenchi aperti restano aperti quando il riepilogo viene ridisegnato.
    var aperti = Array.prototype.map.call($("nEsito").querySelectorAll("details.codici"), function(d){ return d.open; });
    var tipo = tipoScelto(), r = S.nuovo, esito = svuota($("nEsito")), ok = !!r && !!tipo;
    $("commessaCampo").hidden = tipo !== "commessa";
    $("sommaCampo").hidden = true;
    if(r){
      var commesse = Object.keys(r.info.commesse), sel = righeNuovo(), data = $("nData").value;
      var valore = sel.righe.reduce(function(s, x){ return s + x.attesa * x.valore; }, 0);
      esito.appendChild(el("div", { class: "avviso bene" },
        el("b", { text: "Report letto: " + fmt(sel.righe.length) + " articoli" + (valore ? ", valore " + euro(valore) : "") }),
        el("span", { text: [r.nome,
          r.info.deposito && "deposito " + r.info.deposito,
          commesse.filter(Boolean).length && (commesse.length <= 4 ? "commesse: " + commesse.map(function(c){ return c || "(nessuna)"; }).join(", ") : commesse.length + " commesse"),
          r.info.tipo === "valorizzazione" && "giacenza al " + dataIt(r.info.finoAl),
          r.info.stampatoIl && "stampato il " + dataIt(r.info.stampatoIl),
          r.info.controllati && !r.info.nonQuadrano.length && "✓ " + fmt(r.info.controllati) + " articoli coincidono con i totali del report"].filter(Boolean).join(" · ") })));
      var avvisi = [];
      if(tipo === "commessa"){
        var c = R.codice($("nCommessa").value);
        if(!c){ ok = false; avvisi.push("Scrivi la commessa dell'inventario."); }
        else if(!sel.righe.length){ ok = false; avvisi.push("Il report non contiene articoli della commessa " + c + " (contiene: " + commesse.map(function(x){ return x || "nessuna commessa"; }).join(", ") + ")."); }
        else if(sel.scartate) avvisi.push({ testo: fmt(sel.scartate) + " righe del report sono di altre commesse e non entrano in questo inventario.", elenco: sel.scartateElenco });
        if(c && sel.varianti.length){
          $("sommaCampo").hidden = false;
          $("sommaTesto").textContent = "Il report contiene anche " + (sel.varianti.length === 1 ? "la variante " : sel.varianti.length + " varianti: ") + (sel.varianti.length <= 6 ? sel.varianti.join(", ") : sel.varianti.slice(0, 6).join(", ") + "…") + ".";
          if(sel.sommate){
            var negativi = sel.righe.filter(function(x){ return x.attesa < 0; });
            if(negativi.length) avvisi.push({ testo: fmt(negativi.length) + " articoli hanno giacenza attesa negativa anche sommando le varianti: nel gestionale risulta uscito più materiale di quanto ne sia entrato su questa commessa e sulle varianti (materiale caricato altrove, o un carico mancante).",
              elenco: negativi.map(function(x){ return x.codice + " — giacenza attesa " + fmt(x.attesa) + (x.dettaglio ? "  (" + mostraParti(x.dettaglio) + ")" : ""); }) });
          }
        } else if(c && sel.righe.length && !/V\d+$/.test(c)){
          avvisi.push("Il report contiene solo la commessa " + c + ". Se la commessa ha delle varianti (" + c + "V01, " + c + "V02…) su cui è stato scaricato materiale, ristampa il report da " + c + " a " + c + "ZZ: così la giacenza attesa tiene conto anche di quegli scarichi.");
        }
      } else if(tipo === "generale" && r.info.commessa && commesse.length === 1){
        avvisi.push("Il report è stato stampato per la sola commessa " + commesse[0] + ": se è l'inventario di quella commessa scegli “Magazzino di commessa”.");
      }
      if(r.info.stampatoIl && data && r.info.stampatoIl !== data) avvisi.push("Il report è stato stampato il " + dataIt(r.info.stampatoIl) + ", ma la data dell'inventario è il " + dataIt(data) + ": le giacenze attese potrebbero non essere quelle giuste. Meglio ristampare il report il giorno dell'inventario.");
      if(r.info.finoAl && data && r.info.finoAl < data) avvisi.push("Il report considera i movimenti solo fino al " + dataIt(r.info.finoAl) + ", ma l'inventario è del " + dataIt(data) + ": i movimenti successivi non sono compresi e le differenze potrebbero non essere vere. Meglio ristampare il report alla data dell'inventario.");
      if(data && data !== oggi()) avvisi.push("La data dell'inventario non è oggi (" + dataIt(oggi()) + ").");
      if(r.info.nonQuadrano && r.info.nonQuadrano.length) avvisi.push({ testo: "Per " + fmt(r.info.nonQuadrano.length) + " articoli su " + fmt(r.info.controllati) + " la giacenza letta non coincide con il totale stampato dal report (entrate − uscite). Controlla questi articoli prima di contare.",
        elenco: r.info.nonQuadrano.map(function(x){ return x.codice + " — letto " + fmt(x.letto) + ", totale del report " + fmt(x.totale); }) });
      if(r.info.ripetuti) avvisi.push({ testo: fmt(r.info.ripetuti) + " righe ripetevano lo stesso articolo e la stessa commessa: le quantità sono state sommate.",
        elenco: (r.info.ripetutiElenco || []).map(function(x){ return x.codice + " — commessa " + (x.commessa || "(nessuna)") + ", quantità della riga ripetuta " + fmt(x.quantita); }) });
      if(avvisi.length) esito.appendChild(el("div", { class: "avviso" }, el("ul", {}, ...avvisi.map(function(a){
        if(typeof a === "string") return el("li", { text: a });
        // Elenco completo dei codici, da aprire e copiare.
        var testo = a.elenco.join("\n");
        return el("li", {}, a.testo, el("details", { class: "codici" },
          el("summary", { text: "Vedi l'elenco (" + fmt(a.elenco.length) + ")" }),
          el("button", { type: "button", class: "btn small", text: "Copia l'elenco", onclick: function(){
            var b = this;
            (navigator.clipboard ? navigator.clipboard.writeText(testo) : Promise.reject()).then(function(){ b.textContent = "Copiato ✓"; }, function(){ b.textContent = "Seleziona il testo e copialo a mano"; });
          } }),
          el("pre", { text: testo })));
      }))));
    }
    Array.prototype.forEach.call(esito.querySelectorAll("details.codici"), function(d, i){ if(aperti[i]) d.open = true; });
    if(!$("nData").value) ok = false;
    $("nCrea").disabled = !ok;
  }
  ["change", "input"].forEach(function(ev){
    $("nuovoForm").addEventListener(ev, function(e){ if(e.target.id !== "nFile") aggiornaNuovo(); });
  });

  $("nuovoForm").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var sel = righeNuovo(), tipo = tipoScelto(), r = S.nuovo;
    if(!r || !sel.righe.length) return;
    var dati = {
      tipo: tipo,
      commessa: tipo === "commessa" ? R.codice($("nCommessa").value) : "",
      deposito: R.codice($("nDeposito").value),
      data: $("nData").value,
      note: R.pulisci($("nNote").value),
      righe: sel.righe.length,
      operatore: operatore(),
      report: { nome: r.nome, stampatoIl: r.info.stampatoIl, finoAl: r.info.finoAl, commessa: r.info.commessa, deposito: r.info.deposito }
    };
    var btn = $("nCrea");
    btn.disabled = true;
    $("nErr").hidden = true;
    try{
      var id;
      if(inProva()){
        id = dati.data.replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 10) + "prova";
      } else {
        id = (await api("POST", "/inventari", dati)).id;
        var n = 500;
        for(var i = 0; i * n < sel.righe.length; i++){
          btn.textContent = "Caricamento… " + Math.round(100 * i * n / sel.righe.length) + "%";
          await api("POST", "/inventari/" + id + "/report?parte=" + i, sel.righe.slice(i * n, (i + 1) * n));
        }
        await api("POST", "/inventari/" + id + "/pronto");
      }
      var inv = Object.assign({}, dati, { id: id, stato: "aperto", creatoDa: operatore(), creatoIl: new Date().toISOString(), chiusoDa: "", chiusoIl: "" });
      delete inv.operatore;
      await kv.set("inv:" + id, { inv: inv, righe: sel.righe });
      if(inProva()) await kv.set("lista", [inv].concat((await kv.get("lista")) || []));
      location.hash = "i=" + encodeURIComponent(id);
    }catch(e){
      $("nErr").hidden = false;
      $("nErr").textContent = e.message || String(e);
    }finally{
      btn.textContent = "Crea inventario";
      btn.disabled = false;
    }
  });

  /* ---------- Inventario aperto ---------- */

  function righeTutte(){
    // Le righe del report più gli articoli trovati in magazzino e non presenti nel report.
    var extra = [];
    Object.keys(S.conteggi).forEach(function(k){
      var c = S.conteggi[k];
      if(!S.indice[k] && c.reale !== null) extra.push({ codice: c.codice, descrizione: c.descrizione, commessa: c.commessa, attesa: 0, valore: 0, extra: true });
    });
    extra.sort(function(a, b){ return a.codice < b.codice ? -1 : 1; });
    return S.righe.concat(extra);
  }
  function conteggioDi(r){
    var c = S.conteggi[R.chiave(r.codice, r.commessa)];
    return c && c.reale !== null ? c : null;
  }
  function statoRiga(r){
    var c = conteggioDi(r);
    if(!c) return "da";
    return Math.abs(c.reale - r.attesa) > TOLLERANZA ? "diff" : "ok";
  }
  function numeri(){
    var n = { righe: S.righe.length, contati: 0, ok: 0, diff: 0, piu: 0, meno: 0, extra: 0, valore: 0 };
    righeTutte().forEach(function(r){
      var c = conteggioDi(r);
      if(!c) return;
      if(r.extra) n.extra++; else n.contati++;
      var d = c.reale - r.attesa;
      if(Math.abs(d) <= TOLLERANZA){ n.ok++; return; }
      n.diff++;
      if(d > 0) n.piu++; else n.meno++;
      n.valore += d * r.valore;
    });
    n.da = n.righe - n.contati;
    return n;
  }

  function blocco(){
    // Perché non si può contare (stringa vuota = si può).
    var inv = S.inv;
    if(inv.stato === "chiuso") return "L'inventario è chiuso" + (inv.chiusoDa ? " (da " + inv.chiusoDa + ", " + oraIt(inv.chiusoIl) + ")" : "") + ": le quantità non si possono più modificare.";
    if(inv.data !== oggi() && !S.fuoriData[inv.id]) return "Questo inventario è del " + dataIt(inv.data) + " e oggi è il " + dataIt(oggi()) + ".";
    return "";
  }

  async function apriInventario(id){
    if(S.inv && S.inv.id === id){ mostra("vInv"); disegnaInventario(); return; }
    intestazione("Inventario", "Caricamento…");
    mostra("vInv");
    ["invTesta", "tEsporta", "suggerimenti", "elenco"].forEach(function(x){ svuota($(x)); });
    $("scheda").hidden = true;
    $("dataAvviso").hidden = true;
    var locale = await kv.get("inv:" + id), inv = locale && locale.inv, righe = locale && locale.righe;
    try{
      if(!inProva()){
        try{ inv = (await api("GET", "/inventari/" + id)).inventario; S.senzaRete = false; }
        catch(e){ if(!e.rete || !inv) throw e; S.senzaRete = true; }
        if(!righe) righe = (await api("GET", "/inventari/" + id + "/report")).righe;
        await kv.set("inv:" + id, { inv: inv, righe: righe });
      }
      if(!inv || !righe) throw new Error("Inventario non trovato su questo dispositivo.");
    }catch(e){
      if(e.status === 401) return;
      if(e.status === 404){ kv.del("inv:" + id); kv.del("cnt:" + id); }
      toast(e.message, true);
      location.hash = "";
      return;
    }
    var cnt = (await kv.get("cnt:" + id)) || { conteggi: {}, da: 0 };
    S.inv = inv;
    S.righe = righe;
    S.indice = {};
    S.commesse = null;
    righe.forEach(function(r){ S.indice[R.chiave(r.codice, r.commessa)] = r; });
    S.conteggi = cnt.conteggi;
    S.da = cnt.da;
    S.coda = (await kv.get("coda")) || [];
    S.tab = window.matchMedia("(min-width: 800px)").matches && numeri().contati ? "elenco" : "conta";
    S.filtro = "tutti";
    S.scheda = null;
    S.ultimi = [];
    $("codice").value = "";
    $("elencoCerca").value = "";
    disegnaInventario();
    sincronizza();
  }

  function disegnaTesta(){
    var inv = S.inv, n = numeri(), perc = n.righe ? Math.round(100 * n.contati / n.righe) : 0;
    intestazione(titoloInv(inv), "Inventario del " + dataIt(inv.data) + (inv.deposito ? " · deposito " + inv.deposito : ""));
    svuota($("invTesta"));
    $("invTesta").append(
      el("div", { class: "riga spazio" },
        el("a", { href: "#", class: "linkbtn", text: "‹ Tutti gli inventari" }),
        inv.stato === "chiuso" ? el("span", { class: "chip", text: "Chiuso" }) : inv.data === oggi() ? el("span", { class: "chip ok", text: "Oggi" }) : el("span", { class: "chip warn", text: "Non di oggi" })),
      el("div", { class: "barra" }, el("i", { style: "width:" + perc + "%" })),
      el("div", { class: "riga spazio hint" },
        el("span", { text: fmt(n.contati) + " contati su " + fmt(n.righe) + " articoli (" + perc + "%)" }),
        el("span", { class: "riga" },
          n.diff ? el("span", { class: "chip diff", text: fmt(n.diff) + " differenze" }) : null,
          n.extra ? el("span", { class: "chip warn", text: fmt(n.extra) + " non nel report" }) : null)));
    if(inv.note) $("invTesta").appendChild(el("div", { class: "hint", text: "Note: " + inv.note }));
  }

  function disegnaAvvisoData(){
    var a = svuota($("dataAvviso")), inv = S.inv;
    a.hidden = true;
    if(inv.stato === "chiuso"){ a.hidden = false; a.className = "avviso info"; a.appendChild(el("span", { text: blocco() })); return; }
    if(inv.data === oggi()) return;
    a.hidden = false;
    a.className = "avviso";
    if(S.fuoriData[inv.id]){
      a.appendChild(el("span", { text: "Stai contando in un giorno diverso dalla data dell'inventario (" + dataIt(inv.data) + "): nell'Excel questi conteggi saranno segnalati." }));
      return;
    }
    a.append(
      el("b", { text: "Inventario del " + dataIt(inv.data) + ": oggi è il " + dataIt(oggi()) }),
      el("span", { text: "Un inventario vale per il giorno in cui viene fatto: le giacenze attese sono quelle del report di quel giorno e nel frattempo il magazzino può essere cambiato. Per contare oggi conviene creare un nuovo inventario con il report di oggi." }),
      el("div", { class: "riga" },
        el("a", { class: "btn small primary", href: "#nuovo", text: "Nuovo inventario di oggi" }),
        el("button", { class: "btn small", type: "button", text: "Continua comunque questo", onclick: function(){ S.fuoriData[inv.id] = true; disegnaInventario(); } })));
  }

  function disegnaInventario(){
    disegnaTesta();
    disegnaAvvisoData();
    Array.prototype.forEach.call($("tabs").children, function(b){ b.classList.toggle("attivo", b.dataset.tab === S.tab); });
    $("tConta").hidden = S.tab !== "conta";
    $("tElenco").hidden = S.tab !== "elenco";
    $("tEsporta").hidden = S.tab !== "esporta";
    if(S.tab === "conta"){ disegnaSuggerimenti(); disegnaScheda(); disegnaUltimi(); }
    if(S.tab === "elenco") disegnaElenco(true);
    if(S.tab === "esporta") disegnaEsporta();
    disegnaSync();
  }
  $("tabs").addEventListener("click", function(ev){
    var b = ev.target.closest("button");
    if(!b) return;
    S.tab = b.dataset.tab;
    disegnaInventario();
  });

  /* ---------- Ricerca dell'articolo ---------- */

  function trova(q, righe, max){
    var c = R.canon(q), parole = q.toLowerCase().split(/\s+/).filter(Boolean), out = [];
    if(!c && !parole.length) return out;
    righe.forEach(function(r){
      var rc = R.canon(r.codice), p = 0;
      if(c && rc === c) p = 100;
      else if(c && rc.indexOf(c) === 0) p = 80;
      else if(c && c.length >= 2 && rc.indexOf(c) > 0) p = 60;
      else{
        var d = r.descrizione.toLowerCase();
        if(parole.every(function(w){ return d.indexOf(w) >= 0; })) p = 40;
      }
      if(p) out.push({ riga: r, punti: p });
    });
    out.sort(function(a, b){ return b.punti - a.punti || (a.riga.codice < b.riga.codice ? -1 : 1); });
    return max ? out.slice(0, max) : out;
  }

  // "S1852: 10900 · S1852V04: -500" → [{ commessa, q }]
  function leggiParti(t){
    return String(t || "").split(" · ").map(function(x){
      var p = x.split(": ");
      return p.length === 2 && p[0] ? { commessa: p[0], q: Number(p[1].replace(",", ".")) } : null;
    }).filter(function(x){ return x && isFinite(x.q); });
  }
  function scriviParti(parti){ return parti.map(function(x){ return x.commessa + ": " + String(x.q).replace(".", ","); }).join(" · "); }
  function mostraParti(t){ return leggiParti(t).map(function(x){ return x.commessa + ": " + fmt(x.q); }).join(" · "); }
  // Commesse (padre e varianti) presenti nell'inventario, se è stato creato sommando le varianti.
  function commesseInventario(){
    if(!S.commesse){
      var viste = {};
      S.righe.forEach(function(r){ leggiParti(r.dettaglio).forEach(function(x){ viste[x.commessa] = 1; }); });
      S.commesse = Object.keys(viste).sort();
    }
    return S.commesse;
  }

  function conUm(n, r){ return fmt(n) + (r.um ? " " + r.um : ""); }

  function voce(r, onclick){
    var c = conteggioDi(r), st = statoRiga(r), qta = el("span", { class: "qta" });
    if(c){
      qta.append(el("span", { text: fmt(r.attesa) + " → " + conUm(c.reale, r) }),
        st === "diff" ? el("span", { class: "chip diff", text: fmtDiff(c.reale - r.attesa) }) : el("span", { class: "chip ok", text: "✓ confermata" }));
    } else qta.append(el("span", { text: "attesa " + conUm(r.attesa, r) }), el("span", { class: "chip", text: "da contare" }));
    return el("button", { type: "button", class: "voce", onclick: onclick },
      el("span", { class: "cod", text: r.codice + (S.inv.tipo === "generale" && r.commessa ? "  · " + r.commessa : "") }),
      el("span", { class: "des", text: (r.extra ? "Non nel report · " : "") + r.descrizione }),
      qta);
  }

  function disegnaSuggerimenti(){
    var box = svuota($("suggerimenti")), q = R.pulisci($("codice").value);
    if(!q) return;
    var trovati = trova(q, righeTutte(), 8);
    trovati.forEach(function(t){ box.appendChild(voce(t.riga, function(){ apriScheda(t.riga); })); });
    var esatto = trovati.length && trovati[0].punti === 100;
    // Se il codice scritto non è nell'elenco si può sempre aggiungerlo come nuovo.
    if(!esatto && R.canon(q).length >= 2 && !blocco()){
      box.appendChild(el("button", { type: "button", class: "voce nuovo", onclick: function(){ apriScheda({ codice: R.codice(q), descrizione: "", commessa: S.inv.commessa || "", attesa: 0, valore: 0, extra: true, nuovo: true }); } },
        el("span", { class: "cod", text: "➕ " + R.codice(q) }),
        el("span", { class: "des", text: "Non è nell'elenco? Aggiungilo come nuovo codice trovato in magazzino" })));
    }
    if(!trovati.length && blocco()) box.appendChild(el("p", { class: "hint", text: "Nessun articolo trovato." }));
  }
  $("codice").addEventListener("input", function(){
    if(S.scheda){ S.scheda = null; disegnaScheda(); }
    disegnaSuggerimenti();
  });
  $("codice").addEventListener("keydown", function(ev){
    if(ev.key !== "Enter") return;
    ev.preventDefault();
    // Invio (anche da un lettore di codici a barre): si apre l'articolo se è uno solo.
    var t = trova(R.pulisci(this.value), righeTutte(), 3);
    if(t.length && (t[0].punti === 100 && (t.length === 1 || t[1].punti < 100) || t.length === 1)) apriScheda(t[0].riga);
  });

  /* ---------- Scheda dell'articolo: conferma o quantità reale ---------- */

  function apriScheda(r){
    S.scheda = r;
    S.tab = "conta";
    $("codice").value = r.codice;
    disegnaInventario();
    $("scheda").scrollIntoView({ block: "nearest", behavior: "smooth" });
    if(r.nuovo && $("sReale")) $("sReale").focus();
  }
  function chiudiScheda(){
    S.scheda = null;
    $("codice").value = "";
    disegnaInventario();
    $("codice").focus();
  }

  /* ---------- Commesse collegate (varianti) ----------
   * S1852V12 è collegata alla commessa S1852. Se nello stesso giorno ci
   * sono inventari di commesse collegate, un codice che manca in uno ma c'è nel
   * report dell'altro viene segnalato: probabilmente va contato là. */
  // Una commessa è collegata a tutte quelle il cui codice inizia con il suo
  // (S1852 con S1852V12 e S1852V31); due varianti tra loro non lo sono.
  function collegate(a, b){
    a = R.codice(a); b = R.codice(b);
    return !!a && !!b && a !== b && (a.indexOf(b) === 0 || b.indexOf(a) === 0);
  }

  var collegatiCache = null;
  async function inventariCollegati(){
    var inv = S.inv;
    if(inv.tipo !== "commessa") return [];
    if(collegatiCache && collegatiCache.id === inv.id && Date.now() - collegatiCache.t < 60000) return collegatiCache.v;
    var lista;
    try{ lista = inProva() ? ((await kv.get("lista")) || []) : (await api("GET", "/inventari")).inventari; }
    catch(_){ lista = (await kv.get("lista")) || []; }
    var out = [];
    for(var i = 0; i < lista.length; i++){
      var x = lista[i];
      if(x.id === inv.id || x.tipo !== "commessa" || x.data !== inv.data || !collegate(x.commessa, inv.commessa)) continue;
      var loc = await kv.get("inv:" + x.id), righe = loc && loc.righe;
      if(!righe && !inProva()){
        try{
          righe = (await api("GET", "/inventari/" + x.id + "/report")).righe;
          await kv.set("inv:" + x.id, { inv: x, righe: righe });
        }catch(_){}
      }
      if(righe) out.push({ inv: x, righe: righe });
    }
    collegatiCache = { id: inv.id, t: Date.now(), v: out };
    return out;
  }

  async function cercaCollegati(r){
    var box = $("collegati"), trovati = [];
    if(!box) return;
    try{
      (await inventariCollegati()).forEach(function(c){
        var t = R.cerca([r.codice], c.righe).filter(function(x){ return x.punti >= 90; })[0];
        if(t) trovati.push({ inv: c.inv, riga: t.riga });
      });
    }catch(_){}
    if(S.scheda !== r || $("collegati") !== box) return; // nel frattempo si è cambiato articolo
    trovati.forEach(function(t){
      box.appendChild(el("div", { class: "avviso errore" },
        el("b", { text: "⚠️ Il codice è nel report della commessa collegata " + t.inv.commessa }),
        el("span", { text: "Lo stesso giorno (" + dataIt(t.inv.data) + ") esiste anche l'inventario della commessa " + t.inv.commessa + ", collegata alla " + S.inv.commessa + ". Nel suo report c'è " + t.riga.codice + (t.riga.descrizione ? " (" + t.riga.descrizione + ")" : "") + ", giacenza attesa " + fmt(t.riga.attesa) + ". Probabilmente l'articolo appartiene a quella commessa e va contato là. Aggiungilo qui sotto solo se sei sicuro che sia della " + S.inv.commessa + "." }),
        el("div", { class: "riga" }, el("a", { class: "btn small primary", href: "#i=" + encodeURIComponent(t.inv.id), text: "Apri l'inventario " + t.inv.commessa }))));
    });
  }

  function disegnaScheda(){
    var box = svuota($("scheda")), r = S.scheda;
    box.hidden = !r;
    $("suggerimenti").hidden = !!r;
    if(!r) return;
    var c = conteggioDi(r), perche = blocco(), st = statoRiga(r);
    accoda(box,
      el("div", { class: "riga spazio" },
        el("span", { class: "scheda-codice", text: r.codice }),
        el("span", { class: "riga" },
          r.commessa ? el("span", { class: "chip", text: r.commessa + (r.dettaglio ? " + varianti" : "") }) : null,
          r.extra ? el("span", { class: "chip warn", text: "Non nel report" }) : null)),
      r.nuovo ? null : el("div", { text: r.descrizione }));
    if(r.nuovo){
      accoda(box,
        el("div", { id: "collegati", style: "display:grid;gap:10px" }),
        el("div", { class: "avviso", text: "Questo codice non è nel report del gestionale. Controlla di averlo scritto bene: se l'articolo c'è davvero in magazzino, scrivi la quantità trovata." }),
        el("label", { class: "field" }, el("span", { class: "flabel", text: "Descrizione (facoltativa)" }), el("input", { type: "text", id: "sDescr", maxlength: "300" })),
        S.inv.tipo === "generale" ? el("label", { class: "field" }, el("span", { class: "flabel", text: "Commessa (facoltativa)" }), el("input", { type: "text", id: "sCommessa", class: "maiuscolo", maxlength: "30" })) : null);
    } else {
      box.appendChild(el("div", { class: "attesa" }, el("small", { text: "Giacenza attesa" + (r.um ? " (" + r.um + ")" : "") }), el("b", { text: fmt(r.attesa) })));
      if(r.dettaglio){
        // Giacenza del gestionale commessa per commessa: la somma è la giacenza attesa.
        box.appendChild(el("details", { class: "dettaglio" },
          el("summary", { text: "Somma della commessa e delle varianti" }),
          el("div", { text: mostraParti(r.dettaglio) })));
      }
    }
    if(r.nuovo) cercaCollegati(r);
    if(c){
      var d = c.reale - r.attesa;
      box.appendChild(el("div", { class: "avviso " + (st === "diff" ? "errore" : "bene") },
        el("b", { text: st === "diff" ? "Già contato: giacenza reale " + fmt(c.reale) + " (differenza " + fmtDiff(d) + ")" : "Già contato: giacenza confermata" }),
        c.parti ? el("span", { text: "Per commessa: " + mostraParti(c.parti) }) : null,
        el("span", { text: [c.operatore, oraIt(c.quando), c.nota && "nota: " + c.nota].filter(Boolean).join(" · ") })));
    }
    if(perche){
      box.appendChild(el("div", { class: "avviso info", text: perche + (S.inv.stato === "chiuso" ? "" : " Per contare scegli “Continua comunque questo” qui sopra.") }));
      box.appendChild(el("button", { class: "btn", type: "button", text: "Chiudi", onclick: chiudiScheda }));
      return;
    }
    var nota = el("input", { type: "text", id: "sNota", maxlength: "300", placeholder: "Nota (facoltativa), es. scatola danneggiata", value: c ? c.nota : "" });
    var reale = el("input", { type: "text", id: "sReale", inputmode: "decimal", autocomplete: "off", placeholder: "Quantità reale", "aria-label": "Giacenza reale" });
    var anteprima = el("div", { id: "anteprima" });
    reale.addEventListener("input", function(){
      var q = quantitaScritta(reale.value);
      reale.classList.remove("invalid");
      anteprima.className = "";
      if(reale.value.trim() === "") anteprima.textContent = "";
      else if(q === null) anteprima.textContent = "Scrivi solo un numero, es. 12 oppure 12,5";
      else if(r.nuovo) anteprima.textContent = "Quantità trovata: " + fmt(q);
      else if(Math.abs(q - r.attesa) <= TOLLERANZA){ anteprima.textContent = "Uguale alla giacenza attesa"; anteprima.className = "ok"; }
      else{ anteprima.textContent = "Giacenza reale " + fmt(q) + " · differenza " + fmtDiff(q - r.attesa); anteprima.className = "diff"; }
    });
    /* Divisione per commessa: quanto c'è per la commessa padre e quanto per ogni
     * variante. La giacenza reale è la somma; la differenza resta sul totale. */
    var campiParti = [], boxParti = null, tutte = r.nuovo ? [] : commesseInventario();
    function sommaParti(){
      var usati = campiParti.filter(function(x){ return x.input.value.trim() !== ""; });
      if(!usati.length) return null;
      var tot = 0, errore = false;
      usati.forEach(function(x){
        var q = quantitaScritta(x.input.value);
        x.input.classList.toggle("invalid", q === null);
        if(q === null) errore = true; else tot += q;
      });
      return errore ? NaN : arrotonda(tot);
    }
    function aggiornaParti(){
      var tot = sommaParti();
      reale.readOnly = tot !== null;
      if(tot !== null){ reale.value = isNaN(tot) ? "" : String(tot).replace(".", ","); reale.dispatchEvent(new Event("input")); }
      if(tot !== null && isNaN(tot)) anteprima.textContent = "Scrivi solo numeri, es. 12 oppure 12,5";
    }
    function rigaParte(commessa, libro, valore){
      var input = el("input", { type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "0", "aria-label": "Giacenza reale " + commessa, value: valore === undefined ? "" : String(valore).replace(".", ",") });
      input.addEventListener("input", aggiornaParti);
      campiParti.push({ commessa: commessa, input: input });
      return el("label", { class: "parte" },
        el("span", {}, el("b", { text: commessa }), libro === undefined ? null : el("small", { text: "gestionale " + fmt(libro) })),
        input);
    }
    if(tutte.length){
      var libro = {}, gia = {}, elenco = [];
      leggiParti(r.dettaglio).forEach(function(x){ libro[x.commessa] = x.q; });
      leggiParti(c && c.parti).forEach(function(x){ gia[x.commessa] = x.q; });
      // Prima la commessa dell'inventario, poi le varianti dell'articolo e quelle già contate.
      [S.inv.commessa].concat(Object.keys(libro), Object.keys(gia)).forEach(function(k){ if(k && elenco.indexOf(k) < 0) elenco.push(k); });
      var righeParti = el("div", { class: "parti" }, ...elenco.map(function(k){ return rigaParte(k, libro[k], gia[k]); }));
      var altre = tutte.filter(function(k){ return elenco.indexOf(k) < 0; });
      var scelta = altre.length ? el("select", { "aria-label": "Aggiungi una variante" }, el("option", { value: "", text: "+ Aggiungi un'altra variante…" }), ...altre.map(function(k){ return el("option", { value: k, text: k }); })) : null;
      if(scelta) scelta.addEventListener("change", function(){
        if(!scelta.value) return;
        var riga = rigaParte(scelta.value);
        righeParti.appendChild(riga);
        scelta.querySelector('option[value="' + scelta.value + '"]').remove();
        scelta.value = "";
        if(scelta.options.length < 2) scelta.hidden = true;
        riga.querySelector("input").focus();
      });
      boxParti = el("details", { class: "dettaglio dividi", open: Object.keys(gia).length > 0 },
        el("summary", { text: "Dividi per commessa (" + S.inv.commessa + " e varianti)" }),
        el("p", { text: "Scrivi quanto c'è per ogni commessa: la giacenza reale è la somma. Lascia vuote quelle dove non c'è nulla." }),
        righeParti, scelta);
    }

    function salvaReale(){
      var q = quantitaScritta(reale.value);
      var tot = sommaParti();
      if(tot !== null && isNaN(tot)){ campiParti.filter(function(x){ return x.input.classList.contains("invalid"); })[0].input.focus(); return; }
      if(tot !== null){
        salvaConteggio(r, tot, nota.value, scriviParti(campiParti.filter(function(x){ return x.input.value.trim() !== ""; }).map(function(x){ return { commessa: x.commessa, q: arrotonda(quantitaScritta(x.input.value)) }; })));
        return;
      }
      if(q === null){ reale.classList.add("invalid"); reale.focus(); return; }
      if(r.nuovo){
        var des = $("sDescr");
        r = { codice: r.codice, descrizione: R.pulisci(des.value), commessa: $("sCommessa") ? R.codice($("sCommessa").value) : r.commessa, attesa: 0, valore: 0, extra: true };
        var esiste = S.indice[R.chiave(r.codice, r.commessa)];
        if(esiste) r = esiste;
      }
      salvaConteggio(r, q, nota.value);
    }
    reale.addEventListener("keydown", function(ev){ if(ev.key === "Enter"){ ev.preventDefault(); salvaReale(); } });
    if(!r.nuovo){
      box.append(
        el("button", { class: "btn ok grande", type: "button", text: "✅ Confermo: sono " + fmt(r.attesa), onclick: function(){ salvaConteggio(r, r.attesa, nota.value); } }),
        el("div", { class: "oppure", text: "oppure scrivi la giacenza reale" }));
    }
    box.append(
      el("div", { class: "reale" }, reale, el("button", { class: "btn primary", type: "button", text: "Salva", onclick: salvaReale })),
      anteprima);
    if(boxParti){
      box.appendChild(boxParti);
      campiParti.forEach(function(x){ x.input.addEventListener("keydown", function(ev){ if(ev.key === "Enter"){ ev.preventDefault(); salvaReale(); } }); });
      if(Object.keys(leggiParti(c && c.parti)).length) aggiornaParti();
    }
    box.append(nota,
      el("div", { class: "riga spazio" },
        el("button", { class: "linkbtn", type: "button", text: "Chiudi senza salvare", onclick: chiudiScheda }),
        c ? el("button", { class: "linkbtn", type: "button", text: "Annulla il conteggio", onclick: function(){
          if(confirm("Annullare il conteggio di " + r.codice + "? L'articolo torna tra quelli da contare.")) salvaConteggio(r, null, "");
        } }) : null));
  }

  function salvaConteggio(r, reale, nota, parti){
    var k = R.chiave(r.codice, r.commessa);
    var c = {
      chiave: k, codice: r.codice, commessa: r.commessa, descrizione: r.descrizione, attesa: r.attesa,
      reale: reale === null ? null : arrotonda(reale), nota: R.pulisci(nota), operatore: operatore(),
      quando: new Date().toISOString(), extra: !!r.extra, parti: reale === null ? "" : (parti || "")
    };
    S.conteggi[k] = c;
    kv.set("cnt:" + S.inv.id, { conteggi: S.conteggi, da: S.da });
    if(!inProva()){
      // In coda resta solo l'ultimo conteggio di ogni articolo.
      S.coda = S.coda.filter(function(x){ return !(x.inv === S.inv.id && x.c.chiave === k); });
      S.coda.push({ inv: S.inv.id, c: c });
      kv.set("coda", S.coda);
    }
    S.ultimi = [k].concat(S.ultimi.filter(function(x){ return x !== k; })).slice(0, 5);
    if(reale === null) toast(r.codice + ": conteggio annullato");
    else if(Math.abs(reale - r.attesa) <= TOLLERANZA) toast("✓ " + r.codice + ": confermati " + fmt(reale));
    else toast(r.codice + ": salvati " + fmt(reale) + " (differenza " + fmtDiff(reale - r.attesa) + ")");
    chiudiScheda();
    inviaCoda();
  }

  function disegnaUltimi(){
    var box = svuota($("ultimi")), tutte = righeTutte();
    var righe = S.ultimi.map(function(k){ return tutte.filter(function(r){ return R.chiave(r.codice, r.commessa) === k; })[0]; }).filter(Boolean);
    $("ultimiCard").hidden = !righe.length || !!S.scheda;
    righe.forEach(function(r){ box.appendChild(voce(r, function(){ apriScheda(r); })); });
  }

  /* ---------- Elenco ---------- */

  var FILTRI = [["tutti", "Tutti"], ["da", "Da contare"], ["ok", "Confermati"], ["diff", "Differenze"]];

  function disegnaElenco(daCapo){
    var tutte = righeTutte(), q = R.pulisci($("elencoCerca").value), conta = { tutti: tutte.length, da: 0, ok: 0, diff: 0 };
    tutte.forEach(function(r){ conta[statoRiga(r)]++; });
    var f = svuota($("filtri"));
    FILTRI.forEach(function(x){
      f.appendChild(el("button", { type: "button", class: S.filtro === x[0] ? "attivo" : "", text: x[1] + " (" + fmt(conta[x[0]]) + ")", onclick: function(){ S.filtro = x[0]; disegnaElenco(true); } }));
    });
    var righe = q ? trova(q, tutte).map(function(t){ return t.riga; }) : tutte;
    if(S.filtro !== "tutti") righe = righe.filter(function(r){ return statoRiga(r) === S.filtro; });
    if(daCapo || !S.mostrati) S.mostrati = CONFIG.righeElenco;
    var box = svuota($("elenco"));
    righe.slice(0, S.mostrati).forEach(function(r){ box.appendChild(voce(r, function(){ apriScheda(r); })); });
    if(!righe.length) box.appendChild(el("p", { class: "hint", text: "Nessun articolo." }));
    $("elencoAltri").hidden = righe.length <= S.mostrati;
    $("elencoAltri").textContent = "Mostra altri (" + fmt(righe.length - S.mostrati) + ")";
  }
  $("elencoCerca").addEventListener("input", function(){ disegnaElenco(true); });
  $("elencoAltri").addEventListener("click", function(){ S.mostrati += CONFIG.righeElenco; disegnaElenco(false); });

  /* ---------- Esporta ---------- */

  // Una riga per articolo, come finisce nell'Excel.
  function righeEsporta(nonContatiZero){
    return righeTutte().map(function(r){
      var c = conteggioDi(r), reale = c ? c.reale : nonContatiZero ? 0 : null;
      var diff = reale === null ? null : arrotonda(reale - r.attesa);
      var esito = !c ? (nonContatiZero ? "Non contato (considerato 0)" : "Non contato")
        : r.extra ? "Non presente nel report"
        : Math.abs(diff) <= TOLLERANZA ? "Confermata" : "Differenza";
      return {
        codice: r.codice, descrizione: r.descrizione, commessa: r.commessa, um: r.um || "", dettaglio: r.dettaglio || "", attesa: r.attesa, reale: reale, diff: diff,
        valore: r.valore, valoreDiff: diff === null ? null : Math.round(diff * r.valore * 100) / 100, esito: esito,
        operatore: c ? c.operatore : "", quando: c ? c.quando : "", nota: c ? c.nota : "", parti: c && c.parti ? c.parti : "",
        fuoriData: !!c && giornoDi(c.quando) !== S.inv.data
      };
    });
  }
  function nomeFile(suffisso, est){
    var inv = S.inv, base = "Inventario " + (inv.tipo === "commessa" ? inv.commessa : "magazzino aziendale") + (inv.deposito ? " " + inv.deposito : "") + " " + inv.data;
    return (base + (suffisso ? " - " + suffisso : "")).replace(/[\\/:*?"<>|]/g, "-") + "." + est;
  }

  var COLONNE = [
    ["Codice", 22, "codice"], ["Descrizione", 48, "descrizione"], ["Commessa", 12, "commessa"], ["U.M.", 7, "um"],
    ["Giacenza attesa", 13, "attesa", "q"], ["Giacenza reale", 13, "reale", "q"], ["Differenza", 12, "diff", "q"],
    ["Valore unitario", 13, "valore", "v"], ["Valore differenza", 14, "valoreDiff", "e"], ["Esito", 24, "esito"],
    ["Contato da", 20, "operatore"], ["Data e ora del conteggio", 18, "quando", "d"], ["Note", 36, "nota"],
    ["Giacenza reale per commessa", 40, "parti"], ["Giacenza per commessa (gestionale)", 60, "dettaglio"]
  ];

  function foglio(wb, nome, intestazione, righe){
    var ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: intestazione.length + 2 }] });
    intestazione.forEach(function(t, i){
      var cella = ws.getCell(i + 1, 1);
      cella.value = t;
      cella.font = i ? { size: 11, color: { argb: "FF5D6878" } } : { size: 14, bold: true, color: { argb: "FF005BAA" } };
    });
    var rigaTitoli = intestazione.length + 2, riga = ws.getRow(rigaTitoli);
    COLONNE.forEach(function(c, j){
      ws.getColumn(j + 1).width = c[1];
      var cella = riga.getCell(j + 1);
      cella.value = c[0];
      cella.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cella.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF005BAA" } };
      cella.alignment = { vertical: "middle", wrapText: true };
    });
    riga.height = 32;
    righe.forEach(function(x, i){
      var rg = ws.getRow(rigaTitoli + 1 + i);
      COLONNE.forEach(function(c, j){
        var cella = rg.getCell(j + 1), v = x[c[2]];
        if(c[3] === "d"){ cella.value = v ? oraIt(v) + (x.fuoriData ? " (non nella data dell'inventario)" : "") : ""; }
        else cella.value = v === null || v === undefined ? null : v;
        if(c[3] === "q") cella.numFmt = "#,##0.###";
        if(c[3] === "v") cella.numFmt = "#,##0.00####";
        if(c[3] === "e") cella.numFmt = "#,##0.00";
      });
      var colore = x.esito === "Confermata" ? null : x.diff === null ? "FFFFF4D6" : Math.abs(x.diff) > TOLLERANZA ? "FFFBE4E2" : null;
      var col = function(k){ return COLONNE.findIndex(function(c){ return c[2] === k; }) + 1; };
      if(colore) ["reale", "diff", "valoreDiff", "esito"].forEach(function(k){ rg.getCell(col(k)).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colore } }; });
      if(x.diff !== null && Math.abs(x.diff) > TOLLERANZA) rg.getCell(col("diff")).font = { bold: true, color: { argb: "FFB3261E" } };
    });
    ws.autoFilter = { from: { row: rigaTitoli, column: 1 }, to: { row: rigaTitoli + righe.length, column: COLONNE.length } };
    return ws;
  }

  async function scaricaExcel(nonContatiZero){
    await caricaScript(EXCELJS_URL);
    var inv = S.inv, righe = righeEsporta(nonContatiZero), n = numeri(), wb = new window.ExcelJS.Workbook();
    wb.creator = "SICIET InvenTrack";
    wb.created = new Date();
    var titolo = "SICIET InvenTrack – Inventario " + (inv.tipo === "commessa" ? "della commessa " + inv.commessa : "del magazzino aziendale");
    var testa = [titolo,
      "Data dell'inventario: " + dataIt(inv.data) + (inv.deposito ? " · Deposito: " + inv.deposito : "") + " · Stato: " + (inv.stato === "chiuso" ? "chiuso" : "aperto"),
      "Report del gestionale: " + [inv.report.nome, inv.report.stampatoIl && "stampato il " + dataIt(inv.report.stampatoIl)].filter(Boolean).join(", "),
      "Esportato il " + oraIt(new Date().toISOString()) + " da " + operatore() + (inv.note ? " · Note: " + inv.note : "")];
    foglio(wb, "Inventario", testa, righe);
    foglio(wb, "Differenze", [titolo + " – solo le differenze"].concat(testa.slice(1)), righe.filter(function(x){ return x.diff !== null && Math.abs(x.diff) > TOLLERANZA; }));
    var ws = wb.addWorksheet("Riepilogo");
    ws.getColumn(1).width = 46;
    ws.getColumn(2).width = 18;
    var fuori = righe.filter(function(x){ return x.fuoriData; }).length;
    [[titolo], ["Data dell'inventario", dataIt(inv.data)], ["Deposito", inv.deposito], ["Creato da", inv.creatoDa + " · " + oraIt(inv.creatoIl)],
     ["Chiuso da", inv.stato === "chiuso" ? inv.chiusoDa + " · " + oraIt(inv.chiusoIl) : "(inventario ancora aperto)"], [],
     ["Articoli nel report", n.righe], ["Articoli contati", n.contati], ["Articoli non contati", n.da],
     ["Giacenze confermate", n.ok], ["Differenze", n.diff], ["  di cui in più", n.piu], ["  di cui in meno", n.meno],
     ["Articoli trovati e non presenti nel report", n.extra], ["Valore delle differenze (€)", Math.round(n.valore * 100) / 100],
     ["Conteggi fatti in un giorno diverso dalla data dell'inventario", fuori]
    ].forEach(function(r, i){
      ws.getRow(i + 1).values = r;
      ws.getCell(i + 1, 1).font = i ? { bold: true } : { size: 14, bold: true, color: { argb: "FF005BAA" } };
      ws.getCell(i + 1, 2).alignment = { horizontal: "right" };
    });
    ws.getCell(15, 2).numFmt = "#,##0.00";
    var buf = await wb.xlsx.writeBuffer();
    scarica(nomeFile("", "xlsx"), new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  // Numero con i decimali fissi del file del gestionale (senza le imprecisioni dei numeri binari).
  function decimali(n){
    var d = CONFIG.csvDecimali, s = Number(n).toFixed(Math.min(6, d));
    return d > 6 ? s + new Array(d - 6 + 1).join("0") : s;
  }
  var CSV_TIPI = {
    piu: ["Movimento positivo (differenze in più)", "movimento positivo"],
    meno: ["Movimento negativo (differenze in meno)", "movimento negativo"],
    reali: ["Giacenze reali di tutti gli articoli contati", "giacenze reali"]
  };
  function righeCsv(tipo, nonContatiZero){
    return righeEsporta(nonContatiZero).filter(function(x){
      if(x.reale === null) return false;
      if(tipo === "piu") return x.diff > TOLLERANZA;
      if(tipo === "meno") return x.diff < -TOLLERANZA;
      return true;
    }).map(function(x){
      return { codice: x.codice, quantita: tipo === "reali" ? x.reale : Math.abs(x.diff), valore: x.valore };
    });
  }
  function scaricaCsv(tipo, nonContatiZero){
    var righe = righeCsv(tipo, nonContatiZero);
    if(!righe.length){ toast("Nessuna riga da esportare."); return; }
    var testo = righe.map(function(x){
      return '"' + x.codice.replace(/"/g, '""') + '" ; ' + decimali(x.quantita) + "; " + decimali(x.valore) + "\r\n";
    }).join("");
    scarica(nomeFile(CSV_TIPI[tipo][1], "csv"), new Blob([testo], { type: "text/csv" }));
  }

  async function cambiaStato(stato){
    var inv = S.inv;
    try{
      if(inProva()){
        Object.assign(inv, { stato: stato, chiusoDa: stato === "chiuso" ? operatore() : "", chiusoIl: stato === "chiuso" ? new Date().toISOString() : "" });
        var lista = ((await kv.get("lista")) || []).map(function(x){ return x.id === inv.id ? inv : x; });
        await kv.set("lista", lista);
      } else {
        await inviaCoda();
        if(S.coda.some(function(x){ return x.inv === inv.id; })) throw new Error("Ci sono conteggi non ancora inviati: riprova quando torna la connessione.");
        S.inv = inv = (await api("POST", "/inventari/" + inv.id + "/stato", { stato: stato, operatore: operatore() })).inventario;
      }
      await kv.set("inv:" + inv.id, { inv: inv, righe: S.righe });
      toast(stato === "chiuso" ? "Inventario chiuso" : "Inventario riaperto");
    }catch(e){ if(e.status !== 401) toast(e.message, true); }
    disegnaInventario();
  }

  async function elimina(inv){
    inv = inv || S.inv;
    if(prompt("Eliminare definitivamente l'inventario " + titoloInv(inv) + " del " + dataIt(inv.data) + " con tutte le quantità contate?\nL'operazione non si può annullare. Per confermare scrivi ELIMINA.") !== "ELIMINA") return;
    try{
      if(inProva()) await kv.set("lista", ((await kv.get("lista")) || []).filter(function(x){ return x.id !== inv.id; }));
      else{
        try{ await api("DELETE", "/inventari/" + inv.id); }
        catch(e){ if(e.status !== 404) throw e; } // già eliminato da un altro dispositivo
        await kv.set("lista", ((await kv.get("lista")) || []).filter(function(x){ return x.id !== inv.id; }));
      }
      S.coda = S.coda.filter(function(x){ return x.inv !== inv.id; });
      await kv.set("coda", S.coda);
      await kv.del("inv:" + inv.id);
      await kv.del("cnt:" + inv.id);
      if(S.inv && S.inv.id === inv.id) S.inv = null;
      collegatiCache = null;
      toast("Inventario eliminato");
      if(location.hash.replace(/^#/, "") === "") apriHome(); else location.hash = "";
    }catch(e){ if(e.status !== 401) toast(e.message, true); }
  }

  function disegnaEsporta(){
    var box = svuota($("tEsporta")), inv = S.inv, n = numeri(), inAttesa = S.coda.filter(function(x){ return x.inv === inv.id; }).length;
    var zero = el("input", { type: "checkbox", id: "eZero" });
    function riga(a, b){ return el("tr", {}, el("td", { text: a }), el("td", { text: b })); }
    var riepilogo = el("div", { class: "card" },
      el("h2", { text: "Riepilogo" }),
      el("table", { class: "riepilogo" },
        riga("Articoli nel report", fmt(n.righe)),
        riga("Contati", fmt(n.contati)),
        riga("Ancora da contare", fmt(n.da)),
        riga("Giacenze confermate", fmt(n.ok)),
        riga("Differenze", fmt(n.diff) + (n.diff ? "  (" + fmt(n.piu) + " in più, " + fmt(n.meno) + " in meno)" : "")),
        riga("Trovati e non presenti nel report", fmt(n.extra)),
        riga("Valore delle differenze", euro(n.valore))));
    if(n.da) riepilogo.appendChild(el("div", { class: "avviso" },
      el("span", { text: "Mancano ancora " + fmt(n.da) + " articoli: nell'Excel risultano “Non contato” e non entrano nei file delle differenze. Un articolo che in magazzino non c'è va contato con quantità 0." }),
      el("label", { class: "riga" }, zero, el("span", { text: "Considera gli articoli non contati come giacenza 0" }))));
    if(inAttesa) riepilogo.appendChild(el("div", { class: "avviso errore", text: fmt(inAttesa) + " conteggi di questo dispositivo non sono ancora stati inviati: gli altri dispositivi non li vedono." }));
    if(!inProva()) riepilogo.appendChild(el("p", { class: "hint", text: "Prima di scaricare, la pagina legge i conteggi fatti dagli altri dispositivi." }));
    box.appendChild(riepilogo);

    async function prima(btn, fn){
      btn.disabled = true;
      try{ await sincronizza(); await fn(); }
      catch(e){ toast(e.message || String(e), true); }
      finally{ btn.disabled = false; }
    }
    box.appendChild(el("div", { class: "card" },
      el("h2", { text: "Excel dell'inventario" }),
      el("p", { class: "hint", text: "Tutti gli articoli con giacenza attesa, giacenza reale, differenza, valore, chi ha contato e quando; un secondo foglio con le sole differenze e un riepilogo." }),
      el("button", { class: "btn primary", type: "button", text: "⬇️ Scarica Excel", onclick: function(){ var b = this; prima(b, function(){ return scaricaExcel(zero.checked); }); } })));
    var nPiu = righeCsv("piu", zero.checked).length, nMeno = righeCsv("meno", zero.checked).length;
    function bottoneCsv(tipo, quanti, primario){
      return el("button", { class: "btn" + (primario ? " primary" : ""), type: "button", disabled: !quanti, text: "⬇️ " + CSV_TIPI[tipo][0].split(" (")[0] + " (" + fmt(quanti) + (quanti === 1 ? " articolo)" : " articoli)"),
        onclick: function(){ var b = this; prima(b, function(){ scaricaCsv(tipo, zero.checked); }); } });
    }
    box.appendChild(el("div", { class: "card" },
      el("h2", { text: "Movimenti d'inventario per il gestionale" }),
      el("p", { class: "hint", text: "Due file CSV da importare nel gestionale, una riga per articolo: \"codice\" ; quantità ; valore unitario. Uno con le differenze in più (movimento positivo) e uno con le differenze in meno (movimento negativo), con le quantità sempre positive." }),
      bottoneCsv("piu", nPiu, true),
      bottoneCsv("meno", nMeno, true),
      el("button", { class: "btn", type: "button", disabled: !nPiu && !nMeno, text: "⬇️ Scarica entrambi", onclick: function(){
        var b = this;
        prima(b, async function(){ if(nPiu) scaricaCsv("piu", zero.checked); if(nPiu && nMeno) await new Promise(function(r){ setTimeout(r, 700); }); if(nMeno) scaricaCsv("meno", zero.checked); });
      } }),
      el("button", { class: "linkbtn", type: "button", text: "Scarica invece le giacenze reali di tutti gli articoli contati", onclick: function(){ var b = this; prima(b, function(){ scaricaCsv("reali", zero.checked); }); } })));
    box.appendChild(el("div", { class: "card" },
      el("h2", { text: inv.stato === "chiuso" ? "Inventario chiuso" : "Chiudi l'inventario" }),
      el("p", { class: "hint", text: inv.stato === "chiuso"
        ? "Chiuso da " + inv.chiusoDa + " il " + oraIt(inv.chiusoIl) + ". Le quantità non si possono più modificare; Excel e CSV si possono sempre scaricare."
        : "A giro finito chiudi l'inventario: le quantità non si potranno più modificare da nessun dispositivo (si può riaprire)." }),
      el("div", { class: "riga" },
        inv.stato === "chiuso"
          ? el("button", { class: "btn", type: "button", text: "Riapri l'inventario", onclick: function(){ cambiaStato("aperto"); } })
          : el("button", { class: "btn", type: "button", text: "🔒 Chiudi l'inventario", onclick: function(){
              if(confirm(n.da ? "Mancano ancora " + n.da + " articoli da contare. Chiudere comunque l'inventario?" : "Chiudere l'inventario?")) cambiaStato("chiuso");
            } }),
        el("button", { class: "btn pericolo", type: "button", text: "🗑 Elimina inventario", onclick: function(){ elimina(S.inv); } }))));
  }

  /* ---------- Invio e lettura dei conteggi ---------- */

  function disegnaSync(){
    var s = $("sync");
    if(!S.inv){ s.textContent = ""; return; }
    var n = S.coda.filter(function(x){ return x.inv === S.inv.id; }).length;
    s.className = n ? "attesa-invio" : "";
    if(inProva()) s.textContent = "Modalità di prova: i dati restano solo su questo dispositivo.";
    else if(n) s.textContent = "⏳ " + fmt(n) + " conteggi in attesa di invio: partono appena torna la connessione.";
    else s.textContent = S.senzaRete ? "Senza connessione: i conteggi vengono salvati sul dispositivo." : "✓ Tutti i conteggi sono salvati.";
  }

  async function inviaCoda(){
    if(inProva() || S.invio || !S.coda.length) return;
    S.invio = true;
    var rifiutati = false;
    try{
      var perInv = {};
      S.coda.forEach(function(x){ (perInv[x.inv] = perInv[x.inv] || []).push(x); });
      for(var id of Object.keys(perInv)){
        var gruppo = perInv[id];
        try{
          for(var i = 0; i < gruppo.length; i += 500) await api("POST", "/inventari/" + id + "/conteggi", { conteggi: gruppo.slice(i, i + 500).map(function(x){ return x.c; }) });
          S.senzaRete = false;
        }catch(e){
          if(e.rete){ S.senzaRete = true; break; }
          if(e.status === 401) break;
          if(e.status !== 409 && e.status !== 404) throw e;
          // Inventario chiuso o eliminato da un altro dispositivo: i conteggi non si possono più salvare.
          toast(e.message, true);
          if(S.inv && S.inv.id === id){
            if(e.status === 404){ S.inv = null; location.hash = ""; }
            else rifiutati = true;
          }
        }
        S.coda = S.coda.filter(function(x){ return gruppo.indexOf(x) < 0; });
        await kv.set("coda", S.coda);
      }
    }catch(e){ toast(e.message, true); }
    finally{ S.invio = false; disegnaSync(); }
    if(rifiutati && S.inv){
      // I conteggi rifiutati non valgono: si rileggono quelli veri dal servizio.
      S.conteggi = {};
      S.da = 0;
      S.scheda = null;
      await leggiConteggi();
      disegnaInventario();
    }
  }

  async function leggiConteggi(){
    if(inProva() || !S.inv) return;
    var id = S.inv.id, r;
    try{ r = await api("GET", "/inventari/" + id + "/conteggi?da=" + Math.max(0, S.da - 5000)); S.senzaRete = false; }
    catch(e){ if(e.rete) S.senzaRete = true; return; }
    if(!S.inv || S.inv.id !== id) return;
    var cambiato = false;
    r.conteggi.forEach(function(c){
      var mio = S.conteggi[c.chiave];
      delete c.agg;
      if(mio && (mio.quando > c.quando || (mio.quando === c.quando && mio.reale === c.reale))) return;
      S.conteggi[c.chiave] = c;
      cambiato = true;
    });
    S.da = r.ora;
    kv.set("cnt:" + id, { conteggi: S.conteggi, da: S.da });
    if(r.inventario && (r.inventario.stato !== S.inv.stato)){
      // Chiuso o riaperto da un altro dispositivo.
      S.inv = r.inventario;
      kv.set("inv:" + id, { inv: S.inv, righe: S.righe });
      if(S.scheda) disegnaTesta(); else disegnaInventario();
      disegnaAvvisoData();
    }
    if(cambiato){
      disegnaTesta();
      if(S.tab === "elenco") disegnaElenco(false);
      if(S.tab === "esporta") disegnaEsporta();
    }
  }

  var inSincronia = null;
  function sincronizza(){
    if(!inSincronia) inSincronia = (async function(){
      try{ await inviaCoda(); await leggiConteggi(); }
      finally{ inSincronia = null; disegnaSync(); }
    })();
    return inSincronia;
  }
  setInterval(function(){ if(S.inv && !document.hidden) sincronizza(); }, CONFIG.aggiornaOgniSecondi * 1000);
  window.addEventListener("online", function(){ if(S.inv) sincronizza(); });
  document.addEventListener("visibilitychange", function(){ if(S.inv && !document.hidden) sincronizza(); });

  /* ---------- Codice dalla foto della targhetta ----------
   * Prima si cercano codici a barre e QR (dove il browser li sa leggere), poi
   * si legge il testo (Tesseract.js, sul dispositivo) e lo si confronta con i
   * codici del report: basta una lettura imperfetta per proporre l'articolo giusto. */

  var ocr = { img: null, scala: 1, sel: null, worker: null, occupato: false };

  $("fotoBtn").addEventListener("click", function(){ $("fotoFile").value = ""; $("fotoFile").click(); });
  $("ocrRifai").addEventListener("click", function(){ $("fotoFile").value = ""; $("fotoFile").click(); });
  $("ocrChiudi").addEventListener("click", function(){ $("ocrDlg").hidden = true; });
  $("fotoFile").addEventListener("change", function(){
    var f = this.files[0];
    if(!f) return;
    var img = new Image();
    img.onload = function(){
      ocr.img = img;
      ocr.sel = null;
      $("ocrDlg").hidden = false;
      disegnaOcr();
      leggiFoto();
    };
    img.onerror = function(){ toast("Non riesco ad aprire la foto.", true); };
    img.src = URL.createObjectURL(f);
  });

  function disegnaOcr(){
    var c = $("ocrCanvas"), img = ocr.img, larghezza = Math.min(1200, img.naturalWidth);
    ocr.scala = larghezza / img.naturalWidth;
    c.width = larghezza;
    c.height = Math.round(img.naturalHeight * ocr.scala);
    var g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    if(ocr.sel){
      g.fillStyle = "rgba(0,0,0,.45)";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, ocr.sel.x / ocr.scala, ocr.sel.y / ocr.scala, ocr.sel.w / ocr.scala, ocr.sel.h / ocr.scala, ocr.sel.x, ocr.sel.y, ocr.sel.w, ocr.sel.h);
      g.strokeStyle = "#7ac143";
      g.lineWidth = Math.max(3, c.width / 250);
      g.strokeRect(ocr.sel.x, ocr.sel.y, ocr.sel.w, ocr.sel.h);
    }
  }
  (function(){
    var c = $("ocrCanvas"), inizio = null;
    function punto(ev){
      var r = c.getBoundingClientRect();
      return { x: Math.max(0, Math.min(c.width, (ev.clientX - r.left) * c.width / r.width)), y: Math.max(0, Math.min(c.height, (ev.clientY - r.top) * c.height / r.height)) };
    }
    c.addEventListener("pointerdown", function(ev){ inizio = punto(ev); c.setPointerCapture(ev.pointerId); });
    c.addEventListener("pointermove", function(ev){
      if(!inizio) return;
      var p = punto(ev);
      ocr.sel = { x: Math.min(inizio.x, p.x), y: Math.min(inizio.y, p.y), w: Math.abs(p.x - inizio.x), h: Math.abs(p.y - inizio.y) };
      disegnaOcr();
    });
    function fine(){
      inizio = null;
      if(ocr.sel && (ocr.sel.w < 12 || ocr.sel.h < 12)){ ocr.sel = null; disegnaOcr(); }
    }
    c.addEventListener("pointerup", fine);
    c.addEventListener("pointercancel", fine);
  })();
  $("ocrLeggi").addEventListener("click", function(){
    if(!ocr.sel){ $("ocrStato").textContent = "Traccia prima col dito un riquadro attorno al codice."; return; }
    leggiFoto();
  });

  // Ritaglio ingrandito in base all'altezza, in bianco e nero (soglia di Otsu,
  // fondo sempre bianco) e con un bordo bianco: è come Tesseract legge meglio.
  function ritaglio(altezza, biancoNero){
    var img = ocr.img, k = 1 / ocr.scala;
    var r = ocr.sel ? { x: ocr.sel.x * k, y: ocr.sel.y * k, w: ocr.sel.w * k, h: ocr.sel.h * k } : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    var z = Math.min(altezza / r.h, 2400 / r.w);
    var W = Math.max(1, Math.round(r.w * z)), H = Math.max(1, Math.round(r.h * z)), pad = Math.round(Math.max(20, H * 0.1));
    var c = document.createElement("canvas");
    c.width = W + 2 * pad;
    c.height = H + 2 * pad;
    var g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, r.x, r.y, r.w, r.h, pad, pad, W, H);
    if(!biancoNero) return c;
    var d = g.getImageData(pad, pad, W, H), p = d.data, n = W * H, grigi = new Uint8Array(n), hist = new Array(256).fill(0), i, v;
    for(i = 0; i < n; i++){ v = (0.299 * p[4 * i] + 0.587 * p[4 * i + 1] + 0.114 * p[4 * i + 2]) | 0; grigi[i] = v; hist[v]++; }
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
    var inverti = scuri > n / 2;
    for(i = 0; i < n; i++){ v = (grigi[i] <= soglia) !== inverti ? 0 : 255; p[4 * i] = p[4 * i + 1] = p[4 * i + 2] = v; p[4 * i + 3] = 255; }
    g.putImageData(d, pad, pad);
    return c;
  }

  async function codiciABarre(){
    if(!("BarcodeDetector" in window)) return [];
    try{ return (await new window.BarcodeDetector().detect(ritaglio(1600, false))).map(function(b){ return b.rawValue; }).filter(Boolean); }
    catch(_){ return []; }
  }

  function testiLetti(data, testi, grezzi){
    (data.lines || []).forEach(function(l){
      var w = l.words.filter(function(x){ return x.text.trim(); });
      if(!w.length) return;
      testi.push(w.map(function(x){ return x.text; }).join(" "));
      w.forEach(function(x, i){
        testi.push(x.text);
        if(i + 1 < w.length) testi.push(x.text + w[i + 1].text);
        var t = x.text.toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");
        if(t.length >= 4 && t.length <= 25 && /\d/.test(t) && x.confidence > 55) grezzi[t] = Math.max(grezzi[t] || 0, x.confidence + t.length);
      });
    });
  }

  async function leggiFoto(){
    if(ocr.occupato) return;
    ocr.occupato = true;
    var stato = $("ocrStato"), box = svuota($("ocrRisultati"));
    $("ocrLeggi").disabled = true;
    try{
      var testi = await codiciABarre(), grezzi = {}, righe = righeTutte();
      testi.forEach(function(t){ grezzi[R.codice(t)] = 200; });
      var trovati = R.cerca(testi, righe);
      if(!trovati.length || trovati[0].punti < 90){
        if(!ocr.worker){
          stato.textContent = "Preparazione della lettura (la prima volta può richiedere qualche secondo)…";
          await caricaScript(TESSERACT_URL);
          ocr.worker = await window.Tesseract.createWorker("eng");
        }
        var sel = ocr.sel, tentativi;
        if(!sel) tentativi = [{ alt: 1600, psm: "11", bn: false }, { alt: 2000, psm: "11", bn: true }];
        else if(sel.w / sel.h > 2.2) tentativi = [{ alt: 90, psm: "7", bn: true }, { alt: 160, psm: "6", bn: true }, { alt: 300, psm: "6", bn: false }];
        else tentativi = [{ alt: 300, psm: "6", bn: true }, { alt: 600, psm: "6", bn: false }, { alt: 900, psm: "11", bn: true }];
        for(var i = 0; i < tentativi.length; i++){
          stato.textContent = "Lettura in corso…" + (i ? " (tentativo " + (i + 1) + ")" : "");
          await ocr.worker.setParameters({
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/. ",
            preserve_interword_spaces: "1",
            tessedit_pageseg_mode: tentativi[i].psm,
            user_defined_dpi: "300"
          });
          testiLetti((await ocr.worker.recognize(ritaglio(tentativi[i].alt, tentativi[i].bn))).data, testi, grezzi);
          trovati = R.cerca(testi, righe);
          if(trovati.length && trovati[0].punti >= 80) break;
        }
      }
      trovati.forEach(function(t){ box.appendChild(voce(t.riga, function(){ $("ocrDlg").hidden = true; apriScheda(t.riga); })); });
      // Testi letti che non corrispondono a nessun articolo: si possono usare come codice.
      Object.keys(grezzi).sort(function(a, b){ return grezzi[b] - grezzi[a]; })
        .filter(function(t){ return !trovati.some(function(x){ return R.canon(x.riga.codice) === R.canon(t); }); }).slice(0, 3)
        .forEach(function(t){
          box.appendChild(el("button", { type: "button", class: "voce nuovo", onclick: function(){
            $("ocrDlg").hidden = true;
            S.scheda = null;
            $("codice").value = t;
            disegnaInventario();
            $("codice").focus();
          } }, el("span", { class: "cod", text: t }), el("span", { class: "des", text: "Testo letto dalla foto: usalo come codice da cercare" })));
        });
      stato.textContent = trovati.length ? "Tocca l'articolo giusto (il primo è il più probabile) e controlla sempre il codice:"
        : box.firstChild ? "Nessun articolo del report corrisponde. Testi letti dalla foto:"
        : "Non ho riconosciuto nessun codice. Traccia un riquadro attorno al solo codice, con la foto dritta e ben illuminata, oppure scrivilo a mano.";
    }catch(e){
      stato.textContent = "Lettura non riuscita: " + (e.message || e);
    }finally{
      ocr.occupato = false;
      $("ocrLeggi").disabled = false;
    }
  }

  // La pagina si riapre anche senza rete (vedi sw.js).
  if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function(){});

  // Per le prove automatiche.
  window.InvenTrack = { stato: S, righeCsv: righeCsv, decimali: decimali, quantitaScritta: quantitaScritta };

  $("versione").textContent = "SICIET InvenTrack · versione " + CONFIG.versione;

  naviga();
})();
