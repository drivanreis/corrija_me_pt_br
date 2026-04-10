import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const buildDir = path.join(rootDir, "build", "node-app");
const pkgDir = path.join(buildDir, "pkg");
const releaseDir = path.join(rootDir, "releases");
const stagingDir = path.join(buildDir, "release-staging");
const releaseVersion = String(packageJson.version || "0.0.0");

const releaseTargets = [
  {
    id: "linux_x64",
    folderName: "corrija_me_pt_br_linux_x64",
    archiveName: "corrija_me_pt_br_linux_x64.zip",
    executableSource: path.join(pkgDir, "corrija-me-pt-br-ts-linux"),
    executableRelativePath: path.join("app", "server", "corrija-me-pt-br-server"),
    executableMode: 0o755,
    readmeTitle: "corrija_me_pt_br - Linux x64",
    installRootNote: "/opt/corrija_me_pt_br",
    installFiles: async (targetRoot) => {
      await writeFile(path.join(targetRoot, "install.sh"), linuxInstallScript(), "utf8");
      await chmod(path.join(targetRoot, "install.sh"), 0o755);
      await writeFile(path.join(targetRoot, "install-jandaia.sh"), linuxInstallJandaiaScript(), "utf8");
      await chmod(path.join(targetRoot, "install-jandaia.sh"), 0o755);
      await writeFile(path.join(targetRoot, "uninstall.sh"), linuxUninstallScript(), "utf8");
      await chmod(path.join(targetRoot, "uninstall.sh"), 0o755);
    }
  },
  {
    id: "windows_x64",
    folderName: "corrija_me_pt_br_windows_x64",
    archiveName: "corrija_me_pt_br_windows_x64.zip",
    executableSource: path.join(pkgDir, "corrija-me-pt-br-ts-win.exe"),
    executableRelativePath: path.join("app", "server", "corrija-me-pt-br-server.exe"),
    executableMode: null,
    readmeTitle: "corrija_me_pt_br - Windows x64",
    installRootNote: "%LOCALAPPDATA%\\corrija_me_pt_br",
    installFiles: async (targetRoot) => {
      await writeFile(path.join(targetRoot, "install.bat"), windowsInstallBat(), "utf8");
      await writeFile(path.join(targetRoot, "install-jandaia.bat"), windowsInstallJandaiaBat(), "utf8");
      await writeFile(path.join(targetRoot, "uninstall.bat"), windowsUninstallBat(), "utf8");
      await writeFile(path.join(targetRoot, "install.ps1"), windowsInstallPs1(), "utf8");
      await writeFile(path.join(targetRoot, "install-jandaia.ps1"), windowsInstallJandaiaPs1(), "utf8");
      await writeFile(path.join(targetRoot, "uninstall.ps1"), windowsUninstallPs1(), "utf8");
      await writeFile(path.join(targetRoot, "StartServer.ps1"), windowsStartPs1(), "utf8");
      await writeFile(path.join(targetRoot, "StopServer.ps1"), windowsStopPs1(), "utf8");
      await writeFile(path.join(targetRoot, "ServerStatus.ps1"), windowsStatusPs1(), "utf8");
      await writeFile(path.join(targetRoot, "StartServer.bat"), windowsHelperBat("StartServer.ps1"), "utf8");
      await writeFile(path.join(targetRoot, "StopServer.bat"), windowsHelperBat("StopServer.ps1"), "utf8");
      await writeFile(path.join(targetRoot, "ServerStatus.bat"), windowsHelperBat("ServerStatus.ps1"), "utf8");
    }
  }
];

function linuxInstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"
INSTALL_ROOT="/opt/corrija_me_pt_br"
SERVICE_NAME="corrija-me-pt-br.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
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

if [[ ! -x "$APP_DIR/server/corrija-me-pt-br-server" ]]; then
  echo "Executavel do backend nao encontrado em $APP_DIR/server/corrija-me-pt-br-server"
  exit 1
fi

SELECTED_PORT="$(find_free_port)"
SERVER_URL="http://127.0.0.1:$SELECTED_PORT"

systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true

rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
cp -R "$APP_DIR/." "$INSTALL_ROOT/"
chmod +x "$INSTALL_ROOT/server/corrija-me-pt-br-server"

