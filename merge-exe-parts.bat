@echo off
rem ============================================================
rem  Recombine the split release exe parts back into the exe.
rem  Usage: double-click this file (or run from this folder).
rem  NOTE: DSH-Desktop-Huacai-1.14.exe must NOT be running.
rem ============================================================
cd /d "%~dp0"
copy /b "DSH-Desktop-Huacai-1.14.exe.part1" + "DSH-Desktop-Huacai-1.14.exe.part2" "DSH-Desktop-Huacai-1.14.exe" >nul
if errorlevel 1 (
  echo FAILED: cannot write DSH-Desktop-Huacai-1.14.exe.
  echo Close the running DSH app first, then retry.
  pause
  exit /b 1
)
echo Done. DSH-Desktop-Huacai-1.14.exe restored (126581779 bytes).
pause



