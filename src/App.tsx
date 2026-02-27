import { useState, useEffect } from 'react';
import * as faceapi from '@vladmandic/face-api';
import Header from './components/Header';
import FaceRegistration from './components/FaceRegistration';
import FaceAttendance from './components/FaceAttendance';
import AttendanceRecords from './components/AttendanceRecords';
import './App.css';

type AppTab = 'face-register' | 'face-attendance' | 'attendance-records';

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('face-register');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Load face-api models when face tab is first accessed
  useEffect(() => {
    if ((activeTab === 'face-register' || activeTab === 'face-attendance') && !modelsLoaded && !modelsLoading) {
      loadFaceModels();
    }
  }, [activeTab, modelsLoaded, modelsLoading]);

  const loadFaceModels = async () => {
    setModelsLoading(true);
    try {
      const MODEL_URL = '/models';
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      setModelsLoaded(true);
      console.log('Face-api models loaded successfully');
    } catch (err) {
      console.error('Failed to load face-api models:', err);
    } finally {
      setModelsLoading(false);
    }
  };

  return (
    <div className="app">
      <Header />
      
      {/* Tab Navigation */}
      <nav className="app-tabs">
        <button 
          className={`tab-btn ${activeTab === 'face-register' ? 'active' : ''}`}
          onClick={() => setActiveTab('face-register')}
        >
          <span className="tab-icon">👤</span>
          Register Face
        </button>
        <button 
          className={`tab-btn ${activeTab === 'face-attendance' ? 'active' : ''}`}
          onClick={() => setActiveTab('face-attendance')}
        >
          <span className="tab-icon">📸</span>
          Face Attendance
        </button>
        <button 
          className={`tab-btn ${activeTab === 'attendance-records' ? 'active' : ''}`}
          onClick={() => setActiveTab('attendance-records')}
        >
          <span className="tab-icon">📋</span>
          Records
        </button>
      </nav>

      {/* Models Loading Indicator */}
      {modelsLoading && (activeTab === 'face-register' || activeTab === 'face-attendance') && (
        <div className="models-loading-bar">
          <div className="models-loading-progress"></div>
          <span>Loading face recognition models...</span>
        </div>
      )}

      <main className="app-main">
        {activeTab === 'face-register' && (
          <div className="face-section">
            <FaceRegistration modelsLoaded={modelsLoaded} />
          </div>
        )}

        {activeTab === 'face-attendance' && (
          <div className="face-section">
            <FaceAttendance modelsLoaded={modelsLoaded} />
          </div>
        )}

        {activeTab === 'attendance-records' && (
          <div className="records-section">
            <AttendanceRecords />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
