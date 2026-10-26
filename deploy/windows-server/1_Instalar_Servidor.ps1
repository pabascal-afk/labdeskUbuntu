# ==============================================================================
# LabDesk Server - Instalador Oficial para Windows 10
# ==============================================================================
$Host.UI.RawUI.WindowTitle = "LabDesk Server - Instalador Windows 10"

# 1. Comprobacion y elevacion de permisos de Administrador (.NET Nativo)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "==============================================================================" -ForegroundColor Yellow
    Write-Host " [!] Se requieren permisos de Administrador para configurar el Firewall." -ForegroundColor Yellow
    Write-Host "     Solicitando elevacion con Windows UAC..." -ForegroundColor Yellow
    Write-Host "==============================================================================" -ForegroundColor Yellow
    Write-Host ""
    
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "powershell.exe"
        $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        $psi.Verb = "RunAs"
        [System.Diagnostics.Process]::Start($psi) | Out-Null
        exit 0
    } catch {
        Write-Host "[ERROR] No se pudo solicitar elevacion: $_" -ForegroundColor Red
        Write-Host "Haz clic derecho sobre este instalador y selecciona 'Ejecutar con PowerShell' o 'Ejecutar como administrador'." -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Presiona Enter para salir..."
        exit 1
    }
}

Clear-Host
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "           LabDesk - Instalador del Servidor Central en Windows 10             " -ForegroundColor White
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

$baseDir = $PSScriptRoot

# 2. Localizar carpeta del servidor (prevenir correr dentro del ZIP sin extraer)
$serverDir = $null
if (Test-Path (Join-Path $baseDir "server\package.json")) {
    $serverDir = Join-Path $baseDir "server"
} elseif (Test-Path (Join-Path $baseDir "package.json")) {
    $serverDir = $baseDir
} elseif (Test-Path (Join-Path $baseDir "..\..\server\package.json")) {
    $serverDir = (Resolve-Path (Join-Path $baseDir "..\..\server")).Path
}

if (-not $serverDir) {
    Write-Host "==============================================================================" -ForegroundColor Red
    Write-Host " [ERROR CRITICO] No se encontraron los archivos de LabDesk Server." -ForegroundColor Red
    Write-Host ""
    Write-Host " Posibles causas:" -ForegroundColor Yellow
    Write-Host " 1. Abriste este archivo directamente desde dentro del ZIP sin extraerlo." -ForegroundColor White
    Write-Host "    SOLUCION: Haz clic derecho sobre 'LabDesk_Servidor_Windows10.zip'," -ForegroundColor Green
    Write-Host "              elige 'Extraer todo...' y ejecuta el instalador desde la carpeta extraida." -ForegroundColor Green
    Write-Host " 2. Los archivos del servidor se movieron de lugar." -ForegroundColor White
    Write-Host "==============================================================================" -ForegroundColor Red
    Write-Host ""
    Read-Host "Presiona Enter para salir..."
    exit 1
}

# 3. Comprobacion e instalacion de Node.js
Write-Host "[1/5] Verificando instalacion de Node.js..." -ForegroundColor Yellow
$nodeInstalled = $false
try {
    $nodeVer = & node -v 2>$null
    if ($nodeVer -match '^v\d+') {
        $nodeInstalled = $true
        Write-Host "  [OK] Node.js detectado: $nodeVer" -ForegroundColor Green
    }
} catch {
    $nodeInstalled = $false
}

