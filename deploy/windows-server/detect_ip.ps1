# PowerShell script para detectar la IP LAN real en Windows 10
try {
    $activeRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($activeRoute) {
        $ip = (Get-NetIPAddress -InterfaceIndex $activeRoute.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
        if ($ip) {
            Write-Output $ip
            exit 0
        }
    }

    # Fallback si no hay ruta por defecto (red aislada / switch)
    $fallbackIP = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { 
            $_.IPAddress -notlike "127.*" -and 
            $_.IPAddress -notlike "169.254.*" -and 
            $_.InterfaceAlias -notmatch "(VirtualBox|VMware|vEthernet|Loopback|WSL)" 
        } | Select-Object -ExpandProperty IPAddress -First 1

    if ($fallbackIP) {
        Write-Output $fallbackIP
        exit 0
    }
} catch {}

Write-Output "127.0.0.1"
