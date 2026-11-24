# SICIET Energia

Dashboard dei consumi energetici aziendali (elettricità, gas, carburanti, fotovoltaico, flotta) con la scheda di monitoraggio degli indicatori **All. MGE**. È pubblicata all'indirizzo `https://hub.siciet.it/energia/`, non compare nel portale e non è indicizzata dai motori di ricerca.

## Uso

- **Panoramica, Elettricità, Gas, Carburanti, Fotovoltaico, Flotta**: grafici e indicatori, sempre calcolati sui dati inseriti. **Fotovoltaico** comprende la produzione, l'immissione e l'autoconsumo dell'impianto da 20 kW (scambio sul posto), la produzione e i ricavi dell'impianto da 30 kW (ritiro dedicato), lo storico annuo dal 2008, gli avvisi automatici quando un mese produce meno della metà dello stesso mese degli anni precedenti e la simulazione del nuovo impianto con accumulo.
- **Versione**: in fondo a ogni pagina compaiono la versione della pagina, l'archivio in uso (servizio condiviso o solo questo dispositivo) e l'ultimo mese con dati. Il numero (`VERSIONE` all'inizio dello script di `index.html`) va aumentato a ogni modifica.
- **Monitoraggio**: la scheda *All. MGE – Monitoraggio indicatori energetici* con i 4 indicatori (consumo benzina e gasolio in l/100 km, % di km fatti dall'auto elettrica, rendimento FV Prp > 0,8) per anno. Il **risultato** è il valore calcolato dai dati mensili, se ci sono; altrimenti il **valore della scheda**, che si può scrivere o correggere nella colonna omonima. **Stampa la scheda** produce la pagina da firmare.
- **＋ Inserisci mese**: un modulo per mese con elettricità (kWh, F1/F2/F3, potenza, cos φ, costi, fattura), gas, carburanti per tipo, fotovoltaico (produzione, immissione, autoconsumo, producibile, Prp) e km dei mezzi. Il mese proposto è quello appena concluso; sopra il modulo compaiono i mesi senza dati dell'anno, da toccare per aprirli. Se il mese ha già dei dati compaiono nei campi e si possono correggere; un riquadro svuotato del tutto elimina i dati del mese (con conferma).
  - Numeri all'italiana: `3.012` è tremiladodici, i decimali si scrivono con la virgola (`850,5`).
  - Se vuoti si calcolano da soli: i kWh dalla somma F1+F2+F3, l'autoconsumo FV (produzione − immissione), la copertura FV e il Prp (produzione / producibile). Se F1+F2+F3 non torna con il prelievo la pagina lo segnala.
  - Per il fotovoltaico c'è anche la produzione mensile dell'impianto da 30 kW.
  - I **km** servono per gli indicatori 1–3: il l/100 km di un mese si calcola solo se per quel mese sono stati inseriti i km e i litri.
- **Dati**: tabella di tutte le righe, con filtri ed **Esporta CSV**.

## Dove stanno i dati

I dati **non sono nel repository** (il sito è pubblico). Due modi di funzionare, secondo `ENERGIA_CONFIG.api` all'inizio dello script di `index.html`:

1. **Con il servizio di archivio** (`api` compilato): i dati stanno nel database D1 di Cloudflare, protetti da password. Chi apre la pagina inserisce nome e password; ogni inserimento è visibile subito sugli altri dispositivi (aggiornamento ogni 30 secondi, `secondi`). Se manca la rete le modifiche restano in coda sul dispositivo e partono da sole ("⏳ N modifiche da inviare").
2. **In locale** (`api` vuoto, com'è ora): i dati restano nella memoria del browser del dispositivo. **Esporta** scarica una copia (`siciet_dashboard_data.json`), **Importa file** la ricarica. Utile per provare; per lavorare in più persone serve il servizio.

**Primo caricamento** – Alla prima apertura la pagina chiede il file `siciet_dashboard_data.json` (generato dal progetto Claude "Analisi Energetica"; con la scheda di monitoraggio aggiunta come `monitoraggio`). Con il servizio attivo i dati vengono caricati sul database una volta sola; poi si lavora dal modulo. **Importa file** riesegue lo stesso caricamento: i mesi del file sostituiscono quelli già presenti con lo stesso mese.

## Attivare il servizio di archivio (Cloudflare)

Lo schema è quello di SICIET InvenTrack, sullo stesso account Cloudflare (piano gratuito).

1. **Cloudflare** → *Archiviazione e database* → **D1 SQL Database** → **Crea database** → nome `siciet-energia`. La tabella la crea il servizio al primo uso.
2. *Workers e Pages* → **Crea** → **Inizia con Hello World** → nome `siciet-energia` → **Distribuisci**.
   - **Modifica codice** → cancellare il codice di esempio, incollare il contenuto di [`api/worker.js`](api/worker.js) (su GitHub: *Raw*, seleziona tutto, copia) → **Distribuisci**;
   - *Associazioni* (Bindings) → **Aggiungi** → **Database D1** → nome variabile `DB`, database `siciet-energia`;
   - *Variabili e segreti* → **Aggiungi** → tipo **Segreto**, nome `PASSWORD`, valore la password da dare a chi inserisce o consulta i dati;
   - facoltativo: variabile `ORIGIN` = `https://hub.siciet.it`, così solo questo sito può chiamare il servizio;
   - annotare l'indirizzo del worker (es. `https://siciet-energia.<nome-account>.workers.dev`).
3. In `index.html` impostare `api: "https://<indirizzo del worker>/api"`.

Verifica: aprire `hub.siciet.it/energia/`, inserire nome e password, caricare il file dati e inserire/correggere un mese. "Servizio non configurato" indica che manca l'associazione `DB` o il segreto `PASSWORD`.

Quando si modifica `api/worker.js` va ricopiato su Cloudflare allo stesso modo (la versione 1.2 aggiunge il tipo di voce `fv30`: chi ha già attivato il servizio deve ricopiare il file).

## Limiti

- La password è unica e condivisa: chi la conosce vede e modifica tutti i dati. Va cambiata su Cloudflare se esce dall'azienda.
- I dati stanno nel database D1, non in Microsoft 365: conviene scaricare ogni tanto una copia con **Esporta**.
- La tabella **Flotta** (litri e km per targa) e le note dell'analisi vengono dal file iniziale e non si aggiornano dal modulo mensile; il l/100 km della scheda usa i km totali per tipo di vettura inseriti ogni mese.
- Acqua, ricariche elettriche, fatturato e dipendenti non sono tra i dati.
