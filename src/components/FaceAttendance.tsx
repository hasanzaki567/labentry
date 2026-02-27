import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { getAllFaces, addAttendance, type RegisteredFace } from '../db/database';
import { Camera, CameraOff, Loader2, AlertCircle, ScanLine, CheckCircle, UserCheck } from 'lucide-react';

interface FaceAttendanceProps {
  modelsLoaded: boolean;
}

const MATCH_THRESHOLD = 0.45; // stricter: 0.45 distance = 55% confidence minimum

const FaceAttendance: React.FC<FaceAttendanceProps> = ({ modelsLoaded }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const faceMatcher = useRef<faceapi.FaceMatcher | null>(null);
  const lastAttendanceRef = useRef<Map<string, number>>(new Map());

  const [isScanning, setIsScanning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredFaces, setRegisteredFaces] = useState<RegisteredFace[]>([]);
  const [recentAttendance, setRecentAttendance] = useState<{ name: string; time: Date; confidence: number }[]>([]);
  const [currentDetection, setCurrentDetection] = useState<string | null>(null);
  const [attendancePopup, setAttendancePopup] = useState<{ name: string; confidence: number } | null>(null);
  const isPausedRef = useRef(false);

  useEffect(() => {
    loadFaces();
    return () => {
      stopScanning();
    };
  }, []);

  // Listen for Enter key to dismiss popup and resume scanning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && attendancePopup) {
        setAttendancePopup(null);
        isPausedRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attendancePopup]);

  const loadFaces = async () => {
    const faces = await getAllFaces();
    setRegisteredFaces(faces);

    if (faces.length > 0) {
      // Group descriptors by name so multiple photos of the same person improve accuracy
      const descriptorsByName = new Map<string, { id: number; descriptors: Float32Array[] }>();
      for (const face of faces) {
        const key = face.name.toLowerCase().trim();
        if (!descriptorsByName.has(key)) {
          descriptorsByName.set(key, { id: face.id!, descriptors: [] });
        }
        descriptorsByName.get(key)!.descriptors.push(new Float32Array(face.descriptor));
      }

      const labeledDescriptors = Array.from(descriptorsByName.entries()).map(
        ([name, { id, descriptors }]) =>
          new faceapi.LabeledFaceDescriptors(`${id}:${name}`, descriptors)
      );
      faceMatcher.current = new faceapi.FaceMatcher(labeledDescriptors, MATCH_THRESHOLD);
    }
  };

  const startScanning = async () => {
    if (isInitializing) return;
    setIsInitializing(true);
    setError(null);

    try {
      if (registeredFaces.length === 0) {
        setError('No faces registered yet. Please register at least one face first.');
        setIsInitializing(false);
        return;
      }

      // Refresh face matcher
      await loadFaces();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsScanning(true);

      // Start detection loop
      setTimeout(() => {
        detectLoop();
      }, 500);
    } catch (err) {
      console.error('Failed to start scanning:', err);
      let errorMsg = err instanceof Error ? err.message : 'Failed to start camera';
      if (errorMsg.includes('NotAllowedError')) {
        errorMsg = 'Camera access denied. Please allow camera permissions.';
      } else if (errorMsg.includes('NotFoundError')) {
        errorMsg = 'No camera found on this device.';
      }
      setError(errorMsg);
    } finally {
      setIsInitializing(false);
    }
  };

  const stopScanning = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Clear overlay
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }

    setIsScanning(false);
    setCurrentDetection(null);
  };

  const detectLoop = useCallback(async () => {
    if (!videoRef.current || !overlayCanvasRef.current || !faceMatcher.current || isPausedRef.current) {
      animFrameRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    const video = videoRef.current;
    const overlay = overlayCanvasRef.current;

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      animFrameRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    const ctx = overlay.getContext('2d');
    if (!ctx) {
      animFrameRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    try {
      // Use SSD MobileNet as primary — more accurate descriptors for recognition
      const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
      let detections = await faceapi
        .detectAllFaces(video as any, ssdOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();

      // Fallback to TinyFaceDetector with larger input if SSD found nothing
      if (detections.length === 0) {
        const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 });
        detections = await faceapi
          .detectAllFaces(video as any, tinyOptions)
          .withFaceLandmarks()
          .withFaceDescriptors();
      }

      if (detections.length > 0) {
        // Draw detections
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        for (const detection of resizedDetections) {
          const match = faceMatcher.current!.findBestMatch(detection.descriptor);
          const box = detection.detection.box;

          if (match.label !== 'unknown') {
            const [faceId, rawName] = match.label.split(':');
            // Capitalize first letter of each word for display
            const faceName = rawName.replace(/\b\w/g, c => c.toUpperCase());
            const confidence = Math.round((1 - match.distance) * 100);

            // Accept matches at 55% or above for reliable recognition
            if (confidence >= 55) {
              // Draw green box for recognized
              ctx.strokeStyle = '#10b981';
              ctx.lineWidth = 3;
              ctx.strokeRect(box.x, box.y, box.width, box.height);

              // Draw name label
              ctx.fillStyle = '#10b981';
              const textWidth = ctx.measureText(`${faceName} (${confidence}%)`).width;
              ctx.fillRect(box.x, box.y - 28, textWidth + 16, 28);
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 14px Inter, sans-serif';
              ctx.fillText(`${faceName} (${confidence}%)`, box.x + 8, box.y - 8);

              setCurrentDetection(`${faceName} - ${confidence}% match`);

              // Record attendance (prevent duplicates within 30 seconds)
              const now = Date.now();
              const lastTime = lastAttendanceRef.current.get(faceId) || 0;
              if (now - lastTime > 30000) {
                lastAttendanceRef.current.set(faceId, now);

                // Capture snapshot
                let photoDataUrl: string | undefined;
                if (canvasRef.current) {
                  canvasRef.current.width = video.videoWidth;
                  canvasRef.current.height = video.videoHeight;
                  const snapCtx = canvasRef.current.getContext('2d');
                  if (snapCtx) {
                    snapCtx.drawImage(video, 0, 0);
                    photoDataUrl = canvasRef.current.toDataURL('image/jpeg', 0.6);
                  }
                }

                await addAttendance({
                  faceId: parseInt(faceId),
                  name: faceName,
                  timestamp: new Date(),
                  confidence,
                  photoDataUrl
                });

                setRecentAttendance(prev => [
                  { name: faceName, time: new Date(), confidence },
                  ...prev.slice(0, 9)
                ]);

                // Show attendance popup and pause scanning
                isPausedRef.current = true;
                setAttendancePopup({ name: faceName, confidence });
              }
            } else {
              // Below 55% — treat as weak match, show yellow box
              ctx.strokeStyle = '#f59e0b';
              ctx.lineWidth = 2;
              ctx.strokeRect(box.x, box.y, box.width, box.height);

              ctx.fillStyle = '#f59e0b';
              const textWidth = ctx.measureText(`${faceName}? (${confidence}%)`).width;
              ctx.fillRect(box.x, box.y - 28, textWidth + 16, 28);
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 14px Inter, sans-serif';
              ctx.fillText(`${faceName}? (${confidence}%)`, box.x + 8, box.y - 8);

              setCurrentDetection(`Weak match: ${faceName}? - ${confidence}%`);
            }
          } else {
            // Draw red box for unknown
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            ctx.fillStyle = '#ef4444';
            const textWidth = ctx.measureText('Unknown').width;
            ctx.fillRect(box.x, box.y - 28, textWidth + 16, 28);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px Inter, sans-serif';
            ctx.fillText('Unknown', box.x + 8, box.y - 8);

            setCurrentDetection('Unknown face detected');
          }
        }
      } else {
        setCurrentDetection(null);
      }
    } catch (err) {
      // Continue scanning
      console.error('Detection error:', err);
    }

    animFrameRef.current = requestAnimationFrame(detectLoop);
  }, []);

  const toggleScanning = async () => {
    if (isScanning) {
      stopScanning();
    } else {
      await startScanning();
    }
  };

  return (
    <div className="face-attendance-container">
      <div className="face-scanner-section">
        <div className="scanner-container">
          <div className="scanner-header">
            <h2>
              <ScanLine size={24} />
              Face Attendance
            </h2>
            <button
              className={`scan-toggle-btn ${isScanning ? 'scanning' : ''}`}
              onClick={toggleScanning}
              disabled={isInitializing || !modelsLoaded}
            >
              {isInitializing ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Initializing...
                </>
              ) : !modelsLoaded ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Loading Models...
                </>
              ) : isScanning ? (
                <>
                  <CameraOff size={18} />
                  Stop
                </>
              ) : (
                <>
                  <Camera size={18} />
                  Start Attendance
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="scanner-error">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          <div className="video-wrapper">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={isScanning ? 'active face-video' : 'face-video'}
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <canvas ref={overlayCanvasRef} className="face-overlay-canvas" />

            {isScanning && (
              <div className="face-scan-indicator">
                <div className="face-scan-circle"></div>
              </div>
            )}

            {!isScanning && !isInitializing && (
              <div className="scanner-placeholder">
                <Camera size={64} />
                <p>Click "Start Attendance" to begin face recognition</p>
                {registeredFaces.length === 0 && (
                  <span className="warning-text">Register faces first in the Register tab</span>
                )}
              </div>
            )}

            {isInitializing && (
              <div className="scanner-placeholder">
                <Loader2 size={64} className="spin" />
                <p>Starting face recognition...</p>
              </div>
            )}
          </div>

          {currentDetection && (
            <div className="last-scanned">
              <span className="label">Detected:</span>
              <span className="code">{currentDetection}</span>
            </div>
          )}

          {/* Attendance Marked Popup - fullscreen overlay */}
          {attendancePopup && (
            <div className="attendance-popup-overlay" onClick={() => { setAttendancePopup(null); isPausedRef.current = false; }}>
              <div className="attendance-popup-modal">
                <div className="attendance-popup-icon">
                  <CheckCircle size={64} />
                </div>
                <span className="attendance-popup-title">Attendance Registered</span>
                <span className="attendance-popup-name-big">{attendancePopup.name}</span>
                <span className="attendance-popup-conf">{attendancePopup.confidence}% match</span>
                <span className="attendance-popup-hint">Press <kbd>Enter</kbd> to continue</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Attendance Sidebar */}
      <div className="recent-attendance-section">
        <div className="attendance-card">
          <div className="attendance-card-header">
            <h3>
              <UserCheck size={20} />
              Recent Attendance
            </h3>
            <span className="count-badge">{recentAttendance.length}</span>
          </div>

          {recentAttendance.length === 0 ? (
            <div className="empty-state small">
              <UserCheck size={36} />
              <p>No attendance recorded yet</p>
              <span>Face the camera to mark attendance</span>
            </div>
          ) : (
            <div className="recent-list">
              {recentAttendance.map((record, idx) => (
                <div key={idx} className="recent-item">
                  <div className="recent-item-icon">
                    <CheckCircle size={18} />
                  </div>
                  <div className="recent-item-info">
                    <span className="recent-item-name">{record.name}</span>
                    <span className="recent-item-time">
                      {new Intl.DateTimeFormat('en-US', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                      }).format(record.time)}
                    </span>
                  </div>
                  <span className="recent-item-confidence">{record.confidence}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="attendance-stats-card">
          <div className="stat-item">
            <span className="stat-value">{registeredFaces.length}</span>
            <span className="stat-label">Registered</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{recentAttendance.length}</span>
            <span className="stat-label">Today's Entries</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FaceAttendance;
