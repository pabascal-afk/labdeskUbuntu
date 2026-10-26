import os
import sys
import struct
import gzip
import shutil
import subprocess
import stat

print("==============================================================================")
print("     LabDesk - Constructor de Imagen ISO Autoinstalable (Debian 12)          ")
print("==============================================================================")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_ISO = os.path.join(SCRIPT_DIR, "LabDesk_Debian12_AutoInstall.iso")
TEMP_DIR = os.path.join(os.environ.get("TEMP", "C:\\Temp"), "labdesk_iso_build")
XORRISO_EXE = os.path.join(os.environ.get("TEMP", "C:\\Temp"), "xorriso_win", "xorriso.exe")
BASE_ISO = os.path.join(os.environ.get("TEMP", "C:\\Temp"), "mini.iso")

SERVER_IP = "192.168.3.16:3000"

os.makedirs(TEMP_DIR, exist_ok=True)

# 1. Verificar herramientas
if not os.path.exists(XORRISO_EXE):
    print("[ERROR] No se encontro xorriso.exe")
    sys.exit(1)

if not os.path.exists(BASE_ISO):
    print("[ERROR] No se encontro mini.iso")
    sys.exit(1)

print("[1/5] Generando archivo preseed.cfg desatendido...")

preseed_content = f"""# ==============================================================================
# LabDesk - Preseed de Instalacion 100% Desatendida (Debian 12 Bookworm)
# Servidor Central: http://{SERVER_IP}
# ==============================================================================

# Localizacion e Idioma
d-i debian-installer/locale string es_ES.UTF-8
d-i console-setup/ask_detect boolean false
d-i keyboard-configuration/xkb-keymap select latam
d-i keyboard-configuration/layoutcode string latam

# Red (DHCP automatico)
d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string estacion-lab
d-i netcfg/get_domain string local
d-i netcfg/wireless_wep string

# Repositorio oficial
d-i mirror/country string manual
d-i mirror/http/hostname string deb.debian.org
d-i mirror/http/directory string /debian
d-i mirror/http/proxy string

# Reloj y Zona Horaria
d-i clock-setup/utc boolean true
d-i time/zone string America/Santiago
d-i clock-setup/ntp boolean true

# Deteccion de disco principal interno (omite el pendrive USB)
d-i partman/early_command string \\
  BOOT_DEV=$(mount | grep -iE 'on /(cdrom|media)' | cut -d' ' -f1 | sed -e 's/[0-9]//g'); \\
  TARGET_DISK=$(list-devices disk | grep -v "$BOOT_DEV" | head -n1); \\
  if [ -n "$TARGET_DISK" ]; then debconf-set partman-auto/disk "$TARGET_DISK"; fi

# Particionamiento Automatico (Formatea disco interno sin confirmacion)
d-i partman-auto/method string regular
d-i partman-auto/choose_recipe select atomic
d-i partman-auto/purge_lvm_from_device boolean true
d-i partman-lvm/device_remove_lvm boolean true
d-i partman-md/device_remove_md boolean true
d-i partman-lvm/confirm boolean true
d-i partman-lvm/confirm_nooverwrite boolean true
d-i partman-partitioning/confirm_write_new_label boolean true
d-i partman/choose_partition select finish
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true

# Cuentas de Usuario (Sin clave root, usuario 'estudiante' con sudo)
d-i passwd/root-login boolean false
d-i passwd/make-user boolean true
d-i passwd/user-fullname string Estudiante
d-i passwd/username string estudiante
d-i passwd/user-password password estudiante
d-i passwd/user-password-again password estudiante
d-i passwd/user-default-groups string sudo audio video netdev plugdev input

# Apt y Firmware
d-i apt-setup/non-free-firmware boolean true
d-i apt-setup/non-free boolean true
d-i apt-setup/contrib boolean true
d-i apt-setup/services-select multiselect security, updates
d-i apt-setup/security_host string security.debian.org

# Paquetes a Instalar (Entorno Kiosk Ligero Openbox + Audio PipeWire)
tasksel tasksel/first multiselect standard
d-i pkgsel/include string xorg openbox lightdm pipewire pipewire-pulse wireplumber alsa-utils network-manager curl git nodejs npm sudo wget python3 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0 libasound2 libxss1 chromium
d-i pkgsel/upgrade select none
popularity-contest popularity-contest/participate boolean false

# Cargador de Arranque (GRUB en MBR/ESP)
d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean true
d-i grub-installer/bootdev string default

# Finalizacion y Reinicio Automatico
d-i finish-install/reboot_in_progress note
d-i debian-installer/exit/reboot boolean true

# Script de Post-Instalacion (late_command)
d-i preseed/late_command string \\
  in-target sed -i 's/^#autologin-user=.*/autologin-user=estudiante/' /etc/lightdm/lightdm.conf; \\
  in-target sed -i 's/^#autologin-user-timeout=.*/autologin-user-timeout=0/' /etc/lightdm/lightdm.conf; \\
  in-target sh -c 'echo "estudiante ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/estudiante'; \\
  in-target chmod 0440 /etc/sudoers.d/estudiante; \\
  in-target mkdir -p /opt/labdesk/student-desktop; \\
  if [ -d /cdrom/labdesk/student-desktop ]; then \\
    cp -r /cdrom/labdesk/student-desktop/* /target/opt/labdesk/student-desktop/; \\
  else \\
    in-target sh -c 'curl -sSL http://{SERVER_IP}/student-desktop.tar.gz -o /tmp/sd.tar.gz && tar -xzf /tmp/sd.tar.gz -C /opt/labdesk/student-desktop/ && rm -f /tmp/sd.tar.gz' || true; \\
  fi; \\
  in-target mkdir -p /home/estudiante/.config/labdesk; \\
  in-target sh -c 'echo "{{\\"serverUrl\\":\\"http://{SERVER_IP}\\"}}" > /home/estudiante/.config/labdesk/config.json'; \\
  in-target sh -c 'echo "LABDESK_SERVER_URL=\\"http://{SERVER_IP}\\"" >> /etc/environment'; \\
  in-target mkdir -p /home/estudiante/.config/openbox; \\
  in-target sh -c 'echo "#!/bin/bash" > /home/estudiante/.config/openbox/autostart'; \\
  in-target sh -c 'echo "pipewire & wireplumber &" >> /home/estudiante/.config/openbox/autostart'; \\
  in-target sh -c 'echo "xset -dpms & xset s off & xset s noblank &" >> /home/estudiante/.config/openbox/autostart'; \\
  in-target sh -c 'echo "cd /opt/labdesk/student-desktop" >> /home/estudiante/.config/openbox/autostart'; \\
  in-target sh -c 'echo "if command -v electron >/dev/null 2>&1; then electron . & else npx --yes electron . & fi" >> /home/estudiante/.config/openbox/autostart'; \\
  in-target chmod +x /home/estudiante/.config/openbox/autostart; \\
  in-target chown -R estudiante:estudiante /home/estudiante /opt/labdesk;
"""

preseed_path = os.path.join(TEMP_DIR, "preseed.cfg")
with open(preseed_path, "w", encoding="utf-8", newline="\n") as f:
    f.write(preseed_content)

# Copiar preseed al servidor web publico tambien
server_public = os.path.join(SCRIPT_DIR, "server", "public")
if os.path.exists(server_public):
    shutil.copy(preseed_path, os.path.join(server_public, "preseed.cfg"))
    print("  [OK] Copiado preseed.cfg a server/public/preseed.cfg (disponible por HTTP)")

print("[2/5] Extrayendo initrd.gz original de mini.iso...")

ps_mount = f"""
$mount = Mount-DiskImage -ImagePath '{BASE_ISO}' -PassThru
$vol = $mount | Get-Volume
$drive = $vol.DriveLetter + ':'
Copy-Item (Join-Path $drive 'initrd.gz') '{TEMP_DIR}\\initrd.gz' -Force
Copy-Item (Join-Path $drive 'boot\\grub\\grub.cfg') '{TEMP_DIR}\\grub.cfg' -Force
Copy-Item (Join-Path $drive 'txt.cfg') '{TEMP_DIR}\\txt.cfg' -Force
Dismount-DiskImage -ImagePath '{BASE_ISO}' | Out-Null
"""
subprocess.run(["powershell", "-NoProfile", "-Command", ps_mount], check=True)

for fname in ["initrd.gz", "grub.cfg", "txt.cfg"]:
    fpath = os.path.join(TEMP_DIR, fname)
    if os.path.exists(fpath):
        os.chmod(fpath, stat.S_IWRITE)

print("[3/5] Inyectando preseed.cfg en initrd.gz (cargado directo en RAM)...")

def make_cpio_entry(filename, data):
    name_bytes = filename.encode('utf-8') + b'\x00'
    filesize = len(data)
    header = f'070701{1:08x}{0o100644:08x}{0:08x}{0:08x}{1:08x}{0:08x}{filesize:08x}{0:08x}{0:08x}{0:08x}{0:08x}{len(name_bytes):08x}{0:08x}'.encode('ascii')
    pad1 = (4 - (len(header) + len(name_bytes)) % 4) % 4
    pad2 = (4 - filesize % 4) % 4
    return header + name_bytes + (b'\x00' * pad1) + data + (b'\x00' * pad2)

