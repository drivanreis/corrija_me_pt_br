$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root "server\corrija_me_pt_br.pid"

if (Test-Path $pidFile) {
  $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($savedPid) {
    $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($process) {
      Write-Host "Processo ativo. PID: $savedPid"
    } else {
      Write-Host "PID salvo, mas processo nao encontrado."
    }
  }
}

try {
  $response = Invoke-WebRequest -Uri "http://localhost:8081/v2/languages" -UseBasicParsing -TimeoutSec 10
  Write-Host "API online em http://localhost:8081"
  Write-Host $response.Content
  exit 0
} catch {
  Write-Host "API offline em http://localhost:8081"
  exit 1
}
