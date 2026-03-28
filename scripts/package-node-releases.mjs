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

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este instalador com sudo."
  exit 1
fi

rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
cp -R "$ROOT_DIR/server" "$INSTALL_ROOT/"
cp -R "$ROOT_DIR/chrome-extension" "$INSTALL_ROOT/"
chmod +x "$INSTALL_ROOT/server/corrija-me-pt-br-server"

cat > "$SERVICE_PATH" <<'EOF'
[Unit]
Description=corrija_me_pt_br backend local em Node.js
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/corrija_me_pt_br
ExecStart=/opt/corrija_me_pt_br/server/corrija-me-pt-br-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable corrija-me-pt-br-node.service
systemctl restart corrija-me-pt-br-node.service

echo
echo "Instalacao concluida."
echo "Servidor local ativo em http://127.0.0.1:8081"
echo "No Chrome, abra chrome://extensions"
echo "Ative o modo do desenvolvedor e selecione:"
echo "  /opt/corrija_me_pt_br/chrome-extension"
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

function windowsInstallPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLauncherPath = Join-Path $startupFolder "IniciarCorrijaMePtBr.bat"

if (Test-Path $installRoot) {
  Remove-Item $installRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item (Join-Path $root "*") $installRoot -Recurse -Force

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
Write-Host "No Chrome, clique em 'Carregar sem compactacao' e selecione:"
Write-Host "  $installRoot\\chrome-extension"
Write-Host ""
Write-Host "O backend local sera iniciado automaticamente ao entrar no Windows."
`;
}

function windowsStartPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $root "server\\corrija-me-pt-br-server.exe"
$pidFile = Join-Path $root "server\\corrija_me_pt_br.pid"

if (-not (Test-Path $exePath)) {
  throw "Executavel do backend nao encontrado em $exePath"
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

$process = Start-Process -FilePath $exePath -WorkingDirectory $root -WindowStyle Hidden -PassThru
$process.Id | Set-Content -Path $pidFile -Encoding ASCII
Start-Sleep -Seconds 2

try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:8081/health" -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -eq 200) {
    Write-Host "Backend iniciado com sucesso em http://127.0.0.1:8081"
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

try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:8081/health" -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -eq 200) {
    Write-Host "Backend online em http://127.0.0.1:8081"
    Write-Host $response.Content
    exit 0
  }
} catch {
}

Write-Host "Backend offline em http://127.0.0.1:8081"
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
