#!/usr/bin/env python3
"""
Automated test runner for browser base64 decoding feasibility
"""

import requests
import time
import json
import os
from typing import Dict, List

API_BASE = "http://localhost:8000"

def test_file_upload_and_chunking(file_path: str) -> Dict:
    """Test file upload and measure backend performance"""
    print(f"\nTesting file: {file_path}")
    
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}
    
    file_size = os.path.getsize(file_path)
    print(f"File size: {file_size:,} bytes ({file_size/(1024*1024):.2f} MB)")
    
    # Upload file
    start_time = time.time()
    
    with open(file_path, 'rb') as f:
        files = {'file': (os.path.basename(file_path), f)}
        response = requests.post(f"{API_BASE}/upload", files=files)
    
    upload_time = time.time() - start_time
    
    if response.status_code != 200:
        return {"error": f"Upload failed: {response.text}"}
    
    file_info = response.json()
    
    # Test chunk fetching speed
    chunk_times = []
    for i in range(min(10, file_info['total_chunks'])):  # Test first 10 chunks
        chunk_start = time.time()
        chunk_response = requests.get(f"{API_BASE}/chunk/{file_info['file_id']}/{i}")
        chunk_time = time.time() - chunk_start
        chunk_times.append(chunk_time)
        
        if chunk_response.status_code != 200:
            return {"error": f"Chunk {i} fetch failed"}
    
    avg_chunk_time = sum(chunk_times) / len(chunk_times)
    estimated_download_time = avg_chunk_time * file_info['total_chunks']
    
    results = {
        "file_path": file_path,
        "file_size_mb": file_size / (1024 * 1024),
        "upload_time": upload_time,
        "total_chunks": file_info['total_chunks'],
        "b64_size_mb": file_info['b64_size'] / (1024 * 1024),
        "avg_chunk_fetch_time": avg_chunk_time,
        "estimated_download_time": estimated_download_time,
        "size_increase_ratio": file_info['b64_size'] / file_size,
        "file_id": file_info['file_id']
    }
    
    return results

def run_automated_tests():
    """Run automated tests on all test files"""
    print("=== Browser Base64 Decoding Feasibility Test ===\n")
    
    # Check if backend is running
    try:
        response = requests.get(f"{API_BASE}/health")
        if response.status_code != 200:
            print("❌ Backend not responding. Start with: docker-compose up")
            return
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to backend. Start with: docker-compose up")
        return
    
    print("✅ Backend is running")
    
    # Test files (if they exist)
    test_files = [
        "test_files/test_1mb.txt",
        "test_files/test_5mb.txt", 
        "test_files/test_10mb.txt",
        "test_files/test_25mb.txt",
        "test_files/test_50mb.txt",
    ]
    
    results = []
    
    for file_path in test_files:
        if os.path.exists(file_path):
            result = test_file_upload_and_chunking(file_path)
            results.append(result)
            
            if "error" not in result:
                print(f"✅ {os.path.basename(file_path)}: "
                      f"{result['file_size_mb']:.1f}MB → "
                      f"{result['b64_size_mb']:.1f}MB base64 "
                      f"({result['total_chunks']} chunks)")
                print(f"   Estimated download time: {result['estimated_download_time']:.2f}s")
            else:
                print(f"❌ {os.path.basename(file_path)}: {result['error']}")
        else:
            print(f"⚠️  {file_path} not found (run generate_test_files.py first)")
    
    # Generate recommendations
    print("\n=== Feasibility Analysis ===")
    
    largest_successful = None
    for result in results:
        if "error" not in result:
            if largest_successful is None or result['file_size_mb'] > largest_successful['file_size_mb']:
                largest_successful = result
    
    if largest_successful:
        size_mb = largest_successful['file_size_mb']
        download_time = largest_successful['estimated_download_time']
        
        print(f"✅ Backend can handle up to {size_mb:.1f}MB files")
        print(f"   Estimated browser download time: {download_time:.1f}s")
        
        # Recommendations based on size
        if size_mb >= 100:
            print("🚀 Excellent: Should handle very large files")
        elif size_mb >= 50:
            print("✅ Good: Should handle most use cases")
        elif size_mb >= 10:
            print("⚠️  Moderate: May need optimization for larger files")
        else:
            print("❌ Limited: Consider optimizations")
            
        # Memory usage warning
        memory_mb = largest_successful['b64_size_mb'] * 2  # Rough estimate
        print(f"⚠️  Estimated browser memory usage: ~{memory_mb:.1f}MB")
        
        if memory_mb > 500:
            print("🔧 Recommendation: Consider WebAssembly for better memory efficiency")
    
    print(f"\n📊 Test Results Summary:")
    print(f"Backend API: {API_BASE}")
    print(f"Frontend: http://localhost:3000")
    print(f"Use frontend to test actual browser decoding performance")
    
    # Save results
    with open('test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    print(f"📁 Detailed results saved to: test_results.json")

if __name__ == "__main__":
    run_automated_tests()