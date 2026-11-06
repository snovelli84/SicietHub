# SICIET ShareDocs

**SICIET ShareDocs** è il sistema di gestione dei transmittal e del ciclo di revisione documentale con i clienti: registro documenti (VDRL), transmittal con file allegati, codici di ritorno e commenti del cliente, portale per il cliente. È un progetto separato da SICIET HUB, pubblicato all'indirizzo **`https://hub.siciet.it/sharedoc/`** (cartella [`sharedoc/`](.) di questa repository), e non compare nel portale.

| File | Cosa contiene |
|---|---|
| [`index.html`](index.html), [`sharedoc.js`](sharedoc.js) | l'app: accesso Microsoft, registro, transmittal, commenti, portale cliente |
| [`api/worker.js`](api/worker.js) | il servizio su Cloudflare che legge e scrive su SharePoint (sezione 7) |
| [`test/index.html`](test/index.html) | la pagina di test della connessione a Microsoft 365 (`https://hub.siciet.it/sharedoc/test/`) |

## Uso dell'app

- **Accesso**: con l'account Microsoft. I colleghi SICIET usano l'account aziendale; i clienti l'account ospite invitato da SICIET. Cosa si può fare dipende dal **ruolo app** assegnato in Entra ID (applicazioni aziendali → SICIET ShareDocs → Utenti e gruppi):
  - **Document Controller**: crea commesse, gestisce il registro, prepara ed emette i transmittal con i file, registra le risposte arrivate per altre vie;
  - **Tecnico SICIET**: consulta tutto e risponde ai commenti del cliente;
  - **Cliente**: vede solo i transmittal emessi delle commesse in cui il suo indirizzo o dominio è tra i *clienti ammessi*, scarica i file e risponde con codici, commenti e **allegati** (disegni commentati, documenti di riferimento). Il portale è sempre in inglese.
- **Allegati della risposta**: vanno in `<commessa>/Transmittals/<n. transmittal>/Client reply/` con nome `<n. documento>_Rev<rev>_Client_<nome originale>`; non sovrascrivono mai file esistenti. Anche il Document Controller può allegarli quando registra una risposta arrivata per email.
- **Interfaccia** in italiano o inglese (selettore IT/EN); le comunicazioni ufficiali (foglio transmittal, VDRL, CRS) sono sempre in inglese.
- **Transmittal**: si scelgono documenti, revisione, scopo e i file di ciascuno, di solito PDF e nativo (DWG, DOCX…), fino a 10. Il nome resta quello originale (es. `SOK976701376_005_A.pdf`) e deve iniziare con il numero del documento. I file vengono caricati a blocchi direttamente in `SICIET Docs / Documenti / <commessa> / Transmittals / <n. transmittal>/`, senza limite di dimensione. Senza file non si emette.
- **Importa archivio** (pagina Transmittal, Document Controller): si sposta su SICIET Docs, dentro la cartella della commessa, la cartella dei file già trasmessi (es. `S2040_TRASMITTAL`) e la si analizza. ShareDocs riconosce documento e revisione dal nome (`SOK976701376_005_A.pdf`, `SOK976701379 GA_REV5.dwg`) e i PDF dei transmittal (`S2040-T03.pdf`), mostra un'anteprima di cosa collegherà e di cosa non torna, e su conferma collega i file ai transmittal emessi. I file restano dove sono. Se la stessa revisione è in più transmittal vale quello con la data più vicina al file. Si può ripetere: i file già collegati non si duplicano.
- **Excel**: `VDRL <commessa>.xlsx` e `CRS <commessa>.xlsx` nella cartella della commessa si aggiornano da soli a ogni modifica.
- **Vista Client** (selettore SICIET | Client, solo per i colleghi SICIET): mostra il portale come lo vede il cliente.
- **Prima commessa e dati esistenti**: alla prima apertura il Document Controller crea la commessa (codice, nome, cartella, clienti ammessi). Poi da *Transmittal → Impostazioni commessa → Importazione iniziale* carica il file JSON con il registro esistente. I dati dei clienti **non vanno mai in questa repository**, che è pubblica: il file di importazione si conserva altrove.
- **Clienti ammessi**: in *Impostazioni commessa*, uno per riga, indirizzi completi o domini (`@pegitaly.it`). Il cliente deve anche essere invitato come ospite in Entra ID e avere il ruolo **Cliente**.

