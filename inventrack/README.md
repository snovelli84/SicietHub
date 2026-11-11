# SICIET InvenTrack

**SICIET InvenTrack** è un progetto separato da SICIET HUB, pubblicato all'indirizzo `https://hub.siciet.it/inventrack/` (cartella [`inventrack/`](.) di questa repository). Non compare nel portale e non è indicizzato dai motori di ricerca. Si può aggiungere alla schermata Home del telefono come un'app, con il proprio logo.

Serve a fare l'**inventario del magazzino aziendale o del magazzino di una commessa**: si carica il report delle giacenze stampato dal gestionale, si contano gli articoli con il telefono (scrivendo il codice o fotografando la targhetta), e dal PC si scarica l'**Excel** con giacenze attese, giacenze reali e differenze, più il **file CSV** da importare nel gestionale per sistemare le discordanze.

## Uso

1. **Accesso** – Al primo uso si scrivono **nome e cognome** (finiscono accanto a ogni quantità contata) e la **password**. Restano memorizzati sul dispositivo (**Cambia** in alto).
2. **Nuovo inventario** (di solito dal PC):
   - si sceglie **Magazzino aziendale** oppure **Magazzino di commessa**; per la commessa va scritta la **commessa** (es. `S1852`);
   - **data dell'inventario**: è proposta quella di oggi;
   - si carica il **report del gestionale**, il PDF così come lo stampa il gestionale (in alternativa lo stesso report in Excel `.xlsx` o CSV). La pagina riconosce da sola quale dei due report è:
     - **Analisi Andamento Giacenza** (per commessa): legge codice, descrizione, commessa e giacenza (colonna **Saldo**); il valore unitario è *Totale riga / Saldo*;
     - **Valorizzazione a costi** (magazzino aziendale, senza commessa): legge codice, descrizione, unità di misura (PCE, LM, NR…) e **Giacenza alla data**; il valore unitario è *Valore alla data / Giacenza alla data*. La giacenza è quella del giorno indicato nel report ("Valorizzazione in data …"), e il report estrae solo gli articoli con giacenza maggiore di 0: un articolo che in magazzino c'è ma non è nel report va aggiunto come nuovo codice;
   - compare il riepilogo (numero di articoli, valore, deposito, commesse, data di stampa) con gli eventuali avvisi: report stampato in un giorno diverso dalla data dell'inventario, righe di altre commesse (che in un inventario di commessa non vengono importate; valgono anche le varianti, es. `S1852V31` per `S1852`), commessa non presente nel report.
