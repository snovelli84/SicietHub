/*
 * SICIET INVENTRACK – SERVIZIO DI ARCHIVIO DEGLI INVENTARI
 * --------------------------------------------------------
 * La pagina hub.siciet.it/inventrack manda a questo servizio gli inventari
 * (il report del gestionale e le quantità contate) e li rilegge da qualsiasi
 * dispositivo: si conta con il telefono in magazzino e si scarica l'Excel dal PC.
 * Vedi inventrack/README.md.
 *
 * È un Cloudflare Worker: il file si incolla così com'è nell'editor di Cloudflare.
 * I dati stanno in un database D1 di Cloudflare collegato al worker con il
 * nome DB; le tabelle vengono create da sole al primo uso.
 *
 * Impostazioni:
 *   DB             (associazione D1, obbligatoria) database degli inventari
 *   PASSWORD       (segreto, obbligatorio) password da dare a chi fa l'inventario:
 *                  senza password corretta non si legge e non si scrive nulla
 *   ORIGIN         (facoltativo) sito autorizzato a chiamare il servizio, es. https://hub.siciet.it
 *
 * Richieste (tutte con intestazione X-Password):
 *   GET    /ping                          verifica servizio e password
 *   GET    /inventari                     elenco degli inventari, con l'avanzamento
 *   POST   /inventari                     crea un inventario { tipo, commessa, deposito, data,
 *                                         note, report, righe (numero), operatore } → { id }
 *   POST   /inventari/<id>/report?parte=n carica una parte delle righe del report (JSON, vettore)
 *   POST   /inventari/<id>/pronto         tutte le parti sono state caricate
 *   GET    /inventari/<id>                dati dell'inventario
 *   GET    /inventari/<id>/report         tutte le righe del report
 *   GET    /inventari/<id>/conteggi?da=n  conteggi modificati dopo il momento n → { conteggi, ora, inventario }
 *   POST   /inventari/<id>/conteggi       salva uno o più conteggi { conteggi: [...] }
 *   POST   /inventari/<id>/precedente     { precedente } collega l'inventario a quello che continua
 *   POST   /inventari/<id>/stato          { stato: "aperto" | "chiuso", operatore }
 *   DELETE /inventari/<id>                elimina l'inventario e i suoi conteggi
 *   GET    /recuperati                    lista "Materiale recuperato" (articoli presenti in
 *                                         magazzino, resi dal cantiere e mai gestiti)
 *   POST   /recuperati                    { articoli: [{ codice, commessa, descrizione, um,
 *                                         quantita, nota }], operatore, inventario }: aggiunge,
 *                                         o aggiorna la quantità se codice e commessa ci sono già
 *   POST   /recuperati/<id>               modifica descrizione, um, quantita, nota
 *   DELETE /recuperati/<id>               toglie l'articolo dalla lista
 *
 * Un conteggio è { chiave, codice, commessa, descrizione, attesa, reale, nota, parti,
 * operatore, quando, extra }: reale = null vuol dire "conteggio annullato";
 * extra = articolo trovato in magazzino ma non presente nel report. Se due
 * dispositivi contano lo stesso articolo vale il conteggio più recente (quando).
 */

const MB = 1024 * 1024;
const MAX_RIGHE = 20000;       // righe di un report
const MAX_RIGHE_PARTE = 1000;  // righe per parte
const MAX_CONTEGGI = 2000;     // conteggi per richiesta

class Errore extends Error {
  constructor(status, msg){ super(msg); this.status = status; }
}

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "X-Password, Content-Type",
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

/* ---------- Controllo dei dati ricevuti ---------- */

