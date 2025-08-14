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
import binascii
from enum import Enum

class EncodingType(str, Enum):
    BASE64 = "base64"
    HEX = "hex"
    BASE32 = "base32"
    BASE85 = "base85"
    UUENCODE = "uuencode"
    YENC = "yenc"

class EncodingMode(str, Enum):
    CHUNK = "chunk"  # Encode each chunk separately (current behavior)
    FULL = "full"    # Encode entire file, then chunk the encoded data

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

def encode_data(data: bytes, encoding: EncodingType) -> str:
    """Encode binary data using the specified encoding"""
    if encoding == EncodingType.BASE64:
        return base64.b64encode(data).decode('utf-8')
    elif encoding == EncodingType.HEX:
        return binascii.hexlify(data).decode('utf-8')
    elif encoding == EncodingType.BASE32:
        return base64.b32encode(data).decode('utf-8')
    elif encoding == EncodingType.BASE85:
        return base64.b85encode(data).decode('utf-8')
    elif encoding == EncodingType.UUENCODE:
        # Simple uuencode-like encoding using base64 with different chars
        # Real uuencode is more complex with line formatting
        return base64.b64encode(data).decode('utf-8')
    elif encoding == EncodingType.YENC:
        # yEnc encoding - efficient binary encoding
        # yEnc adds 42 to each byte and escapes special characters
        result = []
        for byte in data:
            # Add 42 and wrap at 256
            encoded_byte = (byte + 42) % 256
            
            # Escape special characters: NULL, LF, CR, =
            if encoded_byte in [0x00, 0x0A, 0x0D, 0x3D]:
                result.append(0x3D)  # Escape character
                result.append((encoded_byte + 64) % 256)
            else:
                result.append(encoded_byte)
        
        # Convert to string (yEnc uses 8-bit characters)
        # For web transport, we'll use latin-1 encoding
        return bytes(result).decode('latin-1')
    else:
        raise ValueError(f"Unsupported encoding: {encoding}")

def get_encoding_overhead(encoding: EncodingType) -> float:
    """Get the approximate size overhead for each encoding"""
    overheads = {
        EncodingType.BASE64: 1.33,    # 4/3 overhead
        EncodingType.HEX: 2.0,         # 2x overhead
        EncodingType.BASE32: 1.6,      # 8/5 overhead
        EncodingType.BASE85: 1.25,     # 5/4 overhead
        EncodingType.UUENCODE: 1.33,   # Similar to base64
        EncodingType.YENC: 1.02,       # Only 1-2% overhead (very efficient!)
    }
    return overheads.get(encoding, 1.33)

def get_cached_chunk_count(file_id: str, encoding: EncodingType) -> int:
    """Return the actual number of cached chunks for a given file/encoding.

    Counts files in the encoding-specific cache directory. Falls back to the
    legacy .b64 extension for base64 if present.
    """
    encoding_cache_key = f"{file_id}_{encoding.value}"
    cache_dir = os.path.join(CACHE_FOLDER, encoding_cache_key)
    if not os.path.exists(cache_dir):
        return 0

    # Primary pattern: chunks saved with .{encoding} extension
    pattern_main = os.path.join(cache_dir, f"chunk_*.{encoding.value}")
    files = glob.glob(pattern_main)

    # Backward compatibility: consider .b64 for base64 only
    if encoding == EncodingType.BASE64 and not files:
        pattern_legacy = os.path.join(cache_dir, "chunk_*.b64")
        files = glob.glob(pattern_legacy)

    return len(files)

def calculate_binary_chunk_size(target_encoded_size: int, encoding: EncodingType) -> int:
    """Calculate how much binary data to read to produce target encoded size"""
    overhead = get_encoding_overhead(encoding)
    # Calculate binary size that will produce target encoded size
    binary_size = int(target_encoded_size / overhead)
    
    # For base64/base32, ensure it's divisible by their block sizes
    if encoding == EncodingType.BASE64 or encoding == EncodingType.UUENCODE:
        # Base64 encodes 3 bytes to 4 chars, so align to 3-byte boundary
        binary_size = (binary_size // 3) * 3
    elif encoding == EncodingType.BASE32:
        # Base32 encodes 5 bytes to 8 chars, so align to 5-byte boundary
        binary_size = (binary_size // 5) * 5
    elif encoding == EncodingType.BASE85:
        # Base85 encodes 4 bytes to 5 chars, so align to 4-byte boundary
        binary_size = (binary_size // 4) * 4
    
    return binary_size

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

def process_file_full_encoding(file_id: str, encoding: EncodingType = EncodingType.BASE64, target_chunk_size: int = CHUNK_SIZE) -> bool:
    """Process entire file by encoding it completely first, then chunking the encoded data"""
    if file_id not in processed_files:
        return False
    
    file_info = processed_files[file_id]
    
    # Create cache directory for full-encoded files
    encoding_cache_key = f"{file_id}_{encoding.value}_full"
    file_cache_dir = os.path.join(CACHE_FOLDER, encoding_cache_key)
    
    # Check if already processed with this encoding in full mode
    if os.path.exists(file_cache_dir) and os.path.exists(os.path.join(file_cache_dir, f"chunk_0.{encoding.value}")):
        print(f"✅ Already cached with {encoding.value} full encoding: {file_info['filename']}")
        file_info['cache_dir'] = file_cache_dir
        return True
    
    start_time = time.time()
    file_path = file_info['file_path']
    filename = file_info['filename']
    
    try:
        print(f"🔄 Processing FULL file encoding: {filename} with {encoding.value}")
        print(f"   File size: {file_info['original_size'] / (1024*1024):.1f}MB")
        
        # Create cache directory
        os.makedirs(file_cache_dir, exist_ok=True)
        
        # First, encode the entire file
        print(f"   Step 1: Encoding entire file...")
        encode_start = time.time()
        
        with open(file_path, 'rb') as f:
            file_data = f.read()
        
        # Encode entire file at once
        encoded_data = encode_data(file_data, encoding)
        
        encode_time = time.time() - encode_start
        print(f"   Encoding completed in {encode_time:.1f}s")
        print(f"   Encoded size: {len(encoded_data) / (1024*1024):.1f}MB")
        
        # Now chunk the encoded data
        print(f"   Step 2: Chunking encoded data into {target_chunk_size / 1024:.1f}KB chunks...")
        
        chunk_index = 0
        total_encoded_size = len(encoded_data)
        
        for i in range(0, total_encoded_size, target_chunk_size):
            chunk = encoded_data[i:i + target_chunk_size]
            
            # Save chunk to cache file
            chunk_file = os.path.join(file_cache_dir, f"chunk_{chunk_index}.{encoding.value}")
            
            if encoding == EncodingType.YENC:
                with open(chunk_file, 'wb') as cf:
                    cf.write(chunk.encode('latin-1'))
            else:
                with open(chunk_file, 'w') as cf:
                    cf.write(chunk)
            
            chunk_index += 1
        
        # Update file info
        file_info['cache_dir'] = file_cache_dir
        file_info['cached_chunks'] = chunk_index
        file_info[f'encoded_size_{encoding.value}_full'] = total_encoded_size
        file_info['total_chunks'] = chunk_index
        file_info[f'is_processed_{encoding.value}_full'] = True
        
        process_time = time.time() - start_time
        print(f"✅ Full encoding complete: {filename}")
        print(f"   Total time: {process_time:.1f}s")
        print(f"   Chunks created: {chunk_index}")
        print(f"   Encoded size: {total_encoded_size / (1024*1024):.1f}MB")
        
        return True
        
    except Exception as e:
        print(f"❌ Error processing file with full encoding {filename}: {str(e)}")
        print(f"   Traceback: {traceback.format_exc()}")
        return False

def process_file_on_demand(file_id: str, encoding: EncodingType = EncodingType.BASE64, target_chunk_size: int = CHUNK_SIZE) -> bool:
    """Process a file into encoded chunks on first request"""
    if file_id not in processed_files:
        return False
    
    file_info = processed_files[file_id]
    
    # Create encoding-specific cache directory
    encoding_cache_key = f"{file_id}_{encoding.value}"
    file_cache_dir = os.path.join(CACHE_FOLDER, encoding_cache_key)
    
    # Check if already processed with this encoding
    if os.path.exists(file_cache_dir) and os.path.exists(os.path.join(file_cache_dir, f"chunk_0.{encoding.value}")):
        print(f"✅ Already cached with {encoding.value} encoding: {file_info['filename']}")
        file_info['cache_dir'] = file_cache_dir
        return True
    
    start_time = time.time()
    file_path = file_info['file_path']
    filename = file_info['filename']
    
    try:
        print(f"🔄 Processing file on-demand: {filename} with {encoding.value} encoding")
        print(f"   File size: {file_info['original_size'] / (1024*1024):.1f}MB")
        
        # Create cache directory for this file + encoding
        os.makedirs(file_cache_dir, exist_ok=True)
        
        # Calculate optimal binary chunk size for target encoded chunk size
        binary_chunk_size = calculate_binary_chunk_size(target_chunk_size, encoding)
        
        print(f"   Target encoded chunk size: {target_chunk_size / 1024:.1f}KB")
        print(f"   Binary chunk size for {encoding.value}: {binary_chunk_size / 1024:.1f}KB")
        
        # Process file in chunks and save to cache
        total_encoded_size = 0
        chunk_index = 0
        last_log_time = time.time()
        bytes_processed = 0
        
        with open(file_path, 'rb') as f:
            while True:
                # Read optimal amount of binary data for target encoded size
                chunk_data = f.read(binary_chunk_size)
                if not chunk_data:
                    break
                
                bytes_processed += len(chunk_data)
                
                # Encode using selected encoding
                encoded_chunk = encode_data(chunk_data, encoding)
                
                # Save chunk to cache file with encoding extension
                chunk_file = os.path.join(file_cache_dir, f"chunk_{chunk_index}.{encoding.value}")
                # For yEnc and other binary-safe encodings, write as binary
                if encoding == EncodingType.YENC:
                    with open(chunk_file, 'wb') as cf:
                        cf.write(encoded_chunk.encode('latin-1'))
                else:
                    with open(chunk_file, 'w') as cf:
                        cf.write(encoded_chunk)
                
                total_encoded_size += len(encoded_chunk)
                chunk_index += 1
                
                # Log progress every 2 seconds
                current_time = time.time()
                if current_time - last_log_time > 2:
                    elapsed = current_time - start_time
                    speed = bytes_processed / (1024 * 1024 * elapsed)  # MB/s
                    print(f"   Progress: {bytes_processed / (1024*1024):.1f}MB processed, "
                          f"{chunk_index} chunks created, {speed:.1f}MB/s")
                    last_log_time = current_time
        
        # Update file info with actual values for this encoding
        file_info['cache_dir'] = file_cache_dir
        file_info['cached_chunks'] = chunk_index
        file_info[f'encoded_size_{encoding.value}'] = total_encoded_size
        file_info['total_chunks'] = chunk_index
        # Don't mark as globally processed - each encoding is separate
        file_info[f'is_processed_{encoding.value}'] = True
        
        process_time = time.time() - start_time
        print(f"✅ On-demand processing complete: {filename}")
        print(f"   Total time: {process_time:.1f}s")
        print(f"   Chunks created: {chunk_index}")
        print(f"   Encoded size: {total_encoded_size / (1024*1024):.1f}MB")
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

def load_chunk_from_cache(file_info: Dict, chunk_number: int, chunk_size: int, encoding: EncodingType = EncodingType.BASE64) -> str:
    """Load a specific chunk from cached encoded files"""
    # Use encoding-specific cache directory
    file_id = [k for k, v in processed_files.items() if v == file_info][0]
    encoding_cache_key = f"{file_id}_{encoding.value}"
    cache_dir = os.path.join(CACHE_FOLDER, encoding_cache_key)
    
    if not os.path.exists(cache_dir):
        raise HTTPException(status_code=500, detail=f"Cache not available for {encoding.value} encoding")
    
    # Calculate byte position
    start_pos = chunk_number * chunk_size
    end_pos = start_pos + chunk_size
    
    # Read and concatenate cached chunks as needed
    result = []
    current_pos = 0
    
    # Determine how many cached chunks exist for this encoding
    file_id = [k for k, v in processed_files.items() if v == file_info][0]
    available_chunks = get_cached_chunk_count(file_id, encoding)

    for i in range(available_chunks):
        # Look for chunk file with the correct encoding extension
        chunk_file = os.path.join(cache_dir, f"chunk_{i}.{encoding.value}")
        if not os.path.exists(chunk_file):
            # Fallback to old .b64 extension for backward compatibility
            chunk_file = os.path.join(cache_dir, f"chunk_{i}.b64")
        
        if encoding == EncodingType.YENC:
            with open(chunk_file, 'rb') as f:
                chunk_data = f.read().decode('latin-1')
        else:
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
async def get_chunk(
    file_id: str, 
    chunk_number: int, 
    chunk_size: int = Query(default=CHUNK_SIZE, ge=1024, le=10485760),
    encoding: EncodingType = Query(default=EncodingType.BASE64),
    mode: EncodingMode = Query(default=EncodingMode.CHUNK)
):
    """Get a specific chunk of the encoded file with custom chunk size and encoding"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_info = processed_files[file_id]
    
    # Determine cache key based on mode
    if mode == EncodingMode.FULL:
        encoding_cache_key = f"{file_id}_{encoding.value}_full"
    else:
        encoding_cache_key = f"{file_id}_{encoding.value}"
    
    cache_dir = os.path.join(CACHE_FOLDER, encoding_cache_key)
    
    # Process file on-demand if not already processed
    if not os.path.exists(cache_dir) or not any(os.path.exists(os.path.join(cache_dir, f"chunk_0.{encoding.value}")) for _ in [None]):
        print(f"📊 Processing {file_info['filename']} with {encoding.value} encoding (mode: {mode.value})...")
        file_info['cache_dir'] = cache_dir
        
        # Use appropriate processing function based on mode
        if mode == EncodingMode.FULL:
            if not process_file_full_encoding(file_id, encoding, chunk_size):
                raise HTTPException(status_code=500, detail="Failed to process file with full encoding")
        else:
            if not process_file_on_demand(file_id, encoding, chunk_size):
                raise HTTPException(status_code=500, detail="Failed to process file")
        
        # Refresh file_info after processing
        file_info = processed_files[file_id]
    
    # Get actual chunk count from cached files
    # For full mode, we need to check the full-mode cache
    if mode == EncodingMode.FULL:
        total_chunks_custom = len(glob.glob(os.path.join(cache_dir, f"chunk_*.{encoding.value}")))
    else:
        total_chunks_custom = get_cached_chunk_count(file_id, encoding)
    if total_chunks_custom == 0:
        # Estimate if not cached yet
        encoding_overhead = get_encoding_overhead(encoding)
        estimated_size = file_info['original_size'] * encoding_overhead
        total_chunks_custom = math.ceil(estimated_size / chunk_size)
    
    if chunk_number >= total_chunks_custom:
        raise HTTPException(status_code=404, detail="Chunk not found")
    
    # Load chunk from cache
    chunk_data = load_chunk_from_cache(file_info, chunk_number, chunk_size, encoding)
    
    return {
        'chunk_number': chunk_number,
        'total_chunks': total_chunks_custom,
        'data': chunk_data,
        'is_last': chunk_number == total_chunks_custom - 1,
        'chunk_size_used': chunk_size,
        'actual_chunk_size': len(chunk_data)
    }

@app.get("/file/{file_id}/info")
async def get_file_info(
    file_id: str, 
    chunk_size: int = Query(default=CHUNK_SIZE, ge=1024, le=10485760),
    encoding: EncodingType = Query(default=EncodingType.BASE64),
    mode: EncodingMode = Query(default=EncodingMode.CHUNK)
):
    """Get information about a file with custom chunk size and encoding"""
    if file_id not in processed_files:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_info = processed_files[file_id]
    
    # Determine cache key based on mode
    if mode == EncodingMode.FULL:
        encoding_cache_key = f"{file_id}_{encoding.value}_full"
    else:
        encoding_cache_key = f"{file_id}_{encoding.value}"
    
    cache_dir = os.path.join(CACHE_FOLDER, encoding_cache_key)
    has_cached = os.path.exists(cache_dir) and (
        os.path.exists(os.path.join(cache_dir, f"chunk_0.{encoding.value}")) or
        (encoding == EncodingType.BASE64 and os.path.exists(os.path.join(cache_dir, "chunk_0.b64")))
    )

    # Get actual cached chunk count
    if mode == EncodingMode.FULL and has_cached:
        total_chunks_custom = len(glob.glob(os.path.join(cache_dir, f"chunk_*.{encoding.value}")))
    elif has_cached:
        total_chunks_custom = get_cached_chunk_count(file_id, encoding)
    else:
        total_chunks_custom = 0

    # If not cached yet for this encoding, return an estimate
    if total_chunks_custom == 0:
        encoding_overhead = get_encoding_overhead(encoding)
        estimated_size = file_info['original_size'] * encoding_overhead
        total_chunks_custom = math.ceil(estimated_size / chunk_size)

    return {
        'file_id': file_id,
        'filename': file_info['filename'],
        'total_chunks': total_chunks_custom,
        'original_size': file_info['original_size'],
        'b64_size': file_info['b64_size'],
        'chunk_size_used': chunk_size,
        'default_chunks': file_info['total_chunks'],
        'default_chunk_size': CHUNK_SIZE,
        'encoding_mode': mode.value,
        # Report processed state for the requested encoding and mode
        'is_processed': bool(
            (mode == EncodingMode.FULL and file_info.get(f'is_processed_{encoding.value}_full', False)) or
            (mode == EncodingMode.CHUNK and file_info.get(f'is_processed_{encoding.value}', False)) or
            has_cached
        )
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

@app.get("/encodings")
async def get_supported_encodings():
    """Get list of supported encoding types with their characteristics"""
    encodings = []
    for enc in EncodingType:
        encodings.append({
            "value": enc.value,
            "name": enc.name,
            "overhead": get_encoding_overhead(enc),
            "description": {
                EncodingType.BASE64: "Standard base64 encoding (most compatible)",
                EncodingType.HEX: "Hexadecimal encoding (2x size, ASCII safe)",
                EncodingType.BASE32: "Base32 encoding (case-insensitive)",
                EncodingType.BASE85: "Base85/ASCII85 encoding (more efficient)",
                EncodingType.UUENCODE: "Unix-to-Unix encoding (legacy format)",
                EncodingType.YENC: "yEnc encoding (most efficient, 1-2% overhead)"
            }.get(enc, "")
        })
    return {"encodings": encodings}

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
