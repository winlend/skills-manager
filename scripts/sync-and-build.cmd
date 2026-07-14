@echo off
setlocal
cd /d "%~dp0\.."
echo.
echo Skills Manager — sync upstream (if needed) + build personal exe
echo.

REM Prefer elevating only when -Deploy is passed among args
echo Args: %*
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-and-build.ps1" %*
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo FAILED with exit code %ERR%
  pause
  exit /b %ERR%
)
echo OK
pause
endlocal
