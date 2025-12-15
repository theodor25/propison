import React, { useState, useCallback } from 'react';
import { FileUpload } from './components/FileUpload';
import { ProcessingStatus } from './components/ProcessingStatus';
import { FileData, ProcessingState, ProcessingMode } from './types';
import { PdfService } from './services/pdfService';
import { GeminiService } from './services/geminiService';
import { FileText, Trash2, Download, AlertTriangle } from 'lucide-react';

const App: React.FC = () => {
  const [files, setFiles] = useState<FileData[]>([]);
  const [pdfDoc, setPdfDoc] = useState<any>(null); // PDF.js doc proxy
  const [processingState, setProcessingState] = useState<ProcessingState>({
    status: 'idle',
    message: '',
    progress: 0,
    total: 0
  });
  const [finalPdfBlob, setFinalPdfBlob] = useState<Blob | null>(null);
  const [showOcrConfirm, setShowOcrConfirm] = useState(false);

  // Helper to update status
  const updateStatus = (status: ProcessingState['status'], message: string, progress = 0, total = 0, error?: string) => {
    setProcessingState({ status, message, progress, total, error });
  };

  const handleFilesSelected = async (newFiles: FileData[]) => {
    // If it's a PDF, we need to load it to count pages
    if (newFiles.length > 0 && newFiles[0].type === 'pdf') {
      try {
        updateStatus('analyzing', 'Analisando PDF...');
        const doc = await PdfService.loadPdf(newFiles[0].file);
        
        if (doc.numPages > 10) {
          updateStatus('error', '', 0, 0, 'O PDF excede o limite de 10 páginas.');
          return;
        }

        setPdfDoc(doc);
        newFiles[0].pageCount = doc.numPages;
        setFiles(newFiles);
        updateStatus('idle', '');
      } catch (e) {
        updateStatus('error', '', 0, 0, 'Erro ao ler arquivo PDF.');
      }
    } else {
      // Append images if mixed upload wasn't blocked (component handles it, but safety check)
      // Actually component passes new list for PDF but appends for images? 
      // The FileUpload component logic for images returns a NEW list of valid files appended to existing or fresh.
      // We will simplify and just replace or append.
      // Based on FileUpload implementation, it returns ONLY newly added files. We need to merge.
      
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const clearFiles = () => {
    setFiles([]);
    setPdfDoc(null);
    setFinalPdfBlob(null);
    setProcessingState({ status: 'idle', message: '', progress: 0, total: 0 });
    setShowOcrConfirm(false);
  };

  const startProcessing = async () => {
    if (files.length === 0) return;
    setFinalPdfBlob(null);

    const isPdf = files[0].type === 'pdf';

    try {
      if (isPdf && pdfDoc) {
        // Step 1: Analyze PDF
        updateStatus('analyzing', 'Verificando conteúdo do PDF...');
        const isSearchable = await PdfService.checkIsSearchable(pdfDoc);

        if (isSearchable) {
          processPdf(ProcessingMode.TEXT_EXTRACTION);
        } else {
          setShowOcrConfirm(true);
          updateStatus('confirm_ocr', 'Aguardando confirmação...');
        }
      } else {
        // Images
        processImages();
      }
    } catch (e) {
      updateStatus('error', '', 0, 0, 'Erro ao iniciar processamento.');
    }
  };

  const processPdf = async (mode: ProcessingMode) => {
    setShowOcrConfirm(false);
    const gemini = new GeminiService();
    const processedTexts: string[] = [];
    const totalPages = pdfDoc.numPages;

    try {
      let inputs: string[] = []; // Either raw text or base64 images

      if (mode === ProcessingMode.TEXT_EXTRACTION) {
        updateStatus('processing', 'Extraindo texto do PDF...', 0, totalPages);
        inputs = await PdfService.extractText(pdfDoc);
      } else {
        updateStatus('processing', 'Renderizando páginas para OCR...', 0, totalPages);
        inputs = await PdfService.renderPagesToImages(pdfDoc);
      }

      // Process with Gemini
      for (let i = 0; i < inputs.length; i++) {
        updateStatus('processing', `Processando página ${i + 1} de ${totalPages}...`, i + 1, totalPages);
        // If mode is TEXT_EXTRACTION, inputs[i] is text. If OCR, it is base64 image.
        const isImageInput = mode === ProcessingMode.OCR;
        const result = await gemini.processPage(inputs[i], isImageInput);
        processedTexts.push(result);
      }

      generateFinalPdf(processedTexts);

    } catch (e) {
      console.error(e);
      updateStatus('error', '', 0, 0, 'Erro durante o processamento do PDF.');
    }
  };

  const processImages = async () => {
    const gemini = new GeminiService();
    const processedTexts: string[] = [];
    const totalFiles = files.length;

    try {
      for (let i = 0; i < totalFiles; i++) {
        updateStatus('processing', `Processando imagem ${i + 1} de ${totalFiles}...`, i + 1, totalFiles);
        
        // Convert file to base64
        const file = files[i].file;
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });
        const base64 = await base64Promise;

        const result = await gemini.processPage(base64, true);
        processedTexts.push(result);
      }

      generateFinalPdf(processedTexts);

    } catch (e) {
      console.error(e);
      updateStatus('error', '', 0, 0, 'Erro durante o processamento das imagens.');
    }
  };

  const generateFinalPdf = (texts: string[]) => {
    try {
      updateStatus('generating', 'Gerando PDF final...');
      const blob = PdfService.generatePdf(texts);
      setFinalPdfBlob(blob);
      updateStatus('completed', 'Processamento concluído!');
    } catch (e) {
      updateStatus('error', '', 0, 0, 'Erro ao gerar o arquivo PDF.');
    }
  };

  const handleDownload = () => {
    if (!finalPdfBlob) return;
    const url = URL.createObjectURL(finalPdfBlob);
    window.open(url, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl w-full space-y-8">
        
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            Tradutor Técnico OCR
          </h1>
          <p className="mt-2 text-lg text-gray-600">
            Traduza documentos técnicos e PDFs para Português preservando códigos e formatação.
          </p>
        </div>

        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          
          {/* File Upload Area */}
          <FileUpload 
            onFilesSelected={handleFilesSelected} 
            currentFiles={files} 
            disabled={processingState.status !== 'idle' && processingState.status !== 'error' && processingState.status !== 'completed'}
          />

          {/* File List / Preview */}
          {files.length > 0 && (
            <div className="mb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                  Arquivos Selecionados ({files.length})
                </h3>
                <button 
                  onClick={clearFiles}
                  disabled={processingState.status !== 'idle' && processingState.status !== 'completed' && processingState.status !== 'error'}
                  className="text-sm text-red-600 hover:text-red-800 flex items-center gap-1 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" /> Limpar
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {files.map((f) => (
                  <div key={f.id} className="relative group border rounded-lg p-2 bg-gray-50 flex flex-col items-center justify-center h-32">
                    {f.type === 'pdf' ? (
                      <>
                        <FileText className="w-10 h-10 text-red-500 mb-2" />
                        <span className="text-xs text-center font-medium truncate w-full px-2">{f.file.name}</span>
                        <span className="text-xs text-gray-500">{f.pageCount} páginas</span>
                      </>
                    ) : (
                      <>
                        <img src={f.previewUrl} alt="preview" className="h-20 object-contain mb-2 rounded" />
                        <span className="text-xs text-center font-medium truncate w-full px-2">{f.file.name}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirmation Modal for OCR */}
          {showOcrConfirm && (
             <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex flex-col sm:flex-row items-start sm:items-center gap-4">
               <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
               <div className="flex-1">
                 <h4 className="text-sm font-bold text-yellow-800">Texto pesquisável não encontrado</h4>
                 <p className="text-sm text-yellow-700 mt-1">
                   Este PDF parece ser composto apenas de imagens escaneadas. Deseja aplicar OCR visual para extrair e traduzir o conteúdo?
                 </p>
               </div>
               <div className="flex gap-2 mt-2 sm:mt-0">
                 <button 
                   onClick={() => clearFiles()}
                   className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                 >
                   Cancelar
                 </button>
                 <button 
                   onClick={() => processPdf(ProcessingMode.OCR)}
                   className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                 >
                   Sim, aplicar OCR
                 </button>
               </div>
             </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-center mt-8">
            {finalPdfBlob ? (
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-8 rounded-lg shadow-sm transition-all transform hover:scale-105"
              >
                <Download className="w-5 h-5" />
                Baixar PDF Traduzido
              </button>
            ) : (
              <button
                onClick={startProcessing}
                disabled={files.length === 0 || (processingState.status !== 'idle' && processingState.status !== 'error')}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-8 rounded-lg shadow-sm transition-all"
              >
                {processingState.status === 'idle' || processingState.status === 'error' ? 'Processar Arquivos' : 'Processando...'}
              </button>
            )}
          </div>

          {/* Status Display */}
          <ProcessingStatus state={processingState} />

        </div>
        
        <p className="text-center text-xs text-gray-400">
          Powered by Gemini 2.5 Flash & Google Vision Tech
        </p>
      </div>
    </div>
  );
};

export default App;
