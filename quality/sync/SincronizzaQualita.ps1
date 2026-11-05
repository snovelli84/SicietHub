<#
  SICIET QUALITY – SINCRONIZZAZIONE TEAMS → SERVER DEI FILE
  ----------------------------------------------------------
  Copia sul server dei file quello che SICIET Quality salva nella cartella
  "Schede componenti" del sito SharePoint/Teams "SICIET Qualità", a senso
  unico (Teams → server). Si avvia ogni 15 minuti dall'Utilità di
  pianificazione (vedi Installa.ps1 e README.md).

  Dove finiscono i file: la commessa dell'app (es. S1852V31) indica la
  cartella di commessa sul server; dentro, una cartella per JOB (una
  commessa può avere più JOB) e una per TAG:
    <BaseCommesse>\1852 …\V31-…\Qualità Componenti APP\<JOB>\<TAG>\…
    <BaseCommesse>\1852 …\V31-…\Qualità Componenti APP\<JOB>\Generico\…
  (cartella che inizia con il numero 1852, poi sotto-cartella che inizia con
  V02). Le eccezioni si scrivono in mappa-commesse.csv.

  - File nuovi o modificati su Teams: copiati (o aggiornati) sul server.
  - File cancellati su Teams: sul server NON vengono cancellati, ma
    rinominati "CANCELLED_<nome>". Se vengono ripristinati dal cestino di
    Teams riprendono il nome originale.
  - Commesse senza cartella sul server: segnalate nel registro e copiate
    appena la cartella esiste (o c'è una riga in mappa-commesse.csv).

  Legge da SharePoint solo le modifiche dall'ultimo giro (Microsoft Graph,
  "delta"), con l'app "SICIET Quality Sync" registrata in Entra ID con
  permesso di sola lettura sul sito. Scritto per Windows PowerShell 5.1
  (Windows Server 2016). Il file va salvato in UTF-8 con BOM (per le lettere
  accentate).
#>
param(
  # Registrazione dell'app in Entra ID (sola lettura sul sito SICIET Qualità).
  [string]$TenantId = "5c055224-300a-4b03-8742-552b7dd79f62",
  [string]$ClientId = "",
  # Segreto client cifrato da Installa.ps1 (leggibile solo da questo computer).
  [string]$FileSegreto = "C:\SicietQualitySync\segreto.dat",

  # Dove sono le schede su SharePoint.
  [string]$Sito = "srlsiciet.sharepoint.com:/sites/SICIETQualit",
  [string]$CartellaSharePoint = "Qualità/Schede componenti",

  # Dove vanno sul server.
  [string]$BaseCommesse = "D:\Siciet\SICIET Commesse",
  [string]$Sottocartella = "Qualità Componenti APP",
  # $true: sul server non si crea la cartella del JOB (solo se ogni commessa ha un solo JOB).
  [bool]$SaltaCartellaJob = $false,
  [string]$FileMappa = "",

  # Stato della sincronizzazione e registri.
  [string]$FileStato = "C:\SicietQualitySync\stato.json",
  [string]$CartellaLog = "C:\SicietQualitySync\log",

  # Solo per le prove.
  [string]$SegretoInChiaro = "",
  [string]$GraphBase = "https://graph.microsoft.com/v1.0",
  [string]$LoginBase = "https://login.microsoftonline.com"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if(-not $FileMappa){ $FileMappa = [IO.Path]::Combine($PSScriptRoot, "mappa-commesse.csv") }
$PREFISSO_ANNULLATO = "CANCELLED_"

# ---------- Registro ----------

if(-not (Test-Path -LiteralPath $CartellaLog)){ New-Item -ItemType Directory -Path $CartellaLog -Force | Out-Null }
$fileLog = [IO.Path]::Combine($CartellaLog, "sincronizzazione-" + (Get-Date -Format "yyyy-MM") + ".log")
function Scrivi([string]$testo){
  $riga = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $testo
  Add-Content -LiteralPath $fileLog -Value $riga -Encoding UTF8
  Write-Host $riga   # non Write-Output: finirebbe nel risultato delle funzioni che scrivono nel registro
}

# Un solo giro alla volta (se il precedente è ancora in corso, si salta).
$mutex = New-Object System.Threading.Mutex($false, "Global\SicietQualitySync")
if(-not $mutex.WaitOne(0)){ Scrivi "Giro precedente ancora in corso: salto."; exit 0 }

# ---------- Utilità ----------

# JSON → hashtable (PowerShell 5.1 non ha ConvertFrom-Json -AsHashtable).
function In-Hash($o){
  if($null -eq $o){ return $null }
  if($o -is [System.Management.Automation.PSCustomObject]){
    $h = @{}
    foreach($p in $o.PSObject.Properties){ $h[$p.Name] = In-Hash $p.Value }
    return $h
  }
  if($o -is [System.Collections.IEnumerable] -and -not ($o -is [string])){ return @($o | ForEach-Object { In-Hash $_ }) }
  return $o
}

function Leggi-Stato {
  if(Test-Path -LiteralPath $FileStato){
    $s = In-Hash (Get-Content -LiteralPath $FileStato -Raw -Encoding UTF8 | ConvertFrom-Json)
    if(-not $s.voci){ $s.voci = @{} }
    return $s
  }
  return @{ delta = $null; voci = @{} }
}
function Salva-Stato($s){
  $dir = [IO.Path]::GetDirectoryName($FileStato)
  if(-not (Test-Path -LiteralPath $dir)){ New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $tmp = $FileStato + ".tmp"
  [IO.File]::WriteAllText($tmp, ($s | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $FileStato -Force
}

function Segreto {
  if($SegretoInChiaro){ return $SegretoInChiaro }
  Add-Type -AssemblyName System.Security
  $b = [IO.File]::ReadAllBytes($FileSegreto)
  return [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, "LocalMachine"))
}

# Data di modifica come testo ISO (PowerShell 7 converte da solo le date del JSON).
function Testo-Data($d){
  if($d -is [DateTime]){ return $d.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [Globalization.CultureInfo]::InvariantCulture) }
  return [string]$d
}

# ---------- Microsoft Graph ----------

$script:token = $null
$script:scade = Get-Date
function Token {
  if($script:token -and (Get-Date) -lt $script:scade){ return $script:token }
  try{
    $r = Invoke-RestMethod -Method Post -Uri "$LoginBase/$TenantId/oauth2/v2.0/token" -Body @{
      client_id = $ClientId; client_secret = (Segreto); scope = "https://graph.microsoft.com/.default"; grant_type = "client_credentials"
    }
  }catch{
    # Es. AADSTS7000215 = segreto client sbagliato, AADSTS7000222 = segreto scaduto: rieseguire Installa.ps1.
    $motivo = $_.Exception.Message
    if($_.ErrorDetails -and $_.ErrorDetails.Message){
      try{ $motivo = ($_.ErrorDetails.Message | ConvertFrom-Json).error_description }catch{ $motivo = $_.ErrorDetails.Message }
    }
    throw ("Accesso a Microsoft non riuscito (controllare ID applicazione e segreto, rieseguendo Installa.ps1): " + $motivo)
  }
  $script:token = $r.access_token
  $script:scade = (Get-Date).AddSeconds([int]$r.expires_in - 120)
  return $script:token
}
# Autorizzazioni (roles) contenute nell'accesso: per capire gli errori 401/403.
function Ruoli-Token {
  try{
    $p = $script:token.Split(".")[1].Replace("-", "+").Replace("_", "/")
    while($p.Length % 4){ $p += "=" }
    $d = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
    $r = @($d.roles) -join ", "
    if(-not $r){ $r = "nessuna" }
    return $r + " (app " + $d.appid + ", tenant " + $d.tid + ")"
  }catch{ return "non leggibili" }
}
function Graph([string]$url){
  if(-not $url.StartsWith("http")){ $url = $GraphBase + $url }
  for($t = 1; ; $t++){
    $accesso = Token   # fuori dal try: un errore di accesso non va scambiato per un errore di SharePoint
    try{
      return Invoke-RestMethod -Method Get -Uri $url -Headers @{ Authorization = "Bearer " + $accesso }
    }catch{
      $codice = 0
      if($_.Exception.Response){ $codice = [int]$_.Exception.Response.StatusCode }
      # Troppe richieste o servizio occupato: si riprova con attese crescenti.
      if(($codice -eq 429 -or $codice -ge 500) -and $t -lt 5){ Start-Sleep -Seconds (5 * $t); continue }
      # Motivo dato da Microsoft (corpo della risposta) e, per 401/403, le autorizzazioni dell'accesso.
      $motivo = ""
      if($_.ErrorDetails -and $_.ErrorDetails.Message){
        try{ $motivo = " – " + (($_.ErrorDetails.Message | ConvertFrom-Json).error.message) }catch{ $motivo = " – " + $_.ErrorDetails.Message }
      }
      if($codice -eq 401 -or $codice -eq 403){ $motivo += " – autorizzazioni dell'accesso: " + (Ruoli-Token) }
      $e = New-Object Exception("Graph $codice su $url : " + $_.Exception.Message + $motivo)
      $e.Data["codice"] = $codice
      throw $e
    }
  }
}
function Scarica([string]$id, [string]$destinazione, [string]$modifica){
  $dir = [IO.Path]::GetDirectoryName($destinazione)
  if(-not (Test-Path -LiteralPath $dir)){ New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $tmp = $destinazione + ".sync-tmp"
  Invoke-WebRequest -Uri "$GraphBase/drives/$($script:drive)/items/$id/content" -Headers @{ Authorization = "Bearer " + (Token) } -OutFile $tmp -UseBasicParsing | Out-Null
  Move-Item -LiteralPath $tmp -Destination $destinazione -Force
  if($modifica){
    try{ (Get-Item -LiteralPath $destinazione).LastWriteTimeUtc = [DateTime]::Parse($modifica, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]"AdjustToUniversal,AssumeUniversal") }catch{}
  }
}

# ---------- Commessa dell'app → cartella sul server ----------

$mappa = @{}
if(Test-Path -LiteralPath $FileMappa){
  foreach($r in (Import-Csv -LiteralPath $FileMappa -Delimiter ";" -Encoding UTF8)){
    if($r.Commessa -and -not $r.Commessa.StartsWith("#") -and $r.Cartella){ $mappa[$r.Commessa.Trim().ToUpper()] = $r.Cartella.Trim() }
  }
}
$cacheCartelle = @{}
$nonTrovate = @{}

# Cartella "Qualità Componenti APP" della commessa, o $null se non si trova.
function Cartella-Commessa([string]$commessa){
  $k = $commessa.ToUpper()
  if($cacheCartelle.ContainsKey($k)){ return $cacheCartelle[$k] }
  $dir = $null
  if($mappa.ContainsKey($k)){
    $dir = $mappa[$k]
    if(-not [IO.Path]::IsPathRooted($dir)){ $dir = [IO.Path]::Combine($BaseCommesse, $dir) }
    if(-not (Test-Path -LiteralPath $dir)){ $dir = $null }
  }elseif($k -match '^S?\s*(\d{3,5})\s*[-_ ]?\s*(?:V\s*(\d{1,3}))?$'){
    $numero = $Matches[1].TrimStart("0")
    $variante = if($Matches[2]){ "V" + $Matches[2].PadLeft(2, "0") } else { "" }
    $base = @(Get-ChildItem -LiteralPath $BaseCommesse -Directory | Where-Object { $_.Name -match ("^0*" + $numero + "(\D|$)") })
    if($base.Count -eq 1){
      if(-not $variante){
        $dir = $base[0].FullName
      }else{
        $sotto = @(Get-ChildItem -LiteralPath $base[0].FullName -Directory | Where-Object { $_.Name -match ("^" + $variante + "(\D|$)") })
        if($sotto.Count -eq 1){ $dir = $sotto[0].FullName }
        elseif($sotto.Count -gt 1){ Scrivi "ATTENZIONE: più cartelle $variante in '$($base[0].FullName)' per la commessa ${commessa}: aggiungere una riga in mappa-commesse.csv." }
      }
    }elseif($base.Count -gt 1){ Scrivi "ATTENZIONE: più cartelle di commessa che iniziano con $numero per ${commessa}: aggiungere una riga in mappa-commesse.csv." }
  }
  if($dir){ $dir = [IO.Path]::Combine($dir, $Sottocartella) }
  elseif(-not $nonTrovate.ContainsKey($k)){ $nonTrovate[$k] = 1; Scrivi "Commessa $commessa senza cartella sul server: i suoi file restano in attesa." }
  $cacheCartelle[$k] = $dir
  return $dir
}

# Percorso sul server di un file, dal percorso relativo su SharePoint
# ("S1852V31/1105618/P-101A/Foto/x.jpg" → "…\Qualità Componenti APP\1105618\P-101A\Foto\x.jpg");
# $null se la commessa non ha cartella.
function Percorso-Locale([string]$rel){
  $parti = $rel.Split("/")
  if($parti.Count -lt 2){ return $null }
  $dir = Cartella-Commessa $parti[0]
  if(-not $dir){ return $null }
  $da = 1
  if($SaltaCartellaJob -and $parti.Count -ge 3){ $da = 2 }   # salta la cartella del JOB
  $resto = $parti[$da..($parti.Count - 1)]
  return [IO.Path]::Combine([string[]](@($dir) + $resto))
}

# Rinomina un file in "CANCELLED_<nome>" (con (2), (3)… se esiste già).
function Annulla($voce){
  if(-not $voce.locale -or -not (Test-Path -LiteralPath $voce.locale)){ return $false }
  $dir = [IO.Path]::GetDirectoryName($voce.locale)
  $nome = [IO.Path]::GetFileNameWithoutExtension($voce.locale)
  $est = [IO.Path]::GetExtension($voce.locale)
  $nuovo = [IO.Path]::Combine($dir, $PREFISSO_ANNULLATO + $nome + $est)
  for($n = 2; Test-Path -LiteralPath $nuovo; $n++){ $nuovo = [IO.Path]::Combine($dir, $PREFISSO_ANNULLATO + $nome + " ($n)" + $est) }
  Move-Item -LiteralPath $voce.locale -Destination $nuovo
  $voce.annullato = $nuovo
  return $true
}

# ---------- Giro di sincronizzazione ----------

$conta = @{ nuovi = 0; aggiornati = 0; spostati = 0; annullati = 0; ripristinati = 0; inAttesa = 0 }
try{
  if(-not $ClientId){ throw "Manca ClientId (app SICIET Quality Sync) in testa allo script." }
  $stato = Leggi-Stato
  $voci = $stato.voci

  $sitoId = (Graph "/sites/$Sito`?`$select=id").id
  $script:drive = (Graph "/sites/$sitoId/drive?`$select=id").id
  $radice = "/" + $CartellaSharePoint.Trim("/")

  function Rel-Da($item){
    if(-not $item.parentReference -or -not $item.parentReference.path){ return $null }
    $p = $item.parentReference.path
    $i = $p.IndexOf("root:")
    if($i -lt 0){ return $null }
    $p = [Uri]::UnescapeDataString($p.Substring($i + 5))
    if(-not $p){ $p = "" }
    $completo = ($p.TrimEnd("/") + "/" + $item.name)
    if(-not $completo.StartsWith($radice + "/", [StringComparison]::OrdinalIgnoreCase)){ return $null }
    return $completo.Substring($radice.Length + 1)
  }

  function Gestisci-File($item, [string]$rel){
    # I file nella cartella principale (es. il riepilogo di tutte le commesse) non riguardano una commessa.
    if($rel.IndexOf("/") -lt 0){ return }
    $id = $item.id
    $v = $voci[$id]
    if(-not $v){ $v = @{ tipo = "file" }; $voci[$id] = $v }
    $locale = Percorso-Locale $rel
    $v.rel = $rel; $v.mod = Testo-Data $item.lastModifiedDateTime; $v.dim = [long]$item.size
    if(-not $locale){ $v.inAttesa = $true; return }
    $v.inAttesa = $false
    # Ripristinato dal cestino di Teams: riprende il nome originale.
    if($v.cancellato -and $v.annullato -and (Test-Path -LiteralPath $v.annullato) -and -not (Test-Path -LiteralPath $locale)){
      Move-Item -LiteralPath $v.annullato -Destination $locale
      $conta.ripristinati++
      Scrivi "Ripristinato: $locale"
    }
    $v.cancellato = $false; $v.annullato = $null
    # Spostato o rinominato su Teams: si sposta anche sul server.
    if($v.locale -and $v.locale -ne $locale -and (Test-Path -LiteralPath $v.locale) -and -not (Test-Path -LiteralPath $locale)){
      $d = [IO.Path]::GetDirectoryName($locale)
      if(-not (Test-Path -LiteralPath $d)){ New-Item -ItemType Directory -Path $d -Force | Out-Null }
      Move-Item -LiteralPath $v.locale -Destination $locale
      $conta.spostati++
    }
    $uguale = (Test-Path -LiteralPath $locale) -and $v.scaricato -eq ($v.mod + "|" + $v.dim)
    $v.locale = $locale
    if($uguale){ return }
    $nuovo = -not (Test-Path -LiteralPath $locale)
    Scarica $id $locale $v.mod
    $v.scaricato = $v.mod + "|" + $v.dim
    if($nuovo){ $conta.nuovi++ } else { $conta.aggiornati++ }
  }

  function Gestisci-Cancellato($item){
    $v = $voci[$item.id]
    if(-not $v){ return }
    if($v.tipo -eq "cartella"){
      # Cartella cancellata: si annullano i file che conteneva.
      foreach($k in @($voci.Keys)){
        $f = $voci[$k]
        if($f.tipo -eq "file" -and -not $f.cancellato -and $f.rel -and $f.rel.StartsWith($v.rel + "/")){
          if(Annulla $f){ $conta.annullati++; Scrivi "Annullato (cartella cancellata su Teams): $($f.annullato)" }
          $f.cancellato = $true
        }
      }
      $voci.Remove($item.id)
      return
    }
    if(-not $v.cancellato){
      if(Annulla $v){ $conta.annullati++; Scrivi "Annullato (cancellato su Teams): $($v.annullato)" }
      $v.cancellato = $true
    }
  }

  # Modifiche dall'ultimo giro (al primo giro: tutto).
  $url = $stato.delta
  if(-not $url){ $url = "/drives/$($script:drive)/root/delta?`$select=id,name,file,folder,deleted,parentReference,lastModifiedDateTime,size" }
  while($url){
    try{
      $pagina = Graph $url
    }catch{
      if($_.Exception.Data["codice"] -eq 410){
        Scrivi "Elenco delle modifiche scaduto su SharePoint: rilettura completa."
        $stato.delta = $null
        $url = "/drives/$($script:drive)/root/delta?`$select=id,name,file,folder,deleted,parentReference,lastModifiedDateTime,size"
        continue
      }
      throw
    }
    foreach($item in $pagina.value){
      if($item.deleted){ Gestisci-Cancellato $item; continue }
      $rel = Rel-Da $item
      if(-not $rel){ continue }
      if($item.folder){
        $v = $voci[$item.id]
        if(-not $v){ $v = @{ tipo = "cartella" }; $voci[$item.id] = $v }
        $v.rel = $rel
        continue
      }
      if($item.file){
        try{ Gestisci-File $item $rel }catch{ Scrivi "ERRORE su $rel : $($_.Exception.Message)" }
      }
    }
    if($pagina.'@odata.nextLink'){ $url = $pagina.'@odata.nextLink' }
    else{ $stato.delta = $pagina.'@odata.deltaLink'; $url = $null }
    Salva-Stato $stato
  }

  # File di commesse che prima non avevano una cartella sul server.
  foreach($k in @($voci.Keys)){
    $v = $voci[$k]
    if($v.tipo -ne "file" -or -not $v.inAttesa -or $v.cancellato){ continue }
    $locale = Percorso-Locale $v.rel
    if(-not $locale){ $conta.inAttesa++; continue }
    try{
      $v.mod = Testo-Data $v.mod
      Scarica $k $locale $v.mod
      $v.locale = $locale; $v.inAttesa = $false; $v.scaricato = $v.mod + "|" + $v.dim
      $conta.nuovi++
    }catch{ Scrivi "ERRORE su $($v.rel) : $($_.Exception.Message)" }
  }
  Salva-Stato $stato

  Scrivi ("Fine giro: {0} nuovi, {1} aggiornati, {2} spostati, {3} annullati (CANCELLED_), {4} ripristinati, {5} in attesa di una cartella di commessa." -f `
    $conta.nuovi, $conta.aggiornati, $conta.spostati, $conta.annullati, $conta.ripristinati, $conta.inAttesa)
}catch{
  Scrivi "ERRORE: $($_.Exception.Message)"
  exit 1
}finally{
  $mutex.ReleaseMutex()
}
