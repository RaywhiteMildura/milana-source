@echo off
rem ============================================================================
rem  RaceLens - start it so your phone can use it (Windows)
rem
rem  Double-click this file (or run it from a Command Prompt). It:
rem    1. moves into the RaceLens folder,
rem    2. installs/builds the app the first time (needs internet once),
rem    3. asks for a phone-login password (hidden while you type; Enter for none),
rem    4. starts the server for your whole network and prints a QR code -
rem       scan it with your phone's camera on the same Wi-Fi.
rem  Keep this window open for the whole race day. Close it (or press Ctrl+C)
rem  to stop. Full guide: docs\DEPLOY.md
rem
rem  Not typing the password every time (needed to start it automatically):
rem    set it once for your Windows account, in a Command Prompt:
rem        setx RACELENS_PASSWORD "my pass phrase"
rem    then open a new window (setx only affects windows started afterwards).
rem    Windows keeps it in your account's settings, where you and the programs
rem    you run can read it - lock the screen when you leave the desk.
rem  Or pass it when starting:   start-phone.cmd "my pass phrase"
rem    Keep the quotes if it has spaces. A password passed this way can be seen
rem    in Task Manager while RaceLens runs, so setx is the better choice.
rem
rem  First run: Windows Firewall will ask "Allow Node.js to communicate on these
rem  networks?" - tick "Private networks" and click Allow, or the phone cannot
rem  connect.
rem
rem  Start automatically when you log on (Task Scheduler):
rem    Set the password with setx first (see above). Then:
rem    Start menu -> "Task Scheduler" -> Create Basic Task -> name "RaceLens"
rem    -> Trigger: "When I log on" -> Action: "Start a program" ->
rem    Program/script: browse to this file -> leave "Add arguments" empty ->
rem    Finish. Then open the task's Properties -> Conditions and untick "Start
rem    the task only if the computer is on AC power".
rem
rem  Keep the computer awake (a sleeping PC stops the automatic checks):
rem    Settings -> System -> Power & battery -> Screen and sleep ->
rem    "When plugged in, put my device to sleep after" = Never.
rem    Laptop lid: Control Panel -> Power Options -> "Choose what closing the lid
rem    does" -> Do nothing. The screen may switch off; that is fine.
rem ============================================================================
setlocal
cd /d "%~dp0.."

rem A password with spaces arrives as several words unless it is in quotes: say so here,
rem instead of starting with only the first word and refusing the real password on the phone.
if not "%~2"=="" goto split_password

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
if defined RACELENS_PASSWORD goto start

echo.
echo A password stops other people on the Wi-Fi from opening RaceLens.
where powershell >nul 2>&1
if errorlevel 1 goto ask_visible
rem PowerShell (part of Windows) reads the password without showing it, keeps it only in
rem its own environment - never on a command line or in a file - and starts RaceLens.
powershell -NoProfile -Command "$s = Read-Host 'Password for the phone login (hidden; press Enter for none)' -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { $env:RACELENS_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }; Write-Host ''; Write-Host 'Starting RaceLens... keep this window open during the race day. Press Ctrl+C to stop.'; Write-Host ''; node dist\server\index.js"
goto stopped

:ask_visible
echo PowerShell is not available here, so the password will show while you type it.
set /p "RACELENS_PASSWORD=Password for the phone login (press Enter for none): "
rem Clear the screen so the typed password does not stay in this window all day.
cls

:start
echo.
echo Starting RaceLens... keep this window open during the race day. Press Ctrl+C to stop.
echo.
node dist\server\index.js

:stopped
echo.
echo RaceLens has stopped.
pause
endlocal
goto :eof

:split_password
echo.
echo The password arrived as several words. If it contains spaces, put it in double quotes:
echo     start-phone.cmd "my pass phrase"
echo Or set it once with:  setx RACELENS_PASSWORD "my pass phrase"  (then open a new window).
pause
endlocal
exit /b 1
