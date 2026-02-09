@echo off
REM VM Resource Request System - Quick Start Testing Script (Windows)
REM This script helps you quickly set up and test the system

echo ==========================================
echo VM Resource Request System - Quick Start
echo ==========================================
echo.

REM Step 1: Check if .env exists
echo Step 1: Checking environment configuration...
if not exist .env (
    echo [ERROR] .env file not found!
    echo Please create .env file from .env.example
    exit /b 1
)
echo [OK] .env file found
echo.

REM Step 2: Check PostgreSQL
echo Step 2: Checking PostgreSQL connection...
where psql >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] psql command not found. Please install PostgreSQL
    exit /b 1
)

psql -U postgres -lqt | findstr /C:"vmware_tenant" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Database 'vmware_tenant' exists
) else (
    echo [INFO] Database 'vmware_tenant' not found. Creating...
    createdb -U postgres vmware_tenant
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Database created successfully
    ) else (
        echo [ERROR] Failed to create database
        exit /b 1
    )
)
echo.

REM Step 3: Run migrations
echo Step 3: Running database migrations...
for %%f in (migrations\*.sql) do (
    echo Running %%~nxf...
    psql -U postgres -d vmware_tenant -f "%%f" >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo [OK] %%~nxf completed
    ) else (
        echo [WARN] %%~nxf may have already been applied
    )
)
echo.

REM Step 4: Check Node.js
echo Step 4: Checking Node.js installation...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js %NODE_VERSION% found
echo.

REM Step 5: Install backend dependencies
echo Step 5: Installing backend dependencies...
cd backend
if not exist node_modules (
    call npm install
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Backend dependencies installed
    ) else (
        echo [ERROR] Failed to install backend dependencies
        cd ..
        exit /b 1
    )
) else (
    echo [OK] Backend dependencies already installed
)
cd ..
echo.

REM Step 6: Install frontend dependencies
echo Step 6: Installing frontend dependencies...
cd frontend
if not exist node_modules (
    call npm install
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Frontend dependencies installed
    ) else (
        echo [ERROR] Failed to install frontend dependencies
        cd ..
        exit /b 1
    )
) else (
    echo [OK] Frontend dependencies already installed
)
cd ..
echo.

REM Step 7: Test vCenter connectivity
echo Step 7: Testing vCenter connectivity...
curl -k -s -o nul -w "%%{http_code}" -X POST "https://10.0.200.100/rest/com/vmware/cis/session" -u "administrator@vsphere.local:Leinao@323" > temp_response.txt
set /p RESPONSE=<temp_response.txt
del temp_response.txt

if "%RESPONSE%"=="200" (
    echo [OK] vCenter connection successful
) else (
    echo [WARN] vCenter connection failed (HTTP %RESPONSE%^)
    echo Please verify vCenter credentials and network connectivity
)
echo.

REM Summary
echo ==========================================
echo Setup Complete!
echo ==========================================
echo.
echo Next steps:
echo 1. Start backend server:
echo    cd backend ^&^& npm run dev
echo.
echo 2. In a new terminal, start frontend:
echo    cd frontend ^&^& npm run dev
echo.
echo 3. Access the application:
echo    Frontend: http://localhost:5173
echo    Backend API: http://localhost:3000
echo.
echo 4. Login with default admin account:
echo    Email: admin@leinao.ai
echo    Password: admin123
echo.
echo 5. Follow the testing guide in TESTING_GUIDE.md
echo.
echo ==========================================
pause
