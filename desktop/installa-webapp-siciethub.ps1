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
    -ApriAlLogin   apre la webapp SICIET HUB all'accesso a Windows
                   (policy WebAppSettings, run_on_os_login), con un solo
                   browser per non aprire due finestre:
    -Browser       Chrome (predefinito) oppure Edge, per -ApriAlLogin
    -Rimuovi       toglie la webapp e le aperture automatiche dalle policy

  Tocca solo i valori di SICIET HUB: le altre voci di WebAppInstallForceList
  e WebAppSettings e le altre policy dei browser restano come sono.
#>
param(
  [switch]$ApriAllAvvio,
  [switch]$ApriAlLogin,
  [ValidateSet("Chrome", "Edge")]
  [string]$Browser = "Chrome",
  [switch]$Rimuovi
)

$ErrorActionPreference = "Stop"
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

  # Apertura all'accesso a Windows: solo nel browser scelto con -Browser.
  $impostazioni = @(Get-JsonList $b.Chiave "WebAppSettings" | Where-Object { $_.manifest_id -ne $Url })
  $login = $ApriAlLogin -and -not $Rimuovi -and $b.Nome -eq $Browser
  if ($login) {
    $impostazioni += [pscustomobject]@{
      manifest_id = $Url
      run_on_os_login = "run_windowed"
    }
  }
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
  if ($login) { $extra += ", apertura all'accesso a Windows attiva" }
  Write-Output ("{0}: SICIET HUB {1}{2}" -f $b.Nome, $stato, $extra)
}