printf '%s\n' "$SELECTED_PORT" > "$PORT_FILE"
cat > "$INSTALL_ROOT/extension/server-config.json" <<EOF
{
  "serverUrl": "$SERVER_URL"
}
EOF

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=corrija_me_pt_br backend local
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_ROOT
Environment=CORRIJA_ME_PORT=$SELECTED_PORT
ExecStart=$INSTALL_ROOT/server/corrija-me-pt-br-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo
echo "Instalacao concluida."
echo "Backend local: $SERVER_URL"
echo "Extensao Chrome/Chromium:"
echo "  $INSTALL_ROOT/extension"
echo "Carregue a pasta acima em chrome://extensions"
`;
}

function linuxInstallJandaiaScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="/opt/corrija_me_pt_br"
MODELS_URL="\${CORRIJA_ME_LLM_CORE_URL:-http://127.0.0.1:11434}"
OLLAMA_BIN="\${OLLAMA_BIN:-}"

if [[ -z "$OLLAMA_BIN" ]]; then
  if command -v ollama >/dev/null 2>&1; then
    OLLAMA_BIN="$(command -v ollama)"
  elif [[ -x "$HOME/.local/bin/ollama" ]]; then
    OLLAMA_BIN="$HOME/.local/bin/ollama"
  else
    echo "Ollama nao encontrado. Instale o Ollama antes de ativar a Jandaia."
    exit 1
  fi
fi

if [[ ! -f "$INSTALL_ROOT/ai/jandaia-1.Modelfile" ]]; then
  echo "Modelfile da Jandaia nao encontrado em $INSTALL_ROOT/ai/jandaia-1.Modelfile"
  exit 1
fi

"$OLLAMA_BIN" pull qwen2.5:1.5b-instruct
"$OLLAMA_BIN" create jandaia-1 -f "$INSTALL_ROOT/ai/jandaia-1.Modelfile"

echo
echo "Jandaia instalada no Ollama local."
echo "Para usar no backend instalado pelo pacote, ative as variaveis de ambiente do servico manualmente."
echo "Backend base continua funcionando sem a LLM."
`;
}

function linuxUninstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="/opt/corrija_me_pt_br"
SERVICE_NAME="corrija-me-pt-br.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este desinstalador com sudo."
  exit 1
fi

systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
rm -f "$SERVICE_PATH"
rm -rf "$INSTALL_ROOT"
systemctl daemon-reload >/dev/null 2>&1 || true

echo
echo "Desinstalacao concluida."
echo "Arquivos removidos de $INSTALL_ROOT"
`;
}

function windowsInstallBat() {
  return `@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
`;
}

function windowsInstallJandaiaBat() {
  return `@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0install-jandaia.ps1"
`;
}

function windowsUninstallBat() {
  return `@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
`;
}

function windowsHelperBat(ps1Name) {
  return `@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0${ps1Name}"
`;
}

function windowsInstallPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root "app"
$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLauncherPath = Join-Path $startupFolder "CorrijaMePtBr-Start.bat"
$portFile = Join-Path $installRoot "server-port.txt"

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

if (-not (Test-Path (Join-Path $appDir "server\\corrija-me-pt-br-server.exe"))) {
  throw "Executavel do backend nao encontrado no pacote."
}

if (Test-Path $installRoot) {
  Remove-Item $installRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item (Join-Path $appDir "*") $installRoot -Recurse -Force

$selectedPort = Get-FreePort
$serverUrl = "http://127.0.0.1:$selectedPort"
$selectedPort | Set-Content -Path $portFile -Encoding ASCII
@"
{
  "serverUrl": "$serverUrl"
}
"@ | Set-Content -Path (Join-Path $installRoot "extension\\server-config.json") -Encoding ASCII

@"
@echo off
powershell -ExecutionPolicy Bypass -File "$installRoot\\StartServer.ps1"
"@ | Set-Content -Path $startupLauncherPath -Encoding ASCII

& (Join-Path $root "StartServer.ps1")

Write-Host ""
Write-Host "Instalacao concluida."
Write-Host "Backend local: $serverUrl"
Write-Host "Extensao Chrome/Chromium:"
Write-Host "  $installRoot\\extension"
Write-Host "Carregue a pasta acima em chrome://extensions"
`;
}

function windowsInstallJandaiaPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$modelfilePath = Join-Path $installRoot "ai\\jandaia-1.Modelfile"
$ollamaBin = if ($env:OLLAMA_BIN) { $env:OLLAMA_BIN } elseif (Get-Command ollama -ErrorAction SilentlyContinue) { "ollama" } else { $null }

if (-not $ollamaBin) {
  throw "Ollama nao encontrado. Instale o Ollama antes de ativar a Jandaia."
}

if (-not (Test-Path $modelfilePath)) {
  throw "Modelfile da Jandaia nao encontrado em $modelfilePath"
}

& $ollamaBin pull "qwen2.5:1.5b-instruct"
& $ollamaBin create "jandaia-1" "-f" $modelfilePath

Write-Host ""
Write-Host "Jandaia instalada no Ollama local."
Write-Host "O backend base continua funcionando sem a LLM."
Write-Host "A ativacao da LLM no backend empacotado fica como etapa opcional avancada."
`;
}

function windowsUninstallPs1() {
  return `$ErrorActionPreference = "Stop"

$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupLauncherPath = Join-Path $startupFolder "CorrijaMePtBr-Start.bat"
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

$selectedPort = (Get-Content $portFile -ErrorAction Stop | Select-Object -First 1).Trim()

