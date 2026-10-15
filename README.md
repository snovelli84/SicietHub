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
