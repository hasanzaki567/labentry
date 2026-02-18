import React from 'react';
import { Scan, Database, Wifi, WifiOff } from 'lucide-react';

interface HeaderProps {
  totalScans: number;
  isScanning: boolean;
}

const Header: React.FC<HeaderProps> = ({ totalScans, isScanning }) => {
  return (
    <header className="app-header">
      <div className="header-left">
        <div className="logo">
          <Scan size={32} />
          <div className="logo-text">
            <h1>LabEntry</h1>
            <span>Barcode Scanner</span>
          </div>
        </div>
      </div>

      <div className="header-right">
        <div className="status-indicator">
          {isScanning ? (
            <Wifi size={18} className="live" />
          ) : (
            <WifiOff size={18} />
          )}
          <span>{isScanning ? 'Live' : 'Offline'}</span>
        </div>
        
        <div className="stats-badge">
          <Database size={16} />
          <span>{totalScans} scans</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
