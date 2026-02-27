# LabEntry — Face Attendance & Barcode Scanner

A lab/classroom entry management system with **real-time face recognition attendance** and **barcode scanning**, built with React + TypeScript. Runs entirely in the browser — no backend needed.

---

## What It Does

- **Face Registration** — Enter a name, open the camera, and the face is auto-detected and saved instantly
- **Face Attendance** — Recognizes registered faces via webcam, marks attendance automatically, and shows a green confirmation popup (press Enter to continue to next person)
- **Barcode Scanner** — Scans barcodes / QR codes using the camera in real-time
- **Attendance Records** — View, search, and manage all recorded attendance entries
- **Offline-first** — All data stored locally in IndexedDB (no server required)

---

## Tech Stack

| What | Why |
|---|---|
| **React 19** + **TypeScript** | UI framework |
| **Vite** | Dev server & build tool |
| **@vladmandic/face-api** | Face detection & recognition (TensorFlow.js-based, runs SSD MobileNet + 68-point landmarks + 128-dim face descriptors) |
| **@undecaf/zbar-wasm** | Barcode scanning via WebAssembly (ZBar engine — supports EAN, UPC, Code 128, QR, etc.) |
| **Dexie.js** | IndexedDB wrapper for local database (faces, attendance, barcodes) |
| **Lucide React** | Icons |

---

## Project Structure

```
src/
├── App.tsx                     # Main app with tab navigation
├── App.css                     # All styles (CSS variables for theming)
├── db/
│   └── database.ts             # IndexedDB schema & helpers (Dexie)
├── components/
│   ├── FaceRegistration.tsx     # Register faces (auto-detect from camera)
│   ├── FaceAttendance.tsx       # Real-time face attendance scanning
│   ├── AttendanceRecords.tsx    # View/manage attendance history
│   ├── BarcodeScanner.tsx       # ZBar-based barcode/QR scanner
│   ├── ScannedBarcodesList.tsx  # List of scanned barcodes
│   └── Header.tsx               # App header
public/
└── models/                     # Face-api.js model weight files
    ├── ssd_mobilenetv1_model-*
    ├── face_landmark_68_model-*
    ├── face_recognition_model-*
    └── tiny_face_detector_model-*
```

---

## How It Works

### Face Registration
1. Go to **Register Face** tab
2. Type the person's name
3. Click **Auto Register via Camera** — camera opens and scans for a face
4. Once a face is detected, it automatically captures a photo, extracts a 128-dimensional face descriptor using SSD MobileNet, and saves it to IndexedDB
5. You can also upload a photo instead of using the camera

### Face Attendance
1. Go to **Face Attendance** tab and click **Start Attendance**
2. The camera runs a detection loop using SSD MobileNet (primary) with TinyFaceDetector as fallback
3. Detected faces are compared against all registered descriptors using Euclidean distance (threshold: 0.45)
4. If a match is found with ≥55% confidence:
   - Attendance is recorded in IndexedDB
   - A fullscreen green popup shows the person's name
   - Press **Enter** (or click) to dismiss and continue to the next person
5. 10-second cooldown prevents duplicate entries for the same person
6. Multiple photos of the same person are grouped to improve accuracy

### Barcode Scanner
1. Go to **Barcode Scanner** tab
2. Camera opens and scans every 100ms using ZBar WASM
3. Detected barcodes are saved to IndexedDB with format, confidence, and timestamp

---

## Setup & Run

### Prerequisites
- **Node.js** ≥ 18
- A device with a **webcam** (for face/barcode features)

### Install & Dev

```bash
# Clone the repo
git clone <your-repo-url>
cd labentry

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

---

## Face-API Models

The face recognition models are stored in `public/models/`. These are loaded on demand when you open the Face Register or Face Attendance tabs. Models used:

- **SSD MobileNet v1** — primary face detector (accurate)
- **Tiny Face Detector** — lightweight fallback
- **68-Point Face Landmarks** — facial landmark alignment
- **Face Recognition Net** — generates 128-dim descriptor for matching

---

## Database

Uses **Dexie.js** (IndexedDB) with 3 tables:

| Table | Fields |
|---|---|
| `faces` | id, name, photoDataUrl, descriptor (128-dim array), registeredAt |
| `attendance` | id, faceId, name, timestamp, confidence, photoDataUrl |
| `barcodes` | id, barcodeText, barcodeFormat, scannedAt, confidence, rawData |

All data lives in the browser. Clear it from DevTools → Application → IndexedDB → `LabEntryDB`.

---

## License

MIT
