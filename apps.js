/*
 * ELENCO APP DEL PORTALE SICIET HUB
 * ---------------------------------
 * Per aggiungere, modificare o rimuovere un'app basta intervenire su questo file.
 *
 * Campi disponibili:
 *   id           identificativo univoco (senza spazi)
 *   name         nome mostrato nella card
 *   description  breve descrizione dell'utilità
 *   category     categoria (usata per i filtri)
 *   emoji        icona di riserva se l'immagine non è disponibile
 *   icon         (opzionale) URL di un'immagine quadrata. Di norma NON serve:
 *                l'icona ufficiale viene presa in automatico dall'App Store
 *                usando l'ID contenuto nel link ios.store.
 *
 *   ios.scheme   URL scheme che apre l'app (es. "msteams://"). Se assente, si va direttamente all'App Store.
 *   ios.store    link alla pagina dell'App Store
 *
 *   android.package  package name dell'app su Google Play (es. "com.microsoft.teams")
 *   android.scheme   (opzionale) scheme dell'app, SENZA "://" (es. "msteams").
 *                    Se presente, l'app installata viene aperta direttamente;
 *                    se assente, si apre la pagina del Play Store, che mostra
 *                    il pulsante "Apri" se l'app è già installata.
 *
 *   web          (opzionale) versione web: da PC si apre direttamente.
 *                Se un'app ha SOLO "web" (niente ios/android), al tocco si apre
 *                direttamente il sito su qualsiasi dispositivo. Un indirizzo
 *                relativo (es. "richieste.html") è una pagina di questo portale
 *                e si apre nella stessa scheda.
 *   webSede      (opzionale) indirizzo web da usare quando si è nella rete
 *                aziendale (vedi SICIET_OFFICE_IPS), al posto di "web".
 *   iconStoreId  (opzionale) ID App Store da cui prendere l'icona ufficiale,
 *                utile per i servizi solo web che hanno comunque un'app.
 *
 *   desktop.scheme  (opzionale) indirizzo che apre il programma installato sul PC
 *                   (es. "msteams:"). Viene usato SOLO da PC e SOLO dentro la
 *                   rete aziendale (vedi SICIET_OFFICE_IPS); fuori sede si
 *                   apre la versione web, se c'è.
 *   desktop.name    (opzionale) nome del programma desktop, se diverso da "name"
 *   desktop.preferWeb (opzionale) true per aprire prima la versione web: in sede
 *                   il programma desktop resta disponibile come pulsante
 *   soloMobile   (opzionale) true per le app pensate solo per lo smartphone:
 *                da PC non vengono mostrate.
 *   soloDesktop  (opzionale) true per le app che esistono solo sul PC:
 *                su smartphone non vengono mostrate.
 *
 *   verified     true se lo scheme è documentato/testato, false se è un tentativo
 */

/*
 * IP pubblici della rete aziendale. Se il dispositivo esce su Internet con
 * uno di questi indirizzi è considerato "in sede": si aprono le app desktop
 * e si usa webSede (es. MailStore).
 * Tenere allineato con OFFICE_IPS di outlook/mailstore.html.
 */
window.SICIET_OFFICE_IPS = [
  "2.40.198.210"
];

