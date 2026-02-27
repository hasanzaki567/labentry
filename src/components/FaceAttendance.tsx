import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { getAllFaces, addAttendance, getLatestAttendanceByFaceId, hasAttendanceForFaceOnDate, type RegisteredFace } from '../db/database';
import { Camera, CameraOff, Loader2, AlertCircle, ScanLine, CheckCircle, UserCheck } from 'lucide-react';

interface FaceAttendanceProps {
  modelsLoaded: boolean;
}

const MATCH_THRESHOLD = 0.45; // stricter: 0.45 distance = 55% confidence minimum
const AUTO_MARK_CONFIDENCE = 55;
const ATTENDANCE_COOLDOWN_MS = 10_000;

// Emoji map for face expressions
const EXPRESSION_EMOJI: Record<string, string> = {
  neutral: '😐',
  happy: '😄',
  sad: '😢',
  angry: '😠',
  fearful: '😨',
  disgusted: '🤢',
  surprised: '😲',
};

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
  const [recentAttendance, setRecentAttendance] = useState<{ name: string; time: Date }[]>([]);
  const [currentDetection, setCurrentDetection] = useState<string | null>(null);
  const [attendancePopup, setAttendancePopup] = useState<{ name: string } | null>(null);
  const isPausedRef = useRef(false);

  useEffect(() => {
    loadFaces();
    return () => {
      stopScanning();
    };
  }, []);

  useEffect(() => {
    if (!attendancePopup) {
      return;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(`The attendance of ${attendancePopup.name} has been recorded. Thank you!`);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    }
  }, [attendancePopup]);

  const captureSnapshot = (): string | undefined => {
    if (!videoRef.current || !canvasRef.current) {
      return undefined;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const snapCtx = canvas.getContext('2d');
    if (!snapCtx) {
      return undefined;
    }

    snapCtx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.6);
  };

  const getAttendanceBlockReason = async (faceId: number, now: Date): Promise<string | null> => {
    const nowMs = now.getTime();
    const key = String(faceId);
    const lastSeenMs = lastAttendanceRef.current.get(key) || 0;

    if (nowMs - lastSeenMs < ATTENDANCE_COOLDOWN_MS) {
      return 'Cooldown active (10s)';
    }

    const latestRecord = await getLatestAttendanceByFaceId(faceId);
    if (latestRecord) {
      const latestMs = new Date(latestRecord.timestamp).getTime();
      if (nowMs - latestMs < ATTENDANCE_COOLDOWN_MS) {
        return 'Cooldown active (10s)';
      }
    }

    const alreadyMarkedToday = await hasAttendanceForFaceOnDate(faceId, now);
    if (alreadyMarkedToday) {
      return 'Already marked today';
    }

    return null;
  };

  const recordAttendance = async (entry: { faceId: number; name: string; confidence: number; photoDataUrl?: string }) => {
    const now = new Date();
    await addAttendance({
      faceId: entry.faceId,
      name: entry.name,
      timestamp: now,
      confidence: entry.confidence,
      photoDataUrl: entry.photoDataUrl
    });

    lastAttendanceRef.current.set(String(entry.faceId), now.getTime());
    setRecentAttendance(prev => [
      { name: entry.name, time: now },
      ...prev.slice(0, 9)
    ]);
    isPausedRef.current = true;
    setAttendancePopup({ name: entry.name });
  };

  // Listen for keyboard actions on overlays
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
    isPausedRef.current = false;
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
      // Use SSD MobileNet for reliable face recognition
      const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
      let detections = await faceapi
        .detectAllFaces(video as any, ssdOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();

      // Fallback to TinyFaceDetector if SSD found nothing
      if (detections.length === 0) {
        const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 });
        detections = await faceapi
          .detectAllFaces(video as any, tinyOptions)
          .withFaceLandmarks()
          .withFaceDescriptors();
      }

      // Try to get expressions separately (won't break if model not loaded)
      let expressionResults: faceapi.WithFaceExpressions<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>>[] = [];
      try {
        if (faceapi.nets.faceExpressionNet.isLoaded) {
          expressionResults = await faceapi
            .detectAllFaces(video as any, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
            .withFaceLandmarks()
            .withFaceExpressions();
        }
      } catch {
        // Expression detection failed, continue without emojis
      }

      if (detections.length > 0) {
        // Draw detections
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        for (const detection of resizedDetections) {
          const match = faceMatcher.current!.findBestMatch(detection.descriptor);
          const box = detection.detection.box;

          // Find matching expression for this face by box overlap
          let emoji = '';
          for (const expr of expressionResults) {
            const exprBox = expr.detection.box;
            const overlap = Math.abs(exprBox.x - box.x) < box.width * 0.5 &&
                            Math.abs(exprBox.y - box.y) < box.height * 0.5;
            if (overlap) {
              const sorted = Object.entries(expr.expressions).sort((a, b) => (b[1] as number) - (a[1] as number));
              emoji = EXPRESSION_EMOJI[sorted[0][0]] || '';
              break;
            }
          }

          // Draw emoji above the bounding box if found
          if (emoji) {
            const emojiSize = Math.max(28, box.width * 0.35);
            ctx.font = `${emojiSize}px serif`;
            ctx.textAlign = 'center';
            ctx.fillText(emoji, box.x + box.width / 2, box.y - 6);
            ctx.textAlign = 'start';
          }

          if (match.label !== 'unknown') {
            const [faceId, rawName] = match.label.split(':');
            // Capitalize first letter of each word for display
            const faceName = rawName.replace(/\b\w/g, c => c.toUpperCase());
            const confidence = Math.round((1 - match.distance) * 100);

            if (confidence >= AUTO_MARK_CONFIDENCE) {
              // Draw green box for recognized
              ctx.strokeStyle = '#10b981';
              ctx.lineWidth = 3;
              ctx.strokeRect(box.x, box.y, box.width, box.height);

              const parsedFaceId = parseInt(faceId, 10);
              const reason = await getAttendanceBlockReason(parsedFaceId, new Date());
              if (reason) {
                setCurrentDetection(`${faceName} - ${reason}`);
              } else {
                setCurrentDetection(`Recognized: ${faceName}`);
                await recordAttendance({
                  faceId: parsedFaceId,
                  name: faceName,
                  confidence,
                  photoDataUrl: captureSnapshot()
                });
              }
            } else {
              // Below threshold
              ctx.strokeStyle = '#f59e0b';
              ctx.lineWidth = 2;
              ctx.strokeRect(box.x, box.y, box.width, box.height);

              setCurrentDetection(`Low confidence for ${faceName}`);
            }
          } else {
            // Draw red box for unknown
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

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
                <span className="attendance-popup-title">The attendance has been recorded for</span>
                <span className="attendance-popup-name-big">{attendancePopup.name}</span>
                <span className="attendance-popup-conf">Thank you!</span>
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
