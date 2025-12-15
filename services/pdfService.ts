import { jsPDF } from "jspdf";
import { MAX_PDF_PAGES } from "../constants";

declare global {
  const pdfjsLib: any;
}

interface ContentBlock {
  type: 'text' | 'code';
  content: string;
  lines?: string[];
  height?: number;
}

interface LayoutResult {
  blocks: ContentBlock[];
  textFontSize: number;
  codeFontSize: number;
  lineHeightFactor: number;
  spacing: number;
}

export class PdfService {
  /**
   * Loads a PDF file and returns the document proxy.
   */
  static async loadPdf(file: File): Promise<any> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    return loadingTask.promise;
  }

  /**
   * Checks if a PDF has searchable text on the first few pages.
   */
  static async checkIsSearchable(pdfDoc: any): Promise<boolean> {
    const numPages = pdfDoc.numPages;
    const pagesToCheck = Math.min(numPages, 3);
    let textCount = 0;

    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const strings = textContent.items.map((item: any) => item.str);
      const pageText = strings.join(' ');
      if (pageText.trim().length > 50) { 
        textCount++;
      }
    }

    return textCount > 0;
  }

  /**
   * Extracts raw text from PDF pages.
   */
  static async extractText(pdfDoc: any): Promise<string[]> {
    const numPages = pdfDoc.numPages;
    const extractedPages: string[] = [];
    const max = Math.min(numPages, MAX_PDF_PAGES);

    for (let i = 1; i <= max; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      extractedPages.push(pageText);
    }

    return extractedPages;
  }

  /**
   * Renders PDF pages to Base64 images for OCR processing.
   */
  static async renderPagesToImages(pdfDoc: any): Promise<string[]> {
    const numPages = pdfDoc.numPages;
    const images: string[] = [];
    const max = Math.min(numPages, MAX_PDF_PAGES);

    for (let i = 1; i <= max; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); 
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      const base64 = canvas.toDataURL('image/jpeg', 0.85);
      images.push(base64);
    }

    return images;
  }

  /**
   * Parses text containing Markdown code blocks into structured blocks.
   */
  private static parseContent(text: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    // Regex to find code blocks: ```lang ... ```
    // We capture the content inside.
    const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
    
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Content before the code block is text
      if (match.index > lastIndex) {
        const textSegment = text.substring(lastIndex, match.index).trim();
        if (textSegment) {
          blocks.push({ type: 'text', content: textSegment });
        }
      }

      // The code block content
      const codeSegment = match[1].replace(/\t/g, '    '); // Normalize tabs
      // Trim only vertical whitespace (keep indentation)
      const cleanCode = codeSegment.replace(/^\n+|\n+$/g, '');
      if (cleanCode) {
        blocks.push({ type: 'code', content: cleanCode });
      }

      lastIndex = regex.lastIndex;
    }

    // Remaining text after the last code block
    if (lastIndex < text.length) {
      const textSegment = text.substring(lastIndex).trim();
      if (textSegment) {
        blocks.push({ type: 'text', content: textSegment });
      }
    }

    return blocks;
  }

  /**
   * Calculates layout metrics to fit content strictly within one page.
   */
  private static calculateLayout(
    doc: jsPDF, 
    blocks: ContentBlock[], 
    maxWidth: number, 
    maxHeight: number
  ): LayoutResult {
    const baseTextSize = 11;
    const baseCodeSize = 10;
    const baseLineHeight = 1.3;
    const baseSpacing = 12; // Spacing between blocks

    // Helper to measure height of the entire content at a given scale factor
    const measureTotalHeight = (scale: number): { total: number, blocksWithLines: ContentBlock[] } => {
      let currentH = 0;
      const calculatedBlocks: ContentBlock[] = [];
      const textSz = baseTextSize * scale;
      const codeSz = baseCodeSize * scale;
      // Actual line height in points
      const lhText = textSz * baseLineHeight;
      const lhCode = codeSz * baseLineHeight;
      const blockSpacing = baseSpacing * scale;

      blocks.forEach((block, index) => {
        const isCode = block.type === 'code';
        doc.setFont(isCode ? 'courier' : 'times', isCode ? 'normal' : 'roman');
        doc.setFontSize(isCode ? codeSz : textSz);

        const lines = doc.splitTextToSize(block.content, maxWidth);
        // Height = number of lines * line height
        const h = lines.length * (isCode ? lhCode : lhText);
        
        currentH += h;
        if (index < blocks.length - 1) currentH += blockSpacing;

        calculatedBlocks.push({ ...block, lines, height: h });
      });

      return { total: currentH, blocksWithLines: calculatedBlocks };
    };

    // Iterative scaling to fit page
    let scale = 1.0;
    let measured = measureTotalHeight(scale);

    // If it's too big, shrink it until it fits (down to a limit)
    const minScale = 0.6; // Don't go below ~6.6pt font
    const step = 0.05;

    while (measured.total > maxHeight && scale > minScale) {
      scale -= step;
      measured = measureTotalHeight(scale);
    }

    return {
      blocks: measured.blocksWithLines,
      textFontSize: baseTextSize * scale,
      codeFontSize: baseCodeSize * scale,
      lineHeightFactor: baseLineHeight,
      spacing: baseSpacing * scale
    };
  }

  /**
   * Generates a final PDF from processed text, mapping 1 input page to 1 output page.
   */
  static generatePdf(pagesText: string[]): Blob {
    // A4 size in points: 595.28 x 841.89
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'pt',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // 2.5 cm margin ~= 71 points (1 inch = 72 pt)
    const margin = 71; 
    const contentWidth = pageWidth - (margin * 2);
    const availableHeight = pageHeight - (margin * 2);

    pagesText.forEach((rawText, index) => {
      if (index > 0) doc.addPage();

      const blocks = this.parseContent(rawText);
      const layout = this.calculateLayout(doc, blocks, contentWidth, availableHeight);

      let currentY = margin;

      layout.blocks.forEach(block => {
        if (!block.lines || block.height === undefined) return;

        const isCode = block.type === 'code';
        const fontSize = isCode ? layout.codeFontSize : layout.textFontSize;
        const lineHeight = fontSize * layout.lineHeightFactor;

        // Set Font
        doc.setFont(isCode ? 'courier' : 'times', isCode ? 'normal' : 'roman');
        doc.setFontSize(fontSize);
        doc.setTextColor(0, 0, 0);

        // Optional: Background for code blocks for better readability
        if (isCode) {
            // Light gray background
            doc.setFillColor(248, 248, 250);
            // Draw rect slightly larger than text
            doc.rect(margin - 4, currentY - 2, contentWidth + 8, block.height + 4, 'F');
            // Reset to black text
            doc.setTextColor(30, 30, 30);
        }

        doc.text(block.lines, margin, currentY + (fontSize * 0.8)); // Adjust Y for baseline

        currentY += block.height + layout.spacing;
      });
    });

    return doc.output('blob');
  }
}
