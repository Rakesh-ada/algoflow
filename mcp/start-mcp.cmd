@echo off
setlocal
cd /d "%~dp0"
call "%~dp0node_modules\.bin\tsx.cmd" src\server.ts
