# Agente local BotShield (Windows) — IP residencial para BetBra/Mexchange
#
# 1) Instale Node.js LTS: https://nodejs.org
# 2) Clone/atualize o repo exchange
# 3) Neste PowerShell (pasta do repo):
#      .\scripts\windows\start-botshield-local-bridge.ps1
# 4) Outro terminal: cloudflared tunnel --url http://127.0.0.1:8787
# 5) Na VPS: rode vps-hotfix-botshield-local-bridge.sh com a URL do túnel

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "ERRO: Node.js nao encontrado. Instale LTS em https://nodejs.org" -ForegroundColor Red
  exit 1
}

if (-not $env:BRIDGE_SECRET -or $env:BRIDGE_SECRET.Length -lt 12) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 24
  $rng.GetBytes($bytes)
  $env:BRIDGE_SECRET = ([Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', 'x')
  Write-Host "BRIDGE_SECRET gerado (guarde para a VPS):" -ForegroundColor Yellow
  Write-Host $env:BRIDGE_SECRET
}

if (-not $env:PORT) { $env:PORT = "8787" }
if (-not $env:EXCHANGE_BRAND) { $env:EXCHANGE_BRAND = "betbra" }
$env:EXCHANGE_ORDERS_LIVE = "1"
$env:EXCHANGE_ORDERS_AUTH_STYLE = "cookie"
$env:EXCHANGE_ORDERS_PAYLOAD = "mexchange"
$env:EXCHANGE_LOCAL_BRIDGE = "0"

Write-Host "==> Iniciando bridge local em http://127.0.0.1:$($env:PORT)" -ForegroundColor Cyan
Write-Host "    Em OUTRO terminal (com cloudflared instalado):"
Write-Host "      cloudflared tunnel --url http://127.0.0.1:$($env:PORT)"
Write-Host "    Depois na VPS:"
Write-Host "      EXCHANGE_LOCAL_BRIDGE_URL=<url-do-cloudflared>"
Write-Host "      EXCHANGE_LOCAL_BRIDGE_SECRET=$($env:BRIDGE_SECRET)"
Write-Host ""

node "$Root\scripts\botshield-local-bridge.mjs"
