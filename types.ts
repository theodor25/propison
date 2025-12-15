export interface FileData {
  id: string;
  file: File;
  previewUrl?: string; // For images
  type: 'image' | 'pdf';
  pageCount?: number; // For PDF
}

export interface ProcessingState {
  status: 'idle' | 'analyzing' | 'confirm_ocr' | 'processing' | 'generating' | 'completed' | 'error';
  message: string;
  progress: number;
  total: number;
  error?: string;
}

export interface ProcessedPage {
  pageIndex: number;
  text: string;
}

export enum ProcessingMode {
  TEXT_EXTRACTION = 'TEXT_EXTRACTION', // For searchable PDFs
  OCR = 'OCR', // For images or non-searchable PDFs
}
