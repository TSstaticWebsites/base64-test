import base64
import os
import tempfile
from typing import List, Dict
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import math
import glob
from pathlib import Path

app = FastAPI(title="Base64 Chunking Test Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CHUNK_SIZE = 1024 * 1024  # 1MB chunks in base64
INPUT_FOLDER = "input_files"  # Folder to monitor for files
processed_files: Dict[str, Dict] = {}

# Create input folder if it doesn't exist
os.makedirs(INPUT_FOLDER, exist_ok=True)

def process_file_from_folder(file_path: str) -> Dict:
    """Process a file from the input folder into base64 chunks"""
    try:
        with open(file_path, 'rb') as f:
            content = f.read()
        
        filename = os.path.basename(file_path)
        file_id = str(hash(content))
        
        # Convert to base64
        b64_content = base64.b64encode(content).decode('utf-8')
        
        # Calculate chunks
        total_chunks = math.ceil(len(b64_content) / CHUNK_SIZE)
        
        # Store file info
        file_info = {
            'filename': filename,
            'content': b64_content,
            'total_chunks': total_chunks,
            'original_size': len(content),
            'b64_size': len(b64_content),
            'file_path': file_path
        }
        
        processed_files[file_id] = file_info
        print(f"Processed file: {filename} -> {total_chunks} chunks ({len(content):,} bytes)")
        
        return {
            'file_id': file_id,
            'filename': filename,
            'total_chunks': total_chunks,
            'original_size': len(content),
            'b64_size': len(b64_content),
            'chunk_size': CHUNK_SIZE
        }
        
    except Exception as e:
        print(f"Error processing file {file_path}: {str(e)}")
        return None

def scan_input_folder():
    """Scan input folder for new files and process them"""
    try:
        pattern = os.path.join(INPUT_FOLDER, "*")
        files = glob.glob(pattern)
        
        for file_path in files:
            if os.path.isfile(file_path):
                # Check if already processed
                with open(file_path, 'rb') as f:
                    content = f.read()
                file_id = str(hash(content))
                
                if file_id not in processed_files:
                    process_file_from_folder(file_path)
                    
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

@app.get("/chunk/{file_id}/{chunk_number}")
async def get_chunk(file_id: str, chunk_number: int, chunk_size: int = Query(default=CHUNK_SIZE, ge=1024, le=10485760)):
    """Get a specific chunk of the base64 encoded file with custom chunk size"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_info = processed_files[file_id]
    
    # Calculate chunks based on custom chunk size
    total_chunks_custom = math.ceil(len(file_info['content']) / chunk_size)
    
    if chunk_number >= total_chunks_custom:
        raise HTTPException(status_code=404, detail="Chunk not found")
    
    start_pos = chunk_number * chunk_size
    end_pos = min(start_pos + chunk_size, len(file_info['content']))
    chunk_data = file_info['content'][start_pos:end_pos]
    
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
    """Get information about a processed file with custom chunk size"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_info = processed_files[file_id]
    
    # Calculate chunks based on custom chunk size
    total_chunks_custom = math.ceil(len(file_info['content']) / chunk_size)
    
    return {
        'file_id': file_id,
        'filename': file_info['filename'],
        'total_chunks': total_chunks_custom,
        'original_size': file_info['original_size'],
        'b64_size': file_info['b64_size'],
        'chunk_size_used': chunk_size,
        'default_chunks': file_info['total_chunks'],
        'default_chunk_size': CHUNK_SIZE
    }

@app.delete("/file/{file_id}")
async def delete_file(file_id: str):
    """Delete a processed file from memory"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    del processed_files[file_id]
    return {'message': 'File deleted successfully'}

@app.get("/health")
async def health_check():
    scan_input_folder()  # Check for new files
    return {'status': 'healthy', 'files_processed': len(processed_files)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)