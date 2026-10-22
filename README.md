# SICIET HUB

Portale web con l'elenco delle app aziendali. Toccando un'app:

- **se è installata** sul telefono, viene aperta;
- **se non è installata**, l'utente viene portato allo store (App Store su iOS, Play Store su Android);
- **da PC in sede** (rete aziendale) si apre il programma installato sul PC, se configurato (es. Teams, Mago4; per Outlook prima la versione web, poi l'app);
- **da PC fuori sede** si apre la versione web (se esiste), altrimenti un pannello con i link agli store.

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
- `desktop.scheme`: l'indirizzo che apre il programma sul PC (es. `msteams:`). Si usa solo da PC in sede. `desktop.name` serve se il programma ha un nome diverso (es. MyPerfetto da PC apre Mago4).
- `scheme`: l'indirizzo "speciale" che apre l'app (es. `msteams://`). Va chiesto al fornitore dell'app o cercato nella sua documentazione.

## Come funziona (e limiti)

**Android** – Se lo scheme è noto si usa un link `intent://` con il package dell'app: Chrome e Samsung Internet aprono l'app se presente, altrimenti vanno direttamente al Play Store. È il metodo ufficiale e affidabile. Se lo scheme non è noto si apre la pagina Play Store, che mostra **Apri** se l'app è già installata o **Installa** se non lo è.

**iOS** – Apple non permette a una pagina web di sapere se un'app è installata. La pagina prova ad aprire lo scheme dell'app; se dopo 2,5 secondi la pagina è ancora visibile, va all'App Store (dove comunque compare **Apri** se l'app c'è). Safari può chiedere conferma ("Aprire in Teams?") o mostrare un avviso di indirizzo non valido se l'app manca: è un comportamento di iOS, non eliminabile.

**Scheme da verificare** – Per Teams e Outlook gli scheme sono documentati. Per MyPerfetto, ZConnect e AuthPoint gli scheme iOS sono tentativi (`verified: false`): se non funzionano, l'utente finisce comunque sull'App Store. Lo stesso tentativo è usato su Android: se lo scheme è sbagliato Chrome apre il Play Store (con il pulsante **Apri**), quindi non ci sono effetti negativi. Gli scheme corretti vanno chiesti ai fornitori (Zucchetti, WatchGuard, Perfetto).

## App desktop dalla rete aziendale

**Come si riconosce la sede** – Da PC la pagina chiede il proprio IP pubblico a `api.ipify.org` e lo confronta con `SICIET_OFFICE_IPS` in [`apps.js`](apps.js). Se l'IP della sede cambia (o si aggiunge una sede), va aggiornata quella lista. Chi lavora in VPN risulta "in sede" solo se la VPN fa uscire anche il traffico Internet dalla sede. Se il controllo non risponde entro 3 secondi, il PC è considerato fuori sede.

**Configurazione dei PC** – Il file [`desktop/protocolli-siciet.reg`](desktop/protocolli-siciet.reg) (da distribuire via GPO o Intune):

1. registra lo scheme `siciet-mago4:`, che apre con Esplora risorse il collegamento ClickOnce di Mago4 in `C:\ProgramData\SICIET\Mago4.appref-ms`. Quel file va copiato sui PC (è il collegamento "Microarea Mago4 (Sicietw19appli)" del desktop, uguale per tutti; via GPO: *Preferenze → File*). Non si usano cmd o PowerShell perché Sophos blocca un browser che li avvia;
2. registra lo scheme `siciet-outlook:`, che apre Outlook classico di Microsoft 365 (`OUTLOOK.EXE` in `C:\Program Files\Microsoft Office\root\Office16`);
3. imposta la policy di Edge e Chrome `AutoLaunchProtocolsFromOrigins`, così il browser non chiede "Aprire Microsoft Teams?" ogni volta, solo per `https://hub.siciet.it`.

Con lo stesso schema si può far aprire qualsiasi programma: si sceglie uno scheme (es. `siciet-nomeprogramma:`), lo si registra nel `.reg` e lo si indica in `desktop.scheme`.

**Limiti** – Il browser non dice se il programma si è aperto davvero: per questo dopo il click compare sempre un pannello con "Apri" e "Apri versione web" come riserva. Teams (`msteams:`) è documentato. Per Outlook si apre prima la versione web; in sede il pannello offre anche Outlook classico (`desktop.preferWeb`).

## Pulsante MailStore in Outlook

La cartella [`outlook/`](outlook/) contiene un componente aggiuntivo di Outlook che aggiunge il pulsante **MailStore** in Outlook Web e nel nuovo Outlook. Il pulsante apre un pannello con il collegamento a MailStore Web Access (`https://mailstore.siciet.it`). È un semplice collegamento: non richiede certificati o porte aperte su MailStore, perché il pannello è ospitato su questo sito.

Installazione (una volta, da amministratore):

1. Interfaccia di amministrazione di Microsoft 365 → **Impostazioni → App integrate → Carica app personalizzate**.
2. Tipo di app: **Componente aggiuntivo di Office**; caricare il file `outlook/manifest.xml` (o indicare `https://hub.siciet.it/outlook/manifest.xml`).
3. Assegnare l'app a tutta l'organizzazione o a un gruppo e confermare. Può servire fino a qualche ora prima che compaia.

Uso: aprire un messaggio in Outlook → **App** (o i "…" della barra del messaggio) → **MailStore** → **Apri archivio MailStore**.

Se si modifica `manifest.xml` aumentare `<Version>`, senza cambiare `<Id>`.

## Richiesta ferie e permessi

Il pulsante **Richiesta ferie e permessi** in cima al portale apre [`richieste.html`](richieste.html): un modulo con nome e cognome, una o più voci (Ferie, Permesso, Permesso L.104, Donazione sangue, Altro; ciascuna a giornate intere o a ore) e note. Con **+ Aggiungi un'altra voce** si chiedono più periodi o permessi diversi nella stessa richiesta (fino a 10): nell'email le voci sono in ordine di data, con il totale di giorni e ore. All'invio la richiesta arriva via email agli addetti del personale. Non serve un account o un'email aziendale: nome e cognome restano memorizzati sul dispositivo per le richieste successive.

**Invio delle email** – Il sito è statico, quindi per spedire le email si usa [Web3Forms](https://web3forms.com) (gratuito fino a 250 invii al mese):

1. su web3forms.com inserire l'indirizzo a cui devono arrivare le richieste e premere **Create Access Key**: la chiave arriva via email a quell'indirizzo. Per farle arrivare a più addetti conviene usare un gruppo o una casella condivisa di Microsoft 365;
2. copiare la chiave in `accessKey` all'inizio dello script di `richieste.html` (`RICHIESTE_CONFIG`). La chiave non è una password: può stare in una pagina pubblica, permette solo di mandare email a quell'indirizzo;
3. nello stesso punto si possono cambiare i tipi di richiesta (`tipi`) e quelli proposti a ore (`tipiAOre`).

Finché `accessKey` è vuota il modulo funziona in prova: mostra il riepilogo ma non invia nulla.

**Limiti** – Il modulo non verifica chi lo compila: chiunque abbia il link può inviare una richiesta con qualsiasi nome. Gli addetti devono quindi considerare l'email come una segnalazione da confermare con il dipendente. I giorni lavorativi indicati contano lunedì–venerdì e non tengono conto delle festività.
