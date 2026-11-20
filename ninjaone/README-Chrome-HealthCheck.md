# Chrome Health Check per NinjaOne

Script: `Chrome-HealthCheck.ps1` (solo lettura, non modifica nulla sul PC).

## 1. Campi personalizzati da creare (Amministrazione > Dispositivi > Campi personalizzati globali)

Il nome tecnico deve essere esattamente questo (minuscolo, senza spazi).
Permessi: **Automazione = Lettura/Scrittura**, Script = Lettura/Scrittura.

| Nome tecnico | Tipo | Uso |
|---|---|---|
| `chromehealthstatus` | Testo (o Menu a tendina: OK, ATTENZIONE, CRITICO, N/A) | Stato complessivo |
| `chromehealthsummary` | Testo | Prime 3 anomalie |
| `chromehealthdetails` | Testo multilinea | Report completo |
| `chromehealthlastrun` | Testo | Data ultimo controllo |
| `chromerammb` | Intero | RAM di Chrome (working set privato, come Gestione attivita') al momento del controllo |
| `chromeextmax` | Intero | Numero massimo di estensioni per utente |

Se un campo manca, lo script continua e stampa solo `[info] campo ... non impostato`.

## 2. Creare lo script

Amministrazione > Libreria > Automazione > Nuovo script:
- Lingua: **PowerShell**
- Sistema operativo: **Windows**
- Architettura: tutte
- Esegui come: **Sistema**
- Timeout: 600 s (la scansione delle cartelle profilo puo' richiedere qualche minuto sui PC con profili grandi)

Parametri opzionali (tutti con un valore predefinito):
- `-ApprovedExtensionIds "fcoeoabgfenejglbffodgkkbkcdhcgfn"`
  (elenca solo le estensioni approvate ma NON forzate da GPO, ad esempio Claude: quelle del forcelist,
  come Bitwarden e Ghostery, sono considerate approvate in automatico)
- `-MinRamGB 8 -ChromeRamWarnMB 3000 -ChromeRamCritMB 5000 -ExtWarn 8 -MinFreeDiskGB 20`
- `-FailOnIssue` per far risultare lo script "fallito" se lo stato non e' OK

## 3. Schedulazione

Criteri o Automazione pianificata su tutti i PC Windows, **in orario di lavoro** (es. martedi' e giovedi' alle 11:00),
perche' la memoria di Chrome e' un'istantanea: a Chrome chiuso il dato non e' valido (il report lo segnala).
Una singola esecuzione e' poco affidabile: valuta 2-3 rilevazioni in giorni diversi.

## 4. Lettura dei risultati

- Nell'elenco dispositivi aggiungi le colonne `chromehealthstatus`, `chromehealthsummary`, `chromerammb`
  oppure crea un filtro: `chromehealthstatus` = CRITICO / ATTENZIONE.
- Facoltativo: condizione di avviso su `chromehealthstatus` = CRITICO.

## 5. Cosa controlla

| Controllo | Soglia predefinita | Gravita' |
|---|---|---|
| RAM installata | <= 4 GB critico, < 8 GB avviso | CRIT / WARN |
| Disco di sistema HDD | - | WARN |
| Spazio libero | < 20 GB | WARN |
| Uptime | > 14 giorni (solo INFO se Avvio rapido e' attivo, perche' il dato non e' affidabile) | WARN / INFO |
| Chrome non aggiornato | > 60 giorni | WARN |
| RAM Chrome (working set privato, come Gestione attivita') | >= 3000 MB avviso, >= 5000 MB critico | WARN / CRIT |
| Processi Chrome | > 60 | WARN |
| RAM libera | < 10% con Chrome in uso | WARN |
| Profilo / cache Chrome | >= 2000 MB / >= 1500 MB | WARN |
| Numero profili Chrome | > 3 | WARN |
| Estensioni per utente (escluse quelle forzate da GPO) | > 8 | WARN |
| Estensioni non approvate (escluse quelle forzate da GPO) | se `-ApprovedExtensionIds` e' valorizzato | WARN |
| Profilo roaming, AppData ridiretto o dati Chrome su rete | - | CRIT |
| Policy UserDataDir/DiskCacheDir su rete | - | CRIT |
| Policy mancanti: HighEfficiencyModeEnabled, BackgroundModeEnabled, StartupBoostEnabled | - | INFO |
| Voci duplicate in ExtensionInstallForcelist | - | INFO |
| Uptime non affidabile (Avvio rapido attivo) | uptime > 14 giorni | INFO |
| Chrome installato per singolo utente (non da MSI aziendale) | - | INFO |

Le segnalazioni INFO non cambiano lo stato complessivo.

## Limiti noti
- "Local AppData ridiretto" si legge da `HKEY_USERS\<SID>`, che esiste solo per gli utenti con sessione attiva: per gli altri il controllo non rileva nulla.
  Il controllo sul percorso del profilo Chrome (unita' di rete) e sul profilo roaming vale invece per tutti.
- Le soglie di RAM Chrome vanno tarate dopo le prime 2-3 rilevazioni sulla flotta.
