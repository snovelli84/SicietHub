<#
  SICIET HUB - installazione della webapp su tutti i PC (Chrome ed Edge).

  Imposta la policy WebAppInstallForceList di Google Chrome e Microsoft Edge:
  il browser installa SICIET HUB come app per tutti gli utenti del PC, con
  l'icona nel menu Start e sul desktop, e la apre in una finestra sua.

  Uso con NinjaOne: Amministrazione > Libreria > Automazione > Aggiungi script
  (PowerShell, esegui come "Sistema"), poi eseguirlo sui dispositivi o in una
  policy. Il browser applica la policy al riavvio successivo (o da
  chrome://policy / edge://policy > "Ricarica criteri").

  Parametri (in NinjaOne nel campo "Parametri preimpostati" dello script,
  es. -ApriAllAvvio; oppure da riga di comando):
    -ApriAllAvvio  apre anche hub.siciet.it all'avvio di Chrome ed Edge
    -Rimuovi       toglie la webapp (e l'apertura all'avvio) dalle policy

  Tocca solo i valori di SICIET HUB: le altre voci di WebAppInstallForceList
  e le altre policy dei browser restano come sono.
#>
param(
  [switch]$ApriAllAvvio,
  [switch]$Rimuovi
)

$ErrorActionPreference = "Stop"
$Url = "https://hub.siciet.it/"

$Browser = @(
  @{ Nome = "Chrome"; Chiave = "HKLM:\SOFTWARE\Policies\Google\Chrome" },
  @{ Nome = "Edge";   Chiave = "HKLM:\SOFTWARE\Policies\Microsoft\Edge" }
)

function Get-ForceList([string]$Chiave) {
  $v = (Get-ItemProperty -Path $Chiave -Name "WebAppInstallForceList" -ErrorAction SilentlyContinue).WebAppInstallForceList
  if (-not $v) { return @() }
  # In PowerShell 5.1 ConvertFrom-Json restituisce l'elenco come un unico
  # oggetto: assegnarlo e poi restituirlo lo "srotola" voce per voce.
  try { $p = ConvertFrom-Json -InputObject $v } catch { return @() }
  return @($p)
}

foreach ($b in $Browser) {
  if (-not (Test-Path $b.Chiave)) { New-Item -Path $b.Chiave -Force | Out-Null }

  # Elenco attuale senza SICIET HUB, poi (se non si rimuove) SICIET HUB in coda.
  $lista = @(Get-ForceList $b.Chiave | Where-Object { $_.url -ne $Url })
  if (-not $Rimuovi) {
    $lista += [pscustomobject]@{
      url = $Url
      default_launch_container = "window"
      create_desktop_shortcut = $true
    }
  }

  if ($lista.Count -gt 0) {
    $json = ConvertTo-Json -InputObject $lista -Compress -Depth 4
    Set-ItemProperty -Path $b.Chiave -Name "WebAppInstallForceList" -Value $json -Type String
  } else {
    Remove-ItemProperty -Path $b.Chiave -Name "WebAppInstallForceList" -ErrorAction SilentlyContinue
  }

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
  Write-Output ("{0}: SICIET HUB {1}{2}" -f $b.Nome, $stato, $(if ($ApriAllAvvio -and -not $Rimuovi) { ", apertura all'avvio attiva" } else { "" }))
}
