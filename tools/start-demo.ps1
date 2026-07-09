#!/usr/bin/env pwsh
# ---------------------------------------------------------------------------
# start-demo.ps1
#
# One-shot demo launcher for data-assistant-teams-bot. Does sanity checks, starts
# the Azure Dev Tunnel host and the bot (with mock Data Assistant API) in two new
# PowerShell windows, then waits for the public health endpoint to be
# reachable before reporting "ready".
#
# Stop the demo by closing the two new pwsh windows.
#
# Usage:
#     pwsh tools\start-demo.ps1
#     pwsh tools\start-demo.ps1 -TunnelName my-tunnel -PublicUrl https://my-3978.usw2.devtunnels.ms
#
# Or set env vars before running:
#     $env:DEV_TUNNEL_NAME = 'my-tunnel'
#     $env:DEV_TUNNEL_URL  = 'https://my-3978.usw2.devtunnels.ms'
#     pwsh tools\start-demo.ps1
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [string]$TunnelName       = ($env:DEV_TUNNEL_NAME ?? 'my-tunnel'),
    [string]$PublicUrl        = ($env:DEV_TUNNEL_URL  ?? 'https://my-3978.usw2.devtunnels.ms'),
    [int]   $HealthTimeoutSec = 60
)

#Requires -Version 7.0

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== Data Assistant Teams Bot demo launcher ===" -ForegroundColor Cyan
Write-Host "Tunnel name : $TunnelName"
Write-Host "Public URL  : $PublicUrl"
Write-Host "Repo root   : $repoRoot"
Write-Host ""

# --- Prerequisite checks --------------------------------------------------
foreach ($cmd in 'devtunnel','npm','az') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "Required command not found on PATH: $cmd"
        exit 1
    }
}

$envFile = Join-Path $repoRoot 'env\.env.dev'
if (-not (Test-Path $envFile)) {
    Write-Error "Missing $envFile. Copy env\.env.dev.example and fill in values (BOT_ID, BOT_PASSWORD, tenantId, TEAMS_APP_ID, ACCESS_CONTROL_ALLOWLIST)."
    exit 1
}

# --- az login sanity ------------------------------------------------------
try {
    $acc = az account show --query '{name:name,user:user.name}' -o json 2>$null | ConvertFrom-Json
    if ($acc) {
        Write-Host "az logged in as: $($acc.user) / sub: $($acc.name)" -ForegroundColor Green
    } else {
        Write-Warning "az not logged in. Run 'az login' if you need Azure operations during the demo."
    }
} catch {
    Write-Warning "az login check failed: $($_.Exception.Message)"
}

# --- DNS sanity for the tunnel relay --------------------------------------
$relayHost = 'global.rel.tunnels.api.visualstudio.com'
try {
    $null = Resolve-DnsName $relayHost -ErrorAction Stop
    Write-Host "DNS OK   : $relayHost" -ForegroundColor Green
} catch {
    Write-Warning "DNS failed for $relayHost via the system resolver."
    Write-Warning "If 'devtunnel host' fails to start, re-pin the relay IPs in C:\Windows\System32\drivers\etc\hosts."
    Write-Warning "Resolve fresh IP with: Resolve-DnsName tunnels-prod-rel-usw2-v3-cluster.westus2.cloudapp.azure.com -Server 1.1.1.1"
}

# --- Stale-port check (ports 3978 = bot, 4000 = mock Data Assistant API) ----------
$inUse = Get-NetTCPConnection -State Listen -LocalPort 3978,4000 -ErrorAction SilentlyContinue
if ($inUse) {
    Write-Warning "Ports already in use (likely leftover node processes from a previous run):"
    $inUse | ForEach-Object {
        $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        Write-Warning ("  port {0} -> PID {1} ({2})" -f $_.LocalPort, $_.OwningProcess, $p.ProcessName)
    }
    $resp = Read-Host "Kill these processes and continue? [y/N]"
    if ($resp -match '^[yY]') {
        $inUse | ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
        Write-Host "Killed stale processes." -ForegroundColor Green
    } else {
        Write-Error "Aborting. Free ports 3978 and 4000, then re-run."
        exit 3
    }
}

# --- Launch dev tunnel in a new window ------------------------------------
Write-Host ""
Write-Host "Starting devtunnel host..." -ForegroundColor Cyan
$tunnelProc = Start-Process pwsh -PassThru -ArgumentList @(
    '-NoExit', '-Command', "devtunnel host $TunnelName"
)
Write-Host "  devtunnel PID: $($tunnelProc.Id)"
Start-Sleep -Seconds 3

# --- Launch bot + mock API in a new window --------------------------------
Write-Host "Starting bot (npm run dev:teams)..." -ForegroundColor Cyan
$botProc = Start-Process pwsh -PassThru -ArgumentList @(
    '-NoExit', '-Command', "Set-Location '$repoRoot'; npm run dev:teams"
)
Write-Host "  bot PID      : $($botProc.Id)"

# --- Wait for public health endpoint --------------------------------------
Write-Host ""
Write-Host "Waiting for $PublicUrl/api/health (up to $HealthTimeoutSec s)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "$PublicUrl/api/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) {
            Write-Host "  Health response: $($r.Content)" -ForegroundColor Green
            $ready = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

Write-Host ""
if (-not $ready) {
    Write-Warning "Public health check did not return 200 within $HealthTimeoutSec s."
    Write-Warning "Check the devtunnel window and the bot window for errors."
    exit 2
}

Write-Host "=== Ready to demo ===" -ForegroundColor Green
Write-Host "  1. Open Teams (InPrivate, signed in as the dev tenant admin)."
Write-Host "  2. Data Assistant should already be installed in your Apps list."
Write-Host "  3. Send a message in the personal chat or the group chat."
Write-Host ""
Write-Host "Stop the demo by closing the two new pwsh windows (PIDs $($tunnelProc.Id), $($botProc.Id))."
