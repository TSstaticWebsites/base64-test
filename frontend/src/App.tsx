import React, { useState } from 'react';
import FileSelector from './components/FileSelector';
import ChunkedDecoder from './components/ChunkedDecoder';
import { chunkStorage } from './utils/indexeddb';

interface FileInfo {
  file_id: string;
  filename: string;
  total_chunks: number;
  original_size: number;
  b64_size: number;
}

function App() {
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [isClearing, setIsClearing] = useState(false);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Browser Base64 Decoding Test</h1>
        <button 
          onClick={clearIndexedDB}
          disabled={isClearing}
          style={{ 
            backgroundColor: '#dc3545', 
            color: 'white',
            fontSize: '14px',
            padding: '8px 16px'
          }}
        >
          {isClearing ? 'Clearing...' : '🗑️ Clear IndexedDB'}
        </button>
      </div>
      
      <p>
        <strong>Automatic File Processing:</strong> Put files in <code>backend/input_files/</code> folder.
        The backend will automatically convert them to base64 chunks.
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
    </div>
  );
}

export default App;