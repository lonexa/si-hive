; SI Hive (Superintelligence Hive) installer
; Build: "C:\Program Files (x86)\NSIS\makensis.exe" installer\hive.nsi

Unicode True
!include "MUI2.nsh"

!define PRODUCT_NAME "SI Hive"
!define PRODUCT_VERSION "0.2.0"
!define PRODUCT_PUBLISHER "Lonexa"
!define PRODUCT_PORT "4747"
!define SERVICE_NAME "Hive"

Name "${PRODUCT_NAME}"
OutFile "SIHiveSetup.exe"
InstallDir "$PROGRAMFILES\${PRODUCT_NAME}"
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open SI Hive in browser"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchBrowser
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function LaunchBrowser
  ExecShell "open" "http://localhost:${PRODUCT_PORT}"
FunctionEnd

Section "Install"
  ; NSSM service manager
  SetOutPath "$INSTDIR"
  File "nssm.exe"

  ; Portable Node.js
  DetailPrint "Installing Node.js runtime..."
  SetOutPath "$INSTDIR\node"
  File /r "portable\node\*.*"

  ; App source — Hive app + shared packages
  DetailPrint "Extracting application source..."
  SetOutPath "$INSTDIR\app\apps"
  File /r "source\apps\hive"
  SetOutPath "$INSTDIR\app"
  File /r "source\packages"
  File /r "source\scripts"
  File "source\package.json"
  File "source\package-lock.json"
  File "source\tsconfig.json"
  File "source\.hive-version"

  ; Pre-bundled node_modules (tar for fast extraction)
  DetailPrint "Extracting pre-bundled dependencies..."
  File "source\node_modules.tar"
  nsExec::ExecToLog 'tar -xf "$INSTDIR\app\node_modules.tar" -C "$INSTDIR\app"'
  Delete "$INSTDIR\app\node_modules.tar"

  ; Build
  SetOutPath "$INSTDIR"
  DetailPrint "Building SI Hive (this may take a minute)..."
  FileOpen $1 "$INSTDIR\install-build.cmd" w
  FileWrite $1 '@echo off$\r$\n'
  FileWrite $1 'cd /d "$INSTDIR\app\apps\hive"$\r$\n'
  FileWrite $1 '"$INSTDIR\node\node.exe" "$INSTDIR\app\node_modules\vite\bin\vite.js" build 2>&1$\r$\n'
  FileWrite $1 'exit /b %errorlevel%$\r$\n'
  FileClose $1
  nsExec::ExecToLog '"$INSTDIR\install-build.cmd"'
  Pop $0
  Delete "$INSTDIR\install-build.cmd"
  DetailPrint "Build exit code: $0"
  IntCmp $0 0 +2
    Abort "Build failed (exit code $0). Please report this error."

  ; Download Playwright's Chromium for the Claude Design "Capture preview" feature.
  ; Pin browsers to $INSTDIR\app\.playwright-browsers so install + service runtime always agree
  ; regardless of which user runs each (NSSM service may differ from installer user).
  ; Best-effort — failure leaves only the screenshot route degraded, install proceeds.
  IfFileExists "$INSTDIR\app\node_modules\playwright\cli.js" 0 SkipPlaywright
    DetailPrint "Installing Chromium for screenshots (one-time, ~150 MB)..."
    FileOpen $1 "$INSTDIR\install-playwright.cmd" w
    FileWrite $1 '@echo off$\r$\n'
    FileWrite $1 'set "PLAYWRIGHT_BROWSERS_PATH=$INSTDIR\app\.playwright-browsers"$\r$\n'
    FileWrite $1 '"$INSTDIR\node\node.exe" "$INSTDIR\app\node_modules\playwright\cli.js" install chromium 2>&1$\r$\n'
    FileWrite $1 'exit /b %errorlevel%$\r$\n'
    FileClose $1
    nsExec::ExecToLog '"$INSTDIR\install-playwright.cmd"'
    Pop $0
    Delete "$INSTDIR\install-playwright.cmd"
    DetailPrint "Chromium install exit code: $0"
  SkipPlaywright:

  ; Remove existing service if reinstalling
  DetailPrint "Removing any existing ${SERVICE_NAME} service..."
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" stop ${SERVICE_NAME}'
  Sleep 2000
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" remove ${SERVICE_NAME} confirm'
  Sleep 1000
  nsExec::ExecToLog 'sc stop ${SERVICE_NAME}'
  nsExec::ExecToLog 'sc delete ${SERVICE_NAME}'
  Sleep 2000
  nsExec::ExecToLog 'reg delete "HKLM\SYSTEM\CurrentControlSet\Services\${SERVICE_NAME}" /f'
  Sleep 1000

  ; Write user home path for service context (NSSM runs as SYSTEM)
  FileOpen $0 "$INSTDIR\user-home.txt" w
  FileWrite $0 "$PROFILE"
  FileClose $0

  ; Register service via NSSM
  DetailPrint "Registering Windows Service..."
  SetOutPath "$INSTDIR"
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" install ${SERVICE_NAME} "$INSTDIR\node\node.exe"'
  nsExec::ExecToLog 'sc config ${SERVICE_NAME} binPath= "\"$INSTDIR\nssm.exe\""'
  nsExec::ExecToLog 'sc config ${SERVICE_NAME} start= auto'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} Application "$INSTDIR\node\node.exe"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppParameters "\"$INSTDIR\app\scripts\startup.cjs\" --app=hive"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} DisplayName "${PRODUCT_NAME}"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} Description "SI Hive (Superintelligence Hive) - AI workflow dashboard"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppDirectory "$INSTDIR\app"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppStdout "$INSTDIR\service.log"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppStderr "$INSTDIR\service.log"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppStdoutCreationDisposition 4'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppStderrCreationDisposition 4'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppRotateFiles 1'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppRotateOnline 1'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppRotateBytes 5242880'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppEnvironmentExtra "HIVE_PORT=${PRODUCT_PORT}"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppEnvironmentExtra +"NODE_ENV=production"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppEnvironmentExtra +"HIVE_SERVICE=1"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppEnvironmentExtra +"USERPROFILE=$PROFILE"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppEnvironmentExtra +"HOME=$PROFILE"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppEnvironmentExtra +"PLAYWRIGHT_BROWSERS_PATH=$INSTDIR\app\.playwright-browsers"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} Start SERVICE_AUTO_START'

  ; Firewall
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${PRODUCT_NAME}" dir=in action=allow protocol=TCP localport=${PRODUCT_PORT}'

  ; Shortcuts
  WriteINIStr "$DESKTOP\${PRODUCT_NAME}.url" "InternetShortcut" "URL" "http://localhost:${PRODUCT_PORT}"
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  WriteINIStr "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.url" "InternetShortcut" "URL" "http://localhost:${PRODUCT_PORT}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  ; Uninstaller + registry
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoRepair" 1

  ; Start
  DetailPrint "Starting ${PRODUCT_NAME}..."
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" start ${SERVICE_NAME}'
  DetailPrint "SI Hive is available at http://localhost:${PRODUCT_PORT}"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" stop ${SERVICE_NAME}'
  Sleep 3000
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" remove ${SERVICE_NAME} confirm'
  Sleep 1000
  nsExec::ExecToLog 'sc delete ${SERVICE_NAME}'
  Sleep 2000
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${PRODUCT_NAME}"'
  Delete "$DESKTOP\${PRODUCT_NAME}.url"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
  RMDir /r "$INSTDIR"
SectionEnd
