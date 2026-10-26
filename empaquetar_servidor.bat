@echo off
setlocal EnableDelayedExpansion
title LabDesk - Empaquetador del Servidor para Windows 10
cd /d "%~dp0"

echo ==============================================================================
echo        LabDesk - Empaquetador del Servidor para Traslado a Windows 10
echo ==============================================================================
echo.
echo Preparando paquete autonomo para llevar en pendrive USB...
echo.

set "STAGING_DIR=%TEMP%\labdesk_server_stage_%RANDOM%"
set "OUT_ZIP=%~dp0LabDesk_Servidor_Windows10.zip"

:: 1. Crear directorio temporal limpio
mkdir "%STAGING_DIR%" 2>nul
mkdir "%STAGING_DIR%\server" 2>nul

echo [1/4] Copiando codigo fuente del servidor y panel web...
xcopy /E /I /Q /Y "server\src" "%STAGING_DIR%\server\src" >nul
xcopy /E /I /Q /Y "server\public" "%STAGING_DIR%\server\public" >nul
copy /Y "server\package.json" "%STAGING_DIR%\server\package.json" >nul

if exist "server\node_modules" (
    echo       Incluyendo dependencias de Node.js para despliegue offline...
    xcopy /E /I /Q /Y "server\node_modules" "%STAGING_DIR%\server\node_modules" >nul
)

echo [2/4] Copiando instaladores y herramientas para Windows 10...
copy /Y "deploy\windows-server\1_Instalar_Servidor.bat" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\1_Instalar_Servidor.ps1" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\instalar.ps1" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\2_Iniciar_Consola.bat" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\3_Instalar_Inicio_Automatico.bat" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\4_Desinstalar_Inicio_Automatico.bat" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\run_hidden.vbs" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\detect_ip.ps1" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\create_shortcuts.ps1" "%STAGING_DIR%\" >nul
copy /Y "deploy\windows-server\INSTRUCCIONES_WINDOWS10.md" "%STAGING_DIR%\" >nul

echo [3/4] Comprimiendo archivo ZIP (LabDesk_Servidor_Windows10.zip)...
if exist "%OUT_ZIP%" del "%OUT_ZIP%" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGING_DIR%\*' -DestinationPath '%OUT_ZIP%' -Force"

echo [4/4] Limpiando archivos temporales...
rd /s /q "%STAGING_DIR%" 2>nul

echo.
echo ==============================================================================
echo   ¡PAQUETE CREADO EXITOSAMENTE!
echo ==============================================================================
echo   Archivo ZIP generado:
echo   %OUT_ZIP%
echo.
echo   Paso siguiente:
echo   1. Copia 'LabDesk_Servidor_Windows10.zip' a un pendrive USB.
echo   2. Conectalo en el PC destino con Windows 10.
echo   3. Descomprimelo (Extraer todo) y ejecuta '1_Instalar_Servidor.bat'
echo      o haz clic derecho en '1_Instalar_Servidor.ps1' -> 'Ejecutar con PowerShell'.
echo ==============================================================================
echo.
pause
