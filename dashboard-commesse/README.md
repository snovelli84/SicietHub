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
| Ordini da cliente | `Ordini da cliente.pdf` |
| Excel v6 (per il confronto, non ancora implementato) | `Andamento_commesse_per_capo_commessa*.xlsx` |

La data «aggiornato al» è presa da una data `gg_mm_aa` nel nome di un file di `input/`, altrimenti dalla data dei file.

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
