# SICIET InvenTrack

**SICIET InvenTrack** è un progetto separato da SICIET HUB, pubblicato all'indirizzo `https://hub.siciet.it/inventrack/` (cartella [`inventrack/`](.) di questa repository). Non compare nel portale e non è indicizzato dai motori di ricerca. Si può aggiungere alla schermata Home del telefono come un'app, con il proprio logo.

Serve a fare l'**inventario del magazzino generale o del magazzino di una commessa**: si carica il report delle giacenze stampato dal gestionale, si contano gli articoli con il telefono (scrivendo il codice o fotografando la targhetta), e dal PC si scarica l'**Excel** con giacenze attese, giacenze reali e differenze, più il **file CSV** da importare nel gestionale per sistemare le discordanze.

## Uso

1. **Accesso** – Al primo uso si scrivono **nome e cognome** (finiscono accanto a ogni quantità contata) e la **password**. Restano memorizzati sul dispositivo (**Cambia** in alto).
2. **Nuovo inventario** (di solito dal PC):
   - si sceglie **Magazzino generale** oppure **Magazzino di commessa**; per la commessa va scritta la **commessa** (es. `S1852`);
   - **data dell'inventario**: è proposta quella di oggi;
   - si carica il **report del gestionale** *Analisi Andamento Giacenza* (il PDF così come lo stampa il gestionale; in alternativa lo stesso report in Excel `.xlsx` o CSV, con le colonne Articolo, Descrizione, Commessa, Saldo). La pagina legge codice, descrizione, commessa e giacenza (colonna **Saldo**), e ricava il valore unitario da *Totale riga / Saldo*;
   - compare il riepilogo (numero di articoli, valore, deposito, commesse, data di stampa) con gli eventuali avvisi: report stampato in un giorno diverso dalla data dell'inventario, righe di altre commesse (che in un inventario di commessa non vengono importate; valgono anche le varianti, es. `S1852V31` per `S1852`), commessa non presente nel report.
3. **Conta** (dal telefono, aprendo lo stesso inventario dall'elenco):
   - si scrive il **codice** (o parte del codice, o parole della descrizione) e si tocca l'articolo; con un lettore di codici a barre basta leggere il codice, che finisce con Invio;
   - oppure **📷**: si fotografa la targhetta e la pagina propone gli articoli del report che corrispondono al testo letto (vedi *Codice dalla foto*);
   - compare la **giacenza attesa**: **✅ Confermo** se è giusta, altrimenti si scrive la **giacenza reale** e **Salva** (sotto il campo si vede subito la differenza). Un articolo che non c'è va salvato con quantità **0**. Si può aggiungere una nota;
   - un codice che non è nel report si può aggiungere come **articolo trovato in magazzino** (basta la quantità; la descrizione è facoltativa): nell'Excel risulta "Non presente nel report";
   - un articolo già contato si può riaprire per correggerlo o per **annullare il conteggio**;
   - **commesse collegate**: una variante come `S1852V12` è collegata alla commessa `S1852` (e viceversa, e le varianti tra loro). Se aggiungi come nuovo un codice che manca nell'inventario che stai facendo, ma è nel report dell'inventario **dello stesso giorno** di una commessa collegata, compare un avviso rosso che lo segnala ("probabilmente va contato là") con il pulsante per aprire quell'altro inventario. Si può comunque aggiungere il codice, se si è sicuri.
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

### I file che si scaricano

**Excel** (`Inventario S1852 SEDE 2026-11-10.xlsx`), tre fogli:

- **Inventario**: una riga per articolo con codice, descrizione, commessa, giacenza attesa, giacenza reale, differenza, valore unitario, valore della differenza, esito (*Confermata*, *Differenza*, *Non contato*, *Non presente nel report*), chi ha contato, quando, note. Filtri già attivi sulla riga dei titoli; differenze evidenziate.
- **Differenze**: le sole righe con una differenza.
- **Riepilogo**: totali e valore delle differenze.

**CSV per il gestionale**, nel formato del file di esempio (`"CODICE" ; quantità; valore unitario`, 15 decimali, punto decimale, una riga per articolo):

```
"ABBAF16301011" ; 1.000000000000000; 21.805000000000000
```

Si sceglie cosa esportare: **differenze in più** (da caricare), **differenze in meno** (da scaricare) — in due file separati, con quantità sempre positive — oppure le **giacenze reali** di tutti gli articoli contati. Gli articoli non contati non entrano nei file, a meno di spuntare *Considera gli articoli non contati come giacenza 0*. Il numero di decimali si cambia con `csvDecimali` in [`inventrack.js`](inventrack.js).

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

Quando si modifica `api/worker.js` va ricopiato su Cloudflare allo stesso modo.

## Limiti

- La password è unica e condivisa: chi la conosce vede gli inventari (con i valori di magazzino) e può modificarli. Va cambiata su Cloudflare se esce dall'azienda.
- I dati stanno nel database D1 di Cloudflare, non in Microsoft 365: l'archivio "ufficiale" di un inventario è l'Excel scaricato, da conservare nella cartella della commessa. Gli inventari vecchi si possono eliminare dalla pagina; l'elenco mostra gli ultimi 100.
- Piano gratuito di Cloudflare: 100.000 scritture al giorno sul database, ampiamente sufficienti (un conteggio = una scrittura).
- Il report viene letto in base alla posizione delle colonne del PDF *Analisi Andamento Giacenza* (Articolo, Descrizione, Commessa, Saldo, Totale riga): se il gestionale cambia l'impaginazione va aggiornato [`report.js`](report.js). Dopo ogni caricamento conviene controllare nel riepilogo numero di articoli e valore totale, che devono coincidere con quelli del report.
- Se nel report lo stesso articolo compare più volte per la stessa commessa le quantità vengono sommate (la pagina lo segnala).
- La lettura dalla foto sbaglia con scritte poco contrastate, riflessi o targhette storte: il codice proposto va sempre controllato.
- Le librerie (pdf.js per leggere il PDF, ExcelJS per l'Excel, Tesseract.js per le foto) sono caricate da `cdn.jsdelivr.net`, che deve essere raggiungibile.

**Aggiornamenti** – A ogni modifica di `inventrack.js` o `report.js` aumentare il numero in `?v=…` in fondo a `index.html` e la `versione` in `INVENTRACK_CONFIG` (all'inizio di `inventrack.js`): la versione compare in fondo a ogni pagina ("SICIET InvenTrack · versione 1.4") e serve a controllare che un telefono abbia caricato la pagina aggiornata.

**Logo e icone** – In [`icons/`](icons/): marchio SICIET con la scritta INVENTRACK (font Orbitron, gradiente blu → verde come in SICIET HUB e SICIET Quality). `logo.png` è usato nell'intestazione, le altre sono le icone per la schermata Home e il browser.
