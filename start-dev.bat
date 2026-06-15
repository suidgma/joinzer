@echo off
cd /d "%~dp0"
echo Clearing build cache...
if exist .next rmdir /s /q .next
echo Starting dev server...
npm run dev
pause