if (-not $nodeInstalled) {
    Write-Host "  Node.js no esta presente en este equipo." -ForegroundColor Yellow
    Write-Host "  Descargando e instalando Node.js v20 LTS oficial (64-bit)..." -ForegroundColor Cyan
    
    $nodeMsi = Join-Path $env:TEMP "nodejs_setup.msi"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        (New-Object Net.WebClient).DownloadFile("https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi", $nodeMsi)
    } catch {
        Write-Host ""
        Write-Host "==============================================================================" -ForegroundColor Red
        Write-Host " [ERROR] No se pudo descargar Node.js automaticamente (sin conexion a internet)." -ForegroundColor Red
        Write-Host " Por favor instala Node.js manualmente:" -ForegroundColor Yellow
        Write-Host " 1. Descargalo desde https://nodejs.org/ e instalalo." -ForegroundColor White
        Write-Host " 2. Vuelve a ejecutar este instalador." -ForegroundColor White
        Write-Host "==============================================================================" -ForegroundColor Red
        Write-Host ""
        Read-Host "Presiona Enter para salir..."
        exit 1
    }

    Write-Host "  Instalando Node.js silenciosamente, por favor espera unos segundos..." -ForegroundColor Cyan
    $proc = Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn /norestart" -Wait -PassThru
    Remove-Item $nodeMsi -Force -ErrorAction SilentlyContinue

    $env:PATH += ";C:\Program Files\nodejs"
    [Environment]::SetEnvironmentVariable("PATH", $env:PATH, [EnvironmentVariableTarget]::Process)

    try {
        $nodeVer = & node -v 2>$null
        Write-Host "  [OK] Node.js instalado correctamente ($nodeVer)." -ForegroundColor Green
    } catch {
        Write-Host "  [OK] Node.js ha sido instalado en el sistema." -ForegroundColor Green
        Write-Host "  [AVISO] Por favor reinicia este instalador para cargar las nuevas variables de entorno." -ForegroundColor Yellow
        Read-Host "Presiona Enter para cerrar..."
        exit 0
    }
}

# 4. Verificacion de modulos del servidor (node_modules)
Write-Host ""
Write-Host "[2/5] Verificando dependencias de LabDesk Server..." -ForegroundColor Yellow
$modulesDir = Join-Path $serverDir "node_modules"

if (Test-Path $modulesDir) {
    Write-Host "  [OK] Dependencias de Node.js ya presentes (modo offline listo)." -ForegroundColor Green
} else {
    Write-Host "  Instalando dependencias de produccion (npm install)..." -ForegroundColor Cyan
    Push-Location $serverDir
    try {
        & npm.cmd install --omit=dev | Out-Null
    } catch {
        & npm install --omit=dev | Out-Null
    }
    Pop-Location

    if (Test-Path $modulesDir) {
        Write-Host "  [OK] Dependencias instaladas con exito." -ForegroundColor Green
    } else {
        Write-Host "  [AVISO] Si hubo problemas con npm, asegurate de tener conexion a internet." -ForegroundColor Yellow
    }
}

# 5. Configuracion del Firewall de Windows (Abrir TCP 3000)
Write-Host ""
Write-Host "[3/5] Configurando regla en Firewall de Windows Defender (Puerto 3000)..." -ForegroundColor Yellow

try {
    # Intentar con cmdlet nativo de PowerShell
    Remove-NetFirewallRule -DisplayName "LabDesk Server (TCP 3000)" -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName "LabDesk Server (TCP 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any -ErrorAction Stop | Out-Null
    Write-Host "  [OK] Puerto 3000 TCP habilitado en el Firewall (Perfiles: Dominio, Privada, Publica)." -ForegroundColor Green
} catch {
    # Fallback con netsh
    try {
        & netsh advfirewall firewall delete rule name="LabDesk Server (TCP 3000)" | Out-Null
        & netsh advfirewall firewall add rule name="LabDesk Server (TCP 3000)" dir=in action=allow protocol=TCP localport=3000 profile=any | Out-Null
        Write-Host "  [OK] Puerto 3000 TCP habilitado mediante netsh advfirewall." -ForegroundColor Green
    } catch {
        Write-Host "  [AVISO] No se pudo configurar el Firewall automaticamente: $_" -ForegroundColor Yellow
    }
}

# 6. Deteccion de la IP local en la red
Write-Host ""
Write-Host "[4/5] Detectando direccion IP de la red escolar..." -ForegroundColor Yellow

