@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
if errorlevel 1 (
  echo.
  echo O desinstalador encontrou um erro. Veja a mensagem acima.
  pause
  exit /b %errorlevel%
)
