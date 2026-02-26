import React, { useState, useEffect } from 'react';
import { getAllAttendance, deleteAttendance, clearAllAttendance, type AttendanceRecord } from '../db/database';
import { ClipboardList, Trash2, Trash, Clock, UserCheck, Calendar, Search, Download } from 'lucide-react';

const AttendanceRecords: React.FC = () => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDate, setFilterDate] = useState('');

  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = async () => {
    const data = await getAllAttendance();
    setRecords(data);
  };

  const handleDelete = async (id: number) => {
    if (confirm('Delete this attendance record?')) {
      await deleteAttendance(id);
      await loadRecords();
    }
  };

  const handleClearAll = async () => {
    if (confirm('Delete ALL attendance records? This cannot be undone.')) {
      await clearAllAttendance();
      await loadRecords();
    }
  };

  const exportCSV = () => {
    const filtered = getFilteredRecords();
    const headers = ['Name', 'Date', 'Time', 'Confidence'];
    const rows = filtered.map(r => {
      const d = new Date(r.timestamp);
      return [
        r.name,
        d.toLocaleDateString(),
        d.toLocaleTimeString(),
        `${r.confidence}%`
      ];
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getFilteredRecords = () => {
    return records.filter(record => {
      const matchesSearch = !searchQuery || 
        record.name.toLowerCase().includes(searchQuery.toLowerCase());
      
      let matchesDate = true;
      if (filterDate) {
        const recordDate = new Date(record.timestamp).toISOString().split('T')[0];
        matchesDate = recordDate === filterDate;
      }

      return matchesSearch && matchesDate;
    });
  };

  const filteredRecords = getFilteredRecords();

  // Group records by date
  const groupedRecords = filteredRecords.reduce<Record<string, AttendanceRecord[]>>((groups, record) => {
    const date = new Date(record.timestamp).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(record);
    return groups;
  }, {});

  return (
    <div className="attendance-records-container">
      <div className="records-header">
        <div className="records-header-left">
          <h2>
            <ClipboardList size={24} />
            Attendance Records
            <span className="count-badge">{filteredRecords.length}</span>
          </h2>
        </div>
        <div className="records-header-actions">
          {records.length > 0 && (
            <>
              <button className="export-btn" onClick={exportCSV}>
                <Download size={16} />
                Export CSV
              </button>
              <button className="clear-all-btn" onClick={handleClearAll}>
                <Trash size={16} />
                Clear All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="records-filters">
        <div className="filter-input">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-input">
          <Calendar size={16} />
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="empty-state">
          <ClipboardList size={48} />
          <p>{records.length === 0 ? 'No attendance records yet' : 'No records match your filters'}</p>
          <span>{records.length === 0 ? 'Use Face Attendance to record entries' : 'Try adjusting your search or date filter'}</span>
        </div>
      ) : (
        <div className="records-grouped">
          {Object.entries(groupedRecords).map(([date, dateRecords]) => (
            <div key={date} className="record-group">
              <div className="record-group-header">
                <Calendar size={16} />
                <span>{date}</span>
                <span className="group-count">{dateRecords.length} entries</span>
              </div>

              <div className="record-group-items">
                {dateRecords.map((record) => (
                  <div key={record.id} className="attendance-record-card">
                    <div className="record-avatar">
                      {record.photoDataUrl ? (
                        <img src={record.photoDataUrl} alt={record.name} />
                      ) : (
                        <UserCheck size={24} />
                      )}
                    </div>
                    <div className="record-info">
                      <span className="record-name">{record.name}</span>
                      <span className="record-time">
                        <Clock size={12} />
                        {new Intl.DateTimeFormat('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        }).format(new Date(record.timestamp))}
                      </span>
                    </div>
                    <div className="record-confidence">
                      <span className={`confidence-badge ${record.confidence >= 70 ? 'high' : record.confidence >= 50 ? 'medium' : 'low'}`}>
                        {record.confidence}%
                      </span>
                    </div>
                    <button
                      className="icon-btn delete"
                      onClick={() => handleDelete(record.id!)}
                      title="Delete record"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AttendanceRecords;
