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
$toolsRoot = Join-Path $installRoot "tools"
$bootstrapRoot = Join-Path $env:TEMP "corrija_me_pt_br_bootstrap"
$script:BootstrapJavaHome = $null

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

function Get-JavaMajorVersion([string]$JavaPath) {
  if (-not $JavaPath -or -not (Test-Path $JavaPath)) {
    return $null
  }

  try {
    $versionOutput = & $JavaPath -version 2>&1 | Select-Object -First 1
    if (-not $versionOutput) {
      return $null
    }

    $versionText = $versionOutput.ToString()
    if ($versionText -match '"([^"]+)"') {
      $rawVersion = $matches[1]
      if ($rawVersion -match '^1\.(\d+)') {
        return [int]$matches[1]
      }
      if ($rawVersion -match '^(\d+)') {
        return [int]$matches[1]
      }
    }
  } catch {
  }

  return $null
}

function Test-Java17OrNewer([string]$JavaPath) {
  $majorVersion = Get-JavaMajorVersion $JavaPath
  return ($majorVersion -ne $null -and $majorVersion -ge 17)
}

function Get-JavaFromJavaHome {
  if (-not $env:JAVA_HOME) {
    return $null
  }

  $candidate = Join-Path $env:JAVA_HOME "bin\java.exe"
  if ((Test-Path $candidate) -and (Test-Java17OrNewer $candidate)) {
    return $candidate
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
        if ((Test-Path $javaExe) -and (Test-Java17OrNewer $javaExe)) {
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
    if ($match -and (Test-Java17OrNewer $match.FullName)) {
      return $match.FullName
    }
  }

  return $null
}

function Expand-ZipArchive([string]$ZipPath, [string]$DestinationPath) {
  if (Test-Path $DestinationPath) {
    Remove-Item $DestinationPath -Recurse -Force
  }
  Expand-Archive -Path $ZipPath -DestinationPath $DestinationPath -Force
}

function Get-FirstDirectory([string]$RootPath) {
  return Get-ChildItem -Path $RootPath -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Install-BootstrapJava17 {
  $javaZipPath = Join-Path $bootstrapRoot "jdk17.zip"
  $javaExtractRoot = Join-Path $bootstrapRoot "jdk17"
  $javaDownloadUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"

  New-Item -ItemType Directory -Path $bootstrapRoot -Force | Out-Null

  Write-Host "Baixando Java 17 portatil..."
  Invoke-WebRequest -Uri $javaDownloadUrl -OutFile $javaZipPath
  Expand-ZipArchive -ZipPath $javaZipPath -DestinationPath $javaExtractRoot

  $javaHomeDir = Get-FirstDirectory $javaExtractRoot
  if (-not $javaHomeDir) {
    throw "Nao foi possivel extrair o Java 17 portatil."
  }

  $javaExe = Join-Path $javaHomeDir.FullName "bin\java.exe"
  if (-not (Test-Path $javaExe) -or -not (Test-Java17OrNewer $javaExe)) {
    throw "O Java 17 portatil foi baixado, mas nao foi localizado corretamente."
  }

  $script:BootstrapJavaHome = $javaHomeDir.FullName
  return $javaExe
}

function Ensure-Java17 {
  $javaFromJavaHome = Get-JavaFromJavaHome
  if ($javaFromJavaHome) {
    return $javaFromJavaHome
  }

  $javaFromPath = Get-CommandPath "java.exe"
  if ($javaFromPath -and (Test-Java17OrNewer $javaFromPath)) {
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
  if ($winget) {
    Write-Host "Instalando Java 17 via winget..."
    & $winget install --id Microsoft.OpenJDK.17 --accept-package-agreements --accept-source-agreements --silent

    Refresh-Path
    $javaAfterInstall = Get-JavaFromJavaHome
    if ($javaAfterInstall) {
      return $javaAfterInstall
    }

    $javaAfterInstall = Get-CommandPath "java.exe"
    if ($javaAfterInstall -and (Test-Java17OrNewer $javaAfterInstall)) {
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
  }

  return Install-BootstrapJava17
}

function Get-MavenFromEnvironment {
  foreach ($homeVar in @($env:MAVEN_HOME, $env:M2_HOME)) {
    if (-not $homeVar) {
      continue
    }

    $candidate = Join-Path $homeVar "bin\mvn.cmd"
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Get-MavenFromCommonPaths {
  $patterns = @(
    "$env:ProgramFiles\Apache\maven\bin\mvn.cmd",
    "$env:ProgramFiles\apache-maven-*\bin\mvn.cmd",
    "${env:ProgramFiles(x86)}\apache-maven-*\bin\mvn.cmd"
  )

  foreach ($pattern in $patterns) {
    $match = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      return $match.FullName
    }
  }

  return $null
}

function Install-BootstrapMaven {
  $mavenVersion = "3.9.9"
  $mavenZipPath = Join-Path $bootstrapRoot "maven.zip"
  $mavenExtractRoot = Join-Path $bootstrapRoot "maven"
  $mavenDownloadUrl = "https://archive.apache.org/dist/maven/maven-3/$mavenVersion/binaries/apache-maven-$mavenVersion-bin.zip"

  New-Item -ItemType Directory -Path $bootstrapRoot -Force | Out-Null

  Write-Host "Baixando Maven portatil..."
  Invoke-WebRequest -Uri $mavenDownloadUrl -OutFile $mavenZipPath
  Expand-ZipArchive -ZipPath $mavenZipPath -DestinationPath $mavenExtractRoot

  $mavenHomeDir = Get-FirstDirectory $mavenExtractRoot
  if (-not $mavenHomeDir) {
    throw "Nao foi possivel extrair o Maven portatil."
  }

  $mavenCmd = Join-Path $mavenHomeDir.FullName "bin\mvn.cmd"
  if (-not (Test-Path $mavenCmd)) {
    throw "O Maven portatil foi baixado, mas nao foi localizado corretamente."
  }

  return $mavenCmd
}

function Ensure-WingetPackage([string]$CommandName, [string]$PackageId, [string]$FriendlyName) {
  $commandFromEnvironment = Get-MavenFromEnvironment
  if ($CommandName -eq "mvn.cmd" -and $commandFromEnvironment) {
    return $commandFromEnvironment
  }

  $commandPath = Get-CommandPath $CommandName
  if ($commandPath) {
    return $commandPath
  }

  if ($CommandName -eq "mvn.cmd") {
    $commandFromCommonPaths = Get-MavenFromCommonPaths
    if ($commandFromCommonPaths) {
      return $commandFromCommonPaths
    }
  }

  $winget = Get-CommandPath "winget.exe"
  if ($winget) {
    Write-Host "Instalando $FriendlyName via winget..."
    & $winget install --id $PackageId --accept-package-agreements --accept-source-agreements --silent

    Refresh-Path

    if ($CommandName -eq "mvn.cmd") {
      $commandPath = Get-MavenFromEnvironment
      if ($commandPath) {
        return $commandPath
      }

      $commandPath = Get-CommandPath $CommandName
      if ($commandPath) {
        return $commandPath
      }

      $commandPath = Get-MavenFromCommonPaths
      if ($commandPath) {
        return $commandPath
      }
    } else {
      $commandPath = Get-CommandPath $CommandName
      if ($commandPath) {
        return $commandPath
      }
    }
  }

  if ($CommandName -eq "mvn.cmd") {
    return Install-BootstrapMaven
  }

  throw "$FriendlyName nao foi localizado."
}

Refresh-Path

$javaCommand = Ensure-Java17
$javaHome = Split-Path (Split-Path $javaCommand -Parent) -Parent
$env:JAVA_HOME = $javaHome
$env:Path = "$(Join-Path $javaHome 'bin');$env:Path"
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

if ($script:BootstrapJavaHome) {
  New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
  Copy-Item $script:BootstrapJavaHome (Join-Path $toolsRoot "jdk") -Recurse -Force
}

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
