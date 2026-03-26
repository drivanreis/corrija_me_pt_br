$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$jarPath = Join-Path $projectRoot "languagetool-server\target\languagetool-server-6.8-SNAPSHOT.jar"
$configPath = Join-Path $projectRoot "config\corrija-me-pt-br-local.properties"
$extensionSource = Join-Path $projectRoot "extensao_chrome"
$windowsPackaging = Join-Path $projectRoot "packaging\windows"
$installRoot = Join-Path $env:LOCALAPPDATA "corrija_me_pt_br"
$serverRoot = Join-Path $installRoot "server"
$extensionTarget = Join-Path $installRoot "chrome-extension"
$extensionManifestSource = Join-Path $extensionSource "manifest.json"
$extensionManifestTarget = Join-Path $extensionTarget "manifest.json"

function Refresh-Path {
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Write-HelperLauncher {
  $openFolderLauncherPath = Join-Path $installRoot "AbrirPastaDaExtensao.bat"
  $openFolderContent = @"
@echo off
start "" explorer.exe "$extensionTarget"
"@
  Set-Content -Path $openFolderLauncherPath -Value $openFolderContent -Encoding ASCII

  $openChromeLauncherPath = Join-Path $installRoot "AbrirChromeExtensions.bat"
  $openChromeContent = @"
@echo off
start "" chrome://extensions
"@
  Set-Content -Path $openChromeLauncherPath -Value $openChromeContent -Encoding ASCII

  $openBothLauncherPath = Join-Path $installRoot "AbrirExtensaoEChrome.bat"
  $openBothContent = @"
@echo off
start "" explorer.exe "$extensionTarget"
start "" chrome://extensions
"@
  Set-Content -Path $openBothLauncherPath -Value $openBothContent -Encoding ASCII
}

function Write-WindowsStartupLauncher {
  $startupFolder = [Environment]::GetFolderPath("Startup")
  if (-not $startupFolder) {
    throw "Nao foi possivel localizar a pasta de inicializacao do Windows."
  }

  $startupLauncherPath = Join-Path $startupFolder "IniciarCorrijaMePtBr.bat"
  $startupLauncherContent = @"
@echo off
start "" /min "$installRoot\IniciarServidor.bat"
"@
  Set-Content -Path $startupLauncherPath -Value $startupLauncherContent -Encoding ASCII
}

function Get-ChromePath {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Chromium\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Chromium\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "BraveSoftware\Brave-Browser\Application\brave.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "BraveSoftware\Brave-Browser\Application\brave.exe")
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  $chromeFromPath = Get-CommandPath "chrome.exe"
  if ($chromeFromPath) {
    return $chromeFromPath
  }

  $braveFromPath = Get-CommandPath "brave.exe"
  if ($braveFromPath) {
    return $braveFromPath
  }

  return $null
}

function Wait-ForServer {
  for ($i = 0; $i -lt 15; $i++) {
    try {
      $response = Invoke-WebRequest -Uri "http://localhost:8081/v2/languages" -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -eq 200 -and $response.Content -match '"longCode":"pt-BR"') {
        return $true
      }
    } catch {
    }
    Start-Sleep -Seconds 1
  }

  return $false
}

function Get-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  return $null
}

function Get-JavaFromRegistry {
  $registryKeys = @(
    "HKLM:\SOFTWARE\JavaSoft\JDK",
    "HKLM:\SOFTWARE\JavaSoft\JRE",
    "HKLM:\SOFTWARE\WOW6432Node\JavaSoft\JDK",
    "HKLM:\SOFTWARE\WOW6432Node\JavaSoft\JRE",
    "HKLM:\SOFTWARE\Eclipse Adoptium\JDK",
    "HKLM:\SOFTWARE\Eclipse Foundation\JDK",
    "HKLM:\SOFTWARE\Microsoft\JDK",
    "HKCU:\SOFTWARE\JavaSoft\JDK",
    "HKCU:\SOFTWARE\JavaSoft\JRE"
  )

  foreach ($keyPath in $registryKeys) {
    if (-not (Test-Path $keyPath)) {
      continue
    }

    try {
      $key = Get-ItemProperty -Path $keyPath -ErrorAction Stop
      $versionCandidates = @()
      if ($key.CurrentVersion) {
        $versionCandidates += $key.CurrentVersion
      }
      $versionCandidates += @(Get-ChildItem -Path $keyPath -ErrorAction SilentlyContinue | Select-Object -ExpandProperty PSChildName)

      foreach ($version in ($versionCandidates | Select-Object -Unique)) {
        if (-not $version) {
          continue
        }
        $versionKeyPath = Join-Path $keyPath $version
        if (-not (Test-Path $versionKeyPath)) {
          continue
        }

        $versionKey = Get-ItemProperty -Path $versionKeyPath -ErrorAction SilentlyContinue
        if (-not $versionKey.JavaHome) {
          continue
        }

        $javaExe = Join-Path $versionKey.JavaHome "bin\java.exe"
        if ((Test-Path $javaExe) -and $version -match '^17([._].*)?$') {
          return $javaExe
        }
      }
    } catch {
    }
  }

  return $null
}

function Get-JavaFromCommonPaths {
  $patterns = @(
    "$env:ProgramFiles\Microsoft\jdk-17*\bin\java.exe",
    "$env:ProgramFiles\Eclipse Adoptium\jdk-17*\bin\java.exe",
    "$env:ProgramFiles\Eclipse Foundation\jdk-17*\bin\java.exe",
    "$env:ProgramFiles\Java\jdk-17*\bin\java.exe",
    "$env:ProgramFiles\Java\jre-17*\bin\java.exe",
    "${env:ProgramFiles(x86)}\Java\jdk-17*\bin\java.exe"
  )

  foreach ($pattern in $patterns) {
    $match = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      return $match.FullName
    }
  }

  return $null
}

function Ensure-Java17 {
  $javaFromPath = Get-CommandPath "java.exe"
  if ($javaFromPath) {
    return $javaFromPath
  }

  $javaFromRegistry = Get-JavaFromRegistry
  if ($javaFromRegistry) {
    return $javaFromRegistry
  }

  $javaFromCommonPaths = Get-JavaFromCommonPaths
  if ($javaFromCommonPaths) {
    return $javaFromCommonPaths
  }

  $winget = Get-CommandPath "winget.exe"
  if (-not $winget) {
    throw "Java 17 nao encontrado. Instale o Java 17 manualmente, ou ative o winget, e execute install.bat novamente."
  }

  Write-Host "Instalando Java 17 via winget..."
  & $winget install --id Microsoft.OpenJDK.17 --accept-package-agreements --accept-source-agreements --silent

  Refresh-Path
  $javaAfterInstall = Get-CommandPath "java.exe"
  if ($javaAfterInstall) {
    return $javaAfterInstall
  }

  $javaAfterInstall = Get-JavaFromRegistry
  if ($javaAfterInstall) {
    return $javaAfterInstall
  }

  $javaAfterInstall = Get-JavaFromCommonPaths
  if ($javaAfterInstall) {
    return $javaAfterInstall
  }

  throw "Java 17 foi instalado, mas ainda nao foi localizado. Feche e abra o terminal e execute install.bat novamente."
}

function Ensure-WingetPackage([string]$CommandName, [string]$PackageId, [string]$FriendlyName) {
  $commandPath = Get-CommandPath $CommandName
  if ($commandPath) {
    return $commandPath
  }

  $winget = Get-CommandPath "winget.exe"
  if (-not $winget) {
    throw "$FriendlyName nao encontrado. Instale manualmente, ou ative o winget, e execute install.bat novamente."
  }

  Write-Host "Instalando $FriendlyName via winget..."
  & $winget install --id $PackageId --accept-package-agreements --accept-source-agreements --silent

  Refresh-Path
  $commandPath = Get-CommandPath $CommandName
  if (-not $commandPath) {
    throw "$FriendlyName foi instalado, mas ainda nao esta disponivel no PATH. Feche e abra o terminal e execute install.bat novamente."
  }

  return $commandPath
}

Refresh-Path

$javaCommand = Ensure-Java17
$mavenCommand = Ensure-WingetPackage "mvn.cmd" "Apache.Maven" "Maven"

if (-not (Test-Path $extensionManifestSource)) {
  throw "Manifesto da extensao nao encontrado em $extensionManifestSource"
}

Push-Location $projectRoot
try {
  Write-Host "Empacotando servidor local do corrija_me_pt_br..."
  & $mavenCommand -q -pl languagetool-server -am -Pfat-jar -DskipTests package -Dmaven.gitcommitid.skip=true
} finally {
  Pop-Location
}

if (-not (Test-Path $jarPath)) {
  throw "Jar do servidor nao encontrado em $jarPath"
}

if (Test-Path $installRoot) {
  Remove-Item $installRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null
New-Item -ItemType Directory -Path $extensionTarget -Force | Out-Null

Copy-Item $jarPath (Join-Path $serverRoot "languagetool-server.jar")
Copy-Item $configPath (Join-Path $serverRoot "corrija-me-pt-br-local.properties")
Copy-Item (Join-Path $windowsPackaging "*") $installRoot -Recurse
Copy-Item (Join-Path $extensionSource "*") $extensionTarget -Recurse
Write-HelperLauncher
Write-WindowsStartupLauncher

if (-not (Test-Path $extensionManifestTarget)) {
  throw "Manifesto da extensao nao foi copiado corretamente para $extensionManifestTarget"
}

Write-Host "Iniciando servidor local..."
& (Join-Path $installRoot "IniciarServidor.ps1")

if (Wait-ForServer) {
  Write-Host "Servidor local respondeu corretamente em http://localhost:8081"
} else {
  Write-Warning "O servidor foi iniciado, mas ainda nao respondeu como esperado na porta 8081."
}

Start-Process explorer.exe $extensionTarget | Out-Null
$chromePath = Get-ChromePath
if ($chromePath) {
  Start-Process $chromePath "chrome://extensions" | Out-Null
} else {
  Start-Process "cmd.exe" '/c start chrome://extensions' -ErrorAction SilentlyContinue | Out-Null
}

Write-Host ""
Write-Host "Instalacao concluida."
Write-Host "No Chrome, clique em 'Carregar sem compactacao' e selecione:"
Write-Host "  $extensionTarget"
Write-Host ""
Write-Host "O servidor sera iniciado automaticamente quando voce entrar no Windows."
Write-Host ""
Write-Host "Atalhos criados para facilitar:"
Write-Host "  $installRoot\AbrirPastaDaExtensao.bat"
Write-Host "  $installRoot\AbrirChromeExtensions.bat"
Write-Host "  $installRoot\AbrirExtensaoEChrome.bat"
