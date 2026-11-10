/*
 * SICIET INVENTRACK – apertura della pagina anche senza rete.
 * Si prende sempre la versione più recente dalla rete; solo se la rete manca
 * si usa l'ultima copia salvata (pagina, script e icone).
 * Le richieste al servizio degli inventari e alle librerie non passano di qui.
 */
const CACHE = "inventrack-1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request, url = new URL(r.url);
  if(r.method !== "GET") return;
  const nostra = url.origin === self.location.origin && url.pathname.startsWith(new URL("./", self.location).pathname);
  if(!nostra) return;
  e.respondWith(
    fetch(r).then(res => {
      if(res.ok){
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(r, copia)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(r).then(x => x || Response.error()))
  );
});
