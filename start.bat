@echo off
echo Starting Browser Base64 Decoding Test...
echo.

echo Generating test files...
python generate_test_files.py

echo.
echo Starting Docker containers...
docker-compose up --build -d

echo.
echo Waiting for services to start...
timeout /t 10

echo.
echo Running backend tests...
python -m pip install requests
python test_runner.py

echo.
echo =================================
echo Services are running:
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:8000
echo =================================
echo.
echo Press any key to open browser...
pause > nul

start http://localhost:3000

echo.
echo To stop services: docker-compose down