# SICIET HUB

Portale web con l'elenco delle app aziendali. Toccando un'app:

- **se è installata** sul telefono, viene aperta;
- **se non è installata**, l'utente viene portato allo store (App Store su iOS, Play Store su Android);
- **da PC** compare un pannello con la versione web (se esiste) e i link agli store.

Dopo il tocco compare sempre anche un pannello con i pulsanti "Apri" e "Scarica", come riserva nel caso l'apertura automatica non funzioni.

Il sito è statico (HTML/JS, nessun build): basta pubblicare la cartella su un qualsiasi hosting HTTPS (GitHub Pages, IIS, Apache, Azure Static Web Apps…).
I dipendenti possono aggiungerlo alla schermata Home ("Aggiungi a Home" su iOS / "Installa app" su Android): si apre a schermo intero come un'app.

## Aggiungere o modificare un'app

Tutto si configura in [`apps.js`](apps.js). Esempio:

```js
{
  id: "teams",
  name: "Teams",
  description: "Chat, chiamate e riunioni con colleghi e clienti.",
  category: "Comunicazione",
  emoji: "💬",
  ios:     { scheme: "msteams://", store: "https://apps.apple.com/it/app/microsoft-teams/id1113153706" },
  android: { package: "com.microsoft.teams", scheme: "msteams" },
  web: "https://teams.microsoft.com/",
  verified: true
}
```

- `android.package`: è il valore `id=` nell'indirizzo della pagina Play Store dell'app.
- `ios.store`: l'indirizzo della pagina App Store.
- Servizi solo web (es. NinjaOne): basta indicare `web` senza `ios`/`android`; al tocco si apre il sito su qualsiasi dispositivo. Con `iconStoreId` si può usare l'icona dell'eventuale app sull'App Store.
- Icona: viene presa in automatico dall'App Store (icona ufficiale), usando l'ID nel link `ios.store`. Viene salvata nel browser per 7 giorni. Se non è disponibile si usa l'`emoji`. Per forzare un'immagine diversa si può indicare `icon: "https://..."`.
- `scheme`: l'indirizzo "speciale" che apre l'app (es. `msteams://`). Va chiesto al fornitore dell'app o cercato nella sua documentazione.

## Come funziona (e limiti)

**Android** – Se lo scheme è noto si usa un link `intent://` con il package dell'app: Chrome e Samsung Internet aprono l'app se presente, altrimenti vanno direttamente al Play Store. È il metodo ufficiale e affidabile. Se lo scheme non è noto si apre la pagina Play Store, che mostra **Apri** se l'app è già installata o **Installa** se non lo è.

**iOS** – Apple non permette a una pagina web di sapere se un'app è installata. La pagina prova ad aprire lo scheme dell'app; se dopo 2,5 secondi la pagina è ancora visibile, va all'App Store (dove comunque compare **Apri** se l'app c'è). Safari può chiedere conferma ("Aprire in Teams?") o mostrare un avviso di indirizzo non valido se l'app manca: è un comportamento di iOS, non eliminabile.

**Scheme da verificare** – Per Teams e Outlook gli scheme sono documentati. Per MyPerfetto, ZConnect e AuthPoint gli scheme iOS sono tentativi (`verified: false`): se non funzionano, l'utente finisce comunque sull'App Store. Lo stesso tentativo è usato su Android: se lo scheme è sbagliato Chrome apre il Play Store (con il pulsante **Apri**), quindi non ci sono effetti negativi. Gli scheme corretti vanno chiesti ai fornitori (Zucchetti, WatchGuard, Perfetto).

## Pulsante MailStore in Outlook

La cartella [`outlook/`](outlook/) contiene un componente aggiuntivo di Outlook che aggiunge il pulsante **MailStore** in Outlook Web e nel nuovo Outlook. Il pulsante apre un pannello con il collegamento a MailStore Web Access (`https://mailstore.siciet.it`). È un semplice collegamento: non richiede certificati o porte aperte su MailStore, perché il pannello è ospitato su questo sito.

Installazione (una volta, da amministratore):

1. Interfaccia di amministrazione di Microsoft 365 → **Impostazioni → App integrate → Carica app personalizzate**.
2. Tipo di app: **Componente aggiuntivo di Office**; caricare il file `outlook/manifest.xml` (o indicare `https://hub.siciet.it/outlook/manifest.xml`).
3. Assegnare l'app a tutta l'organizzazione o a un gruppo e confermare. Può servire fino a qualche ora prima che compaia.

Uso: aprire un messaggio in Outlook → **App** (o i "…" della barra del messaggio) → **MailStore** → **Apri archivio MailStore**.