## Configurazione di Entra ID e Microsoft Graph

Questa guida prepara il collegamento di ShareDocs a Microsoft 365, sullo stesso schema di SICIET Quality.
Alla fine la pagina `https://hub.siciet.it/sharedoc/test/` (**test di connessione**, file [`test/index.html`](test/index.html)) verifica sul tenant SICIET che:

- l'accesso con l'account aziendale funzioni e l'utente abbia un **ruolo** ShareDocs;
- l'app raggiunga la cartella SharePoint dei transmittal;
- si possano caricare file anche **oltre 20 MB** (sessione di caricamento di Graph);
- i file si possano rileggere, elencare ed eliminare.

ShareDocs è un'app web a sé, come SICIET Quality: ci entrano i colleghi SICIET con l'account aziendale e il cliente come **utente ospite** del tenant SICIET. Teams non è necessario.

Tempo stimato: 30–45 minuti. Serve un utente con ruolo **Amministratore applicazioni** (o Amministratore globale) in Entra ID e un proprietario del sito SharePoint.

---

## 1. Cartella SharePoint dei transmittal

1. Scegli il sito. Consiglio un **sito dedicato "SICIET Docs"**, separato dall'intranet, perché più avanti ci entreranno anche gli ospiti del cliente: la condivisione esterna si abilita solo su quel sito.
2. Nella raccolta *Documenti* crea la struttura:
   ```
   SICIET Docs / 2040 PEG ITALY HVAC NGFGT IRAQ / Transmittals
   ```
   È lo stesso percorso impostato nel prototipo ShareDocs (*Impostazioni commessa → Cartella SharePoint dei transmittal*).
3. Sulla cartella **Transmittals**: *Condividi → Copia collegamento*. Per il test interno va bene "Persone in SICIET con il collegamento", **con modifica**.
4. Tieni da parte il link: va in `cartella`.

## 2. Registrazione dell'app in Microsoft Entra ID

Portale: <https://entra.microsoft.com> → **Identità → Applicazioni → Registrazioni app → Nuova registrazione**.

| Campo | Valore |
|---|---|
| Nome | `SICIET ShareDocs` |
| Tipi di account supportati | **Solo gli account in questa directory organizzativa** (tenant singolo). Gli ospiti del cliente, una volta invitati, fanno parte della directory e possono accedere lo stesso. |
| URI di reindirizzamento | Piattaforma **Applicazione a pagina singola (SPA)** → `https://hub.siciet.it/sharedoc/` |

Consiglio una registrazione **separata da SICIET Quality**: permessi, utenti assegnati e ospiti restano distinti e il cliente non vede mai Quality.

Dopo la creazione:

1. **Panoramica** → copia *ID applicazione (client)* e *ID directory (tenant)*.
2. **Autenticazione** → gli URI SPA devono essere esattamente `https://hub.siciet.it/sharedoc/` (l'app) e `https://hub.siciet.it/sharedoc/test/` (la pagina di test), barra finale compresa (la pagina torna sempre a quell'indirizzo, anche se aperta come `.../index.html`). Per provare in locale si può aggiungere `http://localhost:8080/`.
   Non serve nessun *segreto client*: l'app è una SPA con accesso PKCE, come Quality. Non crearne.
3. **Autorizzazioni API → Aggiungi autorizzazione → Microsoft Graph → Autorizzazioni delegate**:
   - `User.Read` (di solito già presente)
   - `Files.ReadWrite.All`
   Poi **Concedi consenso amministratore per SICIET**: tutte le righe devono avere la spunta verde.
   (Più avanti, per salvare VDRL, transmittal e commenti in liste SharePoint, si aggiungerà `Sites.ReadWrite.All`; per questo test non serve.)
