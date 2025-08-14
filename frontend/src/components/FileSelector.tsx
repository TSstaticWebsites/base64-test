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

  const fetchFiles = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
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
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchFiles();
    
    // Poll for new files every 5 seconds (without showing loading)
    const interval = setInterval(() => fetchFiles(false), 5000);
    return () => clearInterval(interval);
  }, []);

  const handleFileSelect = (file: FileInfo) => {
    onFileSelected(file);
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>📂 Available Files</h2>
        <button onClick={() => fetchFiles(true)} disabled={loading}>
          {loading ? 'Scanning...' : '🔄 Refresh'}
        </button>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div className="spinner" style={{ marginBottom: '16px' }}></div>
          <p>Scanning input_files folder...</p>
        </div>
      ) : files.length === 0 ? (
        <div className="upload-area">
          <h3>📭 No Files Found</h3>
          <p>Upload files via the File Manager or place them in:</p>
          <code style={{ fontSize: '1rem' }}>backend/input_files/</code>
          <p style={{ marginTop: '16px' }}>Files are automatically converted to base64 chunks.</p>
          <button onClick={() => fetchFiles(true)} style={{ marginTop: '16px' }}>🔄 Check Again</button>
        </div>
      ) : (
        <div className="file-list">
          <p style={{ marginBottom: '16px' }}>Found {files.length} processed file{files.length !== 1 ? 's' : ''}:</p>
          
          {files.map((file) => (
            <div key={file.file_id} className="file-item" onClick={() => handleFileSelect(file)}>
              <div className="file-item-header">
                <span className="file-item-title">📄 {file.filename}</span>
                <span className="metric-value" style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  {file.total_chunks} chunks
                </span>
              </div>
              
              <div className="file-item-stats">
                <div className="file-item-stat">
                  <span className="file-item-stat-label">Original Size</span>
                  <span className="file-item-stat-value">{formatFileSize(file.original_size)}</span>
                </div>
                <div className="file-item-stat">
                  <span className="file-item-stat-label">Base64 Size</span>
                  <span className="file-item-stat-value">{formatFileSize(file.b64_size)}</span>
                </div>
                <div className="file-item-stat">
                  <span className="file-item-stat-label">Total Chunks</span>
                  <span className="file-item-stat-value">{file.total_chunks}</span>
                </div>
                <div className="file-item-stat">
                  <span className="file-item-stat-label">Size Increase</span>
                  <span className="file-item-stat-value">{((file.b64_size / file.original_size - 1) * 100).toFixed(1)}%</span>
                </div>
              </div>
              
              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <button className="btn-primary" onClick={(e) => { e.stopPropagation(); handleFileSelect(file); }}>
                  🚀 Test Decoding Performance
                </button>
              </div>
            </div>
          ))}
          
          <div className="info" style={{ marginTop: '24px' }}>
            <h4 style={{ marginBottom: '12px', color: 'var(--info)' }}>💡 Quick Tips</h4>
            <ul style={{ marginLeft: '20px', marginBottom: 0 }}>
              <li>Use the File Manager to upload test files</li>
              <li>Files are automatically processed into base64 chunks</li>
              <li>Click on any file to start performance testing</li>
              <li>Compare memory-only vs IndexedDB storage modes</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileSelector;