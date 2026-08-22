param(
  [int]$StartUid = 1,
  [int]$EndUid = 80000,
  [int]$Retries = 3,
  [int]$SaveEvery = 100,
  [int]$StatusEvery = 1,
  [int]$DelayMs = 120,
  [switch]$Resume
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dbPath = Join-Path $root "data\db.json"
$statePath = Join-Path $root "data\gas-sync-state.json"
$failPath = Join-Path $root "data\gas-sync-failed.txt"

if ($StartUid -lt 1 -or $EndUid -lt $StartUid) {
  throw "Usage: .\sync-gas-users.ps1 -StartUid 1 -EndUid 80000"
}

function Read-JsonFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Write-JsonFile {
  param(
    [string]$Path,
    $Value,
    [int]$Depth = 16
  )
  $tmp = "$Path.tmp"
  $json = $Value | ConvertTo-Json -Depth $Depth
  $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [System.IO.File]::WriteAllText($tmp, $json, $utf8NoBom)
  Move-Item -Force -LiteralPath $tmp -Destination $Path
}

function Read-Db {
  $db = Read-JsonFile -Path $dbPath
  if (-not $db) {
    $db = [pscustomobject]@{}
  }
  if (-not $db.gasUsers) {
    $db | Add-Member -NotePropertyName gasUsers -NotePropertyValue @()
  }
  return $db
}

function Write-State {
  param(
    [int]$CurrentUid,
    [int]$NextUid,
    [int]$Checked,
    [int]$Found,
    [string]$Status
  )
  $state = [pscustomobject]@{
    currentUid = $CurrentUid
    nextUid = $NextUid
    startUid = $script:runStartUid
    endUid = $script:endUid
    checked = $Checked
    total = $script:rangeTotal
    cached = $script:merged.Count
    foundThisRun = $Found
    status = $Status
    updatedAt = (Get-Date).ToString("o")
  }
  Write-JsonFile -Path $statePath -Value $state -Depth 4
}

function Save-Db {
  param($Db)
  $Db.gasUsers = @($script:merged.Values | Sort-Object { [int]$_.uid })
  Write-JsonFile -Path $dbPath -Value $Db -Depth 16
}

function Convert-GasUser {
  param(
    [int]$Uid,
    $Payload
  )
  $data = $Payload.data
  $nickname = [string]$data.nickname
  if ([string]::IsNullOrWhiteSpace($nickname)) { return $null }

  return [pscustomobject]@{
    uid = [string]$Uid
    nickname = $nickname.Trim()
    avatar = [string]$data.avatar
    vType = $data.v_type
    vInfo = [string]$data.v_info
    url = "https://chinadlrs.com/space/$Uid"
    updatedAt = (Get-Date).ToString("o")
  }
}

function Fetch-GasUser {
  param([int]$Uid)

  $headers = @{
    "User-Agent" = "Mozilla/5.0"
    "Accept" = "application/json,text/plain,*/*"
    "Origin" = "https://chinadlrs.com"
    "Referer" = "https://chinadlrs.com/space/$Uid"
  }

  for ($attempt = 0; $attempt -le $Retries; $attempt++) {
    try {
      $response = Invoke-WebRequest `
        -UseBasicParsing `
        -Headers $headers `
        -Uri "https://api.chinadlrs.com/v1/user/get-space.php?uid=$Uid" `
        -TimeoutSec 15

      $payload = $response.Content | ConvertFrom-Json
      if ($payload.code -eq 200 -and $payload.data -and $payload.data.nickname) {
        return Convert-GasUser -Uid $Uid -Payload $payload
      }
      return $null
    } catch {
      if ($attempt -ge $Retries) {
        Add-Content -Encoding UTF8 -Path $failPath -Value $Uid
        return $null
      }
      Start-Sleep -Milliseconds (500 + ($attempt * 800))
    }
  }
}

if ($Resume -and (Test-Path $statePath)) {
  $state = Read-JsonFile -Path $statePath
  if ($state -and $state.nextUid) {
    $resumeUid = [int]$state.nextUid
    if (($resumeUid -gt $StartUid) -and ($resumeUid -le $EndUid)) {
      $StartUid = $resumeUid
      Write-Host ("继续同步，从 UID {0} 开始" -f $StartUid)
    }
  }
}

$db = Read-Db
$script:merged = @{}
foreach ($item in @($db.gasUsers)) {
  if ($item.uid) {
    $script:merged[[string]$item.uid] = $item
  }
}

$script:runStartUid = $StartUid
$script:endUid = $EndUid
$script:rangeTotal = $EndUid - $StartUid + 1
$checked = 0
$found = 0

Write-State -CurrentUid ($StartUid - 1) -NextUid $StartUid -Checked 0 -Found 0 -Status "running"
Write-Host ("GAS 用户同步开始：{0} -> {1}" -f $StartUid, $EndUid)
Write-Host ("当前已缓存：{0}" -f $script:merged.Count)
Write-Host ("状态文件：{0}" -f $statePath)

for ($uid = $StartUid; $uid -le $EndUid; $uid++) {
  $user = Fetch-GasUser -Uid $uid
  $checked++

  if ($user) {
    $script:merged[[string]$user.uid] = $user
    $found++
    Save-Db -Db $db
    Write-Host ("FOUND UID {0}: {1}" -f $user.uid, $user.nickname)
  }

  if (($checked % $StatusEvery) -eq 0) {
    Write-State -CurrentUid $uid -NextUid ($uid + 1) -Checked $checked -Found $found -Status "running"
    $percent = [math]::Round(($checked * 100.0) / $script:rangeTotal, 2)
    Write-Progress -Activity "GAS 用户同步" -Status ("当前 UID {0} / {1}，已缓存 {2}，本次找到 {3}" -f $uid, $EndUid, $script:merged.Count, $found) -PercentComplete $percent
  }

  if (($checked % $SaveEvery) -eq 0) {
    Save-Db -Db $db
    Write-Host ("进度：已检查 {0}/{1}，当前 UID {2}，已缓存 {3}，本次找到 {4}" -f $checked, $script:rangeTotal, $uid, $script:merged.Count, $found)
  }

  if ($DelayMs -gt 0) {
    Start-Sleep -Milliseconds $DelayMs
  }
}

Save-Db -Db $db
Write-State -CurrentUid $EndUid -NextUid ($EndUid + 1) -Checked $checked -Found $found -Status "done"
Write-Progress -Activity "GAS 用户同步" -Completed
Write-Host ("GAS 用户同步完成：已检查 {0}，已缓存 {1}，本次找到 {2}" -f $checked, $script:merged.Count, $found)