3. **Conta** (dal telefono, aprendo lo stesso inventario dall'elenco):
   - si scrive il **codice** (o parte del codice, o parole della descrizione) e si tocca l'articolo; con un lettore di codici a barre basta leggere il codice, che finisce con Invio;
   - oppure **📷**: si fotografa la targhetta e la pagina propone gli articoli del report che corrispondono al testo letto (vedi *Codice dalla foto*);
   - compare la **giacenza attesa**: **✅ Confermo** se è giusta, altrimenti si scrive la **giacenza reale** e **Salva** (sotto il campo si vede subito la differenza). Un articolo che non c'è va salvato con quantità **0**. Si può aggiungere una nota;
   - un codice che non è nel report si può aggiungere come **articolo trovato in magazzino** (basta la quantità; la descrizione è facoltativa): nell'Excel risulta "Non presente nel report";
   - un articolo già contato si può riaprire per correggerlo o per **annullare il conteggio**;
   - **commesse collegate**: una commessa è collegata a tutte quelle il cui codice **inizia con il suo** (`S1852` con `S1852V12` e `S1852V31`, e viceversa); due varianti tra loro non lo sono. Se aggiungi come nuovo un codice che manca nell'inventario che stai facendo, ma è nel report dell'inventario **dello stesso giorno** di una commessa collegata, compare un avviso rosso che lo segnala ("probabilmente va contato là") con il pulsante per aprire quell'altro inventario. Si può comunque aggiungere il codice, se si è sicuri.
4. **Elenco** – Tutti gli articoli con i filtri *Da contare*, *Confermati*, *Differenze* e la ricerca: serve a vedere cosa manca.
5. **Esporta** (dal PC) – Riepilogo, **Scarica Excel**, **Scarica CSV** per il gestionale, **Chiudi l'inventario**.
6. **Eliminare un inventario** – Dall'elenco degli inventari (**🗑 Elimina inventario**, sotto ogni inventario) oppure dalla scheda *Esporta*. Serve scrivere ELIMINA per confermare; l'inventario e tutte le quantità contate vengono cancellati da ogni dispositivo e non si possono recuperare (conviene aver scaricato prima l'Excel).

Più persone possono contare insieme lo stesso inventario da telefoni diversi: ogni dispositivo riceve i conteggi degli altri ogni 20 secondi. Se due persone contano lo stesso articolo vale il conteggio più recente.

**Senza rete** – In magazzino si continua a contare anche se manca la connessione: i conteggi restano sul telefono ("⏳ in attesa di invio") e partono da soli appena torna. La pagina già aperta una volta si riapre anche senza rete. Prima di scaricare l'Excel conviene controllare che su ogni telefono compaia "✓ Tutti i conteggi sono salvati".

### La data dell'inventario

Un inventario vale **solo per il giorno in cui viene fatto**: le giacenze attese sono quelle del report di quel giorno.

- Alla creazione la pagina avvisa se il report è stato stampato in un giorno diverso dalla data dell'inventario.
- Aprendo un inventario in un giorno diverso dalla sua data, il conteggio è **bloccato**: la pagina propone di creare un nuovo inventario con il report di oggi. Con **Continua comunque questo** si può proseguire (per esempio per un giro finito il giorno dopo): quei conteggi nell'Excel sono segnalati con "(non nella data dell'inventario)" e contati nel foglio Riepilogo.
- Data, ora e autore di ogni conteggio sono nell'Excel.
- A giro finito **Chiudi l'inventario**: da quel momento nessun dispositivo può più modificare le quantità (si può riaprire). Excel e CSV si possono sempre scaricare.

### Commessa e varianti: la giacenza attesa

Il materiale comprato per una commessa (es. `S1852`) viene spesso scaricato su una sua variante (`S1852V04`) per la quale non era mai stato caricato: nel gestionale la commessa resta con una giacenza più alta del vero e la variante va in negativo.

**La regola**: la giacenza di magazzino è la **somma delle sole quantità positive** della commessa e di tutte le commesse il cui codice inizia con il suo (le varianti). Le varianti in negativo **restano in negativo e non contano**; si corregge **solo la commessa padre**. Esempio, articolo `HIL2346062`: `S1852` 10.900, `S1852V06` 400, `S1852V12` 400, varianti in negativo −8.300 → giacenza attesa **11.700**; se in magazzino ce ne sono 3.400, la differenza (−8.300) è sulla padre.

In "Nuovo inventario" la spunta **Somma la commessa e le sue varianti** (già attiva quando il report contiene le varianti) fa questo calcolo. Togliendola, ogni variante resta una riga separata.

- **Il report va stampato comprendendo le varianti**: *Da Commessa* `S1852`, *A Commessa* `S1852ZZ` (con `S1852/` le varianti restano fuori). Se il report contiene solo la commessa, la pagina lo ricorda.
- **Due tipi di report** (*Analisi Andamento Giacenza*): riassunto (una riga per articolo e commessa) oppure con il **dettaglio dei movimenti** (una riga per movimento, con la causale): in quel caso vale il saldo dell'ultima riga di ogni commessa. Solo con il dettaglio dei movimenti si hanno i **rientri dal cantiere** (vedi sotto).
- **Controllo automatico**: con il report dei movimenti, per ogni articolo la pagina confronta la giacenza letta con la riga *TOTALE ARTICOLO* stampata dal report (entrate − uscite). Nel riepilogo compare "✓ N articoli coincidono con i totali del report", oppure quanti articoli non tornano. Ogni avviso del riepilogo (articoli che non coincidono, righe di altre commesse, righe ripetute) ha **Vedi l'elenco**, con tutti i codici e i numeri, e **Copia l'elenco**.
- **Causali dei movimenti**: ACQ-O acquisto, ACQ-C carico diretto in commessa, **I-CINST** installazione (uscita) in cantiere, **I-RCANT** rientro da cantiere. Il riepilogo del report elenca le causali trovate e avvisa se ce ne sono altre; si cambiano in `INVENTRACK_CONFIG.causali` (inizio di `inventrack.js`).
- Nella scheda dell'articolo *Giacenza per commessa* mostra la giacenza del gestionale commessa per commessa; lo stesso dettaglio è nell'ultima colonna dell'Excel.
- **Dividi per commessa**: al conteggio si può scrivere solo il totale, oppure aprire *Dividi per commessa* e scrivere quanto c'è per la commessa padre e per ogni variante (quelle dell'articolo sono già elencate, con la giacenza del gestionale; le altre si aggiungono dal menu). La giacenza reale è la somma; le commesse lasciate vuote valgono zero. La divisione è salvata con il conteggio, si vede dagli altri dispositivi ed è nell'Excel (*Giacenza reale per commessa*).