if (Test-Path $pidFile) {
  $savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($savedPid) {
    $existingProcess = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      Write-Host "Backend ja esta em execucao."
      exit 0
    }
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$process = Start-Process -FilePath $exePath -WorkingDirectory $root -WindowStyle Hidden -PassThru -Environment @{ CORRIJA_ME_PORT = $selectedPort }
$process.Id | Set-Content -Path $pidFile -Encoding ASCII
Start-Sleep -Seconds 2
Write-Host "Backend iniciado em http://127.0.0.1:$selectedPort"
`;
}

function windowsStopPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root "server\\corrija_me_pt_br.pid"

if (-not (Test-Path $pidFile)) {
  Write-Host "Nenhum backend em execucao."
  exit 0
}

$savedPid = Get-Content $pidFile -ErrorAction SilentlyContinue
if ($savedPid) {
  $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $savedPid -Force
  }
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "Backend finalizado."
`;
}

function windowsStatusPs1() {
  return `$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$portFile = Join-Path $root "server-port.txt"
$selectedPort = (Get-Content $portFile -ErrorAction Stop | Select-Object -First 1).Trim()

try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$selectedPort/health" -UseBasicParsing -TimeoutSec 10
  Write-Host "Backend online em http://127.0.0.1:$selectedPort"
  Write-Host $response.Content
} catch {
  Write-Host "Backend offline em http://127.0.0.1:$selectedPort"
  exit 1
}
`;
}

function readmeText(title, installRootNote) {
  return `${title}
${"=".repeat(title.length)}

Versao: ${releaseVersion}

Conteudo do pacote:
- app/server
- app/extension
- app/ai
- instaladores e scripts auxiliares

Instalacao:
- Linux: execute install.sh com sudo
- Windows: execute install.bat

Jandaia local:
- a LLM NAO vem ativada por padrao no pacote base
- o produto base instala primeiro o motor e a extensao
- a ativacao da Jandaia e opcional e fica em:
  - Linux: install-jandaia.sh
  - Windows: install-jandaia.bat

Extensao do navegador:
- carregue a pasta instalada "extension" manualmente em chrome://extensions

Diretorio de instalacao previsto:
- ${installRootNote}
`;
}

function releaseManifest(target) {
  return {
    app: "corrija_me_pt_br",
    version: releaseVersion,
    target: target.id,
    archive: target.archiveName,
    generated_at: new Date().toISOString(),
    runtime: {
      primary_endpoint: "/v2/check-smart",
      first_barrier: "motor",
      fallback: "jandaia",
      instructors: ["tucano_2", "quillbot"],
      director: "gemini"
    }
  };
}

async function zipDirectory(sourceDir, outputZip) {
  await execFileAsync("zip", ["-qr", outputZip, path.basename(sourceDir)], {
    cwd: path.dirname(sourceDir)
  });
}

async function ensureExecutableExists(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Executavel nao encontrado: ${filePath}. Rode 'npm run package:backend' primeiro.`);
  }
}

async function stageTarget(target) {
  await ensureExecutableExists(target.executableSource);

  const targetRoot = path.join(stagingDir, target.folderName);
  const appRoot = path.join(targetRoot, "app");
  const extensionRoot = path.join(appRoot, "extension");
  const aiRoot = path.join(appRoot, "ai");
  const executableOutput = path.join(targetRoot, target.executableRelativePath);

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(path.dirname(executableOutput), { recursive: true });
  await cp(path.join(buildDir, "extension"), extensionRoot, { recursive: true });
  await mkdir(aiRoot, { recursive: true });
  await copyFile(path.join(rootDir, "data", "ai", "jandaia-1.Modelfile"), path.join(aiRoot, "jandaia-1.Modelfile"));
  await copyFile(target.executableSource, executableOutput);

  if (target.executableMode !== null) {
    await chmod(executableOutput, target.executableMode);
  }

  await target.installFiles(targetRoot);
  await writeFile(path.join(targetRoot, "README.txt"), `${readmeText(target.readmeTitle, target.installRootNote)}\n`, "utf8");
  await writeFile(path.join(targetRoot, "release-manifest.json"), `${JSON.stringify(releaseManifest(target), null, 2)}\n`, "utf8");

  return targetRoot;
}

async function validateStagedTarget(targetRoot, target) {
  const requiredFiles = [
    path.join(targetRoot, "README.txt"),
    path.join(targetRoot, "release-manifest.json"),
    path.join(targetRoot, "app", "extension", "manifest.json"),
    path.join(targetRoot, target.executableRelativePath)
  ];

  for (const filePath of requiredFiles) {
    if (!existsSync(filePath)) {
      throw new Error(`Pacote invalido para ${target.id}. Arquivo ausente: ${filePath}`);
    }
  }
}

async function packageTarget(target) {
  const targetRoot = await stageTarget(target);
  await validateStagedTarget(targetRoot, target);
  const archivePath = path.join(releaseDir, target.archiveName);
  await rm(archivePath, { force: true });
  await zipDirectory(targetRoot, archivePath);
  return archivePath;
}

async function main() {
  await mkdir(releaseDir, { recursive: true });
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  const outputs = [];
  for (const target of releaseTargets) {
    const archivePath = await packageTarget(target);
    outputs.push(path.relative(rootDir, archivePath));
  }

  console.log("Pacotes portateis criados:");
  for (const output of outputs) {
    console.log(`- ${output}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
