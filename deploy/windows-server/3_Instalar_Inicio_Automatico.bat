@echo off
setlocal
cd /d "%~dp0"
title LabDesk - Configurar Inicio Automatico en Windows 10

echo ==============================================================================
echo         LabDesk - Configurar Arranque Automatico en Segundo Plano
echo ==============================================================================
echo.
echo Configurando el servidor para que se inicie automaticamente cada vez
echo que inicie Windows, sin ventanas visibles (inmune a cierres accidentales)...
echo.

set "VBS_SCRIPT=%~dp0run_hidden.vbs"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$startup = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Startup); " ^
  "$s = $ws.CreateShortcut((Join-Path $startup 'LabDesk_Background_Server.lnk')); " ^
  "$s.TargetPath = 'wscript.exe'; " ^
  "$s.Arguments = '\"%VBS_SCRIPT%\"'; " ^
  "$s.WorkingDirectory = '%~dp0.'; " ^
  "$s.IconLocation = 'shell32.dll,26'; " ^
  "$s.Save();"

echo [OK] Agregado a la carpeta de Inicio de Windows.

echo.
echo Iniciando LabDesk Server en segundo plano ahora...
wscript.exe "%VBS_SCRIPT%"

timeout /t 2 /nobreak >nul

echo.
echo ==============================================================================
echo   ¡EL SERVIDOR YA ESTA CORRIENDO EN SEGUNDO PLANO!
echo ==============================================================================
echo   * URL en este PC:     http://localhost:3000
echo   * Botonera Profesor:  http://localhost:3000/botonera
echo   * Archivo de Log:     %~dp0server.log
echo ==============================================================================
echo.
echo Puedes cerrar esta ventana. El servidor seguira activo y arrancara solo
echo cada vez que se encienda este computador.
echo.
pause
