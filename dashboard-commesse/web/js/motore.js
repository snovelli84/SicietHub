/*
 * MOTORE DATI – SICIET Andamento commesse (versione JavaScript della pipeline Python)
 * ----------------------------------------------------------------------------------
 * Legge nel browser le esportazioni Mago4 (Prospetti HTML/XML, PDF) e applica le STESSE regole di
 * pipeline/regole.py. È verificato contro la pipeline Python (vedi tests/confronta_motore.mjs).
 * Funziona sia nel browser sia in Node (per i test).
 *
 *   Motore.leggiProspetto(testoHtml, parseHtml)     -> sorgente "prospetto"
 *   Motore.leggiTotaliResponsabili(testoHtml, parseHtml)
 *   Motore.leggiElenco(pagine) / leggiLista(pagine) / leggiOrdini(pagine) / leggiFatture(pagine)
 *       pagine = [{ items:[{s,x0,x1,top}] }]   (voci di testo con posizione; top = distanza dall'alto)
 *   Motore.costruisci(sorgenti, cfg, override)      -> { commesse, escluse, riconciliazione }
 */
(function (root) {
  "use strict";

  /* ---------------- utilità ---------------- */
  const MONEY = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const num = (s) => {
    s = String(s == null ? "" : s).trim().replace(/ /g, "");
    return MONEY.test(s) ? Math.round(parseFloat(s.replace(/\./g, "").replace(",", ".")) * 100) / 100 : null;
  };
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const isoData = (s) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
    if (!m) return null;
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1]) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  };
  const gruppo = (c) => c.slice(0, 5);
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();

  /* testo di un nodo come BeautifulSoup get_text(" ", strip=True) */
  function testoNodo(n) {
    const out = [];
    (function rec(x) {
      for (const c of x.childNodes) {
        if (c.nodeType === 3) { const t = c.nodeValue.replace(/\s+/g, " ").trim(); if (t) out.push(t); }
        else if (c.nodeType === 1) { const tg = c.tagName.toLowerCase(); if (tg !== "script" && tg !== "style") rec(c); }
      }
    })(n);
    return out.join(" ");
  }
  const figliTd = (tr) => Array.from(tr.children).filter((c) => c.tagName.toLowerCase() === "td");
  const haClasse = (el, k) => (el.getAttribute("class") || "").split(/\s+/).includes(k);
  const pulisciTitle = (t) => norm(String(t || "").replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, " "));

  /* ---------------- Prospetto Margine Economico (HTML/XML) ---------------- */
  const STATI = new Set(["Chiusa", "In Progress", "Nuova", "In Contenzioso", "Aperta", "Sospesa", "Annullata", "Conclusa"]);

  function primaDellaCella(codTd) {
    let stato = "", costi = {};
    let sib = codTd.previousElementSibling;
    while (sib) {
      if (sib.tagName.toLowerCase() === "td") {
        const els = [sib].concat(Array.from(sib.querySelectorAll("[title]")));
        for (const el of els) {
          const ti = el.getAttribute("title") || "";
          if (STATI.has(ti.trim())) stato = ti.trim();
          else if (ti.includes("Costi")) {
            const t = pulisciTitle(ti);
            let m = /Costi Cons\. Complessivi:\s*(-?[\d.]+,\d\d)\s*-\s*Costi Previsti:\s*(-?[\d.]+,\d\d)/.exec(t);
            if (m) costi = { costi_consuntivati: num(m[1]), costi_previsti: num(m[2]) };
            else {
              const c = /Costi Consuntivati:\s*(-?[\d.]+,\d\d)/.exec(t), p = /Costi Previsti:\s*(-?[\d.]+,\d\d)/.exec(t);
              if (c) costi.costi_consuntivati = num(c[1]);
              if (p) costi.costi_previsti = num(p[1]);
            }
          }
        }
      }
      sib = sib.previousElementSibling;
    }
    return [stato, costi];
  }

  function leggiProspetto(html, parseHtml) {
    const doc = parseHtml(html);
    const titolo = norm(doc.title || (doc.querySelector("title") || {}).textContent);
    const capo = titolo.replace(/^Prospetto Margine Economico\s*/, "").trim();
    const testo = testoNodo(doc.body || doc.documentElement);
    const m = /Ricavi ([\-\d.]+,\d\d) [\-\d,]+% Costi Diretti ([\-\d.]+,\d\d) [\-\d,]+% MLC ([\-\d.]+,\d\d) [\-\d,]+% Fatturato ([\-\d.]+,\d\d)/.exec(testo);
    if (!m) throw new Error("Intestazione dei totali non trovata: non sembra un Prospetto Margine Economico.");
    const intest = { ricavi: num(m[1]), costi: num(m[2]), mlc: num(m[3]), fatturato: num(m[4]) };
    const s = /Ricavi Competenza - Fatturato\s+(-?[\d.]+,\d\d)/.exec(testo);
    intest.scostamento = s ? num(s[1]) : null;

    const righe = [], aggregate = [], eco = [];
    for (const tr of doc.querySelectorAll("tr")) {
      const codTd = figliTd(tr).find((t) => haClasse(t, "box01BottomBorder"));
      if (!codTd) continue;
      const codice = testoNodo(codTd);
      if (!/^S/.test(codice)) continue;
      const rid = tr.getAttribute("id") || "";
      const figlia = /row_image\d+_\d+$/.test(rid), aggr = /^row_image\d+$/.test(rid);
      const nums = figliTd(tr).filter((t) => haClasse(t, "box01RightBottomBorder"));
      if (!nums.length) continue;
      const descrTd = nums[0];
      let resto = nums.slice(1), clienteCod = null, clienteNome = null;
      while (resto.length && num(testoNodo(resto[0])) === null) {
        const c = resto[0];
        if (testoNodo(c)) { clienteCod = testoNodo(c); clienteNome = c.getAttribute("title") || ""; }
        resto = resto.slice(1);
      }
      const v = resto.map((t) => num(testoNodo(t)));
      if (v.length < 11 || v.slice(0, 11).some((x) => x === null))
        throw new Error(`Riga ${rid || "-"} ${codice}: valori non leggibili`);
      const [stato, costi] = primaDellaCella(codTd);
      const rec = Object.assign({
        codice, descrizione: descrTd.getAttribute("title") || testoNodo(descrTd),
        ricavi: v[0], costi: v[2], mlc: v[4], mlc_pct: v[6], fatturato: v[7], scostamento: v[9],
        stato, capo, cliente_codice: clienteCod, cliente: clienteNome,
      }, costi);
      if (/^S[MLF]/.test(codice)) { if (!aggr) eco.push(rec); continue; }
      if (aggr) aggregate.push(rec);
      else { rec.riga_unica = !figlia; righe.push(rec); }
    }
    const cli = {};
    for (const a of aggregate.concat(righe)) if (a.cliente_codice && !cli[gruppo(a.codice)]) cli[gruppo(a.codice)] = [a.cliente_codice, a.cliente];
    for (const r of righe) { const c = cli[gruppo(r.codice)]; if (c) { r.cliente_codice = c[0]; r.cliente = c[1]; } }
    const somma = (L, k) => r2(L.reduce((a, x) => a + x[k], 0));
    return { capo, intestazione: intest, righe,
      economie: { n: eco.length, ricavi: somma(eco, "ricavi"), costi: somma(eco, "costi"), fatturato: somma(eco, "fatturato") } };
  }

  function leggiTotaliResponsabili(html, parseHtml) {
    const t = testoNodo(parseHtml(html).body);
    const m = /Ricavi ([\-\d.]+,\d\d) Costi Diretti ([\-\d.]+,\d\d) MLC ([\-\d.]+,\d\d) Fatturato ([\-\d.]+,\d\d)/.exec(t);
    const totale = m ? { ricavi: num(m[1]), costi: num(m[2]), mlc: num(m[3]), fatturato: num(m[4]) } : null;
    const i = t.indexOf("%MLC");
    const re = /(?:([A-Z]\d{4})\s+)?([A-Z][A-Z' .]+?\.{0,3})\s+((?:-?[\d.]+,\d\d\s+){10}-?[\d.]+,\d\d)/g;
    const righe = []; let g;
    const src = i >= 0 ? t.slice(i) : t;
    while ((g = re.exec(src))) {
      const v = g[3].split(/\s+/).map(num);
      righe.push({ codice: g[1] || "", nome: g[2].trim(), ricavi: v[0], costi: v[2], mlc: v[4], fatturato: v[7] });
    }
    return { totale, righe };
  }

  /* ---------------- PDF: righe di parole con posizione ----------------
   pdf.js restituisce "voci" di testo che possono contenere più parole (anche di colonne diverse, es.
   due date attaccate). Si spezzano in parole con posizione stimata in proporzione alla larghezza. */
  function righePagina(pag, tol) {
    const parole = [];
    for (const it of pag.items) {
      const testo = String(it.s);
      if (!testo.trim()) continue;
      const w = it.x1 - it.x0, n = testo.length;
      const re = /\S+/g; let g;
      while ((g = re.exec(testo)))
        parole.push({ s: g[0], x0: it.x0 + (g.index / n) * w, x1: it.x0 + ((g.index + g[0].length) / n) * w, top: it.top });
    }
    // raggruppo in righe per vicinanza verticale (soglia 'tol' punti rispetto alla prima voce della riga)
    parole.sort((a, b) => a.top - b.top || a.x0 - b.x0);
    const righe = [];
    for (const w of parole) {
      const ult = righe[righe.length - 1];
      if (ult && w.top - ult[0].top <= (tol || 2.2)) ult.push(w); else righe.push([w]);
    }
    return righe.map((r) => r.sort((a, b) => a.x0 - b.x0));
  }

  /* Elenco Commesse per Tipologia (con Stato e date) */
  const COL_EL = [["codice", 0, 65], ["padre", 65, 110], ["descr", 110, 296], ["cli_cod", 296, 345], ["cli", 345, 494],
    ["creazione", 494, 541], ["consegna", 541, 600], ["resto", 600, 762], ["stato", 762, 9999]];
  const colEl = (x) => { for (const [n, a, b] of COL_EL) if (x >= a && x < b) return n; return "resto"; };
  const RE_COD_EL = /^(?:S[A-Z0-9]{3,}(?:-\d+)?|RICFISC)$/;
  const SEZ = ["Standard", "Di Variante", "In Economia", "Economia"];
  const statoEl = (t) => { t = t.trim(); return t.startsWith("In Contenz") ? "In Contenzioso" : t; };

  const RE_DATA = /^\d{2}\/\d{2}\/\d{4}$/;
  const RE_STATO = /(Chiusa|In Progress|In Contenz\w*|Nuova|Sospesa|Aperta)$/;

  /* parole attaccate: «…AGRICOLA31/07/2021» (nome cliente + data) e «…ROCCETTE00319» (descrizione + codice cliente) */
  function spezzaElenco(l) {
    const out = [];
    for (const w of l) {
      let m = /^(.*\D)(\d{2}\/\d{2}\/\d{4})$/.exec(w.s);
      if (m) {
        const n = w.s.length, wd = w.x1 - w.x0, cut = w.x0 + (m[1].length / n) * wd;
        out.push({ ...w, s: m[1], x1: cut }, { ...w, s: m[2], x0: cut });
        continue;
      }
      m = /^(.*\D)(\d{5})$/.exec(w.s);
      if (m && w.x1 >= 316 && w.x1 <= 326 && w.x0 < 296) {
        const n = w.s.length, wd = w.x1 - w.x0, cut = w.x0 + (m[1].length / n) * wd;
        out.push({ ...w, s: m[1], x1: cut }, { ...w, s: m[2], x0: Math.max(cut, 297) });
        continue;
      }
      out.push(w);
    }
    return out;
  }

  function leggiElenco(pagine) {
    const out = []; let sezione = null, ultimo = null;
    for (const pag of pagine) for (const l0 of righePagina(pag)) {
      const l = spezzaElenco(l0);
      const r = { codice: [], padre: [], descr: [], cli_cod: [], cli: [], date: [], stato: [] };
      const testoRiga = l.map((w) => w.s).join(" ");
      const st = RE_STATO.exec(testoRiga);
      let nStato = 0;
      if (st) nStato = st[1].split(/\s+/).length;
      l.forEach((w, i) => {
        const x = w.x0;
        if (st && i >= l.length - nStato && x >= 700) { r.stato.push(w.s); return; }
        if (x >= 600 && !RE_DATA.test(w.s)) return;               // prezzo, responsabile
        if (RE_DATA.test(w.s) && x >= 480 && x < 600) { r.date.push(w); return; }
        if (x < 65) r.codice.push(w.s);
        else if (x < 110) r.padre.push(w.s);
        else if (x < 296) r.descr.push(w.s);
        else if (x < 345 && /^\d{5}$/.test(w.s)) r.cli_cod.push(w.s);
        else if (x < 345) r.descr.push(w.s);                      // descrizione lunga che sconfina
        else if (x < 494 + 8) r.cli.push(w.s);
      });
      const cod = r.codice.join("");
      const descr = r.descr.join(" ").trim();
      if (SEZ.includes(cod) || (SEZ.includes(descr) && !cod)) { sezione = descr || cod; continue; }
      if (RE_COD_EL.test(cod) && r.cli_cod.length) {
        let creazione = null, consegna = null;
        const d = r.date.map((w) => w.s);
        if (d.length >= 2) { creazione = isoData(d[0]); consegna = isoData(d[1]); }
        else if (d.length === 1) { if (r.date[0].x0 < 535) creazione = isoData(d[0]); else consegna = isoData(d[0]); }
        ultimo = { codice: cod, padre: r.padre.join(""), sezione, descrizione: descr, cliente_codice: r.cli_cod[0],
          cliente: r.cli.join(" "), creazione, consegna, stato: statoEl(r.stato.join(" ")) };
        out.push(ultimo);
      } else if (ultimo && !cod && descr && !descr.includes("SICIET_M4") &&
        !/^(Da|A|Estrai|Elenco|Selezione|Standard,|Commessa|Padre)/.test(descr)) {
        ultimo.descrizione += " " + descr;
      }
    }
    return out;
  }

  /* Elenco con Responsabile (capo commessa) */
  function leggiLista(pagine) {
    const out = []; let ultimo = null;
    for (const pag of pagine) for (const l of righePagina(pag)) {
      const col = { cod: [], cli: [], dat: [], nome: [], resp: [] };
      for (const w of l) {
        const x = w.x0, t = w.s;
        if (x >= 60 && x < 115) col.cod.push(t);
        else if (x >= 330 && x < 380) col.cli.push(t);
        else if (x >= 605 && x < 652 && /^[\d/]+$/.test(t)) col.dat.push(t);
        else if (x >= 652 && x < 700) col.resp.push(t);
        else if (x >= 700) col.nome.push(t);
      }
      const cod = col.cod.join("").trim();
      const nome = col.nome.join(" ").trim().replace(/\s*(ULTIMO|PRIMO)$/, "");
      const cli = col.cli.join("").trim();
      if (/^S[A-Z0-9]{3,}(?:-\d+)?$/.test(cod) && /^\d+$/.test(cli)) {
        ultimo = { codice: cod, cliente_codice: cli, creazione: isoData(col.dat.join("")), resp: col.resp.join("").trim(), nome };
        out.push(ultimo);
      } else if (ultimo && !cod && nome && !/^(Nome|Estrai|Da|A)/.test(nome) && !col.cli.length) {
        if (ultimo.nome && nome.length < 20 && /^[A-Z .']+$/.test(nome)) ultimo.nome += " " + nome;
      }
    }
    return out;
  }

  /* Ordini da cliente */
  const RE_COD_ORD = /^S[A-Z]?\d{4}[A-Z0-9]*$/;
  const isMoney = (s) => MONEY.test(s.trim());

  function leggiOrdini(pagine) {
    const righe = [], totali = [], totaliPagina = [], avvisi = [];
    pagine.forEach((pag, pi) => {
      const linee = righePagina(pag);
      const delPag = [];
      linee.forEach((l, i) => {
        const cod = l.find((w) => w.x0 >= 380 && w.x0 <= 455 && RE_COD_ORD.test(w.s.trim().replace(/^["'“”]+|["'“”]+$/g, "")));
        if (cod && l.some((w) => (w.s.trim() === "Si" || w.s.trim() === "No") && w.x0 >= 535 && w.x0 <= 548)) {
          let ordine = null, fatt = null;
          const dOrd = (l.find((w) => w.x0 < 70 && isoData(w.s.trim())) || {}).s;
          let cons = (l.find((w) => w.x0 >= 655 && isoData(w.s.trim())) || {}).s;
          for (const w of l) {
            const t = w.s.trim();
            const g = /^(-?\d{1,3}(?:\.\d{3})*,\d{2})(\d{2}\/\d{2}\/\d{4})$/.exec(t);
            if (g && w.x0 > 590) { fatt = num(g[1]); cons = cons || g[2]; }
            else if (isMoney(t)) { if (w.x1 < 580) ordine = num(t); else if (w.x0 > 590) fatt = num(t); }
          }
          const nxt = linee[i + 1];
          if (nxt && nxt.length && nxt[0].top < 520 && nxt[0].top - l[0].top < 16 && nxt.every((w) => isMoney(w.s))) {
            for (const w of nxt) {
              if (w.x1 < 580 && ordine === null) ordine = num(w.s);
              else if (w.x1 >= 580 && fatt === null) fatt = num(w.s);
            }
          }
          delPag.push({ codice: cod.s.trim().replace(/^["'“”]+|["'“”]+$/g, ""), ordine, fatturato: fatt,
            data_ordine: isoData(dOrd || ""), consegna: isoData(cons || "") });
        }
        // Totale Commessa <codice> [descrizione] [importi]
        if (l.length >= 3 && l[0].s === "Totale" && l[1].s === "Commessa") {
          const codT = l[2].s;
          let o = null, f = null;
          for (const w of l.slice(3)) { const v = num(w.s); if (v !== null) { if (w.x1 < 580) o = v; else f = v; } }
          if (o === null && f === null) {
            for (const nx of linee.slice(i + 1, i + 3)) {
              if (nx.length && nx[0].top < 520 && nx.every((w) => isMoney(w.s))) {
                for (const w of nx) { const v = num(w.s); if (w.x1 < 580) o = v; else f = v; }
                break;
              }
            }
          }
          if (o === null && f === null) avvisi.push(`pag. ${pi + 1}: Totale Commessa ${codT} senza importi leggibili`);
          totali.push({ codice: codT, ordine: o || 0, fatturato_ordini: f || 0 });
        }
      });
      for (const l of linee) {
        if (l.length === 2 && l.every((w) => isMoney(w.s)) && l[0].top > 500) totaliPagina[pi] = [num(l[0].s), num(l[1].s)];
      }
      righe.push(...delPag);
      pag._righe = delPag.length;
      pag._tot = totaliPagina[pi] || null;
      pag._ordine = delPag.reduce((a, r) => a + (r.ordine || 0), 0);
      pag._fatt = delPag.reduce((a, r) => a + (r.fatturato || 0), 0);
    });
    // controllo dei totali progressivi di pagina
    const diffPagine = []; let prev = [0, 0];
    pagine.forEach((pag, pi) => {
      const t = pag._tot; if (!t) return;
      const d = [r2(t[0] - prev[0] - pag._ordine), r2(t[1] - prev[1] - pag._fatt)];
      prev = t;
      if (d[0] !== 0 || d[1] !== 0) diffPagine.push({ pagina: pi + 1, diff_ordine: d[0], diff_fatturato: d[1] });
    });
    return { righe, totali, avvisi, diffPagine };
  }

  /* Lista fatture emesse */
  function leggiFatture(pagine) {
    const out = [];
    pagine.forEach((pag, pi) => {
      for (const l of righePagina(pag)) {
        if (l.length < 4 || l[0].x0 >= 40 || !RE_DATA.test(l[0].s) || !(l[1].x0 >= 55 && l[1].x0 <= 70)) continue;
        const d = isoData(l[0].s); if (!d) continue;
        const numero = l[1].s;
        let cod = (l.find((w) => w.x0 >= 92 && w.x0 <= 140 && RE_COD_ORD.test(w.s)) || {}).s;
        if (!cod) { const g = /(S[A-Z]?\d{4}[A-Z0-9]*)$/.exec(numero); cod = g ? g[1] : null; }
        const imp = l.find((w) => w.x1 >= 400 && w.x1 <= 462 && num(w.s) !== null);
        const cli = (l.find((w) => w.x0 >= 175 && w.x0 <= 205 && /^\d+$/.test(w.s)) || {}).s;
        out.push({ data: d, numero, commessa: cod || null, cliente_codice: cli || "", imponibile: imp ? num(imp.s) : null, pagina: pi + 1 });
      }
    });
    return out;
  }

  /* ---------------- regole di business ---------------- */
  const capoAttivo = (nome, attivi) => {
    const n = String(nome || "").toUpperCase().replace(/ì/g, "I").replace(/'/g, "");
    return attivi.some((a) => n.includes(a.toUpperCase().replace(/'/g, "")));
  };
  const eEconomia = (cod, pref) => pref.some((p) => cod.startsWith(p));

  function costruisci(src, cfg, override) {
    override = override || {};
    const pref = cfg.prefissi_economia, attivi = cfg.perimetro.capi_attivi;
    const elenco = (src.elenco && src.elenco.righe) || [];
    const lista = (src.lista && src.lista.righe) || [];
    const ordRighe = (src.ordini && src.ordini.righe) || [];
    const fatture = (src.fatture && src.fatture.righe) || [];
    const prospetti = Object.values(src.prospetti || {});

    const elPerCod = {}, elPerGr = {};
    for (const e of elenco) { elPerCod[e.codice] = e; (elPerGr[gruppo(e.codice)] ||= []).push(e); }

    const ordG = {};
    for (const r of ordRighe) {
      const g = (ordG[gruppo(r.codice)] ||= { ordine: 0, fatt: 0, n: 0, ult: null, righe: [] });
      const d = r.consegna || r.data_ordine;
      if (d && (g.ult === null || d > g.ult)) g.ult = d;
      if (r.fatturato) g.righe.push([d, r.fatturato]);
      g.ordine += r.ordine || 0; g.fatt += r.fatturato || 0; g.n++;
    }
    const fatG = {};
    for (const f of fatture) {
      if (f.commessa && f.imponibile !== null && f.imponibile !== undefined) {
        const g = (fatG[gruppo(f.commessa)] ||= { tot: 0, fm: {}, ult: null, n: 0 });
        g.tot += f.imponibile; g.n++;
        g.fm[f.data.slice(0, 7)] = (g.fm[f.data.slice(0, 7)] || 0) + f.imponibile;
        if (g.ult === null || f.data > g.ult) g.ult = f.data;
      }
    }

    const righeG = {};
    for (const p of prospetti) {
      if (!capoAttivo(p.capo, attivi)) continue;
      for (const r of p.righe) if (!eEconomia(r.codice, pref)) (righeG[gruppo(r.codice)] ||= []).push(r);
    }

    const interni = new Set(cfg.clienti_interni_codici || []);
    const resp = {}; for (const x of lista) resp[x.codice] = x;
    const nomiCli = {};
    for (const e of elenco) nomiCli[e.cliente_codice] = e.cliente;
    for (const p of prospetti) for (const r of p.righe) if (r.cliente_codice && r.cliente) nomiCli[r.cliente_codice] = r.cliente;
    const escluse = { interne: [], sospese: [], capi_non_attivi: [] };

    for (const g of Object.keys(elPerGr)) {
      const L = elPerGr[g];
      if (righeG[g] || eEconomia(g, pref)) continue;
      const std = L.find((e) => e.sezione === "Standard");
      if (!std) continue;
      if (interni.has(std.cliente_codice)) { escluse.interne.push(g); continue; }
      if (L.some((e) => e.stato !== "Chiusa")) {
        if (L.every((e) => e.stato === "Chiusa" || e.stato === "Sospesa")) { escluse.sospese.push(g); continue; }
        const capo = (resp[g] && resp[g].nome) || "(non assegnato)";
        if (capo !== "(non assegnato)" && !capoAttivo(capo, attivi)) { escluse.capi_non_attivi.push(g); continue; }
        righeG[g] = [{ codice: std.codice, descrizione: std.descrizione, capo, cliente: std.cliente,
          cliente_codice: std.cliente_codice, ricavi: 0, costi: 0, fatturato: 0, stato: std.stato, senza_prospetto: true }];
      }
    }
    for (const x of lista) {
      const g = x.codice.slice(0, 5);
      if (righeG[g] || elPerGr[g] || eEconomia(g, pref) || x.codice !== g) continue;
      if (interni.has(x.cliente_codice)) continue;
      if (x.nome && !capoAttivo(x.nome, attivi)) { escluse.capi_non_attivi.push(g); continue; }
      righeG[g] = [{ codice: g, descrizione: "(nuova commessa, non ancora nell'Elenco con Stato)", capo: x.nome || "(non assegnato)",
        cliente: nomiCli[x.cliente_codice] || x.cliente_codice, cliente_codice: x.cliente_codice, ricavi: 0, costi: 0,
        fatturato: 0, stato: "In Progress", senza_prospetto: true, nuova: true, creazione: x.creazione }];
    }

    const commesse = [];
    for (const g of Object.keys(righeG).sort()) {
      const righe = righeG[g];
      const capi = Array.from(new Set(righe.map((r) => r.capo))).sort();
      const ricavi = r2(righe.reduce((a, r) => a + r.ricavi, 0));
      const costi = r2(righe.reduce((a, r) => a + r.costi, 0));
      const fatt = r2(righe.reduce((a, r) => a + r.fatturato, 0));
      const mlc = r2(ricavi - costi);

      let stati = righe.map((r) => {
        const e = elPerCod[r.codice] || elPerCod[r.codice.replace(/-/g, "")];
        return (e && e.stato) || r.stato || "";
      }).filter(Boolean);
      const aperta = stati.length ? stati.some((s) => s !== "Chiusa") : null;

      const base = elPerCod[g], gruppoEl = elPerGr[g] || [];
      const std = (base && base.sezione === "Standard") ? base : gruppoEl.find((e) => e.sezione === "Standard");
      let cliente = (std && std.cliente) || (righe.find((r) => r.cliente) || {}).cliente || "";
      const clPr = (righe.find((r) => r.cliente) || {}).cliente || "";
      cliente = clPr || cliente;
      const apertura = (std && std.creazione) || (gruppoEl.find((e) => e.creazione) || {}).creazione ||
        (righe.find((r) => r.creazione) || {}).creazione || null;
      let chiusura = null;
      if (!aperta) {
        chiusura = (base && base.consegna) || null;
        if (!chiusura) { const d = gruppoEl.map((e) => e.consegna).filter(Boolean); chiusura = d.length ? d.sort().pop() : null; }
      }

      const c = {
        codice: g, descrizione: (std && std.descrizione) || righe[0].descrizione,
        capo: capi[0], capi, cliente, apertura, chiusura,
        stato: aperta ? "Aperta" : (aperta === false ? "Chiusa" : "n.d."),
        n_righe: righe.length, ricavi, costi, mlc, mlc_pct: ricavi ? r2(mlc / ricavi * 100) : null,
        fatturato: fatt, scostamento: r2(ricavi - fatt), ordine: null, residuo: null,
        da_chiudere: false, in_avvio: false, anomalie: [],
      };
      if (ricavi === 0 && costi === 0 && fatt === 0) { c.in_avvio = true; c.senza_prospetto = righe.some((r) => r.senza_prospetto); }

      const o = ordG[g];
      c.ultima_attivita = o ? o.ult : null;
      const fm = {};
      for (const [d, v] of (o ? o.righe : [])) if (d) fm[d.slice(0, 7)] = (fm[d.slice(0, 7)] || 0) + v;
      c.fm = Object.fromEntries(Object.keys(fm).sort().map((k) => [k, r2(fm[k])]));
      c.ordine_totale_pdf = o ? r2(o.ordine) : 0;
      c.fatt_su_ordini = o ? r2(o.fatt) : 0;
      if (aperta) {
        const ordine = o ? r2(o.ordine) : 0;
        const res = r2(ordine - (o ? r2(o.fatt) : 0));
        if (o && Math.abs(res) <= cfg.soglia_da_chiudere_euro) c.da_chiudere = true;
        else { c.ordine = ordine; c.residuo = res; }
        if (!o) c.anomalie.push("aperta_senza_ordini");
        if (res < -cfg.soglia_da_chiudere_euro) c.anomalie.push("fatturato_oltre_ordini");
      }
      const fg = fatG[g];
      c.fatture_totale = fg ? r2(fg.tot) : 0;
      c.ultima_fattura = fg ? fg.ult : null;
      if (fg && Math.abs(fg.tot - fatt) <= 1.0) {
        c.fm = Object.fromEntries(Object.keys(fg.fm).sort().map((k) => [k, r2(fg.fm[k])]));
        c.fm_fonte = "fatture";
      } else c.fm_fonte = "ordini";
      if (Math.abs((fg ? fg.tot : 0) - fatt) > 1.0) c.anomalie.push("fatture_discordanti");
      c.chiusura_stimata = null;
      if (aperta === false && !chiusura) c.chiusura_stimata = c.ultima_fattura || c.ultima_attivita;
      if (aperta === false && !chiusura) c.anomalie.push("chiusa_senza_data");
      if (ricavi && costi / ricavi > 1) c.anomalie.push("in_perdita");
      const ov = override[g] || {};
      c.dato_da_verificare = !!ov.dato_da_verificare;
      c.note = ov.nota || "";
      if (c.dato_da_verificare) c.anomalie.push("dato_da_verificare");
      commesse.push(c);
    }
    return { commesse, escluse: Object.fromEntries(Object.entries(escluse).map(([k, v]) => [k, v.length])),
      riconciliazione: riconcilia(src, cfg) };
  }

  /* ---------------- riconciliazione ---------------- */
  function riconcilia(src, cfg) {
    const tol = Math.max(cfg.tolleranza_riconciliazione_euro || 0.05, 0.02);
    const prospetti = Object.values(src.prospetti || {});
    const controlli = [];
    for (const p of prospetti) for (const k of ["ricavi", "costi", "fatturato"]) {
      const std = r2(p.righe.reduce((a, r) => a + r[k], 0)), eco = p.economie[k] || 0;
      const d = r2(p.intestazione[k] - std - eco);
      controlli.push({ capo: p.capo, voce: k, intestazione: p.intestazione[k], differenza: d, ok: Math.abs(d) <= tol });
    }
    const out = {
      prospetti_ok: controlli.filter((x) => x.ok).length, prospetti_tot: controlli.length,
      prospetti_diff: controlli.filter((x) => !x.ok),
      ordini_diff: [], ordini_senza_importi: 0, ordini_totali: 0, v6: { stato: "non fornito", nota: "Metti l'Excel v6 in input/ per il confronto automatico." },
      capi_senza_prospetto: cfg.perimetro.capi_attivi.filter((a) => !prospetti.some((p) => capoAttivo(p.capo, [a]))),
      responsabili: null,
    };
    const ord = src.ordini;
    if (ord && ord.totali) {
      const somma = {};
      for (const r of ord.righe) { const s = (somma[r.codice] ||= [0, 0]); s[0] += r.ordine || 0; s[1] += r.fatturato || 0; }
      const stamp = {};
      for (const t of ord.totali) { const s = (stamp[t.codice] ||= [0, 0]); s[0] += t.ordine; s[1] += t.fatturato_ordini; }
      for (const cod of new Set([...Object.keys(somma), ...Object.keys(stamp)])) {
        const a = somma[cod] || [0, 0], b = stamp[cod] || [0, 0];
        if (Math.abs(a[0] - b[0]) > 0.02 || Math.abs(a[1] - b[1]) > 0.02)
          out.ordini_diff.push({ codice: cod, ordine_righe: r2(a[0]), ordine_totale: r2(b[0]), fatt_righe: r2(a[1]), fatt_totale: r2(b[1]) });
      }
      out.ordini_totali = ord.totali.length; out.ordini_senza_importi = (ord.avvisi || []).length;
    }
    const rs = src.responsabili;
    if (rs && rs.righe) {
      const usate = new Set(), ctrl = [];
      for (const p of prospetti) {
        const h = p.intestazione;
        const i = rs.righe.findIndex((r, ix) => !usate.has(ix) && Math.abs(r.ricavi - h.ricavi) <= 0.05 && Math.abs(r.costi - h.costi) <= 0.05 && Math.abs(r.fatturato - h.fatturato) <= 0.05);
        if (i >= 0) usate.add(i);
        ctrl.push({ capo: p.capo, ricavi: h.ricavi, ok: i >= 0 });
      }
      out.responsabili = { controlli: ctrl, non_esportati: rs.righe.filter((_, ix) => !usate.has(ix)), totale: rs.totale };
    }
    return out;
  }

  root.Motore = { leggiProspetto, leggiTotaliResponsabili, leggiElenco, leggiLista, leggiOrdini, leggiFatture, costruisci, riconcilia, capoAttivo, util: { num, isoData, gruppo } };
})(typeof globalThis !== "undefined" ? globalThis : this);
