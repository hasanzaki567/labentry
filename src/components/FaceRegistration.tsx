import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { addFace, getAllFaces, deleteFace, type RegisteredFace } from '../db/database';
import { UserPlus, Trash2, Camera, Upload, Loader2, AlertCircle, CheckCircle, Users, X, ScanLine } from 'lucide-react';

interface FaceRegistrationProps {
  modelsLoaded: boolean;
}

const FaceRegistration: React.FC<FaceRegistrationProps> = ({ modelsLoaded }) => {
  const [name, setName] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [registeredFaces, setRegisteredFaces] = useState<RegisteredFace[]>([]);
  const [useCamera, setUseCamera] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectIntervalRef = useRef<number | null>(null);
  const isRegisteringRef = useRef(false);
  const nameRef = useRef(name);

  // Keep nameRef in sync with name state
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    loadRegisteredFaces();
    return () => {
      stopCamera();
    };
  }, []);

  const loadRegisteredFaces = async () => {
    const faces = await getAllFaces();
    setRegisteredFaces(faces);
  };

  const startCamera = async () => {
    if (!name.trim()) {
      setError('Please enter a name first before opening the camera.');
      return;
    }
    try {
      setError(null);
      setSuccess(null);
      setUseCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      streamRef.current = stream;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        // Start auto-detection after a short delay for camera to warm up
        setTimeout(() => startAutoDetection(), 600);
      }
    } catch (err) {
      setUseCamera(false);
      setError('Failed to access camera. Please allow camera permissions.');
      console.error('Camera error:', err);
    }
  };

  const stopCamera = () => {
    stopAutoDetection();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
    setUseCamera(false);
    setAutoDetecting(false);
    setFaceDetected(false);
  };

  const startAutoDetection = () => {
    setAutoDetecting(true);
    runDetectionLoop();
  };

  const stopAutoDetection = () => {
    if (detectIntervalRef.current) {
      cancelAnimationFrame(detectIntervalRef.current);
      detectIntervalRef.current = null;
    }
    setAutoDetecting(false);
  };

  const runDetectionLoop = useCallback(async () => {
    if (!videoRef.current || !modelsLoaded || isRegisteringRef.current) {
      detectIntervalRef.current = requestAnimationFrame(runDetectionLoop);
      return;
    }

    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      detectIntervalRef.current = requestAnimationFrame(runDetectionLoop);
      return;
    }

    // Draw face overlay
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    }
    const ctx = overlay?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlay!.width, overlay!.height);

    try {
      const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
      const detection = await faceapi
        .detectSingleFace(video as any, ssdOptions)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection && ctx && overlay) {
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        const resized = faceapi.resizeResults(detection, displaySize);
        const box = resized.detection.box;

        // Draw green box around detected face
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillStyle = '#10b981';
        const label = 'Face detected — registering...';
        const tw = ctx.measureText(label).width;
        ctx.fillRect(box.x, box.y - 28, tw + 16, 28);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Inter, sans-serif';
        ctx.fillText(label, box.x + 8, box.y - 8);

        setFaceDetected(true);

        // Auto-register only if name is filled
        if (!isRegisteringRef.current && nameRef.current.trim()) {
          isRegisteringRef.current = true;
          await autoRegisterFace(video, detection.descriptor);
          return; // stop the loop after registering
        } else if (!nameRef.current.trim()) {
          // Name cleared while camera open — show message on overlay
          ctx.fillStyle = '#f59e0b';
          const warnLabel = 'Enter a name to register';
          const ww = ctx.measureText(warnLabel).width;
          ctx.fillRect(box.x, box.y + box.height + 4, ww + 16, 28);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 14px Inter, sans-serif';
          ctx.fillText(warnLabel, box.x + 8, box.y + box.height + 22);
        }
      } else {
        setFaceDetected(false);
      }
    } catch (err) {
      console.error('Auto-detect error:', err);
    }

    detectIntervalRef.current = requestAnimationFrame(runDetectionLoop);
  }, [modelsLoaded]);

  const autoRegisterFace = async (video: HTMLVideoElement, descriptor: Float32Array) => {
    setIsProcessing(true);
    setError(null);

    try {
      // Capture snapshot from video
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const cctx = captureCanvas.getContext('2d');
      if (!cctx) throw new Error('Failed to get canvas context');
      cctx.drawImage(video, 0, 0);
      const photoDataUrl = captureCanvas.toDataURL('image/jpeg', 0.8);

      const descriptorArray = Array.from(descriptor);

      const currentName = nameRef.current.trim();
      if (!currentName) {
        setError('Name is required. Please enter a name.');
        isRegisteringRef.current = false;
        detectIntervalRef.current = requestAnimationFrame(runDetectionLoop);
        setIsProcessing(false);
        return;
      }

      await addFace({
        name: currentName,
        photoDataUrl,
        descriptor: descriptorArray,
        registeredAt: new Date()
      });

      setSuccess(`${currentName} has been registered successfully!`);
      setPhotoPreview(photoDataUrl);
      stopCamera();
      setName('');
      await loadRegisteredFaces();

      setTimeout(() => {
        setSuccess(null);
        setPhotoPreview(null);
      }, 4000);
    } catch (err) {
      console.error('Auto-registration error:', err);
      setError(`Failed to register face: ${err instanceof Error ? err.message : 'Unknown error'}`);
      isRegisteringRef.current = false;
      // Resume detection loop
      detectIntervalRef.current = requestAnimationFrame(runDetectionLoop);
    } finally {
      setIsProcessing(false);
      isRegisteringRef.current = false;
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const registerFaceFromPhoto = async () => {
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    if (!photoPreview) {
      setError('Please upload a photo.');
      return;
    }
    if (!modelsLoaded) {
      setError('Face recognition models are still loading. Please wait.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = photoPreview;
      });

      const maxSize = 720;
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const resizedCanvas = document.createElement('canvas');
      resizedCanvas.width = Math.round(img.width * scale);
      resizedCanvas.height = Math.round(img.height * scale);
      const rctx = resizedCanvas.getContext('2d');
      if (rctx) rctx.drawImage(img, 0, 0, resizedCanvas.width, resizedCanvas.height);

      const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 });
      let detection = await faceapi
        .detectSingleFace(resizedCanvas as any, ssdOptions)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.2 });
        detection = await faceapi
          .detectSingleFace(resizedCanvas as any, tinyOptions)
          .withFaceLandmarks()
          .withFaceDescriptor();
      }

      if (!detection) {
        setError('No face detected in the photo. Please try a different photo.');
        setIsProcessing(false);
        return;
      }

      const descriptor = Array.from(detection.descriptor);

      await addFace({
        name: name.trim(),
        photoDataUrl: photoPreview,
        descriptor,
        registeredAt: new Date()
      });

      setSuccess(`${name.trim()} has been registered successfully!`);
      setName('');
      setPhotoPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadRegisteredFaces();

      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error('Registration error:', err);
      setError(`Failed to register face: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteFace = async (id: number, faceName: string) => {
    if (confirm(`Remove ${faceName} from registered faces?`)) {
      await deleteFace(id);
      await loadRegisteredFaces();
    }
  };

  const clearPhoto = () => {
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setError(null);
  };

  return (
    <div className="face-registration-container">
      <div className="face-reg-form">
        <div className="face-reg-header">
          <h2>
            <UserPlus size={24} />
            Register New Face
          </h2>
          <p className="face-reg-subtitle">Enter name then open camera — face will be auto-registered when detected</p>
        </div>

        {error && (
          <div className="face-alert error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="face-alert success">
            <CheckCircle size={18} />
            <span>{success}</span>
          </div>
        )}

        <div className="face-reg-body">
          <div className="input-group">
            <label htmlFor="face-name">Full Name</label>
            <input
              id="face-name"
              type="text"
              placeholder="Enter full name first, then open camera"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isProcessing || useCamera}
            />
          </div>

          <div className="photo-section">
            <label>Photo</label>
            
            {!photoPreview && !useCamera && (
              <div className="photo-options">
                <button className="photo-option-btn" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={24} />
                  <span>Upload Photo</span>
                </button>
                <button 
                  className="photo-option-btn auto-camera-btn" 
                  onClick={startCamera}
                  disabled={!name.trim() || !modelsLoaded}
                >
                  <Camera size={24} />
                  <span>{!name.trim() ? 'Enter name first' : 'Auto Register via Camera'}</span>
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />

            {useCamera && !photoPreview && (
              <div className="camera-preview-container auto-detect-active">
                <video ref={videoRef} playsInline muted autoPlay className="camera-preview" />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <canvas ref={overlayRef} className="camera-overlay-canvas" />
                {autoDetecting && (
                  <div className="auto-detect-status">
                    <ScanLine size={18} className={faceDetected ? '' : 'pulse'} />
                    <span>{isProcessing ? 'Registering...' : faceDetected ? 'Face found! Registering...' : 'Looking for a face...'}</span>
                  </div>
                )}
                <div className="camera-actions">
                  <button className="cancel-btn" onClick={stopCamera}>
                    <X size={18} />
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {photoPreview && !useCamera && (
              <div className="photo-preview-container">
                <img src={photoPreview} alt="Preview" className="photo-preview" />
                <button className="remove-photo-btn" onClick={clearPhoto}>
                  <X size={16} />
                  Remove
                </button>
              </div>
            )}
          </div>

          {/* Only show register button for file upload flow */}
          {photoPreview && !useCamera && !success && (
            <button 
              className="register-btn" 
              onClick={registerFaceFromPhoto}
              disabled={isProcessing || !modelsLoaded || !name.trim() || !photoPreview}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Processing face...
                </>
              ) : !modelsLoaded ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Loading models...
                </>
              ) : (
                <>
                  <UserPlus size={18} />
                  Register Face
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Registered Faces List */}
      <div className="registered-faces-list">
        <div className="face-list-header">
          <h2>
            <Users size={24} />
            Registered Faces
            <span className="count-badge">{registeredFaces.length}</span>
          </h2>
        </div>

        {registeredFaces.length === 0 ? (
          <div className="empty-state">
            <Users size={48} />
            <p>No faces registered yet</p>
            <span>Register a face to get started with attendance</span>
          </div>
        ) : (
          <div className="faces-grid">
            {registeredFaces.map((face) => (
              <div key={face.id} className="face-card">
                <div className="face-card-photo">
                  <img src={face.photoDataUrl} alt={face.name} />
                </div>
                <div className="face-card-info">
                  <span className="face-card-name">{face.name}</span>
                  <span className="face-card-date">
                    {new Intl.DateTimeFormat('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric'
                    }).format(new Date(face.registeredAt))}
                  </span>
                </div>
                <button 
                  className="face-card-delete"
                  onClick={() => handleDeleteFace(face.id!, face.name)}
                  title="Remove face"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FaceRegistration;
