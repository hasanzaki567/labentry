import { useState, useEffect } from 'react';
import * as faceapi from '@vladmandic/face-api';
import Header from './components/Header';
import FaceRegistration from './components/FaceRegistration';
import EntranceAttendance from './components/EntranceAttendance';
import ExitAttendance from './components/ExitAttendance';
import AttendanceRecords from './components/AttendanceRecords';
import WorkingLogic from './components/WorkingLogic';
import './App.css';

type AppTab = 'face-register' | 'entrance-scan' | 'exit-scan' | 'attendance-records' | 'working-logic';

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('entrance-scan');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Load face-api models when a face-related tab is accessed
  useEffect(() => {
    if (!modelsLoaded && !modelsLoading) {
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
      console.log('Face-api core models loaded successfully');

      try {
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
        console.log('Expression model loaded');
      } catch (exprErr) {
        console.warn('Expression model failed to load (emojis disabled):', exprErr);
      }
    } catch (err) {
      console.error('Failed to load face-api models:', err);
    } finally {
      setModelsLoading(false);
    }
  };

  return (
    <div className="app">
      <Header />
      
      <nav className="app-tabs">
        <button 
          className={`tab-btn ${activeTab === 'face-register' ? 'active' : ''}`}
          onClick={() => setActiveTab('face-register')}
        >
          <span className="tab-icon">👤</span>
          Register Face
        </button>
        <button 
          className={`tab-btn ${activeTab === 'entrance-scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('entrance-scan')}
        >
          <span className="tab-icon">🚪</span>
          Entrance Scan
        </button>
        <button 
          className={`tab-btn ${activeTab === 'exit-scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('exit-scan')}
        >
          <span className="tab-icon">🚶</span>
          Exit Scan
        </button>
        <button 
          className={`tab-btn ${activeTab === 'attendance-records' ? 'active' : ''}`}
          onClick={() => setActiveTab('attendance-records')}
        >
          <span className="tab-icon">📋</span>
          Records
        </button>
        <button 
          className={`tab-btn ${activeTab === 'working-logic' ? 'active' : ''}`}
          onClick={() => setActiveTab('working-logic')}
        >
          <span className="tab-icon">🧠</span>
          Working Logic
        </button>
      </nav>

      {modelsLoading && (
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

        {activeTab === 'entrance-scan' && (
          <div className="face-section">
            <EntranceAttendance modelsLoaded={modelsLoaded} />
          </div>
        )}

        {activeTab === 'exit-scan' && (
          <div className="face-section">
            <ExitAttendance modelsLoaded={modelsLoaded} />
          </div>
        )}

        {activeTab === 'attendance-records' && (
          <div className="records-section">
            <AttendanceRecords />
          </div>
        )}

        {activeTab === 'working-logic' && (
          <div className="face-section">
            <WorkingLogic modelsLoaded={modelsLoaded} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
