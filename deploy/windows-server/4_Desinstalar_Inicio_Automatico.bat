@echo off
title LabDesk - Desactivar Inicio Automatico
cd /d "%~dp0"

echo ==============================================================================
echo         LabDesk - Desactivar Arranque Automatico
echo ==============================================================================
echo.

:: 1. Eliminar acceso de la carpeta de inicio
set "STARTUP_LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LabDesk_Background_Server.lnk"
if exist "%STARTUP_LNK%" (
    del "%STARTUP_LNK%" 2>nul
    echo [OK] Acceso directo eliminado de la carpeta de Inicio.
)

:: 2. Eliminar tarea programada
schtasks /delete /tn "LabDesk_Server" /f >nul 2>&1
echo [OK] Tarea programada 'LabDesk_Server' eliminada si existia.

:: 3. Opcional: Detener procesos de Node si estan corriendo
echo.
set /p STOP_NOW="¿Deseas detener el servidor de Node que esta corriendo ahora? (S/N): "
if /i "%STOP_NOW%"=="S" (
    taskkill /F /IM node.exe >nul 2>&1
    echo [OK] Proceso del servidor detenido.
)

echo.
echo ==============================================================================
echo  Listo. El servidor ya no arrancara automaticamente con Windows.
echo  Puedes iniciarlo manualmente cuando quieras usando '2_Iniciar_Consola.bat'.
echo ==============================================================================
echo.
pause
