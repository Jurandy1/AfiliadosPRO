# ═══════════════════════════════════════════════════════════════════════════
#  DEPLOY EM CASA — rode após: git pull origin main
#  powershell -ExecutionPolicy Bypass -File .\deploy-casa.ps1
# ═══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root "tools\node"
if (Test-Path $node) { $env:PATH = "$node;$env:PATH" }

Set-Location $root

Write-Host ""
Write-Host "=== 1/4 Dependencias (root) ===" -ForegroundColor Cyan
npm install --silent

Write-Host ""
Write-Host "=== 2/4 Arquivo .env (frontend) ===" -ForegroundColor Cyan
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ">> .env criado a partir de .env.example — EDITE VITE_BACKFILL_SECRET antes de usar!" -ForegroundColor Yellow
} else {
  Write-Host ">> .env ja existe (ok)"
}

Write-Host ""
Write-Host "=== 3/4 Deploy Cloud Functions Shopee ===" -ForegroundColor Cyan
Write-Host ">> Sync completo: limit 500/pagina, ALL + 4 status, 31s entre consultas (doc API Shopee)"
Write-Host ">> Pode levar 3-5 min por dia ao clicar 'Atualizar agora' no dashboard"
& (Join-Path $root "deploy-functions.ps1")

Write-Host ""
Write-Host "=== 4/4 Teste local (opcional) ===" -ForegroundColor Cyan
Write-Host ">> npm run dev  ->  http://127.0.0.1:5173"
Write-Host ""
Write-Host "=== Validacao pos-deploy ===" -ForegroundColor Green
Write-Host "  1. Dashboard -> Ontem (02/06) -> Atualizar agora"
Write-Host "  2. Aguarde ~3 min — deve aparecer: 'API Shopee: ~781 registros -> ~664 pedidos'"
Write-Host "  3. Maio: botao 'Mes anterior' -> Aplicar (ou custom 01/05-31/05)"
Write-Host "  4. Firestore shopee_daily/2026-06-02 -> campo registros_api"
Write-Host ""
