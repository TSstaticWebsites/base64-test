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
    <div>
      <div className="card">
        <h2 style={{ marginBottom: '16px' }}>📄 {fileInfo.filename}</h2>
        <div className="metric-grid">
          <div className="metric-item">
            <div className="metric-label">Original Size</div>
            <div className="metric-value">{formatFileSize(fileInfo.original_size)}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Base64 Size</div>
            <div className="metric-value">{formatFileSize(fileInfo.b64_size)}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Total Chunks</div>
            <div className="metric-value">{fileInfo.total_chunks}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Default Chunk Size</div>
            <div className="metric-value">{formatFileSize((fileInfo.chunk_size || 1024 * 1024))}</div>
          </div>
        </div>
      </div>

      {!state.isDownloading && !state.isDecoding && !state.isComplete && (
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>⚙️ Test Configuration</h3>
          
          <div style={{ marginBottom: '24px' }}>
            <label htmlFor="chunkSize" style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: 'var(--text-secondary)' }}>
              Custom Chunk Size:
            </label>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
              <input
                id="chunkSize"
                type="number"
                value={state.customChunkSize}
                onChange={(e) => setState(prev => ({ ...prev, customChunkSize: parseInt(e.target.value) || 1024 }))}
                min="1024"
                max="10485760"
                step="1024"
                style={{ 
                  padding: '8px 12px', 
                  width: '150px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '14px'
                }}
              />
              <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                = {formatFileSize(state.customChunkSize)}
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 64 * 1024 }))}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                64KB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 256 * 1024 }))}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                256KB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 1024 * 1024 }))}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                1MB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 4 * 1024 * 1024 }))}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                4MB
              </button>
              <button 
                onClick={() => setState(prev => ({ ...prev, customChunkSize: 10 * 1024 * 1024 }))}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                10MB
              </button>
            </div>
            
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              📦 Estimated chunks: <strong style={{ color: 'var(--text-primary)' }}>{Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={startProcessing}>
              🧪 Start Memory Test
            </button>
            <button className="btn-secondary" onClick={startIndexedDBProcessing}>
              💾 Start IndexedDB Test
            </button>
          </div>
        </div>
      )}

      {state.isDownloading && (
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>
            {state.isIndexedDBTest ? '💾 Downloading to IndexedDB...' : '🧪 Downloading to Memory...'}
          </h3>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${(state.currentChunk / Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)) * 100}%` }}
            />
          </div>
          <div style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>
            <p>📦 Progress: <strong>{state.currentChunk}</strong> / <strong>{Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)}</strong> chunks</p>
            <p>📊 Chunk size: <strong>{formatFileSize(state.customChunkSize)}</strong></p>
            {state.isIndexedDBTest && (
              <p>💾 Stored: <strong>{state.storedChunks}</strong> chunks in IndexedDB</p>
            )}
          </div>
        </div>
      )}

      {state.isDecoding && (
        <div className="card">
          <h3 style={{ marginBottom: '16px' }}>
            {state.isIndexedDBTest ? '🔄 Decoding from IndexedDB...' : '🔄 Decoding from Memory...'}
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
            {state.isIndexedDBTest ? 'Loading chunks from IndexedDB and converting to binary...' : 'Converting base64 to binary data...'}
          </p>
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
        <div className="card">
          <div className="success" style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>✅ Processing Complete! {state.isIndexedDBTest ? '(IndexedDB)' : '(Memory)'}</h3>
          </div>
          
          <div className="performance-metrics">
            <h4 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>
              📊 Performance Metrics {state.isIndexedDBTest ? '- IndexedDB Test' : '- Memory Test'}
            </h4>
            <div className="metric-grid">
              <div className="metric-item">
                <div className="metric-label">Chunk Size</div>
                <div className="metric-value">{formatFileSize(state.customChunkSize)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Total Chunks</div>
                <div className="metric-value">{Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Download Time</div>
                <div className="metric-value">{(state.metrics.downloadTime / 1000).toFixed(2)}s</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Decode Time</div>
                <div className="metric-value">{(state.metrics.decodeTime / 1000).toFixed(2)}s</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Total Time</div>
                <div className="metric-value">{(state.metrics.totalTime / 1000).toFixed(2)}s</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Chunks/Second</div>
                <div className="metric-value">{state.metrics.chunksPerSecond.toFixed(1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Decoding Speed</div>
                <div className="metric-value">{state.metrics.decodingSpeed.toFixed(2)} MB/s</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Memory Usage</div>
                <div className="metric-value">{formatFileSize(state.metrics.memoryUsage)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Browser Frozen</div>
                <div className="metric-value">{state.metrics.browserFrozen ? '❌ Yes' : '✅ No'}</div>
              </div>
            </div>
            {state.isIndexedDBTest && (
              <div className="info" style={{ marginTop: '16px' }}>
                <p style={{ margin: 0 }}>💾 Data was stored in IndexedDB during download for better memory management</p>
              </div>
            )}
          </div>

          <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <button className="btn-success" onClick={downloadFile}>
              💾 Download Decoded File
            </button>
            <button onClick={onReset}>
              🔄 Test Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChunkedDecoder;