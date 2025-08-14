import React, { useState } from 'react';
import FileSelector from './components/FileSelector';
import ChunkedDecoder from './components/ChunkedDecoder';
import ChunkedDecoderOptimized from './components/ChunkedDecoderOptimized';
import FileManager from './components/FileManager';
import { chunkStorage } from './utils/indexeddb';

interface FileInfo {
  file_id: string;
  filename: string;
  total_chunks: number;
  original_size: number;
  b64_size: number;
}

type Page = 'test' | 'manager' | 'optimized';

function App() {
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('test');

  const handleFileSelected = (info: FileInfo) => {
    setSelectedFile(info);
  };

  const resetApp = () => {
    setSelectedFile(null);
  };

  const clearIndexedDB = async () => {
    if (!window.confirm('⚠️ This will delete ALL IndexedDB data for this site. Continue?')) {
      return;
    }
    
    setIsClearing(true);
    try {
      await chunkStorage.clearAllData();
      const dbSize = await chunkStorage.getDatabaseSize();
      console.log('✅ IndexedDB cleared! Size now:', dbSize, 'bytes');
      alert('✅ IndexedDB data cleared successfully!');
    } catch (error) {
      console.error('❌ Failed to clear IndexedDB:', error);
      alert('❌ Failed to clear IndexedDB data');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="container">
      <header className="card-header" style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ margin: 0 }}>🧪 Browser Base64 Decoding Test</h1>
        <div className="nav-buttons">
          <button
            className="btn-secondary"
            onClick={() => setCurrentPage('test')}
            style={{ opacity: currentPage === 'test' ? 1 : 0.7 }}
          >
            🧪 Standard Test
          </button>
          <button
            className="btn-secondary"
            onClick={() => setCurrentPage('optimized')}
            style={{ opacity: currentPage === 'optimized' ? 1 : 0.7 }}
          >
            ⚡ Optimized Test
          </button>
          <button
            className="btn-secondary"
            onClick={() => setCurrentPage('manager')}
            style={{ opacity: currentPage === 'manager' ? 1 : 0.7 }}
          >
            📁 File Manager
          </button>
          {(currentPage === 'test' || currentPage === 'optimized') && (
            <button 
              className="btn-danger"
              onClick={clearIndexedDB}
              disabled={isClearing}
            >
              {isClearing ? 'Clearing...' : '🗑️ Clear IndexedDB'}
            </button>
          )}
        </div>
      </header>
      
      {currentPage === 'manager' ? (
        <FileManager />
      ) : currentPage === 'optimized' ? (
        <>
          <p>
            <strong>⚡ Optimized Mode:</strong> Parallel downloads, real-time speed tracking, and performance comparison.
          </p>
          <p>
            Test with different chunk sizes and parallel connections to find the optimal configuration.
          </p>
          
          {!selectedFile ? (
            <FileSelector onFileSelected={handleFileSelected} />
          ) : (
            <ChunkedDecoderOptimized 
              fileInfo={selectedFile}
            />
          )}
        </>
      ) : (
        <>
          <p>
            <strong>Automatic File Processing:</strong> Files in <code>backend/input_files/</code> folder are automatically converted to base64 chunks.
          </p>
          <p>
            Select a file below to test browser decoding performance and feasibility.
            <br />
            <strong>Two test modes:</strong> Memory-only vs IndexedDB storage comparison.
          </p>
          
          {!selectedFile ? (
            <FileSelector onFileSelected={handleFileSelected} />
          ) : (
            <ChunkedDecoder 
              fileInfo={selectedFile}
              onReset={resetApp}
            />
          )}
        </>
      )}
    </div>
  );
}

export default App;