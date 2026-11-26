# Dashboard commesse SICIET

Pagina statica (nessun servizio esterno) che mostra l'andamento delle commesse. Si aggiorna con un comando.

```bash
pip install beautifulsoup4 lxml pdfplumber
python3 aggiorna.py
```

Poi si apre `dist/index.html` (anche con doppio clic o da cartella di rete). In alto compare «Dati aggiornati al …».

## File da sostituire in `input/`
| File | Nome |
|---|---|
| Prospetti Margine Economico (uno per capo commessa) | `Prospetto - <nome>.html` |
| Elenco Commesse per Tipologia (con Stato) | `Elenco Commesse per Tipologia.pdf` |
| Elenco con responsabile (opzionale) | `Lista commesse*.pdf` |
| Fatture emesse | `Fatture emesse.pdf` |
| Totali responsabili (controllo) | `Totali responsabili.html` |
| Ordini da cliente | `Ordini da cliente.pdf` |
| Excel v6 (per il confronto, non ancora implementato) | `Andamento_commesse_per_capo_commessa*.xlsx` |

La data «aggiornato al» è presa da una data `gg_mm_aa` nel nome di un file di `input/`, altrimenti dalla data dei file.

## Caricamento dati dal browser (scheda «Carica dati»)

Dalla pagina pubblicata (`hub.siciet.it/commesse/`, dopo la password) la scheda **Carica dati** permette di aggiornare i dati senza
usare Python: per ogni capo commessa il prospetto totale (HTML/XML), poi i PDF dell'elenco commesse, dell'elenco con responsabile, degli
ordini e delle fatture emesse. Si può caricare anche un solo file: gli altri restano come sono. Il programma legge i file nel browser,
mostra un confronto «prima / dopo» con i controlli di riconciliazione e, con **Pubblica per tutti**, manda il risultato **cifrato** al servizio.

Il motore che legge i file è `web/js/motore.js`: replica le regole di `pipeline/` ed è verificato contro la pipeline Python
(`npm install` poi `node tests/confronta_motore.mjs`: stessi risultati su tutte le commesse).

### Attivare il servizio di pubblicazione (una volta, in Cloudflare)
1. Cloudflare → *Workers e Pages* → **Crea** → *Worker* → incolla il contenuto di [`servizio/worker.js`](servizio/worker.js) → *Deploy*.
2. *Archiviazione e database* → **KV** → crea uno spazio dei nomi `commesse`; nel Worker → *Impostazioni → Associazioni* → **Aggiungi → Spazio dei nomi KV**, nome variabile **`DATI_COMMESSE`**.
3. Worker → *Impostazioni → Variabili e segreti*: **`PASSWORD_CARICO`** (tipo *Segreto*, la password per caricare dati) e, facoltativa, **`ORIGIN`** = `https://hub.siciet.it`.
4. Scrivi l'indirizzo del Worker (es. `https://commesse.xxx.workers.dev`) in `config/soglie.json`, voce **`api_url`**, rilancia `python3 aggiorna.py` e pubblica `commesse/`.

Finché `api_url` è vuoto la scheda funziona **in prova**: si caricano e si controllano i file e si vedono i risultati in quella sessione, ma non si pubblica.
La password della dashboard (lettura) e `PASSWORD_CARICO` (scrittura) sono diverse; i dati sul servizio sono cifrati con la prima, che il servizio non conosce.
Il servizio tiene anche la versione precedente (`GET /dati?v=precedente`).

## Numero di versione
In fondo a ogni pagina: `Versione maggiore.minore.build · generata il …`. La build aumenta a ogni `aggiorna.py`; maggiore e minore si cambiano in `config/versione.json`.
In fondo compare anche la fonte dei dati («caricamento del …» se arrivano dal servizio).

## Configurazione (`config/`)
- `soglie.json`: margine minimo/verde, soglia «da chiudere», ritardo di fatturazione, perimetro.
- `override.json`: per commessa, «dato da verificare» e note (es. S1469).

## Regole
Economia (SM, SL, SF) esclusa; padre + varianti accorpati per `codice[:5]`; aperta se almeno una riga non è Chiusa;
residuo = ordini − fatturato sugli ordini, vuoto e «da chiudere» se entro 5 €. I costi vengono dal Prospetto.

## Riconciliazione
`data/riconciliazione.txt` e la pagina «Qualità dati». I test (`python3 -m unittest discover -s tests`) falliscono se
i totali per capo non coincidono con le intestazioni dei prospetti.

**Riservatezza:** `input/`, `data/`, `dist/` sono in `.gitignore`. Non pubblicarli: questa repository è il sito `hub.siciet.it`.
