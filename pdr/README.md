# SICIET PDR 125

Pagina per tenere aggiornati stato ed evidenze degli indicatori dell'**Audit di Fase 2 UNI/PdR 125:2022** (certificazione per la parità di genere), così da essere sempre pronti all'audit. Indirizzo: `https://hub.siciet.it/pdr/`. **Non compare nel portale** e non è indicizzata (`noindex`): si raggiunge solo conoscendo l'indirizzo.

## Contenuto

I **33 indicatori in 6 aree** del documento di lavoro dell'audit (testo, tipologia, modalità di misurazione, fonte, punti, fasce e FAQ Accredia/UNI di gennaio 2026) sono in [`indicatori.js`](indicatori.js). Si modificano solo se l'ente di certificazione manda una nuova versione del modulo.

- **Quadro**: punteggio complessivo stimato (aree pesate, sul totale dei punti applicabili; soglia in `PDR_CONFIG.soglia`, 60 da verificare con l'ente), stato per area e l'elenco di ciò che va sistemato prima dell'audit.
- **Indicatori**: per ognuno si indica se è soddisfatto (Sì / No / N/A / Da valutare), responsabile, data dell'evidenza più recente, prossima revisione, evidenze (testo), documenti collegati (link a SharePoint, cartelle, PDF) e, per i quantitativi, le rilevazioni per periodo. Segnala evidenze mancanti, senza data, **oltre l'ultimo anno / biennio** (periodo ricavato dal testo dell'indicatore) o con revisione scaduta.
- **Scheda per l'audit**: riepilogo stampabile / PDF di tutti gli indicatori con le evidenze, ed export CSV.
- **Azienda e dati**: ragione sociale, **fascia dimensionale** (1–4: decide quali indicatori si applicano; va impostata), data dell'audit, esporta/importa JSON.

Il punteggio è una stima per prepararsi, non il giudizio dell'ente.

## Dove stanno i dati

Come per SICIET Energia (`api` in `PDR_CONFIG`, all'inizio dello script di `index.html`):

1. **In locale** (`api` vuoto, stato attuale): i dati restano nel browser del dispositivo. Usare **Esporta** per le copie.
2. **Con servizio condiviso** (consigliato, per lavorare in più persone): Cloudflare Worker + database D1 protetto da password.
   1. D1 → crea database `siciet-pdr`.
   2. Workers → crea `siciet-pdr`, incolla [`api/worker.js`](api/worker.js), associazione D1 con nome `DB`, segreto `PASSWORD`, facoltativo `ORIGIN` = `https://hub.siciet.it`.
   3. In `index.html` imposta `api: "https://<indirizzo del worker>/api"`.

   Poi chi apre la pagina inserisce nome e password; ogni modifica è visibile subito sugli altri dispositivi.

I dati **non sono nel repository** (il sito è pubblico). Aumentare `VERSIONE` in `index.html` a ogni modifica.

## Limiti

- Con il servizio, la password è unica e condivisa. Senza servizio, l'accesso è solo l'indirizzo non pubblicizzato: non inserire dati sensibili (retribuzioni di singole persone) finché il servizio non è attivo.
- Il testo degli indicatori è quello del modulo ricevuto; allegati e documenti restano dove sono (qui solo i link).
