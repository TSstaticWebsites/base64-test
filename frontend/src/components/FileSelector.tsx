import React, { useState, useEffect } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface FileInfo {
  file_id: string;
  filename: string;
  total_chunks: number;
  original_size: number;
  b64_size: number;
}

interface FileSelectorProps {
  onFileSelected: (fileInfo: FileInfo) => void;
}

const FileSelector: React.FC<FileSelectorProps> = ({ onFileSelected }) => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const fetchFiles = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_BASE}/files`);
      if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.statusText}`);
      }
      
      const data = await response.json();
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    
    // Poll for new files every 5 seconds
    const interval = setInterval(fetchFiles, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleFileSelect = (file: FileInfo) => {
    onFileSelected(file);
  };

  return (
    <div className="stats">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2>Available Files</h2>
        <button onClick={fetchFiles} disabled={loading}>
          {loading ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {loading ? (
        <p>Scanning input_files folder...</p>
      ) : files.length === 0 ? (
        <div className="upload-area">
          <h3>No Files Found</h3>
          <p>Place files in <code>backend/input_files/</code> folder and they will appear here automatically.</p>
          <p>The backend monitors this folder and processes files into base64 chunks.</p>
          <button onClick={fetchFiles}>Check Again</button>
        </div>
      ) : (
        <div>
          <p>Found {files.length} processed file{files.length !== 1 ? 's' : ''}:</p>
          
          {files.map((file) => (
            <div key={file.file_id} className="stats" style={{ margin: '10px 0', cursor: 'pointer' }} onClick={() => handleFileSelect(file)}>
              <h3 style={{ margin: '0 0 10px 0', color: '#007bff' }}>{file.filename}</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                <div>
                  <strong>Original Size:</strong> {formatFileSize(file.original_size)}
                </div>
                <div>
                  <strong>Base64 Size:</strong> {formatFileSize(file.b64_size)}
                </div>
                <div>
                  <strong>Total Chunks:</strong> {file.total_chunks}
                </div>
                <div>
                  <strong>Size Increase:</strong> {((file.b64_size / file.original_size - 1) * 100).toFixed(1)}%
                </div>
              </div>
              
              <div style={{ marginTop: '10px', textAlign: 'center' }}>
                <button onClick={(e) => { e.stopPropagation(); handleFileSelect(file); }}>
                  Test Decoding Performance →
                </button>
              </div>
            </div>
          ))}
          
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', fontSize: '14px' }}>
            <h4>Instructions:</h4>
            <ol>
              <li>Copy your Big Buck Bunny or other test files to <code>backend/input_files/</code></li>
              <li>Wait a few seconds for the backend to process them</li>
              <li>Click "Refresh" if new files don't appear automatically</li>
              <li>Select a file to test browser decoding performance</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileSelector;