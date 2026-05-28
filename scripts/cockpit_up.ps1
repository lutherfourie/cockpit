#requires -Version 7.0
<#
.SYNOPSIS
  One-command instant start for Cockpit (native dev).

.DESCRIPTION
  Brings Cockpit up from a cold machine: verifies Docker Desktop, starts the
  local Supabase stack (idempotent), checks .env.local, installs deps if stale,
  launches the Next.js dev server on 127.0.0.1:3000 (reusing an existing one),
  waits for health, opens the browser, and prints the snapshot summary.

  Dev runs natively (fast file-watching). The portable production artifact is
  the Docker image (see Dockerfile / docker-compose.yml).

.EXAMPLE
  pwsh -File scripts\cockpit_up.ps1
  pwsh -File scripts\cockpit_up.ps1 -SkipBrowser
#>
param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$Port = 3000,
  [int]$HealthTimeoutSec = 120,
  [switch]$SkipSupabase,
  [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $Root

function Info { param([string]$m) Write-Host "[cockpit-up] $m" -ForegroundColor Cyan }
function Ok   { param([string]$m) Write-Host "[cockpit-up] $m" -ForegroundColor Green }
function Warn { param([string]$m) Write-Host "[cockpit-up] $m" -ForegroundColor Yellow }
function Die  { param([string]$m) Write-Host "[cockpit-up] $m" -ForegroundColor Red; exit 1 }

function Test-Port {
  param([int]$P)
  [bool](Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# ── 1. Docker Desktop (Supabase needs it) ───────────────────────────────────
if (-not $SkipSupabase) {
  Info "Checking Docker Desktop..."
  try { docker info *> $null } catch { $global:LASTEXITCODE = 1 }
  if ($LASTEXITCODE -ne 0) {
    Die "Docker Desktop is not running. Start Docker Desktop, then re-run this script (or pass -SkipSupabase to skip the local DB)."
  }
  Ok "Docker is running."

  # ── 2. Supabase (idempotent) ──────────────────────────────────────────────
  if (Test-Port -P 54321) {
    Ok "Supabase already up (api 54321 listening)."
  } else {
    Info "Starting local Supabase stack (first run pulls images, can take a minute)..."
    pnpm exec supabase start
    if ($LASTEXITCODE -ne 0) { Die "supabase start failed. Inspect output above." }
    Ok "Supabase started."
  }
} else {
  Warn "Skipping Supabase (-SkipSupabase). Auth/persistence will use the no-op store."
}

# ── 3. .env.local sanity ─────────────────────────────────────────────────────
$envLocal = Join-Path $Root ".env.local"
if (-not (Test-Path -LiteralPath $envLocal)) {
  Warn ".env.local missing — copying from .env.example. Fill in keys before relying on persistence/LLM."
  Copy-Item (Join-Path $Root ".env.example") $envLocal -ErrorAction SilentlyContinue
}
$required = @("NEXT_PUBLIC_SUPABASE_URL", "COCKPIT_LLM_PROVIDER")
foreach ($key in $required) {
  if (-not (Select-String -Path $envLocal -Pattern "^\s*$([regex]::Escape($key))\s*=\S" -ErrorAction SilentlyContinue)) {
    Warn "$key not set in .env.local (the app still boots; LLM falls back to 'local')."
  }
}

# ── 4. Dependencies (install if stale) ───────────────────────────────────────
$nodeModules = Join-Path $Root "node_modules"
$lock = Join-Path $Root "pnpm-lock.yaml"
$needInstall = (-not (Test-Path -LiteralPath $nodeModules)) -or
               ((Test-Path -LiteralPath $lock) -and (Get-Item $lock).LastWriteTime -gt (Get-Item $nodeModules).LastWriteTime)
if ($needInstall) {
  Info "Installing dependencies (pnpm install)..."
  pnpm install
  if ($LASTEXITCODE -ne 0) { Die "pnpm install failed." }
} else {
  Ok "Dependencies up to date."
}

# ── 5. Dev server (reuse if already listening) ───────────────────────────────
if (Test-Port -P $Port) {
  Ok "Dev server already listening on $Port — reusing it."
} else {
  Info "Starting Next.js dev server on 127.0.0.1:$Port ..."
  $pnpm = (Get-Command pnpm -ErrorAction Stop).Source
  $outLog = Join-Path $Root "dev-server.out.log"
  $errLog = Join-Path $Root "dev-server.err.log"
  Start-Process -FilePath $pnpm `
    -ArgumentList @("dev", "--hostname", "127.0.0.1", "--port", "$Port") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden | Out-Null
  Ok "Dev server launched (logs: dev-server.out.log)."
}

# ── 6. Health poll ───────────────────────────────────────────────────────────
Info "Waiting for http://127.0.0.1:$Port ..."
$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
    if ($resp.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if ($healthy) { Ok "Cockpit is up at http://127.0.0.1:$Port" }
else { Warn "Timed out waiting for the dev server. Check dev-server.out.log / dev-server.err.log." }

# ── 7. Open browser ──────────────────────────────────────────────────────────
if ($healthy -and -not $SkipBrowser) {
  Start-Process "http://127.0.0.1:$Port/" | Out-Null
}

# ── 8. Snapshot summary ──────────────────────────────────────────────────────
Write-Host ""
& (Join-Path $PSScriptRoot "cockpit_snapshot.ps1")
