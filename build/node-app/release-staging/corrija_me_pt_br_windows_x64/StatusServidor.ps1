$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$portFile = Join-Path $root "server-port.txt"

if (-not (Test-Path $portFile)) {
  Write-Host "Arquivo de porta nao encontrado."
  exit 1
}

$selectedPort = (Get-Content $portFile -ErrorAction Stop | Select-Object -First 1).Trim()

try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$selectedPort/health" -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -eq 200) {
    Write-Host "Backend online em http://127.0.0.1:$selectedPort"
    Write-Host $response.Content
    exit 0
  }
} catch {
}

Write-Host "Backend offline em http://127.0.0.1:$selectedPort"
exit 1
