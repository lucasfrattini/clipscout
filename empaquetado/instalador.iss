; Instalador de Windows (Inno Setup 6). El flujo de GitHub lo compila con:
;   iscc /DApp=clipscout /DNombre=clipscout /DVersion=2.19.0 /DPuerto=3001 empaquetado\instalador.iss
; Instala para el usuario actual (sin pedir administrador), con acceso en el menú Inicio, opción de
; arrancar con Windows y desinstalador. Los datos (AppData\Local\Clipgeist\<app>) no se borran.

#ifndef Dist
  #define Dist "dist"
#endif
#ifndef Puerto
  #define Puerto "3001"
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
; Antes de tocar ficheros se pide el apagado ordenado (ver [Code]); el cierre forzado de Windows
; (Restart Manager) ya no hace falta y cortaría la app a medias.
CloseApplications=no
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

[Code]
// Apagado ordenado (CS-20), al instalar encima y al desinstalar: POST /api/apagar desde el propio
// equipo con la cabecera de la app; se espera hasta 75 s a que deje de responder (guarda la cola de
// búsquedas para reanudarla). Solo después se cierra el lanzador de la bandeja con taskkill, que
// para el servidor es el último recurso si no se paró a tiempo.
procedure PararApp();
var
  Codigo: Integer;
  Orden: String;
begin
  Orden := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
    '$u=''http://127.0.0.1:{#Puerto}''; ' +
    'try { Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 5 -Uri ($u+''/api/apagar'') ' +
    '-Headers @{''X-Clipgeist''=''1''} | Out-Null } catch { exit 0 }; ' +
    'for ($i=0; $i -lt 75; $i++) { Start-Sleep -Seconds 1; ' +
    'try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($u+''/api/health'') | Out-Null } ' +
    'catch { exit 0 } }; exit 1"';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Orden, '', SW_HIDE,
    ewWaitUntilTerminated, Codigo);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /t /im {#App}.exe', '', SW_HIDE,
    ewWaitUntilTerminated, Codigo);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  PararApp();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    PararApp();
end;
