$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLauncherPath = Join-Path $startupFolder "IniciarCorrijaMePtBr.bat"
$portFile = Join-Path $installRoot "server-port.txt"
$rootConfigPath = Join-Path $root "chrome-extension\server-config.json"
$configPath = Join-Path $installRoot "chrome-extension\server-config.json"
$pidFile = Join-Path $installRoot "server\corrija_me_pt_br.pid"

function Get-FreePort {
  $port = 18081
  while ($true) {
    $listener = $null
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
      $listener.Start()
      $listener.Stop()
      return $port
    } catch {
      if ($listener) {
        try { $listener.Stop() } catch {}
      }
      $port++
    }
  }
}

if (Test-Path $pidFile) {
  $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($savedPid) {
    $existingProcess = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      Stop-Process -Id $savedPid -Force
    }
  }
}

if (Test-Path $installRoot) {
  Remove-Item $installRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item (Join-Path $root "*") $installRoot -Recurse -Force

$selectedPort = Get-FreePort
$serverUrl = "http://127.0.0.1:$selectedPort"
$selectedPort | Set-Content -Path $portFile -Encoding ASCII
@"
{
  "serverUrl": "$serverUrl"
}
"@ | Set-Content -Path $rootConfigPath -Encoding ASCII
@"
{
  "serverUrl": "$serverUrl"
}
"@ | Set-Content -Path $configPath -Encoding ASCII

$startupContent = @"
@echo off
start "" /min "$installRoot\IniciarServidor.bat"
"@
Set-Content -Path $startupLauncherPath -Value $startupContent -Encoding ASCII

Write-Host "Instalando backend local..."
& (Join-Path $installRoot "IniciarServidor.ps1")

Start-Process explorer.exe (Join-Path $installRoot "chrome-extension") | Out-Null
Start-Process "cmd.exe" '/c start chrome://extensions' -ErrorAction SilentlyContinue | Out-Null

Write-Host ""
Write-Host "Instalacao concluida."
Write-Host "Servidor local configurado em $serverUrl"
Write-Host "No Chrome, clique em 'Carregar sem compactacao' e selecione:"
Write-Host "  $installRoot\chrome-extension"
Write-Host ""
Write-Host "O backend local sera iniciado automaticamente ao entrar no Windows."
