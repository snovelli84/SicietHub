<#
  SICIET QUALITY – INSTALLAZIONE DELLA SINCRONIZZAZIONE SUL SERVER
  ----------------------------------------------------------------
  Da eseguire una volta, sul server dei file, in PowerShell "Esegui come
  amministratore", dalla cartella che contiene questo file:

    powershell -ExecutionPolicy Bypass -File .\Installa.ps1

  - copia SincronizzaQualita.ps1 e mappa-commesse.csv in C:\SicietQualitySync
  - chiede ID applicazione e segreto client dell'app "SICIET Quality Sync" e
    salva il segreto cifrato (leggibile solo da questo computer, file
    accessibile solo a SYSTEM e Amministratori)
  - crea l'attività pianificata che avvia la sincronizzazione ogni 15 minuti
    come SYSTEM (non serve nessun utente collegato)

  Per cambiare il segreto (es. alla scadenza) basta rieseguirlo.
#>
#Requires -RunAsAdministrator
param(
  [string]$Cartella = "C:\SicietQualitySync",
  [int]$Minuti = 15
)
$ErrorActionPreference = "Stop"
$NOME_ATTIVITA = "SICIET Quality - sincronizzazione Teams"

Write-Host "Installazione della sincronizzazione SICIET Quality in $Cartella" -ForegroundColor Cyan
if(-not (Test-Path -LiteralPath $Cartella)){ New-Item -ItemType Directory -Path $Cartella | Out-Null }

# File dello script (la tabella delle eccezioni non si sovrascrive se esiste già).
Copy-Item -LiteralPath ([IO.Path]::Combine($PSScriptRoot, "SincronizzaQualita.ps1")) -Destination $Cartella -Force
$mappa = [IO.Path]::Combine($Cartella, "mappa-commesse.csv")
if(-not (Test-Path -LiteralPath $mappa)){ Copy-Item -LiteralPath ([IO.Path]::Combine($PSScriptRoot, "mappa-commesse.csv")) -Destination $mappa }

# ID applicazione e segreto dell'app "SICIET Quality Sync" (Entra ID).
$clientId = (Read-Host "ID applicazione (client) dell'app SICIET Quality Sync").Trim()
if($clientId -notmatch '^[0-9a-fA-F-]{36}$'){ throw "ID applicazione non valido." }
$sicuro = Read-Host "Valore del segreto client (non viene mostrato)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicuro)
try{ $segreto = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }finally{ [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if(-not $segreto){ throw "Segreto vuoto." }

Add-Type -AssemblyName System.Security
$fileSegreto = [IO.Path]::Combine($Cartella, "segreto.dat")
$cifrato = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($segreto), $null, "LocalMachine")
[IO.File]::WriteAllBytes($fileSegreto, $cifrato)
# Solo SYSTEM e Amministratori (SID, validi in qualsiasi lingua di Windows).
& icacls $fileSegreto /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
Write-Host "Segreto salvato cifrato in $fileSegreto"

# Attività pianificata ogni $Minuti minuti, come SYSTEM.
$script = [IO.Path]::Combine($Cartella, "SincronizzaQualita.ps1")
$azione = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"$script`" -ClientId $clientId -FileSegreto `"$fileSegreto`"")
$avvio = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minuti) -RepetitionDuration (New-TimeSpan -Days 3650)
$utente = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$opzioni = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $NOME_ATTIVITA -Action $azione -Trigger $avvio -Principal $utente -Settings $opzioni -Description "Copia sul server i file di SICIET Quality salvati su Teams (vedi $Cartella)." -Force | Out-Null
Write-Host "Attività pianificata '$NOME_ATTIVITA' creata: ogni $Minuti minuti." -ForegroundColor Green

if((Read-Host "Avviare subito un primo giro di prova? (S/N)") -match '^[sSyY]'){
  Start-ScheduledTask -TaskName $NOME_ATTIVITA
  Write-Host "Avviato. Il registro è in $Cartella\log (il primo giro può richiedere qualche minuto)."
}
