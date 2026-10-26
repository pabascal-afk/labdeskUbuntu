# LabDesk 🚀 (Fork de LabManager para Linux)

**LabDesk** es una plataforma educativa integral para laboratorios y salas de computación escolares, concebida para **prescindir al 100% de Windows** y sus componentes propietarios (`.exe`, `.bat`, C#, registro de Windows).

El sistema se compone de:
1. **LabDesk Server**: Servidor central y panel web de control para el docente.
2. **Botonera SemiAdmin del Profesor**: Consola táctil tipo Stream Deck para control autónomo y ágil del aula.
3. **LabDesk Student Desktop**: Entorno de escritorio personalizado y seguro para los estudiantes (basado en Electron/Chromium sobre Linux), con control de audio, navegador multipestaña con soporte oficial para Google Workspace, y mini apps ofimáticas integradas.
4. **Deploy Scripts**: Instalador desatendido en un solo paso para estaciones con **Debian 12** o **Ubuntu**.

---

## 🌟 Características Principales

### 🎛️ Botonera SemiAdmin del Profesor (Stream Deck Console)
- **Diseño Táctil de Botones Grandes**: Inspirada en consolas de producción y Stream Deck para un control instantáneo sin menús complejos.
- **Selector Autónomo de Sala**: El profesor elige su aula ("Laboratorio 1", "Sala A", etc.) y la botonera recuerda su preferencia automáticamente.
- **HUD con Indicadores LED en Vivo**: Muestra en tiempo real cuántos alumnos están conectados, si las pantallas están libres o bloqueadas, el estado del audio y cuántas tareas han entregado los alumnos.
- **Acciones Directas de 1-Toque**:
  - 🔒 **Bloquear / 🔓 Desbloquear Sala**: Fija la atención en la pizarra al instante.
  - 🔇 **Silenciar / 🔊 Activar Audio**: Disciplina sonora instantánea para toda la sala.
  - 📄 **Google Workspace en 1 Clic**: Lanza Google Docs, Classroom, Sheets o Slides a todos los alumnos simultáneamente.
  - 🌐 **Lanzador Web & Modo Examen**: Envía URLs educativas frecuentes (Wikipedia, Scratch, Geogebra) o activa el modo examen cautivo.
  - 📢 **Aviso en Pantalla**: Mensajes emergentes a las estaciones ("Quedan 5 minutos", "Silencio por favor").
  - 👁️ **Mosaico en Vivo**: Supervisión rápida de todas las pantallas en miniatura sin salir de la botonera.
  - 🛡️ **Pausa de Botonera con PIN**: Bloquea la consola para evitar que los alumnos presionen botones si el profesor se levanta de su mesa.
  - ⚡ **Energía**: Encendido por Wake-on-LAN, Reinicio y Apagado ordenado de toda la sala.

### 🖥️ Escritorio Educativo Personalizado (LabDesk Shell)
- **Entorno Kiosk Protegido**: Pantalla completa sin bordes, sin distracciones de configuraciones del sistema operativo y con bloqueo de atajos de escape (`Alt+Tab`, `Alt+F4`, cambio de consola virtual).
- **Barra de Tareas y Menú Inicio**: Accesos rápidos a ofimática, navegador, Google Workspace y bandeja de sistema con reloj e indicador de conexión con el profesor.
- **Gestor de Ventanas Flotantes**: Multiventana suave con minimizar, maximizar, enfocar y restaurar.

### 🌐 Navegador Educativo y Google Workspace
- **Compatibilidad 100% con Google**: Configurado con User-Agent oficial de Chrome Linux y almacenamiento persistente de sesión para permitir el uso sin bloqueos de:
  - ✉️ **Gmail**
  - 📄 **Google Docs**
  - 📊 **Google Sheets**
  - 📽️ **Google Slides**
  - 📁 **Google Drive**
  - 🎓 **Google Classroom**
- **Control Remoto de Pestañas**: El docente puede abrir una URL o Google Doc en todos los alumnos con un solo clic.
- **Modo Examen (Página Cautiva)**: Bloquea el navegador a una URL fija e impide navegar a otros sitios.
- **Cierre de Sesión Seguro**: Botón en el menú de inicio para limpiar cookies y datos de Google al terminar la clase.

### ✍️ Mini Suite Ofimática Ligera (Offline-first)
- **Mini Writer**: Procesador de textos enriquecido con formato, exportación a PDF y guardado local en `~/Documentos/LabDesk/`.
- **Mini Calc**: Hoja de cálculo reactiva con soporte para fórmulas matemáticas (`=SUM`, `=AVERAGE`, `=COUNT`, `=MIN`, `=MAX` y operaciones aritméticas) y exportación CSV.
- **Mini Slides**: Creador de diapositivas con miniaturas y modo "Presentar" a pantalla completa.
- **Buzón de Tareas (1-Clic)**: Todas las mini apps incluyen el botón **"Entregar al Profesor"**, que envía el trabajo directamente al panel docente sin requerir correos ni memorias USB.

### 🔊 Gestión de Audio
- **Integración con PipeWire / PulseAudio / ALSA**: Control de volumen desde la barra de tareas del alumno.
- **Control Remoto Centralizado**: Botón maestro **"Silenciar Sala"** en el panel docente para obtener atención inmediata, además de control de volumen individual.

### 🛡️ Paridad Completa con LabManager
- **Bloqueo / Desbloqueo**: Bloqueo de pantalla con overlay institucional y soporte de PIN numérico en pantalla.
- **Monitoreo en Tiempo Real**: Miniaturas automáticas cada 2 segundos y streaming en vivo para observación activa.
- **Control Remoto (RDP/VNC)**: Control interactivo de ratón y teclado desde el navegador del profesor.
- **Control de Energía**: Encendido por Wake-on-LAN, Reinicio y Apagado remoto.
- **Biblioteca de Scripts Bash**: Ejecución remota de comandos y scripts `.sh` en las estaciones Linux.

---

## 🚀 Guía de Inicio Rápido

### 1. Iniciar el Servidor (PC del Profesor)
El servidor es compatible con Linux, macOS o Windows (Node.js 18+):
```bash
cd labdesk/server
npm install
npm start
```
El panel web estará disponible en: `http://localhost:3000` (o la IP de red del servidor).

### 2. Ejecutar el Escritorio del Estudiante en Modo Desarrollo
En cualquier equipo con Linux:
```bash
cd labdesk/student-desktop
npm install
npm start
```
*Para conectar a un servidor específico, define la variable de entorno:*
```bash
LABDESK_SERVER_URL="http://192.168.1.50:3000" npm start
```

### 3. Instalación Automatizada en Estaciones de Estudiantes (Debian / Ubuntu)
En el PC del estudiante recién instalado con Debian 12 o Ubuntu Desktop:
```bash
cd labdesk/deploy
sudo bash install-station.sh http://192.168.1.50:3000
```
El script configurará:
- Auto-login para el usuario `estudiante`.
- Inicio automático de LabDesk en modo quiosco.
- Bloqueo de terminales virtuales y atajos de salida.
- Reiniciar el equipo (`sudo reboot`) y la estación arrancará directamente en LabDesk.

---

## 📁 Estructura del Proyecto

```
labdesk/
├── server/                    # Servidor Express + Socket.IO + SQLite
│   ├── src/index.js           # API y sockets (monitoreo, audio, pestañas, entregas)
│   ├── src/db.js              # Base de datos y scripts Bash iniciales
│   └── public/                # Dashboard del Docente (HTML5, CSS3, JS)
│
├── student-desktop/           # Shell de Escritorio para Estudiantes (Electron)
│   ├── src/main/              # Proceso principal (audio, screen, rdp, browser, agent)
│   ├── src/preload/           # ContextBridge seguro
│   └── src/renderer/          # UI del escritorio y Window Manager
│       └── apps/              # Mini Apps: writer, calc, slides, browser, files
│
└── deploy/                    # Herramientas de despliegue para Debian/Ubuntu
    ├── install-station.sh     # Instalador en 1 paso
    └── labdesk.service        # Unidad de servicio systemd
```
