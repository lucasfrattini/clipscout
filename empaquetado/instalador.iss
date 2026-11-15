; Instalador de Windows (Inno Setup 6). El flujo de GitHub lo compila con:
;   iscc /DApp=clipscout /DNombre=clipscout /DVersion=2.14.0 /DPuerto=3001 empaquetado\instalador.iss
; Instala para el usuario actual (sin pedir administrador), con acceso en el menú Inicio, opción de
; arrancar con Windows y desinstalador. Los datos (AppData\Local\Clipgeist\<app>) no se borran.

#ifndef Dist
  #define Dist "dist"
#endif

[Setup]
AppId={{Clipgeist-{#App}}
AppName={#Nombre}
AppVersion={#Version}
AppPublisher=Clipgeist
AppPublisherURL=https://clipgeist.com/
DefaultDirName={localappdata}\Programs\Clipgeist\{#Nombre}
DefaultGroupName=Clipgeist
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\salida
OutputBaseFilename={#App}-windows
SetupIconFile=icono.ico
UninstallDisplayIcon={app}\{#App}.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
LicenseFile=..\LICENSE

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
es.Inicio=Arrancar {#Nombre} al iniciar Windows
en.Inicio=Start {#Nombre} when Windows starts
es.Escritorio=Crear un acceso directo en el escritorio
en.Escritorio=Create a desktop shortcut
es.Abrir=Abrir {#Nombre}
en.Abrir=Open {#Nombre}

[Tasks]
Name: "inicio"; Description: "{cm:Inicio}"
Name: "escritorio"; Description: "{cm:Escritorio}"; Flags: unchecked

[Files]
Source: "{#Dist}\{#App}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#Nombre}"; Filename: "{app}\{#App}.exe"
Name: "{userdesktop}\{#Nombre}"; Filename: "{app}\{#App}.exe"; Tasks: escritorio
Name: "{userstartup}\{#Nombre}"; Filename: "{app}\{#App}.exe"; Parameters: "--no-abrir"; Tasks: inicio

[Run]
Filename: "{app}\{#App}.exe"; Description: "{cm:Abrir}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /t /im {#App}.exe"; Flags: runhidden; RunOnceId: "parar"
