/*
 * SICIET COMMESSE – SERVIZIO DI CARICAMENTO DATI
 * ----------------------------------------------
 * La pagina hub.siciet.it/commesse/ legge i file esportati da Mago4 direttamente nel browser e manda
 * a questo servizio SOLO il risultato, già CIFRATO nel browser con la password della dashboard
 * (AES-256-GCM): il servizio non conosce quella password e non può leggere i dati.
 *
 * È un Cloudflare Worker (piano gratuito): il file si incolla così com'è nell'editor di Cloudflare.
 *
 * Impostazioni:
 *   KV (binding)     DATI_COMMESSE   archivio chiave/valore dove si salvano i dati cifrati
 *   PASSWORD_CARICO  (segreto, obbligatorio) password per CARICARE dati: chi la conosce può
 *                    sostituire i dati pubblicati. Per leggere non serve.
 *   ORIGIN           (facoltativo) sito autorizzato, es. https://hub.siciet.it
 *
 * Richieste:
 *   GET  /ping                     verifica il servizio
 *   GET  /dati                     { meta, blob } ultimi dati cifrati (404 se non ce ne sono)
 *   GET  /dati?v=precedente        la versione precedente (per tornare indietro)
 *   PUT  /dati                     { meta:{caricato}, blob:{salt,iv,iter,dati,compresso} }, intestazione
 *                                  X-Password = PASSWORD_CARICO. La versione attuale diventa «precedente».
 */
const MAX_BYTE = 20 * 1024 * 1024;   // limite del corpo (KV ammette fino a 25 MB per valore)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = env.ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type, X-Password",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!env.DATI_COMMESSE) return json({ errore: "KV DATI_COMMESSE non collegato al servizio" }, 500);

    if (url.pathname === "/ping") return json({ ok: true, scrittura: !!env.PASSWORD_CARICO });

    if (url.pathname === "/dati" && req.method === "GET") {
      const chiave = url.searchParams.get("v") === "precedente" ? "precedente" : "corrente";
      const v = await env.DATI_COMMESSE.get(chiave);
      if (!v) return json({ vuoto: true }, 404);
      return new Response(v, { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/dati" && req.method === "PUT") {
      if (!env.PASSWORD_CARICO) return json({ errore: "PASSWORD_CARICO non impostata" }, 500);
      if (!uguali(req.headers.get("X-Password") || "", env.PASSWORD_CARICO)) {
        await new Promise((r) => setTimeout(r, 800));     // rallenta i tentativi a vuoto
        return json({ errore: "password non corretta" }, 401);
      }
      const lung = Number(req.headers.get("Content-Length") || 0);
      if (lung > MAX_BYTE) return json({ errore: "file troppo grande" }, 413);
      const testo = await req.text();
      if (testo.length > MAX_BYTE) return json({ errore: "file troppo grande" }, 413);
      let corpo;
      try { corpo = JSON.parse(testo); } catch { return json({ errore: "JSON non valido" }, 400); }
      const b = corpo && corpo.blob;
      if (!corpo.meta || !corpo.meta.caricato || !b || !b.salt || !b.iv || !b.iter || !b.dati)
        return json({ errore: "formato non valido" }, 400);
      const attuale = await env.DATI_COMMESSE.get("corrente");
      if (attuale) await env.DATI_COMMESSE.put("precedente", attuale);
      await env.DATI_COMMESSE.put("corrente", JSON.stringify({ meta: { caricato: String(corpo.meta.caricato) }, blob: b }));
      return json({ ok: true });
    }

    return json({ errore: "non trovato" }, 404);
  },
};

function uguali(a, b) {       // confronto a tempo costante
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
