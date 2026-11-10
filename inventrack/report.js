/*
 * SICIET INVENTRACK – LETTURA DEL REPORT DEL GESTIONALE
 * -----------------------------------------------------
 * Funzioni senza interfaccia (usate da inventrack.js e provabili da sole):
 *
 *   InvReport.daPdf(pagine)      report "Analisi Andamento Giacenza" in PDF.
 *                                pagine = [{ items: [{ s, x, y, w }] }], cioè il
 *                                testo di ogni pagina con la sua posizione
 *                                (come lo restituisce pdf.js)
 *   InvReport.daTabella(righe)   lo stesso report esportato in Excel o CSV
 *                                (righe = matrice di celle)
 *   InvReport.numero(testo)      "10.813,20" → 10813.2
 *   InvReport.chiave(cod, com)   identificativo di una riga (codice + commessa)
 *   InvReport.cerca(testi, righe) articoli che somigliano ai testi letti da una foto
 *
 * Ogni riga letta è { codice, descrizione, commessa, attesa, valore }:
 * attesa = colonna Saldo, valore = valore unitario (Totale riga / Saldo).
 */
(function(root){
  "use strict";

  var RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;

  // Numeri all'italiana: punto per le migliaia, virgola per i decimali.
  function numero(v){
    if(typeof v === "number") return isFinite(v) ? v : null;
    var s = String(v === undefined || v === null ? "" : v).replace(/\s/g, "");
    if(!s) return null;
    if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
    if(/^-?\d+\.\d+$/.test(s)) return Number(s); // già con il punto decimale (CSV)
    return null;
  }

  function dataIso(s){
    var m = RE_DATA.exec(String(s || "").trim());
    return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
  }

  function pulisci(s){ return String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim(); }
  function codicePulito(s){ return pulisci(s).toUpperCase(); }
  function chiave(codice, commessa){ return codicePulito(codice) + "|" + codicePulito(commessa); }
  function arrotonda(n, dec){ var k = Math.pow(10, dec); return Math.round(n * k) / k; }

  // Righe con lo stesso codice e la stessa commessa: le quantità si sommano.
  function unisci(righe, info){
    var mappa = {}, out = [];
    info.ripetuti = 0;
    righe.forEach(function(r){
      var k = chiave(r.codice, r.commessa), p = mappa[k];
      if(!p){ mappa[k] = r; out.push(r); return; }
      info.ripetuti++;
      var tot = p.attesa * p.valore + r.attesa * r.valore;
      p.attesa = arrotonda(p.attesa + r.attesa, 6);
      if(p.attesa) p.valore = arrotonda(tot / p.attesa, 6);
      if(!p.descrizione) p.descrizione = r.descrizione;
    });
    info.commesse = {};
    out.forEach(function(r){ info.commesse[r.commessa] = (info.commesse[r.commessa] || 0) + 1; });
    return out;
  }

  function riga(codice, descrizione, commessa, saldo, unitario, totale){
    var valore = 0;
    if(unitario !== null && unitario !== undefined) valore = unitario;
    else if(totale !== null && totale !== undefined && saldo) valore = arrotonda(totale / saldo, 6);
    return { codice: codicePulito(codice), descrizione: pulisci(descrizione), commessa: codicePulito(commessa), attesa: saldo || 0, valore: valore };
  }

  /* ---------- PDF ---------- */

  var NUMERICHE = ["Iniziale", "DocNo", "Entrata", "Uscita", "Saldo", "Unitario", "% Sc", "Totale Riga"];

  function colonne(items){
    var c = { num: [] }, y = null;
    items.forEach(function(i){
      var s = pulisci(i.s);
      if(s === "Articolo"){ c.fineCodice = i.x + i.w; y = y === null ? i.y : Math.min(y, i.y); }
      else if(/^Commessa\b/.test(s) && c.commessa === undefined) c.commessaTmp = c.commessaTmp ? c.commessaTmp.concat(i) : [i];
      else if(NUMERICHE.indexOf(s) >= 0){ c.num.push({ nome: s, destra: i.x + i.w, x: i.x }); y = y === null ? i.y : Math.min(y, i.y); }
    });
    if(c.fineCodice === undefined || !c.num.some(function(n){ return n.nome === "Saldo"; })) return null;
    // "Commessa" compare anche nelle selezioni in alto: serve quella sulla riga delle intestazioni.
    var vicina = (c.commessaTmp || []).filter(function(i){ return Math.abs(i.y - y) < 12; })[0];
    c.commessa = vicina ? vicina.x - 8 : null;
    c.inizioNumeri = Math.min.apply(null, c.num.map(function(n){ return n.x; })) - 20;
    c.y = y;
    return c;
  }

  function accanto(items, etichetta){
    var e = items.filter(function(i){ return pulisci(i.s) === etichetta; })[0];
    if(!e) return "";
    var v = items.filter(function(i){ return i !== e && Math.abs(i.y - e.y) <= 3 && i.x > e.x + e.w && i.x < e.x + e.w + 90 && pulisci(i.s); })
                 .sort(function(a, b){ return a.x - b.x; })[0];
    return v ? pulisci(v.s) : "";
  }

  function daPdf(pagine){
    var righe = [], info = { deposito: "", commessa: "", stampatoIl: "", finoAl: "", pagine: pagine.length }, col = null, corrente = null;
    pagine.forEach(function(pag){
      var items = pag.items.filter(function(i){ return pulisci(i.s); });
      var c = colonne(items);
      if(c) col = c;
      if(!col) return;
      if(!info.deposito) info.deposito = accanto(items, "Da Deposito").toUpperCase();
      if(!info.commessa) info.commessa = accanto(items, "Da Commessa").toUpperCase();
      if(!info.finoAl) info.finoAl = dataIso(accanto(items, "A Data Reg."));
      items.forEach(function(i){ if(i.y < 60 && RE_DATA.test(pulisci(i.s)) && !info.stampatoIl) info.stampatoIl = dataIso(pulisci(i.s)); });

      // Righe della tabella: il testo sotto le intestazioni, raggruppato per altezza.
      var sotto = items.filter(function(i){ return i.y < (c ? c.y : 1e9) - 3; }).sort(function(a, b){ return b.y - a.y || a.x - b.x; });
      var gruppi = [];
      sotto.forEach(function(i){
        var g = gruppi[gruppi.length - 1];
        if(g && Math.abs(g.y - i.y) <= 2.5) g.items.push(i);
        else gruppi.push({ y: i.y, items: [i] });
      });
      gruppi.forEach(function(g){
        var cod = [], des = [], com = [], num = {};
        g.items.sort(function(a, b){ return a.x - b.x; }).forEach(function(i){
          if(i.x < col.fineCodice) cod.push(i.s);
          else if(i.x >= col.inizioNumeri){
            var n = numero(i.s);
            if(n === null) return;
            var destra = i.x + i.w, migliore = null;
            col.num.forEach(function(h){ if(!migliore || Math.abs(h.destra - destra) < Math.abs(migliore.destra - destra)) migliore = h; });
            num[migliore.nome] = n;
          }
          else if(col.commessa !== null && i.x >= col.commessa){ if(!com.length && i.x < col.commessa + 40) com.push(i.s); }
          else des.push(i.s);
        });
        var codice = pulisci(cod.join(" ")), descr = pulisci(des.join(" "));
        var haNumeri = "Saldo" in num || "Entrata" in num || "Uscita" in num;
        if(codice && haNumeri){
          corrente = riga(codice, descr, com.join(""), num.Saldo, num.Unitario, num["Totale Riga"]);
          righe.push(corrente);
        } else if(!codice && descr && !Object.keys(num).length && corrente){
          // Descrizione su più righe (anche a cavallo di due pagine).
          corrente.descrizione = pulisci(corrente.descrizione + " " + descr);
        }
      });
    });
    return { righe: unisci(righe, info), info: info };
  }

  /* ---------- Excel / CSV ---------- */

  function daTabella(tabella){
    var info = { deposito: "", commessa: "", stampatoIl: "", finoAl: "" }, righe = [], col = null, inizio = -1;
    for(var r = 0; r < Math.min(tabella.length, 40) && !col; r++){
      var c = {}, celle = tabella[r] || [];
      celle.forEach(function(v, j){
        var s = pulisci(v).toLowerCase();
        if(!s) return;
        if(c.codice === undefined && /^(articolo|codice|cod\.?|codice articolo)$/.test(s)) c.codice = j;
        else if(c.descrizione === undefined && /^descr/.test(s)) c.descrizione = j;
        else if(c.commessa === undefined && /^commessa/.test(s)) c.commessa = j;
        else if(c.saldo === undefined && /^(saldo|giacenza|esistenza|quantit[aà]|qta|q\.t[aà])/.test(s)) c.saldo = j;
        else if(c.unitario === undefined && /unitario|prezzo|costo/.test(s)) c.unitario = j;
        else if(c.totale === undefined && /^(totale|valore)/.test(s)) c.totale = j;
      });
      if(c.codice !== undefined && c.saldo !== undefined){ col = c; inizio = r + 1; }
    }
    if(!col) return { righe: [], info: info };
    for(var k = inizio; k < tabella.length; k++){
      var t = tabella[k] || [], cod = pulisci(t[col.codice]), saldo = numero(t[col.saldo]);
      if(!cod || saldo === null) continue;
      righe.push(riga(cod, col.descrizione === undefined ? "" : t[col.descrizione], col.commessa === undefined ? "" : t[col.commessa], saldo,
        col.unitario === undefined ? null : numero(t[col.unitario]), col.totale === undefined ? null : numero(t[col.totale])));
    }
    return { righe: unisci(righe, info), info: info };
  }

  // Testo CSV → matrice (separatore ; o , o tabulazione, campi tra virgolette).
  function csv(testo){
    testo = String(testo).replace(/^﻿/, "");
    var prima = testo.split(/\r?\n/, 1)[0] || "", sep = ";";
    if(prima.split("\t").length > prima.split(sep).length) sep = "\t";
    else if(prima.split(",").length > prima.split(";").length) sep = ",";
    var out = [], rigaCorr = [], campo = "", dentro = false;
    for(var i = 0; i < testo.length; i++){
      var ch = testo[i];
      if(dentro){
        if(ch === '"'){ if(testo[i + 1] === '"'){ campo += '"'; i++; } else dentro = false; }
        else campo += ch;
      }
      else if(ch === '"') dentro = true;
      else if(ch === sep){ rigaCorr.push(campo); campo = ""; }
      else if(ch === "\n"){ rigaCorr.push(campo); out.push(rigaCorr); rigaCorr = []; campo = ""; }
      else if(ch !== "\r") campo += ch;
    }
    if(campo || rigaCorr.length){ rigaCorr.push(campo); out.push(rigaCorr); }
    return out;
  }

  /* ---------- Ricerca di un codice letto da una foto ---------- */

  // Solo lettere e cifre; i caratteri che la lettura confonde diventano uguali.
  function canon(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function simile(s){
    return canon(s).replace(/[OQD]/g, "0").replace(/[IL]/g, "1").replace(/B/g, "8").replace(/S/g, "5").replace(/Z/g, "2").replace(/G/g, "6");
  }
  function distanza(a, b, max){
    if(Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], i, j;
    for(j = 0; j <= b.length; j++) prev[j] = j;
    for(i = 1; i <= a.length; i++){
      var cur = [i], min = i;
      for(j = 1; j <= b.length; j++){
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if(cur[j] < min) min = cur[j];
      }
      if(min > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /*
   * testi = righe e parole lette dalla foto. Restituisce le righe del report
   * più somiglianti, la migliore per prima: prima i codici letti esattamente,
   * poi quelli contenuti in una riga letta, poi quelli con uno o due caratteri diversi.
   */
  function cerca(testi, righe){
    var letti = [], visti = {};
    testi.forEach(function(t){
      var c = canon(t);
      if(c.length >= 3 && !visti[c]){ visti[c] = 1; letti.push({ c: c, s: simile(t) }); }
    });
    var out = [];
    righe.forEach(function(r){
      var c = canon(r.codice), s = simile(r.codice), punti = 0;
      if(c.length < 3) return;
      letti.forEach(function(l){
        var p = 0;
        if(l.c === c) p = 100;
        else if(l.s === s) p = 90;
        else if(c.length >= 5 && l.c.indexOf(c) >= 0) p = 80 + Math.min(c.length, 15) / 2;
        else if(c.length >= 5 && l.s.indexOf(s) >= 0) p = 70 + Math.min(c.length, 15) / 2;
        else if(c.length >= 6){
          var max = c.length >= 10 ? 2 : 1, d = distanza(l.s, s, max);
          if(d <= max) p = 60 - 15 * d;
        }
        if(p > punti) punti = p;
      });
      if(punti) out.push({ riga: r, punti: punti });
    });
    out.sort(function(a, b){ return b.punti - a.punti || b.riga.codice.length - a.riga.codice.length; });
    return out.slice(0, 6);
  }

  var api = { numero: numero, dataIso: dataIso, chiave: chiave, codice: codicePulito, pulisci: pulisci, daPdf: daPdf, daTabella: daTabella, csv: csv, canon: canon, cerca: cerca };
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InvReport = api;
})(typeof self !== "undefined" ? self : this);
