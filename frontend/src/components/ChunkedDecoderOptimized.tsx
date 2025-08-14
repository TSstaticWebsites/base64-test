import React, { useState, useRef, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface FileInfo {
  file_id: string;
  filename: string;
  total_chunks: number;
  original_size: number;
  b64_size: number;
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
  parallelDownloads: number;
}

interface DecodingState {
  isDownloading: boolean;
  isDecoding: boolean;
  isComplete: boolean;
  currentChunk: number;
  totalChunks: number;
  chunks: string[];
  error: string;
  metrics: PerformanceMetrics | null;
  customChunkSize: number;
  parallelConnections: number;
  downloadProgress: number; // percentage
  currentSpeed: number; // MB/s
}

interface ChunkedDecoderProps {
  fileInfo: FileInfo;
}

const ChunkedDecoderOptimized: React.FC<ChunkedDecoderProps> = ({ fileInfo }) => {
  const [state, setState] = useState<DecodingState>({
    isDownloading: false,
    isDecoding: false,
    isComplete: false,
    currentChunk: 0,
    totalChunks: 0,
    chunks: [],
    error: '',
    metrics: null,
    customChunkSize: 1024 * 1024, // 1MB default
    parallelConnections: 4, // Default parallel connections
    downloadProgress: 0,
    currentSpeed: 0
  });

  const downloadStartTimeRef = useRef<number>(0);
  const decodeStartTimeRef = useRef<number>(0);
  const frozenCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const speedUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Parallel chunk downloading
  const downloadChunksParallel = async () => {
    setState(prev => ({ ...prev, isDownloading: true, error: '', downloadProgress: 0, currentSpeed: 0 }));
    downloadStartTimeRef.current = performance.now();
    
    try {
      // Get file info with custom chunk size
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?chunk_size=${state.customChunkSize}`);
      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }
      const fileInfoCustom = await infoResponse.json();
      
      const totalChunks = fileInfoCustom.total_chunks;
      const chunks: (string | null)[] = new Array(totalChunks).fill(null);
      let completedChunks = 0;
      let totalBytesDownloaded = 0;
      const startTime = performance.now();
      
      setState(prev => ({ ...prev, totalChunks }));
      
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
      
      // Download chunks in parallel batches
      const downloadChunk = async (index: number): Promise<void> => {
        const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${index}?chunk_size=${state.customChunkSize}`);
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
      
      if (speedUpdateIntervalRef.current) {
        clearInterval(speedUpdateIntervalRef.current);
      }
      
      const downloadTime = performance.now() - downloadStartTimeRef.current;
      const finalSpeed = (totalBytesDownloaded / (1024 * 1024)) / (downloadTime / 1000);
      
      setState(prev => ({ 
        ...prev, 
        chunks: chunks as string[],
        isDownloading: false,
        downloadProgress: 100,
        metrics: { 
          downloadTime,
          downloadSpeed: finalSpeed,
          totalDataTransferred: totalBytesDownloaded,
          chunksPerSecond: totalChunks / (downloadTime / 1000),
          parallelDownloads: state.parallelConnections,
          decodeTime: 0,
          totalTime: 0,
          memoryUsage: 0,
          decodingSpeed: 0,
          browserFrozen: false
        }
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

  // Sequential download (for comparison)
  const downloadChunksSequential = async () => {
    setState(prev => ({ ...prev, isDownloading: true, error: '', downloadProgress: 0, currentSpeed: 0 }));
    downloadStartTimeRef.current = performance.now();
    
    try {
      const infoResponse = await fetch(`${API_BASE}/file/${fileInfo.file_id}/info?chunk_size=${state.customChunkSize}`);
      if (!infoResponse.ok) {
        throw new Error(`Failed to get file info: ${infoResponse.statusText}`);
      }
      const fileInfoCustom = await infoResponse.json();
      
      const totalChunks = fileInfoCustom.total_chunks;
      const chunks: string[] = [];
      let totalBytesDownloaded = 0;
      const startTime = performance.now();
      
      setState(prev => ({ ...prev, totalChunks }));
      
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
        const response = await fetch(`${API_BASE}/chunk/${fileInfo.file_id}/${i}?chunk_size=${state.customChunkSize}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch chunk ${i}`);
        }
        
        const chunkData = await response.json();
        chunks.push(chunkData.data);
        totalBytesDownloaded += chunkData.data.length;
      }
      
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
          downloadTime,
          downloadSpeed: finalSpeed,
          totalDataTransferred: totalBytesDownloaded,
          chunksPerSecond: totalChunks / (downloadTime / 1000),
          parallelDownloads: 1,
          decodeTime: 0,
          totalTime: 0,
          memoryUsage: 0,
          decodingSpeed: 0,
          browserFrozen: false
        }
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

  const decodeBase64Chunks = async () => {
    setState(prev => ({ ...prev, isDecoding: true, error: '' }));
    decodeStartTimeRef.current = performance.now();
    
    try {
      // Check browser freeze
      let browserFrozen = false;
      const freezeCheckPromise = new Promise<boolean>((resolve) => {
        const start = performance.now();
        setTimeout(() => {
          const elapsed = performance.now() - start;
          resolve(elapsed > 150); // If timer is delayed by >150ms, browser was frozen
        }, 100);
      });
      
      // Concatenate and decode
      console.log('🔧 Concatenating base64 chunks...');
      const concatenatedBase64 = state.chunks.join('');
      const totalBase64Size = concatenatedBase64.length;
      
      console.log(`💾 Total base64 size: ${(totalBase64Size / (1024 * 1024)).toFixed(2)} MB`);
      
      console.log('🔧 Starting atob() decoding...');
      const decodeStart = performance.now();
      const binaryString = atob(concatenatedBase64);
      const decodeEnd = performance.now();
      
      browserFrozen = await freezeCheckPromise;
      
      // Convert to Uint8Array
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes]);
      const downloadUrl = URL.createObjectURL(blob);
      
      const decodeTime = performance.now() - decodeStartTimeRef.current;
      const decodingSpeed = (binaryString.length / (1024 * 1024)) / (decodeTime / 1000);
      const totalTime = decodeTime + (state.metrics?.downloadTime || 0);
      
      setState(prev => ({ 
        ...prev,
        isDecoding: false,
        isComplete: true,
        metrics: {
          ...prev.metrics!,
          decodeTime,
          totalTime,
          decodingSpeed,
          memoryUsage: (totalBase64Size + binaryString.length + bytes.length) / (1024 * 1024),
          browserFrozen
        }
      }));
      
      // Auto-download the file
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileInfo.filename;
      a.click();
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      
    } catch (err) {
      setState(prev => ({ 
        ...prev, 
        isDecoding: false, 
        error: err instanceof Error ? err.message : 'Decoding failed' 
      }));
    }
  };

  const startTest = useCallback(async () => {
    if (state.parallelConnections > 1) {
      await downloadChunksParallel();
    } else {
      await downloadChunksSequential();
    }
    
    if (state.chunks.length > 0 && !state.error) {
      await decodeBase64Chunks();
    }
  }, [state.parallelConnections, state.customChunkSize]);

  return (
    <div className="chunked-decoder">
      <div className="card">
        <h2>🧪 Optimized Base64 Decoding Test</h2>
        <p style={{ marginBottom: '20px' }}>
          Testing: <strong>{fileInfo.filename}</strong> ({formatFileSize(fileInfo.original_size)})
        </p>
        
        {!state.isDownloading && !state.isDecoding && !state.isComplete && (
          <div>
            <h3>⚙️ Configuration</h3>
            
            <div style={{ marginBottom: '16px' }}>
              <label>Chunk Size:</label>
              <select 
                value={state.customChunkSize} 
                onChange={(e) => setState(prev => ({ ...prev, customChunkSize: parseInt(e.target.value) }))}
                style={{ marginLeft: '10px' }}
              >
                <option value={64 * 1024}>64 KB</option>
                <option value={256 * 1024}>256 KB</option>
                <option value={512 * 1024}>512 KB</option>
                <option value={1024 * 1024}>1 MB</option>
                <option value={2 * 1024 * 1024}>2 MB</option>
                <option value={4 * 1024 * 1024}>4 MB</option>
                <option value={10 * 1024 * 1024}>10 MB</option>
              </select>
            </div>
            
            <div style={{ marginBottom: '16px' }}>
              <label>Parallel Downloads:</label>
              <select 
                value={state.parallelConnections} 
                onChange={(e) => setState(prev => ({ ...prev, parallelConnections: parseInt(e.target.value) }))}
                style={{ marginLeft: '10px' }}
              >
                <option value={1}>Sequential (1)</option>
                <option value={2}>2 connections</option>
                <option value={4}>4 connections</option>
                <option value={6}>6 connections</option>
                <option value={8}>8 connections</option>
                <option value={10}>10 connections</option>
              </select>
            </div>
            
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              Estimated chunks: {Math.ceil(fileInfo.b64_size / state.customChunkSize)}
            </p>
            
            <button onClick={startTest} style={{ marginTop: '20px' }}>
              🚀 Start Optimized Test
            </button>
          </div>
        )}
        
        {state.isDownloading && (
          <div>
            <h3>📥 Downloading ({state.parallelConnections > 1 ? `${state.parallelConnections} parallel` : 'sequential'})</h3>
            <div className="progress-bar" style={{ marginBottom: '10px' }}>
              <div 
                className="progress-fill" 
                style={{ width: `${state.downloadProgress}%` }}
              />
            </div>
            <p>Progress: {state.currentChunk}/{state.totalChunks} chunks ({state.downloadProgress.toFixed(1)}%)</p>
            <p style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
              Speed: {state.currentSpeed.toFixed(2)} MB/s
            </p>
          </div>
        )}
        
        {state.isDecoding && (
          <div>
            <h3>🔧 Decoding Base64...</h3>
            <div className="spinner" />
            <p>Processing {formatFileSize(state.metrics?.totalDataTransferred || 0)} of data...</p>
          </div>
        )}
        
        {state.isComplete && state.metrics && (
          <div>
            <h3>✅ Test Complete!</h3>
            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px', marginTop: '16px' }}>
              <h4>📊 Performance Report</h4>
              <table style={{ width: '100%', marginTop: '12px' }}>
                <tbody>
                  <tr>
                    <td><strong>Download Method:</strong></td>
                    <td>{state.metrics.parallelDownloads > 1 ? `${state.metrics.parallelDownloads} parallel` : 'Sequential'}</td>
                  </tr>
                  <tr>
                    <td><strong>Download Time:</strong></td>
                    <td>{(state.metrics.downloadTime / 1000).toFixed(2)}s</td>
                  </tr>
                  <tr>
                    <td><strong>Download Speed:</strong></td>
                    <td style={{ color: 'var(--success)', fontWeight: 'bold' }}>
                      {state.metrics.downloadSpeed.toFixed(2)} MB/s
                    </td>
                  </tr>
                  <tr>
                    <td><strong>Data Transferred:</strong></td>
                    <td>{(state.metrics.totalDataTransferred / (1024 * 1024)).toFixed(2)} MB</td>
                  </tr>
                  <tr>
                    <td><strong>Chunks/Second:</strong></td>
                    <td>{state.metrics.chunksPerSecond.toFixed(1)}</td>
                  </tr>
                  <tr>
                    <td><strong>Decode Time:</strong></td>
                    <td>{(state.metrics.decodeTime / 1000).toFixed(2)}s</td>
                  </tr>
                  <tr>
                    <td><strong>Decode Speed:</strong></td>
                    <td style={{ color: 'var(--success)', fontWeight: 'bold' }}>
                      {state.metrics.decodingSpeed.toFixed(2)} MB/s
                    </td>
                  </tr>
                  <tr>
                    <td><strong>Total Time:</strong></td>
                    <td>{(state.metrics.totalTime / 1000).toFixed(2)}s</td>
                  </tr>
                  <tr>
                    <td><strong>Memory Usage:</strong></td>
                    <td>{state.metrics.memoryUsage.toFixed(1)} MB</td>
                  </tr>
                  <tr>
                    <td><strong>Browser Frozen:</strong></td>
                    <td>{state.metrics.browserFrozen ? '❌ Yes' : '✅ No'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <button onClick={() => window.location.reload()} style={{ marginTop: '20px' }}>
              🔄 Run Another Test
            </button>
          </div>
        )}
        
        {state.error && (
          <div className="error" style={{ marginTop: '20px' }}>
            ❌ {state.error}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChunkedDecoderOptimized;