<#
.SYNOPSIS
  Controllo di salute di Google Chrome per NinjaOne (solo lettura, nessuna modifica al PC).

.DESCRIPTION
  Da eseguire in NinjaOne come "Sistema" (SYSTEM). Raccoglie:
    - hardware: RAM, tipo di disco (SSD/HDD), spazio libero, uptime
    - Chrome: versione, eta' dell'aggiornamento, numero di processi e memoria usata ORA
    - policy GPO di ottimizzazione presenti o mancanti e voci duplicate nel forcelist estensioni
    - per ogni utente: dimensione profilo e cache, numero profili, estensioni (nome e ID),
      profilo roaming o AppData ridiretto su rete
  Assegna uno stato OK / ATTENZIONE / CRITICO, stampa un report e scrive i campi personalizzati
  di NinjaOne (se esistono).

  NOTA: la memoria di Chrome e' un'istantanea. Schedulare in orario di lavoro, altrimenti
  Chrome e' chiuso e il dato non e' significativo (lo script lo segnala).

.PARAMETER ApprovedExtensionIds
  ID delle estensioni approvate, separati da virgola. Se vuoto, il controllo e' saltato.

.PARAMETER FailOnIssue
  Esce con codice 1 se lo stato non e' OK (utile per condizioni "script fallito" in Ninja).
#>
[CmdletBinding()]
param(
    [int]$MinRamGB = 8,
    [int]$ChromeRamWarnMB = 3000,
    [int]$ChromeRamCritMB = 5000,
    [int]$ChromeProcWarn = 60,
    [int]$ProfileWarnMB = 2000,
    [int]$CacheWarnMB = 1500,
    [int]$ExtWarn = 8,
    [int]$UptimeWarnDays = 14,
    [int]$MinFreeDiskGB = 20,
    [int]$ChromeAgeWarnDays = 60,
    [string]$ApprovedExtensionIds = '',
    [switch]$SkipNinjaFields,
    [switch]$FailOnIssue
)

$ErrorActionPreference = 'SilentlyContinue'
$approved = @($ApprovedExtensionIds -split '[,; ]' | Where-Object { $_ })
$issues = New-Object System.Collections.Generic.List[object]
function Add-Issue([string]$Sev, [string]$Msg) { $issues.Add([pscustomobject]@{ Severity = $Sev; Message = $Msg }) }

function Set-NF([string]$Name, $Value) {
    if ($SkipNinjaFields) { return }
    if (Get-Command Ninja-Property-Set -ErrorAction SilentlyContinue) {
        try { Ninja-Property-Set $Name $Value } catch { Write-Host "[info] Campo '$Name' non impostato: $($_.Exception.Message)" }
    } else {
        Write-Host "[info] Ninja-Property-Set non disponibile: campo '$Name' saltato"
    }
}

function Get-DirSizeMB([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $s = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if ($null -eq $s) { return 0 }
    [math]::Round($s / 1MB, 0)
}

function Get-ExtName([string]$ExtDir) {
    $ver = Get-ChildItem -LiteralPath $ExtDir -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $ver) { return $null }
    $mf = Join-Path $ver.FullName 'manifest.json'
    if (-not (Test-Path -LiteralPath $mf)) { return $null }
    try { $m = Get-Content -LiteralPath $mf -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
    $name = [string]$m.name
    if ($name -match '^__MSG_(.+)__$') {
        $key = $Matches[1]
        foreach ($loc in 'it', 'en', 'en_US') {
            $lf = Join-Path $ver.FullName "_locales\$loc\messages.json"
            if (Test-Path -LiteralPath $lf) {
                try {
                    $j = Get-Content -LiteralPath $lf -Raw -Encoding UTF8 | ConvertFrom-Json
                    $prop = $j.PSObject.Properties | Where-Object { $_.Name -ieq $key } | Select-Object -First 1
                    if ($prop) { return [string]$prop.Value.message }
                } catch { }
            }
        }
    }
    return $name
}

# ---------------------------------------------------------------- Sistema
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
$freeRamGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$freeRamPct = if ($ramGB -gt 0) { [math]::Round(($freeRamGB / $ramGB) * 100, 0) } else { 0 }
$uptimeDays = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalDays, 1)

$sysDrive = $env:SystemDrive
$ld = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$sysDrive'"
$freeDiskGB = [math]::Round($ld.FreeSpace / 1GB, 1)
$diskType = 'N/D'
try {
    $part = Get-Partition -DriveLetter $sysDrive.TrimEnd(':') -ErrorAction Stop
    $pd = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq $part.DiskNumber } | Select-Object -First 1
    if ($pd.MediaType) { $diskType = [string]$pd.MediaType }
} catch { }

# TotalPhysicalMemory esclude la RAM riservata a GPU integrata/hardware (8 GB fisici ~ 7,4-7,9 GB): si confronta il valore arrotondato per eccesso
$ramCmp = [math]::Ceiling($cs.TotalPhysicalMemory / 1GB)
if ($ramCmp -le 4) { Add-Issue 'CRIT' "RAM installata $ramGB GB (insufficiente per Chrome)" }
elseif ($ramCmp -lt $MinRamGB) { Add-Issue 'WARN' "RAM installata $ramGB GB (minimo consigliato $MinRamGB GB)" }
if ($diskType -eq 'HDD') { Add-Issue 'WARN' 'Disco di sistema meccanico (HDD)' }
if ($freeDiskGB -lt $MinFreeDiskGB) { Add-Issue 'WARN' "Spazio libero su $sysDrive solo $freeDiskGB GB" }
# Con Avvio rapido (HiberbootEnabled=1) "Arresta" non azzera LastBootUpTime: l'uptime non e' affidabile
$fastStartup = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -ErrorAction SilentlyContinue).HiberbootEnabled -eq 1
if ($uptimeDays -gt $UptimeWarnDays) {
    if ($fastStartup) { Add-Issue 'INFO' "Uptime $uptimeDays gg non affidabile (Avvio rapido attivo): verificare riavvii reali" }
    else { Add-Issue 'WARN' "PC acceso senza riavvio da $uptimeDays giorni" }
}

# ---------------------------------------------------------------- Chrome installato
$chromeExe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$perUserInstall = $false
if (-not $chromeExe) {
    # Installazione per singolo utente (%LOCALAPPDATA%\Google\Chrome\Application)
    $chromeExe = Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special -and $_.LocalPath } |
        ForEach-Object { Join-Path $_.LocalPath 'AppData\Local\Google\Chrome\Application\chrome.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($chromeExe) { $perUserInstall = $true; Add-Issue 'INFO' 'Chrome installato per singolo utente (non gestito dal MSI aziendale)' }
}

if (-not $chromeExe) {
    Write-Host 'Chrome non installato: nessun controllo eseguito.'
    Set-NF 'chromehealthstatus' 'N/A'
    Set-NF 'chromehealthsummary' 'Chrome non installato'
    Set-NF 'chromehealthlastrun' (Get-Date -Format 'yyyy-MM-dd HH:mm')
    exit 0
}

$chromeVer = (Get-Item -LiteralPath $chromeExe).VersionInfo.ProductVersion
$verDir = Join-Path (Split-Path $chromeExe) $chromeVer
$chromeAgeDays = $null
if (Test-Path -LiteralPath $verDir) {
    $chromeAgeDays = [int]((Get-Date) - (Get-Item -LiteralPath $verDir).CreationTime).TotalDays
    if ($chromeAgeDays -gt $ChromeAgeWarnDays) { Add-Issue 'WARN' "Chrome $chromeVer non aggiornato da $chromeAgeDays giorni" }
}

