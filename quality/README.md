# SICIET Quality

**SICIET Quality** è un progetto separato da SICIET HUB, pubblicato all'indirizzo `https://hub.siciet.it/quality/` (cartella [`quality/`](.) di questa repository; in futuro può avere un dominio suo, es. `quality.siciet.it`). Si può aggiungere alla schermata Home del telefono come un'app, con il proprio logo.

Per ogni componente di una commessa si crea una scheda identificata da **JOB** e **TAG**, con foto, note, stato e documenti, salvati in una cartella condivisa di OneDrive/SharePoint. Sul componente si attacca un'etichetta con un QR code che riapre la scheda.

**Uso in cantiere**

1. **Rilevamento del TAG** – **+ Nuovo componente** → JOB (viene ricordato l'ultimo usato) → **📷 Fotografa la targhetta**: si riquadra il TAG col dito e il testo viene letto in automatico (OCR con [Tesseract.js](https://tesseract.projectnaptha.com), direttamente sul telefono). Il TAG va sempre controllato; se la lettura non riesce lo si scrive a mano (**Scrivo a mano**). La foto della targhetta viene comunque salvata nella scheda (fase "Targhetta"). Descrizione, fornitore, posizione, DDT, stato e note sono in **Altri dati**, facoltativi. → **Crea scheda**.
2. **Aggiungi foto** – Nella scheda si sceglie la fase (Ricevimento, Installazione, Collaudo, Non conformità…), si scattano una o più foto (o si prendono dalla galleria), si controllano nell'anteprima togliendo quelle venute male, si scrive una nota facoltativa e si preme **Salva foto**. La nota compare nello storico della scheda e sotto ogni foto quando la si ingrandisce.
3. **Note e stato, documenti** – Note generali con cambio di stato (Da verificare / Conforme / Non conforme) e documenti (DDT, certificati, schede tecniche, verbali).
4. **🏷️ Etichetta QR** → **Stampa** (formato dell'etichetta in `QUALITA_CONFIG.etichetta`, di base 62×40 mm) oppure **Scarica PNG** per le app delle stampanti di etichette. Per l'esterno conviene un'etichetta in poliestere/vinile resistente agli agenti atmosferici.

In un secondo momento si torna alla scheda inquadrando il QR, oppure da **Tutti i JOB → JOB → TAG**, e si aggiungono altre foto, note e documenti. Le foto vengono ridotte (lato massimo 2560 px) e salvate prima sul telefono: se manca la rete restano **in attesa di invio** e partono appena torna (senza chiudere il browser si riprova ogni minuto, o con **Riprova ora**).

**Cartella in ufficio** – Ogni scheda è una cartella, consultabile anche da Esplora file (OneDrive sincronizzato) o dal sito SharePoint, senza passare dal portale:

```
<cartella condivisa>/
  C2401/                                  ← JOB
    P-101-A/                              ← TAG
      Scheda.txt                          dati e storico delle note, leggibile
      scheda.json                         gli stessi dati, usati dalla pagina (non modificare a mano)
      Etichetta QR.png
      Foto/2026-10-30 14.32.05 Installazione.jpg
      Documenti/DDT 1234.pdf
```

JOB e TAG diventano nomi di cartella in maiuscolo; i caratteri non ammessi da OneDrive (`\ / : * ? " < > | # %`) diventano `-` (es. `P-101/A` → `P-101-A`, il TAG scritto originale resta nella scheda). Nella scheda **📁 Apri cartella** apre la cartella in OneDrive/SharePoint.

**Configurazione** – Per ora l'accesso con le credenziali Microsoft non è attivo: la pagina funziona **in prova** e salva tutto solo nel browser del dispositivo. Per salvare nella cartella condivisa servono i passi seguenti (una volta). I parametri sono in `QUALITA_CONFIG` all'inizio di [`quality.js`](quality.js):

1. **Cartella**: creare la cartella delle schede in un **sito SharePoint** (es. il team Teams "Qualità" → scheda *File*, oppure un sito SharePoint dedicato), non nel OneDrive personale di un dipendente: il OneDrive personale appartiene all'utente e viene eliminato quando l'account viene chiuso, mentre il sito SharePoint è dell'azienda. Dare accesso in **modifica** al gruppo di chi la userà (cantiere e ufficio). Poi **Condividi → Copia collegamento** (con "Persone con accesso esistente") e incollarlo in `cartella`.
2. **Registrazione dell'app** in [Microsoft Entra ID](https://entra.microsoft.com) → *Registrazioni app → Nuova registrazione*:
   - nome: `SICIET Quality`; tipi di account: *solo questa directory*;
   - URI di reindirizzamento: piattaforma **Applicazione a pagina singola (SPA)**, `https://hub.siciet.it/quality/`;
   - *Autorizzazioni API → Microsoft Graph → Autorizzazioni delegate*: `User.Read` e `Files.ReadWrite.All`, poi **Concedi consenso amministratore**;
   - copiare *ID applicazione (client)* in `clientId` e *ID directory (tenant)* in `tenantId`.

L'app non ha segreti né permessi propri: ogni utente lavora con il proprio account e vede solo le cartelle a cui ha accesso. `Files.ReadWrite.All` serve per scrivere in una cartella condivisa da altri.

Nella stessa configurazione si cambiano i dati aggiuntivi (`campi`), gli stati (`stati`), le fasi delle foto (`fasi`, la prima è quella della foto della targhetta) e la riduzione delle foto (`foto`).

**Limiti**

- Per aprire la scheda dal QR serve un account Microsoft 365 aziendale con accesso alla cartella: un cliente o un fornitore esterno vede solo la richiesta di accesso. Per loro si può condividere da OneDrive la singola cartella del TAG.
- La lettura del TAG funziona bene con targhette pulite e ben illuminate e scritte stampate; con incisioni, riflessi o caratteri piccoli può sbagliare o non leggere nulla, e il TAG si scrive a mano. La prima lettura scarica circa 10 MB (motore e dati della lingua), poi resta nella cache del browser.
- Le librerie (MSAL per l'accesso Microsoft, Tesseract.js, generatore di QR) sono caricate da `cdn.jsdelivr.net`: deve essere raggiungibile dalla rete aziendale e dai telefoni.
- Le foto in attesa di invio restano nel browser in cui sono state scattate: se si cancellano i dati del browser prima dell'invio vanno perse.

**Logo e icone** – In [`icons/`](icons/): marchio SICIET con la scritta QUALITY (font Orbitron, gradiente blu → verde come in SICIET HUB). `logo.png` è usato nell'intestazione, le altre sono le icone per la schermata Home e il browser.
