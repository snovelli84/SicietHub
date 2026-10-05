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
- Icona: viene presa in automatico dall'App Store (icona ufficiale), usando l'ID nel link `ios.store`. Viene salvata nel browser per 7 giorni. Se non è disponibile si usa l'`emoji`. Per forzare un'immagine diversa si può indicare `icon: "https://..."`.
- `scheme`: l'indirizzo "speciale" che apre l'app (es. `msteams://`). Va chiesto al fornitore dell'app o cercato nella sua documentazione.

## Come funziona (e limiti)

**Android** – Se lo scheme è noto si usa un link `intent://` con il package dell'app: Chrome e Samsung Internet aprono l'app se presente, altrimenti vanno direttamente al Play Store. È il metodo ufficiale e affidabile. Se lo scheme non è noto si apre la pagina Play Store, che mostra **Apri** se l'app è già installata o **Installa** se non lo è.

**iOS** – Apple non permette a una pagina web di sapere se un'app è installata. La pagina prova ad aprire lo scheme dell'app; se dopo 2,5 secondi la pagina è ancora visibile, va all'App Store (dove comunque compare **Apri** se l'app c'è). Safari può chiedere conferma ("Aprire in Teams?") o mostrare un avviso di indirizzo non valido se l'app manca: è un comportamento di iOS, non eliminabile.

**Scheme da verificare** – Per Teams e Outlook gli scheme sono documentati. Per PerfettoApp, ZConnect e AuthPoint gli scheme iOS sono tentativi (`verified: false`): se non funzionano, l'utente finisce comunque sull'App Store. Su Android, per queste tre app, si apre la pagina del Play Store finché non si aggiunge `android.scheme`.
