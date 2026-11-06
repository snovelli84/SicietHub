# SICIET ShareDocs

**SICIET ShareDocs** è il sistema di gestione dei transmittal e del ciclo di revisione documentale con i clienti (registro documenti/VDRL, transmittal, file allegati, codici di ritorno e commenti del cliente). È un progetto separato da SICIET HUB, pubblicato all'indirizzo `https://hub.siciet.it/sharedoc/` (cartella [`sharedoc/`](.) di questa repository) e non compare nel portale.

Il prototipo funzionale è su claude.ai; questa cartella contiene per ora la **pagina di test di connessione** a Microsoft 365, primo passo verso la versione reale.

## Configurazione di Entra ID e Microsoft Graph

Questa guida prepara il collegamento di ShareDocs a Microsoft 365, sullo stesso schema di SICIET Quality.
Alla fine la pagina `https://hub.siciet.it/sharedoc/` (**test di connessione**, file [`index.html`](index.html)) verifica sul tenant SICIET che:

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
2. **Autenticazione** → l'URI SPA deve essere esattamente `https://hub.siciet.it/sharedoc/`, barra finale compresa (la pagina torna sempre a quell'indirizzo, anche se aperta come `.../index.html`). Per provare in locale si può aggiungere `http://localhost:8080/`.
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
     cartella: "https://srlsiciet.sharepoint.com/:f:/s/…",  // link del punto 1 (anche dopo)
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

## Architettura della versione reale (proposta)

SICIET Quality salva su SharePoint tramite un **servizio** (Cloudflare Worker) che usa le credenziali dell'app con `Sites.Selected`, cioè con accesso al solo sito SICIET Qualità, e la pagina non fa accedere nessuno. Per ShareDocs l'accesso invece serve, perché le risposte del cliente sono atti ufficiali e vanno attribuite a una persona. La proposta unisce le due cose:

1. la pagina fa accedere l'utente con Entra ID (colleghi SICIET e ospiti del cliente) e ricava il **ruolo** dai ruoli app;
2. il servizio, sullo schema di `quality/api/worker.js`, verifica il token e il ruolo e scrive su SharePoint con `Sites.Selected` limitato al sito *SICIET Docs*;
3. per i file grandi il servizio apre la **sessione di caricamento** e la pagina invia il file a blocchi direttamente a SharePoint, senza limite pratico. Per scaricare, il servizio restituisce il link temporaneo di download;
4. il cliente **non ha bisogno di permessi su SharePoint**: vede solo ciò che il servizio gli mostra per la sua commessa. Niente condivisione esterna del sito da gestire.

Il test di questa pagina usa invece le autorizzazioni **delegate** (`Files.ReadWrite.All`) per verificare in fretta accesso, ruoli, cartella e file grandi. Con l'architettura sopra, `Files.ReadWrite.All` si toglie.

## Versione delle pagine

In fondo a ogni pagina di ShareDocs c'è la riga **"versione N · data"**, come in SICIET Quality. A ogni modifica pubblicata si aumenta di uno il numero e si aggiorna la data nel `<footer>` della pagina. Se nel browser compare un numero più vecchio di quello su GitHub, la pagina è in cache: aggiornare con Ctrl+F5 (sul telefono chiudere e riaprire la scheda).

| Versione | Data | Modifica |
|---|---|---|
| 4 | 06/11/2026 | Numero di versione in fondo alla pagina |
| 3 | 06/11/2026 | Link della cartella SharePoint dei transmittal |
| 2 | 06/11/2026 | ID applicazione della registrazione Entra ID |
| 1 | 06/11/2026 | Prima pubblicazione della pagina di test |

## Note di sicurezza

- Nessun segreto nel codice: l'app usa il flusso SPA con PKCE e il token resta nella sessione del browser.
- Le autorizzazioni sono delegate, quindi valgono i permessi SharePoint dell'utente collegato.
- In produzione si può restringere ancora l'app al solo sito *SICIET Docs* con l'autorizzazione `Sites.Selected` al posto di `Files.ReadWrite.All`. Va concessa sito per sito dall'amministratore: è il passo di irrigidimento consigliato prima di aprire agli ospiti.
