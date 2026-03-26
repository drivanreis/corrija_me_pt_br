$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root "server\corrija_me_pt_br.pid"

if (-not (Test-Path $pidFile)) {
  Write-Host "Nenhum PID salvo. O servidor pode ja estar parado."
  exit 0
}

$savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
if (-not $savedPid) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "PID vazio removido."
  exit 0
}

$process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $savedPid -Force
  Write-Host "Servidor finalizado. PID: $savedPid"
} else {
  Write-Host "Processo nao encontrado. Limpando PID antigo."
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
