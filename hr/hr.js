/*
 * SICIET HR – NUOVE ASSUNZIONI
 * ----------------------------
 * Il Responsabile del Personale compila il modulo e allega i documenti; la pagina
 * prepara una email per ciascun gruppo di destinatari (consulente del lavoro,
 * amministrazione, sicurezza…) con i soli dati e documenti di sua competenza,
 * e le fa spedire dal servizio in api/worker.js. Vedi hr/README.md.
 *
 * Tutto quello che si cambia di solito è in HR_CONFIG qui sotto: destinatari,
 * cosa riceve ciascuno, testi delle email, elenchi proposti nel modulo.
 * Dopo ogni modifica aumentare ?v= di hr.js in index.html.
 */

const HR_CONFIG = {
  // Indirizzo del servizio (Cloudflare Worker). Vuoto = modalità prova: si vede
  // l'anteprima delle email ma non parte nulla.
  api: "",

  // Società che assumono. "breve" va nell'oggetto e nel testo delle email.
  societa: [
    { nome: "S.I.C.I.E.T. s.r.l.", breve: "SICIET" }
  ],

  // Firma aziendale in fondo alle email, sotto i dati di chi compila.
  firmaAzienda: [
    "S.I.C.I.E.T. s.r.l.",
    "Via Puglia, 6 - Fraz. Albinia - 58015 Orbetello (GR)",
    "Tel. +39 0564 870512 · https://www.siciet.it · info@siciet.it"
  ],

  // Oggetto delle email. Segnaposto: {societa} {cognome} {nome} {dataInizio}
  oggetto: "Assunzione {societa} – {cognome} {nome} – dal {dataInizio}",

  /*
   * DESTINATARI – un'email per gruppo, sempre tutti (così nessuno viene dimenticato).
   *   sezioni:    le parti del modulo che il gruppo riceve (vedi SEZIONI più sotto)
   *   riservati:  true = riceve anche retribuzione e accordi economici
   *   documenti:  "tutti", nessuno ([]) o l'elenco delle categorie (vedi DOCUMENTI)
   *   intro:      paragrafi iniziali. Segnaposto: {societa} {nominativo} {dataInizio} {richieste}
   *   chiusura:   paragrafi finali (una riga vuota se un segnaposto resta vuoto la toglie)
   * Gli indirizzi esterni (es. consulente) vanno aggiunti anche a ESTERNI nel servizio.
   */
  destinatari: [
    {
      id: "consulente",
      gruppo: "Consulente del lavoro",
      persone: [{ nome: "Massimo Fiorentini", email: "m.fiorentini@cna-gr.it" }],
      sezioni: ["persona", "anagrafica", "residenza", "contatti", "busta", "contratto", "richieste", "note"],
      riservati: true,
      documenti: "tutti",
      intro: ["Massimo buongiorno,", "per favore, provvedi per l'assunzione {societa} di:"],
      chiusura: ["Quando possibile, per favore, fammi avere {richieste}.", "Grazie"]
    },
    {
      id: "direzione",
      gruppo: "Direzione",
      persone: [
        { nome: "Vincenzo Picciolini", email: "vincenzo.picciolini@siciet.it" },
        { nome: "Simona Picciolini", email: "simona.picciolini@siciet.it" }
      ],
      sezioni: ["persona", "anagrafica", "contatti", "contratto", "sicurezza", "dotazioni", "note"],
      riservati: true,
      documenti: [],
      intro: ["Buongiorno,", "vi comunico la nuova assunzione {societa} di:"],
      chiusura: []
    },
    {
      id: "amministrazione",
      gruppo: "Amministrazione",
      persone: [{ nome: "Valeria Capaldi", email: "valeria.capaldi@siciet.it" }],
      sezioni: ["persona", "anagrafica", "residenza", "contatti", "busta", "contratto", "note"],
      riservati: true,
      documenti: [],
      intro: ["Buongiorno,", "vi comunico la nuova assunzione {societa} di:"],
      chiusura: []
    },
    {
      id: "personale",
      gruppo: "Ufficio personale",
      persone: [{ nome: "Daniela Ugrani", email: "daniela.ugrani@siciet.it" }],
      sezioni: ["persona", "contatti", "contratto", "dotazioni", "note"],
      riservati: false,
      documenti: [],
      intro: ["Buongiorno,", "vi comunico la nuova assunzione {societa} di:"],
      chiusura: []
    },
    {
      id: "sicurezza",
      gruppo: "Sicurezza (RSPP)",
      persone: [{ nome: "Daniele Morini", email: "sicurezza@siciet.it" }],
      sezioni: ["persona", "anagrafica", "contatti", "contratto", "sicurezza", "note"],
      riservati: false,
      documenti: ["attestati", "patente"],
      intro: ["Buongiorno,", "nuova assunzione {societa}: per favore, organizza visita medica preventiva, formazione e DPI per:"],
      chiusura: []
    },
    {
      id: "it",
      gruppo: "IT",
      persone: [{ nome: "Simone Novelli", email: "simone.novelli@siciet.it" }],
      sezioni: ["persona", "contatti", "contratto", "dotazioni", "note"],
      riservati: false,
      documenti: [],
      intro: ["Buongiorno,", "nuova assunzione {societa}: per favore, prepara account e dotazioni indicate entro il {dataInizio} per:"],
      chiusura: []
    },
    {
      id: "hr",
      gruppo: "Responsabile del Personale (copia completa)",
      persone: [{ nome: "Paolo Censini", email: "paolo.censini@siciet.it" }],
      sezioni: "tutte",
      riservati: true,
      documenti: "tutti",
      intro: ["Copia completa della comunicazione di assunzione {societa} di:"],
      chiusura: []
    }
  ],

  // Elenchi proposti nel modulo (si può sempre scrivere altro).
  ccnl: [
    "CCNL Metalmeccanica Industria",
    "CCNL Metalmeccanica PMI (Confapi)",
    "CCNL Edilizia Industria",
    "CCNL Commercio Terziario",
    "CCNL Elettrici"
  ],
  luoghi: ["Sede di Albinia e cantieri SICIET", "Sede di Albinia", "Cantieri SICIET"],

  // Limiti degli allegati (la email al consulente li contiene tutti).
  maxFileMB: 15,
  maxTotaleMB: 20,
  // Le foto più grandi di così vengono ridotte (lato massimo 2400 px, JPEG).
  riduciFotoOltreMB: 1.5
};

/* ---------- Struttura del modulo ---------- */

// Parti del modulo: ogni parte diventa una tabella nelle email di chi la riceve.
const SEZIONI = [
  { id: "persona",    titolo: "Dipendente" },
  { id: "anagrafica", titolo: "Dati anagrafici" },
  { id: "residenza",  titolo: "Residenza e domicilio" },
  { id: "contatti",   titolo: "Contatti" },
  { id: "busta",      titolo: "Dati per la busta paga" },
  { id: "contratto",  titolo: "Contratto" },
  { id: "richieste",  titolo: "Richieste al consulente del lavoro" },
  { id: "sicurezza",  titolo: "Sicurezza e DPI" },
  { id: "dotazioni",  titolo: "Account e dotazioni" },
  { id: "note",       titolo: "Note" }
];