# ---------------------------------------------------------------- Processi Chrome (istantanea)
$cp = @(Get-Process -Name chrome -ErrorAction SilentlyContinue)
$chromeProcs = $cp.Count
$chromeMB = 0
if ($chromeProcs -gt 0) {
    # Working set PRIVATO (stesso dato di Gestione attivita'): RAM fisica realmente usata, senza le pagine condivise.
    # PrivateMemorySize64 (committed) e WorkingSet64 sommato sui processi sovrastimano. Fallback su WorkingSet64.
    $wsp = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name LIKE 'chrome%'" -ErrorAction SilentlyContinue
    if ($wsp) { $chromeMB = [math]::Round((($wsp | Measure-Object WorkingSetPrivate -Sum).Sum) / 1MB, 0) }
    else { $chromeMB = [math]::Round((($cp | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 0) }
    if ($chromeMB -ge $ChromeRamCritMB) { Add-Issue 'CRIT' "Chrome usa $chromeMB MB di RAM ($chromeProcs processi)" }
    elseif ($chromeMB -ge $ChromeRamWarnMB) { Add-Issue 'WARN' "Chrome usa $chromeMB MB di RAM ($chromeProcs processi)" }
    if ($chromeProcs -gt $ChromeProcWarn) { Add-Issue 'WARN' "Chrome ha $chromeProcs processi attivi" }
    if ($freeRamPct -lt 10) { Add-Issue 'WARN' "RAM libera al $freeRamPct% con Chrome in uso" }
}

# ---------------------------------------------------------------- Policy GPO
$polKey = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$pol = Get-ItemProperty -Path $polKey -ErrorAction SilentlyContinue
$polNotes = @()
$expected = [ordered]@{ HighEfficiencyModeEnabled = 1; BackgroundModeEnabled = 0; StartupBoostEnabled = 0 }
foreach ($n in $expected.Keys) {
    $v = $null
    if ($pol) { $v = $pol.$n }
    if ($null -eq $v) { $polNotes += "$n non impostata" }
    elseif ($v -ne $expected[$n]) { $polNotes += "$n=$v (atteso $($expected[$n]))" }
}
if ($polNotes.Count -gt 0) { Add-Issue 'INFO' ('Policy di ottimizzazione: ' + ($polNotes -join '; ')) }
if ($pol -and (($pol.UserDataDir -like '\\*') -or ($pol.DiskCacheDir -like '\\*'))) {
    Add-Issue 'CRIT' 'Policy UserDataDir/DiskCacheDir punta a un percorso di rete'
}
$fl = Get-Item -Path "$polKey\ExtensionInstallForcelist" -ErrorAction SilentlyContinue
$forcedIds = @()
if ($fl) {
    $vals = @($fl.GetValueNames() | ForEach-Object { $fl.GetValue($_) })
    $forcedIds = @($vals | ForEach-Object { ($_ -split ';')[0] } | Sort-Object -Unique)
    $dups = @($vals | Group-Object | Where-Object { $_.Count -gt 1 })
    if ($dups.Count -gt 0) { Add-Issue 'INFO' "ExtensionInstallForcelist con $($vals.Count) voci ma $($dups.Count) duplicate (GPO ripetuta?)" }
}

# ---------------------------------------------------------------- Profili utente
$userReports = @()
$maxExt = 0
$profiles = Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special -and $_.LocalPath }
foreach ($p in $profiles) {
    $user = Split-Path $p.LocalPath -Leaf
    $ud = Join-Path $p.LocalPath 'AppData\Local\Google\Chrome\User Data'
    if (-not (Test-Path -LiteralPath $ud)) { continue }
    if ($p.LastUseTime -and ((Get-Date) - $p.LastUseTime).TotalDays -gt 60) { continue }

    $pdirs = @(Get-ChildItem -LiteralPath $ud -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' })
    $profMB = 0; $cacheMB = 0
    $ext = @{}
    foreach ($pd in $pdirs) {
        $profMB += Get-DirSizeMB $pd.FullName
        foreach ($c in 'Cache', 'Code Cache', 'GPUCache', 'Service Worker\CacheStorage') {
            $cacheMB += Get-DirSizeMB (Join-Path $pd.FullName $c)
        }
        $extRoot = Join-Path $pd.FullName 'Extensions'
        Get-ChildItem -LiteralPath $extRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'Temp' } | ForEach-Object {
            if (-not $ext.ContainsKey($_.Name)) {
                $nm = Get-ExtName $_.FullName
                if (-not $nm) { $nm = '(nome non rilevato)' }
                $ext[$_.Name] = $nm
            }
        }
    }
    if ($ext.Count -gt $maxExt) { $maxExt = $ext.Count }

    $tag = "[$user]"
    if ($profMB -ge $ProfileWarnMB) { Add-Issue 'WARN' "$tag profilo Chrome da $profMB MB" }
    if ($cacheMB -ge $CacheWarnMB) { Add-Issue 'WARN' "$tag cache Chrome da $cacheMB MB" }
    if ($pdirs.Count -gt 3) { Add-Issue 'WARN' "$tag $($pdirs.Count) profili Chrome" }
    # Il limite considera solo le estensioni NON forzate da GPO
    $extFree = @($ext.Keys | Where-Object { $forcedIds -notcontains $_ })
    if ($extFree.Count -gt $ExtWarn) { Add-Issue 'WARN' "$tag $($extFree.Count) estensioni oltre a quelle forzate da GPO ($($ext.Count) totali)" }
    if ($approved.Count -gt 0) {
        $unk = @($ext.Keys | Where-Object { $approved -notcontains $_ })
        if ($unk.Count -gt 0) {
            $list = ($unk | ForEach-Object { "$($ext[$_]) [$_]" }) -join '; '
            Add-Issue 'WARN' "$tag estensioni non approvate: $list"
        }
    }
    if ($p.RoamingConfigured) { Add-Issue 'CRIT' "$tag profilo Windows roaming (Chrome rallenta)" }
    try {
        $drv = New-Object System.IO.DriveInfo($ud.Substring(0, 1))
        if ($drv.DriveType -eq 'Network') { Add-Issue 'CRIT' "$tag cartella dati Chrome su unita' di rete" }
    } catch { }
    $shell = "Registry::HKEY_USERS\$($p.SID)\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
    $la = (Get-ItemProperty -Path $shell -ErrorAction SilentlyContinue).'Local AppData'
    if ($la -like '\\*') { Add-Issue 'CRIT' "$tag Local AppData ridiretto su rete: $la" }

    $userReports += [pscustomobject]@{
        Utente = $user; Profili = $pdirs.Count; ProfiloMB = $profMB; CacheMB = $cacheMB
        Estensioni = ($ext.Keys | ForEach-Object { "$($ext[$_]) [$_]" }) -join '; '
    }
}

# ---------------------------------------------------------------- Stato e report
$crit = @($issues | Where-Object Severity -eq 'CRIT').Count
$warn = @($issues | Where-Object Severity -eq 'WARN').Count
$status = if ($crit -gt 0) { 'CRITICO' } elseif ($warn -gt 0) { 'ATTENZIONE' } else { 'OK' }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("=== Chrome Health Check - $env:COMPUTERNAME - $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===")
[void]$sb.AppendLine("STATO: $status  (critici: $crit, avvisi: $warn)")
[void]$sb.AppendLine('')
[void]$sb.AppendLine("Sistema : RAM $ramGB GB (libera $freeRamGB GB, $freeRamPct%) | Disco $sysDrive $diskType, libero $freeDiskGB GB | Uptime $uptimeDays gg")
$ageTxt = if ($null -ne $chromeAgeDays) { ", aggiornato $chromeAgeDays gg fa" } else { '' }
[void]$sb.AppendLine("Chrome  : versione $chromeVer$ageTxt | processi $chromeProcs | RAM (working set privato) $chromeMB MB")
if ($chromeProcs -eq 0) { [void]$sb.AppendLine('          (Chrome non e'' in esecuzione: dati di memoria non significativi)') }
[void]$sb.AppendLine('')
if ($issues.Count -gt 0) {
    [void]$sb.AppendLine('Segnalazioni:')
    foreach ($i in ($issues | Sort-Object { switch ($_.Severity) { 'CRIT' { 0 } 'WARN' { 1 } default { 2 } } })) {
        [void]$sb.AppendLine("  [$($i.Severity)] $($i.Message)")
    }
} else {
    [void]$sb.AppendLine('Nessuna segnalazione.')
}
if ($userReports.Count -gt 0) {
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('Utenti:')
    foreach ($u in $userReports) {
        [void]$sb.AppendLine("  $($u.Utente): profili $($u.Profili), profilo $($u.ProfiloMB) MB, cache $($u.CacheMB) MB")
        [void]$sb.AppendLine("    Estensioni: $($u.Estensioni)")
    }
}
$report = $sb.ToString()
Write-Host $report

# ---------------------------------------------------------------- Campi NinjaOne
$top = @($issues | Where-Object { $_.Severity -ne 'INFO' } | Select-Object -First 3 | ForEach-Object { $_.Message }) -join ' | '
$summary = if ($top) { $top } else { 'Nessuna anomalia' }
if ($summary.Length -gt 190) { $summary = $summary.Substring(0, 187) + '...' }
$details = if ($report.Length -gt 9500) { $report.Substring(0, 9500) } else { $report }

Set-NF 'chromehealthstatus' $status
Set-NF 'chromehealthsummary' $summary
Set-NF 'chromehealthdetails' $details
Set-NF 'chromehealthlastrun' (Get-Date -Format 'yyyy-MM-dd HH:mm')
Set-NF 'chromerammb' $chromeMB
Set-NF 'chromeextmax' $maxExt

if ($FailOnIssue -and $status -ne 'OK') { exit 1 }
exit 0
