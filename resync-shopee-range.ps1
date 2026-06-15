# Re-sincroniza Shopee dia a dia via shopeeBackfillRange (chunks de 4 dias).
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\resync-shopee-range.ps1
#   powershell -ExecutionPolicy Bypass -File .\resync-shopee-range.ps1 -StartDate 2026-06-01 -EndDate 2026-06-12
# Requer .env ou .env.local com VITE_BACKFILL_SECRET

param(
  [string]$StartDate = "2026-06-01",
  [string]$EndDate = (Get-Date).ToString("yyyy-MM-dd")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = if (Test-Path (Join-Path $root ".env.local")) { Join-Path $root ".env.local" } else { Join-Path $root ".env" }
if (-not (Test-Path $envFile)) { throw "Arquivo .env ou .env.local nao encontrado" }

$secret = $null
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*VITE_BACKFILL_SECRET\s*=\s*(.+)\s*$') {
    $secret = $matches[1].Trim().Trim('"').Trim("'")
  }
}
if (-not $secret) { throw "VITE_BACKFILL_SECRET nao definido em $envFile" }

$baseUrl = "https://southamerica-east1-projetoafiliado-9ff07.cloudfunctions.net/shopeeBackfillRange"
$startDate = $StartDate
$endDate = $EndDate

Write-Host "Re-sync Shopee: $startDate -> $endDate"
Write-Host "Cada chunk = ate 4 dias. Espere 5-9 min por chunk."
Write-Host "Nao feche esta janela ate aparecer Concluido."
Write-Host ""

$current = $startDate
$chunk = 0

while ($current -le $endDate) {
  $chunk++
  $inicio = Get-Date
  Write-Host ">> Chunk $chunk a partir de $current ... (inicio $($inicio.ToString('HH:mm:ss')))"
  $uri = "${baseUrl}?startDate=$current&endDate=$endDate"
  try {
    $resp = Invoke-RestMethod -Method POST -Uri $uri -Headers @{ Authorization = "Bearer $secret" } -ContentType "application/json" -TimeoutSec 600
  } catch {
    Write-Host "ERRO no chunk $chunk : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Se foi timeout, aguarde 2 min e rode de novo a partir de $current"
    throw
  }

  $elapsed = [int]((Get-Date) - $inicio).TotalSeconds
  $first = $resp.processados[0]
  $agg = $first.shopeeAggMode
  $rules = $first.promosRulesVersion
  $variant = $first.shopeeOficialPeriodCalib.choice.variant

  Write-Host "   Chunk $chunk OK em ${elapsed}s - dias: $($resp.processados.Count) - erros: $($resp.erros.Count) - restantes: $($resp.restantes)"

  $okPromos = ($agg -eq "promosapp") -or ($rules -like "*promosapp*") -or ($variant -eq "app_node_commission")
  if ($okPromos) {
    Write-Host "   Modo: shopeeAggMode=$agg | promosRulesVersion=$rules | choice.variant=$variant" -ForegroundColor Green
  } else {
    Write-Host "   Modo: shopeeAggMode=$agg | promosRulesVersion=$rules | choice.variant=$variant" -ForegroundColor Yellow
  }

  if (($agg -ne "promosapp") -and ($variant -eq "api_faithful_v2")) {
    Write-Host "   AVISO: ainda em api-faithful-v2. Verifique deploy e SHOPEE_AGG_MODE=promosapp." -ForegroundColor Red
  }

  if ($first.shopeeDaily -eq 0) {
    Write-Host "   AVISO: shopeeDaily=0 (doc igual ao Firestore OU deploy antigo). Rode deploy-functions.ps1 antes do re-sync." -ForegroundColor Yellow
  }
  if ($first.promosPedidosConcluidos -ne $null) {
    Write-Host "   Split: concl=$($first.promosPedidosConcluidos) pend=$($first.promosPedidosPendentes) | com.Concl=$($first.promosComissaoConcluida) com.Pend=$($first.promosComissaoPendente) | criterio=$($first.splitCriterio)" -ForegroundColor Cyan
  }

  $resp | ConvertTo-Json -Depth 6 | Write-Host

  if (-not $resp.continuar -or -not $resp.proximo) {
    Write-Host ""
    Write-Host "Concluido."
    break
  }
  $current = $resp.proximo
}
