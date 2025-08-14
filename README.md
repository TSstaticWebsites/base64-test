# Browser Base64 Decoding Feasibility Test

This project tests the feasibility of decoding large files from base64 chunks in the browser. It consists of a Python FastAPI backend that chunks and encodes files, and a React TypeScript frontend that fetches chunks and decodes them.

## 🚀 Quick Deploy to DigitalOcean

[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/TSstaticWebsites/base64-test/tree/master)

### One-Click Deployment
1. Click the button above
2. Connect your GitHub account if needed
3. Review the app configuration
4. Click "Create Resources"
5. Your app will be live in minutes!

### Manual Deployment
```bash
# Using DigitalOcean CLI
doctl apps create --spec .do/app.yaml

# Or deploy with Docker
docker build -f Dockerfile.digitalocean -t base64-test .
docker run -p 80:80 base64-test
```

## Architecture

### Backend (Python FastAPI)
- Receives file uploads (simplified, no chunking during upload)
- Stores files as-is in `/input_files`
- Processes files to base64 chunks on-demand (when first chunk is requested)
- Serves chunks via REST API endpoints

### Frontend (React TypeScript)
- File manager with upload/delete capabilities
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

### Production Deployment

```bash
# Build production containers
docker-compose -f docker-compose.prod.yml up --build

# Application will be available at http://localhost
```

## Features

### File Management
- **Upload**: Drag & drop or browse to upload files
- **Delete**: Remove files from storage
- **Auto-refresh**: File list updates automatically

### Testing Capabilities
- Test browser limits with different file sizes
- Measure download and decode performance
- Detect browser freezing
- Support for files up to 5GB

## Performance Metrics

The application measures:

- **Download Time**: Time to fetch all base64 chunks
- **Decode Time**: Time to convert base64 to binary data
- **Memory Usage**: Estimated memory consumption
- **Decoding Speed**: MB/s processing rate
- **Browser Freeze Detection**: Whether the UI became unresponsive

## API Endpoints

- `POST /upload-to-input` - Upload a file for storage
- `GET /files` - List all available files
- `GET /chunk/{file_id}/{chunk_number}` - Get a specific chunk (triggers processing on first request)
- `GET /file/{file_id}/info` - Get file information
- `DELETE /input-file/{filename}` - Delete file from storage
- `GET /health` - Health check
- `GET /status` - Server status and statistics

## Browser Compatibility

Modern browsers should handle:
- **Chrome/Edge**: 100MB+ files
- **Firefox**: 50-100MB files  
- **Safari**: Varies by device memory

## Configuration

### Nginx Settings (Production)
- Max body size: 5GB
- Request timeout: 1 hour
- Buffering disabled for uploads

### Backend Settings
- Chunk size: 1MB (configurable)
- On-demand processing
- File caching system

## File Structure

```
├── backend/
│   ├── main.py                 # FastAPI application
│   ├── requirements.txt        # Python dependencies
│   ├── Dockerfile              # Development container
│   ├── Dockerfile.prod         # Production container
│   └── input_files/            # Uploaded files storage
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Main application
│   │   ├── components/
│   │   │   ├── FileManager.tsx       # File management UI
│   │   │   └── ChunkedDecoder.tsx    # Base64 decoding
│   │   └── index.tsx          # React entry point
│   ├── Dockerfile             # Development container
│   ├── Dockerfile.prod        # Production container
│   ├── nginx.conf             # Development nginx config
│   └── nginx.prod.conf        # Production nginx config
├── docker-compose.yml         # Development orchestration
├── docker-compose.prod.yml    # Production orchestration
├── Dockerfile.digitalocean    # All-in-one deployment
└── .do/
    └── app.yaml              # DigitalOcean app spec
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

## Deployment Notes

### DigitalOcean App Platform
- Uses single container with both frontend and backend
- Nginx serves frontend and proxies API requests
- Supervisor manages both processes
- Automatic SSL and CDN included

### Storage Considerations
- Files are stored in container filesystem
- Consider adding persistent storage for production
- Cache directory for processed base64 chunks

## Next Steps

Based on test results, you may want to:

1. **Implement streaming**: Process chunks as they arrive
2. **Add WebAssembly**: For better performance
3. **Use Web Workers**: Prevent main thread blocking
4. **Add compression**: Reduce transfer size
5. **Implement persistent storage**: For production use

## Support

For issues or questions:
- Create an issue on GitHub
- Check logs: `docker logs base64-test-backend-1`
- Monitor status: `/status` endpoint