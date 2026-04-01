import { mkdir, rm, cp, copyFile, chmod, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const buildDir = path.join(rootDir, "build", "node-app");
const pkgDir = path.join(buildDir, "pkg");
const releaseDir = path.join(rootDir, "releases");
const releaseStagingDir = path.join(buildDir, "release-staging");

async function zipDirectory(sourceDir, outputZip) {
  await execFileAsync("zip", ["-qr", outputZip, path.basename(sourceDir)], {
    cwd: path.dirname(sourceDir)
  });
}

function linuxInstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="/opt/corrija_me_pt_br"
SERVICE_PATH="/etc/systemd/system/corrija-me-pt-br-node.service"
PORT_FILE="$INSTALL_ROOT/server-port.txt"

find_free_port() {
  local port=18081
  while true; do
    if ! ss -ltnH "( sport = :$port )" 2>/dev/null | grep -q .; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
  done
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este instalador com sudo."
  exit 1
fi

SELECTED_PORT="$(find_free_port)"
SERVER_URL="http://127.0.0.1:$SELECTED_PORT"

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop corrija-me-pt-br-node.service || true
fi

rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
cp -R "$ROOT_DIR/server" "$INSTALL_ROOT/"
cp -R "$ROOT_DIR/chrome-extension" "$INSTALL_ROOT/"
chmod +x "$INSTALL_ROOT/server/corrija-me-pt-br-server"
printf '%s\n' "$SELECTED_PORT" > "$PORT_FILE"
cat > "$ROOT_DIR/chrome-extension/server-config.json" <<EOF
{
  "serverUrl": "$SERVER_URL"
}
EOF
cat > "$INSTALL_ROOT/chrome-extension/server-config.json" <<EOF
{
  "serverUrl": "$SERVER_URL"
}
EOF

cat > "$SERVICE_PATH" <<'EOF'
[Unit]
Description=corrija_me_pt_br backend local em Node.js
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/corrija_me_pt_br
Environment=CORRIJA_ME_PORT=__CORRIJA_ME_PORT__
ExecStart=/opt/corrija_me_pt_br/server/corrija-me-pt-br-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sed -i "s/__CORRIJA_ME_PORT__/$SELECTED_PORT/" "$SERVICE_PATH"

systemctl daemon-reload
systemctl enable corrija-me-pt-br-node.service
systemctl restart corrija-me-pt-br-node.service

echo
echo "Instalacao concluida."
echo "Servidor local configurado em $SERVER_URL"
echo "No Chrome, abra chrome://extensions"
echo "Ative o modo do desenvolvedor e selecione:"
echo "  /opt/corrija_me_pt_br/chrome-extension"
`;
}

function linuxUninstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="/opt/corrija_me_pt_br"
SERVICE_PATH="/etc/systemd/system/corrija-me-pt-br-node.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este desinstalador com sudo."
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop corrija-me-pt-br-node.service || true
  systemctl disable corrija-me-pt-br-node.service || true
fi

rm -f "$SERVICE_PATH"
rm -rf "$INSTALL_ROOT"

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi

echo
echo "Desinstalacao concluida."
echo "Arquivos removidos de $INSTALL_ROOT"
echo "Servico local removido."
echo "Se a extensao ainda estiver carregada no Chrome, remova-a manualmente em chrome://extensions."
`;
}

function linuxReadme() {
  return `corrija_me_pt_br - pacote Linux
=================================

1. Extraia este pacote.
2. Execute com sudo:
   ./install.sh
3. Abra o Chrome em chrome://extensions
4. Ative "Modo do desenvolvedor"
5. Clique em "Carregar sem compactacao"
6. Selecione a pasta:
   /opt/corrija_me_pt_br/chrome-extension

O backend local inicia automaticamente com o sistema.
A porta e escolhida automaticamente a partir de 18081.

Para desinstalar:
sudo ./uninstall.sh
`;
}

function windowsInstallBat() {
  return `@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo O instalador encontrou um erro. Veja a mensagem acima.
  pause
  exit /b %errorlevel%
)
`;
}

function windowsUninstallBat() {
  return `@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
if errorlevel 1 (
  echo.
  echo O desinstalador encontrou um erro. Veja a mensagem acima.
  pause
  exit /b %errorlevel%
)
`;
}

function windowsInstallPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLauncherPath = Join-Path $startupFolder "IniciarCorrijaMePtBr.bat"
$portFile = Join-Path $installRoot "server-port.txt"
$rootConfigPath = Join-Path $root "chrome-extension\\server-config.json"
$configPath = Join-Path $installRoot "chrome-extension\\server-config.json"
$pidFile = Join-Path $installRoot "server\\corrija_me_pt_br.pid"

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
start "" /min "$installRoot\\IniciarServidor.bat"
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
Write-Host "  $installRoot\\chrome-extension"
Write-Host ""
Write-Host "O backend local sera iniciado automaticamente ao entrar no Windows."
`;
}

function windowsUninstallPs1() {
  return `$ErrorActionPreference = "Stop"

$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLauncherPath = Join-Path $startupFolder "IniciarCorrijaMePtBr.bat"
$pidFile = Join-Path $installRoot "server\\corrija_me_pt_br.pid"

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
`;
}

function windowsStartPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $root "server\\corrija-me-pt-br-server.exe"
$pidFile = Join-Path $root "server\\corrija_me_pt_br.pid"
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
`;
}

function windowsStopPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root "server\\corrija_me_pt_br.pid"

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
`;
}

function windowsStatusPs1() {
  return `$ErrorActionPreference = "Stop"

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
`;
}

async function packageLinux() {
  const linuxRoot = path.join(releaseStagingDir, "corrija_me_pt_br_linux_x64");
  const linuxExecutable = path.join(pkgDir, "corrija-me-pt-br-ts-linux");
  await rm(linuxRoot, { recursive: true, force: true });
  await mkdir(path.join(linuxRoot, "server"), { recursive: true });
  await cp(path.join(buildDir, "extension"), path.join(linuxRoot, "chrome-extension"), { recursive: true });
  await copyFile(linuxExecutable, path.join(linuxRoot, "server", "corrija-me-pt-br-server"));
  await chmod(path.join(linuxRoot, "server", "corrija-me-pt-br-server"), 0o755);
  await writeFile(path.join(linuxRoot, "install.sh"), linuxInstallScript());
  await chmod(path.join(linuxRoot, "install.sh"), 0o755);
  await writeFile(path.join(linuxRoot, "uninstall.sh"), linuxUninstallScript());
  await chmod(path.join(linuxRoot, "uninstall.sh"), 0o755);
  await writeFile(path.join(linuxRoot, "README.txt"), linuxReadme());
  await rm(path.join(releaseDir, "corrija_me_pt_br_linux_x64.zip"), { force: true });
  await zipDirectory(linuxRoot, path.join(releaseDir, "corrija_me_pt_br_linux_x64.zip"));
}

async function writeWindowsHelper(root, fileName, ps1Name) {
  const content = `@echo off\r\npowershell -ExecutionPolicy Bypass -File "%~dp0${ps1Name}"\r\n`;
  await writeFile(path.join(root, fileName), content);
}

async function packageWindows() {
  const windowsRoot = path.join(releaseStagingDir, "corrija_me_pt_br_windows_x64");
  const windowsExecutable = path.join(pkgDir, "corrija-me-pt-br-ts-win.exe");
  await rm(windowsRoot, { recursive: true, force: true });
  await mkdir(path.join(windowsRoot, "server"), { recursive: true });
  await cp(path.join(buildDir, "extension"), path.join(windowsRoot, "chrome-extension"), { recursive: true });
  await copyFile(windowsExecutable, path.join(windowsRoot, "server", "corrija-me-pt-br-server.exe"));
  await writeFile(path.join(windowsRoot, "install.bat"), windowsInstallBat());
  await writeFile(path.join(windowsRoot, "install.ps1"), windowsInstallPs1());
  await writeFile(path.join(windowsRoot, "uninstall.bat"), windowsUninstallBat());
  await writeFile(path.join(windowsRoot, "uninstall.ps1"), windowsUninstallPs1());
  await writeFile(path.join(windowsRoot, "IniciarServidor.ps1"), windowsStartPs1());
  await writeFile(path.join(windowsRoot, "PararServidor.ps1"), windowsStopPs1());
  await writeFile(path.join(windowsRoot, "StatusServidor.ps1"), windowsStatusPs1());
  await writeWindowsHelper(windowsRoot, "IniciarServidor.bat", "IniciarServidor.ps1");
  await writeWindowsHelper(windowsRoot, "PararServidor.bat", "PararServidor.ps1");
  await writeWindowsHelper(windowsRoot, "StatusServidor.bat", "StatusServidor.ps1");
  await writeFile(path.join(windowsRoot, "README.txt"), `corrija_me_pt_br - pacote Windows
===================================

1. Extraia este pacote.
2. Execute install.bat
3. No Chrome, abra chrome://extensions
4. Ative "Modo do desenvolvedor"
5. Clique em "Carregar sem compactacao"
6. Selecione a pasta:
   %LOCALAPPDATA%\\corrija_me_pt_br\\chrome-extension

O backend local sera iniciado automaticamente no login do Windows.
A porta e escolhida automaticamente a partir de 18081.

Para desinstalar:
execute uninstall.bat
`);
  await rm(path.join(releaseDir, "corrija_me_pt_br_windows_x64.zip"), { force: true });
  await zipDirectory(windowsRoot, path.join(releaseDir, "corrija_me_pt_br_windows_x64.zip"));
}

async function main() {
  if (!existsSync(path.join(pkgDir, "corrija-me-pt-br-ts-linux")) || !existsSync(path.join(pkgDir, "corrija-me-pt-br-ts-win.exe"))) {
    throw new Error("Executaveis empacotados nao encontrados. Rode 'npm run package:backend' primeiro.");
  }

  await mkdir(releaseDir, { recursive: true });
  await rm(releaseStagingDir, { recursive: true, force: true });
  await mkdir(releaseStagingDir, { recursive: true });
  await packageLinux();
  await packageWindows();
  console.log(`Pacotes portateis criados em ${releaseDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
