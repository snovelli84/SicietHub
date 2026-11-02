# SICIET HR

**SICIET HR** è un progetto separato da SICIET HUB, pubblicato all'indirizzo `https://hub.siciet.it/hr` (cartella [`hr/`](.) di questa repository). Non compare nel portale e non è indicizzato dai motori di ricerca: ci si arriva solo scrivendo l'indirizzo. Si può aggiungere alla schermata Home del telefono come un'app, con il proprio logo.

Serve al **Responsabile del Personale** per comunicare una **nuova assunzione**: si compila un unico modulo, si allegano i documenti e la pagina manda **un'email a ciascun gruppo di destinatari** (consulente del lavoro, direzione, amministrazione, sicurezza, IT…), ognuna con **i soli dati e documenti di sua competenza**. Così nessuno viene dimenticato e nessuna informazione manca: il modulo non si invia finché i campi obbligatori e i documenti richiesti non ci sono.

## Uso

1. Aprire `hub.siciet.it/hr` e inserire la **password** (vale finché non si chiude la scheda del browser).
2. Al primo uso, **Chi compila**: nome, ruolo, telefono, email aziendale. Diventano la firma delle email e l'indirizzo a cui arrivano le risposte; restano memorizzati sul dispositivo (**Cambia** in alto).
3. Compilare il modulo. Ogni parte mostra **chi la riceve** (es. "Ricevono: Consulente del lavoro, Amministrazione…"). I campi con 🔒 (periodo di prova, retribuzione, accordi economici) vanno solo a chi deve conoscerli. Alcuni campi compaiono solo quando servono: permesso di soggiorno per i cittadini extra UE, data di fine per i contratti a termine, ore settimanali per il part-time, familiari a carico se si chiedono le detrazioni.
4. **Documenti**: per ogni categoria **📎 Aggiungi** (dal PC si possono anche trascinare i file). Le foto grandi vengono ridotte in automatico. I file prendono il nome del dipendente, es. `ZLATOV Sergiu - Documento di identità.pdf`.
5. **Controlla e invia**: se manca qualcosa compare l'elenco, toccando una voce si va al campo. Altrimenti si apre **Chi riceve cosa**, con gli avvisi da verificare (es. data di nascita diversa da quella del codice fiscale, permesso di soggiorno che scade prima del contratto, IBAN mancante, UNILAV in ritardo) e, per ogni gruppo, destinatari, dati, allegati e il testo esatto dell'email (**Vedi l'email**).
6. **Conferma e invia**. Al termine la pagina elenca a chi è stata comunicata l'assunzione.

I dati scritti restano salvati sul dispositivo finché non si invia o si tocca **Svuota modulo** (così non si perdono chiudendo la pagina per errore); i documenti vanno riallegati.

**Controlli automatici** – Codice fiscale (formato e carattere di controllo, anche omocodico) confrontato con data di nascita e sesso; IBAN (cifre di controllo); CAP, provincia, telefono ed email; data di fine successiva all'inizio; età plausibile e avviso per i minorenni; permesso di soggiorno non scaduto all'inizio del rapporto; dimensione degli allegati (massimo 15 MB per file e 20 MB in tutto).

## Chi riceve cosa

Configurazione attuale (in `HR_CONFIG.destinatari`, all'inizio di [`hr.js`](hr.js)):

| Gruppo | Destinatari | Dati | Dati economici 🔒 | Documenti |
|---|---|---|---|---|
| Consulente del lavoro | Massimo Fiorentini (CNA) | anagrafica, residenza, contatti, busta paga, contratto, richieste (contratto, UNILAV, costo) | sì | tutti |
| Direzione | Vincenzo e Simona Picciolini | anagrafica, contatti, contratto, sicurezza, dotazioni | sì | no |
| Amministrazione | Valeria Capaldi | anagrafica, residenza, contatti, busta paga, contratto | sì | no |
| Ufficio personale | Daniela Ugrani | nome, contatti, contratto, dotazioni | no | no |
| Sicurezza (RSPP) | Daniele Morini (sicurezza@) | anagrafica, contatti, contratto, sicurezza e DPI | no | attestati e patenti |
| IT | Simone Novelli | nome, contatti, contratto, account e dotazioni | no | no |
| Responsabile del Personale | Paolo Censini | tutto (copia completa) | sì | tutti |

Le "Note per tutti" vanno a ogni gruppo. In fondo a ogni email c'è l'elenco degli altri gruppi informati e, a chi non riceve i documenti, una riga che dice a chi sono stati inviati.

Per cambiare destinatari, cosa ricevono o i testi delle email si modifica `HR_CONFIG` in `hr.js` (i commenti spiegano ogni voce) e si aumenta `hr.js?v=` in `index.html`. Nello stesso punto: società, firma aziendale, oggetto delle email, CCNL e luoghi di lavoro proposti. I campi del modulo sono in `CAMPI`, le categorie di documenti in `DOCUMENTI`. **Un indirizzo esterno nuovo** (es. un altro consulente) va aggiunto anche alla variabile `ESTERNI` del servizio, altrimenti l'invio viene rifiutato.

## Come funziona l'invio

La pagina è statica: le email le spedisce il **servizio** in [`api/worker.js`](api/worker.js) (un Cloudflare Worker, piano gratuito, come per SICIET Quality) tramite Microsoft Graph, dalla casella indicata in `MITTENTE` (consigliata una casella condivisa, es. `hr@siciet.it` con nome visualizzato "SICIET HR", che non richiede licenza). Le email partono da lì con **Rispondi a** impostato su chi compila, e una copia resta nella **Posta inviata** di quella casella: è anche l'archivio delle comunicazioni.

Passaggi: la pagina manda i dati → il servizio crea le bozze nella casella → la pagina carica gli allegati di ciascuna bozza → il servizio spedisce tutte le bozze. Se qualcosa va storto prima della spedizione le bozze vengono cancellate e non parte nulla. Il servizio non conserva dati né documenti.

**Protezioni**

- Senza la **password** (`PASSWORD` del servizio) non si invia nulla, e la pagina non mostra il modulo.
- Il servizio accetta destinatari solo dei domini in `DOMINI` (di base `siciet.it`) o elencati in `ESTERNI`: anche con la password non si possono mandare dati a indirizzi qualsiasi.
- I passaggi dell'invio sono firmati dal servizio (scadono dopo un'ora); allegati eseguibili o pagine web non sono ammessi; tutto il testo delle email viene "escapato".
- L'app registrata in Entra ID va limitata alla sola casella `MITTENTE` (passo 1 qui sotto).

Finché `api` in `HR_CONFIG` è vuoto la pagina funziona **in prova**: si compila e si vede l'anteprima delle email, ma non parte nulla.

## Attivazione (una volta, da amministratore Microsoft 365)

1. **Casella**: creare la casella condivisa `hr@siciet.it` (nome "SICIET HR") e dare al Responsabile del Personale l'accesso completo, per consultare la Posta inviata.
2. **Entra ID** → *Registrazioni app* → **Nuova registrazione** → nome `SICIET HR`, solo account di questa organizzazione, nessun URI di reindirizzamento:
   - *Certificati e segreti* → **Nuovo segreto client** (descrizione "Servizio", scadenza 24 mesi) → copiare subito il **Valore**. Annotare la scadenza: prima va creato un segreto nuovo e aggiornato `CLIENT_SECRET`.
   - *Autorizzazioni API* → **Aggiungi** → Microsoft Graph → **Autorizzazioni applicazione** → `Mail.ReadWrite` e `Mail.Send` → **Concedi consenso amministratore**.
   - **Limitare l'app alla sola casella HR** (altrimenti potrebbe scrivere da qualsiasi casella), da Exchange Online PowerShell:
     ```powershell
     Connect-ExchangeOnline
     New-DistributionGroup -Name "SICIET HR - app" -Type Security -Members hr@siciet.it
     New-ApplicationAccessPolicy -AppId <ID applicazione> -PolicyScopeGroupId "SICIET HR - app" -AccessRight RestrictAccess -Description "SICIET HR solo casella hr@"
     Test-ApplicationAccessPolicy -AppId <ID applicazione> -Identity hr@siciet.it        # Granted
     Test-ApplicationAccessPolicy -AppId <ID applicazione> -Identity paolo.censini@siciet.it   # Denied
     ```
     (In alternativa si possono usare i ruoli RBAC per le applicazioni di Exchange, `New-ManagementScope` + `New-ManagementRoleAssignment` con i ruoli "Application Mail.ReadWrite" e "Application Mail.Send", togliendo allora i permessi da Entra ID.)
3. **Cloudflare Workers** (stesso account di SICIET Quality):
   - *Workers e Pages* → **Crea** → **Inizia con Hello World** → nome `siciet-hr` → **Distribuisci**;
   - **Modifica codice** → cancellare il codice di esempio, incollare il contenuto di [`api/worker.js`](api/worker.js) (su GitHub: *Raw*, seleziona tutto, copia) → **Distribuisci**;
   - *Impostazioni → Variabili e segreti* → **Aggiungi** (tipo *Testo*, tranne `CLIENT_SECRET` e `PASSWORD` di tipo *Segreto*):
     | Nome | Valore |
     |---|---|
     | `TENANT_ID` | `5c055224-300a-4b03-8742-552b7dd79f62` |
     | `CLIENT_ID` | ID applicazione di SICIET HR |
     | `CLIENT_SECRET` | il valore del segreto client |
     | `MITTENTE` | `hr@siciet.it` |
     | `PASSWORD` | la password da dare al Responsabile del Personale |
     | `ESTERNI` | `m.fiorentini@cna-gr.it` |
     | `ORIGIN` | `https://hub.siciet.it` |
   - annotare l'indirizzo del worker (es. `https://siciet-hr.<nome-account>.workers.dev`).
4. In `hr.js` impostare `api: "https://<indirizzo del worker>/api"` e aumentare `?v=` in `index.html`.

Verifica: aprire `hub.siciet.it/hr`, inserire la password e fare una prova con i propri dati, magari mettendo temporaneamente solo il proprio indirizzo nei destinatari. Se la pagina risponde "Servizio non configurato" manca una variabile; "non può usare la casella" indica permessi o criterio di accesso dell'app (il criterio può impiegare fino a un'ora per attivarsi).

