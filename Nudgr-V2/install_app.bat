@echo off
setlocal DisableDelayedExpansion
title Nudgr - Physical Android Device Installer

rem Double-click to install the current release on a connected physical phone.
rem Pass -Build to rebuild the release APK first, -Serial ID, -Launch, or -PrepareOnly.
set "INSTALLER=%~dp0tools\install-physical.ps1"
if not exist "%INSTALLER%" (
    echo [ERROR] Installer helper is missing: "%INSTALLER%"
    pause
    exit /b 1
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -Launch %*
set "INSTALL_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %INSTALL_EXIT%
