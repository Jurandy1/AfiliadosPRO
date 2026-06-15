# Extrai codigo da puxada Shopee (API -> Firestore) para um unico arquivo.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$src = Join-Path $root "functions\index.js"
$outDir = Join-Path $root "docs"
$out = Join-Path $outDir "SHOPEE-PUXADA-COMPLETA.js"

if (-not (Test-Path $src)) { throw "Nao encontrado: $src" }

$lines = Get-Content $src -Encoding UTF8
$ranges = @(
  @(400, 961),
  @(1044, 3234),
  @(3267, 3990),
  @(4005, 4347),
  @(4485, 4592)
)

$header = @"
/**
 * SHOPEE — CODIGO COMPLETO DA PUXADA (API -> Firestore)
 * Extraido de: functions/index.js
 * Gerado: $(Get-Date -Format "yyyy-MM-dd HH:mm")
 *
 * FLUXO:
 *   shopeeFetch -> shopeePullRange(Complete) -> shopeeAggregate
 *   -> agruparPorData -> runShopeeSync -> shopee_daily / subid_daily / produto_daily
 *   HTTP manual: exports.shopeeBackfillNow (final)
 *
 * DEPENDENCIAS externas (functions/lib/):
 *   normalizeSubId.js, shopeeOficialRef.js, monthlyRollup.js
 * SECRETS: SHOPEE_APP_ID, SHOPEE_SECRET
 */

"@

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$parts = New-Object System.Collections.Generic.List[string]
$parts.Add($header)

foreach ($r in $ranges) {
  $a, $b = $r[0], $r[1]
  $parts.Add("")
  $parts.Add("// ===== functions/index.js L$a-$b =====")
  for ($i = $a - 1; $i -lt $b; $i++) {
    $parts.Add($lines[$i])
  }
}

$parts | Set-Content -Path $out -Encoding UTF8
$count = (Get-Content $out | Measure-Object -Line).Lines
Write-Host "Gerado: $out ($count linhas)"
