Option Explicit
Dim shell, files, folder, powershell, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
shell.CurrentDirectory = folder
command = Chr(34) & folder & "\PhoneNotify.exe" & Chr(34) & " --off"
WScript.Quit shell.Run(command, 0, True)
