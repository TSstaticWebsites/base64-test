import React, { useState, useEffect, useRef } from 'react';
import { chunkStorage } from '../utils/indexeddb';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface FileInfo {
  file_id: string;
  filename: string;
  total_chunks: number;
  original_size: number;
  b64_size: number;
  chunk_size?: number;
}

interface ChunkedDecoderProps {
  fileInfo: FileInfo;
  onReset: () => void;
}

interface PerformanceMetrics {
  downloadTime: number;
  decodeTime: number;
  totalTime: number;
  memoryUsage: number;
  chunksPerSecond: number;
  decodingSpeed: number; // MB/s
  browserFrozen: boolean;
}

interface DecodingState {
  isDownloading: boolean;
  isDecoding: boolean;
  isComplete: boolean;
  currentChunk: number;
  chunks: string[];
  error: string;
  decodedBlob: Blob | null;
  metrics: PerformanceMetrics | null;
  isIndexedDBTest: boolean;
  storedChunks: number;
  customChunkSize: number;
}

const ChunkedDecoder: React.FC<ChunkedDecoderProps> = ({ fileInfo, onReset }) => {
  const [state, setState] = useState<DecodingState>({
    isDownloading: false,
    isDecoding: false,
    isComplete: false,
    currentChunk: 0,
    chunks: [],
    error: '',
    decodedBlob: null,
    metrics: null,
    isIndexedDBTest: false,
    storedChunks: 0,
    customChunkSize: 1024 * 1024 // Default 1MB
  });

  const downloadStartTimeRef = useRef<number>(0);
  const decodeStartTimeRef = useRef<number>(0);
  const frozenCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const checkIfBrowserFrozen = (): Promise<boolean> => {
    return new Promise((resolve) => {
      const start = performance.now();
      setTimeout(() => {
        const delay = performance.now() - start;
        // If setTimeout takes more than 100ms, browser might be frozen/busy
        resolve(delay > 100);
      }, 0);
    });
  };

  const downloadChunks = async () => {
    setState(prev => ({ ...prev, isDownloading: true, error: '' }));
    downloadStartTimeRef.current = performance.now();
    
    try {
      // First get file info with custom chunk size to know total chunks
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?chunk_size=${state.customChunkSize}`);
      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }
      const fileInfoCustom = await infoResponse.json();
      
      console.log(`🔍 MEMORY TEST: Using chunk size ${formatFileSize(state.customChunkSize)}`);
      console.log(`📊 Total chunks with custom size: ${fileInfoCustom.total_chunks} (vs ${fileInfo.total_chunks} default)`);
      
      const chunks: string[] = [];
      
      for (let i = 0; i < fileInfoCustom.total_chunks; i++) {
        setState(prev => ({ ...prev, currentChunk: i + 1 }));
        
        const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${i}?chunk_size=${state.customChunkSize}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch chunk ${i}`);
        }
        
        const chunkData = await response.json();
        chunks.push(chunkData.data);
        
        // Small delay to prevent overwhelming the browser
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }
      
      const downloadTime = performance.now() - downloadStartTimeRef.current;
      
      setState(prev => ({ 
        ...prev, 
        chunks,
        isDownloading: false,
        metrics: { 
          ...prev.metrics!,
          downloadTime,
          chunksPerSecond: fileInfoCustom.total_chunks / (downloadTime / 1000)
        } as PerformanceMetrics
      }));
      
    } catch (err) {
      setState(prev => ({ 
        ...prev, 
        isDownloading: false, 
        error: err instanceof Error ? err.message : 'Download failed' 
      }));
    }
  };

  const decodeBase64Chunks = async (chunks: string[]) => {
    setState(prev => ({ ...prev, isDecoding: true, error: '' }));
    decodeStartTimeRef.current = performance.now();
    
    try {
      // Start browser freeze detection
      let browserFrozen = false;
      frozenCheckIntervalRef.current = setInterval(async () => {
        browserFrozen = await checkIfBrowserFrozen();
      }, 250);
      
      // Method 1: Concatenate all base64 chunks first, then decode
      console.log('🔍 PROOF: Browser is doing the real work!');
      console.log(`📊 Total chunks received: ${chunks.length}`);
      console.log(`📊 Total base64 size: ${chunks.join('').length} characters`);
      
      const concatenatedBase64 = chunks.join('');
      console.log('✅ Base64 concatenation complete');
      
      // Check memory usage (approximation)
      const estimatedMemoryUsage = concatenatedBase64.length * 2; // rough estimate
      console.log(`💾 Estimated memory usage: ${(estimatedMemoryUsage / 1024 / 1024).toFixed(1)}MB`);
      
      // Decode the entire base64 string - THIS IS THE HEAVY WORK!
      console.log('🔧 Starting atob() decoding - this will stress the browser!');
      const binaryString = atob(concatenatedBase64);
      console.log(`✅ Browser atob() decoded ${(binaryString.length / 1024 / 1024).toFixed(1)}MB of binary data!`);
      
      // Convert to Uint8Array
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes]);
      
      if (frozenCheckIntervalRef.current) {
        clearInterval(frozenCheckIntervalRef.current);
      }
      
      const decodeTime = performance.now() - decodeStartTimeRef.current;
      const totalTime = decodeTime + (state.metrics?.downloadTime || 0);
      
      setState(prev => ({ 
        ...prev,
        isDecoding: false,
        isComplete: true,
        decodedBlob: blob,
        metrics: {
          downloadTime: prev.metrics?.downloadTime || 0,
          decodeTime,
          totalTime,
          memoryUsage: estimatedMemoryUsage,
          chunksPerSecond: prev.metrics?.chunksPerSecond || 0,
          decodingSpeed: (fileInfo.original_size / 1024 / 1024) / (decodeTime / 1000),
          browserFrozen
        }
      }));
      
    } catch (err) {
      if (frozenCheckIntervalRef.current) {
        clearInterval(frozenCheckIntervalRef.current);
      }
      
      setState(prev => ({ 
        ...prev, 
        isDecoding: false, 
        error: err instanceof Error ? err.message : 'Decoding failed' 
      }));
    }
  };

  const downloadChunksToIndexedDB = async () => {
    setState(prev => ({ ...prev, isDownloading: true, error: '', isIndexedDBTest: true }));
    downloadStartTimeRef.current = performance.now();
    
    try {
      console.log('🔍 INDEXEDDB TEST: Starting chunk download to IndexedDB');
      await chunkStorage.init();
      
      // First get file info with custom chunk size to know total chunks
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?chunk_size=${state.customChunkSize}`);
      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }
      const fileInfoCustom = await infoResponse.json();
      
      console.log(`🔍 INDEXEDDB TEST: Using chunk size ${formatFileSize(state.customChunkSize)}`);
      console.log(`📊 Total chunks with custom size: ${fileInfoCustom.total_chunks} (vs ${fileInfo.total_chunks} default)`);
      
      // Check if chunks already exist (using custom size as part of key)
      const cacheKey = `${fileInfo.file_id}_${state.customChunkSize}`;
      const existingChunks = await chunkStorage.getStoredChunkCount(cacheKey);
      console.log(`📊 Found ${existingChunks} existing chunks in IndexedDB`);
      
      setState(prev => ({ ...prev, storedChunks: existingChunks }));
      
      for (let i = 0; i < fileInfoCustom.total_chunks; i++) {
        setState(prev => ({ ...prev, currentChunk: i + 1 }));
        
        // Check if chunk already exists
        const existingChunk = await chunkStorage.getChunk(cacheKey, i);
        if (existingChunk) {
          console.log(`⚡ Chunk ${i} already in IndexedDB, skipping download`);
          continue;
        }
        
        const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${i}?chunk_size=${state.customChunkSize}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch chunk ${i}`);
        }
        
        const chunkData = await response.json();
        
        // Store in IndexedDB with cache key including chunk size
        await chunkStorage.storeChunk(cacheKey, i, chunkData.data);
        console.log(`💾 Stored chunk ${i} to IndexedDB (${chunkData.data.length} chars)`);
        
        const updatedCount = await chunkStorage.getStoredChunkCount(cacheKey);
        setState(prev => ({ ...prev, storedChunks: updatedCount }));
        
        // Small delay to prevent overwhelming the browser
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }
      
      const downloadTime = performance.now() - downloadStartTimeRef.current;
      const dbSize = await chunkStorage.getDatabaseSize();
      
      console.log(`✅ All chunks stored in IndexedDB! DB size: ${(dbSize / 1024 / 1024).toFixed(1)}MB`);
      
      setState(prev => ({ 
        ...prev, 
        isDownloading: false,
        metrics: { 
          ...prev.metrics!,
          downloadTime,
          chunksPerSecond: fileInfoCustom.total_chunks / (downloadTime / 1000)
        } as PerformanceMetrics
      }));
      
    } catch (err) {
      setState(prev => ({ 
        ...prev, 
        isDownloading: false, 
        error: err instanceof Error ? err.message : 'IndexedDB download failed' 
      }));
    }
  };

  const decodeFromIndexedDB = async () => {
    setState(prev => ({ ...prev, isDecoding: true, error: '' }));
    decodeStartTimeRef.current = performance.now();
    
    try {
      console.log('🔍 INDEXEDDB TEST: Starting decode from IndexedDB');
      
      // Start browser freeze detection
      let browserFrozen = false;
      frozenCheckIntervalRef.current = setInterval(async () => {
        browserFrozen = await checkIfBrowserFrozen();
      }, 250);
      
      // Get file info with custom chunk size to know expected chunk count
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?chunk_size=${state.customChunkSize}`);
      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }
      const fileInfoCustom = await infoResponse.json();
      
      // Get all chunks from IndexedDB using cache key
      console.log('📦 Loading chunks from IndexedDB...');
      const cacheKey = `${fileInfo.file_id}_${state.customChunkSize}`;
      const chunks = await chunkStorage.getAllChunksForFile(cacheKey);
      console.log(`✅ Loaded ${chunks.length} chunks from IndexedDB (expected ${fileInfoCustom.total_chunks})`);
      
      if (chunks.length !== fileInfoCustom.total_chunks) {
        throw new Error(`Chunk count mismatch: expected ${fileInfoCustom.total_chunks}, got ${chunks.length}`);
      }
      
      // Same decoding process as memory version
      console.log('🔧 Concatenating base64 chunks from IndexedDB...');
      const concatenatedBase64 = chunks.join('');
      console.log(`💾 Total base64 size from IndexedDB: ${concatenatedBase64.length} characters`);
      
      const estimatedMemoryUsage = concatenatedBase64.length * 2;
      console.log(`💾 Estimated memory usage: ${(estimatedMemoryUsage / 1024 / 1024).toFixed(1)}MB`);
      
      console.log('🔧 Starting atob() decoding from IndexedDB data...');
      const binaryString = atob(concatenatedBase64);
      console.log(`✅ Decoded ${(binaryString.length / 1024 / 1024).toFixed(1)}MB from IndexedDB!`);
      
      // Convert to Uint8Array
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes]);
      
      if (frozenCheckIntervalRef.current) {
        clearInterval(frozenCheckIntervalRef.current);
      }
      
      const decodeTime = performance.now() - decodeStartTimeRef.current;
      const totalTime = decodeTime + (state.metrics?.downloadTime || 0);
      
      setState(prev => ({ 
        ...prev,
        isDecoding: false,
        isComplete: true,
        decodedBlob: blob,
        chunks: [], // Clear memory chunks since we used IndexedDB
        metrics: {
          downloadTime: prev.metrics?.downloadTime || 0,
          decodeTime,
          totalTime,
          memoryUsage: estimatedMemoryUsage,
          chunksPerSecond: prev.metrics?.chunksPerSecond || 0,
          decodingSpeed: (fileInfo.original_size / 1024 / 1024) / (decodeTime / 1000),
          browserFrozen
        }
      }));
      
    } catch (err) {
      if (frozenCheckIntervalRef.current) {
        clearInterval(frozenCheckIntervalRef.current);
      }
      
      setState(prev => ({ 
        ...prev, 
        isDecoding: false, 
        error: err instanceof Error ? err.message : 'IndexedDB decoding failed' 
      }));
    }
  };

  const startProcessing = async () => {
    await downloadChunks();
  };

  const startIndexedDBProcessing = async () => {
    await downloadChunksToIndexedDB();
  };

  const downloadFile = () => {
    if (!state.decodedBlob) return;
    
    console.log('🔍 PROOF: Creating download from browser-decoded blob');
    console.log('📊 Blob size:', state.decodedBlob.size, 'bytes');
    console.log('📊 Blob type:', state.decodedBlob.type);
    console.log('📊 This uses NO network - purely browser memory!');
    
    const url = URL.createObjectURL(state.decodedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileInfo.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Auto-start decoding when chunks are downloaded
  useEffect(() => {
    if (state.chunks.length === fileInfo.total_chunks && !state.isDecoding && !state.isComplete && !state.isIndexedDBTest) {
      decodeBase64Chunks(state.chunks);
    }
  }, [state.chunks, fileInfo.total_chunks, state.isDecoding, state.isComplete, state.isIndexedDBTest]);

  // Auto-start IndexedDB decoding when all chunks are stored
  useEffect(() => {
    const expectedChunks = Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize);
    if (state.storedChunks === expectedChunks && state.isIndexedDBTest && !state.isDecoding && !state.isComplete) {
      decodeFromIndexedDB();
    }
  }, [state.storedChunks, fileInfo.b64_size, state.customChunkSize, state.isIndexedDBTest, state.isDecoding, state.isComplete]);

  return (
    <div className="stats">
      <h2>File Processing: {fileInfo.filename}</h2>
      
      <div className="stats">
        <h3>File Information</h3>
        <p>Original Size: {formatFileSize(fileInfo.original_size)}</p>
        <p>Base64 Size: {formatFileSize(fileInfo.b64_size)}</p>
        <p>Total Chunks: {fileInfo.total_chunks}</p>
        <p>Default Chunk Size: {formatFileSize((fileInfo.chunk_size || 1024 * 1024))}</p>
      </div>

      {!state.isDownloading && !state.isDecoding && !state.isComplete && (
        <div className="stats">
          <h3>Test Configuration</h3>
          
          <div style={{ marginBottom: '15px' }}>
            <label htmlFor="chunkSize" style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Custom Chunk Size (bytes):
            </label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
              <input
                id="chunkSize"
                type="number"
                value={state.customChunkSize}
                onChange={(e) => setState(prev => ({ ...prev, customChunkSize: parseInt(e.target.value) || 1024 }))}
                min="1024"
                max="10485760"
                step="1024"
                style={{ 
                  padding: '5px', 
                  width: '120px',
                  border: '1px solid #ccc',
                  borderRadius: '4px'
                }}
              />
              <span style={{ fontSize: '14px', color: '#666' }}>
                = {formatFileSize(state.customChunkSize)}
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 64 * 1024 }))}
                style={{ fontSize: '12px', padding: '3px 8px' }}
              >
                64KB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 256 * 1024 }))}
                style={{ fontSize: '12px', padding: '3px 8px' }}
              >
                256KB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 1024 * 1024 }))}
                style={{ fontSize: '12px', padding: '3px 8px' }}
              >
                1MB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 4 * 1024 * 1024 }))}
                style={{ fontSize: '12px', padding: '3px 8px' }}
              >
                4MB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 10 * 1024 * 1024 }))}
                style={{ fontSize: '12px', padding: '3px 8px' }}
              >
                10MB
              </button>
            </div>
            
            <p style={{ fontSize: '14px', color: '#666', margin: '5px 0' }}>
              Estimated chunks: {Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)}
            </p>
          </div>

          <div>
            <button onClick={startProcessing} style={{ marginRight: '10px' }}>
              Start Download & Decode Test (Memory)
            </button>
            <button onClick={startIndexedDBProcessing}>
              Start Download & Decode Test (IndexedDB)
            </button>
          </div>
        </div>
      )}

      {state.isDownloading && (
        <div className="progress-container">
          <h3>{state.isIndexedDBTest ? 'Downloading Chunks to IndexedDB...' : 'Downloading Chunks to Memory...'}</h3>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${(state.currentChunk / Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)) * 100}%` }}
            />
          </div>
          <p>{state.currentChunk} / {Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)} chunks downloaded</p>
          <p>Chunk size: {formatFileSize(state.customChunkSize)}</p>
          {state.isIndexedDBTest && (
            <p>📦 Stored in IndexedDB: {state.storedChunks} chunks</p>
          )}
        </div>
      )}

      {state.isDecoding && (
        <div className="progress-container">
          <h3>{state.isIndexedDBTest ? 'Decoding Base64 Data from IndexedDB...' : 'Decoding Base64 Data from Memory...'}</h3>
          <p>{state.isIndexedDBTest ? 'Loading chunks from IndexedDB and converting to binary...' : 'Converting base64 to binary data...'}</p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: '50%' }} />
          </div>
        </div>
      )}

      {state.error && (
        <div className="error">
          Error: {state.error}
        </div>
      )}

      {state.isComplete && state.metrics && (
        <div className="success">
          <h3>✅ Processing Complete! {state.isIndexedDBTest ? '(IndexedDB)' : '(Memory)'}</h3>
          
          <div className="performance-metrics">
            <h4>Performance Metrics {state.isIndexedDBTest ? '- IndexedDB Test' : '- Memory Test'}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <p><strong>Chunk Configuration:</strong></p>
                <p>Chunk Size: {formatFileSize(state.customChunkSize)}</p>
                <p>Total Chunks: {Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)}</p>
                <p>vs Default: {fileInfo.total_chunks} chunks</p>
              </div>
              <div>
                <p><strong>Performance:</strong></p>
                <p>Download Time: {(state.metrics.downloadTime / 1000).toFixed(2)}s</p>
                <p>Decode Time: {(state.metrics.decodeTime / 1000).toFixed(2)}s</p>
                <p>Total Time: {(state.metrics.totalTime / 1000).toFixed(2)}s</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <p>Chunks/Second: {state.metrics.chunksPerSecond.toFixed(1)}</p>
                <p>Decoding Speed: {state.metrics.decodingSpeed.toFixed(2)} MB/s</p>
              </div>
              <div>
                <p>Memory Usage: {formatFileSize(state.metrics.memoryUsage)}</p>
                <p>Browser Frozen: {state.metrics.browserFrozen ? '❌ Yes' : '✅ No'}</p>
              </div>
            </div>
            {state.isIndexedDBTest && (
              <p style={{ marginTop: '10px' }}><strong>💾 Data stored in IndexedDB during download</strong></p>
            )}
          </div>

          <div style={{ marginTop: '20px' }}>
            <button onClick={downloadFile}>
              Download Decoded File
            </button>
            <button onClick={onReset}>
              Test Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChunkedDecoder;