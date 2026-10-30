# SICIET Quality

**SICIET Quality** è un progetto separato da SICIET HUB, pubblicato all'indirizzo `https://hub.siciet.it/quality/` (cartella [`quality/`](.) di questa repository; in futuro può avere un dominio suo, es. `quality.siciet.it`). Si può aggiungere alla schermata Home del telefono come un'app, con il proprio logo.

Per ogni componente di una commessa si crea una scheda identificata da **JOB** e **TAG**, con foto, note, stato e documenti, salvati in una cartella condivisa di OneDrive/SharePoint. Sul componente si attacca un'etichetta con un QR code che riapre la scheda.

**Uso in cantiere**

1. **Nuovo componente** – In cima **Commessa SICIET** e **JOB**: restano memorizzati sul telefono e vengono riproposti. Poi un unico modulo in quattro passi:
   1. **Foto della targhetta** → si riquadra il TAG col dito e il testo viene letto in automatico (OCR con [Tesseract.js](https://tesseract.projectnaptha.com), direttamente sul telefono). Se la lettura non riesce lo si scrive a mano (**Scrivo a mano**). La foto della targhetta viene comunque salvata (fase "Targhetta").
   2. **TAG**, da controllare sempre. Il JOB in cima viene ricordato.
   3. **Altri dati**, facoltativi: descrizione, fornitore, posizione, DDT, stato, note.
   4. **Foto del componente**: si sceglie la fase, si scattano una o più foto (o si prendono dalla galleria), si tolgono con × quelle venute male e si scrive una nota facoltativa.
   Con **Salva e inserisci il prossimo** la scheda viene salvata e il modulo si svuota, tenendo commessa e JOB: si passa subito al componente successivo. In alto compare l'elenco dei componenti inseriti, con il link a ciascuna scheda. **Salva e apri la scheda** salva e apre la scheda appena creata.
2. **Altre foto in seguito** – Nella scheda del componente, riquadro **Aggiungi foto**: stessa procedura, poi **Salva foto**. Le note delle foto compaiono nello storico della scheda e sotto ogni foto quando la si ingrandisce.
3. **Note e stato, documenti** – Note generali con cambio di stato (Da verificare / Conforme / Non conforme) e documenti (DDT, certificati, schede tecniche, verbali).
4. **🏷️ Etichetta QR** – Formato per stampanti a nastro **Brother con nastro TZe da 24 mm** (es. PT-P710BT; per l'esterno nastro laminato con adesivo extra forte): area di stampa alta 18 mm, lunghezza secondo il TAG (circa 45–110 mm), tutto nero su bianco. QR a sinistra, a destra TAG in grande, JOB, commessa. Dal telefono **📤 Condividi** → app Brother (*iPrint&Label* o *P-touch Design&Print 2*) → stampa adattando l'immagine all'altezza del nastro; in alternativa **Scarica PNG** o **Stampa** dal browser. Misure e risoluzione in `QUALITA_CONFIG.etichetta`.

In un secondo momento si torna alla scheda inquadrando il QR, oppure da **Tutti i JOB → JOB → TAG**, e si aggiungono altre foto, note e documenti. Le foto vengono ridotte (lato massimo 2560 px) e salvate prima sul telefono: se manca la rete restano **in attesa di invio** e partono appena torna (senza chiudere il browser si riprova ogni minuto, o con **Riprova ora**).

**Cartella in ufficio** – Ogni scheda è una cartella, consultabile anche da Esplora file (OneDrive sincronizzato) o dal sito SharePoint, senza passare dal portale:

```
Schede componenti/                        (sito SharePoint "SICIET Qualità")
  S24-015/                                ← Commessa SICIET
    J900/                                 ← JOB
      P-101-A/                            ← TAG
        Scheda.txt                        dati e storico delle note, leggibile
        Etichetta QR.png
        Foto/2026-10-30 14.32.05 Installazione - Mario Rossi.jpg
        Documenti/DDT 1234.pdf
```

**Riepiloghi Excel** – Il servizio li aggiorna da solo a ogni salvataggio di una scheda, di una foto o di un documento:

- `Schede componenti/Riepilogo componenti.xlsx`: tutte le schede;
- `<commessa>/Riepilogo commessa <commessa>.xlsx`: le schede della commessa;
- `<commessa>/<JOB>/Riepilogo JOB <JOB>.xlsx`: le schede del JOB.

Una riga per componente, nell'ordine di inserimento (le schede nuove in fondo; per ordinare o filtrare si usano i filtri già attivi sulla prima riga): commessa, JOB, TAG, descrizione, fornitore, posizione, DDT, stato, numero di foto, documenti e note, ultima nota, date e autori di creazione e aggiornamento, link **Apri scheda** (pagina) e **Apri cartella** (SharePoint). I dati vengono da `indice.json`, che il servizio tiene aggiornato nella cartella dei dati (vedi sotto). Se un riepilogo è aperto in Excel sul PC può non aggiornarsi in quel momento: si aggiorna al salvataggio successivo. Nella pagina iniziale c'è il pulsante **Ricostruisci riepiloghi Excel**, per ricrearli da zero (per esempio dopo aver cancellato a mano delle schede su SharePoint). Sul piano gratuito di Cloudflare l'aggiornamento resta veloce fino a qualche centinaio di schede; oltre, il riepilogo generale potrebbe non aggiornarsi sempre (si può passare a Workers Paid, 5 $/mese).

**Accesso dal QR (password dei tecnici)** – Il QR delle etichette porta alla scheda con un segno "arrivo dal QR". Chi entra così deve inserire la **password di visualizzazione**: vede la scheda e può consultare tutte le schede, ma senza modificare nulla (in alto la barra "Modalità visualizzazione"). Con **✏️ Abilita modifica** e la **password di modifica** si sbloccano foto, note, documenti e dati (e la pagina chiede il nome dell'operatore, se manca). Le password valgono 12 ore su quel telefono. Si impostano su Cloudflare come segreti `PASSWORD_LETTURA` e `PASSWORD_MODIFICA` del worker; se non sono impostate, dal QR si entra senza richieste. Chi apre la pagina normalmente (`hub.siciet.it/quality/`) non vede nessuna richiesta: è un filtro per chi inquadra l'etichetta, non una protezione dei dati. Il segno c'è solo nelle etichette create dalla versione 15 in poi: per rifare tutte le `Etichetta QR.png` (e creare quelle mancanti) c'è il pulsante **🏷️ Rigenera etichette QR** nella pagina iniziale; le etichette già stampate vanno ristampate.

**Cartella dei dati** – I file usati dalla pagina (`scheda.json` di ogni scheda e `indice.json`) non stanno nelle cartelle dei componenti, ma in **SICIET Quality - dati (non modificare)**, nella raccolta Documenti del sito, accanto alla cartella del canale "Qualità": da Teams (scheda File del canale) non si vede, così nessuno li cancella per errore. Ha la stessa struttura `<commessa>/<JOB>/<TAG>/scheda.json`. Se un file venisse cancellato si recupera dal Cestino del sito SharePoint (93 giorni). Le schede create prima di questa modifica, con `scheda.json` nella cartella del TAG, vengono spostate da sole la prima volta che si aprono, oppure tutte insieme con **Ricostruisci riepiloghi Excel**. Il nome della cartella si cambia con la variabile `FOLDER_DATI` del servizio.

**Ritrovare una scheda** – Nella pagina iniziale la casella di ricerca trova le schede per TAG, JOB, commessa o descrizione, senza sapere in che commessa stanno; senza ricerca sono elencate le ultime schede aggiornate. Oppure Commessa → JOB → TAG, o il QR sull'adesivo. Nella scheda si aggiungono foto, note, documenti e si cambia lo stato; dal PC i documenti si possono anche trascinare nel riquadro Documenti. I file messi direttamente su SharePoint nelle cartelle Foto o Documenti del TAG compaiono anche nella pagina.

JOB e TAG diventano nomi di cartella in maiuscolo; i caratteri non ammessi da OneDrive (`\ / : * ? " < > | # %`) diventano `-` (es. `P-101/A` → `P-101-A`, il TAG scritto originale resta nella scheda). Nella scheda **📁 Apri cartella** apre la cartella in OneDrive/SharePoint.

**Accesso: nessuno, solo il nome dell'operatore** – Chi usa la pagina non accede a nulla. Al primo uso sul telefono si scrive **nome e cognome dell'operatore** (si cambia con **Cambia** in alto), che resta memorizzato e finisce nelle note, in Scheda.txt e nel nome delle foto.

**Come funziona il salvataggio** – La pagina manda foto e dati al **servizio** in [`api/`](api/) (un Cloudflare Worker gratuito; in alternativa una Azure Function), che scrive nella cartella **Schede componenti** del team **SICIET Qualità** con le credenziali dell'app **SICIET Quality** registrata in Entra ID, che può accedere solo a quel sito. Le credenziali restano nelle impostazioni del servizio, mai nella pagina.

Senza accesso, **chiunque abbia il link** (o inquadri un QR in cantiere) può vedere le schede e aggiungere foto, note e documenti. Per limitare i danni il servizio ammette scritture solo dentro `<COMMESSA>/<JOB>/<TAG>/` e solo per i file della pagina: foto (solo immagini, max 25 MB) e documenti (niente eseguibili né pagine web, max 50 MB) non sovrascrivono mai file esistenti; `scheda.json` deve essere una scheda valida per quel percorso. Le versioni precedenti dei file restano nella cronologia versioni di SharePoint. Non si può cancellare nulla dalla pagina. Se servisse più protezione basta impostare la variabile `PIN` del servizio: la pagina chiederà il PIN una volta per telefono, senza modifiche al codice.

Finché `api` in `QUALITA_CONFIG` (all'inizio di [`quality.js`](quality.js)) è vuoto, la pagina funziona **in prova** e salva tutto solo nel browser del dispositivo.

**Attivazione** (una volta, da amministratore Microsoft 365)

1. **Entra ID** → *Registrazioni app* → **SICIET Quality**:
   - *Certificati e segreti* → **Nuovo segreto client** (descrizione "Servizio", scadenza 24 mesi) → copiare subito il **Valore** (si vede una volta sola). Annotare la scadenza: prima di allora va creato un segreto nuovo e aggiornato `CLIENT_SECRET`.
   - *Autorizzazioni API* → **Aggiungi** → Microsoft Graph → **Autorizzazioni applicazione** → `Sites.Selected` → **Concedi consenso amministratore**. Le autorizzazioni delegate e l'URI di reindirizzamento SPA non servono più e si possono togliere.
   - Dare all'app l'accesso in scrittura **solo** al sito SICIET Qualità, da [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) con l'account amministratore (consenso `Sites.FullControl.All` se richiesto):
     - `GET https://graph.microsoft.com/v1.0/sites/srlsiciet.sharepoint.com:/sites/SICIETQualit` → copiare `id`;
     - `POST https://graph.microsoft.com/v1.0/sites/<id>/permissions` con corpo
       `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"7b0cf16f-9dc4-4763-83e7-0ce9bef8e4df","displayName":"SICIET Quality"}}]}`
   - (Più semplice ma meno restrittivo: autorizzazione applicazione `Sites.ReadWrite.All` al posto di `Sites.Selected`, senza il passo con Graph Explorer: l'app potrebbe però scrivere in tutti i siti.)
2. **Cloudflare Workers** (piano gratuito: 100.000 richieste al giorno, nessuna carta di credito):
   - registrarsi su [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) con un'email aziendale;
   - *Workers e Pages* → **Crea** → **Inizia con Hello World** → nome `siciet-quality` → **Distribuisci**;
   - **Modifica codice** → cancellare tutto il codice di esempio, incollare il contenuto di [`api/worker.js`](api/worker.js) (su GitHub: pulsante *Raw*, poi seleziona tutto e copia) → **Distribuisci**;
   - *Impostazioni → Variabili e segreti* → **Aggiungi**, una per riga (tipo *Testo*, tranne `CLIENT_SECRET` di tipo *Segreto*):
     | Nome | Valore |
     |---|---|
     | `TENANT_ID` | `5c055224-300a-4b03-8742-552b7dd79f62` |
     | `CLIENT_ID` | `7b0cf16f-9dc4-4763-83e7-0ce9bef8e4df` |
     | `CLIENT_SECRET` | il valore del segreto client |
     | `SITE` | `srlsiciet.sharepoint.com:/sites/SICIETQualit` |
     | `FOLDER` | `Qualità/Schede componenti` |
     | `ORIGIN` | `https://hub.siciet.it` |
   - annotare l'indirizzo del worker (es. `https://siciet-quality.<nome-account>.workers.dev`).

   Quando si modifica `api/worker.js` va ricopiato su Cloudflare allo stesso modo (*Modifica codice* → incolla → *Distribuisci*). Foto e dati passano dal worker (non vengono conservati) e arrivano su SharePoint.
3. In `quality.js` impostare `api: "https://<indirizzo del worker>/api"` e aumentare `?v=` in `index.html`.

**In alternativa, Azure Functions** (a pagamento a consumo, costo minimo): App per le funzioni con piano **Consumo**, Node.js 20, Windows; le stesse variabili d'ambiente; *Configurazione → Credenziali di pubblicazione di autenticazione di base SCM* attivate; profilo di pubblicazione nel segreto GitHub `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` e nome dell'app nella variabile `AZURE_FUNCTIONAPP_NAME`; poi *Actions* → **SICIET Quality – servizio** → **Run workflow**. In questo caso `api` è `https://<dominio predefinito>/api`.

Verifica: `https://<indirizzo del servizio>/api/ping` aperto nel browser risponde `{"ok":true}`; se risponde "Servizio non configurato" manca una variabile d'ambiente. (Facoltativo: variabile `PIN` per chiedere un PIN aziendale.)

Nella stessa configurazione si cambiano i dati aggiuntivi (`campi`), gli stati (`stati`), le fasi delle foto (`fasi`, la prima è quella della foto della targhetta) e la riduzione delle foto (`foto`).

**Limiti**

- Chi inquadra il QR vede la scheda senza accedere. A un cliente o fornitore esterno si può condividere da SharePoint la singola cartella del TAG. Il pulsante **Apri in SharePoint** della scheda è per l'ufficio: SharePoint chiede l'account Microsoft.
- La lettura del TAG dà i risultati migliori riquadrando **solo il TAG**, con la foto dritta e ben illuminata: il riquadro viene ingrandito in base alla sua altezza, portato in bianco e nero (anche per scritte chiare su targhe scure) e letto più volte; tra le righe lette si preferisce il testo dopo "TAG" e la scritta più grande. Su targhette di prova lette con il riquadro, il TAG giusto è il primo proposto in circa 3 casi su 4. Sbaglia ancora con incisioni poco contrastate, riflessi e caratteri simili (B/8, I/1, O/0): il TAG va sempre controllato. In alternativa, su iPhone, toccando il campo TAG si può usare **Scansiona testo** (riconoscimento di Apple, di solito più preciso). La prima lettura scarica circa 10 MB (motore e dati della lingua), poi resta nella cache del browser.
- Le librerie (Tesseract.js, generatore di QR) sono caricate da `cdn.jsdelivr.net`: deve essere raggiungibile dalla rete aziendale e dai telefoni.
- Le foto in attesa di invio restano nel browser in cui sono state scattate: se si cancellano i dati del browser prima dell'invio vanno perse.

**Aggiornamenti** – A ogni modifica di `quality.js` aumentare il numero in `quality.js?v=…` in fondo a `index.html`: altrimenti i telefoni possono continuare a usare per qualche tempo lo script vecchio insieme alla pagina nuova, con errori come "null is not an object".

**Logo e icone** – In [`icons/`](icons/): marchio SICIET con la scritta QUALITY (font Orbitron, gradiente blu → verde come in SICIET HUB). `logo.png` è usato nell'intestazione, le altre sono le icone per la schermata Home e il browser.