window.SICIET_APPS = [
  {
    id: "perfetto",
    name: "MyPerfetto",
    description: "Inserimento Rapportini giornalieri su commessa",
    category: "Operatività",
    emoji: "📊",
    icon: "https://play-lh.googleusercontent.com/jQ2J1DkQmT1AyLmUgCqx0ZXNmLcVQs7iFmgTIgfs-ZI6kJ6aI4UNcAtmMSjCgdbNuLgKnIFcobB0z-Cxf0SZ=w240-h480-rw",
    // Scheme sconosciuto ("myperfetto://" testato: non funziona). Si apre la
    // pagina dello store, che mostra "Apri" se l'app è già installata.
    // Aggiungere qui ios.scheme / android.scheme quando Antos lo comunica.
    ios: {
      store: "https://apps.apple.com/it/app/my-perfetto/id1328294353"
    },
    android: {
      package: "it.antos.perfettoapp"
    },
    soloMobile: true,
    verified: false
  },
  {
    id: "mago4",
    name: "Mago4",
    description: "Gestionale Zucchetti Microarea.",
    category: "Operatività",
    emoji: "📦",
    // Programma installato sui PC, raggiungibile solo dalla rete aziendale.
    // Lo scheme "siciet-mago4:" va registrato sui PC: vedi desktop/protocolli-siciet.reg
    desktop: {
      scheme: "siciet-mago4:"
    },
    soloDesktop: true,
    verified: false
  },
  {
    id: "zconnect",
    name: "ZConnect",
    description: "Visualizzazione Cedolini Buste Paga",
    category: "Risorse umane",
    emoji: "💰",
    ios: {
      scheme: "zconnect://",
      store: "https://apps.apple.com/it/app/zconnect-enterprise-edition/id1254381259"
    },
    android: {
      package: "com.zucchetti.hr.hrsuite",
      scheme: "zconnect" // da verificare: se errato si apre il Play Store
    },
    // Da PC si apre il portale HR via web.
    web: "https://cnagrosseto.errepicloud.it/hrportal/jsp/login.jsp",
    verified: false
  },
  {
    id: "richieste",
    name: "Ferie e permessi",
    description: "Richiesta di ferie, permessi e donazione sangue: arriva via email agli addetti del personale.",
    category: "Risorse umane",
    emoji: "🗓️",
    // Pagina di questo portale: si apre nella stessa scheda.
    web: "richieste.html",
    verified: true
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Posta elettronica aziendale, calendario e contatti.",
    category: "Comunicazione",
    emoji: "📧",
    ios: {
      scheme: "ms-outlook://",
      store: "https://apps.apple.com/it/app/microsoft-outlook/id951937596"
    },
    android: {
      package: "com.microsoft.office.outlook",
      scheme: "ms-outlook"
    },
    web: "https://outlook.office.com/mail/",
    // Da PC si apre prima la versione web; in sede il pannello offre anche
    // Outlook classico (scheme "siciet-outlook:", vedi desktop/protocolli-siciet.reg).
    desktop: {
      scheme: "siciet-outlook:",
      preferWeb: true
    },
    verified: true
  },
  {
    id: "mailstore",
    name: "MailStore",
    description: "Archivio della posta aziendale: ricerca e consultazione delle email archiviate.",
    category: "Comunicazione",
    emoji: "🗄️",
    icon: "icons/mailstore.svg", // simbolo ricavato dal logo ufficiale MailStore
    // Solo web (MailStore Web Access). Raggiungibile da fuori solo da IP italiani.
    // In sede risponde solo sulla porta 8462 (fuori sede il firewall inoltra la 443).
    web: "https://mailstore.siciet.it",
    webSede: "https://mailstore.siciet.it:8462",
    verified: true
  },
  {
    id: "teams",
    name: "Teams",
    description: "Chat, chiamate e riunioni con colleghi e clienti.",
    category: "Comunicazione",
    emoji: "💬",
    ios: {
      scheme: "msteams://",
      store: "https://apps.apple.com/it/app/microsoft-teams/id1113153706"
    },
    android: {
      package: "com.microsoft.teams",
      scheme: "msteams"
    },
    web: "https://teams.microsoft.com/",
    desktop: {
      scheme: "msteams:"
    },
    verified: true
  },
  {
    id: "authpoint",
    name: "AuthPoint",
    description: "Autenticazione a più fattori (MFA) per accedere ai servizi aziendali.",
    category: "Sicurezza",
    emoji: "🔐",
    ios: {
      scheme: "authpoint://",
      store: "https://apps.apple.com/it/app/watchguard-authpoint/id1335115425"
    },
    android: {
      package: "com.watchguard.authpoint",
      scheme: "authpoint" // da verificare: se errato si apre il Play Store
    },
    soloMobile: true,
    verified: false
  },
  {
    id: "ninjaone",
    name: "NinjaOne",
    description: "Accesso remoto al PC",
    category: "IT",
    emoji: "🥷",
    web: "https://eu.ninjarmm.com/auth/#/mlogin?region=europe",
    iconStoreId: "1416138607", // icona dell'app NinjaOne Mobile
    verified: true
  },
  {
    id: "splashtop",
    name: "Splashtop SOS",
    description: "Assistenza remota sullo smartphone: apri l'app e comunica al tecnico il codice che compare.",
    category: "IT",
    emoji: "🛟",
    // Scheme non pubblicato da Splashtop: si apre la pagina dello store,
    // che mostra "Apri" se l'app è già installata.
    ios: {
      store: "https://apps.apple.com/it/app/splashtop-sos/id1230853703"
    },
    android: {
      package: "com.splashtop.sos"
    },
    soloMobile: true,
    verified: true
  }
];
