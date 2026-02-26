import Dexie, { type Table } from 'dexie';

export interface BarcodeEntry {
  id?: number;
  barcodeText: string;
  barcodeFormat: string;
  scannedAt: Date;
  confidence: number;
  rawData?: string;
}

export interface RegisteredFace {
  id?: number;
  name: string;
  photoDataUrl: string; // base64 encoded image
  descriptor: number[]; // 128-dimensional face descriptor
  registeredAt: Date;
}

export interface AttendanceRecord {
  id?: number;
  faceId: number;
  name: string;
  timestamp: Date;
  confidence: number;
  photoDataUrl?: string; // snapshot at attendance time
}

export class LabEntryDatabase extends Dexie {
  barcodes!: Table<BarcodeEntry>;
  faces!: Table<RegisteredFace>;
  attendance!: Table<AttendanceRecord>;

  constructor() {
    super('LabEntryDB');
    this.version(1).stores({
      barcodes: '++id, barcodeText, barcodeFormat, scannedAt'
    });
    this.version(2).stores({
      barcodes: '++id, barcodeText, barcodeFormat, scannedAt',
      faces: '++id, name, registeredAt',
      attendance: '++id, faceId, name, timestamp'
    });
  }
}

export const db = new LabEntryDatabase();

// Barcode helper functions
export const addBarcode = async (entry: Omit<BarcodeEntry, 'id'>): Promise<number> => {
  return await db.barcodes.add(entry);
};

export const getAllBarcodes = async (): Promise<BarcodeEntry[]> => {
  return await db.barcodes.orderBy('scannedAt').reverse().toArray();
};

export const deleteBarcode = async (id: number): Promise<void> => {
  await db.barcodes.delete(id);
};

export const clearAllBarcodes = async (): Promise<void> => {
  await db.barcodes.clear();
};

export const getBarcodeCount = async (): Promise<number> => {
  return await db.barcodes.count();
};

// Face registration helper functions
export const addFace = async (entry: Omit<RegisteredFace, 'id'>): Promise<number> => {
  return await db.faces.add(entry);
};

export const getAllFaces = async (): Promise<RegisteredFace[]> => {
  return await db.faces.orderBy('registeredAt').reverse().toArray();
};

export const deleteFace = async (id: number): Promise<void> => {
  await db.faces.delete(id);
};

export const clearAllFaces = async (): Promise<void> => {
  await db.faces.clear();
};

// Attendance helper functions
export const addAttendance = async (entry: Omit<AttendanceRecord, 'id'>): Promise<number> => {
  return await db.attendance.add(entry);
};

export const getAllAttendance = async (): Promise<AttendanceRecord[]> => {
  return await db.attendance.orderBy('timestamp').reverse().toArray();
};

export const getTodayAttendance = async (): Promise<AttendanceRecord[]> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return await db.attendance
    .where('timestamp')
    .between(today, tomorrow)
    .reverse()
    .toArray();
};

export const deleteAttendance = async (id: number): Promise<void> => {
  await db.attendance.delete(id);
};

export const clearAllAttendance = async (): Promise<void> => {
  await db.attendance.clear();
};
