@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo O instalador encontrou um erro. Veja a mensagem acima.
  pause
  exit /b %errorlevel%
)
