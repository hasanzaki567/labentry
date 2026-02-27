import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { getAllFaces, type RegisteredFace } from '../db/database';
import {
  Camera,
  CameraOff,
  Loader2,
  AlertCircle,
  Play,
  RotateCcw,
  Eye,
  Cpu,
  Fingerprint,
  GitCompare,
} from 'lucide-react';

interface WorkingLogicProps {
  modelsLoaded: boolean;
}

type Phase = 'idle' | 'detection' | 'landmarks' | 'analysis' | 'matching' | 'done';

interface MatchResult {
  name: string;
  confidence: number;
  photoDataUrl?: string;
}

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Waiting to start…',
  detection: 'Phase 1 — Detection',
  landmarks: 'Phase 2 — Landmark Mapping',
  analysis: 'Phase 3 — Faceprint Generation',
  matching: 'Phase 4 — Matching',
  done: 'Recognition Complete',
};

const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  idle: 'Click "Start Demo" to begin the face recognition walkthrough.',
  detection: 'Scanning the frame for a face using SSD-MobileNet v1… A bounding box will appear when a face is found.',
  landmarks: 'Mapping 68 facial landmarks one by one — eyes, nose, jawline, mouth…',
  analysis: 'Extracting the 128-dimensional face descriptor (the mathematical "faceprint").',
  matching: 'Comparing the live faceprint against the registered gallery…',
  done: 'All four phases complete!',
};

