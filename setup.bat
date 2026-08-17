@echo off
cd "%~dp0"
rem Add nodejs to path temporarily
set "PATH=C:\Program Files\nodejs;%PATH%"
rem Initialize Expo project
C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\npx.exe expo init WakeMom --template expo-template-blank