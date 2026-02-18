import React from 'react';
import { type BarcodeEntry, deleteBarcode, clearAllBarcodes } from '../db/database';
import { List, Trash2, Clock, Hash, BarChart3, Trash, Copy, CheckCircle } from 'lucide-react';

interface ScannedBarcodesListProps {
  barcodes: BarcodeEntry[];
  onRefresh: () => void;
}

const ScannedBarcodesList: React.FC<ScannedBarcodesListProps> = ({ barcodes, onRefresh }) => {
  const [copiedId, setCopiedId] = React.useState<number | null>(null);

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this entry?')) {
      await deleteBarcode(id);
      onRefresh();
    }
  };

  const handleClearAll = async () => {
    if (confirm('Are you sure you want to delete ALL scanned barcodes? This cannot be undone.')) {
      await clearAllBarcodes();
      onRefresh();
    }
  };

  const handleCopy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(date));
  };

  const getFormatColor = (format: string): string => {
    const formatColors: Record<string, string> = {
      'QR_CODE': '#8B5CF6',
      'EAN_13': '#10B981',
      'EAN_8': '#10B981',
      'CODE_128': '#3B82F6',
      'CODE_39': '#3B82F6',
      'UPC_A': '#F59E0B',
      'UPC_E': '#F59E0B',
      'DATA_MATRIX': '#EC4899',
      'PDF417': '#6366F1',
      'AZTEC': '#14B8A6'
    };
    return formatColors[format] || '#6B7280';
  };

  return (
    <div className="barcodes-list-container">
      <div className="list-header">
        <h2>
          <List size={24} />
          Scanned Barcodes
          <span className="count-badge">{barcodes.length}</span>
        </h2>
        {barcodes.length > 0 && (
          <button className="clear-all-btn" onClick={handleClearAll}>
            <Trash size={16} />
            Clear All
          </button>
        )}
      </div>

      {barcodes.length === 0 ? (
        <div className="empty-state">
          <BarChart3 size={48} />
          <p>No barcodes scanned yet</p>
          <span>Point your camera at a barcode to scan</span>
        </div>
      ) : (
        <div className="barcodes-grid">
          {barcodes.map((barcode) => (
            <div key={barcode.id} className="barcode-card">
              <div className="card-header">
                <span 
                  className="format-badge"
                  style={{ backgroundColor: getFormatColor(barcode.barcodeFormat) }}
                >
                  {barcode.barcodeFormat}
                </span>
                <div className="card-actions">
                  <button 
                    className="icon-btn copy"
                    onClick={() => handleCopy(barcode.barcodeText, barcode.id!)}
                    title="Copy barcode"
                  >
                    {copiedId === barcode.id ? (
                      <CheckCircle size={16} />
                    ) : (
                      <Copy size={16} />
                    )}
                  </button>
                  <button 
                    className="icon-btn delete"
                    onClick={() => handleDelete(barcode.id!)}
                    title="Delete entry"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              
              <div className="barcode-text">
                <Hash size={14} />
                <span>{barcode.barcodeText}</span>
              </div>

              <div className="card-footer">
                <div className="timestamp">
                  <Clock size={12} />
                  <span>{formatDate(barcode.scannedAt)}</span>
                </div>
                <div className="confidence">
                  {barcode.confidence}% confidence
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScannedBarcodesList;
