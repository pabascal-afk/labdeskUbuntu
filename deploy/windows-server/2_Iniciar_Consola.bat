@echo off
setlocal
cd /d "%~dp0"
title LabDesk Server - Consola en Vivo

set "SERVER_DIR=%~dp0server"
if not exist "%SERVER_DIR%\src\index.js" (
    if exist "%~dp0src\index.js" (
        set "SERVER_DIR=%~dp0"
    ) else if exist "%~dp0..\..\server\src\index.js" (
        set "SERVER_DIR=%~dp0..\..\server"
    )
)

if not exist "%SERVER_DIR%\src\index.js" (
    echo [ERROR] No se encontro server\src\index.js.
    echo Asegurate de descomprimir el archivo ZIP completo antes de ejecutar.
    pause
    exit /b 1
)

cls
echo ==============================================================================
echo        LabDesk Server - Servidor Central de Laboratorio (Windows 10)
echo ==============================================================================
echo.
echo   * URL Local (en este PC):    http://localhost:3000
echo   * Botonera del Profesor:     http://localhost:3000/botonera
echo.
echo   [!] Para detener el servidor, pulsa CTRL + C o cierra esta ventana.
echo ==============================================================================
echo.

cd /d "%SERVER_DIR%"
node src/index.js

echo.
echo [AVISO] El servidor se ha detenido.
pause
