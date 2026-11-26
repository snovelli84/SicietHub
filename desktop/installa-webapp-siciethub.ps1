<#
  SICIET HUB - installazione della webapp su tutti i PC (Chrome ed Edge).

  COSI' COM'E', SENZA PARAMETRI:
  - installa SICIET HUB come app in Chrome ed Edge per tutti gli utenti del
    PC (icona nel menu Start e sul desktop, finestra senza barra degli
    indirizzi; policy WebAppInstallForceList);
  - la apre con Chrome all'accesso a Windows, con un collegamento
    "SICIET HUB" nella cartella Esecuzione automatica comune a tutti gli
    utenti (C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp).
    La policy WebAppSettings/run_on_os_login di Chrome non si apriva in modo
    affidabile: lo script toglie la voce di SICIET HUB da WebAppSettings, cosi'
    non si aprono due finestre.

  Uso con NinjaOne: Amministrazione > Libreria > Automazione > Aggiungi script
  (PowerShell, esegui come "Sistema"), poi eseguirlo sui dispositivi o in una
  policy. Il browser applica la policy al riavvio successivo (o da
  chrome://policy / edge://policy > "Ricarica criteri").

  Parametri facoltativi, solo se serve cambiare il comportamento (in NinjaOne
  nel campo "Parametri preimpostati"; di norma va lasciato vuoto):
    -NonAprireAlLogin  installa la webapp ma non la apre all'accesso a Windows
    -Browser Edge      apre la webapp all'accesso con Edge invece che con Chrome
    -ApriAllAvvio      apre anche hub.siciet.it come scheda all'avvio del browser
    -Rimuovi           toglie la webapp e le aperture automatiche dalle policy

  Tocca solo i valori di SICIET HUB: le altre voci di WebAppInstallForceList
  e WebAppSettings e le altre policy dei browser restano come sono.
#>
param(
  [switch]$ApriAllAvvio,
  [switch]$NonAprireAlLogin,
  [ValidateSet("Chrome", "Edge")]
  [string]$Browser = "Chrome",
  [switch]$Rimuovi
)

$ErrorActionPreference = "Stop"
$ApriAlLogin = -not $NonAprireAlLogin
$Url = "https://hub.siciet.it/"

$Browsers = @(
  @{ Nome = "Chrome"; Chiave = "HKLM:\SOFTWARE\Policies\Google\Chrome" },
  @{ Nome = "Edge";   Chiave = "HKLM:\SOFTWARE\Policies\Microsoft\Edge" }
)

# Legge una policy che contiene un elenco JSON (WebAppInstallForceList, WebAppSettings).
function Get-JsonList([string]$Chiave, [string]$Nome) {
  $v = (Get-ItemProperty -Path $Chiave -Name $Nome -ErrorAction SilentlyContinue).$Nome
  if (-not $v) { return @() }
  # In PowerShell 5.1 ConvertFrom-Json restituisce l'elenco come un unico
  # oggetto: assegnarlo e poi restituirlo lo "srotola" voce per voce.
  try { $p = ConvertFrom-Json -InputObject $v } catch { return @() }
  return @($p)
}

function Set-JsonList([string]$Chiave, [string]$Nome, $Lista) {
  if (@($Lista).Count -gt 0) {
    $json = ConvertTo-Json -InputObject @($Lista) -Compress -Depth 4
    Set-ItemProperty -Path $Chiave -Name $Nome -Value $json -Type String
  } else {
    Remove-ItemProperty -Path $Chiave -Name $Nome -ErrorAction SilentlyContinue
  }
}

foreach ($b in $Browsers) {
  if (-not (Test-Path $b.Chiave)) { New-Item -Path $b.Chiave -Force | Out-Null }

  # Elenco attuale senza SICIET HUB, poi (se non si rimuove) SICIET HUB in coda.
  $lista = @(Get-JsonList $b.Chiave "WebAppInstallForceList" | Where-Object { $_.url -ne $Url })
  if (-not $Rimuovi) {
    $lista += [pscustomobject]@{
      url = $Url
      default_launch_container = "window"
      create_desktop_shortcut = $true
    }
  }

  Set-JsonList $b.Chiave "WebAppInstallForceList" $lista

  # Vecchia apertura all'accesso tramite policy (non affidabile): si toglie.
  $impostazioni = @(Get-JsonList $b.Chiave "WebAppSettings" | Where-Object { $_.manifest_id -ne $Url })
  Set-JsonList $b.Chiave "WebAppSettings" $impostazioni

  # Apertura all'avvio: RestoreOnStartup = 4 ("apri pagine specifiche").
  $urls = Join-Path $b.Chiave "RestoreOnStartupURLs"
  if ($ApriAllAvvio -and -not $Rimuovi) {
    Set-ItemProperty -Path $b.Chiave -Name "RestoreOnStartup" -Value 4 -Type DWord
    if (-not (Test-Path $urls)) { New-Item -Path $urls -Force | Out-Null }
    Set-ItemProperty -Path $urls -Name "1" -Value $Url -Type String
  } elseif ($Rimuovi) {
    $attuale = (Get-ItemProperty -Path $urls -Name "1" -ErrorAction SilentlyContinue)."1"
    if ($attuale -eq $Url) {
      Remove-Item -Path $urls -Recurse -Force
      Remove-ItemProperty -Path $b.Chiave -Name "RestoreOnStartup" -ErrorAction SilentlyContinue
    }
  }

  $stato = if ($Rimuovi) { "rimossa" } else { "installata" }
  $extra = ""
  if ($ApriAllAvvio -and -not $Rimuovi) { $extra += ", apertura all'avvio del browser attiva" }
  Write-Output ("{0}: SICIET HUB {1}{2}" -f $b.Nome, $stato, $extra)
}

# --- Apertura all'accesso a Windows: collegamento in Esecuzione automatica ---

$Collegamento = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp\SICIET HUB.lnk"

function Find-BrowserExe([string]$Nome) {
  $exe = if ($Nome -eq "Edge") { "msedge.exe" } else { "chrome.exe" }
  $p = (Get-ItemProperty -Path ("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + $exe) -ErrorAction SilentlyContinue)."(default)"
  if ($p -and (Test-Path $p)) { return $p }
  $cartelle = if ($Nome -eq "Edge") { @("Microsoft\Edge\Application") } else { @("Google\Chrome\Application") }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $base) { continue }
    foreach ($c in $cartelle) {
      $f = Join-Path (Join-Path $base $c) $exe
      if (Test-Path $f) { return $f }
    }
  }
  return $null
}

if ($ApriAlLogin -and -not $Rimuovi) {
  $exePath = Find-BrowserExe $Browser
  if ($exePath) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($Collegamento)
    $lnk.TargetPath = $exePath
    $lnk.Arguments = "--app=" + $Url
    $lnk.WorkingDirectory = Split-Path $exePath
    $lnk.IconLocation = $exePath + ",0"
    $lnk.Description = "SICIET HUB"
    $lnk.Save()
    Write-Output ("Apertura all'accesso a Windows attiva con {0} ({1})" -f $Browser, $Collegamento)
  } else {
    Write-Warning ("{0} non trovato su questo PC: apertura all'accesso non impostata." -f $Browser)
  }
} elseif (Test-Path $Collegamento) {
  Remove-Item -Path $Collegamento -Force
  Write-Output "Apertura all'accesso a Windows tolta."
}