const extraUE = d => d.cittadinanza === "Paese extra UE";
const aTermine = d => /determinato|Tirocinio|Somministrazione/.test(d.tipoContratto || "");
const partTime = d => d.orario === "Part-time";

/*
 * Campi. tipo: text, email, tel, date, number, select, choice (un valore),
 * checks (più valori), textarea. req: true o funzione(dati). se: mostra il campo
 * solo se funzione(dati) è vera. riservato: solo per i gruppi con riservati: true.
 * largo: occupa tutta la riga.
 */
const CAMPI = [
  // Dipendente
  { id: "cognome", sez: "persona", label: "Cognome", tipo: "text", req: true, maiuscolo: true, auto: "family-name" },
  { id: "nome", sez: "persona", label: "Nome", tipo: "text", req: true, auto: "given-name" },
  { id: "sesso", sez: "persona", label: "Sesso", tipo: "choice", req: true, opzioni: ["M", "F"] },

  // Anagrafica
  { id: "dataNascita", sez: "anagrafica", label: "Data di nascita", tipo: "date", req: true },
  { id: "luogoNascita", sez: "anagrafica", label: "Luogo di nascita", tipo: "text", req: true, hint: "Comune o città estera" },
  { id: "provNascita", sez: "anagrafica", label: "Provincia o Stato di nascita", tipo: "text", req: true, hint: "Sigla della provincia (es. GR) o Stato estero" },
  { id: "codiceFiscale", sez: "anagrafica", label: "Codice fiscale", tipo: "text", req: true, maiuscolo: true, controllo: "cf" },
  { id: "cittadinanza", sez: "anagrafica", label: "Cittadinanza", tipo: "choice", req: true, opzioni: ["Italiana", "Altro Paese UE", "Paese extra UE"] },
  { id: "statoCittadinanza", sez: "anagrafica", label: "Stato di cittadinanza", tipo: "text", req: true, se: d => d.cittadinanza && d.cittadinanza !== "Italiana" },
  { id: "permessoTipo", sez: "anagrafica", label: "Permesso di soggiorno – tipo", tipo: "select", req: true, se: extraUE,
    opzioni: ["Lavoro subordinato", "Motivi familiari", "Protezione internazionale / speciale", "Studio", "Soggiornante UE di lungo periodo", "Carta di soggiorno (familiare cittadino UE)", "Ricevuta di richiesta / rinnovo", "Altro"] },
  { id: "permessoNumero", sez: "anagrafica", label: "Permesso di soggiorno – numero", tipo: "text", req: true, se: extraUE, maiuscolo: true },
  { id: "permessoScadenza", sez: "anagrafica", label: "Permesso di soggiorno – scadenza", tipo: "date", se: extraUE,
    req: d => extraUE(d) && d.permessoTipo !== "Soggiornante UE di lungo periodo", hint: "Vuoto se a tempo indeterminato" },
  { id: "titoloStudio", sez: "anagrafica", label: "Titolo di studio", tipo: "select", req: true,
    opzioni: ["Nessuno / licenza elementare", "Licenza media", "Qualifica professionale", "Diploma", "Laurea triennale", "Laurea magistrale / a ciclo unico", "Titolo estero"] },
  { id: "titoloDettaglio", sez: "anagrafica", label: "Titolo di studio – dettaglio", tipo: "text", hint: "es. Diploma di perito elettrotecnico", largo: true },
  { id: "statoCivile", sez: "anagrafica", label: "Stato civile", tipo: "select", opzioni: ["Celibe / nubile", "Coniugato/a", "Unito/a civilmente", "Separato/a", "Divorziato/a", "Vedovo/a"] },

  // Residenza
  { id: "indirizzo", sez: "residenza", label: "Indirizzo di residenza", tipo: "text", req: true, largo: true, hint: "Via e numero civico", auto: "street-address" },
  { id: "cap", sez: "residenza", label: "CAP", tipo: "text", req: true, controllo: "cap", auto: "postal-code" },
  { id: "comune", sez: "residenza", label: "Comune", tipo: "text", req: true },
  { id: "provincia", sez: "residenza", label: "Provincia", tipo: "text", req: true, maiuscolo: true, controllo: "prov", hint: "Sigla, es. GR" },
  { id: "domicilio", sez: "residenza", label: "Domicilio, se diverso dalla residenza", tipo: "textarea", largo: true },

  // Contatti
  { id: "telefono", sez: "contatti", label: "Telefono", tipo: "tel", req: true, controllo: "tel" },
  { id: "emailPersonale", sez: "contatti", label: "Email personale", tipo: "email", req: true, controllo: "email" },

  // Busta paga
  { id: "iban", sez: "busta", label: "IBAN per lo stipendio", tipo: "text", maiuscolo: true, controllo: "iban", largo: true,
    avviso: "Senza IBAN il consulente dovrà chiederlo in seguito." },
  { id: "intestatarioIban", sez: "busta", label: "Intestatario del conto, se diverso", tipo: "text", largo: true },
  { id: "detrazioni", sez: "busta", label: "Detrazioni per familiari a carico", tipo: "choice", req: true, opzioni: ["Sì", "No", "Da verificare con il dipendente"] },
  { id: "familiari", sez: "busta", label: "Familiari a carico", tipo: "textarea", largo: true,
    hint: "Nome, codice fiscale, grado di parentela, percentuale", se: d => d.detrazioni === "Sì", req: d => d.detrazioni === "Sì" },

  // Contratto
  { id: "societa", sez: "contratto", label: "Società", tipo: "select", req: true, opzioni: () => HR_CONFIG.societa.map(s => s.nome) },
  { id: "tipoContratto", sez: "contratto", label: "Tipo di contratto", tipo: "select", req: true,
    opzioni: ["Tempo indeterminato", "Tempo determinato", "Apprendistato professionalizzante", "Tirocinio / stage", "Lavoro intermittente", "Somministrazione"] },
  { id: "dataInizio", sez: "contratto", label: "Data di inizio", tipo: "date", req: true },
  { id: "dataFine", sez: "contratto", label: "Data di fine", tipo: "date", req: aTermine, se: d => d.tipoContratto !== "Tempo indeterminato",
    hint: "Per l'apprendistato: fine del periodo formativo" },
  { id: "orario", sez: "contratto", label: "Orario", tipo: "choice", req: true, opzioni: ["Tempo pieno", "Part-time"] },
  { id: "oreSettimanali", sez: "contratto", label: "Ore settimanali", tipo: "number", req: true, se: partTime },
  { id: "distribuzioneOrario", sez: "contratto", label: "Distribuzione dell'orario", tipo: "text", se: partTime, hint: "es. lun–ven 8:00–12:00", largo: true },
  { id: "ccnl", sez: "contratto", label: "CCNL", tipo: "text", req: true, suggerimenti: () => HR_CONFIG.ccnl, largo: true },
  { id: "categoria", sez: "contratto", label: "Categoria", tipo: "choice", req: true, opzioni: ["Operaio", "Impiegato", "Quadro"] },
  { id: "livello", sez: "contratto", label: "Livello", tipo: "text", req: true, maiuscolo: true, hint: "es. D2" },
  { id: "qualifica", sez: "contratto", label: "Qualifica / mansione", tipo: "text", req: true, hint: "es. Impiegato tecnico", largo: true },
  { id: "luogoLavoro", sez: "contratto", label: "Luogo di lavoro", tipo: "text", req: true, suggerimenti: () => HR_CONFIG.luoghi, largo: true },
  { id: "reparto", sez: "contratto", label: "Reparto / ufficio", tipo: "text" },
  { id: "responsabile", sez: "contratto", label: "Responsabile diretto", tipo: "text" },
  { id: "periodoProva", sez: "contratto", label: "Periodo di prova", tipo: "text", hint: "Vuoto = come da CCNL", riservato: true },
  { id: "retribuzione", sez: "contratto", label: "Retribuzione", tipo: "text", hint: "Vuoto = minimi del CCNL; altrimenti lordo mensile o annuo", riservato: true, largo: true },
  { id: "accordi", sez: "contratto", label: "Superminimo, indennità e altri accordi", tipo: "textarea", riservato: true, largo: true },

  // Richieste al consulente
  { id: "richieste", sez: "richieste", label: "Da predisporre", tipo: "checks", opzioni: ["Contratto", "UNILAV", "Costo aziendale"], predefinito: ["Contratto", "UNILAV", "Costo aziendale"], largo: true },
  { id: "noteConsulente", sez: "richieste", label: "Note per il consulente", tipo: "textarea", largo: true },

  // Sicurezza
  { id: "visitaMedica", sez: "sicurezza", label: "Visita medica preventiva", tipo: "choice", req: true, opzioni: ["Da prenotare", "Già effettuata", "Non necessaria"] },
  { id: "formazione", sez: "sicurezza", label: "Formazione sicurezza", tipo: "choice", req: true, opzioni: ["Da organizzare", "Ha già attestati validi (allegati)"] },
  { id: "attivita", sez: "sicurezza", label: "Attività svolte e rischi", tipo: "textarea", largo: true, hint: "es. lavori in quota, cantieri, guida mezzi, ufficio/videoterminale" },
  { id: "tagliaAbiti", sez: "sicurezza", label: "Taglia abiti da lavoro", tipo: "text" },
  { id: "numeroScarpe", sez: "sicurezza", label: "Numero scarpe", tipo: "text" },
  { id: "patente", sez: "sicurezza", label: "Patenti e abilitazioni", tipo: "text", largo: true, hint: "es. B, C, CQC, PLE, carrello elevatore" },

  // Dotazioni
  { id: "dotazioni", sez: "dotazioni", label: "Da preparare", tipo: "checks", largo: true,
    opzioni: ["Email aziendale", "PC / notebook", "Smartphone aziendale", "SIM / numero aziendale", "Accesso Mago4", "Rilevazione presenze (ZConnect)", "VPN", "Badge / chiavi", "Auto / mezzo aziendale"] },
  { id: "noteDotazioni", sez: "dotazioni", label: "Note su account e dotazioni", tipo: "textarea", largo: true },

  // Note
  { id: "noteGenerali", sez: "note", label: "Note per tutti i destinatari", tipo: "textarea", largo: true }
];

