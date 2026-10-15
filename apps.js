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
 *   web          (opzionale) versione web, usata da PC o come alternativa.
 *                Se un'app ha SOLO "web" (niente ios/android), al tocco si apre
 *                direttamente il sito su qualsiasi dispositivo.
 *   iconStoreId  (opzionale) ID App Store da cui prendere l'icona ufficiale,
 *                utile per i servizi solo web che hanno comunque un'app.
 *
 *   desktop.scheme  (opzionale) indirizzo che apre il programma installato sul PC
 *                   (es. "msteams:"). Viene usato SOLO da PC e SOLO dentro la
 *                   rete aziendale (vedi SICIET_OFFICE_IPS); fuori sede si
 *                   apre la versione web, se c'è.
 *   desktop.name    (opzionale) nome del programma desktop, se diverso da "name"
 *
 *   verified     true se lo scheme è documentato/testato, false se è un tentativo
 */

/*
 * IP pubblici della rete aziendale. Se il PC esce su Internet con uno di
 * questi indirizzi è considerato "in sede" e si aprono le app desktop.
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
    // Da PC in sede si apre invece Mago4 (Zucchetti Microarea). Lo scheme
    // "siciet-mago4:" va registrato sui PC: vedi desktop/protocolli-siciet.reg
    desktop: {
      scheme: "siciet-mago4:",
      name: "Mago4"
    },
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
    // "ms-outlook:" è registrato dal nuovo Outlook per Windows; per Outlook
    // classico va registrato a mano (vedi desktop/protocolli-siciet.reg).
    desktop: {
      scheme: "ms-outlook:"
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
    web: "https://mailstore.siciet.it",
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
  }
];
