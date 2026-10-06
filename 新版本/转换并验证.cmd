@echo off
rem Convert + verify in one shot.
rem   huanzhuang.cmd "..\path\to\project.bcm4" "_out\myproj"
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0huanzhuang.ps1" -Bcm4 %1 -Out %2
endlocal
