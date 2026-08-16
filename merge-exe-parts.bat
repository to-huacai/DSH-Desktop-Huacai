@echo off
rem ============================================================
rem  Recombine the split release exe parts back into the exe.
rem  Usage: double-click this file (or run from this folder).
rem  NOTE: DSH-Desktop-Huacai-1.12.exe must NOT be running.
rem ============================================================
cd /d "%~dp0"
copy /b "DSH-Desktop-Huacai-1.12.exe.part1" + "DSH-Desktop-Huacai-1.12.exe.part2" "DSH-Desktop-Huacai-1.12.exe" >nul
if errorlevel 1 (
  echo FAILED: cannot write DSH-Desktop-Huacai-1.12.exe.
  echo Close the running DSH app first, then retry.
  pause
  exit /b 1
)
echo Done. DSH-Desktop-Huacai-1.12.exe restored (120099741 bytes).
pause

