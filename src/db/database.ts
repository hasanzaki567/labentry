import Dexie, { type Table } from 'dexie';

export interface BarcodeEntry {
  id?: number;
  barcodeText: string;
  barcodeFormat: string;
  scannedAt: Date;
  confidence: number;
  rawData?: string;
}

export class LabEntryDatabase extends Dexie {
  barcodes!: Table<BarcodeEntry>;

  constructor() {
    super('LabEntryDB');
    this.version(1).stores({
      barcodes: '++id, barcodeText, barcodeFormat, scannedAt'
    });
  }
}

export const db = new LabEntryDatabase();

// Database helper functions
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
