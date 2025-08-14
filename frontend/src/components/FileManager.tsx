import React, { useState, useEffect, useRef } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface FileInfo {
  file_id: string;
  filename: string;
  total_chunks: number;
  original_size: number;
  b64_size: number;
}

const FileManager: React.FC = () => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [deletingFile, setDeletingFile] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const fetchFiles = async () => {
    try {
      const response = await fetch(`${API_BASE}/files`);
      if (!response.ok) {
        throw new Error(`Failed to fetch files: ${response.statusText}`);
      }
      
      const data = await response.json();
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch files');
    }
  };

  useEffect(() => {
    fetchFiles();
    // Poll for updates every 3 seconds
    const interval = setInterval(fetchFiles, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError('');
    setUploadProgress(0);
    setUploadStatus(`Preparing to upload ${file.name}...`);

    const formData = new FormData();
    formData.append('file', file);

    // Use XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    // Track upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        setUploadProgress(percentComplete);
        
        // Update status with progress
        const mbLoaded = (e.loaded / (1024 * 1024)).toFixed(2);
        const mbTotal = (e.total / (1024 * 1024)).toFixed(2);
        setUploadStatus(`Uploading ${file.name}: ${mbLoaded}MB / ${mbTotal}MB`);
      }
    });

    // Handle completion
    xhr.addEventListener('load', async () => {
      try {
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          setUploadStatus(`✅ ${file.name} uploaded successfully!`);
          setUploadProgress(100);
          
          // Clear the file input
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }

          // Refresh files immediately
          await fetchFiles();

          // Clear status after 2 seconds
          setTimeout(() => {
            setUploadStatus('');
            setUploadProgress(0);
          }, 2000);
        } else {
          const data = JSON.parse(xhr.responseText);
          setError(data.error || `Upload failed with status ${xhr.status}`);
        }
      } catch (err) {
        setError(`Failed to process response: ${err}`);
      } finally {
        setIsUploading(false);
        xhrRef.current = null;
      }
    });

    // Handle errors
    xhr.addEventListener('error', () => {
      setError('Upload failed - network error');
      setIsUploading(false);
      setUploadProgress(0);
      xhrRef.current = null;
    });

    // Handle abort
    xhr.addEventListener('abort', () => {
      setUploadStatus('Upload cancelled');
      setIsUploading(false);
      setUploadProgress(0);
      xhrRef.current = null;
    });

    // Send the request with no timeout for large files
    xhr.open('POST', `${API_BASE}/upload-to-input`);
    xhr.timeout = 0; // No timeout for large file uploads
    
    // Add timeout handler
    xhr.addEventListener('timeout', () => {
      setError('Upload timed out - file may be too large for current network speed');
      setIsUploading(false);
      setUploadProgress(0);
      xhrRef.current = null;
    });
    
    xhr.send(formData);
  };

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
    }
  };

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to delete ${filename}?`)) {
      return;
    }

    setDeletingFile(filename);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/input-file/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        // Refresh files immediately
        await fetchFiles();
        setUploadStatus(`✅ ${filename} deleted successfully!`);
        setTimeout(() => {
          setUploadStatus('');
        }, 2000);
      } else {
        setError(data.error || data.detail || 'Delete failed');
      }
    } catch (err) {
      setError(`Delete error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDeletingFile('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (file && fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputRef.current.files = dataTransfer.files;
      
      const event = new Event('change', { bubbles: true });
      fileInputRef.current.dispatchEvent(event);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="file-manager">
      
      {/* Upload Section */}
      <div className="card">
        <h3 style={{ marginBottom: '16px' }}>📤 Upload Files</h3>
        
        <div
          className="upload-area"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => !isUploading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            disabled={isUploading}
          />
          
          {isUploading ? (
            <div>
              <div className="spinner" style={{ marginBottom: '10px' }} />
              <p style={{ color: 'var(--primary)', marginBottom: '12px' }}>{uploadStatus}</p>
              
              {/* Progress bar */}
              <div style={{ marginBottom: '12px' }}>
                <div className="progress-bar" style={{ height: '20px' }}>
                  <div 
                    className="progress-fill" 
                    style={{ 
                      width: `${uploadProgress}%`,
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
                <p style={{ 
                  textAlign: 'center', 
                  marginTop: '8px', 
                  fontSize: '18px', 
                  fontWeight: '600',
                  color: 'var(--primary)' 
                }}>
                  {uploadProgress}%
                </p>
              </div>
              
              {/* Cancel button */}
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  cancelUpload();
                }}
                style={{ 
                  fontSize: '12px', 
                  padding: '6px 12px',
                  backgroundColor: 'var(--danger)',
                  marginTop: '8px'
                }}
              >
                ❌ Cancel Upload
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '48px', marginBottom: '10px' }}>📁</p>
              <p style={{ fontSize: '1.1rem', marginBottom: '8px' }}>Drop your file here or click to browse</p>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Files will be saved to backend/input_files/ and processed on first use
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Status Messages */}
      {uploadStatus && !isUploading && (
        <div className="success">
          {uploadStatus}
        </div>
      )}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {/* Files List */}
      <div className="card">
        <div className="card-header">
          <h3 style={{ margin: 0 }}>
            📂 Available Files ({files.length})
          </h3>
          <button 
            onClick={fetchFiles} 
            disabled={loading}
          >
            {loading ? 'Loading...' : '🔄 Refresh'}
          </button>
        </div>

        {files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ color: 'var(--text-muted)' }}>No files available. Upload some files to get started!</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Filename</th>
                  <th style={{ textAlign: 'right' }}>Original Size</th>
                  <th style={{ textAlign: 'right' }}>Est. Base64 Size</th>
                  <th style={{ textAlign: 'right' }}>Est. Chunks</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.file_id}>
                    <td>
                      📄 {file.filename}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatFileSize(file.original_size)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatFileSize(file.b64_size)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {file.total_chunks}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn-danger"
                        onClick={() => handleDelete(file.filename)}
                        disabled={deletingFile === file.filename}
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        {deletingFile === file.filename ? 'Deleting...' : '🗑️ Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default FileManager;