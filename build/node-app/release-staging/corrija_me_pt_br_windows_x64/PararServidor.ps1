$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root "server\corrija_me_pt_br.pid"

if (-not (Test-Path $pidFile)) {
  Write-Host "Nenhum PID salvo. O backend pode ja estar parado."
  exit 0
}

$savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
if ($savedPid) {
  $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $savedPid -Force
    Write-Host "Backend finalizado. PID: $savedPid"
  }
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
