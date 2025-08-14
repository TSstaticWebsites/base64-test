import React, { useState, useEffect, useRef } from 'react';
import { chunkStorage } from '../utils/indexeddb';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

type EncodingType = 'base64' | 'hex' | 'base32' | 'base85' | 'uuencode' | 'yenc';

// Decoding functions for different encodings
const decodeData = (encodedString: string, encoding: EncodingType): Uint8Array => {
  switch (encoding) {
    case 'base64':
      const binaryString = atob(encodedString);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    
    case 'hex':
      // Hex decoding
      const hexBytes = new Uint8Array(encodedString.length / 2);
      for (let i = 0; i < encodedString.length; i += 2) {
        hexBytes[i / 2] = parseInt(encodedString.substr(i, 2), 16);
      }
      return hexBytes;
    
    case 'base32':
      // Simple base32 decoding (RFC 4648)
      const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = '';
      for (const char of encodedString.replace(/=/g, '')) {
        const val = base32chars.indexOf(char.toUpperCase());
        if (val !== -1) {
          bits += val.toString(2).padStart(5, '0');
        }
      }
      const base32Bytes = new Uint8Array(Math.floor(bits.length / 8));
      for (let i = 0; i < base32Bytes.length; i++) {
        base32Bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
      }
      return base32Bytes;
    
    case 'base85':
      // Base85 decoding (ASCII85)
      // This is a simplified version - full implementation would be more complex
      // For now, fallback to base64
      console.warn('Base85 decoding not fully implemented, using base64 fallback');
      return decodeData(encodedString, 'base64');
    
    case 'uuencode':
      // UUencode decoding
      // For simplicity, using base64 as fallback since backend uses base64 for uuencode
      return decodeData(encodedString, 'base64');
    
    case 'yenc':
      // yEnc decoding - reverse the encoding process
      const result: number[] = [];
      // Convert string to bytes using latin-1 encoding
      const encodedBytes = new Uint8Array(encodedString.length);
      for (let i = 0; i < encodedString.length; i++) {
        encodedBytes[i] = encodedString.charCodeAt(i);
      }
      
      // Decode yEnc
      for (let i = 0; i < encodedBytes.length; i++) {
        let byte = encodedBytes[i];
        
        // Check for escape character
        if (byte === 0x3D && i + 1 < encodedBytes.length) {
          // Next byte is escaped, subtract 64
          i++;
          byte = (encodedBytes[i] - 64 + 256) % 256;
        }
        
        // Subtract 42 and wrap
        const decodedByte = (byte - 42 + 256) % 256;
        result.push(decodedByte);
      }
      
      return new Uint8Array(result);
    
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
};

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
  downloadSpeed: number; // MB/s
  browserFrozen: boolean;
  totalDataTransferred: number; // bytes
  parallelConnections: number;
}