### Giacenza in più sulla padre: i movimenti da registrare

Quando la padre ha in magazzino più di quanto risulta dal gestionale, la pagina distingue le cause e prepara un file CSV per ciascuna, nel solito formato `"codice" ; quantità ; valore unitario` (quantità sempre positive; il tipo di movimento e la commessa sono nel nome del file e nella descrizione che compare in **Esporta**, scheda *Movimenti da registrare nel gestionale*; **Scarica tutti i file (ZIP)** li scarica insieme).

| Causa | Come la riconosce | File |
|---|---|---|
| **1. Rientro dal cantiere non registrato** (o articolo già gestito, recuperato dal cantiere) | Eccedenza sulla padre; il report mostra le uscite verso il cantiere (I-CINST) non ancora rientrate (I-RCANT). Nell'Excel la nota dice quanto è spiegato dalle uscite e quanto è *oltre* le uscite (articolo già gestito, tornato "come se fosse lo stesso") | **Rientro dal cantiere** (un solo CSV sulla padre) |
| **2. Avanzo di una variante portato sulla padre** | Una variante ha giacenza positiva nel gestionale, ma al conteggio (*Dividi per commessa*) ha meno o zero, e la padre ha di più | **Scarico avanzo variante `S1852Vxx`** (un CSV per ogni variante) e **Carico sulla padre degli avanzi delle varianti** (contropartita sulla padre) |
| **3. Articolo recuperato mai gestito** | Codice che non è nel report | Nessun movimento: va nella lista **Materiale recuperato** |

- Le **differenze in meno** della padre restano in un file *Differenza in meno - S1852* (movimento negativo); una variante contata meno del gestionale senza che la padre abbia di più (o in più) ha i suoi file *Differenza in meno / in più - S1852Vxx*. Le varianti in negativo non generano movimenti.
- Senza *Dividi per commessa* tutta la differenza è sulla padre (rientro se in più, differenza in meno se in meno).
- Con il report riassunto (senza causali) restano i due file semplici, *Movimento positivo* e *Movimento negativo*, che si trovano anche, in un riquadro chiuso, negli inventari di commessa.
- Il foglio **Movimenti** dell'Excel elenca tutte le righe di questi file, con giacenza attesa, reale e note, più gli articoli recuperati.

### Materiale recuperato

Lista promemoria degli articoli **presenti in magazzino, resi dal cantiere e mai gestiti da noi**: non genera movimenti e resta nel tempo, fuori dagli inventari. Si apre da **📋 Materiale recuperato** nella pagina iniziale.

- Si riempie dagli inventari di commessa (*Esporta* → **Materiale recuperato** → *Aggiungi alla lista*: gli articoli contati che non sono nel report) o a mano con il modulo (codice, quantità, descrizione, commessa, nota).
- Si aggiorna nel tempo: ✏️ **Modifica** per quantità, descrizione e nota (chi e quando ha aggiornato resta visibile), 🗑 **Togli dalla lista** quando l'articolo non c'è più o è diventato un articolo gestito. Se un inventario ricontrolla un articolo già in lista, la quantità si aggiorna al valore contato (non si duplica).
- La lista è la stessa per tutti i dispositivi (servizio) e ha la ricerca per codice, descrizione o nota.

### Magazzino aziendale: il giro di fine giornata