Se si modifica `manifest.xml` aumentare `<Version>`, senza cambiare `<Id>`.

## Richiesta ferie e permessi

L'app **Ferie e permessi** (categoria Risorse umane, definita in `apps.js` come le altre) apre [`richieste.html`](richieste.html): un modulo con nome, cognome ed email del dipendente (obbligatoria, anche personale), una o più voci (Ferie, Permesso, Permesso L.104, Donazione sangue, Altro; ciascuna a giornate intere o a ore) e note. Con **+ Aggiungi un'altra voce** si chiedono più periodi o permessi diversi nella stessa richiesta (fino a 10): nell'email le voci sono in ordine di data, con il totale di giorni e ore. All'invio la richiesta arriva via email agli addetti del personale. Non serve un account o un'email aziendale: nome, cognome ed email restano memorizzati sul dispositivo per le richieste successive.

**Invio delle email** – Il sito è statico, quindi le email le spedisce [EmailJS](https://www.emailjs.com) (gratuito fino a 200 invii al mese), collegato alla casella Microsoft 365 dedicata agli invii. Le credenziali della casella restano su EmailJS; nella pagina ci sono solo tre codici pubblici, in `RICHIESTE_CONFIG` all'inizio dello script di `richieste.html`:

- `serviceId` (`siciet_hub`): la casella collegata, in *Email Services*;
- `templateId` (`richiesta_ferie`): il modello della email, in *Email Templates*;
- `publicKey`: in *Account → General*.

Il servizio `siciet_hub` è di tipo **SMTP server** (`smtp.office365.com`, porta 587) con la casella dedicata agli invii. Le email escono come **SICIET HUB** da una casella condivisa generica (`From Email` nel modello), su cui la casella degli invii ha il permesso **Invia come**: così non compare l'indirizzo di una persona.

Destinatari, mittente, oggetto e testo si cambiano nel modello su EmailJS, senza toccare il sito. Il campo **To Email** del modello deve contenere indirizzi fissi, mai una variabile `{{…}}`: altrimenti il modulo potrebbe essere usato per mandare email ad altri indirizzi dalla casella aziendale. Per lo stesso motivo `{{email}}` va usata solo in **Reply To** (così rispondendo si scrive al dipendente) e mai in CC o BCC. Il modulo passa al modello le variabili `{{subject}}`, `{{dipendente}}`, `{{email}}`, `{{voci}}` (una voce per riga: nel modello va dentro un `<pre>`), `{{totale}}`, `{{note}}` e `{{inviata_il}}`.

Nello stesso punto di `richieste.html` si possono cambiare i tipi di richiesta (`tipi`) e quelli proposti a ore (`tipiAOre`). Se uno dei tre codici è vuoto il modulo funziona in prova: mostra il riepilogo ma non invia nulla.

**Allegato .ics (opzionale)** – Con `allegatoIcs: true` in `RICHIESTE_CONFIG` ogni email porta in allegato un file `.ics` con tutte le voci (variabile `{{ics}}`, creata da [`calendar.js`](calendar.js)). Richiede un piano EmailJS a pagamento: nel modello, scheda **Attachments**, allegato di tipo **Variable Attachment**, parametro `ics`, nome file `richiesta.ics`, tipo `text/calendar`. Con il piano gratuito resta disattivato e si usa il pulsante qui sotto.

**Aggiungi al calendario** – La email contiene il pulsante **Aggiungi al calendario**, che apre [`calendario.html`](calendario.html) con le voci della richiesta. Per ogni voce: **Aggiungi a Outlook** apre Outlook sul web / nuovo Outlook con l'evento compilato (titolo "Tipo – Cognome Nome"), **Scarica .ics** crea il file per Outlook classico (evento segnato come Disponibile); con più voci **Scarica tutti (.ics)** crea un unico file. I dati viaggiano nel link dopo `#` (variabile `{{calendario}}`, codificata dal modulo); la pagina li controlla e li mostra solo come testo. Nel modello EmailJS l'indirizzo del pulsante è fisso:

```html
<p><a href="https://hub.siciet.it/calendario.html#{{calendario}}" style="display:inline-block;background:#005baa;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px">Aggiungi al calendario</a></p>
```

**Limiti** – Il modulo non verifica chi lo compila: chiunque abbia il link può inviare una richiesta con qualsiasi nome. Gli addetti devono quindi considerare l'email come una segnalazione da confermare con il dipendente. I giorni lavorativi indicati contano lunedì–venerdì e non tengono conto delle festività.