4. **Ruoli dell'app** (*Ruoli app → Crea ruolo app*, tipo di membro consentito **Utenti/Gruppi**). Servono a ShareDocs per sapere chi è interno e chi è il cliente, senza liste di nomi nel codice:

   | Nome visualizzato | Valore | Descrizione |
   |---|---|---|
   | Document Controller | `DocControl` | Crea ed emette i transmittal, gestisce il registro |
   | Tecnico SICIET | `Engineer` | Consulta il registro, risponde ai commenti |
   | Cliente | `Client` | Vede i transmittal ricevuti, scarica i file, invia codici e commenti |

5. **Applicazioni aziendali → SICIET ShareDocs → Proprietà → Assegnazione obbligatoria = Sì**. Poi in *Utenti e gruppi* assegna i ruoli ai gruppi:
   - `ShareDocs – Document Control` → **Document Controller**
   - `ShareDocs – SICIET` → **Tecnico SICIET**
   - `ShareDocs – Cliente 2040 PEG` → **Cliente** (qui finiranno gli ospiti di PEG e BH)

   Così l'app la apre solo chi è in uno dei gruppi, e ognuno con il suo ruolo. Per una nuova commessa basta un nuovo gruppo cliente.
   (L'assegnazione di gruppi alle app richiede Entra ID P1, incluso in Microsoft 365 Business Premium o E3/E5. Senza P1 si assegnano i singoli utenti.)

> Le autorizzazioni sono **delegate**: l'app può fare solo ciò che l'utente collegato può già fare in SharePoint. Un utente senza accesso alla cartella riceve "accesso negato", anche se l'app ha `Files.ReadWrite.All`.

## 3. Configurare ed eseguire il test

1. In [`index.html`](index.html), all'inizio dello script, compila `SHAREDOCS_CONFIG`:
   ```js
   var SHAREDOCS_CONFIG = {
     clientId: "…",   // ID applicazione (client) di "SICIET ShareDocs"
     tenantId: "5c055224-300a-4b03-8742-552b7dd79f62",   // tenant SICIET, già impostato
     sito: "https://srlsiciet.sharepoint.com/sites/SICIETDocs",
     cartella: "2040 PEG ITALY HVAC NGFGT IRAQ/Transmittals",   // percorso dentro "Documenti"
     testSizeMB: 25
   };
   ```
   Con il solo `clientId` si provano già accesso e ruoli; il test dei file parte quando c'è anche `cartella`.
   Salva su GitHub: dopo un minuto circa la pagina è aggiornata su `https://hub.siciet.it/sharedoc/`.
2. Apri `https://hub.siciet.it/sharedoc/` → **Accedi con Microsoft**. In alto compare il ruolo assegnato (Document Controller, Tecnico SICIET o Cliente).
3. **Avvia il test**. I passi diventano verdi uno alla volta:
   1. Profilo utente
   2. Ruolo nell'app ShareDocs
   3. Apertura della cartella dei transmittal dal link
   4. Creazione di `_ShareDocs-test/<data ora>` dentro *Transmittals*
   5. Caricamento di un file piccolo
   6. Caricamento di un file da 25 MB a blocchi (barra di avanzamento e velocità)
   7. Rilettura del file piccolo e confronto del contenuto
   8. Elenco della cartella
4. Facoltativo: nella sezione 3 carica un PDF o un DWG vero, anche grande. Viene salvato con il nome standard di ShareDocs (`SOK999999999_RevA.pdf`) e trovi il link per aprirlo su SharePoint.
5. **Elimina i file di prova**: la cartella di prova finisce nel cestino del sito.

## 4. Se qualcosa va storto

| Messaggio | Causa e soluzione |
|---|---|
| `AADSTS50011` (redirect URI mismatch) | `https://hub.siciet.it/sharedoc/` non è tra gli URI SPA del punto 2.2. Aggiungilo identico, barra finale compresa. |
| "Nessun ruolo ShareDocs assegnato" | Assegna un ruolo all'utente o al suo gruppo (punto 2.5), poi **Esci** e rientra. |
| `AADSTS65001` / richiesta di consenso | Manca il consenso amministratore: punto 2.3. |
| `AADSTS50105` | È attiva l'assegnazione obbligatoria e l'utente non è nel gruppo: punto 2.4. |
| `AADSTS700054` / `response_type` | L'URI è registrato come piattaforma *Web* invece che *SPA*. Spostalo nella piattaforma SPA. |
| `accessDenied` (HTTP 403) | L'utente non ha accesso in modifica alla cartella, oppure manca il consenso a `Files.ReadWrite.All`. |
| `itemNotFound` (HTTP 404) sulla cartella | Il link in `cartella` non è quello di condivisione della cartella, o è scaduto. Rigeneralo. |
| Il file grande si ferma | Rete o proxy aziendale che limita i caricamenti verso `*.sharepoint.com`. Riprova da un'altra rete per capire. |

## 5. Dopo il test interno: prova con un ospite (simulazione del cliente)

Quando il test interno è verde, si prova l'accesso del cliente:

1. **Entra ID → Identità esterne → Impostazioni di collaborazione esterna**: verifica che gli inviti agli ospiti siano consentiti (eventualmente solo ad amministratori e a un gruppo di invitanti).
2. **Interfaccia di amministrazione di SharePoint → Siti attivi → SICIET Docs → Condivisione**: imposta *Utenti guest nuovi ed esistenti* (o *esistenti*, se gli ospiti li invitate da Entra). Lascia l'intranet com'è.
3. Invita un indirizzo di prova esterno (es. una casella personale) come ospite e aggiungilo al gruppo `ShareDocs – Utenti`.
4. Condividi la cartella **della sola commessa** con quell'ospite, in sola lettura o modifica a seconda di cosa deve poter fare.
   Per gli ospiti il link "Persone in SICIET" non funziona: in `cartella` usa un link "Persone con accesso esistente".
5. Ripeti il test accedendo come ospite: il passo 1 deve mostrare "utente OSPITE" e l'ospite deve vedere solo la sua cartella.

## 6. Cosa mandarmi per il passo successivo

- **ID applicazione (client)** e **ID directory (tenant)**: non sono segreti e servono nella configurazione dell'app.
- Il **link della cartella** Transmittals.
- Lo **screenshot dell'esito** del test, oppure il messaggio di errore del passo che diventa rosso.

Con il test verde si passa alla versione reale di ShareDocs:

1. registro di documenti, transmittal e commenti in liste SharePoint (`Sites.ReadWrite.All`);
2. file allegati caricati direttamente nella cartella del transmittal, senza limite di 20 MB;
3. portale per gli ospiti del cliente, con download e risposta.

## 7. Servizio di ShareDocs (Cloudflare Worker)

Il codice è in [`api/worker.js`](api/worker.js): verifica l'utente (token Entra ID e ruolo), legge e scrive su **SICIET Docs** con le credenziali dell'app, tiene il registro di ogni commessa e aggiorna da solo **VDRL** e **CRS** in Excel. Il cliente non ha permessi su SharePoint: vede solo i transmittal emessi della sua commessa, attraverso il servizio.

### 7.1 Entra ID – registrazione "SICIET ShareDocs"

1. **Esporre un'API** → *URI ID applicazione* → **Aggiungi** → lascia `api://9e9b873b-2e7c-4011-aebd-7470627d55ec` → **Salva**.
   Poi **Aggiungi un ambito**:
   | Campo | Valore |
   |---|---|
   | Nome ambito | `access_as_user` |
   | Chi può fornire il consenso | Amministratori e utenti |
   | Nome visualizzato consenso amministratore | Usare SICIET ShareDocs |
   | Descrizione consenso amministratore | Permette alla pagina di SICIET ShareDocs di chiamare il servizio a nome dell'utente |
   | Stato | Abilitato |
2. **Autorizzazioni API** → **Aggiungi un'autorizzazione** → *Le mie API* → **SICIET ShareDocs** → delegate → `access_as_user` → **Aggiungi**.
   Poi, sempre in *Aggiungi un'autorizzazione* → **Microsoft Graph** → **Autorizzazioni applicazione** → `Sites.Selected` → **Aggiungi**.
   Infine **Concedi consenso amministratore per S.I.C.I.E.T.**: tutte le righe con la spunta verde.
3. **Certificati e segreti** → **Nuovo segreto client** (descrizione "Servizio ShareDocs", scadenza 24 mesi) → copia subito il **Valore**, si vede una volta sola. Annota la scadenza: prima di allora si crea un segreto nuovo e si aggiorna `CLIENT_SECRET` su Cloudflare.
4. **Accesso al solo sito SICIET Docs** (se non si riesce a concedere `Sites.FullControl.All` a Graph Explorer, in alternativa si usa l'autorizzazione applicazione `Sites.ReadWrite.All` al posto di `Sites.Selected`, senza questo passo: funziona subito ma l'app potrebbe scrivere in tutti i siti), da [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) con l'account amministratore (consenso `Sites.FullControl.All` se richiesto), come per SICIET Quality:
   - `GET https://graph.microsoft.com/v1.0/sites/srlsiciet.sharepoint.com:/sites/SICIETDocs` → copia `id`;
   - `POST https://graph.microsoft.com/v1.0/sites/<id>/permissions` con corpo
     `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"9e9b873b-2e7c-4011-aebd-7470627d55ec","displayName":"SICIET ShareDocs"}}]}` → risposta **201**.

### 7.2 Cloudflare

1. Nel worker creato → **Modifica codice** → cancella il codice di esempio, incolla il contenuto di [`api/worker.js`](api/worker.js) (su GitHub: *Raw*, seleziona tutto, copia) → **Distribuisci**.
2. *Impostazioni → Variabili e segreti* → **Aggiungi** (tipo *Testo*, tranne `CLIENT_SECRET` di tipo *Segreto*):
   | Nome | Valore |
   |---|---|
   | `TENANT_ID` | `5c055224-300a-4b03-8742-552b7dd79f62` |
   | `CLIENT_ID` | `9e9b873b-2e7c-4011-aebd-7470627d55ec` |
   | `CLIENT_SECRET` | il valore del segreto del punto 7.1.3 |
   | `SITE` | `srlsiciet.sharepoint.com:/sites/SICIETDocs` |
   | `ORIGIN` | `https://hub.siciet.it` |
3. Verifica: `https://<indirizzo del worker>/api/ping` nel browser risponde `{"ok":true,…}`. Se risponde "Servizio non configurato" manca una variabile.
   Poi `https://<indirizzo del worker>/api/ping?sharepoint=1`: deve rispondere `"sharepoint":"ok"` con l'indirizzo della raccolta Documenti di SICIET Docs. Altrimenti il messaggio dice cosa manca (segreto errato, permesso dell'app, sito).
