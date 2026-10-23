@echo off
rem ============================================================================
rem  RaceLens - start it so your phone can use it (Windows)
rem
rem  Double-click this file (or run it from a Command Prompt). It:
rem    1. moves into the RaceLens folder,
rem    2. installs/builds the app the first time (needs internet once),
rem    3. asks for a phone-login password (press Enter for none),
rem    4. starts the server for your whole network and prints a QR code -
rem       scan it with your phone's camera on the same Wi-Fi.
rem  Keep this window open for the whole race day. Close it (or press Ctrl+C)
rem  to stop. Full guide: docs\DEPLOY.md
rem
rem  Password without typing it each time:   start-phone.cmd mypassword
rem  or set it once for your account:        setx RACELENS_PASSWORD mypassword
rem  (then open a new window - setx only affects windows started afterwards).
rem
rem  First run: Windows Firewall will ask "Allow Node.js to communicate on these
rem  networks?" - tick "Private networks" and click Allow, or the phone cannot
rem  connect.
rem
rem  Start automatically when you log on (Task Scheduler):
rem    Start menu -> "Task Scheduler" -> Create Basic Task -> name "RaceLens"
rem    -> Trigger: "When I log on" -> Action: "Start a program" ->
rem    Program/script: browse to this file -> Finish. Then open the task's
rem    Properties -> Conditions and untick "Start the task only if the computer
rem    is on AC power". To skip the password prompt, add your password in the
rem    "Add arguments" box of the action.
rem
rem  Keep the computer awake (a sleeping PC stops the automatic checks):
rem    Settings -> System -> Power & battery -> Screen and sleep ->
rem    "When plugged in, put my device to sleep after" = Never.
rem    Laptop lid: Control Panel -> Power Options -> "Choose what closing the lid
rem    does" -> Do nothing. The screen may switch off; that is fine.
rem ============================================================================
setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then run this again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing RaceLens dependencies - first time only, this takes a minute...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist "dist\server\index.js" (
  echo Building RaceLens - first time only...
  call npm run build
  if errorlevel 1 (
    echo The build failed. See the messages above.
    pause
    exit /b 1
  )
)

rem Listen on every network address, not just this computer, so the phone can reach it.
set "RACELENS_HOST=0.0.0.0"

if not "%~1"=="" set "RACELENS_PASSWORD=%~1"
if "%RACELENS_PASSWORD%"=="" (
  echo.
  echo A password stops other people on the Wi-Fi from opening RaceLens.
  set /p "RACELENS_PASSWORD=Password for the phone login (press Enter for none): "
)

echo.
echo Starting RaceLens... keep this window open during the race day. Press Ctrl+C to stop.
echo.
node dist\server\index.js

echo.
echo RaceLens has stopped.
pause
endlocal
