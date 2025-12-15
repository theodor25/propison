import React, { useRef, useState } from 'react';
import { Upload, FileText, Image as ImageIcon, X } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, ACCEPTED_PDF_TYPE, MAX_IMAGES, MAX_PDF_PAGES } from '../constants';
import { FileData } from '../types';

interface FileUploadProps {
  onFilesSelected: (files: FileData[]) => void;
  currentFiles: FileData[];
  disabled?: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, currentFiles, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const validateAndProcessFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);

    const newFiles: FileData[] = [];
    const isPdf = files[0].type === ACCEPTED_PDF_TYPE;
    
    // Rule: No mixed types
    if (currentFiles.length > 0) {
      const currentIsPdf = currentFiles[0].type === 'pdf';
      if (isPdf !== currentIsPdf) {
        setErrorMsg("Não é permitido misturar PDF e imagens. Limpe a seleção atual primeiro.");
        return;
      }
    }

    if (isPdf) {
       if (files.length > 1 || currentFiles.length > 0) {
         setErrorMsg("Apenas 1 arquivo PDF é permitido por vez.");
         return;
       }
       // Note: We can't check PDF page count synchronously here easily without loading it. 
       // We'll trust the user or validate later in the logic.
       newFiles.push({
         id: crypto.randomUUID(),
         file: files[0],
         type: 'pdf'
       });
    } else {
      // Images
      let count = currentFiles.length;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) {
          setErrorMsg("Formato de arquivo não suportado. Use JPEG, PNG ou WebP.");
          continue;
        }
        if (count >= MAX_IMAGES) {
          setErrorMsg(`Máximo de ${MAX_IMAGES} imagens permitido.`);
          break;
        }
        newFiles.push({
          id: crypto.randomUUID(),
          file: f,
          previewUrl: URL.createObjectURL(f),
          type: 'image'
        });
        count++;
      }
    }

    if (newFiles.length > 0) {
      onFilesSelected(newFiles);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    validateAndProcessFiles(e.dataTransfer.files);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    validateAndProcessFiles(e.target.files);
  };

  return (
    <div className="w-full mb-6">
      <div 
        className={`relative border-2 border-dashed rounded-lg p-8 transition-colors ${
          dragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-blue-400 bg-white'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input 
          ref={fileInputRef}
          type="file" 
          className="hidden" 
          multiple 
          accept={`${ACCEPTED_IMAGE_TYPES.join(',')},${ACCEPTED_PDF_TYPE}`}
          onChange={handleChange}
        />
        
        <div className="flex flex-col items-center justify-center text-gray-500">
          <Upload className="w-12 h-12 mb-4 text-blue-500" />
          <p className="text-lg font-medium text-gray-700 mb-2">Arraste arquivos ou clique para selecionar</p>
          <p className="text-sm text-gray-500 text-center max-w-md">
            Suporta: 1 PDF (até {MAX_PDF_PAGES} págs) OU até {MAX_IMAGES} Imagens (JPEG, PNG, WebP).
          </p>
        </div>
      </div>
      {errorMsg && (
        <div className="mt-2 p-3 bg-red-50 text-red-700 text-sm rounded-md flex items-center">
          <X className="w-4 h-4 mr-2" />
          {errorMsg}
        </div>
      )}
    </div>
  );
};
