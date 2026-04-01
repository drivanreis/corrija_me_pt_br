$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $root "server\corrija-me-pt-br-server.exe"
$pidFile = Join-Path $root "server\corrija_me_pt_br.pid"
$portFile = Join-Path $root "server-port.txt"

if (-not (Test-Path $exePath)) {
  throw "Executavel do backend nao encontrado em $exePath"
}

if (-not (Test-Path $portFile)) {
  throw "Arquivo de porta nao encontrado em $portFile"
}

$selectedPort = (Get-Content $portFile -ErrorAction Stop | Select-Object -First 1).Trim()
if (-not $selectedPort) {
  throw "Nenhuma porta configurada encontrada em $portFile"
}

if (Test-Path $pidFile) {
  $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($savedPid) {
    $existingProcess = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      Write-Host "Backend ja esta em execucao. PID: $savedPid"
      exit 0
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$process = Start-Process -FilePath $exePath -WorkingDirectory $root -WindowStyle Hidden -PassThru -Environment @{ CORRIJA_ME_PORT = $selectedPort }
$process.Id | Set-Content -Path $pidFile -Encoding ASCII
Start-Sleep -Seconds 2

try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$selectedPort/health" -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -eq 200) {
    Write-Host "Backend iniciado com sucesso em http://127.0.0.1:$selectedPort"
    exit 0
  }
} catch {
}

Write-Warning "O processo foi iniciado, mas a API ainda nao respondeu. Aguarde alguns segundos."