function testo(v, max){
  if(v === undefined || v === null) return "";
  if(typeof v !== "string" && typeof v !== "number") throw new Errore(400, "Dati non validi.");
  v = String(v).replace(/[\u0000-\u001f]/g, " ").trim();
  if(v.length > (max || 300)) throw new Errore(400, "Testo troppo lungo.");
  return v;
}
function quantita(v, facoltativa){
  if((v === null || v === undefined) && facoltativa) return null;
  if(typeof v !== "number" || !isFinite(v) || Math.abs(v) > 1e12) throw new Errore(400, "Quantità non valida.");
  return v;
}
function giorno(v){
  v = testo(v, 10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + "T00:00:00Z"))) throw new Errore(400, "Data non valida.");
  return v;
}
function momento(v){
  v = testo(v, 40);
  const t = Date.parse(v);
  if(isNaN(t)) throw new Errore(400, "Data e ora non valide.");
  // Un telefono con l'orologio avanti non deve "vincere" sui conteggi successivi.
  return new Date(Math.min(t, Date.now() + 5 * 60000)).toISOString();
}
async function corpo(request, max){
  const t = await request.text();
  if(t.length > max) throw new Errore(413, "Richiesta troppo grande.");
  try{ return JSON.parse(t); }catch(_){ throw new Errore(400, "Dati non validi."); }
}
function rigaReport(r){
  if(!r || typeof r !== "object") throw new Errore(400, "Riga del report non valida.");
  const codice = testo(r.codice, 80).toUpperCase();
  if(!codice) throw new Errore(400, "Riga del report senza codice.");
  return { codice, descrizione: testo(r.descrizione, 400), commessa: testo(r.commessa, 40).toUpperCase(), attesa: quantita(r.attesa), valore: quantita(r.valore === undefined ? 0 : r.valore), um: testo(r.um, 12).toUpperCase(), dettaglio: testo(r.dettaglio, 1500), ucant: quantita(r.ucant, true), rcant: quantita(r.rcant, true) };
}
function conteggio(c){
  if(!c || typeof c !== "object") throw new Errore(400, "Conteggio non valido.");
  const codice = testo(c.codice, 80).toUpperCase(), commessa = testo(c.commessa, 40).toUpperCase();
  if(!codice) throw new Errore(400, "Conteggio senza codice.");
  return {
    chiave: codice + "|" + commessa, codice, commessa,
    descrizione: testo(c.descrizione, 400),
    attesa: quantita(c.attesa === undefined ? 0 : c.attesa),
    reale: quantita(c.reale, true),
    nota: testo(c.nota, 500),
    parti: testo(c.parti, 1500),
    origine: testo(c.origine, 60),
    operatore: testo(c.operatore, 100),
    quando: momento(c.quando),
    extra: c.extra ? 1 : 0
  };
}

/* ---------- Database ---------- */

let tabellePronte = false;
async function tabelle(db){
  if(tabellePronte) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS inventari (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, commessa TEXT NOT NULL DEFAULT '', deposito TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, stato TEXT NOT NULL DEFAULT 'aperto', pronto INTEGER NOT NULL DEFAULT 0, righe INTEGER NOT NULL DEFAULT 0, report TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '', creato_da TEXT NOT NULL DEFAULT '', creato_il TEXT NOT NULL, chiuso_da TEXT NOT NULL DEFAULT '', chiuso_il TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE TABLE IF NOT EXISTS report_parti (inventario TEXT NOT NULL, parte INTEGER NOT NULL, righe TEXT NOT NULL, PRIMARY KEY (inventario, parte))"),
    db.prepare("CREATE TABLE IF NOT EXISTS conteggi (inventario TEXT NOT NULL, chiave TEXT NOT NULL, codice TEXT NOT NULL, commessa TEXT NOT NULL DEFAULT '', descrizione TEXT NOT NULL DEFAULT '', attesa REAL NOT NULL DEFAULT 0, reale REAL, nota TEXT NOT NULL DEFAULT '', operatore TEXT NOT NULL DEFAULT '', quando TEXT NOT NULL, extra INTEGER NOT NULL DEFAULT 0, agg INTEGER NOT NULL, PRIMARY KEY (inventario, chiave))"),
    db.prepare("CREATE INDEX IF NOT EXISTS conteggi_agg ON conteggi (inventario, agg)")
  ]);
  // Colonna aggiunta dopo la prima versione: nei database già esistenti va creata.
  const colonne = await db.prepare("PRAGMA table_info(conteggi)").all();
  if(!colonne.results.some(c => c.name === "parti")) await db.prepare("ALTER TABLE conteggi ADD COLUMN parti TEXT NOT NULL DEFAULT ''").run();
  // Inventari collegati: "origine" è l'inventario da cui un conteggio è stato ereditato,
  // "precedente" l'inventario che un altro continua.
  if(!colonne.results.some(c => c.name === "origine")) await db.prepare("ALTER TABLE conteggi ADD COLUMN origine TEXT NOT NULL DEFAULT ''").run();
  const colInv = await db.prepare("PRAGMA table_info(inventari)").all();
  if(!colInv.results.some(c => c.name === "precedente")) await db.prepare("ALTER TABLE inventari ADD COLUMN precedente TEXT NOT NULL DEFAULT ''").run();
  // Lista "Materiale recuperato": articoli presenti in magazzino ma resi dal cantiere e mai
  // gestiti; non appartiene a un inventario e resta nel tempo.
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS recuperati (id TEXT PRIMARY KEY, codice TEXT NOT NULL, commessa TEXT NOT NULL DEFAULT '', descrizione TEXT NOT NULL DEFAULT '', um TEXT NOT NULL DEFAULT '', quantita REAL NOT NULL DEFAULT 0, nota TEXT NOT NULL DEFAULT '', inventario TEXT NOT NULL DEFAULT '', creato_da TEXT NOT NULL DEFAULT '', creato_il TEXT NOT NULL, aggiornato_da TEXT NOT NULL DEFAULT '', aggiornato_il TEXT NOT NULL)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS recuperati_codice ON recuperati (codice, commessa)")
  ]);
  tabellePronte = true;
}

