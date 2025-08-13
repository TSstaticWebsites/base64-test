import React, { useState, useRef } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface FileUploaderProps {
  onFileUploaded: (fileInfo: any) => void;
  onUploadStart: () => void;
  isUploading: boolean;
}

interface PerformanceMetrics {
  uploadTime: number;
  fileSize: number;
  uploadSpeed: number;
}

const FileUploader: React.FC<FileUploaderProps> = ({ 
  onFileUploaded, 
  onUploadStart, 
  isUploading 
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string>('');
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    if (!file) return;

    setError('');
    onUploadStart();
    
    const startTime = performance.now();
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }
      
      const fileInfo = await response.json();
      const endTime = performance.now();
      const uploadTime = endTime - startTime;
      
      setMetrics({
        uploadTime,
        fileSize: file.size,
        uploadSpeed: (file.size / 1024 / 1024) / (uploadTime / 1000) // MB/s
      });
      
      onFileUploaded(fileInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      onFileUploaded(null);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    
    const file = event.dataTransfer.files[0];
    if (file) {
      uploadFile(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <>
      <div 
        className={`upload-area ${dragOver ? 'dragover' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <p>Uploading file...</p>
        ) : (
          <>
            <p>Drag and drop a file here, or click to select</p>
            <p style={{ fontSize: '14px', color: '#666' }}>
              Test with different file sizes (1MB, 10MB, 100MB+) to test browser limits
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          disabled={isUploading}
        />
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {metrics && (
        <div className="performance-metrics">
          <h3>Upload Performance</h3>
          <p>File Size: {formatFileSize(metrics.fileSize)}</p>
          <p>Upload Time: {(metrics.uploadTime / 1000).toFixed(2)}s</p>
          <p>Upload Speed: {metrics.uploadSpeed.toFixed(2)} MB/s</p>
        </div>
      )}
    </>
  );
};

export default FileUploader;