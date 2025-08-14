# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a browser-based base64 decoding feasibility test application designed to test browser limits when decoding large files from base64 chunks. It consists of a Python FastAPI backend and a React TypeScript frontend running in Docker containers.

## Common Development Commands

### Quick Start with Docker
```bash
# Build and start both services
docker-compose up --build

# Run in detached mode
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Frontend Development
```bash
cd frontend

# Install dependencies
npm install

# Development server (hot reload)
npm run dev

# Build for production
npm run build

# Run production build locally
npm start

# Run tests
npm test
```

### Backend Development
```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Run development server
python main.py

# The server runs on port 8000 with auto-reload enabled
```

## Architecture

### Service Communication
- **Frontend**: React app served via Nginx on port 80 (mapped to 3000 in docker-compose)
- **Backend**: FastAPI server on port 8000
- **API Base URL**: Configured via `REACT_APP_API_URL` environment variable

### Data Flow
1. Backend receives/monitors files and converts them to base64
2. Base64 data is chunked into 1MB pieces
3. Frontend fetches chunks sequentially via REST API
4. Chunks are stored in IndexedDB for efficient memory management
5. Base64 is decoded and reassembled in the browser

### Key Components

**Backend (FastAPI)**:
- `main.py`: Core API with endpoints for file upload, chunk retrieval, and file management
- Monitors `input_files/` folder for automatic file processing
- In-memory storage of processed base64 chunks

**Frontend (React/TypeScript)**:
- `components/FileSelector.tsx`: File selection from available server files
- `components/ChunkedDecoder.tsx`: Handles chunk fetching, IndexedDB storage, and base64 decoding
- `utils/indexeddb.ts`: IndexedDB wrapper for efficient chunk storage

## API Endpoints

- `POST /upload` - Upload file for processing
- `GET /files` - List available files
- `GET /chunk/{file_id}/{chunk_number}` - Retrieve specific chunk
- `GET /file/{file_id}/info` - Get file metadata
- `DELETE /file/{file_id}` - Remove file from memory
- `GET /health` - Health check endpoint

## Performance Testing

The application measures:
- Download time for all chunks
- Base64 decoding time
- Memory usage estimation
- Processing speed (MB/s)
- Browser freeze detection

### File Size Limits
- **Small (1-10MB)**: Baseline performance
- **Medium (10-100MB)**: Performance degradation testing
- **Large (100MB+)**: Browser memory limit testing

## Testing Approach

Frontend tests use React Testing Library and Jest:
```bash
cd frontend
npm test
```

Backend can be tested with pytest (when tests are added):
```bash
cd backend
pytest
```

## Docker Configuration

- Frontend uses multi-stage build with Node.js for building and Nginx for serving
- Backend runs with uvicorn in reload mode for development
- Health checks configured for backend service
- Volume mounts for development hot-reload

## Environment Variables

**Frontend**:
- `REACT_APP_API_URL`: Backend API URL (default: http://localhost:8000)

**Backend**:
- `PYTHONUNBUFFERED`: Set to 1 for proper logging in Docker

## IndexedDB Management

The frontend uses IndexedDB to efficiently store chunks without overwhelming browser memory:
- Database: `Base64ChunkDB`
- Object Store: `chunks`
- Automatic cleanup after successful decoding
- Manual clear option available in UI