1. Dal gestionale si stampa il report **Valorizzazione a costi** (o *Analisi Andamento Giacenza*) **alla data dell'inventario** e lo si carica in **Nuovo inventario → Magazzino aziendale**. Se il report è alla data di un giorno diverso (es. giacenza al 31/10 per un inventario del 10/11) la pagina avvisa: i movimenti successivi non sono compresi e le differenze potrebbero non essere vere.
2. L'operatore conta articolo per articolo dal telefono (con l'unità di misura accanto alla giacenza attesa).
3. A fine giornata, da **Esporta**, si scarica **Movimento positivo** (articoli in più) e **Movimento negativo** (articoli in meno), uno per uno oppure con **Scarica entrambi**: sono i due file CSV da importare nel gestionale per creare i movimenti d'inventario. Gli articoli non contati non generano movimenti, a meno di spuntare *Considera gli articoli non contati come giacenza 0*.

Il **valore unitario** dei CSV è ricavato dal report: per il report di valorizzazione è *Valore alla data / Giacenza alla data*, e il report arrotonda il valore ai centesimi (per un articolo da 1 pezzo che costa 21,805 il report stampa 21,80, e nel CSV finisce 21.8). Per gli articoli trovati e non presenti nel report il valore unitario è 0.

### I file che si scaricano

**Excel** (`Inventario S1852 SEDE 2026-11-10.xlsx`, oppure `Inventario magazzino aziendale 2026-11-10.xlsx`), tre fogli:

- **Inventario**: una riga per articolo con codice, descrizione, commessa, unità di misura, giacenza attesa, giacenza reale, differenza, valore unitario, valore della differenza, esito (*Confermata*, *Differenza*, *Non contato*, *Non presente nel report*), chi ha contato, quando, note. Filtri già attivi sulla riga dei titoli; differenze evidenziate.
- **Differenze**: le sole righe con una differenza.
- **Riepilogo**: totali e valore delle differenze.

**CSV per il gestionale**, nel formato del file di esempio (`"CODICE" ; quantità; valore unitario`, 15 decimali, punto decimale, una riga per articolo):

```
"ABBAF16301011" ; 1.000000000000000; 21.805000000000000
```

Sono due file separati, **movimento positivo** (differenze in più) e **movimento negativo** (differenze in meno), con quantità sempre positive; in alternativa le **giacenze reali** di tutti gli articoli contati. Gli articoli non contati non entrano nei file, a meno di spuntare *Considera gli articoli non contati come giacenza 0*. Il numero di decimali si cambia con `csvDecimali` in [`inventrack.js`](inventrack.js).

### Codice dalla foto

