/*
 * SICIET ENERGIA – SERVIZIO DI ARCHIVIO DEI DATI ENERGETICI
 * ---------------------------------------------------------
 * La pagina hub.siciet.it/energia manda a questo servizio i dati inseriti mese
 * per mese (elettricità, gas, carburanti, fotovoltaico, km dei mezzi, valori
 * della scheda di monitoraggio) e li rilegge da qualsiasi dispositivo, così
 * tutti vedono la dashboard aggiornata. Vedi energia/README.md.
 *
 * È un Cloudflare Worker: il file si incolla così com'è nell'editor di Cloudflare.
 * I dati stanno in un database D1 collegato al worker con il nome DB; la tabella
 * viene creata da sola al primo uso.
 *
 * Impostazioni:
 *   DB         (associazione D1, obbligatoria) database dei dati energetici
 *   PASSWORD   (segreto, obbligatorio) password da dare a chi inserisce o consulta i dati:
 *              senza password corretta non si legge e non si scrive nulla
 *   ORIGIN     (facoltativo) sito autorizzato a chiamare il servizio, es. https://hub.siciet.it
 *
 * Richieste (tutte con intestazione X-Password):
 *   GET   /ping            verifica servizio e password
 *   GET   /dati?da=n       voci modificate dopo il momento n (0 = tutte) → { voci, ora }
 *   POST  /dati            { voci: [{ tipo, chiave, dati }], operatore }: salva o aggiorna le
 *                          voci; dati = null elimina la voce
 *
 * Una voce è { tipo, chiave, dati, operatore, quando }. I tipi sono:
 *   mensile   riga di consumo di un vettore (chiave anno|mese|vettore)
 *   el, gas   dettaglio della bolletta (chiave anno|mese)
 *   fv        fotovoltaico del mese, impianto 20 kW (chiave anno|mese)
 *   fv30      produzione del mese dell'impianto 30 kW (chiave anno|mese)
 *   acqua     fattura dell'acqua (chiave: numero fattura)
 *   carbtx    transazioni delle carte carburante di un mese per fonte (chiave anno|mese|fonte)
 *   km        km del mese per benzina, gasolio ed elettrico (chiave anno|mese)
 *   scheda    valore dell'indicatore nella scheda di monitoraggio (chiave posizione|anno)
 *   base      dati fissi (siti, flotta, note…) caricati con l'importazione del file
 * Se due dispositivi salvano la stessa voce vale l'ultima arrivata.
 */

const MB = 1024 * 1024;
const TIPI = ["mensile", "el", "gas", "fv", "fv30", "acqua", "carbtx", "km", "scheda", "base"];
const MAX_VOCI = 600;       // voci per richiesta
const MAX_DATI = 1.5 * MB;  // dimensione di una voce

class Errore extends Error {
  constructor(status, msg){ super(msg); this.status = status; }
}

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function testo(v, max){
  if(v === undefined || v === null) return "";
  if(typeof v !== "string" && typeof v !== "number") throw new Errore(400, "Dati non validi.");
  v = String(v).replace(/[\u0000-\u001f]/g, " ").trim();
  if(v.length > (max || 300)) throw new Errore(400, "Testo troppo lungo.");
  return v;
}
async function corpo(request, max){
  const t = await request.text();
  if(t.length > max) throw new Errore(413, "Richiesta troppo grande.");
  try{ return JSON.parse(t); }catch(_){ throw new Errore(400, "Dati non validi."); }
}

let tabellePronte = false;
async function tabelle(db){
  if(tabellePronte) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS voci (tipo TEXT NOT NULL, chiave TEXT NOT NULL, dati TEXT NOT NULL, eliminata INTEGER NOT NULL DEFAULT 0, operatore TEXT NOT NULL DEFAULT '', quando TEXT NOT NULL, agg INTEGER NOT NULL, PRIMARY KEY (tipo, chiave))"),
    db.prepare("CREATE INDEX IF NOT EXISTS voci_agg ON voci (agg)")
  ]);
  tabellePronte = true;
}

function voce(v){
  if(!v || typeof v !== "object") throw new Errore(400, "Voce non valida.");
  if(TIPI.indexOf(v.tipo) < 0) throw new Errore(400, "Tipo di voce sconosciuto.");
  const chiave = testo(v.chiave, 200);
  if(!chiave) throw new Errore(400, "Voce senza chiave.");
  if(v.dati === null || v.dati === undefined) return { tipo: v.tipo, chiave, dati: "null", eliminata: 1 };
  if(typeof v.dati !== "object") throw new Errore(400, "Dati della voce non validi.");
  const dati = JSON.stringify(v.dati);
  if(dati.length > MAX_DATI) throw new Errore(413, "Voce troppo grande.");
  return { tipo: v.tipo, chiave, dati, eliminata: 0 };
}

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
    if(p[0] !== "dati") throw new Errore(404, "Richiesta sconosciuta.");

    if(m === "GET"){
      const da = Number(url.searchParams.get("da")) || 0, ora = Date.now();
      const r = await db.prepare("SELECT tipo, chiave, dati, eliminata, operatore, quando FROM voci WHERE agg >= ?1 ORDER BY agg").bind(da).all();
      // Con da = 0 le voci eliminate non servono: non ci sono voci locali da togliere.
      const voci = r.results.filter(x => da > 0 || !x.eliminata).map(x => ({
        tipo: x.tipo, chiave: x.chiave, dati: x.eliminata ? null : JSON.parse(x.dati), operatore: x.operatore, quando: x.quando
      }));
      return json(env, 200, { voci, ora });
    }

    if(m === "POST"){
      const d = await corpo(request, 8 * MB);
      if(!d || !Array.isArray(d.voci) || !d.voci.length || d.voci.length > MAX_VOCI) throw new Errore(400, "Voci non valide (da 1 a " + MAX_VOCI + " per richiesta).");
      const operatore = testo(d.operatore, 100), quando = new Date().toISOString(), agg = Date.now();
      const lista = d.voci.map(voce);
      await db.batch(lista.map(v =>
        db.prepare(
          "INSERT INTO voci (tipo, chiave, dati, eliminata, operatore, quando, agg) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
          "ON CONFLICT (tipo, chiave) DO UPDATE SET dati = excluded.dati, eliminata = excluded.eliminata, operatore = excluded.operatore, quando = excluded.quando, agg = excluded.agg"
        ).bind(v.tipo, v.chiave, v.dati, v.eliminata, operatore, quando, agg)
      ));
      return json(env, 200, { ok: true, salvate: lista.length, ora: agg });
    }

    throw new Errore(404, "Richiesta sconosciuta.");
  }catch(e){
    if(e instanceof Errore) return json(env, e.status, { error: e.message });
    return json(env, 500, { error: "Errore del servizio: " + (e && e.message || e) });
  }
}

export default { fetch: handle };
