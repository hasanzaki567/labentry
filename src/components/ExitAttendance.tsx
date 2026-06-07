import React from 'react';
import EntranceAttendance from './EntranceAttendance';

const ExitAttendance: React.FC<{ modelsLoaded: boolean }> = ({ modelsLoaded }) => {
  return <EntranceAttendance modelsLoaded={modelsLoaded} isExit={true} />;
};

export default ExitAttendance;