Toccando 📷 si fotografa la targhetta. La pagina cerca prima codici a barre e QR (su Android/Chrome), poi legge il testo della foto direttamente sul telefono ([Tesseract.js](https://tesseract.projectnaptha.com)) e lo **confronta con i codici del report**: così basta una lettura imperfetta (es. `O` al posto di `0`, uno o due caratteri sbagliati) per proporre l'articolo giusto. Se la prima lettura non trova nulla si traccia col dito un riquadro attorno al solo codice e si tocca **Leggi il riquadro**. Il codice proposto va sempre controllato. La foto non viene salvata. La prima lettura scarica circa 10 MB (motore e dati), poi resta nella cache del browser.

## Come funziona il salvataggio

La pagina è statica: gli inventari li conserva il **servizio** in [`api/worker.js`](api/worker.js), un Cloudflare Worker (piano gratuito, stesso account di SICIET Quality e SICIET HR) con un database **D1** di Cloudflare. Per ogni inventario il database tiene le righe del report e un conteggio per articolo (quantità reale, nota, operatore, data e ora).

- Senza la **password** (`PASSWORD` del servizio) non si legge e non si scrive nulla, e la pagina non mostra gli inventari.
- Ogni telefono tiene una copia dell'inventario aperto e dei conteggi non ancora inviati (nel browser).

Finché `api` in `INVENTRACK_CONFIG` (all'inizio di [`inventrack.js`](inventrack.js)) è vuoto, la pagina funziona **in prova**: tutto resta solo sul dispositivo su cui si lavora (utile per provare, o per un inventario fatto e scaricato dallo stesso dispositivo), senza password.

## Attivazione (una volta)

1. **Cloudflare** → *Archiviazione e database* → **D1 SQL Database** → **Crea database** → nome `siciet-inventrack`. Le tabelle le crea il servizio al primo uso.
2. *Workers e Pages* → **Crea** → **Inizia con Hello World** → nome `siciet-inventrack` → **Distribuisci**.
   - **Modifica codice** → cancellare il codice di esempio, incollare il contenuto di [`api/worker.js`](api/worker.js) (su GitHub: *Raw*, seleziona tutto, copia) → **Distribuisci**;
   - *Associazioni* (Bindings) → **Aggiungi** → **Database D1** → nome variabile `DB`, database `siciet-inventrack`;
   - *Impostazioni → Variabili e segreti* → **Aggiungi**:
     | Nome | Tipo | Valore |
     |---|---|---|
     | `PASSWORD` | Segreto | la password da dare a chi fa l'inventario |
     | `ORIGIN` | Testo | `https://hub.siciet.it` |
   - annotare l'indirizzo del worker (es. `https://siciet-inventrack.<nome-account>.workers.dev`).
3. In `inventrack.js` impostare `api: "https://<indirizzo del worker>/api"` e aumentare `inventrack.js?v=` in `index.html`.

Verifica: aprire `hub.siciet.it/inventrack/`, inserire nome e password, creare un inventario di prova con un report e poi eliminarlo (scheda *Esporta* → **Elimina**). "Servizio non configurato" indica che manca l'associazione `DB` o la variabile `PASSWORD`.

Quando si modifica `api/worker.js` va ricopiato su Cloudflare allo stesso modo. Dalla versione 1.6 il servizio salva anche l'**unità di misura** degli articoli dalla 1.7 il **dettaglio per commessa** della somma con le varianti e dalla 1.8 la **divisione per commessa** della giacenza reale (il servizio aggiunge da solo la colonna che serve al database esistente): finché non si ricopia il nuovo `worker.js` tutto funziona, ma questi dati si vedono solo sul dispositivo su cui sono stati inseriti. Dalla 2.0 salva anche le **uscite verso il cantiere** di ogni articolo e ospita la lista **Materiale recuperato** (il servizio crea da solo la tabella che serve): senza il nuovo `worker.js` la lista non funziona e i rientri dal cantiere si calcolano solo sul dispositivo che ha creato l'inventario.

## Limiti

- La password è unica e condivisa: chi la conosce vede gli inventari (con i valori di magazzino) e può modificarli. Va cambiata su Cloudflare se esce dall'azienda.
- I dati stanno nel database D1 di Cloudflare, non in Microsoft 365: l'archivio "ufficiale" di un inventario è l'Excel scaricato, da conservare nella cartella della commessa. Gli inventari vecchi si possono eliminare dalla pagina; l'elenco mostra gli ultimi 100.
- Piano gratuito di Cloudflare: 100.000 scritture al giorno sul database, ampiamente sufficienti (un conteggio = una scrittura).
- I report PDF vengono letti in base alla posizione delle colonne (*Analisi Andamento Giacenza*: Articolo, Descrizione, Commessa, Saldo, Totale riga; *Valorizzazione a costi*: Articolo, Descrizione, Cat. merc., Un. mis., Giacenza alla data, Valore alla data): se il gestionale cambia l'impaginazione va aggiornato [`report.js`](report.js). Dopo ogni caricamento conviene controllare nel riepilogo numero di articoli e valore totale, che devono coincidere con quelli del report.
- Se nel report lo stesso articolo compare più volte per la stessa commessa le quantità vengono sommate (la pagina lo segnala).
- La lettura dalla foto sbaglia con scritte poco contrastate, riflessi o targhette storte: il codice proposto va sempre controllato.
- Le librerie (pdf.js per leggere il PDF, ExcelJS per l'Excel, Tesseract.js per le foto) sono caricate da `cdn.jsdelivr.net`, che deve essere raggiungibile.

**Aggiornamenti** – A ogni modifica di `inventrack.js` o `report.js` aumentare il numero in `?v=…` in fondo a `index.html` e la `versione` in `INVENTRACK_CONFIG` (all'inizio di `inventrack.js`): la versione compare in fondo a ogni pagina ("SICIET InvenTrack · versione 1.9") e serve a controllare che un telefono abbia caricato la pagina aggiornata.

**Logo e icone** – In [`icons/`](icons/): marchio SICIET con la scritta INVENTRACK (font Orbitron, gradiente blu → verde come in SICIET HUB e SICIET Quality). `logo.png` è usato nell'intestazione, le altre sono le icone per la schermata Home e il browser.
