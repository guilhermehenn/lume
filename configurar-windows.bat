@echo off
setlocal
title Configurar ambiente - Windows
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\setup-windows.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" (
  echo Configuracao concluida. Para abrir o app, use o iniciar-windows.bat
) else (
  echo A configuracao terminou com erro. Veja o log na pasta setup\logs
)
echo.
pause
exit /b %EXITCODE%
