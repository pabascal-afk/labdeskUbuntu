@echo off
setlocal
cd /d "%~dp0"
title LabDesk - Instalador del Servidor en Windows 10

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if %errorlevel% neq 0 (
    echo.
    echo ==============================================================================
    echo  Si PowerShell esta bloqueado, haz clic derecho sobre '1_Instalar_Servidor.ps1'
    echo  y selecciona 'Ejecutar con PowerShell'.
    echo ==============================================================================
    echo.
    pause
)
