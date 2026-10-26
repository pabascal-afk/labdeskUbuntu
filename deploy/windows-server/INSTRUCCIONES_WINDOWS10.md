# Guía de Instalación del Servidor LabDesk en Windows 10

Esta guía te muestra cómo desplegar **LabDesk Server** en un computador con **Windows 10** para que funcione como el nodo central del laboratorio escolar.

---

## 📦 Contenido de este Paquete

```
LabDesk_Server/
├── 1_Instalar_Servidor.bat             <-- INSTALADOR (Doble clic)
├── 1_Instalar_Servidor.ps1             <-- Opción directa: Clic derecho -> 'Ejecutar con PowerShell'
├── 2_Iniciar_Consola.bat               <-- Inicio manual con registros en vivo
├── 3_Instalar_Inicio_Automatico.bat    <-- Configura inicio en segundo plano con Windows
├── 4_Desinstalar_Inicio_Automatico.bat <-- Quita el inicio automático
├── run_hidden.vbs                      <-- Lanzador silencioso de fondo
├── detect_ip.ps1                       <-- Detector automático de la IP de la sala
└── server/                             <-- Código del servidor, panel web y botonera
```

---

## 🚀 Paso a Paso de Instalación

### Paso 1: Descomprimir en el PC con Windows 10
1. Copia el archivo `LabDesk_Servidor_Windows10.zip` al PC destino.
2. Haz **clic derecho** sobre `LabDesk_Servidor_Windows10.zip` y selecciona **"Extraer todo..."**.
3. Extrae en una carpeta como `C:\LabDesk_Server`.

> [!IMPORTANT]
> **No ejecutes los archivos directamente desde dentro del ZIP.** Debes descomprimir la carpeta primero para que Windows pueda acceder a los módulos de Node.js.

---

### Paso 2: Ejecutar el Instalador

Tienes dos formas idénticas de ejecutarlo:

* **Método A (Recomendado):**  
  Haz doble clic en **`1_Instalar_Servidor.bat`** (o clic derecho -> *Ejecutar como administrador*).
  
* **Método B (PowerShell Directo):**  
  Haz clic derecho sobre **`1_Instalar_Servidor.ps1`** y selecciona **"Ejecutar con PowerShell"**.

El instalador realiza todo de forma automática:
- ✅ **Verificación de permisos:** Si no eres Administrador, te pedirá confirmación de Windows UAC automáticamente sin cerrarse.
- ✅ **Verificación de Node.js:** Detecta si Node.js ya está instalado; si no, lo instala.
- ✅ **Módulos offline:** Detecta las dependencias incluidas (`node_modules`) sin requerir internet.
- ✅ **Firewall de Windows:** Abre el puerto **TCP 3000** en Windows Defender para que las estaciones Debian de los alumnos puedan conectarse.
- ✅ **Detección de IP:** Detecta y muestra la IP local del equipo (ej: `http://192.168.3.16:3000`).
- ✅ **Accesos Directos:** Crea los accesos en el Escritorio.

---

### Paso 3: Iniciar el Servidor

* **Opción A: Segundo Plano (Recomendado para clases):**  
  Ejecuta **`3_Instalar_Inicio_Automatico.bat`**. El servidor arrancará invisible, no habrá ninguna ventana que se pueda cerrar por error y se iniciará solo al encender el PC.
* **Opción B: Con Consola Visible:**  
  Ejecuta **`2_Iniciar_Consola.bat`** para ver los registros y conexiones en tiempo real.

---

### 🌐 Paso 4: Fijar la IP Estática (`192.168.3.16`)

1. Presiona `Win + R`, escribe `ncpa.cpl` y pulsa Enter.
2. Clic derecho en tu tarjeta de red (Ethernet) -> **Propiedades**.
3. Selecciona **Protocolo de Internet versión 4 (TCP/IPv4)** -> **Propiedades**.
4. Asigna:
   - **IP:** `192.168.3.16`
   - **Máscara:** `255.255.255.0`
   - **Puerta de enlace / DNS:** Los de tu router escolar.

---

## 📱 Direcciones de Acceso

* **Botonera del Profesor:** `http://192.168.3.16:3000/botonera`
* **Panel Full Administrador:** `http://192.168.3.16:3000`
