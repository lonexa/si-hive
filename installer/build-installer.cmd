@echo off
setlocal enabledelayedexpansion
echo ============================================
echo   Hive Unified Installer Builder
echo ============================================
echo.

set NSIS_PATH="C:\Program Files (x86)\NSIS\makensis.exe"

echo Checking prerequisites...
if not exist %NSIS_PATH% (
    echo ERROR: NSIS not found at %NSIS_PATH%
    echo Install NSIS: winget install NSIS.NSIS
    exit /b 1
)

if not exist "%~dp0portable\node\node.exe" (
    echo ERROR: Portable Node.js not found at %~dp0portable\node\
    echo Download Node.js LTS zip and extract to installer\portable\node\
    exit /b 1
)

REM nssm.exe is stored base64-encoded so the repo tree - and therefore the
REM update zip the app downloads - contains no Windows executable. Decode it
REM here if a local copy isn't already present.
if not exist "%~dp0nssm.exe" (
    if not exist "%~dp0nssm.exe.b64" (
        echo ERROR: neither nssm.exe nor nssm.exe.b64 found in installer\
        echo Restore installer\nssm.exe.b64, or download NSSM from nssm.cc
        exit /b 1
    )
    echo Decoding nssm.exe from nssm.exe.b64...
    node -e "const f=require('fs');f.writeFileSync('%~dp0nssm.exe',Buffer.from(f.readFileSync('%~dp0nssm.exe.b64','ascii'),'base64'))"
    REM Antivirus may delete nssm.exe as it is written - the write reports
    REM success and the file is simply gone. Check, do not trust the exit code.
    if not exist "%~dp0nssm.exe" (
        echo ERROR: nssm.exe vanished immediately after being decoded.
        echo Antivirus ^(e.g. Symantec Endpoint Protection^) is almost certainly
        echo quarantining it. Add an exclusion for installer\nssm.exe, or copy a
        echo known-good nssm.exe into installer\ before building.
        exit /b 1
    )
)

REM Step 1: Package source code
echo.
echo Step 1: Packaging source code...
node "%~dp0package-source.cjs"
if errorlevel 1 (
    echo FAILED: Could not package source
    exit /b 1
)

if not exist "%~dp0source\package.json" (
    echo ERROR: Packaged source not found
    exit /b 1
)

REM Remove old Full/Lite directories from source (only apps/hive should exist)
if exist "%~dp0source\apps\full" (
    echo Removing legacy apps\full from source...
    rmdir /s /q "%~dp0source\apps\full" 2>nul
)
if exist "%~dp0source\apps\lite" (
    echo Removing legacy apps\lite from source...
    rmdir /s /q "%~dp0source\apps\lite" 2>nul
)

REM Verify apps/hive exists in source
if not exist "%~dp0source\apps\hive\package.json" (
    echo ERROR: apps\hive not found in packaged source. Is the branch correct?
    exit /b 1
)

REM Step 2: Bundle node_modules as tar
echo.
if exist "%~dp0..\node_modules" (
    echo Step 2: Creating node_modules.tar from repo root...
    tar -cf "%~dp0source\node_modules.tar" --force-local -C "%~dp0.." node_modules
    if errorlevel 1 (
        echo FAILED: Could not tar node_modules
        exit /b 1
    )
) else (
    echo Step 2: Installing dependencies then creating tar...
    cd "%~dp0source"
    "%~dp0portable\node\node.exe" "%~dp0portable\node\node_modules\npm\bin\npm-cli.js" install --production=false
    if errorlevel 1 (
        echo FAILED: Could not install dependencies
        cd "%~dp0"
        exit /b 1
    )
    cd "%~dp0"
    tar -cf "%~dp0source\node_modules.tar" --force-local -C "%~dp0source" node_modules
    rmdir /s /q "%~dp0source\node_modules" 2>nul
)

REM Step 3: Build installer
echo.
echo Step 3: Building Hive installer...
%NSIS_PATH% "%~dp0hive.nsi"
if errorlevel 1 (
    echo FAILED: Hive installer build failed
    exit /b 1
)
echo SUCCESS: HiveSetup.exe

REM Cleanup
echo.
echo Cleaning up packaged source...
rmdir /s /q "%~dp0source" 2>nul

echo.
echo ============================================
echo   Build complete!
echo   Output: installer\HiveSetup.exe
echo ============================================
