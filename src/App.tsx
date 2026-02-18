import { useState, useEffect, useCallback } from 'react';
import { getAllBarcodes, type BarcodeEntry } from './db/database';
import Header from './components/Header';
import BarcodeScanner from './components/BarcodeScanner';
import ScannedBarcodesList from './components/ScannedBarcodesList';
import './App.css';

function App() {
  const [barcodes, setBarcodes] = useState<BarcodeEntry[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  // Load saved barcodes on mount
  useEffect(() => {
    loadBarcodes();
  }, []);

  const loadBarcodes = useCallback(async () => {
    const data = await getAllBarcodes();
    setBarcodes(data);
  }, []);

  const handleBarcodeScanned = useCallback((barcode: BarcodeEntry) => {
    setBarcodes(prev => [barcode, ...prev]);
  }, []);

  return (
    <div className="app">
      <Header totalScans={barcodes.length} isScanning={isScanning} />
      
      <main className="app-main">
        <div className="scanner-section">
          <BarcodeScanner 
            onBarcodeScanned={handleBarcodeScanned}
            isScanning={isScanning}
            setIsScanning={setIsScanning}
          />
        </div>
        
        <div className="list-section">
          <ScannedBarcodesList 
            barcodes={barcodes} 
            onRefresh={loadBarcodes}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
