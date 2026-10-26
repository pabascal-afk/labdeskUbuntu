# Despliegue Masivo Desatendido con FAI-Project en Debian 12 "Bookworm"

**FAI (Fully Automatic Installation)** es la herramienta estándar en Debian para la instalación y clonación masiva no supervisada (*zero-touch*). Permite instalar decenas o cientos de computadores de la sala de clases sin tocar el teclado.

---

## 🚀 Cómo Funciona con LabDesk

Con FAI puedes desplegar las estaciones de estudiantes de dos formas:

1. **Método 1: Pendrive USB Autoinstalable (`fai-cd`)**: Conectas el pendrive en el PC del alumno, lo enciendes, FAI formatea el disco, instala Debian 12, configura el usuario `estudiante`, el auto-login, el audio y LabDesk en 3 minutos. Al terminar, expulsa el pendrive y reinicia solo.
2. **Método 2: Arranque por Red (PXE / Netboot)**: Todos los computadores de la sala se encienden simultáneamente (por red o Wake-on-LAN) y se instalan en paralelo a través del cable de red local (LAN).

---

## 🛠️ Paso 1: Instalar y Configurar el Servidor FAI (en Debian 12)

En el computador que actuará como máquina constructora (puede ser el PC del profesor o un servidor Debian 12):

```bash
# 1. Instalar paquetes de FAI
sudo apt update
sudo apt install -y fai-server fai-doc fai-client nfs-kernel-server tftpd-hpa
```

### Configurar el entorno base (NFSROOT para Bookworm)
Edita `/etc/fai/nfsroot.conf` y asegúrate de que apunte al repositorio oficial de Debian 12:

```ini
# /etc/fai/nfsroot.conf
FAI_DEBOOTSTRAP="bookworm http://deb.debian.org/debian"
FAI_ROOTPW='$6$rounds=656000$labdesk$QZ0v1J2K3L4M5N6O7P8Q9R0S1T2U3V4W5X6Y7Z8'
```

Crea el sistema base de instalación (*NFSROOT*):
```bash
sudo fai-make-nfsroot -v
```

---

## 📂 Paso 2: Integrar la Clase `LABDESK` en FAI

Copia los archivos de esta carpeta (`labdesk/deploy/fai/`) dentro del espacio de configuración de FAI (`/srv/fai/config`):

```bash
# 1. Copiar las recetas de LabDesk al árbol de FAI
sudo cp -r class/LABDESK.var /srv/fai/config/class/
sudo cp -r disk_config/LABDESK /srv/fai/config/disk_config/
sudo cp -r package_config/LABDESK /srv/fai/config/package_config/
sudo cp -r scripts/LABDESK /srv/fai/config/scripts/

# 2. Copiar los archivos de la app student-desktop para que se instalen offline
sudo mkdir -p /srv/fai/config/files/student-desktop
sudo cp -r ../../student-desktop/* /srv/fai/config/files/student-desktop/
```

### Asignar la clase en `50-host-classes`:
Edita `/srv/fai/config/class/50-host-classes` y agrega `LABDESK` a los perfiles por defecto:
```bash
# Asignar a cualquier máquina que arranque con FAI:
echo "DEFAULT LINUX DEBIAN BOOKWORM64 LABDESK GRUB_PC" | sudo tee -a /srv/fai/config/class/50-host-classes
```

---

## 📀 Paso 3: Generar el USB / ISO Autoinstalable (Método Recomendado)

Para crear una imagen ISO que puedas quemar en un pendrive USB para instalar PCs sin necesidad de configurar PXE:

```bash
# Generar la ISO autoinstalable con soporte de mirror local
sudo fai-cd -M labdesk-debian12-autoinstall.iso
```

### Grabar en Pendrive USB:
Reemplaza `/dev/sdX` por tu unidad USB:
```bash
sudo dd if=labdesk-debian12-autoinstall.iso of=/dev/sdX bs=4M status=progress oflag=sync
```
*(O simplemente copia la ISO en un pendrive con **Ventoy**).*

---

## 🌐 Paso 4: Despliegue por Red PXE (Alternativa para instalar 30 PCs a la vez)

Si tu sala tiene red cableada y quieres encender todos los equipos para que se instalen solos:

1. Configura el servicio DHCP en el servidor para apuntar a la IP del servidor FAI como `next-server`.
2. Habilita el arranque de red en FAI:
   ```bash
   sudo fai-chboot -Iv -s 4.0 -c LABDESK default
   ```
3. Enciende los computadores de la sala y pulsa `F12` (Network Boot / PXE).
4. El sistema cargará el instalador FAI, particionará el disco e instalará Debian 12 + LabDesk en paralelo.

---

## ⚙️ Personalización de la IP del Servidor

Para cambiar la IP del profesor a la que se conectarán automáticamente todos los equipos instalados:

Edita `/srv/fai/config/class/LABDESK.var`:
```bash
LABDESK_SERVER_URL="http://192.168.3.16:3000"
```
Todas las estaciones instaladas se conectarán a esa IP de manera desatendida desde el primer arranque.
