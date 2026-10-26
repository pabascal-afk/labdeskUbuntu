@echo off
title LabDesk - Botonera del Profesor (SemiAdmin)
set SERVER_URL=%1
if "%SERVER_URL%"=="" set SERVER_URL=http://localhost:3000/botonera

echo ========================================================
echo   LabDesk - Botonera de Control de Sala para Profesores
echo ========================================================
echo Abriendo consola en: %SERVER_URL%
echo.

start msedge --app="%SERVER_URL%" 2>nul || start chrome --app="%SERVER_URL%" 2>nul || start "" "%SERVER_URL%"
exit
