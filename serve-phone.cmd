@echo off
rem Serves FlashLearn to your phone over Wi-Fi. Keep this window open while studying.
cd /d "%~dp0"
echo.
echo On your phone (same Wi-Fi), open  http://THIS-PC-IP:8000
echo This PC's addresses:
ipconfig | findstr /C:"IPv4"
echo.
python -m http.server 8000