const CAMPI_REC = "id, codice, commessa, descrizione, um, quantita, nota, inventario, creato_da, creato_il, aggiornato_da, aggiornato_il";
function recuperato(r){
  return { id: r.id, codice: r.codice, commessa: r.commessa, descrizione: r.descrizione, um: r.um, quantita: r.quantita, nota: r.nota, inventario: r.inventario,
    creatoDa: r.creato_da, creatoIl: r.creato_il, aggiornatoDa: r.aggiornato_da, aggiornatoIl: r.aggiornato_il };
}
async function recuperati(request, db, env, p, m){
  if(p.length === 1 && m === "GET"){
    const r = await db.prepare("SELECT " + CAMPI_REC + " FROM recuperati ORDER BY aggiornato_il DESC LIMIT 2000").all();
    return json(env, 200, { recuperati: r.results.map(recuperato) });
  }
  const ora = new Date().toISOString();
  if(p.length === 1 && m === "POST"){
    // Aggiunge articoli (anche da un inventario); se codice e commessa ci sono già, aggiorna la quantità.
    const d = await corpo(request, 400000);
    if(!d || !Array.isArray(d.articoli) || !d.articoli.length || d.articoli.length > 500) throw new Errore(400, "Articoli non validi.");
    const operatore = testo(d.operatore, 100), inventario = testo(d.inventario, 60);
    const lista = d.articoli.map(a => {
      if(!a || typeof a !== "object") throw new Errore(400, "Articolo non valido.");
      const codice = testo(a.codice, 80).toUpperCase();
      if(!codice) throw new Errore(400, "Articolo senza codice.");
      return { codice, commessa: testo(a.commessa, 40).toUpperCase(), descrizione: testo(a.descrizione, 400), um: testo(a.um, 12).toUpperCase(), quantita: quantita(a.quantita), nota: testo(a.nota, 500) };
    });
    await db.batch(lista.map(a => db.prepare(
      "INSERT INTO recuperati (id, codice, commessa, descrizione, um, quantita, nota, inventario, creato_da, creato_il, aggiornato_da, aggiornato_il) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?9, ?10) " +
      "ON CONFLICT (codice, commessa) DO UPDATE SET quantita = excluded.quantita, descrizione = CASE WHEN excluded.descrizione <> '' THEN excluded.descrizione ELSE recuperati.descrizione END, " +
      "um = CASE WHEN excluded.um <> '' THEN excluded.um ELSE recuperati.um END, nota = CASE WHEN excluded.nota <> '' THEN excluded.nota ELSE recuperati.nota END, " +
      "inventario = excluded.inventario, aggiornato_da = excluded.aggiornato_da, aggiornato_il = excluded.aggiornato_il"
    ).bind(crypto.randomUUID(), a.codice, a.commessa, a.descrizione, a.um, a.quantita, a.nota, inventario, operatore, ora)));
    return json(env, 200, { ok: true, salvati: lista.length });
  }
  const id = p[1];
  if(!/^[0-9a-f-]{36}$/.test(id || "")) throw new Errore(404, "Articolo non trovato.");
  if(p.length === 2 && m === "POST"){
    const d = await corpo(request, 5000);
    const r = await db.prepare("SELECT " + CAMPI_REC + " FROM recuperati WHERE id = ?1").bind(id).first();
    if(!r) throw new Errore(404, "Articolo non trovato: forse è stato eliminato.");
    await db.prepare("UPDATE recuperati SET descrizione = ?2, um = ?3, quantita = ?4, nota = ?5, aggiornato_da = ?6, aggiornato_il = ?7 WHERE id = ?1")
      .bind(id, d.descrizione === undefined ? r.descrizione : testo(d.descrizione, 400), d.um === undefined ? r.um : testo(d.um, 12).toUpperCase(),
        d.quantita === undefined ? r.quantita : quantita(d.quantita), d.nota === undefined ? r.nota : testo(d.nota, 500), testo(d.operatore, 100), ora).run();
    const n = await db.prepare("SELECT " + CAMPI_REC + " FROM recuperati WHERE id = ?1").bind(id).first();
    return json(env, 200, { recuperato: recuperato(n) });
  }
  if(p.length === 2 && m === "DELETE"){
    await db.prepare("DELETE FROM recuperati WHERE id = ?1").bind(id).run();
    return json(env, 200, { ok: true });
  }
  throw new Errore(404, "Richiesta sconosciuta.");
}