// Categorie di documenti. req: true o funzione(dati).
const DOCUMENTI = [
  { id: "identita", nome: "Documento di identità", req: true, hint: "Fronte e retro" },
  { id: "cf", nome: "Codice fiscale / tessera sanitaria", req: true },
  { id: "permesso", nome: "Permesso di soggiorno", req: extraUE, se: extraUE, hint: "Fronte e retro (o ricevuta della richiesta)" },
  { id: "titolo", nome: "Titolo di studio" },
  { id: "iban", nome: "Coordinate bancarie (IBAN)" },
  { id: "cv", nome: "Curriculum vitae" },
  { id: "attestati", nome: "Attestati di formazione / sicurezza", req: d => /attestati/.test(d.formazione || "") },
  { id: "patente", nome: "Patente / abilitazioni" },
  { id: "altro", nome: "Altri documenti" }
];

/* ---------- Utilità ---------- */

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MB = 1024 * 1024;
const LIMITE_BASE64 = 3 * MB; // come nel servizio
const CHIAVE_COMPILATORE = "siciet-hr-compilatore";
const CHIAVE_BOZZA = "siciet-hr-bozza";
const CHIAVE_PASSWORD = "siciet-hr-password";

function memoria(tipo){
  try{ return window[tipo]; }catch(_){ return null; }
}
function leggi(chiave, tipo){
  try{ const s = memoria(tipo || "localStorage"); return s ? JSON.parse(s.getItem(chiave) || "null") : null; }catch(_){ return null; }
}
function scrivi(chiave, valore, tipo){
  try{
    const s = memoria(tipo || "localStorage");
    if(!s) return;
    if(valore === null) s.removeItem(chiave); else s.setItem(chiave, JSON.stringify(valore));
  }catch(_){ /* memoria del browser non disponibile */ }
}
function dataIt(v){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  return m ? m[3] + "/" + m[2] + "/" + m[1] : (v || "");
}
function dimensione(n){
  return n >= MB ? (n / MB).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
function valoreReq(r, d){ return typeof r === "function" ? !!r(d) : !!r; }
function visibile(x, d){ return !x.se || !!x.se(d); }
function opzioniDi(c){ return typeof c.opzioni === "function" ? c.opzioni() : (c.opzioni || []); }
function nominativo(d){ return ((d.cognome || "").toUpperCase() + " " + (d.nome || "")).trim(); }
function riempi(t, v){ return String(t).replace(/\{(\w+)\}/g, (_, k) => v[k] != null ? v[k] : ""); }
function unisci(lista){
  return lista.length <= 1 ? (lista[0] || "") : lista.slice(0, -1).join(", ") + " e " + lista[lista.length - 1];
}

/* ---------- Controlli ---------- */

const CF_DISPARI = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11,
  P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
const OMOCODIA = "LMNPQRSTUV";
function cfValido(cf){
  if(!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  let s = 0;
  for(let i = 0; i < 15; i++){
    const c = cf[i];
    if(i % 2 === 0) s += CF_DISPARI[c];
    else s += /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + s % 26) === cf[15];
}
// Data di nascita e sesso scritti nel codice fiscale.
function cfNascita(cf){
  const n = p => cf.slice(p, p + 2).replace(/[LMNPQRSTUV]/g, c => OMOCODIA.indexOf(c));
  const anno = Number(n(6)), mese = "ABCDEHLMPRST".indexOf(cf[8]) + 1;
  let giorno = Number(n(9));
  const sesso = giorno > 40 ? "F" : "M";
  if(giorno > 40) giorno -= 40;
  return { anno, mese, giorno, sesso };
}
function ibanValido(iban){
  if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if(iban.startsWith("IT") && iban.length !== 27) return false;
  const r = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => c.charCodeAt(0) - 55);
  let resto = 0;
  for(let i = 0; i < r.length; i += 7) resto = Number(String(resto) + r.slice(i, i + 7)) % 97;
  return resto === 1;
}
function normalizza(c, v){
  if(typeof v !== "string") return v;
  v = v.trim();
  if(c.controllo === "cf" || c.controllo === "iban") v = v.replace(/\s+/g, "").toUpperCase();
  return v;
}

function controlla(d){
  const errori = [], avvisi = [];
  const err = (id, msg) => errori.push({ id, msg });
  for(const c of CAMPI){
    if(!visibile(c, d)) continue;
    const v = d[c.id];
    const vuoto = Array.isArray(v) ? !v.length : !v;
    if(vuoto){
      if(valoreReq(c.req, d)) err(c.id, c.label + ": campo obbligatorio.");
      else if(c.avviso) avvisi.push(c.avviso);
      continue;
    }
    if(c.controllo === "cf" && !cfValido(v)) err(c.id, "Codice fiscale non valido: controlla le lettere e i numeri.");
    if(c.controllo === "iban" && !ibanValido(v)) err(c.id, "IBAN non valido: controlla le cifre.");
    if(c.controllo === "email" && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) err(c.id, c.label + ": indirizzo non valido.");
    if(c.controllo === "tel" && v.replace(/\D/g, "").length < 6) err(c.id, c.label + ": numero non valido.");
    if(c.controllo === "cap" && !/^\d{5}$/.test(v)) err(c.id, "CAP: servono 5 cifre.");
    if(c.controllo === "prov" && !/^[A-Z]{2}$/.test(v) && v !== "EE") err(c.id, "Provincia: indica la sigla di 2 lettere (EE se estero).");
    if(c.tipo === "number" && !(Number(String(v).replace(",", ".")) > 0)) err(c.id, c.label + ": indica un numero.");
  }
  if(d.codiceFiscale && cfValido(d.codiceFiscale)){
    const n = cfNascita(d.codiceFiscale);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.dataNascita || "");
    if(m && (Number(m[1]) % 100 !== n.anno || Number(m[2]) !== n.mese || Number(m[3]) !== n.giorno))
      avvisi.push("La data di nascita non corrisponde a quella del codice fiscale (" + String(n.giorno).padStart(2, "0") + "/" + String(n.mese).padStart(2, "0") + "/…" + String(n.anno).padStart(2, "0") + ").");
    if(d.sesso && d.sesso !== n.sesso) avvisi.push("Il sesso indicato non corrisponde a quello del codice fiscale.");
  }
  if(d.dataInizio && d.dataFine && visibile(CAMPI.find(c => c.id === "dataFine"), d) && d.dataFine < d.dataInizio)
    err("dataFine", "La data di fine è precedente alla data di inizio.");
  if(d.dataNascita && d.dataInizio){
    const anni = (new Date(d.dataInizio) - new Date(d.dataNascita)) / (365.25 * 864e5);
    if(anni < 16 || anni > 80) err("dataNascita", "Data di nascita non plausibile: controllala.");
    else if(anni < 18) avvisi.push("Il dipendente è minorenne: servono adempimenti specifici.");
  }
  if(d.dataInizio){
    const giorni = (new Date(d.dataInizio) - new Date(new Date().toISOString().slice(0, 10))) / 864e5;
    if(giorni < 1) avvisi.push("La data di inizio è oggi o già passata: la comunicazione UNILAV va fatta entro il giorno precedente l'inizio.");
  }
  if(extraUE(d) && d.permessoScadenza){
    const fine = visibile(CAMPI.find(c => c.id === "dataFine"), d) ? d.dataFine : "";
    if(d.dataInizio && d.permessoScadenza < d.dataInizio) err("permessoScadenza", "Il permesso di soggiorno è scaduto alla data di inizio.");
    else if(fine && d.permessoScadenza < fine) avvisi.push("Il permesso di soggiorno scade prima della fine del contratto.");
  }
  for(const doc of DOCUMENTI){
    if(visibile(doc, d) && valoreReq(doc.req, d) && !(stato.file[doc.id] || []).length) err("doc-" + doc.id, "Allega: " + doc.nome + ".");
  }
  const totale = tuttiIFile().reduce((s, f) => s + f.blob.size, 0);
  if(totale > HR_CONFIG.maxTotaleMB * MB) err("doc-altro", "Gli allegati superano " + HR_CONFIG.maxTotaleMB + " MB in tutto: togli qualcosa o riduci i PDF.");
  return { errori, avvisi };
}

