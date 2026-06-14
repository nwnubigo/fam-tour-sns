@echo off
REM 탐색기에서 더블클릭으로 배포할 수 있는 진입점
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
