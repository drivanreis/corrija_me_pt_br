$ErrorActionPreference = "Stop"

$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLauncherPath = Join-Path $startupFolder "IniciarCorrijaMePtBr.bat"
$pidFile = Join-Path $installRoot "server\corrija_me_pt_br.pid"

if (Test-Path $pidFile) {
  $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($savedPid) {
    $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $savedPid -Force
    }
  }
}

if (Test-Path $startupLauncherPath) {
  Remove-Item $startupLauncherPath -Force -ErrorAction SilentlyContinue
}

if (Test-Path $installRoot) {
  Remove-Item $installRoot -Recurse -Force
}

Write-Host ""
Write-Host "Desinstalacao concluida."
Write-Host "Arquivos removidos de $installRoot"
Write-Host "Inicializacao automatica removida."
Write-Host "Se a extensao ainda estiver carregada no Chrome, remova-a manualmente em chrome://extensions."