const CAMPI = "id, tipo, commessa, deposito, data, stato, righe, report, note, creato_da, creato_il, chiuso_da, chiuso_il, precedente";
function inventario(r){
  let report = {};
  try{ report = JSON.parse(r.report || "{}"); }catch(_){}
  const o = {
    id: r.id, tipo: r.tipo, commessa: r.commessa, deposito: r.deposito, data: r.data, stato: r.stato, righe: r.righe,
    report, note: r.note, creatoDa: r.creato_da, creatoIl: r.creato_il, chiusoDa: r.chiuso_da, chiusoIl: r.chiuso_il, precedente: r.precedente || ""
  };
  if(r.contati !== undefined){ o.contati = r.contati; o.differenze = r.differenze; o.extra = r.extra; }
  return o;
}
async function leggi(db, id, ancheIncompleto){
  if(!/^[a-z0-9-]{8,40}$/.test(id)) throw new Errore(404, "Inventario non trovato.");
  const r = await db.prepare("SELECT " + CAMPI + ", pronto FROM inventari WHERE id = ?1").bind(id).first();
  if(!r || (!r.pronto && !ancheIncompleto)) throw new Errore(404, "Inventario non trovato: forse è stato eliminato.");
  return r;
}

/* ---------- Richieste ---------- */