/* ---------- Stato e modulo ---------- */

const stato = {
  file: {},          // categoria → [{ blob, nome, tipo, origine }]
  invio: false
};
function tuttiIFile(){
  const out = [];
  for(const doc of DOCUMENTI) for(const f of (stato.file[doc.id] || [])) out.push(Object.assign({ categoria: doc.id, categoriaNome: doc.nome }, f));
  return out;
}

function chiRiceve(sezId){
  return HR_CONFIG.destinatari.filter(g => g.sezioni === "tutte" || g.sezioni.includes(sezId));
}
function chiRiceveDoc(docId){
  return HR_CONFIG.destinatari.filter(g => g.documenti === "tutti" || (Array.isArray(g.documenti) && g.documenti.includes(docId)));
}
function chipsGruppi(gruppi, riservato){
  return '<div class="riceve"><span>Ricevono:</span>' + (gruppi.length
    ? gruppi.filter(g => !riservato || g.riservati).map(g => '<span class="gchip">' + esc(g.gruppo.replace(/ \(.*\)$/, "")) + "</span>").join("")
    : '<span class="gchip vuoto">nessuno</span>') + "</div>";
}

function campoHtml(c){
  const id = "f_" + c.id;
  const attr = (c.auto ? ' autocomplete="' + c.auto + '"' : ' autocomplete="off"') +
    (c.maiuscolo ? ' class="maiuscolo"' : "") + ' name="' + c.id + '" id="' + id + '"';
  let input;
  if(c.tipo === "select"){
    input = '<select' + attr + '><option value="">— scegli —</option>' + opzioniDi(c).map(o => "<option>" + esc(o) + "</option>").join("") + "</select>";
  }else if(c.tipo === "choice" || c.tipo === "checks"){
    const t = c.tipo === "choice" ? "radio" : "checkbox";
    input = '<div class="choices" role="group" id="' + id + '">' + opzioniDi(c).map(o =>
      '<label class="choice"><input type="' + t + '" name="' + c.id + '" value="' + esc(o) + '"' +
      ((c.predefinito || []).includes(o) ? " checked" : "") + "><span>" + esc(o) + "</span></label>").join("") + "</div>";
  }else if(c.tipo === "textarea"){
    input = "<textarea" + attr + ' rows="2"></textarea>';
  }else{
    const tipo = c.tipo === "number" ? "text" : c.tipo;
    const extra = c.tipo === "number" ? ' inputmode="decimal"' : (c.controllo === "cap" ? ' inputmode="numeric" maxlength="5"' : "");
    const lista = c.suggerimenti ? ' list="l_' + c.id + '"' : "";
    input = '<input type="' + tipo + '"' + attr + extra + lista + ">" +
      (c.suggerimenti ? '<datalist id="l_' + c.id + '">' + c.suggerimenti().map(o => '<option value="' + esc(o) + '">').join("") + "</datalist>" : "");
  }
  return '<div class="field' + (c.largo || c.tipo === "checks" ? " largo" : "") + '" data-campo="' + c.id + '">' +
    '<label class="flabel" for="' + id + '">' + esc(c.label) + '<span class="req" aria-hidden="true"> *</span>' +
    (c.riservato ? ' <span class="lock" title="Solo per chi riceve i dati economici">🔒</span>' : "") + "</label>" +
    input + (c.hint ? '<span class="hint">' + esc(c.hint) + "</span>" : "") +
    '<span class="ferr" id="e_' + c.id + '"></span></div>';
}

