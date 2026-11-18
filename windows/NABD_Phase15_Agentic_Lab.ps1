# NABD Phase15 laptop launcher — JustMarkets Demo, strictly read-only.
# Does not ask for passwords, install EAs, enable algo trading, call a broker order,
# use Render, or change the Live website. Requires explicit MT5 cost assumptions.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('XAUUSD','BTCUSD')][string]$Market,
  [string]$Symbol = '',
  [Parameter(Mandatory=$true)][ValidateScript({$_ -gt 0 -and $_ -lt 10000000})][double]$SpreadPoints,
  [Parameter(Mandatory=$true)][ValidateScript({$_ -ge 0 -and $_ -lt 10000000})][double]$SlippagePoints,
  [Parameter(Mandatory=$true)][ValidateScript({$_ -ge 0 -and $_ -lt 10000000})][double]$CommissionPerLot,
  [Parameter(Mandatory=$true)][ValidateScript({$_ -gt 0 -and $_ -lt 100000000})][double]$MarginPerLot,
  [string]$From = '',
  [string]$To = '',
  [ValidateRange(2,6)][int]$Folds = 3,
  [ValidateRange(3,60)][int]$MaxAICalls = 12,
  [string]$OutputDirectory = '',
  [switch]$RunAIWithCost
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=Split-Path -Parent $PSScriptRoot
if(-not $Symbol){$Symbol="$Market.m"}
if(-not $Symbol.ToUpperInvariant().StartsWith($Market)){
  throw "Symbol must start with $Market and match your exact Demo broker symbol."
}
if(-not $From -or -not $To){
  $until=[DateTime]::UtcNow.Date
  if(-not $To){$To=$until.ToString('yyyy-MM-dd')}
  if(-not $From){$From=$until.AddYears(-2).ToString('yyyy-MM-dd')}
}
foreach($date in @($From,$To)){
  if($date -notmatch '^\d{4}-\d{2}-\d{2}$'){
    throw 'Use UTC YYYY-MM-DD dates.'
  }
  $stamp=[DateTime]::MinValue
  if(-not [DateTime]::TryParseExact($date,'yyyy-MM-dd',
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::None,[ref]$stamp)){
    throw "Invalid historical UTC date: $date"
  }
}
if([string]::CompareOrdinal($From,$To) -ge 0){throw 'From must be earlier than To'}
if($MaxAICalls -lt $Folds){throw 'MaxAICalls must be >= Folds'}
if($RunAIWithCost -and -not $env:NABD_TEST_REPLAY_AI_KEY){
  throw 'Billable model run needs NABD_TEST_REPLAY_AI_KEY in this local terminal session.'
}
if(-not $OutputDirectory){$OutputDirectory=Join-Path $root 'phase15-local-reports'}
New-Item -Path $OutputDirectory -ItemType Directory -Force | Out-Null
$stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$prefix=($Market+'-'+$stamp)
$history=Join-Path $OutputDirectory ($prefix+'-history.json')
$report=Join-Path $OutputDirectory ($prefix+'-agentic.json')
if((Test-Path $history) -or (Test-Path $report)){throw 'Refusing to overwrite existing research file'}
foreach($tool in @('python','node')){
  if(-not (Get-Command $tool -ErrorAction SilentlyContinue)){
    throw "Install $tool before running the laptop research tool."
  }
}
Write-Host 'NABD Phase15 — JustMarkets Demo HISTORICAL RESEARCH ONLY'
Write-Host "Market: $Market | broker symbol: $Symbol | UTC range: $From to $To (exclusive)"
Write-Host 'No order execution. No broker passwords. No production traffic.'
Write-Host 'Costs are manual assumptions and are NOT broker-confirmed.'
$pythonPath=Join-Path $root 'windows\nabd_phase15_mt5_history_export.py'
$brainPath=Join-Path $root 'agentic-experimental\agentic-historical-cli.mjs'
if(-not (Test-Path $pythonPath) -or -not (Test-Path $brainPath)){
  throw 'Missing bundled research modules; download the complete integration ZIP.'
}
# Locale-independent decimal representation — PowerShell outside en-US locales.
$culture=[System.Globalization.CultureInfo]::InvariantCulture
$spread=$SpreadPoints.ToString($culture)
$slippage=$SlippagePoints.ToString($culture)
$commission=$CommissionPerLot.ToString($culture)
$margin=$MarginPerLot.ToString($culture)
& python $pythonPath --market $Market --symbol $Symbol --from $From --to $To `
  --spread-points $spread --slippage-points $slippage `
  --commission-per-lot $commission --margin-per-lot $margin --output $history
if($LASTEXITCODE -ne 0){throw 'MT5 Demo historical export rejected. Check charts and candle coverage.'}
$argsBrain=@($brainPath,'--input',$history,'--output',$report,
  '--from',$From,'--to',$To,'--folds',"$Folds",'--max-ai-calls',"$MaxAICalls")
if($RunAIWithCost){
  Write-Warning "Explicit billable historical model analysis requested, max calls: $MaxAICalls"
  $argsBrain+='--run-ai-with-cost'
}else{Write-Host 'Readiness-only replay: no model calls, no API charge.'}
& node @argsBrain
if($LASTEXITCODE -ne 0){throw 'Research replay rejected; do not interpret partial data as valid.'}
Write-Host "Saved history: $history"
Write-Host "Saved PAPER report: $report"
Write-Host 'Open the local Strategy Lab report viewer and select the PAPER report.'
Write-Host 'This report is NOT an unbiased model backtest or a verified MT5 trading result.'