4. Mandami l'indirizzo del worker (es. `https://siciet-sharedocs.<account>.workers.dev`): va nella configurazione della pagina.

Quando si modifica `api/worker.js` va ricopiato su Cloudflare allo stesso modo, aumentando `VERSIONE_SERVIZIO` (e `SERVIZIO_ATTESO` in `sharedoc.js`). In fondo alla pagina compare la versione del servizio in uso: se è più vecchia di quella attesa compare un avviso rosso.

### 7.3 Cosa crea su SharePoint

```
SICIET Docs / Documenti /
  2040 PEG ITALY HVAC NGFGT IRAQ/
    Transmittals/S2040-T08/SOK976701376_Rev5.pdf      file allegati, con nome standard
    VDRL 2040.xlsx                                    aggiornato a ogni modifica (in inglese)
    CRS 2040.xlsx                                     registro commenti (in inglese)
  ShareDocs - dati (non modificare)/
    commesse.json                                     elenco commesse e clienti ammessi
    2040/registro.json                                registro: documenti, transmittal, commenti, storico operazioni
```

Ogni modifica al registro è controllata (ruolo, dati, cartella dei file) e registrata nello storico con autore e ora. Se due persone salvano insieme, il servizio rilegge e riapplica la modifica, senza perdite. I file del registro, se cancellati per errore, si recuperano dal Cestino del sito (93 giorni) e dalla cronologia versioni.

