#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef RepoRoot
  #error RepoRoot is required
#endif
[Setup]
AppId=ai.kortexa.sideleaf.stable
AppName=Sideleaf
AppVersion={#AppVersion}
AppPublisher=Kortexa AI
AppPublisherURL=https://sideleaf.xyz/
DefaultDirName={localappdata}\ai.kortexa.sideleaf\stable\app
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.22000
OutputDir={#RepoRoot}\artifacts\release
OutputBaseFilename=Sideleaf-{#AppVersion}-windows-x64-setup
SetupIconFile={#RepoRoot}\assets\icon.ico
UninstallDisplayIcon={app}\bin\launcher.exe
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
ChangesEnvironment=yes
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: cli; Description: "Install the sideleaf command-line tool"; GroupDescription: "Command line:"
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Sideleaf"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; AppUserModelID: "ai.kortexa.sideleaf"
Name: "{userdesktop}\Sideleaf"; Filename: "{app}\bin\launcher.exe"; WorkingDir: "{app}\bin"; AppUserModelID: "ai.kortexa.sideleaf"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Sideleaf"; ValueData: "Software\Kortexa AI\Sideleaf\Capabilities"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Kortexa AI\Sideleaf\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Sideleaf"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Kortexa AI\Sideleaf\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "A Markdown editor for your words and your files."
Root: HKCU; Subkey: "Software\Kortexa AI\Sideleaf\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "Sideleaf.Markdown"
Root: HKCU; Subkey: "Software\Kortexa AI\Sideleaf\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "Sideleaf.Markdown"
Root: HKCU; Subkey: "Software\Kortexa AI\Sideleaf\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mdown"; ValueData: "Sideleaf.Markdown"
Root: HKCU; Subkey: "Software\Classes\Sideleaf.Markdown"; ValueType: string; ValueData: "Markdown document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Sideleaf.Markdown"; ValueType: string; ValueName: "FriendlyTypeName"; ValueData: "Markdown document"
Root: HKCU; Subkey: "Software\Classes\Sideleaf.Markdown\DefaultIcon"; ValueType: string; ValueData: "{app}\bin\launcher.exe,0"
Root: HKCU; Subkey: "Software\Classes\Sideleaf.Markdown\shell\open\command"; ValueType: string; ValueData: """{app}\bin\launcher.exe"" --sideleaf-open ""%1"""
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "Sideleaf.Markdown"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "Sideleaf.Markdown"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: string; ValueName: "Sideleaf.Markdown"; ValueData: ""; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\Resources\app\cli\install-cli.ps1"" -AppBin ""{app}\bin"""; Flags: runhidden waituntilterminated; Tasks: cli; StatusMsg: "Installing the sideleaf command…"
Filename: "{app}\bin\launcher.exe"; Description: "Open Sideleaf"; WorkingDir: "{app}\bin"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\Resources\app\cli\install-cli.ps1"" -AppBin ""{app}\bin"" -Uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveSideleafCommandPath"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var OldLocation: String;
begin
  if CurStep = ssPostInstall then begin
    // Retire only the old Electrobun registration for this exact installation.
    // Preferences live outside {app} and are never removed by this installer.
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.kortexa.sideleaf.stable', 'InstallLocation', OldLocation) then
      if CompareText(RemoveBackslashUnlessRoot(OldLocation), ExpandConstant('{app}')) = 0 then
        RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\ai.kortexa.sideleaf.stable');
  end;
end;
