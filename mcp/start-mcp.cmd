@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0dist\server.js" (
  call npm.cmd run build
  if errorlevel 1 exit /b 1
)
call node "%~dp0dist\server.js"
