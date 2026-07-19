@echo off
cd /d "%~dp0.."
echo.
echo  Exchange Live - Conexao Local
echo  =============================
echo.

node scripts\ensure-local-env.mjs
if errorlevel 1 exit /b 1

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)

echo.
echo  Use: npm run start:local
echo  Ou rode este .bat via: npm run start:local
echo.
call npm run start:local