interface DecodingState {
  isDownloading: boolean;
  isDecoding: boolean;
  isComplete: boolean;
  currentChunk: number;
  totalChunks: number;
  chunks: string[];
  error: string;
  decodedBlob: Blob | null;
  metrics: PerformanceMetrics | null;
  isIndexedDBTest: boolean;
  storedChunks: number;
  customChunkSize: number;
  parallelConnections: number;
  downloadProgress: number;
  currentSpeed: number; // MB/s realtime
  encodingMode: 'chunk' | 'full'; // New: encoding mode
  encoding: EncodingType; // Selected encoding type
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
    customChunkSize: 1024 * 1024, // Default 1MB
    parallelConnections: 1, // Default sequential
    totalChunks: 0,
    downloadProgress: 0,
    currentSpeed: 0,
    encodingMode: 'chunk', // Default to chunk mode
    encoding: 'base64' // Default encoding
  });

  const downloadStartTimeRef = useRef<number>(0);
  const decodeStartTimeRef = useRef<number>(0);
  const frozenCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const speedUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to build API query params
  const getApiParams = () => {
    return `chunk_size=${state.customChunkSize}&encoding=${state.encoding}&mode=${state.encodingMode}`;
  };

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
    setState(prev => ({ ...prev, isDownloading: true, error: '', downloadProgress: 0, currentSpeed: 0 }));
    downloadStartTimeRef.current = performance.now();
    
    try {
      // Get file info with custom chunk size
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?${getApiParams()}`);
      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }
      const fileInfoCustom = await infoResponse.json();
      
      const totalChunks = fileInfoCustom.total_chunks;
      setState(prev => ({ ...prev, totalChunks }));
      
      console.log(`🔍 MEMORY TEST: Using chunk size ${formatFileSize(state.customChunkSize)}`);
      console.log(`📊 Total chunks: ${totalChunks}, Parallel connections: ${state.parallelConnections}`);
      
      let chunks: string[];
      let totalBytesDownloaded = 0;
      const startTime = performance.now();
      
      if (state.parallelConnections > 1) {
        // Parallel download
        chunks = new Array(totalChunks).fill(null);
        let completedChunks = 0;
        
        // Speed tracking interval
        speedUpdateIntervalRef.current = setInterval(() => {
          const elapsed = (performance.now() - startTime) / 1000;
          const speed = (totalBytesDownloaded / (1024 * 1024)) / elapsed;
          const progress = (completedChunks / totalChunks) * 100;
          
          setState(prev => ({
            ...prev,
            currentSpeed: speed,
            downloadProgress: progress,
            currentChunk: completedChunks
          }));
        }, 100);
        
        // Download function for a single chunk
        const downloadChunk = async (index: number): Promise<void> => {
          const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${index}?${getApiParams()}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch chunk ${index}`);
          }
          
          const chunkData = await response.json();
          chunks[index] = chunkData.data;
          totalBytesDownloaded += chunkData.data.length;
          completedChunks++;
        };
        
        // Process chunks in parallel batches
        const batchSize = state.parallelConnections;
        for (let i = 0; i < totalChunks; i += batchSize) {
          const batch = [];
          for (let j = i; j < Math.min(i + batchSize, totalChunks); j++) {
            batch.push(downloadChunk(j));
          }
          await Promise.all(batch);
        }
        
      } else {
        // Sequential download (no delays!)
        chunks = [];
        
        // Speed tracking interval
        speedUpdateIntervalRef.current = setInterval(() => {
          const elapsed = (performance.now() - startTime) / 1000;
          const speed = (totalBytesDownloaded / (1024 * 1024)) / elapsed;
          const progress = (chunks.length / totalChunks) * 100;
          
          setState(prev => ({
            ...prev,
            currentSpeed: speed,
            downloadProgress: progress,
            currentChunk: chunks.length
          }));
        }, 100);
        
        for (let i = 0; i < totalChunks; i++) {
          const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${i}?${getApiParams()}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch chunk ${i}`);
          }
          
          const chunkData = await response.json();
          chunks.push(chunkData.data);
          totalBytesDownloaded += chunkData.data.length;
        }
      }
      
      // Clear speed interval
      if (speedUpdateIntervalRef.current) {
        clearInterval(speedUpdateIntervalRef.current);
      }
      
      const downloadTime = performance.now() - downloadStartTimeRef.current;
      const finalSpeed = (totalBytesDownloaded / (1024 * 1024)) / (downloadTime / 1000);
      
      setState(prev => ({ 
        ...prev, 
        chunks,
        isDownloading: false,
        downloadProgress: 100,
        metrics: { 
          ...prev.metrics!,
          downloadTime,
          downloadSpeed: finalSpeed,
          totalDataTransferred: totalBytesDownloaded,
          chunksPerSecond: totalChunks / (downloadTime / 1000),
          parallelConnections: state.parallelConnections
        } as PerformanceMetrics
      }));
      
    } catch (err) {
      if (speedUpdateIntervalRef.current) {
        clearInterval(speedUpdateIntervalRef.current);
      }
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
      
      // Concatenate all encoded chunks first
      console.log('🔍 PROOF: Browser is doing the real work!');
      console.log(`📊 Total chunks received: ${chunks.length}`);
      console.log(`📊 Using encoding: ${state.encoding}, mode: ${state.encodingMode}`);
      
      let bytes: Uint8Array;
      let estimatedMemoryUsage = 0;
      
      if (state.encodingMode === 'full') {
        // FULL MODE: Chunks are already encoded, just reassemble and decode once
        console.log('📦 FULL MODE: Reassembling pre-encoded chunks...');
        const concatenatedEncoded = chunks.join('');
        console.log(`📊 Total encoded size: ${concatenatedEncoded.length} characters`);
        console.log(`✅ Reassembly complete`);
        
        // Estimate memory usage
        estimatedMemoryUsage = concatenatedEncoded.length * 2; // rough estimate
        console.log(`💾 Estimated memory usage: ${(estimatedMemoryUsage / 1024 / 1024).toFixed(1)}MB`);
        
        // Decode the entire encoded string at once
        console.log(`🔧 Starting full ${state.encoding} decoding - single decode operation!`);
        bytes = decodeData(concatenatedEncoded, state.encoding);
        console.log(`✅ Decoded entire file: ${(bytes.length / 1024 / 1024).toFixed(1)}MB from ${state.encoding}!`);
      } else {
        // CHUNK MODE: Each chunk needs to be decoded individually then concatenated
        console.log('📦 CHUNK MODE: Decoding chunks individually...');
        const decodedChunks: Uint8Array[] = [];
        
        // Estimate memory usage from chunks
        const totalEncodedSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        estimatedMemoryUsage = totalEncodedSize * 2; // rough estimate
        console.log(`💾 Estimated memory usage: ${(estimatedMemoryUsage / 1024 / 1024).toFixed(1)}MB`);
        
        for (let i = 0; i < chunks.length; i++) {
          const decodedChunk = decodeData(chunks[i], state.encoding);
          decodedChunks.push(decodedChunk);
        }
        
        // Concatenate all decoded binary chunks
        const totalLength = decodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        bytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of decodedChunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        console.log(`✅ Decoded and reassembled: ${(bytes.length / 1024 / 1024).toFixed(1)}MB from ${state.encoding}!`);
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
          downloadSpeed: prev.metrics?.downloadSpeed || 0,
          browserFrozen,
          totalDataTransferred: prev.metrics?.totalDataTransferred || 0,
          parallelConnections: prev.metrics?.parallelConnections || 1
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
    setState(prev => ({ ...prev, isDownloading: true, error: '', isIndexedDBTest: true, downloadProgress: 0, currentSpeed: 0 }));
    downloadStartTimeRef.current = performance.now();
    
    try {
      console.log('🔍 INDEXEDDB TEST: Starting chunk download to IndexedDB');
      await chunkStorage.init();
      
      // First get file info with custom chunk size to know total chunks
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?${getApiParams()}`);
      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }
      const fileInfoCustom = await infoResponse.json();
      
      const totalChunks = fileInfoCustom.total_chunks;
      setState(prev => ({ ...prev, totalChunks }));
      
      console.log(`🔍 INDEXEDDB TEST: Using chunk size ${formatFileSize(state.customChunkSize)}`);
      console.log(`📊 Total chunks: ${totalChunks}, Parallel connections: ${state.parallelConnections}`);
      
      // Check if chunks already exist (using custom size as part of key)
      const cacheKey = `${fileInfo.file_id}_${state.customChunkSize}`;
      const existingChunks = await chunkStorage.getStoredChunkCount(cacheKey);
      console.log(`📊 Found ${existingChunks} existing chunks in IndexedDB`);
      
      setState(prev => ({ ...prev, storedChunks: existingChunks }));
      
      let completedChunks = existingChunks;
      let totalBytesDownloaded = 0;
      const startTime = performance.now();
      
      // Speed tracking interval
      speedUpdateIntervalRef.current = setInterval(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        const speed = (totalBytesDownloaded / (1024 * 1024)) / elapsed;
        const progress = (completedChunks / totalChunks) * 100;
        
        setState(prev => ({
          ...prev,
          currentSpeed: speed,
          downloadProgress: progress,
          currentChunk: completedChunks,
          storedChunks: completedChunks
        }));
      }, 100);
      
      if (state.parallelConnections > 1) {
        // Parallel download for IndexedDB
        const downloadAndStoreChunk = async (index: number): Promise<void> => {
          // Check if chunk already exists
          const existingChunk = await chunkStorage.getChunk(cacheKey, index);
          if (existingChunk) {
            console.log(`⚡ Chunk ${index} already in IndexedDB, skipping download`);
            completedChunks++;
            totalBytesDownloaded += existingChunk.length;
            return;
          }
          
          const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${index}?${getApiParams()}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch chunk ${index}`);
          }
          
          const chunkData = await response.json();
          totalBytesDownloaded += chunkData.data.length;
          
          // Store in IndexedDB
          await chunkStorage.storeChunk(cacheKey, index, chunkData.data);
          completedChunks++;
          console.log(`💾 Stored chunk ${index} to IndexedDB (${chunkData.data.length} chars)`);
        };
        
        // Process chunks in parallel batches
        const batchSize = state.parallelConnections;
        for (let i = 0; i < totalChunks; i += batchSize) {
          const batch = [];
          for (let j = i; j < Math.min(i + batchSize, totalChunks); j++) {
            batch.push(downloadAndStoreChunk(j));
          }
          await Promise.all(batch);
        }
        
      } else {
        // Sequential download for IndexedDB
        for (let i = 0; i < totalChunks; i++) {
          // Check if chunk already exists
          const existingChunk = await chunkStorage.getChunk(cacheKey, i);
          if (existingChunk) {
            console.log(`⚡ Chunk ${i} already in IndexedDB, skipping download`);
            completedChunks++;
            totalBytesDownloaded += existingChunk.length;
            continue;
          }
          
          const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${i}?${getApiParams()}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch chunk ${i}`);
          }
          
          const chunkData = await response.json();
          totalBytesDownloaded += chunkData.data.length;
          
          // Store in IndexedDB
          await chunkStorage.storeChunk(cacheKey, i, chunkData.data);
          completedChunks++;
          console.log(`💾 Stored chunk ${i} to IndexedDB (${chunkData.data.length} chars)`);
        }
      }
      
      // Clear speed interval
      if (speedUpdateIntervalRef.current) {
        clearInterval(speedUpdateIntervalRef.current);
      }
      
      const downloadTime = performance.now() - downloadStartTimeRef.current;
      const finalSpeed = (totalBytesDownloaded / (1024 * 1024)) / (downloadTime / 1000);
      const dbSize = await chunkStorage.getDatabaseSize();
      
      console.log(`✅ All chunks stored in IndexedDB! DB size: ${(dbSize / 1024 / 1024).toFixed(1)}MB`);
      
      setState(prev => ({ 
        ...prev, 
        isDownloading: false,
        downloadProgress: 100,
        storedChunks: completedChunks,
        metrics: { 
          ...prev.metrics!,
          downloadTime,
          downloadSpeed: finalSpeed,
          totalDataTransferred: totalBytesDownloaded,
          chunksPerSecond: totalChunks / (downloadTime / 1000),
          parallelConnections: state.parallelConnections
        } as PerformanceMetrics
      }));
      
    } catch (err) {
      if (speedUpdateIntervalRef.current) {
        clearInterval(speedUpdateIntervalRef.current);
      }
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
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?${getApiParams()}`);
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
          downloadSpeed: prev.metrics?.downloadSpeed || 0,
          browserFrozen,
          totalDataTransferred: prev.metrics?.totalDataTransferred || 0,
          parallelConnections: prev.metrics?.parallelConnections || 1
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
    // Reset IndexedDB-specific state when starting memory test
    setState(prev => ({ ...prev, storedChunks: 0, isIndexedDBTest: false }));
    await downloadChunks();
  };

  const startIndexedDBProcessing = async () => {
    // Reset state when starting IndexedDB test
    setState(prev => ({ ...prev, storedChunks: 0, isIndexedDBTest: true }));
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
    // Use totalChunks from state which was set during download
    if (state.totalChunks > 0 && state.storedChunks === state.totalChunks && state.isIndexedDBTest && !state.isDecoding && !state.isComplete && !state.isDownloading) {
      decodeFromIndexedDB();
    }
  }, [state.storedChunks, state.totalChunks, state.isIndexedDBTest, state.isDecoding, state.isComplete, state.isDownloading]);

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
            <label htmlFor="encodingMode" style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: 'var(--text-secondary)' }}>
              Encoding Mode:
            </label>
            <select
              id="encodingMode"
              value={state.encodingMode}
              onChange={(e) => setState(prev => ({ ...prev, encodingMode: e.target.value as 'chunk' | 'full' }))}
              style={{
                padding: '8px 12px',
                marginBottom: '16px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                width: '250px'
              }}
            >
              <option value="chunk">Chunk Mode (encode each chunk)</option>
              <option value="full">Full Mode (encode entire file)</option>
            </select>
            
            <label htmlFor="encoding" style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: 'var(--text-secondary)' }}>
              Encoding Algorithm:
            </label>
            <select
              id="encoding"
              value={state.encoding}
              onChange={(e) => setState(prev => ({ ...prev, encoding: e.target.value as EncodingType }))}
              style={{
                padding: '8px 12px',
                marginBottom: '16px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                width: '250px'
              }}
            >
              <option value="base64">Base64 (Standard, 33% overhead)</option>
              <option value="hex">Hexadecimal (2x size)</option>
              <option value="base32">Base32 (60% overhead)</option>
              <option value="base85">Base85 (25% overhead)</option>
              <option value="uuencode">UUencode (33% overhead)</option>
              <option value="yenc">yEnc (Most efficient, 1-2% overhead)</option>
            </select>
            
            <label htmlFor="parallelConnections" style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: 'var(--text-secondary)' }}>
              Download Mode:
            </label>
            <select
              id="parallelConnections"
              value={state.parallelConnections}
              onChange={(e) => setState(prev => ({ ...prev, parallelConnections: parseInt(e.target.value) }))}
              style={{
                padding: '8px 12px',
                marginBottom: '16px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                width: '250px'
              }}
            >
              <option value={1}>Sequential (1 connection)</option>
              <option value={2}>Parallel (2 connections)</option>
              <option value={4}>Parallel (4 connections)</option>
              <option value={6}>Parallel (6 connections)</option>
              <option value={8}>Parallel (8 connections)</option>
            </select>
            
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
            {state.parallelConnections > 1 && ` (${state.parallelConnections} parallel)`}
          </h3>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${state.downloadProgress}%` }}
            />
          </div>
          <p style={{ marginTop: '12px' }}>
            Progress: {state.currentChunk}/{state.totalChunks || '?'} chunks ({state.downloadProgress.toFixed(1)}%)
          </p>
          {state.currentSpeed > 0 && (
            <p style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)', marginTop: '8px' }}>
              Speed: {state.currentSpeed.toFixed(2)} MB/s
            </p>
          )}
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
            <h3 style={{ margin: 0, color: '#064e3b' }}>✅ Processing Complete! {state.isIndexedDBTest ? '(IndexedDB)' : '(Memory)'}</h3>
          </div>
          
          <div className="performance-metrics">
            <h4 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>
              📊 Performance Metrics {state.isIndexedDBTest ? '- IndexedDB Test' : '- Memory Test'}
            </h4>
            <div className="metric-grid">
              <div className="metric-item">
                <div className="metric-label">Encoding</div>
                <div className="metric-value" style={{ textTransform: 'uppercase' }}>{state.encoding}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Chunk Size</div>
                <div className="metric-value">{formatFileSize(state.customChunkSize)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Total Chunks</div>
                <div className="metric-value">{state.totalChunks || Math.ceil((fileInfo.b64_size * 4/3) / state.customChunkSize)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Download Mode</div>
                <div className="metric-value">{state.metrics.parallelConnections > 1 ? `${state.metrics.parallelConnections} parallel` : 'Sequential'}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Download Time</div>
                <div className="metric-value">{(state.metrics.downloadTime / 1000).toFixed(2)}s</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Download Speed</div>
                <div className="metric-value" style={{ color: 'var(--success)', fontWeight: 'bold' }}>{state.metrics.downloadSpeed.toFixed(2)} MB/s</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Decode Time</div>
                <div className="metric-value">{(state.metrics.decodeTime / 1000).toFixed(2)}s</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Decoding Speed</div>
                <div className="metric-value">{state.metrics.decodingSpeed.toFixed(2)} MB/s</div>
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
                <p style={{ margin: 0, color: '#0c4a6e' }}>💾 Data was stored in IndexedDB during download for better memory management</p>
              </div>
            )}
          </div>

          <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <button 
              className="btn-success" 
              onClick={downloadFile}
              disabled={!state.decodedBlob}
              style={{ opacity: state.decodedBlob ? 1 : 0.5 }}
            >
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