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
4. **🏷️ Etichetta QR** → **Stampa** (formato dell'etichetta in `QUALITA_CONFIG.etichetta`, di base 62×40 mm) oppure **Scarica PNG** per le app delle stampanti di etichette. Per l'esterno conviene un'etichetta in poliestere/vinile resistente agli agenti atmosferici.

In un secondo momento si torna alla scheda inquadrando il QR, oppure da **Tutti i JOB → JOB → TAG**, e si aggiungono altre foto, note e documenti. Le foto vengono ridotte (lato massimo 2560 px) e salvate prima sul telefono: se manca la rete restano **in attesa di invio** e partono appena torna (senza chiudere il browser si riprova ogni minuto, o con **Riprova ora**).

**Cartella in ufficio** – Ogni scheda è una cartella, consultabile anche da Esplora file (OneDrive sincronizzato) o dal sito SharePoint, senza passare dal portale:

```
Schede componenti/                        (sito SharePoint "SICIET Qualità")
  S24-015/                                ← Commessa SICIET
    J900/                                 ← JOB
      P-101-A/                            ← TAG
        Scheda.txt                        dati e storico delle note, leggibile
        scheda.json                       gli stessi dati, usati dalla pagina (non modificare a mano)
        Etichetta QR.png
        Foto/2026-10-30 14.32.05 Installazione - Mario Rossi.jpg
        Documenti/DDT 1234.pdf
```

JOB e TAG diventano nomi di cartella in maiuscolo; i caratteri non ammessi da OneDrive (`\ / : * ? " < > | # %`) diventano `-` (es. `P-101/A` → `P-101-A`, il TAG scritto originale resta nella scheda). Nella scheda **📁 Apri cartella** apre la cartella in OneDrive/SharePoint.

**Accesso e operatore** – Si accede con un account Microsoft 365 (sui telefoni di cantiere un account condiviso, inserito una volta: l'accesso resta memorizzato). Al primo uso la pagina chiede **nome e cognome dell'operatore**, memorizzato sul telefono (si cambia con **Cambia** in alto): finisce nelle note, in Scheda.txt e nel nome delle foto, così si sa chi ha fatto cosa anche con l'account condiviso. Si disattiva con `chiediOperatore: false`.

**Configurazione** – Attiva: cartella **Schede componenti** del team Teams **SICIET Qualità** e app **SICIET Quality** registrata in Entra ID (ID in `QUALITA_CONFIG`). Se `clientId`, `tenantId` o `cartella` sono vuoti la pagina funziona **in prova** e salva tutto solo nel browser del dispositivo. Passi per rifare la configurazione: I parametri sono in `QUALITA_CONFIG` all'inizio di [`quality.js`](quality.js):

1. **Cartella**: creare la cartella delle schede in un **sito SharePoint** (es. il team Teams "Qualità" → scheda *File*, oppure un sito SharePoint dedicato), non nel OneDrive personale di un dipendente: il OneDrive personale appartiene all'utente e viene eliminato quando l'account viene chiuso, mentre il sito SharePoint è dell'azienda. Dare accesso in **modifica** al gruppo di chi la userà (cantiere e ufficio). Poi **Condividi → Copia collegamento** (con "Persone con accesso esistente") e incollarlo in `cartella`.
2. **Registrazione dell'app** in [Microsoft Entra ID](https://entra.microsoft.com) → *Registrazioni app → Nuova registrazione*:
   - nome: `SICIET Quality`; tipi di account: *solo questa directory*;
   - URI di reindirizzamento: piattaforma **Applicazione a pagina singola (SPA)**, `https://hub.siciet.it/quality/` (la pagina usa sempre questo indirizzo, anche se aperta come `…/quality/index.html`);
   - *Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate*: `User.Read` e `Files.ReadWrite.All`, poi **Concedi consenso amministratore**;
   - copiare *ID applicazione (client)* in `clientId` e *ID directory (tenant)* in `tenantId`.

L'app non ha segreti né permessi propri: ogni utente lavora con il proprio account e vede solo le cartelle a cui ha accesso. `Files.ReadWrite.All` serve per scrivere in una cartella condivisa da altri.

Nella stessa configurazione si cambiano i dati aggiuntivi (`campi`), gli stati (`stati`), le fasi delle foto (`fasi`, la prima è quella della foto della targhetta) e la riduzione delle foto (`foto`).

**Limiti**

- Per aprire la scheda dal QR serve un account Microsoft 365 aziendale con accesso alla cartella: un cliente o un fornitore esterno vede solo la richiesta di accesso. Per loro si può condividere da OneDrive la singola cartella del TAG.
- La lettura del TAG dà i risultati migliori riquadrando **solo il TAG**, con la foto dritta e ben illuminata: il riquadro viene ingrandito in base alla sua altezza, portato in bianco e nero (anche per scritte chiare su targhe scure) e letto più volte; tra le righe lette si preferisce il testo dopo "TAG" e la scritta più grande. Su targhette di prova lette con il riquadro, il TAG giusto è il primo proposto in circa 3 casi su 4. Sbaglia ancora con incisioni poco contrastate, riflessi e caratteri simili (B/8, I/1, O/0): il TAG va sempre controllato. In alternativa, su iPhone, toccando il campo TAG si può usare **Scansiona testo** (riconoscimento di Apple, di solito più preciso). La prima lettura scarica circa 10 MB (motore e dati della lingua), poi resta nella cache del browser.
- Le librerie (MSAL per l'accesso Microsoft, Tesseract.js, generatore di QR) sono caricate da `cdn.jsdelivr.net`: deve essere raggiungibile dalla rete aziendale e dai telefoni.
- Le foto in attesa di invio restano nel browser in cui sono state scattate: se si cancellano i dati del browser prima dell'invio vanno perse.

**Aggiornamenti** – A ogni modifica di `quality.js` aumentare il numero in `quality.js?v=…` in fondo a `index.html`: altrimenti i telefoni possono continuare a usare per qualche tempo lo script vecchio insieme alla pagina nuova, con errori come "null is not an object".

**Logo e icone** – In [`icons/`](icons/): marchio SICIET con la scritta QUALITY (font Orbitron, gradiente blu → verde come in SICIET HUB). `logo.png` è usato nell'intestazione, le altre sono le icone per la schermata Home e il browser.