def make_cpio_trailer():
    name_bytes = b'TRAILER!!!\x00'
    header = f'070701{0:08x}{0:08x}{0:08x}{0:08x}{1:08x}{0:08x}{0:08x}{0:08x}{0:08x}{0:08x}{0:08x}{len(name_bytes):08x}{0:08x}'.encode('ascii')
    pad = (4 - (len(header) + len(name_bytes)) % 4) % 4
    return header + name_bytes + (b'\x00' * pad)

with open(preseed_path, "rb") as f:
    raw_preseed = f.read()

cpio_payload = make_cpio_entry("preseed.cfg", raw_preseed) + make_cpio_trailer()
gz_cpio = gzip.compress(cpio_payload)

initrd_path = os.path.join(TEMP_DIR, "initrd.gz")
with open(initrd_path, "ab") as f:
    f.write(gz_cpio)

print("[4/5] Configurando menues de arranque automatico (BIOS y UEFI)...")

# txt.cfg (BIOS) -> Usar file=/preseed.cfg (en RAM) para que funcione en USB sin montar /cdrom
txt_content = f"""default auto
prompt 0
timeout 1

label auto
	menu label ^LabDesk AutoInstall (Zero-Touch RAM)
	kernel linux
	append auto=true priority=critical file=/preseed.cfg vga=788 initrd=initrd.gz --- quiet

label lan
	menu label ^LabDesk AutoInstall (Red LAN HTTP)
	kernel linux
	append auto=true priority=critical url=http://{SERVER_IP}/preseed.cfg vga=788 initrd=initrd.gz --- quiet
"""
with open(os.path.join(TEMP_DIR, "txt.cfg"), "w", encoding="utf-8", newline="\n") as f:
    f.write(txt_content)

prompt_content = """prompt 0
timeout 1
"""
with open(os.path.join(TEMP_DIR, "prompt.cfg"), "w", encoding="utf-8", newline="\n") as f:
    f.write(prompt_content)

# grub.cfg (UEFI) -> Usar file=/preseed.cfg (en RAM)
grub_content = f"""set default=0
set timeout=1

menuentry 'LabDesk AutoInstall (Zero-Touch RAM)' {{
    set background_color=black
    linux    /linux auto=true priority=critical file=/preseed.cfg vga=788 --- quiet
    initrd   /initrd.gz
}}

menuentry 'LabDesk AutoInstall (Red LAN HTTP)' {{
    set background_color=black
    linux    /linux auto=true priority=critical url=http://{SERVER_IP}/preseed.cfg vga=788 --- quiet
    initrd   /initrd.gz
}}
"""
with open(os.path.join(TEMP_DIR, "grub.cfg"), "w", encoding="utf-8", newline="\n") as f:
    f.write(grub_content)

# Copiar archivos de student-desktop al staging
staging_desktop = os.path.join(TEMP_DIR, "student-desktop")
if os.path.exists(staging_desktop):
    shutil.rmtree(staging_desktop)
src_desktop = os.path.join(SCRIPT_DIR, "student-desktop")
shutil.copytree(src_desktop, staging_desktop)

print("[5/5] Compilando imagen ISO hibrida con xorriso...")

if os.path.exists(OUT_ISO):
    os.remove(OUT_ISO)

os.chdir(TEMP_DIR)

xorriso_args = [
    XORRISO_EXE,
    "-indev", BASE_ISO,
    "-outdev", OUT_ISO,
    "-map", "preseed.cfg", "/preseed.cfg",
    "-map", "initrd.gz", "/initrd.gz",
    "-map", "txt.cfg", "/txt.cfg",
    "-map", "prompt.cfg", "/prompt.cfg",
    "-map", "grub.cfg", "/boot/grub/grub.cfg",
    "-map", "student-desktop", "/labdesk/student-desktop",
    "-boot_image", "any", "replay"
]

res = subprocess.run(xorriso_args, capture_output=True, text=True)
if res.returncode != 0:
    print("[ERROR] Fallo xorriso:")
    print(res.stderr)
    sys.exit(1)

iso_size_mb = os.path.getsize(OUT_ISO) / (1024 * 1024)
print("")
print("==============================================================================")
print("             ¡IMAGEN ISO CREADA EXITOSAMENTE!")
print("==============================================================================")
print(f"  Archivo generado:  {OUT_ISO}")
print(f"  Tamaño:            {iso_size_mb:.2f} MB")
print(f"  Servidor destino:  http://{SERVER_IP}")
print(f"  Ruta Preseed RAM:  file=/preseed.cfg")
print(f"  Ruta Preseed LAN:  http://{SERVER_IP}/preseed.cfg")
print("==============================================================================")
print("")
