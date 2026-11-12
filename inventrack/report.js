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
 *   InvReport.sommaVarianti(righe, commessa)  una riga per articolo: la giacenza è
 *                                la somma delle sole quantità positive della commessa
 *                                e delle sue varianti (S1852 + S1852V04 + …)
 *   InvReport.ripartisci(…)      differenze di un articolo commessa per commessa
 *   InvReport.pianoMovimenti(…)  file CSV dei movimenti: rientro dal cantiere, avanzi
 *                                delle varianti, differenze; e lista dei recuperati
 *   InvReport.numero(testo)      "10.813,20" → 10813.2
 *   InvReport.chiave(cod, com)   identificativo di una riga (codice + commessa)
 *   InvReport.cerca(testi, righe) articoli che somigliano ai testi letti da una foto
 *
 * Ogni riga letta è { codice, descrizione, commessa, attesa, valore }:
 * attesa = colonna Saldo, valore = valore unitario (Totale riga / Saldo).
 * Il report di giacenza può essere riassunto (una riga per articolo e commessa)
 * o con il dettaglio dei movimenti (una riga per movimento, Saldo progressivo
 * per commessa): si leggono entrambi.
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
    info.ripetutiElenco = [];
    righe.forEach(function(r){
      var k = chiave(r.codice, r.commessa), p = mappa[k];
      if(!p){ mappa[k] = r; out.push(r); return; }
      info.ripetuti++;
      info.ripetutiElenco.push({ codice: r.codice, commessa: r.commessa, quantita: r.attesa });
      var tot = p.attesa * p.valore + r.attesa * r.valore;
      p.attesa = arrotonda(p.attesa + r.attesa, 6);
      if(typeof r.ucant === "number"){ p.ucant = arrotonda((p.ucant || 0) + r.ucant, 6); p.rcant = arrotonda((p.rcant || 0) + (r.rcant || 0), 6); }
      if(p.attesa) p.valore = arrotonda(tot / p.attesa, 6);
      if(!p.descrizione) p.descrizione = r.descrizione;
    });
    info.commesse = {};
    out.forEach(function(r){ info.commesse[r.commessa] = (info.commesse[r.commessa] || 0) + 1; });
    return out;
  }

  function riga(codice, descrizione, commessa, saldo, unitario, totale, um){
    var valore = 0;
    if(unitario !== null && unitario !== undefined) valore = unitario;
    else if(totale !== null && totale !== undefined && saldo) valore = arrotonda(totale / saldo, 6);
    var r = { codice: codicePulito(codice), descrizione: pulisci(descrizione), commessa: codicePulito(commessa), attesa: saldo || 0, valore: valore };
    if(um) r.um = pulisci(um).toUpperCase();
    return r;
  }

  /* ---------- PDF ----------
   * Due report del gestionale, riconosciuti dalle intestazioni delle colonne:
   *   "analisi"        Analisi Andamento Giacenza (per deposito e commessa):
   *                    Articolo, Descrizione, Commessa, …, Saldo, …, Totale Riga
   *   "valorizzazione" Valorizzazione a costi (magazzino aziendale, senza commessa):
   *                    Articolo, Descrizione, Cat. merc., Un. mis., Giacenza alla data,
   *                    Valore alla data (il valore unitario è Valore / Giacenza)
   */
  var NUM_ANALISI = ["Iniziale", "DocNo", "Entrata", "Uscita", "Saldo", "Unitario", "% Sc", "Totale Riga"];
  var NUM_VALORIZZ = ["Giacenza iniziale", "Giacenza alla data", "Valore alla data", "Valore Giacenza Iniziale"];

  function colonne(items){
    var c = { num: [], tipo: "" }, y = null, commesse = [];
    items.forEach(function(i){
      var s = pulisci(i.s);
      if(s === "Articolo"){ c.fineCodice = i.x + i.w; y = y === null ? i.y : Math.min(y, i.y); }
      else if(/^Commessa\b/.test(s)) commesse.push(i);
      else if(s === "Un. mis.") c.umX = i.x;
      else if(s === "Cat. merc.") c.catX = i.x;
      else if(NUM_ANALISI.indexOf(s) >= 0 || NUM_VALORIZZ.indexOf(s) >= 0){ c.num.push({ nome: s, destra: i.x + i.w, x: i.x }); y = y === null ? i.y : Math.min(y, i.y); }
    });
    if(c.fineCodice === undefined) return null;
    var nomi = c.num.map(function(n){ return n.nome; });
    if(nomi.indexOf("Saldo") >= 0) c.tipo = "analisi";
    else if(nomi.indexOf("Giacenza alla data") >= 0) c.tipo = "valorizzazione";
    else return null;
    // "Commessa" compare anche nelle selezioni in alto: serve quella sulla riga delle intestazioni.
    var vicina = commesse.filter(function(i){ return Math.abs(i.y - y) < 12; })[0];
    c.commessa = vicina ? vicina.x - 8 : null;
    c.inizioNumeri = Math.min.apply(null, c.num.map(function(n){ return n.x; })) - 20;
    c.umInizio = c.umX !== undefined ? c.umX - 8 : c.inizioNumeri;
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

  // Nel report di valorizzazione la categoria merceologica sta in una colonna
  // a destra della descrizione: si riconosce perché inizia sempre alla stessa
  // posizione. Con descrizioni lunghe può finire attaccata alla descrizione.
  function colonnaCategoria(gruppi, col, prec){
    if(col.catX === undefined) return null;
    var conta = {};
    gruppi.forEach(function(g){
      g.items.forEach(function(i){
        if(i.x >= col.catX - 40 && i.x < col.umInizio && i.x >= col.fineCodice){
          var k = Math.round(i.x), t = pulisci(i.s);
          var o = conta[k] = conta[k] || { n: 0, x: i.x, testi: {} };
          o.n++;
          o.testi[t] = (o.testi[t] || 0) + 1;
        }
      });
    });
    var best = null;
    Object.keys(conta).forEach(function(k){ if(!best || conta[k].n > best.n) best = conta[k]; });
    if(best && best.n >= 2){
      var testo = Object.keys(best.testi).sort(function(a, b){ return best.testi[b] - best.testi[a]; })[0];
      return { x: best.x, testo: testo };
    }
    return prec || null;
  }

  function rigaAnalisi(g, col){
    var cod = [], des = [], com = [], num = {}, movimento = false, causale = "";
    g.items.sort(function(a, b){ return a.x - b.x; }).forEach(function(i){
      if(i.x < col.fineCodice) cod.push(i.s);
      else if(i.x >= col.inizioNumeri){
        var n = numero(i.s);
        if(n === null) return;
        var migliore = null, destra = i.x + i.w;
        col.num.forEach(function(h){ if(!migliore || Math.abs(h.destra - destra) < Math.abs(migliore.destra - destra)) migliore = h; });
        num[migliore.nome] = n;
      }
      else if(col.commessa !== null && i.x >= col.commessa){
        if(RE_DATA.test(pulisci(i.s))) movimento = true; // colonna DtaReg: è la riga di un movimento
        else if(!com.length && i.x < col.commessa + 40) com.push(i.s);
        else if(com.length && !causale) causale = pulisci(i.s).toUpperCase(); // colonna Causale (ACQ-O, I-CINST…)
      }
      else des.push(i.s);
    });
    var codice = pulisci(cod.join(" ")), descr = pulisci(des.join(" "));
    var haNumeri = "Saldo" in num || "Entrata" in num || "Uscita" in num;
    return { codice: codice, descr: descr, commessa: com.join(""), causale: causale, num: num, movimento: movimento, haNumeri: haNumeri, vuota: !Object.keys(num).length };
  }

  function rigaValorizzazione(g, col, cat){
    var cod = [], des = [], um = [], num = {};
    g.items.sort(function(a, b){ return a.x - b.x; }).forEach(function(i){
      if(i.x < col.fineCodice) cod.push(i.s);
      else if(i.x >= col.inizioNumeri){
        var n = numero(i.s);
        if(n === null) return;
        var migliore = null, destra = i.x + i.w;
        col.num.forEach(function(h){ if(!migliore || Math.abs(h.destra - destra) < Math.abs(migliore.destra - destra)) migliore = h; });
        num[migliore.nome] = n;
      }
      else if(i.x >= col.umInizio) um.push(i.s);
      else if(cat && Math.abs(i.x - cat.x) <= 1.5) return; // categoria merceologica
      else des.push(i);
    });
    var codice = pulisci(cod.join(" ")), prefisso = codicePulito(codice).slice(0, 3);
    var descr = pulisci(des.map(function(i, k){
      var t = i.s;
      // Categoria attaccata alla descrizione ("… S3-4-5ABB"): solo se il testo arriva fino alla sua colonna.
      if(cat && k === des.length - 1 && i.x + i.w > cat.x - 1){
        [cat.testo, prefisso].forEach(function(c){
          if(c && t.length > c.length && t.slice(-c.length) === c) t = t.slice(0, -c.length);
        });
      }
      return t;
    }).join(" "));
    var haNumeri = "Giacenza alla data" in num;
    return { codice: codice, descr: descr, haNumeri: haNumeri, vuota: !Object.keys(num).length,
      riga: codice && haNumeri ? riga(codice, descr, "", num["Giacenza alla data"], null, num["Valore alla data"], um.join(" ")) : null };
  }

  /* Causali dei movimenti (configurabili con InvReport.causali):
   *   ACQ-O acquisto, ACQ-C carico diretto in commessa, CAR-COM carico su commessa,
   *   CAR-MAG carico a magazzino generale (servono a disimpegnare un articolo da una
   *   commessa e riservarlo a un'altra), I-CINST installazione (uscita) in cantiere,
   *   I-RCANT rientro da cantiere.
   * Per ogni riga si tengono le uscite verso il cantiere (ucant) e i rientri (rcant). */
  var causali = { carico: ["ACQ-O", "ACQ-C", "CAR-COM", "CAR-MAG"], cantiere: ["I-CINST"], rientro: ["I-RCANT"] };

  function contaCausale(r, l, info){
    var c = l.causale;
    if(!c) return;
    info.causali = info.causali || {};
    info.causali[c] = (info.causali[c] || 0) + 1;
    if(causali.cantiere.indexOf(c) >= 0) r.ucant = arrotonda(r.ucant + (l.num.Uscita || 0) - (l.num.Entrata || 0), 6);
    else if(causali.rientro.indexOf(c) >= 0) r.rcant = arrotonda(r.rcant + (l.num.Entrata || 0) - (l.num.Uscita || 0), 6);
  }

  function descrizioneIn(articolo, testo){
    articolo.descrizione = pulisci(articolo.descrizione + " " + testo);
    articolo.righe.forEach(function(r){ r.descrizione = articolo.descrizione; });
  }

  function daPdf(pagine){
    var righe = [], info = { tipo: "", deposito: "", commessa: "", stampatoIl: "", finoAl: "", pagine: pagine.length }, col = null, corrente = null, cat = null;
    var articolo = null, movimenti = {}, articoli = [];
    pagine.forEach(function(pag){
      var items = pag.items.filter(function(i){ return pulisci(i.s); });
      var c = colonne(items);
      if(c) col = c;
      if(!col) return;
      info.tipo = col.tipo;
      if(col.tipo === "analisi"){
        if(!info.deposito) info.deposito = accanto(items, "Da Deposito").toUpperCase();
        if(!info.commessa) info.commessa = accanto(items, "Da Commessa").toUpperCase();
        if(!info.finoAl) info.finoAl = dataIso(accanto(items, "A Data Reg."));
      } else if(!info.finoAl){
        // "Valorizzazione in data 31/10/2026": la giacenza è quella di quel giorno.
        items.forEach(function(i){
          var m = /(?:Valorizzazione in data|^In data)\s+(\d{2}\/\d{2}\/\d{4})/.exec(pulisci(i.s));
          if(m && !info.finoAl) info.finoAl = dataIso(m[1]);
        });
      }
      // Data di stampa: da sola in alto o in basso nella pagina.
      items.forEach(function(i){ if((i.y < 60 || (col.tipo === "valorizzazione" && i.y > 560)) && RE_DATA.test(pulisci(i.s)) && !info.stampatoIl) info.stampatoIl = dataIso(pulisci(i.s)); });

      // Righe della tabella: il testo sotto le intestazioni, raggruppato per altezza.
      var sotto = items.filter(function(i){ return i.y < col.y - 3; }).sort(function(a, b){ return b.y - a.y || a.x - b.x; });
      var gruppi = [];
      sotto.forEach(function(i){
        var g = gruppi[gruppi.length - 1];
        if(g && Math.abs(g.y - i.y) <= 2.5) g.items.push(i);
        else gruppi.push({ y: i.y, items: [i] });
      });
      if(col.tipo === "valorizzazione") cat = colonnaCategoria(gruppi, col, cat);
      gruppi.forEach(function(g){
        if(col.tipo !== "analisi"){
          var v = rigaValorizzazione(g, col, cat);
          if(v.riga){ corrente = v.riga; righe.push(corrente); }
          else if(!v.codice && v.descr && v.vuota && corrente) corrente.descrizione = pulisci(corrente.descrizione + " " + v.descr);
          return;
        }
        var l = rigaAnalisi(g, col);
        if(l.codice && l.haNumeri){
          // Lo stesso codice ripetuto in cima a una nuova pagina continua l'articolo già iniziato.
          if(!articolo || codicePulito(articolo.codice) !== codicePulito(l.codice)){ articolo = { codice: l.codice, descrizione: l.descr, righe: [] }; articoli.push(articolo); }
        }
        else if(!l.codice && l.haNumeri && l.commessa && articolo){
          // Report con il dettaglio dei movimenti: il codice è scritto solo sulla prima riga dell'articolo.
          if(l.descr) descrizioneIn(articolo, l.descr);
        }
        else{
          // "TOTALE ARTICOLO …": entrate e uscite dell'articolo, per controllare la lettura.
          if(!l.codice && articolo && /^TOTALE ARTICOLO\b/i.test(l.descr) && "Entrata" in l.num && "Uscita" in l.num) articolo.totale = arrotonda(l.num.Entrata - l.num.Uscita, 6);
          // Descrizione su più righe (anche a cavallo di due pagine).
          else if(!l.codice && l.descr && l.vuota && articolo) descrizioneIn(articolo, l.descr);
          return;
        }
        var k = chiave(articolo.codice, l.commessa), gia = l.movimento ? movimenti[k] : null;
        if(gia){
          // Il Saldo dei movimenti è progressivo per commessa: vale quello dell'ultima riga.
          if("Saldo" in l.num) gia.attesa = l.num.Saldo;
          if(l.num.Entrata > 0 && l.num.Unitario) gia.valore = l.num.Unitario;
          contaCausale(gia, l, info);
          return;
        }
        var nuova = riga(articolo.codice, articolo.descrizione, l.commessa, l.num.Saldo, l.num.Unitario, l.num["Totale Riga"]);
        articolo.righe.push(nuova);
        righe.push(nuova);
        if(l.movimento){ movimenti[k] = nuova; info.movimenti = true; nuova.ucant = 0; nuova.rcant = 0; contaCausale(nuova, l, info); }
      });
    });
    // Controllo con i totali stampati dal report: entrate − uscite di ogni articolo
    // deve essere uguale alla somma dei saldi letti per le sue commesse.
    info.controllati = 0;
    info.nonQuadrano = [];
    info.causaliSconosciute = Object.keys(info.causali || {}).filter(function(c){
      return causali.carico.concat(causali.cantiere, causali.rientro).indexOf(c) < 0;
    });
    articoli.forEach(function(a){
      if(a.totale === undefined) return;
      info.controllati++;
      var somma = a.righe.reduce(function(t, r){ return t + r.attesa; }, 0);
      if(Math.abs(somma - a.totale) > 0.0001) info.nonQuadrano.push({ codice: a.codice, letto: arrotonda(somma, 6), totale: a.totale });
    });
    return { righe: unisci(righe, info), info: info };
  }

  /* ---------- Commessa e varianti ----------
   * Il materiale comprato per la commessa (S1852) viene spesso scaricato su una
   * sua variante (S1852V04) che non l'aveva mai caricato: la commessa resta con
   * una giacenza più alta del vero e la variante va in negativo. Regola:
   *   - la giacenza di magazzino è la SOMMA DELLE SOLE QUANTITÀ POSITIVE della
   *     commessa e di tutte le commesse il cui codice inizia con il suo;
   *   - le varianti in negativo restano in negativo e non contano;
   *   - si corregge solo la commessa padre.
   * In "dettaglio" resta il saldo di ogni commessa (anche negativo). */
  function leggiParti(t){
    return String(t || "").split(" · ").map(function(x){
      var p = x.split(": ");
      return p.length === 2 && p[0] ? { commessa: codicePulito(p[0]), q: Number(p[1].replace(",", ".")) } : null;
    }).filter(function(x){ return x && isFinite(x.q); });
  }
  function scriviParti(parti){ return parti.map(function(x){ return x.commessa + ": " + String(x.q).replace(".", ","); }).join(" · "); }

  function sommaVarianti(righe, commessa){
    commessa = codicePulito(commessa);
    var mappa = {}, out = [];
    righe.forEach(function(r){
      var k = codicePulito(r.codice), p = mappa[k];
      if(!p){
        p = mappa[k] = { riga: { codice: r.codice, descrizione: r.descrizione, commessa: commessa, attesa: 0, valore: 0 }, parti: [], valoreBase: 0, valoreAltro: 0 };
        if(r.um) p.riga.um = r.um;
        out.push(p.riga);
      }
      p.riga.attesa = arrotonda(p.riga.attesa + Math.max(0, r.attesa), 6);
      if(typeof r.ucant === "number"){
        p.riga.ucant = arrotonda((p.riga.ucant || 0) + r.ucant, 6);
        p.riga.rcant = arrotonda((p.riga.rcant || 0) + (r.rcant || 0), 6);
      }
      if(!p.riga.descrizione) p.riga.descrizione = r.descrizione;
      p.parti.push(r);
      if(r.valore){ if(r.commessa === commessa) p.valoreBase = r.valore; else if(!p.valoreAltro) p.valoreAltro = r.valore; }
    });
    Object.keys(mappa).forEach(function(k){
      var p = mappa[k];
      p.riga.valore = p.valoreBase || p.valoreAltro || 0;
      if(p.parti.length > 1 || p.parti[0].commessa !== commessa){
        p.riga.dettaglio = scriviParti(p.parti.map(function(r){ return { commessa: r.commessa, q: r.attesa }; }));
      }
    });
    return out;
  }

  /* ---------- Differenze di un articolo, commessa per commessa ----------
   * riga     la riga dell'inventario (con "dettaglio" se somma commessa e varianti)
   * reale    giacenza reale totale contata
   * parti    divisione per commessa ("S1852: 3000 · S1852V06: 380"), se inserita
   * padre    commessa dell'inventario
   * Senza divisione tutta la differenza è sulla padre. Con la divisione ogni
   * commessa si confronta con la propria giacenza positiva (le commesse non
   * indicate valgono zero: l'avanzo di una variante portato sulla padre). */
  function ripartisci(riga, reale, parti, padre){
    padre = codicePulito(padre);
    var libro = leggiParti(riga.dettaglio), B = {};
    if(!libro.length) libro = [{ commessa: padre, q: riga.attesa }];
    libro.forEach(function(x){ B[x.commessa] = Math.max(0, x.q); });
    if(!(padre in B)) B[padre] = 0;
    var E = 0, d = {}, contate = leggiParti(parti);
    Object.keys(B).forEach(function(k){ E += B[k]; });
    if(contate.length){
      var R = {};
      contate.forEach(function(x){ R[x.commessa] = (R[x.commessa] || 0) + x.q; });
      Object.keys(R).forEach(function(k){ if(!(k in B)) B[k] = 0; });
      Object.keys(B).forEach(function(k){ d[k] = arrotonda((R[k] || 0) - B[k], 6); });
    } else {
      Object.keys(B).forEach(function(k){ d[k] = 0; });
      d[padre] = arrotonda(reale - E, 6);
    }
    var out = { attesa: arrotonda(E, 6), padre: { differenza: d[padre], rientro: 0, carico: 0, meno: 0 }, varianti: {}, cantiere: { netto: 0, spiegato: 0, oltre: 0 } };
    var varianti = Object.keys(B).filter(function(k){ return k !== padre; }).sort(), mancanti = 0;
    varianti.forEach(function(k){
      out.varianti[k] = { differenza: d[k], trasferito: 0, meno: 0, piu: 0 };
      if(d[k] < 0) mancanti += -d[k]; else if(d[k] > 0) out.varianti[k].piu = d[k];
    });
    var X = d[padre];
    if(X < 0) out.padre.meno = -X;
    var A = X > 0 ? Math.min(X, mancanti) : 0;
    // L'avanzo che manca dalle varianti e che la padre ha in più è stato portato sulla padre.
    varianti.forEach(function(k){
      if(d[k] >= 0) return;
      var t = Math.min(-d[k], A);
      A = arrotonda(A - t, 6);
      out.varianti[k].trasferito = arrotonda(t, 6);
      out.varianti[k].meno = arrotonda(-d[k] - t, 6);
    });
    if(X > 0){
      out.padre.carico = arrotonda(Math.min(X, mancanti), 6);
      out.padre.rientro = arrotonda(X - out.padre.carico, 6);
      out.cantiere.netto = Math.max(0, arrotonda((riga.ucant || 0) - (riga.rcant || 0), 6));
      out.cantiere.spiegato = Math.min(out.padre.rientro, out.cantiere.netto);
      out.cantiere.oltre = arrotonda(out.padre.rientro - out.cantiere.spiegato, 6);
    }
    return out;
  }

  /* ---------- Movimenti da importare nel gestionale ----------
   * conteggi: [{ riga, reale, parti, extra }] (solo gli articoli contati).
   * Restituisce i file (uno per tipo di movimento e per commessa) e l'elenco dei
   * "recuperati" (articoli trovati che non sono nel report: lista promemoria). */
  function pianoMovimenti(conteggi, padre, conDettaglio, opzioni){
    padre = codicePulito(padre);
    opzioni = opzioni || {};
    var file = {}, ordine = [], recuperati = [], righeExcel = [];
    function aggiungi(id, titolo, descrizione, commessa, riga, quantita){
      if(!(quantita > 1e-7)) return;
      if(!file[id]){ file[id] = { id: id, titolo: titolo, descrizione: descrizione, commessa: commessa, righe: [] }; ordine.push(id); }
      file[id].righe.push({ codice: riga.codice, quantita: arrotonda(quantita, 6), valore: riga.valore || 0, descrizione: riga.descrizione });
    }
    conteggi.forEach(function(c){
      var riga = c.riga;
      if(riga.extra){
        if(c.reale > 1e-7) recuperati.push({ codice: riga.codice, descrizione: riga.descrizione, commessa: padre, quantita: c.reale, um: riga.um || "" });
        return;
      }
      var x = ripartisci(riga, c.reale, c.parti, padre);
      var base = { codice: riga.codice, descrizione: riga.descrizione, um: riga.um || "", valore: riga.valore || 0, attesa: x.attesa, reale: c.reale };
      function excel(commessa, tipo, quantita, nota){ if(quantita > 1e-7) righeExcel.push(Object.assign({ commessa: commessa, tipo: tipo, quantita: arrotonda(quantita, 6), nota: nota || "" }, base)); }
      if(x.padre.rientro > 1e-7){
        var n = x.cantiere;
        var nota = conDettaglio
          ? (n.netto > 0 ? "uscite verso il cantiere non rientrate: " + n.netto + (n.oltre > 0 ? "; oltre le uscite: " + n.oltre + " (recuperato dal cantiere, articolo già gestito)" : "") : "nessuna uscita verso il cantiere da rientrare: articolo recuperato dal cantiere, già gestito")
          : "";
        if(conDettaglio){
          aggiungi("rientro", "Rientro dal cantiere - " + padre, "Materiale presente in magazzino in più di quanto risulta dal gestionale: uscite verso il cantiere (I-CINST) non rientrate, oppure articoli già gestiti recuperati dal cantiere. Da registrare come rientro da cantiere (I-RCANT) sulla commessa " + padre + ".", padre, riga, x.padre.rientro);
          excel(padre, "Rientro dal cantiere", x.padre.rientro, nota);
        } else {
          // Report riassunto: senza le causali non si può dire se sia un rientro dal cantiere.
          aggiungi("piu-" + padre, "Differenza in più - " + padre, "Materiale presente in magazzino in più di quanto risulta dal gestionale sulla commessa " + padre + ": movimento positivo (carico). Il report non ha il dettaglio dei movimenti, quindi non si può verificare se è un rientro dal cantiere.", padre, riga, x.padre.rientro);
          excel(padre, "Differenza in più", x.padre.rientro, "report senza dettaglio dei movimenti: rientro dal cantiere non verificabile");
        }
      }
      if(x.padre.carico > 1e-7){
        aggiungi("carico-avanzi", "Carico avanzi varianti - " + padre, "Avanzo di materiale acquistato per le varianti e spostato fisicamente sulla commessa " + padre + ": da caricare sulla padre (contropartita dello scarico dalle varianti).", padre, riga, x.padre.carico);
        excel(padre, "Carico avanzi varianti", x.padre.carico, "contropartita dello scarico dalle varianti");
      }
      if(x.padre.meno > 1e-7){
        aggiungi("meno-" + padre, "Differenza in meno - " + padre, "Materiale che il gestionale dà in giacenza sulla commessa " + padre + " ma che in magazzino non c'è: movimento negativo (scarico).", padre, riga, x.padre.meno);
        excel(padre, "Differenza in meno", x.padre.meno);
      }
      Object.keys(x.varianti).forEach(function(v){
        var y = x.varianti[v];
        aggiungi("avanzo-" + v, "Scarico avanzo variante " + v, "Avanzo di materiale acquistato per la variante " + v + ", spostato fisicamente sulla padre " + padre + " e non ancora scaricato dalla variante: scarico dalla variante " + v + ".", v, riga, y.trasferito);
        excel(v, "Scarico avanzo variante", y.trasferito, "spostato sulla padre " + padre);
        aggiungi("meno-" + v, "Differenza in meno - " + v, "Materiale che il gestionale dà in giacenza sulla variante " + v + " ma che non c'è in magazzino: movimento negativo (scarico).", v, riga, y.meno);
        excel(v, "Differenza in meno", y.meno);
        aggiungi("piu-" + v, "Differenza in più - " + v, "Materiale contato sulla variante " + v + " in più del gestionale: movimento positivo (carico).", v, riga, y.piu);
        excel(v, "Differenza in più", y.piu);
      });
    });
    // Varianti inventariate per intero: ciò che il gestionale dà in giacenza sulle varianti e che
    // non è stato trovato (articolo non contato) non c'è più, e si scarica dalla variante.
    // La padre di questi articoli non è stata contata e non si tocca: va solo verificata.
    var daVerificare = [];
    (opzioni.nonContate || []).forEach(function(riga){
      var libro = leggiParti(riga.dettaglio), azzerate = [], padreQ = 0;
      libro.forEach(function(x){ if(x.commessa === padre) padreQ = Math.max(0, x.q); });
      libro.forEach(function(x){
        if(x.commessa === padre || !(x.q > 1e-7)) return;
        aggiungi("meno-" + x.commessa, "Differenza in meno - " + x.commessa, "Materiale che il gestionale dà in giacenza sulla variante " + x.commessa + " ma che non c'è in magazzino: movimento negativo (scarico).", x.commessa, riga, x.q);
        righeExcel.push({ commessa: x.commessa, tipo: "Differenza in meno", quantita: arrotonda(x.q, 6), nota: "articolo non trovato in magazzino (varianti inventariate per intero)", codice: riga.codice, descrizione: riga.descrizione, um: riga.um || "", valore: riga.valore || 0, attesa: riga.attesa, reale: null });
        azzerate.push(x.commessa + ": " + String(x.q).replace(".", ","));
      });
      if(azzerate.length) daVerificare.push({ codice: riga.codice, descrizione: riga.descrizione, um: riga.um || "", azzerate: azzerate.join(" · "), padre: padreQ });
    });
    var primi = ["rientro", "piu-" + padre, "carico-avanzi", "meno-" + padre];
    ordine.sort(function(a, b){
      var ia = primi.indexOf(a), ib = primi.indexOf(b);
      if(ia < 0) ia = 99; if(ib < 0) ib = 99;
      return ia - ib || (a < b ? -1 : a > b ? 1 : 0);
    });
    return { file: ordine.map(function(id){ return file[id]; }), recuperati: recuperati, righeExcel: righeExcel, daVerificare: daVerificare };
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
        else if(/^(saldo|giacenza|esistenza|quantit[aà]|qta|q\.t[aà])/.test(s)){
          // Con più colonne di giacenza (iniziale, alla data) vale quella "alla data" o il saldo.
          var preferita = /alla data|saldo/.test(s);
          if(c.saldo === undefined || (preferita && !c.saldoPreferita)){ c.saldo = j; c.saldoPreferita = preferita; }
        }
        else if(c.um === undefined && /^(un\.? ?mis|u\.? ?m\.?$|unit[aà] di misura)/.test(s)) c.um = j;
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
        col.unitario === undefined ? null : numero(t[col.unitario]), col.totale === undefined ? null : numero(t[col.totale]), col.um === undefined ? "" : t[col.um]));
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

  var api = { numero: numero, dataIso: dataIso, chiave: chiave, codice: codicePulito, pulisci: pulisci, daPdf: daPdf, daTabella: daTabella, sommaVarianti: sommaVarianti, ripartisci: ripartisci, pianoMovimenti: pianoMovimenti, leggiParti: leggiParti, scriviParti: scriviParti, causali: causali, csv: csv, canon: canon, cerca: cerca };
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InvReport = api;
})(typeof self !== "undefined" ? self : this);