function costruisciModulo(){
  let h = "";
  for(const s of SEZIONI){
    const campi = CAMPI.filter(c => c.sez === s.id);
    if(!campi.length) continue;
    h += '<section class="card" id="s_' + s.id + '"><div class="card-head"><h2>' + esc(s.titolo) + "</h2>" + chipsGruppi(chiRiceve(s.id)) + "</div>" +
      (campi.some(c => c.riservato) ? '<p class="hint">🔒 = dati economici, solo per ' + esc(unisci(chiRiceve(s.id).filter(g => g.riservati).map(g => g.gruppo.replace(/ \(.*\)$/, "")))) + ".</p>" : "") +
      '<div class="grid">' + campi.map(campoHtml).join("") + "</div></section>";
  }
  // Documenti
  h += '<section class="card" id="s_documenti"><div class="card-head"><h2>Documenti</h2></div>' +
    '<p class="hint">PDF o foto. Le foto grandi vengono ridotte in automatico. Massimo ' + HR_CONFIG.maxFileMB + " MB per file e " + HR_CONFIG.maxTotaleMB + " MB in tutto.</p>" +
    '<div class="docs">' + DOCUMENTI.map(doc =>
      '<div class="doc" id="doc-' + doc.id + '" data-doc="' + doc.id + '">' +
        '<div class="doc-head"><div><strong>' + esc(doc.nome) + '</strong><span class="req" aria-hidden="true"> *</span>' +
          (doc.hint ? '<div class="hint">' + esc(doc.hint) + "</div>" : "") + "</div>" +
          '<label class="btn small">📎 Aggiungi<input type="file" multiple accept=".pdf,image/*,.doc,.docx,.odt,.p7m" data-doc="' + doc.id + '" hidden></label></div>' +
        chipsGruppi(chiRiceveDoc(doc.id)) +
        '<ul class="files" id="files-' + doc.id + '"></ul><span class="ferr" id="e_doc-' + doc.id + '"></span>' +
      "</div>").join("") + "</div></section>";
  $("modulo").innerHTML = h;
}

function leggiDati(){
  const d = {};
  for(const c of CAMPI){
    if(c.tipo === "choice"){
      const x = document.querySelector('input[name="' + c.id + '"]:checked');
      d[c.id] = x ? x.value : "";
    }else if(c.tipo === "checks"){
      d[c.id] = Array.from(document.querySelectorAll('input[name="' + c.id + '"]:checked')).map(x => x.value);
    }else{
      d[c.id] = normalizza(c, $("f_" + c.id).value);
    }
  }
  return d;
}
function scriviDati(d){
  for(const c of CAMPI){
    if(!(c.id in d)) continue;
    const v = d[c.id];
    if(c.tipo === "choice" || c.tipo === "checks"){
      for(const x of document.querySelectorAll('input[name="' + c.id + '"]')) x.checked = Array.isArray(v) ? v.includes(x.value) : x.value === v;
    }else{
      $("f_" + c.id).value = v || "";
    }
  }
}

// Mostra/nasconde i campi condizionali e aggiorna gli asterischi.
function aggiorna(){
  const d = leggiDati();
  for(const c of CAMPI){
    const el = document.querySelector('[data-campo="' + c.id + '"]');
    el.hidden = !visibile(c, d);
    el.classList.toggle("obbl", valoreReq(c.req, d));
  }
  for(const doc of DOCUMENTI){
    const el = $("doc-" + doc.id);
    el.hidden = !visibile(doc, d);
    el.classList.toggle("obbl", valoreReq(doc.req, d));
  }
  // Codice fiscale: controllo mentre si scrive.
  const cf = d.codiceFiscale, e = $("e_codiceFiscale");
  if(cf.length === 16) e.textContent = cfValido(cf) ? "" : "Codice fiscale non valido.";
  return d;
}

let salvaTimer = null;
function salvaBozza(){
  clearTimeout(salvaTimer);
  salvaTimer = setTimeout(() => {
    const d = leggiDati();
    const vuota = CAMPI.every(c => c.predefinito || (Array.isArray(d[c.id]) ? !d[c.id].length : !d[c.id]));
    scrivi(CHIAVE_BOZZA, vuota ? null : d);
  }, 400);
}

/* ---------- Documenti ---------- */

