@echo off
cd /d "%~dp0.."
echo.
echo  Exchange Live - Ambiente Local
echo  ==============================
echo.

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)

if not exist .env.local (
  echo Criando .env.local...
  copy .env.example .env.local
)

echo.
echo  Iniciando painel em http://localhost:3000
echo  Pressione Ctrl+C para parar
echo.

call npm run dev
