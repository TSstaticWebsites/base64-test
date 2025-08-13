#!/bin/bash

echo "Starting Browser Base64 Decoding Test..."
echo

echo "Generating test files..."
python3 generate_test_files.py

echo
echo "Starting Docker containers..."
docker-compose up --build -d

echo
echo "Waiting for services to start..."
sleep 10

echo
echo "Installing test dependencies..."
pip3 install requests

echo "Running backend tests..."
python3 test_runner.py

echo
echo "================================="
echo "Services are running:"
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:8000"
echo "================================="
echo
echo "Opening browser..."

# Try to open browser (works on macOS and most Linux distros)
if command -v open > /dev/null; then
    open http://localhost:3000
elif command -v xdg-open > /dev/null; then
    xdg-open http://localhost:3000
else
    echo "Please open http://localhost:3000 in your browser"
fi

echo
echo "To stop services: docker-compose down"