const WorkingLogic: React.FC<WorkingLogicProps> = ({ modelsLoaded }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase state
  const [phase, setPhase] = useState<Phase>('idle');
  const [running, setRunning] = useState(false);

  // Detection
  const [, setDetectionBox] = useState<faceapi.IRect | null>(null);
  const [, setScanProgress] = useState(0); // 0-100

  // Landmarks
  const [landmarkPoints, setLandmarkPoints] = useState<{ x: number; y: number }[]>([]);
  const [drawnLandmarks, setDrawnLandmarks] = useState(0);
  const [landmarkLabels, setLandmarkLabels] = useState<string[]>([]);

  // Analysis (descriptor)
  const [descriptor, setDescriptor] = useState<number[]>([]);
  const [revealedDescCount, setRevealedDescCount] = useState(0);

  // Matching
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [matchProgress, setMatchProgress] = useState(0); // 0-100
  const [matchScanning, setMatchScanning] = useState(false);
  const [registeredFaces, setRegisteredFaces] = useState<RegisteredFace[]>([]);

  // Match photo image for canvas drawing
  const matchImgRef = useRef<HTMLImageElement | null>(null);
  const matchResultRef = useRef<MatchResult | null>(null);
  const matchProgressRef = useRef(0);
  const revealedDescRef = useRef(0);
  const descriptorRef = useRef<number[]>([]);
  const drawnLandmarksRef = useRef(0);
  const scanProgressRef = useRef(0);
  const detectionBoxRef = useRef<faceapi.IRect | null>(null);
  const landmarkPointsRef = useRef<{ x: number; y: number }[]>([]);
  const currentLabelRef = useRef<string>('');
  const autoResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for phase logic
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  // Landmark region definitions (68-point model)
  const LANDMARK_GROUPS = [
    { name: 'Jawline', start: 0, end: 16, closed: false, color: '#f59e0b' },
    { name: 'Left Eyebrow', start: 17, end: 21, closed: false, color: '#a78bfa' },
    { name: 'Right Eyebrow', start: 22, end: 26, closed: false, color: '#a78bfa' },
    { name: 'Nose Bridge', start: 27, end: 30, closed: false, color: '#60a5fa' },
    { name: 'Nose Tip', start: 31, end: 35, closed: false, color: '#60a5fa' },
    { name: 'Left Eye', start: 36, end: 41, closed: true, color: '#34d399' },
    { name: 'Right Eye', start: 42, end: 47, closed: true, color: '#34d399' },
    { name: 'Outer Lips', start: 48, end: 59, closed: true, color: '#f87171' },
    { name: 'Inner Lips', start: 60, end: 67, closed: true, color: '#fb923c' },
  ];

  /* ──────── Camera ──────── */
  const startCamera = async () => {
    if (initializing) return;
    setInitializing(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera failed');
    } finally {
      setInitializing(false);
    }
  };

  const stopCamera = () => {
    cleanup();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const cleanup = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoResetRef.current) clearTimeout(autoResetRef.current);
    animRef.current = null;
    intervalRef.current = null;
    autoResetRef.current = null;
  };

  useEffect(() => {
    getAllFaces().then(setRegisteredFaces);
    return () => {
      cleanup();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  /* ──────── Canvas drawing loop ──────── */
  const drawLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.videoWidth === 0) {
      animRef.current = requestAnimationFrame(drawLoop);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const p = phaseRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const box = detectionBoxRef.current;
    const pts = landmarkPointsRef.current;
    const drawn = drawnLandmarksRef.current;
    const desc = descriptorRef.current;
    const descRevealed = revealedDescRef.current;
    const mResult = matchResultRef.current;
    const mProg = matchProgressRef.current;

    /* ─── Helper: draw text counter-flipped (readable on mirrored canvas) ─── */
    const flipText = (text: string, x: number, y: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };

    /* ─── Helper: draw a rounded-rect label (counter-flipped) ─── */
    const drawLabel = (text: string, cx: number, cy: number, bgColor: string, textColor = '#fff', fontSize = 11) => {
      ctx.save();
      ctx.font = `bold ${fontSize}px Inter, sans-serif`;
      const m = ctx.measureText(text);
      const pw = 6, ph = 3;
      const lw = m.width + pw * 2;
      const lh = fontSize + ph * 2;
      // Flip around cx,cy so text reads correctly
      ctx.translate(cx, cy);
      ctx.scale(-1, 1);
      const rx = -lw / 2, ry = -lh / 2;
      ctx.fillStyle = bgColor;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(rx, ry, lw, lh, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };

    /* ─── Phase overlay banner (top-left) ─── */
    if (p !== 'idle') {
      ctx.save();
      // Semi-transparent top bar
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, 38);
      ctx.font = 'bold 14px Inter, sans-serif';
      ctx.fillStyle = '#818cf8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const phaseTexts: Record<string, string> = {
        detection: '⟐  PHASE 1 — DETECTING FACE',
        landmarks: '⟐  PHASE 2 — MAPPING LANDMARKS',
        analysis: '⟐  PHASE 3 — GENERATING FACEPRINT',
        matching: '⟐  PHASE 4 — MATCHING',
        done: '✓  RECOGNITION COMPLETE',
      };
      flipText(phaseTexts[p] || '', 14, 20);
      // Currently labeling region
      if (p === 'landmarks' && currentLabelRef.current) {
        ctx.fillStyle = '#34d399';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        flipText(`Mapping: ${currentLabelRef.current}`, W - 14, 20);
      }
      ctx.restore();
    }

    /* ═══ PHASE 1: Detection ═══ */
    if (p === 'detection' || p === 'landmarks' || p === 'analysis' || p === 'matching' || p === 'done') {
      // Scan laser line (only during detection phase)
      if (p === 'detection') {
        const y = (scanProgressRef.current / 100) * H;
        ctx.save();
        // Glow trail
        const grad = ctx.createLinearGradient(0, y - 40, 0, y);
        grad.addColorStop(0, 'rgba(129, 140, 248, 0)');
        grad.addColorStop(1, 'rgba(129, 140, 248, 0.15)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, y - 40, W, 40);
        // Laser line
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 25;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.restore();

        // "SCANNING..." text in center
        if (!box) {
          ctx.save();
          ctx.font = 'bold 16px Inter, sans-serif';
          ctx.fillStyle = '#818cf8';
          ctx.textAlign = 'center';
          ctx.shadowColor = '#818cf8';
          ctx.shadowBlur = 15;
          flipText('SCANNING FOR FACE...', W / 2, H / 2);
          ctx.restore();
        }
      }

      // Bounding box
      if (box) {
        const { x, y, width, height } = box;
        ctx.save();
        const boxColor = p === 'detection' ? '#818cf8' : '#10b981';
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = boxColor;
        ctx.shadowBlur = 12;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);

        // Corner brackets
        const c = 20;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 20;
        ctx.strokeStyle = boxColor;
        // TL
        ctx.beginPath(); ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y); ctx.stroke();
        // TR
        ctx.beginPath(); ctx.moveTo(x + width - c, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + c); ctx.stroke();
        // BL
        ctx.beginPath(); ctx.moveTo(x, y + height - c); ctx.lineTo(x, y + height); ctx.lineTo(x + c, y + height); ctx.stroke();
        // BR
        ctx.beginPath(); ctx.moveTo(x + width - c, y + height); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width, y + height - c); ctx.stroke();

        ctx.restore();

        // Label above box: "FACE DETECTED" or name in later phases
        if (p === 'detection') {
          drawLabel('FACE DETECTED', x + width / 2, y - 14, '#818cf8');
        } else if (p === 'done' && mResult && mResult.confidence >= 55) {
          drawLabel(`✓ ${mResult.name} — ${mResult.confidence}%`, x + width / 2, y - 14, '#059669');
        } else if (p === 'done' && mResult) {
          drawLabel('UNKNOWN FACE', x + width / 2, y - 14, '#dc2626');
        }

        // Dimensions line under box
        if (p === 'detection') {
          ctx.save();
          ctx.font = '10px Monaco, Consolas, monospace';
          ctx.fillStyle = 'rgba(129,140,248,0.7)';
          ctx.textAlign = 'center';
          flipText(`${Math.round(width)}×${Math.round(height)}px`, x + width / 2, y + height + 16);
          ctx.restore();
        }
      }
    }

    /* ═══ PHASE 2: Landmarks ═══ */
    if ((p === 'landmarks' || p === 'analysis' || p === 'matching' || p === 'done') && pts.length > 0) {
      const visible = pts.slice(0, drawn);

      // Draw landmark group connections with proper topology
      for (const group of LANDMARK_GROUPS) {
        const groupPts = [];
        for (let i = group.start; i <= Math.min(group.end, drawn - 1); i++) {
          groupPts.push(pts[i]);
        }
        if (groupPts.length < 2) continue;

        // Draw connection lines for this group
        ctx.save();
        ctx.strokeStyle = group.color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.shadowColor = group.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(groupPts[0].x, groupPts[0].y);
        for (let i = 1; i < groupPts.length; i++) {
          ctx.lineTo(groupPts[i].x, groupPts[i].y);
        }
        // Close the shape if it is a closed group and all points are drawn
        if (group.closed && drawn > group.end) {
          ctx.closePath();
        }
        ctx.stroke();
        ctx.restore();

        // Draw region label at the centroid of each group (only when group is complete)
        if (drawn > group.end) {
          const cx = groupPts.reduce((s, p) => s + p.x, 0) / groupPts.length;
          const cy = groupPts.reduce((s, p) => s + p.y, 0) / groupPts.length;
          // Offset label so it doesn't overlap the shape
          const labelY = group.name.includes('Eye') ? cy - 14
            : group.name.includes('Lip') ? cy + 16
            : group.name === 'Jawline' ? cy + 16
            : cy - 14;
          drawLabel(group.name, cx, labelY, group.color, '#fff', 9);
        }
      }

      // Draw individual landmark dots
      for (let i = 0; i < visible.length; i++) {
        const pt = visible[i];
        // Find which group this point belongs to for coloring
        let dotColor = '#34d399';
        for (const g of LANDMARK_GROUPS) {
          if (i >= g.start && i <= g.end) { dotColor = g.color; break; }
        }
        ctx.save();
        ctx.fillStyle = dotColor;
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Point counter label (bottom-right of face box)
      if (box && p === 'landmarks') {
        drawLabel(`${drawn}/68 points`, box.x + box.width, box.y + box.height + 16, 'rgba(0,0,0,0.7)', '#34d399', 11);
      }
    }

    /* ═══ PHASE 3: Faceprint on canvas (Matrix rain beside face) ═══ */
    if ((p === 'analysis' || p === 'matching' || p === 'done') && desc.length > 0 && box) {
      const colX = box.x + box.width + 16; // Right of the face box
      const startY = box.y;
      const lineH = 13;
      const maxLines = Math.min(descRevealed, Math.floor((H - startY - 20) / lineH));

      ctx.save();
      // Background strip
      const stripW = 110;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(colX - 4, startY - 4, stripW, maxLines * lineH + 8);
      ctx.strokeStyle = 'rgba(129,140,248,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(colX - 4, startY - 4, stripW, maxLines * lineH + 8);

      ctx.font = '10px Monaco, Consolas, monospace';
      ctx.textAlign = 'left';

      for (let i = 0; i < maxLines; i++) {
        const val = desc[i];
        // Color intensity based on value
        const intensity = Math.min(1, Math.abs(val) * 4);
        ctx.fillStyle = `rgba(129, 140, 248, ${0.4 + intensity * 0.6})`;
        flipText(`[${String(i).padStart(3, '0')}] ${val >= 0 ? '+' : ''}${val.toFixed(4)}`, colX, startY + i * lineH + lineH);
      }

      // Header label
      drawLabel(`FACEPRINT ${descRevealed}/128`, colX + stripW / 2 - 4, startY - 14, '#818cf8', '#fff', 10);
      ctx.restore();
    }

    /* ═══ PHASE 4: Match visualization on canvas ═══ */
    if ((p === 'matching' || p === 'done') && box) {
      // Draw a progress bar on the video
      const barW = 200, barH = 20;
      const barX = (W - barW) / 2;
      const barY = H - 50;

      ctx.save();
      // Bar background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.roundRect(barX - 2, barY - 2, barW + 4, barH + 4, 6);
      ctx.fill();
      // Bar track
      ctx.fillStyle = 'rgba(55,65,81,0.8)';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 4);
      ctx.fill();
      // Bar fill
      const fillW = (mProg / 100) * barW;
      if (fillW > 0) {
        const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
        barGrad.addColorStop(0, '#818cf8');
        barGrad.addColorStop(1, '#34d399');
        ctx.fillStyle = barGrad;
        ctx.beginPath();
        ctx.roundRect(barX, barY, fillW, barH, 4);
        ctx.fill();
      }
      // Bar text
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      flipText(`Matching: ${mProg}%`, barX + barW / 2, barY + barH / 2);
      ctx.restore();

      // Draw match result overlay at the bottom
      if (p === 'done' && mResult) {
        const isMatch = mResult.confidence >= 55;

        // "Flying" connection line from face to result
        ctx.save();
        ctx.strokeStyle = isMatch ? '#34d399' : '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.shadowColor = isMatch ? '#34d399' : '#ef4444';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(box.x + box.width / 2, box.y + box.height);
        ctx.lineTo(W / 2, H - 80);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Result banner
        const bannerH = 40;
        const bannerY = H - 80;
        ctx.save();
        ctx.fillStyle = isMatch ? 'rgba(5, 150, 105, 0.85)' : 'rgba(185, 28, 28, 0.85)';
        ctx.beginPath();
        ctx.roundRect(20, bannerY, W - 40, bannerH, 8);
        ctx.fill();
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (isMatch) {
          flipText(`✓ MATCH FOUND: ${mResult.name} — ${mResult.confidence}% confidence`, W / 2, bannerY + bannerH / 2);
        } else {
          flipText(`✗ NO MATCH — ${mResult.name}`, W / 2, bannerY + bannerH / 2);
        }
        ctx.restore();

        // Draw the stored match photo on canvas (if loaded)
        if (matchImgRef.current && matchImgRef.current.complete && isMatch) {
          const imgSize = 56;
          const imgX = W - imgSize - 16;
          const imgY = bannerY - imgSize - 12;
          // Circle clip
          ctx.save();
          ctx.beginPath();
          ctx.arc(imgX + imgSize / 2, imgY + imgSize / 2, imgSize / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(matchImgRef.current, imgX, imgY, imgSize, imgSize);
          ctx.restore();
          // Border
          ctx.save();
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 3;
          ctx.shadowColor = '#34d399';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(imgX + imgSize / 2, imgY + imgSize / 2, imgSize / 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          drawLabel('GALLERY', imgX + imgSize / 2, imgY - 10, '#059669', '#fff', 9);
        }
      }
    }

    animRef.current = requestAnimationFrame(drawLoop);
  }, []);

  /* ──────── Start / Reset Demo ──────── */
  const resetDemo = () => {
    cleanup();
    setPhase('idle');
    setRunning(false);
    setDetectionBox(null); detectionBoxRef.current = null;
    setScanProgress(0); scanProgressRef.current = 0;
    setLandmarkPoints([]); landmarkPointsRef.current = [];
    setDrawnLandmarks(0); drawnLandmarksRef.current = 0;
    setLandmarkLabels([]); currentLabelRef.current = '';
    setDescriptor([]); descriptorRef.current = [];
    setRevealedDescCount(0); revealedDescRef.current = 0;
    setMatchResult(null); matchResultRef.current = null;
    setMatchProgress(0); matchProgressRef.current = 0;
    setMatchScanning(false);
    matchImgRef.current = null;
    autoResetRef.current = null;
  };

  const startDemo = async () => {
    if (!cameraOn || !modelsLoaded) return;
    resetDemo();
    setRunning(true);

    // Start draw loop
    animRef.current = requestAnimationFrame(drawLoop);

    /* — Phase 1: Detection — */
    setPhase('detection');

    // Animate laser scan for 2 seconds
    await new Promise<void>(resolve => {
      let progress = 0;
      const id = setInterval(() => {
        progress += 2;
        setScanProgress(progress);
        scanProgressRef.current = progress;
        if (progress >= 100) {
          clearInterval(id);
          resolve();
        }
      }, 40); // 50 steps × 40ms = 2s
      intervalRef.current = id;
    });

    // Detect face
    const video = videoRef.current!;
    const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
    let result = await faceapi
      .detectSingleFace(video as any, ssdOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!result) {
      const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 });
      result = await faceapi
        .detectSingleFace(video as any, tinyOptions)
        .withFaceLandmarks()
        .withFaceDescriptor();
    }

    if (!result) {
      setError('No face detected. Please face the camera and try again.');
      setRunning(false);
      setPhase('idle');
      return;
    }

    const box = result.detection.box;
    const boxRect = { x: box.x, y: box.y, width: box.width, height: box.height };
    setDetectionBox(boxRect);
    detectionBoxRef.current = boxRect;

    // Hold for a moment so the user sees the box
    await sleep(1200);

    /* — Phase 2: Landmarks — */
    setPhase('landmarks');
    const points = result.landmarks.positions.map(p => ({ x: p.x, y: p.y }));
    setLandmarkPoints(points);
    landmarkPointsRef.current = points;

    // Landmark region labels
    const regionLabels = [
      { idx: 0, label: 'Jawline' },
      { idx: 17, label: 'Left Eyebrow' },
      { idx: 22, label: 'Right Eyebrow' },
      { idx: 27, label: 'Nose Bridge' },
      { idx: 31, label: 'Nose Tip' },
      { idx: 36, label: 'Left Eye' },
      { idx: 42, label: 'Right Eye' },
      { idx: 48, label: 'Outer Lips' },
      { idx: 60, label: 'Inner Lips' },
    ];

    // Draw 5 points every 200ms (slowed down for effect)
    await new Promise<void>(resolve => {
      let drawn = 0;
      const id = setInterval(() => {
        drawn += 5;
        if (drawn > points.length) drawn = points.length;
        setDrawnLandmarks(drawn);
        drawnLandmarksRef.current = drawn;

        // Check if we just passed a region boundary
        for (const r of regionLabels) {
          if (drawn >= r.idx && drawn < r.idx + 6) {
            currentLabelRef.current = r.label;
            setLandmarkLabels(prev => {
              if (prev.includes(r.label)) return prev;
              return [...prev, r.label];
            });
          }
        }

        if (drawn >= points.length) {
          clearInterval(id);
          resolve();
        }
      }, 200);
      intervalRef.current = id;
    });

    await sleep(800);

    /* — Phase 3: Faceprint (Descriptor) — */
    setPhase('analysis');
    const desc = Array.from(result.descriptor);
    setDescriptor(desc);
    descriptorRef.current = desc;

    // Reveal numbers slowly — 8 per tick
    await new Promise<void>(resolve => {
      let count = 0;
      const id = setInterval(() => {
        count += 8;
        if (count > 128) count = 128;
        setRevealedDescCount(count);
        revealedDescRef.current = count;
        if (count >= 128) {
          clearInterval(id);
          resolve();
        }
      }, 80);
      intervalRef.current = id;
    });

    await sleep(600);

    /* — Phase 4: Matching — */
    setPhase('matching');
    setMatchScanning(true);

    const faces = await getAllFaces();
    setRegisteredFaces(faces);

    if (faces.length === 0) {
      // No faces to match against  
      await animateProgress(100, 1500);
      setMatchScanning(false);
      const noResult = { name: 'No registered faces', confidence: 0 };
      setMatchResult(noResult);
      matchResultRef.current = noResult;
      setPhase('done');
      setRunning(false);
      autoResetRef.current = setTimeout(() => resetDemo(), 15000);
      return;
    }

    // Build matcher
    const descriptorsByName = new Map<string, { id: number; descriptors: Float32Array[]; photo: string }>();
    for (const face of faces) {
      const key = face.name.toLowerCase().trim();
      if (!descriptorsByName.has(key)) {
        descriptorsByName.set(key, { id: face.id!, descriptors: [], photo: face.photoDataUrl });
      }
      descriptorsByName.get(key)!.descriptors.push(new Float32Array(face.descriptor));
    }

    const labeled = Array.from(descriptorsByName.entries()).map(
      ([name, { id, descriptors }]) =>
        new faceapi.LabeledFaceDescriptors(`${id}:${name}`, descriptors)
    );

    const matcher = new faceapi.FaceMatcher(labeled, 0.45);
    const bestMatch = matcher.findBestMatch(result.descriptor);

    // Animate progress bar slowly
    const confidence = Math.round((1 - bestMatch.distance) * 100);
    await animateProgress(confidence, 2000);

    setMatchScanning(false);

    if (bestMatch.label !== 'unknown') {
      const [, rawName] = bestMatch.label.split(':');
      const displayName = rawName.replace(/\b\w/g, (c: string) => c.toUpperCase());
      const matchedFaceData = descriptorsByName.get(rawName);
      const mResult = {
        name: displayName,
        confidence,
        photoDataUrl: matchedFaceData?.photo,
      };
      setMatchResult(mResult);
      matchResultRef.current = mResult;
      // Preload match photo for canvas drawing
      if (matchedFaceData?.photo) {
        const img = new Image();
        img.src = matchedFaceData.photo;
        matchImgRef.current = img;
      }
    } else {
      const mResult = { name: 'Unknown', confidence };
      setMatchResult(mResult);
      matchResultRef.current = mResult;
    }

    setPhase('done');
    setRunning(false);
    autoResetRef.current = setTimeout(() => resetDemo(), 15000);
  };

  const animateProgress = (target: number, durationMs: number) =>
    new Promise<void>(resolve => {
      let current = 0;
      const step = target / (durationMs / 30);
      const id = setInterval(() => {
        current += step;
        if (current >= target) {
          current = target;
          clearInterval(id);
          resolve();
        }
        setMatchProgress(Math.round(current));
        matchProgressRef.current = Math.round(current);
      }, 30);
      intervalRef.current = id;
    });

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  /* ──────── Render helpers ──────── */
  const phaseIndex = ['idle', 'detection', 'landmarks', 'analysis', 'matching', 'done'].indexOf(phase);

  const renderPhaseIndicator = (idx: number, label: string, icon: React.ReactNode) => {
    const active = phaseIndex === idx;
    const completed = phaseIndex > idx;
    return (
      <div className={`wl-phase-step ${active ? 'active' : ''} ${completed ? 'completed' : ''}`} key={idx}>
        <div className="wl-phase-icon">{icon}</div>
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div className="wl-container">
      {/* Phase progress bar */}
      <div className="wl-phase-bar">
        {renderPhaseIndicator(1, 'Detection', <Eye size={18} />)}
        <div className={`wl-phase-connector ${phaseIndex > 1 ? 'filled' : ''}`} />
        {renderPhaseIndicator(2, 'Landmarks', <Cpu size={18} />)}
        <div className={`wl-phase-connector ${phaseIndex > 2 ? 'filled' : ''}`} />
        {renderPhaseIndicator(3, 'Faceprint', <Fingerprint size={18} />)}
        <div className={`wl-phase-connector ${phaseIndex > 3 ? 'filled' : ''}`} />
        {renderPhaseIndicator(4, 'Matching', <GitCompare size={18} />)}
      </div>

      <div className="wl-main-grid">
        {/* LEFT: Video + Canvas */}
        <div className="wl-video-section">
          <div className="wl-video-card">
            <div className="wl-video-header">
              <h2><Camera size={20} /> Live Camera</h2>
              <div className="wl-video-actions">
                {!cameraOn ? (
                  <button className="wl-btn primary" onClick={startCamera} disabled={initializing}>
                    {initializing ? <><Loader2 size={16} className="spin" /> Starting…</> : <><Camera size={16} /> Open Camera</>}
                  </button>
                ) : (
                  <>
                    <button
                      className="wl-btn success"
                      onClick={startDemo}
                      disabled={running || !modelsLoaded}
                    >
                      {running ? <><Loader2 size={16} className="spin" /> Running…</> : <><Play size={16} /> Start Demo</>}
                    </button>
                    {phase !== 'idle' && !running && (
                      <button className="wl-btn outline" onClick={resetDemo}>
                        <RotateCcw size={16} /> Reset
                      </button>
                    )}
                    <button className="wl-btn danger" onClick={stopCamera}>
                      <CameraOff size={16} /> Close
                    </button>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div className="wl-error">
                <AlertCircle size={18} /> {error}
              </div>
            )}

            <div className="wl-video-wrapper">
              <video ref={videoRef} playsInline muted autoPlay className={cameraOn ? 'active face-video' : 'face-video'} />
              <canvas ref={canvasRef} className="wl-overlay-canvas" />
              {!cameraOn && !initializing && (
                <div className="scanner-placeholder">
                  <Camera size={56} />
                  <p>Open the camera to begin</p>
                </div>
              )}
              {initializing && (
                <div className="scanner-placeholder">
                  <Loader2 size={56} className="spin" />
                  <p>Accessing camera…</p>
                </div>
              )}
            </div>

            {/* Phase status text */}
            <div className="wl-phase-status">
              <span className="wl-phase-label">{PHASE_LABELS[phase]}</span>
              <span className="wl-phase-desc">{PHASE_DESCRIPTIONS[phase]}</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Data Panel */}
        <div className="wl-data-section">
          {/* Landmark region labels */}
          {(phase === 'landmarks' || phase === 'analysis' || phase === 'matching' || phase === 'done') && (
            <div className="wl-data-card">
              <h3><Cpu size={18} /> Facial Landmarks <span className="wl-badge">{drawnLandmarks}/68</span></h3>
              <div className="wl-landmark-tags">
                {landmarkLabels.map((label, i) => (
                  <span className="wl-tag" key={i}>{label}</span>
                ))}
              </div>
              <div className="wl-landmark-grid">
                {landmarkPoints.slice(0, drawnLandmarks).map((pt, i) => (
                  <span className="wl-coord" key={i}>({pt.x.toFixed(0)},{pt.y.toFixed(0)})</span>
                ))}
              </div>
            </div>
          )}

          {/* Descriptor matrix */}
          {(phase === 'analysis' || phase === 'matching' || phase === 'done') && (
            <div className="wl-data-card matrix">
              <h3><Fingerprint size={18} /> Faceprint Vector <span className="wl-badge">{revealedDescCount}/128</span></h3>
              <div className="wl-matrix-scroll">
                {descriptor.slice(0, revealedDescCount).map((v, i) => (
                  <span className="wl-matrix-num" key={i}>{v.toFixed(4)}</span>
                ))}
              </div>
            </div>
          )}

          {/* Matching result */}
          {(phase === 'matching' || phase === 'done') && (
            <div className="wl-data-card matching">
              <h3><GitCompare size={18} /> Match Result</h3>

              {matchScanning && (
                <div className="wl-match-scanning">
                  <Loader2 size={20} className="spin" />
                  <span>Comparing against {registeredFaces.length} registered face(s)…</span>
                </div>
              )}

              <div className="wl-progress-bar-container">
                <div className="wl-progress-bar" style={{ width: `${matchProgress}%` }}>
                  <span>{matchProgress}%</span>
                </div>
              </div>

              {matchResult && (
                <div className={`wl-match-result ${matchResult.confidence >= 55 ? 'success' : 'fail'}`}>
                  {matchResult.photoDataUrl && (
                    <div className="wl-match-photo-fly">
                      <img src={matchResult.photoDataUrl} alt={matchResult.name} />
                    </div>
                  )}
                  <div className="wl-match-info">
                    <span className="wl-match-name">{matchResult.name}</span>
                    <span className="wl-match-conf">
                      {matchResult.confidence >= 55
                        ? `Match Found: ${matchResult.confidence}%`
                        : matchResult.name === 'Unknown'
                          ? 'No match in gallery'
                          : `Low confidence: ${matchResult.confidence}%`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Idle state */}
          {phase === 'idle' && (
            <div className="wl-data-card idle-hint">
              <div className="wl-idle-content">
                <Eye size={48} />
                <h3>How Face Recognition Works</h3>
                <p>This demo walks you through the four phases of face recognition in real-time:</p>
                <ol>
                  <li><strong>Detection</strong> — Find the face in the frame</li>
                  <li><strong>Landmarks</strong> — Map 68 facial feature points</li>
                  <li><strong>Faceprint</strong> — Generate a 128-number descriptor</li>
                  <li><strong>Matching</strong> — Compare against registered faces</li>
                </ol>
                <p className="wl-hint">Open the camera and click <strong>Start Demo</strong> to begin.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkingLogic;