async function riduciFoto(file){
  if(!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < HR_CONFIG.riduciFotoOltreMB * MB) return file;
  try{
    const url = URL.createObjectURL(file);
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    URL.revokeObjectURL(url);
    const lato = 2400, k = Math.min(1, lato / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
    if(!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  }catch(_){
    return file; // formato non leggibile dal browser (es. HEIC fuori da Safari): si invia com'è
  }
}

async function aggiungiFile(docId, lista){
  const e = $("e_doc-" + docId);
  e.textContent = "";
  for(const originale of lista){
    if(/\.(exe|com|bat|cmd|ps1|vbs|js|msi|scr|jar|hta|html?|svg|lnk|reg|dll|sh|apk|dmg|iso)$/i.test(originale.name)){
      e.textContent = "Tipo di file non ammesso: " + originale.name; continue;
    }
    const f = await riduciFoto(originale);
    if(f.size > HR_CONFIG.maxFileMB * MB){ e.textContent = originale.name + ": file troppo grande (massimo " + HR_CONFIG.maxFileMB + " MB)."; continue; }
    if(!f.size){ e.textContent = originale.name + ": file vuoto."; continue; }
    (stato.file[docId] = stato.file[docId] || []).push({ blob: f, origine: originale.name, tipo: f.type || "application/octet-stream" });
  }
  mostraFile(docId);
}
function mostraFile(docId){
  const lista = stato.file[docId] || [];
  $("files-" + docId).innerHTML = lista.map((f, i) =>
    '<li><span class="fname">' + esc(f.blob.name || f.origine) + '</span><span class="hint">' + dimensione(f.blob.size) + "</span>" +
    '<button type="button" class="togli" data-doc="' + docId + '" data-i="' + i + '" aria-label="Togli ' + esc(f.origine) + '">×</button></li>').join("");
  $("doc-" + docId).classList.toggle("ok", lista.length > 0);
  aggiornaTotale();
}
function aggiornaTotale(){
  const t = tuttiIFile().reduce((s, f) => s + f.blob.size, 0);
  $("totaleFile").textContent = t ? "Allegati: " + tuttiIFile().length + " file, " + dimensione(t) : "";
}

// Nome dell'allegato nelle email: "ZLATOV Sergiu - Documento di identità.pdf" (con numero se più file).
function nomiAllegati(d){
  const file = tuttiIFile(), conta = {}, visti = {};
  for(const f of file) conta[f.categoria] = (conta[f.categoria] || 0) + 1;
  const base = nominativo(d).replace(/[\\/:*?"<>|]/g, "-");
  return file.map(f => {
    const est = ((f.blob.name || f.origine).match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0].toLowerCase();
    visti[f.categoria] = (visti[f.categoria] || 0) + 1;
    const n = conta[f.categoria] > 1 ? " " + visti[f.categoria] : "";
    return Object.assign({}, f, { nome: base + " - " + f.categoriaNome.replace(/\//g, "-") + n + est });
  });
}

/* ---------- Email ---------- */

function valoreTesto(c, v){
  if(Array.isArray(v)) return v.join(", ");
  if(c.tipo === "date") return dataIt(v);
  return v;
}
function righe(sezId, d, gruppo){
  const out = [];
  for(const c of CAMPI){
    if(c.sez !== sezId || !visibile(c, d)) continue;
    if(c.riservato && !gruppo.riservati) continue;
    if(c.id === "richieste") continue; // diventa testo nella chiusura
    const v = d[c.id];
    if(Array.isArray(v) ? !v.length : !v) continue;
    out.push([c.label, valoreTesto(c, v)]);
  }
  if(sezId === "contratto" && gruppo.riservati){
    if(!d.periodoProva) out.push(["Periodo di prova", "Come da CCNL"]);
    if(!d.retribuzione) out.push(["Retribuzione", "Minimi del CCNL"]);
  }
  if(sezId === "richieste" && d.richieste.length) out.unshift(["Da predisporre", d.richieste.join(", ")]);
  return out;
}

function preparaInvio(d, compilatore){
  const soc = HR_CONFIG.societa.find(s => s.nome === d.societa) || { nome: d.societa, breve: d.societa };
  const file = nomiAllegati(d);
  const richiesteTesto = unisci((d.richieste || []).map(r => r === "Costo aziendale" ? "il relativo costo" : r));
  const v = {
    societa: soc.breve, nominativo: nominativo(d), cognome: (d.cognome || "").toUpperCase(), nome: d.nome,
    dataInizio: dataIt(d.dataInizio), richieste: richiesteTesto
  };
  const durata = d.tipoContratto + " dal " + dataIt(d.dataInizio) + (visibile(CAMPI.find(c => c.id === "dataFine"), d) && d.dataFine ? " al " + dataIt(d.dataFine) : "");
  const sottotitolo = [
    [d.qualifica, d.categoria && d.livello ? d.categoria + " " + d.livello : d.livello].filter(Boolean).join(" – "),
    durata + (partTime(d) ? " · part-time " + d.oreSettimanali + " h/sett." : ""),
    d.luogoLavoro
  ].filter(Boolean).join("\n");
  const gruppi = HR_CONFIG.destinatari;
  const messaggi = gruppi.map(g => {
    const sezioni = SEZIONI
      .filter(s => s.id !== "persona" && (g.sezioni === "tutte" || g.sezioni.includes(s.id)))
      .map(s => ({ titolo: s.titolo, righe: righe(s.id, d, g) }))
      .filter(s => s.righe.length);
    if(g.sezioni === "tutte" || g.sezioni.includes("persona")){
      sezioni.unshift({ titolo: "Dipendente", righe: righe("persona", d, g) });
    }
    const allegati = file.map((f, j) => (g.documenti === "tutti" || (Array.isArray(g.documenti) && g.documenti.includes(f.categoria))) ? j : -1).filter(j => j >= 0);
    const senza = file.length - allegati.length;
    const conDoc = gruppi.filter(x => x.documenti === "tutti").map(x => x.gruppo.replace(/ \(.*\)$/, "").toLowerCase());
    const altri = gruppi.filter(x => x !== g).map(x => x.gruppo.replace(/ \(.*\)$/, ""));
    const testi = t => t.map(p => riempi(p, v)).filter(p => !/\{\w+\}/.test(p) && !(p.includes("fammi avere") && !richiesteTesto));
    return {
      gruppo: g.gruppo,
      to: g.persone,
      cc: [],
      oggetto: riempi(HR_CONFIG.oggetto, v),
      intro: testi(g.intro || []),
      titolo: v.nominativo,
      sottotitolo,
      sezioni,
      allegati,
      notaAllegati: senza > 0 && conDoc.length && g.documenti !== "tutti"
        ? "I documenti del dipendente (" + file.filter((f, j) => !allegati.includes(j)).map(f => f.categoriaNome).filter((x, i, a) => a.indexOf(x) === i).join(", ") +
          ") sono stati inviati solo a " + unisci(conDoc) + "."
        : "",
      chiusura: testi(g.chiusura || []),
      piede: "Comunicazione inviata da SICIET HR anche a: " + altri.join(", ") + "."
    };
  });
  return {
    compilatore,
    firmaAzienda: HR_CONFIG.firmaAzienda,
    file: file.map(f => ({ nome: f.nome, tipo: f.tipo, dimensione: f.blob.size, categoria: f.categoriaNome })),
    messaggi,
    _blob: file.map(f => f.blob)
  };
}

// Stessa funzione del servizio (api/worker.js): se si cambia lì, cambiarla anche qui.
function emailHtml(m, file, compilatore, firmaAzienda){
  const e = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const br = s => e(s).replace(/\r?\n/g, "<br>");
  const font = "font-family:Segoe UI,Arial,Helvetica,sans-serif;";
  const blu = "#005baa";
  let h = '<div style="' + font + 'font-size:14px;line-height:1.5;color:#1d2430">';
  for(const p of m.intro) h += '<p style="margin:0 0 10px">' + br(p) + "</p>";
  if(m.titolo){
    h += '<div style="margin:16px 0 12px;padding:12px 16px;border-left:4px solid ' + blu + ';background:#eef4fb">' +
      '<div style="font-size:18px;font-weight:bold;color:' + blu + '">' + e(m.titolo) + "</div>" +
      (m.sottotitolo ? '<div style="color:#3a4555">' + br(m.sottotitolo) + "</div>" : "") + "</div>";
  }
  for(const s of m.sezioni){
    if(!s.righe.length) continue;
    h += '<h3 style="' + font + 'font-size:15px;color:' + blu + ';margin:18px 0 6px">' + e(s.titolo) + "</h3>" +
      '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:680px">';
    for(const [l, v] of s.righe){
      h += "<tr>" +
        '<td style="' + font + 'font-size:13px;color:#5d6878;padding:5px 12px 5px 0;border-bottom:1px solid #e3e7ee;vertical-align:top;width:38%">' + e(l) + "</td>" +
        '<td style="' + font + 'font-size:14px;padding:5px 0;border-bottom:1px solid #e3e7ee;vertical-align:top;font-weight:600">' + br(v) + "</td></tr>";
    }
    h += "</table>";
  }
  if(m.allegati.length){
    h += '<h3 style="' + font + 'font-size:15px;color:' + blu + ';margin:18px 0 6px">Allegati (' + m.allegati.length + ")</h3><ul style=\"margin:0 0 0 18px;padding:0\">";
    for(const j of m.allegati) h += "<li>" + e(file[j].nome) + "</li>";
    h += "</ul>";
  }
  if(m.notaAllegati) h += '<p style="margin:14px 0 0;color:#5d6878;font-size:13px">' + br(m.notaAllegati) + "</p>";
  for(const p of m.chiusura) h += '<p style="margin:14px 0 0">' + br(p) + "</p>";
  h += '<p style="margin:22px 0 0">' +
    (compilatore.nome ? "<strong>" + e(compilatore.nome) + "</strong>" : "") +
    (compilatore.ruolo ? "<br>" + e(compilatore.ruolo) : "") +
    (compilatore.telefono ? "<br>" + e(compilatore.telefono) : "") +
    (compilatore.email ? "<br>" + e(compilatore.email) : "") + "</p>";
  if(firmaAzienda.length) h += '<p style="margin:10px 0 0;color:#5d6878;font-size:12px">' + firmaAzienda.map(e).join("<br>") + "</p>";
  if(m.piede) h += '<p style="margin:22px 0 0;padding-top:10px;border-top:1px solid #e3e7ee;color:#8a94a3;font-size:12px">' + br(m.piede) + "</p>";
  return h + "</div>";
}

/* ---------- Servizio ---------- */

function password(){ return leggi(CHIAVE_PASSWORD, "sessionStorage") || ""; }
async function api(metodo, azione, opz){
  opz = opz || {};
  const h = Object.assign({ "X-Password": password() }, opz.headers || {});
  let body = opz.body;
  if(body && typeof body === "object" && !(body instanceof Blob) && typeof body !== "string"){
    body = JSON.stringify(body); h["Content-Type"] = "application/json";
  }
  let res;
  try{
    res = await fetch(HR_CONFIG.api.replace(/\/+$/, "") + "/" + azione + (opz.query || ""), { method: metodo, headers: h, body });
  }catch(_){
    throw new Error("Servizio non raggiungibile: controlla la connessione e riprova.");
  }
  const j = await res.json().catch(() => ({}));
  if(!res.ok){
    const err = new Error(j.error || ("Errore " + res.status));
    err.status = res.status;
    throw err;
  }
  return j;
}
function base64(blob){
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => ko(new Error("Impossibile leggere il file " + (blob.name || "")));
    r.readAsDataURL(blob);
  });
}

async function spedisci(pacchetto, avanzamento){
  const blobs = pacchetto._blob;
  const corpo = Object.assign({}, pacchetto); delete corpo._blob;
  avanzamento("Preparo le email…", 0);
  const r = await api("POST", "invio", { body: corpo });
  const token = r.token;
  const lavori = [];
  for(const m of r.messaggi) for(const j of m.allegati) lavori.push([m.i, j]);
  const cache = {};
  try{
    let fatti = 0;
    for(const [i, j] of lavori){
      avanzamento("Allego i documenti (" + (fatti + 1) + " di " + lavori.length + ")…", fatti / (lavori.length + 1));
      const b = blobs[j];
      const piccolo = b.size < LIMITE_BASE64;
      if(piccolo && !cache[j]) cache[j] = await base64(b);
      await api("PUT", "allegato", {
        query: "?m=" + i + "&f=" + j,
        headers: { "X-Token": token, "X-Encoding": piccolo ? "base64" : "raw", "Content-Type": piccolo ? "text/plain" : "application/octet-stream" },
        body: piccolo ? cache[j] : b
      });
      fatti++;
    }
  }catch(err){
    try{ await api("POST", "annulla", { headers: { "X-Token": token } }); }catch(_){ /* niente */ }
    throw err;
  }
  avanzamento("Invio le email…", lavori.length / (lavori.length + 1));
  return api("POST", "invia", { headers: { "X-Token": token } });
}

/* ---------- Interfaccia ---------- */

function compilatore(){ return leggi(CHIAVE_COMPILATORE) || null; }
function mostraCompilatore(){
  const c = compilatore();
  $("chi").innerHTML = c ? "<div>" + esc(c.nome) + '<button type="button" id="cambiaChi">Cambia</button></div>' : "";
  if(c) $("cambiaChi").onclick = () => apriCompilatore(true);
}
function apriCompilatore(modifica){
  const c = compilatore() || {};
  $("c_nome").value = c.nome || ""; $("c_ruolo").value = c.ruolo || "Responsabile del Personale";
  $("c_tel").value = c.telefono || ""; $("c_email").value = c.email || "";
  $("chiCard").hidden = false;
  $("chiAnnulla").hidden = !modifica;
  if(modifica) $("chiCard").scrollIntoView({ block: "start" });
}
function salvaCompilatore(ev){
  ev.preventDefault();
  const c = { nome: $("c_nome").value.trim(), ruolo: $("c_ruolo").value.trim(), telefono: $("c_tel").value.trim(), email: $("c_email").value.trim().toLowerCase() };
  if(!c.nome || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c.email)){ $("chiErr").textContent = "Scrivi nome e cognome e la tua email aziendale."; return; }
  scrivi(CHIAVE_COMPILATORE, c);
  $("chiCard").hidden = true; $("chiErr").textContent = "";
  mostraCompilatore();
}

// Senza password valida il modulo resta nascosto.
function bloccaPassword(si, errore){
  $("pwdCard").hidden = !si;
  document.body.classList.toggle("serve-pwd", si);
  $("pwdErr").textContent = errore || "";
  if(si) $("pwd").focus();
}
async function verificaPassword(){
  if(!HR_CONFIG.api){ $("prova").hidden = false; return true; }
  if(!password()){ bloccaPassword(true); return false; }
  try{
    await api("GET", "ping");
    bloccaPassword(false);
    return true;
  }catch(err){
    if(err.status === 401) scrivi(CHIAVE_PASSWORD, null, "sessionStorage");
    bloccaPassword(true, err.status === 401 ? "" : err.message);
    return false;
  }
}
async function entra(ev){
  ev.preventDefault();
  scrivi(CHIAVE_PASSWORD, $("pwd").value, "sessionStorage");
  $("pwdErr").textContent = "";
  $("pwdBtn").disabled = true;
  try{
    await api("GET", "ping");
    bloccaPassword(false); $("pwd").value = "";
  }catch(err){
    scrivi(CHIAVE_PASSWORD, null, "sessionStorage");
    $("pwdErr").textContent = err.status === 401 ? "Password errata." : err.message;
  }finally{ $("pwdBtn").disabled = false; }
}

function mostraErrori(errori){
  document.querySelectorAll(".ferr").forEach(e => { if(e.id !== "e_codiceFiscale") e.textContent = ""; });
  document.querySelectorAll(".invalid").forEach(e => e.classList.remove("invalid"));
  for(const x of errori){
    const e = $("e_" + x.id); if(e) e.textContent = x.msg;
    const f = $("f_" + x.id); if(f) f.classList.add("invalid");
  }
}

let pacchettoCorrente = null;
function controllaEInvia(){
  const d = aggiorna();
  const c = compilatore();
  if(!c){ apriCompilatore(false); $("chiCard").scrollIntoView({ block: "start" }); $("chiErr").textContent = "Prima di inviare indica chi compila."; return; }
  const { errori, avvisi } = controlla(d);
  mostraErrori(errori);
  if(errori.length){
    $("esito").className = "msg error";
    $("esito").innerHTML = "<strong>Da completare (" + errori.length + "):</strong><ul>" + errori.map(x => '<li><a href="#" data-vai="' + x.id + '">' + esc(x.msg) + "</a></li>").join("") + "</ul>";
    $("esito").scrollIntoView({ block: "center" });
    return;
  }
  $("esito").className = "msg"; $("esito").innerHTML = "";
  pacchettoCorrente = preparaInvio(d, c);
  mostraAnteprima(pacchettoCorrente, avvisi);
}

function mostraAnteprima(p, avvisi){
  const gruppi = HR_CONFIG.destinatari;
  $("antAvvisi").innerHTML = avvisi.length ? '<div class="notice"><strong>Controlla:</strong><ul>' + avvisi.map(a => "<li>" + esc(a) + "</li>").join("") + "</ul></div>" : "";
  $("antLista").innerHTML = p.messaggi.map((m, i) =>
    '<div class="dest">' +
      '<div class="dest-head"><strong>' + esc(gruppi[i].gruppo) + '</strong><span class="hint">' + esc(m.to.map(x => x.nome + " <" + x.email + ">").join(", ")) + "</span></div>" +
      '<div class="dest-body"><div><span class="hint">Dati:</span> ' + esc(m.sezioni.map(s => s.titolo).join(", ")) + "</div>" +
      '<div><span class="hint">Allegati:</span> ' + (m.allegati.length ? esc(m.allegati.length + " – " + m.allegati.map(j => p.file[j].categoria).filter((x, k, a) => a.indexOf(x) === k).join(", ")) : "nessuno") + "</div></div>" +
      '<details><summary>Vedi l\'email</summary><div class="mail"><div class="mail-subj">' + esc(m.oggetto) + "</div>" + emailHtml(m, p.file, p.compilatore, p.firmaAzienda) + "</div></details>" +
    "</div>").join("");
  $("antInvia").textContent = HR_CONFIG.api ? "✉️ Conferma e invia " + p.messaggi.length + " email" : "Modalità prova: nessun invio";
  $("antInvia").disabled = !HR_CONFIG.api;
  $("antMsg").className = "msg"; $("antMsg").textContent = "";
  $("progresso").hidden = true;
  $("anteprima").hidden = false;
  document.body.classList.add("bloccato");
  $("antChiudi").focus();
}
function chiudiAnteprima(){
  if(stato.invio) return;
  $("anteprima").hidden = true;
  document.body.classList.remove("bloccato");
}

async function conferma(){
  if(stato.invio || !pacchettoCorrente) return;
  if(!(await verificaPassword())){ chiudiAnteprima(); return; }
  stato.invio = true;
  $("antInvia").disabled = true; $("antChiudi").disabled = true;
  $("progresso").hidden = false;
  const msg = $("antMsg");
  msg.className = "msg"; msg.textContent = "";
  try{
    const r = await spedisci(pacchettoCorrente, (testo, quota) => {
      $("progTesto").textContent = testo;
      $("progBarra").style.width = Math.round(quota * 100) + "%";
    });
    $("progBarra").style.width = "100%";
    const g = HR_CONFIG.destinatari;
    if(r.errori.length){
      msg.className = "msg error";
      msg.innerHTML = "<strong>Inviate " + r.inviati.length + " email su " + g.length + ".</strong> Non inviate:<ul>" +
        r.errori.map(x => "<li>" + esc(g[x.i].gruppo) + ": " + esc(x.errore) + "</li>").join("") + "</ul>Inoltra a mano la copia completa a chi manca.";
    }else{
      fineInvio(r.inviati.map(i => g[i]));
      return;
    }
  }catch(err){
    msg.className = "msg error";
    msg.textContent = "Invio non riuscito, nessuna email è partita: " + err.message;
    $("antInvia").disabled = false;
    $("progresso").hidden = true;
  }finally{
    stato.invio = false; $("antChiudi").disabled = false;
  }
}

function fineInvio(gruppi){
  const d = leggiDati();
  $("anteprima").hidden = true; document.body.classList.remove("bloccato");
  $("modulo").hidden = true; $("azioni").hidden = true;
  $("fatto").hidden = false;
  $("fattoTesto").innerHTML = "Assunzione di <strong>" + esc(nominativo(d)) + "</strong> comunicata a:<ul>" +
    gruppi.map(g => "<li>" + esc(g.gruppo) + " – " + esc(g.persone.map(p => p.nome).join(", ")) + "</li>").join("") + "</ul>";
  scrivi(CHIAVE_BOZZA, null);
  window.scrollTo(0, 0);
}
function nuovo(){
  if(!$("fatto").hidden || confirm("Svuotare il modulo? I dati inseriti e i documenti allegati verranno tolti.")){
    scrivi(CHIAVE_BOZZA, null);
    stato.file = {};
    costruisciModulo(); collega(); aggiorna(); aggiornaTotale();
    $("fatto").hidden = true; $("modulo").hidden = false; $("azioni").hidden = false;
    $("esito").className = "msg"; $("esito").innerHTML = "";
    window.scrollTo(0, 0);
  }
}

function collega(){
  const m = $("modulo");
  m.oninput = ev => {
    const t = ev.target;
    if(t.classList.contains("maiuscolo")){
      const p = t.selectionStart; t.value = t.value.toUpperCase(); try{ t.setSelectionRange(p, p); }catch(_){}
    }
    if(t.classList.contains("invalid")) t.classList.remove("invalid");
    aggiorna(); salvaBozza();
  };
  m.onchange = ev => {
    if(ev.target.type === "file"){
      const lista = Array.from(ev.target.files || []);
      ev.target.value = "";
      aggiungiFile(ev.target.dataset.doc, lista);
      return;
    }
    aggiorna(); salvaBozza();
  };
  m.onclick = ev => {
    const b = ev.target.closest(".togli");
    if(!b) return;
    stato.file[b.dataset.doc].splice(Number(b.dataset.i), 1);
    mostraFile(b.dataset.doc);
  };
  // Trascinamento dei file dal PC su una categoria.
  for(const el of document.querySelectorAll(".doc")){
    el.ondragover = ev => { ev.preventDefault(); el.classList.add("drag"); };
    el.ondragleave = () => el.classList.remove("drag");
    el.ondrop = ev => { ev.preventDefault(); el.classList.remove("drag"); aggiungiFile(el.dataset.doc, Array.from(ev.dataTransfer.files || [])); };
  }
}

function avvia(){
  costruisciModulo();
  collega();
  const bozza = leggi(CHIAVE_BOZZA);
  if(bozza){ scriviDati(bozza); $("bozzaAvviso").hidden = false; }
  else if(HR_CONFIG.societa.length === 1) $("f_societa").value = HR_CONFIG.societa[0].nome;
  aggiorna();
  mostraCompilatore();
  if(!compilatore()) apriCompilatore(false);
  $("chiForm").onsubmit = salvaCompilatore;
  $("chiAnnulla").onclick = () => { $("chiCard").hidden = true; };
  $("pwdForm").onsubmit = entra;
  $("controlla").onclick = controllaEInvia;
  $("svuota").onclick = nuovo;
  $("nuovo").onclick = nuovo;
  $("antChiudi").onclick = chiudiAnteprima;
  $("antInvia").onclick = conferma;
  $("anteprima").onclick = ev => { if(ev.target === $("anteprima")) chiudiAnteprima(); };
  document.addEventListener("keydown", ev => { if(ev.key === "Escape" && !$("anteprima").hidden) chiudiAnteprima(); });
  $("esito").onclick = ev => {
    const a = ev.target.closest("[data-vai]");
    if(!a) return;
    ev.preventDefault();
    const id = a.dataset.vai;
    const el = $("f_" + id) || $(id) || $("doc-" + id);
    if(el){ el.scrollIntoView({ block: "center" }); if(el.focus) el.focus({ preventScroll: true }); }
  };
  verificaPassword();
}

if(typeof document !== "undefined") document.addEventListener("DOMContentLoaded", avvia);
if(typeof module !== "undefined") module.exports = { cfValido, cfNascita, ibanValido, emailHtml, preparaInvio, HR_CONFIG };