async function handle(request, env){
  if(request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  try{
    if(!env.DB || !env.PASSWORD) throw new Errore(500, "Servizio non configurato: mancano il database (DB) o la password (PASSWORD).");
    if(!uguale(request.headers.get("X-Password"), env.PASSWORD)) throw new Errore(401, "Password non corretta.");
    const url = new URL(request.url), db = env.DB, m = request.method;
    const p = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if(p[0] === "api") p.shift();
    await tabelle(db);

    if(p[0] === "ping" && m === "GET") return json(env, 200, { ok: true });
    if(p[0] === "recuperati") return await recuperati(request, db, env, p, m);
    if(p[0] !== "inventari") throw new Errore(404, "Richiesta sconosciuta.");

    if(p.length === 1 && m === "GET"){
      const r = await db.prepare(
        "SELECT " + CAMPI + ", " +
        "(SELECT COUNT(*) FROM conteggi c WHERE c.inventario = i.id AND c.reale IS NOT NULL) AS contati, " +
        "(SELECT COUNT(*) FROM conteggi c WHERE c.inventario = i.id AND c.reale IS NOT NULL AND ABS(c.reale - c.attesa) > 0.0000001) AS differenze, " +
        "(SELECT COUNT(*) FROM conteggi c WHERE c.inventario = i.id AND c.reale IS NOT NULL AND c.extra = 1) AS extra " +
        "FROM inventari i WHERE pronto = 1 ORDER BY data DESC, creato_il DESC LIMIT 100").all();
      return json(env, 200, { inventari: r.results.map(inventario) });
    }

    if(p.length === 1 && m === "POST"){
      const d = await corpo(request, 20000);
      const tipo = d.tipo === "commessa" ? "commessa" : "generale";
      const commessa = testo(d.commessa, 40).toUpperCase();
      if(tipo === "commessa" && !commessa) throw new Errore(400, "Per l'inventario di commessa va indicata la commessa.");
      const righe = Number(d.righe);
      if(!Number.isInteger(righe) || righe < 1 || righe > MAX_RIGHE) throw new Errore(400, "Il report deve avere tra 1 e " + MAX_RIGHE + " righe.");
      const rep = d.report || {};
      const report = { nome: testo(rep.nome, 200), stampatoIl: testo(rep.stampatoIl, 10), finoAl: testo(rep.finoAl, 10), commessa: testo(rep.commessa, 40), deposito: testo(rep.deposito, 80) };
      const id = giorno(d.data).replace(/-/g, "") + "-" + crypto.randomUUID().slice(0, 13);
      await db.prepare("INSERT INTO inventari (id, tipo, commessa, deposito, data, righe, report, note, creato_da, creato_il) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(id, tipo, tipo === "commessa" ? commessa : "", testo(d.deposito, 80).toUpperCase(), giorno(d.data), righe, JSON.stringify(report), testo(d.note, 500), testo(d.operatore, 100), new Date().toISOString()).run();
      return json(env, 200, { id });
    }

    const id = p[1], azione = p[2] || "";

    if(azione === "report" && m === "POST"){
      const inv = await leggi(db, id, true);
      if(inv.pronto) throw new Errore(409, "Il report di questo inventario è già stato caricato.");
      const parte = Number(url.searchParams.get("parte"));
      if(!Number.isInteger(parte) || parte < 0 || parte > MAX_RIGHE / 50) throw new Errore(400, "Parte non valida.");
      const d = await corpo(request, 1.5 * MB);
      if(!Array.isArray(d) || !d.length || d.length > MAX_RIGHE_PARTE) throw new Errore(400, "Righe del report non valide.");
      await db.prepare("INSERT OR REPLACE INTO report_parti (inventario, parte, righe) VALUES (?1, ?2, ?3)").bind(id, parte, JSON.stringify(d.map(rigaReport))).run();
      return json(env, 200, { ok: true });
    }

    if(azione === "pronto" && m === "POST"){
      const inv = await leggi(db, id, true);
      const parti = await db.prepare("SELECT righe FROM report_parti WHERE inventario = ?1").bind(id).all();
      const n = parti.results.reduce((s, x) => s + JSON.parse(x.righe).length, 0);
      if(n !== inv.righe) throw new Errore(409, "Il report non è stato caricato per intero (" + n + " righe su " + inv.righe + "): riprova.");
      await db.prepare("UPDATE inventari SET pronto = 1 WHERE id = ?1").bind(id).run();
      return json(env, 200, { ok: true });
    }

    if(!azione && m === "GET") return json(env, 200, { inventario: inventario(await leggi(db, id)) });

    if(azione === "report" && m === "GET"){
      await leggi(db, id);
      const parti = await db.prepare("SELECT righe FROM report_parti WHERE inventario = ?1 ORDER BY parte").bind(id).all();
      // Le parti sono già JSON: si uniscono senza rileggerle.
      const testoRighe = "[" + parti.results.map(x => x.righe.slice(1, -1)).filter(Boolean).join(",") + "]";
      return new Response('{"righe":' + testoRighe + "}", { status: 200, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, cors(env)) });
    }

    if(azione === "conteggi" && m === "GET"){
      const inv = await leggi(db, id);
      const da = Number(url.searchParams.get("da")) || 0, ora = Date.now();
      const r = await db.prepare("SELECT chiave, codice, commessa, descrizione, attesa, reale, nota, parti, origine, operatore, quando, extra, agg FROM conteggi WHERE inventario = ?1 AND agg >= ?2 ORDER BY agg").bind(id, da).all();
      return json(env, 200, { conteggi: r.results.map(c => Object.assign(c, { extra: !!c.extra })), ora, inventario: inventario(inv) });
    }

    if(azione === "conteggi" && m === "POST"){
      const inv = await leggi(db, id);
      if(inv.stato !== "aperto") throw new Errore(409, "L'inventario è chiuso: non si possono più salvare conteggi.");
      const d = await corpo(request, 1.5 * MB);
      if(!d || !Array.isArray(d.conteggi) || !d.conteggi.length || d.conteggi.length > MAX_CONTEGGI) throw new Errore(400, "Conteggi non validi.");
      const lista = d.conteggi.map(conteggio);
      // Un'unica istruzione per tutti i conteggi; tra due conteggi dello stesso articolo vale il più recente.
      await db.prepare(
        "INSERT INTO conteggi (inventario, chiave, codice, commessa, descrizione, attesa, reale, nota, parti, origine, operatore, quando, extra, agg) " +
        "SELECT ?1, json_extract(value, '$.chiave'), json_extract(value, '$.codice'), json_extract(value, '$.commessa'), json_extract(value, '$.descrizione'), " +
        "json_extract(value, '$.attesa'), json_extract(value, '$.reale'), json_extract(value, '$.nota'), json_extract(value, '$.parti'), json_extract(value, '$.origine'), json_extract(value, '$.operatore'), json_extract(value, '$.quando'), json_extract(value, '$.extra'), ?3 " +
        "FROM json_each(?2) WHERE true " +
        "ON CONFLICT (inventario, chiave) DO UPDATE SET descrizione = excluded.descrizione, attesa = excluded.attesa, reale = excluded.reale, nota = excluded.nota, parti = excluded.parti, origine = excluded.origine, " +
        "operatore = excluded.operatore, quando = excluded.quando, extra = excluded.extra, agg = excluded.agg WHERE excluded.quando >= conteggi.quando"
      ).bind(id, JSON.stringify(lista), Date.now()).run();
      return json(env, 200, { ok: true, salvati: lista.length });
    }

    if(azione === "precedente" && m === "POST"){
      // Collega l'inventario a quello che continua (i conteggi si ereditano con POST /conteggi e "origine").
      await leggi(db, id);
      const d = await corpo(request, 2000);
      const prec = testo(d.precedente, 60);
      if(prec){
        if(prec === id) throw new Errore(400, "Un inventario non può continuare se stesso.");
        await leggi(db, prec);
      }
      await db.prepare("UPDATE inventari SET precedente = ?2 WHERE id = ?1").bind(id, prec).run();
      return json(env, 200, { inventario: inventario(await leggi(db, id)) });
    }

    if(azione === "stato" && m === "POST"){
      await leggi(db, id);
      const d = await corpo(request, 2000);
      if(d.stato !== "aperto" && d.stato !== "chiuso") throw new Errore(400, "Stato non valido.");
      const chiuso = d.stato === "chiuso";
      await db.prepare("UPDATE inventari SET stato = ?2, chiuso_da = ?3, chiuso_il = ?4 WHERE id = ?1").bind(id, d.stato, chiuso ? testo(d.operatore, 100) : "", chiuso ? new Date().toISOString() : "").run();
      return json(env, 200, { inventario: inventario(await leggi(db, id)) });
    }

    if(!azione && m === "DELETE"){
      await leggi(db, id, true);
      await db.batch([
        db.prepare("DELETE FROM conteggi WHERE inventario = ?1").bind(id),
        db.prepare("DELETE FROM report_parti WHERE inventario = ?1").bind(id),
        db.prepare("DELETE FROM inventari WHERE id = ?1").bind(id)
      ]);
      return json(env, 200, { ok: true });
    }

    throw new Errore(404, "Richiesta sconosciuta.");
  }catch(e){
    if(e instanceof Errore) return json(env, e.status, { error: e.message });
    return json(env, 500, { error: "Errore del servizio: " + (e && e.message || e) });
  }
}

export default { fetch: handle };