$detectedIp = "127.0.0.1"
try {
    $interfaces = Get-NetIPConfiguration | Where-Object { 
        $_.IPv4Address -and 
        $_.InterfaceAlias -notmatch 'vEthernet|Virtual|Loopback|WSL|Bluetooth' -and
        $_.IPv4DefaultGateway
    }
    if ($interfaces) {
        $detectedIp = ($interfaces[0].IPv4Address.IPAddress | Select-Object -First 1)
    } else {
        $ipObj = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
            $_.IPAddress -notlike "127.*" -and 
            $_.IPAddress -notlike "169.254.*"
        } | Select-Object -First 1
        if ($ipObj) { $detectedIp = $ipObj.IPAddress }
    }
} catch {
    $detectedIp = "127.0.0.1"
}
Write-Host "  [OK] IP local detectada: $detectedIp" -ForegroundColor Green

# 7. Creacion de accesos directos en el Escritorio
Write-Host ""
Write-Host "[5/5] Creando accesos directos en el Escritorio..." -ForegroundColor Yellow

$desktopDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$ws = New-Object -ComObject WScript.Shell

function Make-Shortcut($lnkName, $targetFile, $workDir, $icon) {
    try {
        $lnkPath = Join-Path $desktopDir $lnkName
        $s = $ws.CreateShortcut($lnkPath)
        $s.TargetPath = $targetFile
        $s.WorkingDirectory = $workDir
        if ($icon) { $s.IconLocation = $icon }
        $s.Save()
    } catch {}
}

# 1. Iniciar Consola
$consolaBat = Join-Path $baseDir "2_Iniciar_Consola.bat"
Make-Shortcut "LabDesk - Iniciar Servidor (Consola).lnk" $consolaBat $baseDir "shell32.dll,13"

# 2. Iniciar Segundo Plano
$segundoPlanoBat = Join-Path $baseDir "3_Instalar_Inicio_Automatico.bat"
Make-Shortcut "LabDesk - Iniciar Segundo Plano.lnk" $segundoPlanoBat $baseDir "shell32.dll,26"

# 3. URL Web Panel Administrador
try {
    $urlAdmin = Join-Path $desktopDir "LabDesk - Panel Administrador.url"
    "[InternetShortcut]`r`nURL=http://localhost:3000" | Out-File -FilePath $urlAdmin -Encoding ASCII -Force
} catch {}

# 4. URL Web Botonera Profesor
try {
    $urlBotonera = Join-Path $desktopDir "LabDesk - Botonera Profesor.url"
    "[InternetShortcut]`r`nURL=http://localhost:3000/botonera" | Out-File -FilePath $urlBotonera -Encoding ASCII -Force
} catch {}

Write-Host "  [OK] Accesos directos creados correctamente en el Escritorio." -ForegroundColor Green

# 8. Pantalla final
Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "             ¡INSTALACION DE LABDESK SERVER COMPLETADA CON EXITO!             " -ForegroundColor White
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  DIRECCIONES DE ACCESO EN LA SALA:" -ForegroundColor Cyan
Write-Host "  -------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  * IP de este Servidor:     http://$($detectedIp):3000" -ForegroundColor Yellow
Write-Host "  * Panel Administrador:     http://localhost:3000" -ForegroundColor White
Write-Host "  * Botonera del Profesor:   http://localhost:3000/botonera" -ForegroundColor White
Write-Host "  -------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  * En los computadores de alumnos (Debian 12 con FAI), apunta a:" -ForegroundColor Cyan
Write-Host "    http://$($detectedIp):3000" -ForegroundColor Yellow
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Proximos pasos:" -ForegroundColor Yellow
Write-Host "  - Para iniciar ahora con ventana visible: ejecuta '2_Iniciar_Consola.bat'" -ForegroundColor White
Write-Host "  - Para que arranque solo con Windows (segundo plano): ejecuta '3_Instalar_Inicio_Automatico.bat'" -ForegroundColor White
Write-Host ""
Read-Host "Presiona Enter para cerrar este instalador..."
