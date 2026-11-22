@echo off
setlocal
title Lume
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar-windows.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo O app encerrou com erro. Codigo de saida: %EXITCODE%
  echo O log fica em %%LOCALAPPDATA%%\Lume\logs
  echo.
  pause
)
exit /b %EXITCODE%