**Clienti ammessi**: per ogni commessa c'è l'elenco degli indirizzi o domini dei clienti (es. `@pegitaly.it`). Un ospite con ruolo **Cliente** vede solo le commesse in cui compare il suo indirizzo o il suo dominio.

Quando la pagina userà il servizio, l'autorizzazione delegata `Files.ReadWrite.All`, usata solo dal test, si potrà togliere.

## Architettura della versione reale (proposta)

SICIET Quality salva su SharePoint tramite un **servizio** (Cloudflare Worker) che usa le credenziali dell'app con `Sites.Selected`, cioè con accesso al solo sito SICIET Qualità, e la pagina non fa accedere nessuno. Per ShareDocs l'accesso invece serve, perché le risposte del cliente sono atti ufficiali e vanno attribuite a una persona. La proposta unisce le due cose:

1. la pagina fa accedere l'utente con Entra ID (colleghi SICIET e ospiti del cliente) e ricava il **ruolo** dai ruoli app;
2. il servizio, sullo schema di `quality/api/worker.js`, verifica il token e il ruolo e scrive su SharePoint con `Sites.Selected` limitato al sito *SICIET Docs*;
3. per i file grandi il servizio apre la **sessione di caricamento** e la pagina invia il file a blocchi direttamente a SharePoint, senza limite pratico. Per scaricare, il servizio restituisce il link temporaneo di download;
4. il cliente **non ha bisogno di permessi su SharePoint**: vede solo ciò che il servizio gli mostra per la sua commessa. Niente condivisione esterna del sito da gestire.

