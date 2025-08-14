import React, { useState } from 'react';
import FileSelector from './components/FileSelector';
import ChunkedDecoder from './components/ChunkedDecoder';
import FileManager from './components/FileManager';
import { chunkStorage } from './utils/indexeddb';

interface FileInfo {
  file_id: string;
  filename: string;
  total_chunks: number;
  original_size: number;
  b64_size: number;
}

type Page = 'test' | 'manager';

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
            onClick={() => setCurrentPage(currentPage === 'test' ? 'manager' : 'test')}
          >
            {currentPage === 'test' ? '📁 File Manager' : '🧪 Test Page'}
          </button>
          {currentPage === 'test' && (
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
      ) : (
        <>
          <p>
            <strong>Browser Base64 Decoding Test:</strong> Test the feasibility of decoding large files from base64 chunks.
          </p>
          <p>
            Select a file below and configure download settings (sequential or parallel) for optimal performance.
            <br />
            <strong>Two test modes:</strong> Memory-only vs IndexedDB storage. <strong>Parallel downloads</strong> can speed up transfers 2-4x!
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