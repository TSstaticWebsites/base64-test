#!/usr/bin/env python3
"""
Generate test files of various sizes for browser base64 decoding tests
"""

import os
import random
import string

def generate_random_content(size_bytes):
    """Generate random text content of specified size"""
    content = ''
    chunk_size = 1024  # Generate in 1KB chunks
    
    while len(content) < size_bytes:
        remaining = size_bytes - len(content)
        current_chunk_size = min(chunk_size, remaining)
        
        # Generate random text chunk
        chunk = ''.join(random.choices(
            string.ascii_letters + string.digits + ' \n', 
            k=current_chunk_size
        ))
        content += chunk
    
    return content[:size_bytes]

def create_test_files():
    """Create test files of various sizes"""
    test_files = [
        ('test_1mb.txt', 1 * 1024 * 1024),      # 1MB
        ('test_5mb.txt', 5 * 1024 * 1024),      # 5MB
        ('test_10mb.txt', 10 * 1024 * 1024),    # 10MB
        ('test_25mb.txt', 25 * 1024 * 1024),    # 25MB
        ('test_50mb.txt', 50 * 1024 * 1024),    # 50MB
        ('test_100mb.txt', 100 * 1024 * 1024),  # 100MB
    ]
    
    # Create test_files directory
    os.makedirs('test_files', exist_ok=True)
    
    for filename, size in test_files:
        filepath = os.path.join('test_files', filename)
        
        print(f"Generating {filename} ({size // (1024*1024)}MB)...")
        
        content = generate_random_content(size)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        actual_size = os.path.getsize(filepath)
        print(f"Created {filename}: {actual_size:,} bytes")
    
    print(f"\nTest files created in 'test_files' directory:")
    print("- Use these files to test browser limits")
    print("- Start with smaller files and work your way up")
    print("- Monitor browser performance and memory usage")

if __name__ == "__main__":
    create_test_files()