Il test di questa pagina usa invece le autorizzazioni **delegate** (`Files.ReadWrite.All`) per verificare in fretta accesso, ruoli, cartella e file grandi. Con l'architettura sopra, `Files.ReadWrite.All` si toglie.

## Versione delle pagine

**App** (`index.html` + `sharedoc.js`): versione 9 del 06/11/2026 (importazione dell'archivio; servizio v9; v8: più file per documento con il nome originale; v7: pagina Commenti con una scheda per ogni risposta del cliente; v6: in fondo alla pagina la versione del servizio, con avviso se su Cloudflare è vecchio; v5: allegati del cliente nella risposta; v4: controllo dei file scaricati; v3: anteprima dei PDF dentro ShareDocs; v2: pulsante *Aggiorna Excel*; v1: prima versione collegata al servizio). A ogni modifica di `sharedoc.js` aumentare `VERSIONE`, il numero in `sharedoc.js?v=` e il footer di `index.html`.

**Pagina di test** (`test/index.html`):

In fondo a ogni pagina di ShareDocs c'è la riga **"versione N · data"**, come in SICIET Quality. A ogni modifica pubblicata si aumenta di uno il numero e si aggiorna la data nel `<footer>` della pagina. Se nel browser compare un numero più vecchio di quello su GitHub, la pagina è in cache: aggiornare con Ctrl+F5 (sul telefono chiudere e riaprire la scheda).

| Versione | Data | Modifica |
|---|---|---|
| 6 | 06/11/2026 | Il sito si apre anche senza `Sites.Read.All`, passando dalla raccolta Documenti |
| 5 | 06/11/2026 | Sito SICIET Docs e percorso della cartella al posto del link di condivisione; le cartelle mancanti si creano da sole |
| 4 | 06/11/2026 | Numero di versione in fondo alla pagina |
| 3 | 06/11/2026 | Link della cartella SharePoint dei transmittal |
| 2 | 06/11/2026 | ID applicazione della registrazione Entra ID |
| 1 | 06/11/2026 | Prima pubblicazione della pagina di test |

## Note di sicurezza

- Nessun segreto nel codice: l'app usa il flusso SPA con PKCE e il token resta nella sessione del browser.
- Le autorizzazioni sono delegate, quindi valgono i permessi SharePoint dell'utente collegato.
- In produzione si può restringere ancora l'app al solo sito *SICIET Docs* con l'autorizzazione `Sites.Selected` al posto di `Files.ReadWrite.All`. Va concessa sito per sito dall'amministratore: è il passo di irrigidimento consigliato prima di aprire agli ospiti.
