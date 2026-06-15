# Deploy das Cloud Functions Shopee
# Alinhado ao PromosApp / doc API Shopee:
#   - conversionReport limit 500/pagina
#   - pull ALL + UNPAID/PENDING/COMPLETED/CANCELLED
#   - 31s entre consultas novas (regra scrollId)
#
# Uso isolado:  powershell -ExecutionPolicy Bypass -File .\deploy-functions.ps1
# Fluxo casa:   git pull && powershell -ExecutionPolicy Bypass -File .\deploy-casa.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root "tools\node"
if (Test-Path $node) { $env:PATH = "$node;$env:PATH" }

function Invoke-FirebaseCli {
  param([Parameter(Mandatory)][string[]]$Args)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npx @Args
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) {
    throw "Comando falhou (exit $code): npx $($Args -join ' ')"
  }
}

Set-Location $root
Write-Host ">> Instalando dependencias das functions..."
Set-Location (Join-Path $root "functions")
npm install --silent
if ($LASTEXITCODE -ne 0) { throw "npm install falhou" }
Set-Location $root

$envFile = Join-Path $root "functions\.env.projetoafiliado-9ff07"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root "functions\.env.example") $envFile
  Write-Host ">> Criado $envFile com SHOPEE_AGG_MODE=promosapp"
} else {
  Write-Host ">> Usando $envFile (SHOPEE_AGG_MODE no deploy)"
}

Write-Host ">> Deploy das functions Shopee (timeout 540s, 2GiB no backfill)..."
Write-Host ">> Projeto: projetoafiliado-9ff07"
Invoke-FirebaseCli -Args @(
  "firebase", "deploy",
  "--only", "functions:shopeeBackfillNow,functions:shopeeBackfillRange,functions:shopeeRecentDaysSync,functions:shopeeDailyReconcile,functions:shopeeIncrementalSync,functions:shopeeMonthAutoSync",
  "--project", "projetoafiliado-9ff07"
)

Write-Host ""
Write-Host ">> SHOPEE_AGG_MODE=promosapp - sync automatico (incremental + recent + mes)" -ForegroundColor Green
Write-Host ">> Mes corrente: shopeeMonthAutoSync 4x/dia (nao precisa resync-shopee-range.ps1)"
Write-Host ">> Meses antigos (one-off): powershell -ExecutionPolicy Bypass -File .\resync-shopee-range.ps1 -StartDate 2026-05-01"
Write-Host ">> Concluido." -ForegroundColor Green
