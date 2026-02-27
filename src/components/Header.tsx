import React from 'react';
import { Scan } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="app-header">
      <div className="header-left">
        <div className="logo">
          <Scan size={32} />
          <div className="logo-text">
            <h1>LabEntry</h1>
            <span>Attendance System</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
