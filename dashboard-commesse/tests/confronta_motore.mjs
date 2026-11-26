// Verifica che il motore JavaScript dia gli stessi risultati della pipeline Python.
// Uso:  npm install  (una volta)  poi  node tests/confronta_motore.mjs
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import "../web/js/motore.js";

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inp = (f) => path.join(R, "input", f);
const parseHtml = (h) => new JSDOM(h).window.document;

async function pagine(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    out.push({ items: tc.items.filter((x) => x.str !== undefined).map((x) => ({ s: x.str, x0: x.transform[4], x1: x.transform[4] + x.width, top: vp.height - x.transform[5] })) });
  }
  return out;
}

const t0 = Date.now(), log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const cfg = JSON.parse(fs.readFileSync(path.join(R, "config/soglie.json"), "utf8"));
const ov = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(R, "config/override.json"), "utf8"))).filter(([k]) => !k.startsWith("_")));
const src = { prospetti: {} };
for (const f of fs.readdirSync(path.join(R, "input")).filter((x) => /^Prospetto.*\.html$/.test(x))) {
  const p = Motore.leggiProspetto(fs.readFileSync(inp(f), "utf8"), parseHtml);
  src.prospetti[f] = p;
}
log(`prospetti: ${Object.keys(src.prospetti).length}`);
src.responsabili = Motore.leggiTotaliResponsabili(fs.readFileSync(inp("Totali responsabili.html"), "utf8"), parseHtml);
src.elenco = { righe: Motore.leggiElenco(await pagine(inp("Elenco Commesse per Tipologia.pdf"))) }; log(`elenco: ${src.elenco.righe.length}`);
src.lista = { righe: Motore.leggiLista(await pagine(inp("Lista commesse 26_11_26.pdf"))) }; log(`lista: ${src.lista.righe.length}`);
const o = Motore.leggiOrdini(await pagine(inp("Ordini da cliente.pdf"))); src.ordini = o; log(`ordini: ${o.righe.length} righe, ${o.totali.length} totali`);
src.fatture = { righe: Motore.leggiFatture(await pagine(inp("Fatture emesse.pdf"))) }; log(`fatture: ${src.fatture.righe.length}`);

const js = Motore.costruisci(src, cfg, ov);
const py = JSON.parse(fs.readFileSync(path.join(R, "data/commesse.json"), "utf8"));
const P = Object.fromEntries(py.commesse.map((c) => [c.codice, c])), J = Object.fromEntries(js.commesse.map((c) => [c.codice, c]));
let diff = 0; const norm = (v) => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v;
const say = (m) => { if (diff++ < 40) console.log("  DIFF " + m); };
for (const k of new Set([...Object.keys(P), ...Object.keys(J)])) {
  if (!P[k]) { say(`${k} solo JS`); continue; } if (!J[k]) { say(`${k} solo Python`); continue; }
  for (const f of ["ricavi", "costi", "mlc", "fatturato", "scostamento", "ordine", "residuo", "fatture_totale", "ordine_totale_pdf", "fatt_su_ordini"]) {
    const a = P[k][f], b = J[k][f];
    if ((a === null) !== (b === null) || (a !== null && Math.abs(a - b) > 0.011)) say(`${k}.${f} py=${a} js=${b}`);
  }
  // descrizione e cliente: il motore JS legge il testo da pdf.js (stessa sostanza, a volte più completo)
  for (const f of ["capo", "apertura", "chiusura", "chiusura_stimata", "stato", "da_chiudere", "in_avvio", "ultima_attivita", "ultima_fattura", "fm_fonte"])
    if (norm(P[k][f]) !== norm(J[k][f]) && !(f === "apertura" && P[k][f] === null)) say(`${k}.${f} py=${JSON.stringify(P[k][f])} js=${JSON.stringify(J[k][f])}`);
  if ([...P[k].anomalie].sort().join() !== [...J[k].anomalie].sort().join()) say(`${k}.anomalie py=${P[k].anomalie} js=${J[k].anomalie}`);
  if (JSON.stringify(P[k].fm) !== JSON.stringify(J[k].fm)) {
    const ks = new Set([...Object.keys(P[k].fm), ...Object.keys(J[k].fm)]);
    if ([...ks].some((m) => Math.abs((P[k].fm[m] || 0) - (J[k].fm[m] || 0)) > 0.011)) say(`${k}.fm differisce`);
  }
}
console.log(`commesse Python ${py.commesse.length}, JS ${js.commesse.length}, differenze: ${diff}`);
console.log("escluse py", JSON.stringify(Object.fromEntries(Object.entries(py.escluse).map(([k, v]) => [k, v.length]))), "js", JSON.stringify(js.escluse));
const rc = js.riconciliazione;
console.log(`riconciliazione JS: prospetti ${rc.prospetti_ok}/${rc.prospetti_tot}, ordini diff ${rc.ordini_diff.length}, resp ${rc.responsabili && rc.responsabili.controlli.filter((x) => x.ok).length}/${rc.responsabili && rc.responsabili.controlli.length}, pagine con differenza ${o.diffPagine.length} (${JSON.stringify(o.diffPagine.slice(0, 3))})`);
process.exit(diff ? 1 : 0);
