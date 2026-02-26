import React, { useState, useRef, useEffect } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { addFace, getAllFaces, deleteFace, type RegisteredFace } from '../db/database';
import { UserPlus, Trash2, Camera, Upload, Loader2, AlertCircle, CheckCircle, Users, X } from 'lucide-react';

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
  const [cameraReady, setCameraReady] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
    try {
      setError(null);
      // Show the video element first so the ref is available
      setUseCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      streamRef.current = stream;
      // Wait a tick for React to render the video element
      await new Promise(resolve => setTimeout(resolve, 100));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      setUseCamera(false);
      setError('Failed to access camera. Please allow camera permissions.');
      console.error('Camera error:', err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setUseCamera(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setPhotoPreview(dataUrl);
    stopCamera();
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

  const registerFace = async () => {
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    if (!photoPreview) {
      setError('Please upload or capture a photo.');
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
      // Create an image element from the photo
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = photoPreview;
      });

      // Resize image to max 512px for faster processing
      const maxSize = 512;
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const resizedCanvas = document.createElement('canvas');
      resizedCanvas.width = Math.round(img.width * scale);
      resizedCanvas.height = Math.round(img.height * scale);
      const rctx = resizedCanvas.getContext('2d');
      if (rctx) rctx.drawImage(img, 0, 0, resizedCanvas.width, resizedCanvas.height);

      // Use TinyFaceDetector first (much faster), fall back to SSD if needed
      const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.1 });
      let detection = await faceapi
        .detectSingleFace(resizedCanvas as any, tinyOptions)
        .withFaceLandmarks()
        .withFaceDescriptor();

      // Fallback to SSD MobileNet if TinyFaceDetector missed
      if (!detection) {
        const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 });
        detection = await faceapi
          .detectSingleFace(resizedCanvas as any, ssdOptions)
          .withFaceLandmarks()
          .withFaceDescriptor();
      }

      if (!detection) {
        setError('No face detected in the photo. Please try a different photo — make sure your face is visible and well-lit.');
        setIsProcessing(false);
        return;
      }

      const descriptor = Array.from(detection.descriptor);

      // Save to database
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
          <p className="face-reg-subtitle">Upload a clear photo or use your camera to register for face attendance</p>
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
              placeholder="Enter your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isProcessing}
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
                <button className="photo-option-btn" onClick={startCamera}>
                  <Camera size={24} />
                  <span>Use Camera</span>
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
              <div className="camera-preview-container">
                <video ref={videoRef} playsInline muted autoPlay className="camera-preview" />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div className="camera-actions">
                  <button className="capture-btn" onClick={capturePhoto} disabled={!cameraReady}>
                    <Camera size={18} />
                    Capture
                  </button>
                  <button className="cancel-btn" onClick={stopCamera}>
                    <X size={18} />
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {photoPreview && (
              <div className="photo-preview-container">
                <img src={photoPreview} alt="Preview" className="photo-preview" />
                <button className="remove-photo-btn" onClick={clearPhoto}>
                  <X size={16} />
                  Remove
                </button>
              </div>
            )}
          </div>

          <button 
            className="register-btn" 
            onClick={registerFace}
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
