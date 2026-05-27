param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Write-ToolVersion {
  param(
    [string]$Name,
    [string[]]$ToolArgs = @("--version")
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    Write-Output "${Name}: missing"
    return
  }

  try {
    $version = & $Name @ToolArgs 2>$null | Select-Object -First 1
    Write-Output "${Name}: $version"
  } catch {
    Write-Output "${Name}: present, version probe failed"
  }
}

function Test-Port {
  param([int]$Port)
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return [bool]$conn
}

function Get-EnvVar {
  param([string]$EnvFile, [string]$Key)
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $null }
  $line = Select-String -Path $EnvFile -Pattern "^\s*$([regex]::Escape($Key))\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line) { return $null }
  $value = ($line.Line -split "=", 2)[1].Trim().Trim('"').Trim("'")
  if ([string]::IsNullOrEmpty($value)) { return $null }
  return $value
}

Set-Location -LiteralPath $Root

Write-Output "Cockpit snapshot"
Write-Output "Root: $Root"
Write-Output ""

Write-Output "Git"
git status --short --branch
Write-Output ""

Write-Output "Tools"
Write-ToolVersion "node"
Write-ToolVersion "pnpm"
Write-ToolVersion "supabase"
Write-ToolVersion "codex"
Write-ToolVersion "claude"
Write-Output ""

Write-Output "Local Supabase (cockpit)"
$dbListening = Test-Port -Port 54322
$apiListening = Test-Port -Port 54321
$studioListening = Test-Port -Port 54323
Write-Output "db (54322): $(if ($dbListening) { 'listening' } else { 'down' })"
Write-Output "api (54321): $(if ($apiListening) { 'listening' } else { 'down' })"
Write-Output "studio (54323): $(if ($studioListening) { 'listening' } else { 'down' })"
Write-Output ""

Write-Output "Dev server"
$devListening = Test-Port -Port 3000
Write-Output "next (3000): $(if ($devListening) { 'listening' } else { 'down' })"
$devLog = Join-Path $Root "dev-server.out.log"
if (Test-Path -LiteralPath $devLog) {
  $devLogItem = Get-Item -LiteralPath $devLog
  Write-Output "log: $($devLogItem.LastWriteTime.ToString('s')) dev-server.out.log"
} else {
  Write-Output "log: none"
}
Write-Output ""

Write-Output "Env"
$envLocal = Join-Path $Root ".env.local"
if (Test-Path -LiteralPath $envLocal) {
  $provider = Get-EnvVar -EnvFile $envLocal -Key "COCKPIT_LLM_PROVIDER"
  $cerebrasModel = Get-EnvVar -EnvFile $envLocal -Key "CEREBRAS_MODEL"
  $supabaseUrl = Get-EnvVar -EnvFile $envLocal -Key "NEXT_PUBLIC_SUPABASE_URL"
  Write-Output ".env.local: present"
  if ($provider) { Write-Output "COCKPIT_LLM_PROVIDER: $provider" }
  if ($cerebrasModel) { Write-Output "CEREBRAS_MODEL: $cerebrasModel" }
  if ($supabaseUrl) { Write-Output "NEXT_PUBLIC_SUPABASE_URL: $supabaseUrl" }
} else {
  Write-Output ".env.local: missing (copy from .env.example)"
}

Write-Output ""
Write-Output "Build state"
$nextDir = Join-Path $Root ".next"
if (Test-Path -LiteralPath $nextDir) {
  $nextItem = Get-Item -LiteralPath $nextDir
  Write-Output ".next/: $($nextItem.LastWriteTime.ToString('s'))"
} else {
  Write-Output ".next/: none"
}
$tsBuildInfo = Join-Path $Root "tsconfig.tsbuildinfo"
if (Test-Path -LiteralPath $tsBuildInfo) {
  $tsItem = Get-Item -LiteralPath $tsBuildInfo
  Write-Output "tsconfig.tsbuildinfo: $($tsItem.LastWriteTime.ToString('s'))"
}
