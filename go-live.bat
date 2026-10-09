@echo off
REM Double-click this file whenever the public site link stops working.
REM It restarts the QMS server and the public tunnel. Keep both black
REM windows OPEN while sharing the site. The tunnel window prints your link.
cd /d C:\Users\Shiha\qms\server
start "QMS Server - KEEP OPEN" cmd /k "node index.js >> C:\Users\Shiha\qms\server\server.log 2>&1"
timeout /t 4 /nobreak >nul
start "QMS Public Tunnel - KEEP OPEN, your link is printed here" "C:\Windows\System32\OpenSSH\ssh.exe" -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:4000 nokey@localhost.run
echo.
echo Server and tunnel started. Look in the TUNNEL window for your https link.
echo NOTE: the link is random and changes every restart. Share the new one.
pause