Quando si modifica `api/worker.js` va ricopiato su Cloudflare allo stesso modo. La funzione che scrive il testo delle email (`emailHtml`) è sia nel servizio sia in `hr.js` (per l'anteprima): se si cambia, cambiarla in entrambi.

## Limiti

- La password è unica e condivisa: chi la conosce può inviare comunicazioni di assunzione (solo ai destinatari ammessi). Va cambiata su Cloudflare se esce dall'ufficio del personale.
- Il servizio piano gratuito di Cloudflare basta ampiamente (poche assunzioni al mese).
- Gli allegati passano dal servizio e finiscono nelle email: se il server di posta del consulente accetta messaggi più piccoli di 20 MB, ridurre `maxTotaleMB` in `HR_CONFIG`.
- Le foto HEIC dell'iPhone vengono ridotte e convertite in JPEG solo se il browser sa leggerle (Safari sì); altrimenti partono così come sono.
- I dati restano nelle email: per un archivio strutturato (es. cartella SharePoint del dipendente o elenco Excel delle assunzioni) il servizio si può estendere come in SICIET Quality.

## Logo e icone

In [`icons/`](icons/): marchio SICIET con la scritta HR (stesso stile e gradiente blu → verde di SICIET Quality). `logo.png` è usato nell'intestazione, le altre sono le icone per la schermata Home e il browser.
