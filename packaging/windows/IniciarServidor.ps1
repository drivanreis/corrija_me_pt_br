$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$jarPath = Join-Path $root "server\languagetool-server.jar"
$configPath = Join-Path $root "server\corrija-me-pt-br-local.properties"
$pidFile = Join-Path $root "server\corrija_me_pt_br.pid"
$javawPath = Join-Path $env:JAVA_HOME "bin\javaw.exe"
$javaPath = Join-Path $env:JAVA_HOME "bin\java.exe"

function Get-JavaCommand {
  if ($env:JAVA_HOME -and (Test-Path $javawPath)) {
    return $javawPath
  }
  if ($env:JAVA_HOME -and (Test-Path $javaPath)) {
    return $javaPath
  }

  $javawFromPath = Get-Command javaw.exe -ErrorAction SilentlyContinue
  if ($javawFromPath) {
    return $javawFromPath.Source
  }

  $javaFromPath = Get-Command java.exe -ErrorAction SilentlyContinue
  if ($javaFromPath) {
    return $javaFromPath.Source
  }

  throw "Java 17 nao encontrado. Instale o Java 17 e tente novamente."
}

if (-not (Test-Path $jarPath)) {
  throw "Jar do servidor nao encontrado em $jarPath"
}

if (-not (Test-Path $configPath)) {
  throw "Arquivo de configuracao local nao encontrado em $configPath"
}

if (Test-Path $pidFile) {
  $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      Write-Host "Servidor ja esta em execucao. PID: $existingPid"
      exit 0
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$javaCommand = Get-JavaCommand
$arguments = '-jar "{0}" --config "{1}" --port 8081 --allow-origin' -f $jarPath, $configPath
$process = Start-Process -FilePath $javaCommand -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
$process.Id | Set-Content -Path $pidFile -Encoding ascii

Start-Sleep -Seconds 2

try {
  $response = Invoke-WebRequest -Uri "http://localhost:8081/v2/languages" -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -eq 200) {
    Write-Host "Servidor iniciado com sucesso em http://localhost:8081"
    exit 0
  }
} catch {
}

Write-Warning "O processo foi iniciado, mas a API ainda nao respondeu. Aguarde alguns segundos e execute StatusServidor.bat."
