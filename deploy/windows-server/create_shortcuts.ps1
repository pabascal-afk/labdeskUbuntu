param(
    [string]$baseDir,
    [string]$detectedIp = "127.0.0.1"
)

# Limpiar trailing slash si existe
if ($baseDir.EndsWith("\") -or $baseDir.EndsWith("/")) {
    $baseDir = $baseDir.Substring(0, $baseDir.Length - 1)
}

# Intentar primero en el escritorio del usuario actual, que siempre tiene permisos de escritura
$desktopDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
if (-not (Test-Path $desktopDir)) {
    $desktopDir = Join-Path $env:USERPROFILE "Desktop"
}

$ws = New-Object -ComObject WScript.Shell

function Save-Shortcut($path, $target, $workDir, $icon) {
    try {
        $s = $ws.CreateShortcut($path)
        $s.TargetPath = $target
        $s.WorkingDirectory = $workDir
        if ($icon) { $s.IconLocation = $icon }
        $s.Save()
    } catch {
        # Ignorar fallo individual
    }
}

# 1. Accesos en el escritorio del usuario
Save-Shortcut (Join-Path $desktopDir "LabDesk - Iniciar Servidor (Consola).lnk") (Join-Path $baseDir "2_Iniciar_Consola.bat") $baseDir "shell32.dll,13"
Save-Shortcut (Join-Path $desktopDir "LabDesk - Iniciar Segundo Plano.lnk") (Join-Path $baseDir "3_Instalar_Inicio_Automatico.bat") $baseDir "shell32.dll,26"

try {
    "[InternetShortcut]`r`nURL=http://localhost:3000" | Out-File -FilePath (Join-Path $desktopDir "LabDesk - Panel Administrador.url") -Encoding ASCII -Force
    "[InternetShortcut]`r`nURL=http://localhost:3000/botonera" | Out-File -FilePath (Join-Path $desktopDir "LabDesk - Botonera Profesor.url") -Encoding ASCII -Force
} catch {}

Write-Host "[OK] Accesos directos creados correctamente en el Escritorio."
