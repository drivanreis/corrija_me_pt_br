@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo O instalador encontrou um erro. Veja a mensagem acima.
  pause
  exit /b %errorlevel%
)
