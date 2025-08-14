import base64
import os
import tempfile
import json
import hashlib
import time
import traceback
from typing import List, Dict, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import math
import glob
from pathlib import Path

app = FastAPI(title="Base64 Chunking Test Server")

# Add request timeout middleware
@app.middleware("http")
async def timeout_middleware(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    if process_time > 5:
        print(f"⚠️ Slow request: {request.url.path} took {process_time:.2f}s")
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CHUNK_SIZE = 1024 * 1024  # 1MB chunks in base64
INPUT_FOLDER = "input_files"  # Folder to monitor for files
CACHE_FOLDER = "cache"  # Folder to cache base64 chunks
processed_files: Dict[str, Dict] = {}
FILE_READ_CHUNK_SIZE = 3 * 1024 * 1024  # 3MB chunks for reading (becomes 4MB in base64)

# Create folders if they don't exist
os.makedirs(INPUT_FOLDER, exist_ok=True)
os.makedirs(CACHE_FOLDER, exist_ok=True)


def get_file_hash(file_path: str) -> str:
    """Calculate SHA256 hash of file for unique identification"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(65536), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def register_file(file_path: str) -> Optional[Dict]:
    """Register a file from the input folder without processing"""
    try:
        filename = os.path.basename(file_path)
        file_size = os.path.getsize(file_path)
        
        print(f"📁 Registering file: {filename} ({file_size / (1024*1024):.1f}MB)")
        
        # Generate unique file ID based on content hash
        file_hash = get_file_hash(file_path)
        file_id = file_hash[:16]  # Use first 16 chars of hash
        
        # Check if already registered
        if file_id in processed_files:
            print(f"   ⚠️ File already registered: {filename}")
            return None
        
        # Calculate what the base64 size would be (for info purposes)
        estimated_b64_size = math.ceil(file_size * 4 / 3)  # Base64 is ~33% larger
        estimated_chunks = math.ceil(estimated_b64_size / CHUNK_SIZE)
        
        # Store file metadata without processing
        file_info = {
            'filename': filename,
            'file_path': file_path,
            'original_size': file_size,
            'b64_size': estimated_b64_size,  # This is an estimate
            'total_chunks': estimated_chunks,  # This is an estimate
            'cache_dir': None,  # Will be created on first chunk request
            'cached_chunks': 0,  # No chunks cached yet
            'is_processed': False  # Track if base64 processing has been done
        }
        
        processed_files[file_id] = file_info
        print(f"✅ File registered: {filename} (ID: {file_id})")
        
        return {
            'file_id': file_id,
            'filename': filename,
            'total_chunks': estimated_chunks,
            'original_size': file_size,
            'b64_size': estimated_b64_size,
            'chunk_size': CHUNK_SIZE
        }
        
    except Exception as e:
        print(f"❌ Error registering file {file_path}: {str(e)}")
        print(f"   Traceback: {traceback.format_exc()}")
        return None

def process_file_on_demand(file_id: str) -> bool:
    """Process a file into base64 chunks on first request"""
    if file_id not in processed_files:
        return False
    
    file_info = processed_files[file_id]
    
    # Skip if already processed
    if file_info.get('is_processed', False):
        return True
    
    start_time = time.time()
    file_path = file_info['file_path']
    filename = file_info['filename']
    
    try:
        print(f"🔄 Processing file on-demand: {filename}")
        print(f"   File size: {file_info['original_size'] / (1024*1024):.1f}MB")
        
        # Create cache directory for this file
        file_cache_dir = os.path.join(CACHE_FOLDER, file_id)
        os.makedirs(file_cache_dir, exist_ok=True)
        
        # Process file in chunks and save to cache
        total_b64_size = 0
        chunk_index = 0
        last_log_time = time.time()
        bytes_processed = 0
        
        with open(file_path, 'rb') as f:
            while True:
                # Read chunk from file
                chunk_data = f.read(FILE_READ_CHUNK_SIZE)
                if not chunk_data:
                    break
                
                bytes_processed += len(chunk_data)
                
                # Encode to base64
                b64_chunk = base64.b64encode(chunk_data).decode('utf-8')
                
                # Save chunk to cache file
                chunk_file = os.path.join(file_cache_dir, f"chunk_{chunk_index}.b64")
                with open(chunk_file, 'w') as cf:
                    cf.write(b64_chunk)
                
                total_b64_size += len(b64_chunk)
                chunk_index += 1
                
                # Log progress every 2 seconds
                current_time = time.time()
                if current_time - last_log_time > 2:
                    elapsed = current_time - start_time
                    speed = bytes_processed / (1024 * 1024 * elapsed)  # MB/s
                    print(f"   Progress: {bytes_processed / (1024*1024):.1f}MB processed, "
                          f"{chunk_index} chunks created, {speed:.1f}MB/s")
                    last_log_time = current_time
        
        # Update file info with actual values
        file_info['cache_dir'] = file_cache_dir
        file_info['cached_chunks'] = chunk_index
        file_info['b64_size'] = total_b64_size
        file_info['total_chunks'] = math.ceil(total_b64_size / CHUNK_SIZE)
        file_info['is_processed'] = True
        
        process_time = time.time() - start_time
        print(f"✅ On-demand processing complete: {filename}")
        print(f"   Total time: {process_time:.1f}s")
        print(f"   Chunks created: {chunk_index}")
        print(f"   Base64 size: {total_b64_size / (1024*1024):.1f}MB")
        print(f"   Processing speed: {file_info['original_size'] / (1024*1024*process_time):.1f}MB/s")
        
        return True
        
    except Exception as e:
        print(f"❌ Error processing file on-demand {filename}: {str(e)}")
        print(f"   Traceback: {traceback.format_exc()}")
        return False

def scan_input_folder():
    """Scan input folder for new files and register them (without processing)"""
    try:
        pattern = os.path.join(INPUT_FOLDER, "*")
        files = glob.glob(pattern)
        
        for file_path in files:
            if os.path.isfile(file_path):
                register_file(file_path)
                    
    except Exception as e:
        print(f"Error scanning folder: {str(e)}")

@app.get("/files")
async def list_available_files():
    """List all available files for processing"""
    scan_input_folder()  # Scan for new files
    
    files = []
    for file_id, info in processed_files.items():
        files.append({
            'file_id': file_id,
            'filename': info['filename'],
            'total_chunks': info['total_chunks'],
            'original_size': info['original_size'],
            'b64_size': info['b64_size']
        })
    
    return {'files': files}

def load_chunk_from_cache(file_info: Dict, chunk_number: int, chunk_size: int) -> str:
    """Load a specific chunk from cached base64 files"""
    cache_dir = file_info.get('cache_dir')
    
    if not cache_dir or not os.path.exists(cache_dir):
        raise HTTPException(status_code=500, detail="Cache not available for this file")
    
    # Calculate byte position
    start_pos = chunk_number * chunk_size
    end_pos = start_pos + chunk_size
    
    # Read and concatenate cached chunks as needed
    result = []
    current_pos = 0
    
    for i in range(file_info['cached_chunks']):
        chunk_file = os.path.join(cache_dir, f"chunk_{i}.b64")
        
        with open(chunk_file, 'r') as f:
            chunk_data = f.read()
            chunk_len = len(chunk_data)
            
            # Check if this cached chunk contains data we need
            if current_pos + chunk_len > start_pos and current_pos < end_pos:
                # Calculate what part of this chunk we need
                chunk_start = max(0, start_pos - current_pos)
                chunk_end = min(chunk_len, end_pos - current_pos)
                result.append(chunk_data[chunk_start:chunk_end])
            
            current_pos += chunk_len
            
            # Stop if we've got all we need
            if current_pos >= end_pos:
                break
    
    return ''.join(result)

@app.get("/chunk/{file_id}/{chunk_number}")
async def get_chunk(file_id: str, chunk_number: int, chunk_size: int = Query(default=CHUNK_SIZE, ge=1024, le=10485760)):
    """Get a specific chunk of the base64 encoded file with custom chunk size"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_info = processed_files[file_id]
    
    # Process file on-demand if not already processed
    if not file_info.get('is_processed', False):
        print(f"📊 First chunk request for {file_info['filename']}, processing on-demand...")
        if not process_file_on_demand(file_id):
            raise HTTPException(status_code=500, detail="Failed to process file")
        # Refresh file_info after processing
        file_info = processed_files[file_id]
    
    # Calculate chunks based on custom chunk size
    total_chunks_custom = math.ceil(file_info['b64_size'] / chunk_size)
    
    if chunk_number >= total_chunks_custom:
        raise HTTPException(status_code=404, detail="Chunk not found")
    
    # Load chunk from cache
    chunk_data = load_chunk_from_cache(file_info, chunk_number, chunk_size)
    
    return {
        'chunk_number': chunk_number,
        'total_chunks': total_chunks_custom,
        'data': chunk_data,
        'is_last': chunk_number == total_chunks_custom - 1,
        'chunk_size_used': chunk_size,
        'actual_chunk_size': len(chunk_data)
    }

@app.get("/file/{file_id}/info")
async def get_file_info(file_id: str, chunk_size: int = Query(default=CHUNK_SIZE, ge=1024, le=10485760)):
    """Get information about a file with custom chunk size"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_info = processed_files[file_id]
    
    # For unprocessed files, b64_size is an estimate
    if not file_info.get('is_processed', False):
        print(f"ℹ️ File {file_info['filename']} not yet processed, returning estimates")
    
    # Calculate chunks based on custom chunk size
    total_chunks_custom = math.ceil(file_info['b64_size'] / chunk_size)
    
    return {
        'file_id': file_id,
        'filename': file_info['filename'],
        'total_chunks': total_chunks_custom,
        'original_size': file_info['original_size'],
        'b64_size': file_info['b64_size'],
        'chunk_size_used': chunk_size,
        'default_chunks': file_info['total_chunks'],
        'default_chunk_size': CHUNK_SIZE,
        'is_processed': file_info.get('is_processed', False)
    }

@app.delete("/file/{file_id}")
async def delete_file(file_id: str):
    """Delete a processed file from memory"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    del processed_files[file_id]
    return {'message': 'File deleted successfully'}

@app.post("/upload-to-input")
async def upload_to_input_folder(file: UploadFile = File(...)):
    """Upload a file directly to the input_files folder (standard upload, no frills)"""
    try:
        # Save file to input_files folder
        file_path = os.path.join(INPUT_FOLDER, file.filename)
        
        # Simple, standard file write
        with open(file_path, 'wb') as f:
            content = await file.read()
            f.write(content)
        
        # Register the file
        file_info = register_file(file_path)
        
        if file_info:
            return {
                'message': f'File {file.filename} uploaded successfully',
                'file_info': file_info
            }
        else:
            return JSONResponse(
                status_code=500,
                content={'error': 'Failed to register uploaded file'}
            )
            
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={'error': f'Upload failed: {str(e)}'}
        )

@app.delete("/input-file/{filename}")
async def delete_input_file(filename: str):
    """Delete a file from the input_files folder"""
    try:
        file_path = os.path.join(INPUT_FOLDER, filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File {filename} not found")
        
        # Remove from processed files and clean up cache
        for file_id, info in list(processed_files.items()):
            if info.get('filename') == filename:
                # Remove cache directory if it exists
                cache_dir = info.get('cache_dir')
                if cache_dir and os.path.exists(cache_dir):
                    import shutil
                    shutil.rmtree(cache_dir)
                    print(f"Removed cache for {filename}")
                
                del processed_files[file_id]
                break
        
        # Delete the file
        os.remove(file_path)
        
        return {
            'message': f'File {filename} deleted successfully',
            'filename': filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={'error': f'Delete failed: {str(e)}'}
        )

@app.get("/health")
async def health_check():
    scan_input_folder()  # Check for new files
    return {'status': 'healthy', 'files_processed': len(processed_files)}

@app.get("/status")
async def get_status():
    """Get current server status and statistics"""
    import psutil
    
    # Get memory usage
    process = psutil.Process(os.getpid())
    memory_info = process.memory_info()
    
    # Get disk usage
    disk_usage = psutil.disk_usage('/')
    
    # Count cache files
    cache_files = 0
    cache_size = 0
    if os.path.exists(CACHE_FOLDER):
        for root, dirs, files in os.walk(CACHE_FOLDER):
            cache_files += len(files)
            for file in files:
                try:
                    cache_size += os.path.getsize(os.path.join(root, file))
                except:
                    pass
    
    return {
        'memory': {
            'rss_mb': memory_info.rss / (1024 * 1024),
            'vms_mb': memory_info.vms / (1024 * 1024),
        },
        'disk': {
            'total_gb': disk_usage.total / (1024 ** 3),
            'used_gb': disk_usage.used / (1024 ** 3),
            'free_gb': disk_usage.free / (1024 ** 3),
            'percent': disk_usage.percent
        },
        'cache': {
            'files': cache_files,
            'size_mb': cache_size / (1024 * 1024)
        },
        'processed_files': len(processed_files)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_keep_alive=300)