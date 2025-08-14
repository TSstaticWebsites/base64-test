import React, { useState, useRef } from 'react';

interface InputFileUploaderProps {
  onUploadSuccess?: () => void;
}

const InputFileUploader: React.FC<InputFileUploaderProps> = ({ onUploadSuccess }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError('');
    setUploadStatus(`Uploading ${file.name}...`);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/upload-to-input`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setUploadStatus(`✅ ${file.name} uploaded successfully!`);
        
        // Clear the file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }

        // Call the callback after a short delay
        setTimeout(() => {
          onUploadSuccess?.();
          setUploadStatus('');
        }, 2000);
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (err) {
      setError(`Upload error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsUploading(false);
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
    <div 
      className="input-file-uploader"
      style={{
        padding: '20px',
        backgroundColor: '#1a1a2e',
        borderRadius: '8px',
        marginBottom: '20px',
      }}
    >
      <h3 style={{ color: '#4a9eff', marginBottom: '15px' }}>
        📤 Upload File to Test
      </h3>
      
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          border: '2px dashed #4a9eff',
          borderRadius: '8px',
          padding: '30px',
          textAlign: 'center',
          backgroundColor: '#0f0f23',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          disabled={isUploading}
        />
        
        {isUploading ? (
          <div style={{ color: '#4a9eff' }}>
            <div className="spinner" style={{
              border: '3px solid #1a1a2e',
              borderTop: '3px solid #4a9eff',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 10px',
            }} />
            <p>{uploadStatus}</p>
          </div>
        ) : (
          <div style={{ color: '#ccc' }}>
            <p style={{ fontSize: '24px', marginBottom: '10px' }}>📁</p>
            <p>Click or drag & drop a file here to upload</p>
            <p style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>
              Files will be saved to the backend's input_files folder
            </p>
          </div>
        )}
      </div>

      {uploadStatus && !isUploading && (
        <div style={{
          marginTop: '15px',
          padding: '10px',
          backgroundColor: '#0a4f0a',
          borderRadius: '4px',
          color: '#4eff4a',
        }}>
          {uploadStatus}
        </div>
      )}

      {error && (
        <div style={{
          marginTop: '15px',
          padding: '10px',
          backgroundColor: '#4f0a0a',
          borderRadius: '4px',
          color: '#ff4a4a',
        }}>
          ❌ {error}
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default InputFileUploader;