' Lanzador silencioso en segundo plano para LabDesk Server
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
strServerDir = strScriptDir & "\server"

If Not fso.FolderExists(strServerDir) Then
    strServerDir = strScriptDir
End If

strLogFile = strScriptDir & "\server.log"
strCommand = "cmd /c ""cd /d """ & strServerDir & """ && node src/index.js >> """ & strLogFile & """ 2>&1"""

' 0 = Oculto, False = No esperar a que termine
WshShell.Run strCommand, 0, False
