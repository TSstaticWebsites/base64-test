# Browser Base64 Decoding Feasibility Test

This project tests the feasibility of decoding large files from base64 chunks in the browser. It consists of a Python FastAPI backend that chunks and encodes files, and a React TypeScript frontend that fetches chunks and decodes them.

## Quick Deploy

[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/TSstaticWebsites/base64-test/tree/main)

## Architecture

### Backend (Python FastAPI)
- Receives file uploads
- Converts files to base64
- Chunks the base64 data into 1MB pieces
- Serves chunks via REST API endpoints

### Frontend (React TypeScript)
- File upload interface with drag & drop
- Fetches chunks sequentially from backend
- Concatenates and decodes base64 data in browser
- Performance monitoring and browser freeze detection

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Build and start both services
docker-compose up --build

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
```

### Manual Setup

#### Backend
```bash
cd backend
pip install -r requirements.txt
python main.py
```

#### Frontend
```bash
cd frontend
npm install
npm start
```

## Testing Different File Sizes

The application is designed to test browser limits with different file sizes:

- **Small files (1-10MB)**: Should work smoothly
- **Medium files (10-100MB)**: May show performance impact
- **Large files (100MB+)**: Tests browser memory limits

## Performance Metrics

The application measures:

- **Download Time**: Time to fetch all base64 chunks
- **Decode Time**: Time to convert base64 to binary data
- **Memory Usage**: Estimated memory consumption
- **Decoding Speed**: MB/s processing rate
- **Browser Freeze Detection**: Whether the UI became unresponsive

## API Endpoints

- `POST /upload` - Upload a file for processing
- `GET /chunk/{file_id}/{chunk_number}` - Get a specific chunk
- `GET /file/{file_id}/info` - Get file information
- `DELETE /file/{file_id}` - Delete file from memory
- `GET /health` - Health check

## Browser Compatibility

Modern browsers should handle:
- **Chrome/Edge**: 100MB+ files
- **Firefox**: 50-100MB files  
- **Safari**: Varies by device memory

## Limitations & Considerations

1. **Memory Usage**: Base64 decoding requires keeping data in memory
2. **Browser Freeze**: Large files may freeze the UI during decoding
3. **Mobile Devices**: Lower memory limits than desktop
4. **WebAssembly Alternative**: Consider for better performance with very large files

## When to Use WebAssembly

Consider WebAssembly if:
- Files exceed 100MB regularly
- Browser freezing is unacceptable
- Need better performance on mobile devices
- Processing complex binary formats

## File Structure

```
├── backend/
│   ├── main.py           # FastAPI application
│   ├── requirements.txt  # Python dependencies
│   └── Dockerfile        # Backend container
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # Main application
│   │   ├── components/
│   │   │   ├── FileUploader.tsx       # File upload component
│   │   │   └── ChunkedDecoder.tsx     # Base64 decoding component
│   │   └── index.tsx                  # React entry point
│   ├── package.json      # Node.js dependencies
│   ├── Dockerfile        # Frontend container
│   └── nginx.conf        # Nginx configuration
└── docker-compose.yml    # Container orchestration
```

## Results Interpretation

### ✅ Good Performance Indicators
- Decode time < 5 seconds for 50MB files
- No browser freezing
- Memory usage < 2x file size

### ⚠️ Warning Signs
- Decode time > 10 seconds
- Browser becomes unresponsive
- Memory usage > 3x file size

### ❌ Consider WebAssembly When
- Files > 100MB cause crashes
- Consistent browser freezing
- Mobile devices fail with smaller files

## Next Steps

Based on test results, you may want to:

1. **Implement streaming**: Process chunks as they arrive
2. **Add WebAssembly**: For better performance
3. **Use Web Workers**: Prevent main thread blocking
4. **Add compression**: Reduce transfer size
5. **Implement caching**: For repeated access patterns