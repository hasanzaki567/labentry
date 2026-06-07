import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import {
  getAllFaces,
  addOrUpdateAttendance,
  hasOpenAttendanceForFace,
  getLatestAttendanceByFaceId,
  hasAttendanceForFaceOnDate,
  type RegisteredFace
} from '../db/database';
import { Camera, CameraOff, Loader2, AlertCircle, ScanLine, CheckCircle, UserCheck, LogIn, LogOut } from 'lucide-react';

interface EntranceAttendanceProps {
  modelsLoaded: boolean;
  isExit?: boolean;
}

const MATCH_THRESHOLD = 0.6;
const AUTO_MARK_CONFIDENCE = 52;
const ATTENDANCE_COOLDOWN_MS = 10_000;

const EXPRESSION_EMOJI: Record<string, string> = {
  neutral: '😐',
  happy: '😄',
  sad: '😢',
  angry: '😠',
  fearful: '😨',
  disgusted: '🤢',
  surprised: '😲',
};

const EntranceAttendance: React.FC<EntranceAttendanceProps> = ({ modelsLoaded, isExit = false }) => {
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
  const [recentEvents, setRecentEvents] = useState<{ name: string; time: Date; type: 'entry' | 'exit' }[]>([]);
  const [currentDetection, setCurrentDetection] = useState<string | null>(null);
  const [attendancePopup, setAttendancePopup] = useState<{ name: string; type: 'entry' | 'exit'; duration?: number } | null>(null);
  const isPausedRef = useRef(false);

  const componentTitle = isExit ? 'Exit Scan' : 'Entrance Scan';
  const buttonText = isExit ? 'Start Exit Scan' : 'Start Entrance Scan';
  const placeholderText = isExit ? 'Click "Start Exit Scan" to record departures' : 'Click "Start Entrance Scan" to record arrivals';

  useEffect(() => {
    loadFaces();
    return () => {
      stopScanning();
    };
  }, []);

  useEffect(() => {
    if (!attendancePopup) return;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      let message = '';
      if (attendancePopup.type === 'entry') {
        message = `Welcome, ${attendancePopup.name}. Your entry has been recorded.`;
      } else {
        message = `Goodbye, ${attendancePopup.name}. Your exit has been recorded.`;
        if (attendancePopup.duration !== undefined) {
          message += ` You were here for ${attendancePopup.duration} minutes.`;
        }
      }
      const utterance = new SpeechSynthesisUtterance(message);
      window.speechSynthesis.speak(utterance);
    }
  }, [attendancePopup]);

  const captureSnapshot = (): string | undefined => {
    if (!videoRef.current || !canvasRef.current) return undefined;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const snapCtx = canvas.getContext('2d');
    if (!snapCtx) return undefined;
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

    const hasOpenEntry = await hasOpenAttendanceForFace(faceId);

    if (isExit) {
      if (!hasOpenEntry) {
        return 'No open entry to mark as exit';
      }
    } else {
      if (hasOpenEntry) {
        return 'Already marked as entered';
      }

      const latestRecord = await getLatestAttendanceByFaceId(faceId);
      if (latestRecord?.exitTimestamp) {
        const fiveMinutesInMs = 5 * 60 * 1000;
        const timeSinceLastExit = now.getTime() - new Date(latestRecord.exitTimestamp).getTime();
        if (timeSinceLastExit < fiveMinutesInMs) {
          const waitTime = Math.ceil((fiveMinutesInMs - timeSinceLastExit) / (1000 * 60));
          return `Please wait ${waitTime} min before new entry`;
        }
      }
    }

    return null;
  };

  const recordAttendance = async (entry: { faceId: number; name: string; confidence: number; photoDataUrl?: string }) => {
    try {
      const result = await addOrUpdateAttendance(entry, isExit);
      const now = new Date();

      lastAttendanceRef.current.set(String(entry.faceId), now.getTime());
      setRecentEvents(prev => [
        { name: entry.name, time: now, type: result.type },
        ...prev.slice(0, 9)
      ]);
      isPausedRef.current = true;
      setAttendancePopup({ name: entry.name, type: result.type, duration: result.duration });
    } catch (e) {
      console.error('Failed to record attendance:', e);
      setError((e as Error).message);
    }
  };

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
        setError('No faces registered. Please register faces first.');
        setIsInitializing(false);
        return;
      }

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
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
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
      const hasExprModel = faceapi.nets.faceExpressionNet.isLoaded;
      const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });
      let detections: any[] = hasExprModel
        ? await faceapi.detectAllFaces(video as any, tinyOpts).withFaceLandmarks().withFaceExpressions().withFaceDescriptors()
        : await faceapi.detectAllFaces(video as any, tinyOpts).withFaceLandmarks().withFaceDescriptors();

      if (detections.length === 0) {
        const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 });
        detections = hasExprModel
          ? await faceapi.detectAllFaces(video as any, ssdOpts).withFaceLandmarks().withFaceExpressions().withFaceDescriptors()
          : await faceapi.detectAllFaces(video as any, ssdOpts).withFaceLandmarks().withFaceDescriptors();
      }

      if (detections.length > 0) {
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        for (const detection of resizedDetections) {
          const match = faceMatcher.current!.findBestMatch(detection.descriptor);
          const box = detection.detection.box;

          let emoji = '';
          if (hasExprModel && (detection as any).expressions) {
            const sorted = Object.entries((detection as any).expressions).sort((a, b) => (b[1] as number) - (a[1] as number));
            emoji = EXPRESSION_EMOJI[sorted[0][0]] || '';
          }

          if (emoji) {
            const emojiSize = Math.max(28, box.width * 0.35);
            ctx.font = `${emojiSize}px serif`;
            ctx.textAlign = 'center';
            ctx.fillText(emoji, box.x + box.width / 2, box.y - 6);
            ctx.textAlign = 'start';
          }

          if (match.label !== 'unknown') {
            const [faceId, rawName] = match.label.split(':');
            const faceName = rawName.replace(/\b\w/g, c => c.toUpperCase());
            const confidence = Math.round((1 - match.distance) * 100);

            if (confidence >= AUTO_MARK_CONFIDENCE) {
              ctx.strokeStyle = isExit ? '#f59e0b' : '#10b981';
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
              ctx.strokeStyle = '#f59e0b';
              ctx.lineWidth = 2;
              ctx.strokeRect(box.x, box.y, box.width, box.height);
              setCurrentDetection(`Low confidence for ${faceName}`);
            }
          } else {
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
      console.error('Detection error:', err);
    }

    await new Promise(r => setTimeout(r, 60));
    animFrameRef.current = requestAnimationFrame(detectLoop);
  }, [isExit]);

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
              {isExit ? <LogOut size={24} /> : <LogIn size={24} />}
              {componentTitle}
            </h2>
            <button
              className={`scan-toggle-btn ${isScanning ? 'scanning' : ''} ${isExit ? 'exit' : 'entrance'}`}
              onClick={toggleScanning}
              disabled={isInitializing || !modelsLoaded}
            >
              {isInitializing ? (
                <><Loader2 size={18} className="spin" /> Initializing...</>
              ) : !modelsLoaded ? (
                <><Loader2 size={18} className="spin" /> Loading Models...</>
              ) : isScanning ? (
                <><CameraOff size={18} /> Stop</>
              ) : (
                <><Camera size={18} /> {buttonText}</>
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
            <video ref={videoRef} playsInline muted autoPlay className={isScanning ? 'active face-video' : 'face-video'} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <canvas ref={overlayCanvasRef} className="face-overlay-canvas" />

            {isScanning && <div className="face-scan-indicator"><div className="face-scan-circle"></div></div>}

            {!isScanning && !isInitializing && (
              <div className="scanner-placeholder">
                <Camera size={64} />
                <p>{placeholderText}</p>
                {registeredFaces.length === 0 && <span className="warning-text">Register faces first</span>}
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

          {attendancePopup && (
            <div className="attendance-popup-overlay" onClick={() => { setAttendancePopup(null); isPausedRef.current = false; }}>
              <div className="attendance-popup-modal">
                <div className="attendance-popup-icon">
                  {attendancePopup.type === 'entry' ? <LogIn size={64} /> : <LogOut size={64} />}
                </div>
                <span className="attendance-popup-title">
                  {attendancePopup.type === 'entry' ? 'Welcome!' : 'Goodbye!'}
                </span>
                <span className="attendance-popup-name-big">{attendancePopup.name}</span>
                {attendancePopup.type === 'exit' && attendancePopup.duration !== undefined && (
                  <span className="attendance-popup-conf">Duration: {attendancePopup.duration} minutes</span>
                )}
                <span className="attendance-popup-hint">Press <kbd>Enter</kbd> to continue</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="recent-attendance-section">
        <div className="attendance-card">
          <div className="attendance-card-header">
            <h3><UserCheck size={20} /> Recent Events</h3>
            <span className="count-badge">{recentEvents.length}</span>
          </div>

          {recentEvents.length === 0 ? (
            <div className="empty-state small">
              <UserCheck size={36} />
              <p>No events recorded yet</p>
              <span>Face the camera to record an event</span>
            </div>
          ) : (
            <div className="recent-list">
              {recentEvents.map((record, idx) => (
                <div key={idx} className={`recent-item ${record.type}`}>
                  <div className="recent-item-icon">
                    {record.type === 'entry' ? <LogIn size={18} /> : <LogOut size={18} />}
                  </div>
                  <div className="recent-item-info">
                    <span className="recent-item-name">{record.name}</span>
                    <span className="recent-item-time">
                      {new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(record.time)}
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
            <span className="stat-value">{recentEvents.filter(e => e.type === 'entry').length}</span>
            <span className="stat-label">Today's Entries</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EntranceAttendance;
