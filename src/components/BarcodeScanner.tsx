import React, { useEffect, useRef, useState } from 'react';
import * as ZBar from '@undecaf/zbar-wasm';
import { addBarcode, type BarcodeEntry } from '../db/database';
import { Camera, CameraOff, Loader2, AlertCircle, ScanLine } from 'lucide-react';

interface BarcodeScannerProps {
  onBarcodeScanned: (barcode: BarcodeEntry) => void;
  isScanning: boolean;
  setIsScanning: (scanning: boolean) => void;
}

// ZBar symbol type names
const ZBAR_SYMBOL_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'PARTIAL',
  2: 'EAN_2',
  5: 'EAN_5',
  8: 'EAN_8',
  9: 'UPCE',
  10: 'ISBN_10',
  12: 'UPCA',
  13: 'EAN_13',
  14: 'ISBN_13',
  15: 'COMPOSITE',
  25: 'I25',
  34: 'DATABAR',
  35: 'DATABAR_EXP',
  38: 'CODABAR',
  39: 'CODE_39',
  57: 'PDF417',
  64: 'QR_CODE',
  93: 'CODE_93',
  128: 'CODE_128',
};

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onBarcodeScanned,
  isScanning,
  setIsScanning
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const lastScannedRef = useRef<string | null>(null);
  const scannerRef = useRef<ZBar.ZBarScanner | null>(null);
  
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [zbarReady, setZbarReady] = useState(false);

  // Initialize ZBar on mount
  useEffect(() => {
    let mounted = true;
    
    const initZbar = async () => {
      try {
        console.log('Initializing ZBar WASM...');
        
        // Configure WASM location - tell ZBar where to find the WASM file
        ZBar.setModuleArgs({
          locateFile: (file: string) => {
            // In development, vite-plugin-static-copy puts it in the output
            // In production, it's in the same directory
            if (file.endsWith('.wasm')) {
              return '/zbar.wasm';
            }
            return file;
          }
        });
        
        // Create a scanner instance
        const scanner = await ZBar.ZBarScanner.create();
        if (mounted) {
          scannerRef.current = scanner;
          setZbarReady(true);
          console.log('ZBar WASM initialized successfully');
        }
      } catch (err) {
        console.error('Failed to initialize ZBar:', err);
        if (mounted) {
          setError(`Failed to initialize barcode scanner: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    };
    
    initZbar();
    
    return () => {
      mounted = false;
      if (scannerRef.current) {
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, []);

  const scanFrame = async () => {
    if (!videoRef.current || !canvasRef.current || !zbarReady || !scannerRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      // Get image data for ZBar
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Scan using ZBar (same engine as pyzbar!)
      const symbols = await ZBar.scanImageData(imageData, scannerRef.current);

      if (symbols.length > 0) {
        for (const symbol of symbols) {
          const decodedText = symbol.decode();
          
          // Prevent duplicate scans
          if (lastScannedRef.current === decodedText) continue;
          
          lastScannedRef.current = decodedText;
          setLastScannedCode(decodedText);

          const formatName = ZBAR_SYMBOL_NAMES[symbol.type] || `TYPE_${symbol.type}`;
          console.log('ZBar detected barcode:', decodedText, formatName);

          const barcodeEntry: Omit<BarcodeEntry, 'id'> = {
            barcodeText: decodedText,
            barcodeFormat: formatName,
            scannedAt: new Date(),
            confidence: symbol.quality,
            rawData: JSON.stringify({
              type: symbol.type,
              typeName: symbol.typeName,
              quality: symbol.quality,
              points: symbol.points
            })
          };

          // Save to database
          const id = await addBarcode(barcodeEntry);
          
          // Notify parent component
          onBarcodeScanned({ ...barcodeEntry, id });

          // Draw detection overlay
          if (symbol.points && symbol.points.length > 0) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(symbol.points[0].x, symbol.points[0].y);
            for (let i = 1; i < symbol.points.length; i++) {
              ctx.lineTo(symbol.points[i].x, symbol.points[i].y);
            }
            ctx.closePath();
            ctx.stroke();
          }

          // Reset after 2 seconds
          setTimeout(() => {
            lastScannedRef.current = null;
            setLastScannedCode(null);
          }, 2000);
        }
      }
    } catch (err) {
      // Detection error - continue scanning
      console.error('ZBar scan error:', err);
    }
  };

  const startScanning = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }
    
    // Scan every 100ms for responsive detection
    scanIntervalRef.current = window.setInterval(scanFrame, 100);
  };

  const initializeScanner = async () => {
    if (isInitializing) return;
    
    setIsInitializing(true);
    setError(null);

    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsScanning(true);
      
      // Start scanning loop
      setTimeout(() => {
        startScanning();
      }, 500);

    } catch (err) {
      console.error('Scanner initialization error:', err);
      let errorMsg = err instanceof Error ? err.message : 'Failed to initialize scanner';
      
      if (errorMsg.includes('NotAllowedError')) {
        errorMsg = 'Camera access denied. Please allow camera access and try again.';
      } else if (errorMsg.includes('NotFoundError')) {
        errorMsg = 'No camera found on this device.';
      }
      
      setError(errorMsg);
    } finally {
      setIsInitializing(false);
    }
  };

  const stopScanning = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
    setLastScannedCode(null);
    lastScannedRef.current = null;
  };

  // Auto-start scanning on mount when ZBar is ready
  useEffect(() => {
    if (zbarReady) {
      const timer = setTimeout(() => {
        initializeScanner();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [zbarReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, []);

  const toggleScanning = async () => {
    if (isScanning) {
      stopScanning();
    } else {
      await initializeScanner();
    }
  };

  return (
    <div className="scanner-container">
      <div className="scanner-header">
        <h2>
          <ScanLine size={24} />
          ZBar Scanner
        </h2>
        <button 
          className={`scan-toggle-btn ${isScanning ? 'scanning' : ''}`}
          onClick={toggleScanning}
          disabled={isInitializing || !zbarReady}
        >
          {isInitializing || !zbarReady ? (
            <>
              <Loader2 size={18} className="spin" />
              {!zbarReady ? 'Loading ZBar...' : 'Initializing...'}
            </>
          ) : isScanning ? (
            <>
              <CameraOff size={18} />
              Stop Scanning
            </>
          ) : (
            <>
              <Camera size={18} />
              Start Scanning
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
          className={isScanning ? 'active' : ''}
        />
        <canvas 
          ref={canvasRef} 
          className="detection-canvas"
        />
        
        {isScanning && (
          <div className="scan-overlay">
            <div className="scan-frame">
              <div className="scan-line"></div>
              <div className="corner tl"></div>
              <div className="corner tr"></div>
              <div className="corner bl"></div>
              <div className="corner br"></div>
            </div>
          </div>
        )}

        {!isScanning && !isInitializing && (
          <div className="scanner-placeholder">
            <Camera size={64} />
            <p>Click "Start Scanning" to begin</p>
          </div>
        )}

        {isInitializing && (
          <div className="scanner-placeholder">
            <Loader2 size={64} className="spin" />
            <p>Initializing ZBar scanner...</p>
          </div>
        )}
      </div>

      {lastScannedCode && (
        <div className="last-scanned">
          <span className="label">Detected:</span>
          <span className="code">{lastScannedCode}</span>
        </div>
      )}
    </div>
  );
};

export default BarcodeScanner;
