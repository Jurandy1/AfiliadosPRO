@echo off
REM Cruzamento MAIO.csv x API Shopee (nao grava Firestore)
cd /d "%~dp0.."
if not exist ".env" (
  echo Coloque SHOPEE_APP_ID e SHOPEE_SECRET no .env da raiz do projeto.
  exit /b 1
)
node scripts\test-shopee-vs-csv.cjs "C:\Users\PC\Desktop\BATIMENTO DE COMPRAS\MAIO.csv" 2026-05-01 2026-05-31
pause
