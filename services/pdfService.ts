import { jsPDF } from "jspdf";
import { MAX_PDF_PAGES } from "../constants";
import { ImageProcessor } from "./imageProcessor";

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

// Syntax Highlighting Colors (Exact Specs)
const SYNTAX_COLORS = {
  keyword: [0, 0, 204],    // Dark Blue (#0000CC)
  function: [128, 0, 128], // Purple (#800080)
  string: [0, 102, 0],     // Green (#006600)
  number: [204, 0, 0],     // Red (#CC0000)
  comment: [102, 102, 102],// Gray (#666666)
  default: [0, 0, 0]       // Black
};

const KEYWORDS = new Set([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 
  'float', 'for', 'goto', 'if', 'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 
  'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'bool', 'catch', 'class', 
  'const_cast', 'delete', 'dynamic_cast', 'explicit', 'export', 'false', 'friend', 'inline', 'mutable', 
  'namespace', 'new', 'operator', 'private', 'protected', 'public', 'reinterpret_cast', 'static_cast', 
  'template', 'this', 'throw', 'true', 'try', 'typeid', 'typename', 'using', 'virtual', 'wchar_t', 'nullptr',
  '#include', '#define', '#ifdef', '#endif', '#ifndef', '#pragma', 'std', 'vector', 'string', 'map', 'list'
]);

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
   * Applies preprocessing (binarization/contrast) to improve OCR accuracy.
   */
  static async renderPagesToImages(pdfDoc: any): Promise<string[]> {
    const numPages = pdfDoc.numPages;
    const images: string[] = [];
    const max = Math.min(numPages, MAX_PDF_PAGES);

    for (let i = 1; i <= max; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 3.0 }); 
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      ImageProcessor.processCanvas(canvas);

      const base64 = canvas.toDataURL('image/jpeg', 0.9);
      images.push(base64);
    }

    return images;
  }

  /**
   * Cleans text by decoding HTML entities and removing artifacts.
   */
  private static cleanText(text: string): string {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  /**
   * Parses text containing Markdown code blocks into structured blocks.
   */
  private static parseContent(text: string): ContentBlock[] {
    const cleanedText = this.cleanText(text);
    const blocks: ContentBlock[] = [];
    const regex = /```(?:\w+)?\s*\n([\s\S]*?)```/g;
    
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(cleanedText)) !== null) {
      if (match.index > lastIndex) {
        const textSegment = cleanedText.substring(lastIndex, match.index).trim();
        if (textSegment) {
          blocks.push({ type: 'text', content: textSegment });
        }
      }

      // Convert tabs to 4 spaces for strict alignment
      const codeSegment = match[1].replace(/\t/g, '    ');
      // Trim vertical whitespace but preserve indentation
      const cleanCode = codeSegment.replace(/^\n+|\n+$/g, '');
      
      if (cleanCode) {
        blocks.push({ type: 'code', content: cleanCode });
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < cleanedText.length) {
      const textSegment = cleanedText.substring(lastIndex).trim();
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
    const baseCodeSize = 9.5; // Optimized for code density
    const baseLineHeight = 1.35;
    const baseSpacing = 14;

    const measureTotalHeight = (scale: number): { total: number, blocksWithLines: ContentBlock[] } => {
      let currentH = 0;
      const calculatedBlocks: ContentBlock[] = [];
      const textSz = baseTextSize * scale;
      const codeSz = baseCodeSize * scale;
      const lhText = textSz * baseLineHeight;
      const lhCode = codeSz * baseLineHeight; // Code needs slightly tighter lines
      const blockSpacing = baseSpacing * scale;

      blocks.forEach((block, index) => {
        const isCode = block.type === 'code';
        doc.setFont(isCode ? 'courier' : 'times', isCode ? 'normal' : 'roman');
        doc.setFontSize(isCode ? codeSz : textSz);

        let lines: string[] = [];
        if (isCode) {
           const rawLines = block.content.split('\n');
           rawLines.forEach(line => {
             // Split long lines while trying to respect words boundaries if possible,
             // but for code, char wrapping is often better. jsPDF default is by word.
             const wrapped = doc.splitTextToSize(line, maxWidth);
             lines.push(...wrapped);
           });
        } else {
           lines = doc.splitTextToSize(block.content, maxWidth);
        }

        const h = lines.length * (isCode ? lhCode : lhText);
        currentH += h;
        if (index < blocks.length - 1) currentH += blockSpacing;

        calculatedBlocks.push({ ...block, lines, height: h });
      });

      return { total: currentH, blocksWithLines: calculatedBlocks };
    };

    let scale = 1.0;
    let measured = measureTotalHeight(scale);
    const minScale = 0.65; 
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
   * Syntax highlighting parser and renderer for a single line of code.
   */
  private static renderCodeLine(doc: jsPDF, line: string, startX: number, y: number, fontSize: number) {
    let x = startX;
    let i = 0;
    const len = line.length;

    while (i < len) {
      let token = '';
      let color = SYNTAX_COLORS.default;
      const char = line[i];

      // 1. Comments (Line comments // and Block comments /* ... */ start)
      if (char === '/' && line[i + 1] === '/') {
        token = line.substring(i);
        color = SYNTAX_COLORS.comment;
        i = len; 
      }
      else if (char === '/' && line[i + 1] === '*') {
         // Treat rest of line as comment (simplification for single-line rendering context)
         token = line.substring(i);
         color = SYNTAX_COLORS.comment;
         i = len;
      }
      // 2. Strings ("..." or '...')
      else if (char === '"' || char === "'") {
        const quote = char;
        token += char;
        i++;
        while (i < len) {
          const c = line[i];
          token += c;
          i++;
          // Handle escaped quotes
          if (c === quote && line[i - 2] !== '\\') break;
        }
        color = SYNTAX_COLORS.string;
      }
      // 3. Preprocessor directives (#include, #define etc)
      else if (char === '#') {
        token += char;
        i++;
        while(i < len && /[a-zA-Z0-9_]/.test(line[i])) {
          token += line[i];
          i++;
        }
        // #include <...> handling (treat <...> as stringish for preprocessor)
        if (token === '#include') {
          // Check for <file.h> pattern
           let k = i;
           // skip spaces
           while (k < len && /\s/.test(line[k])) k++;
           if (k < len && line[k] === '<') {
             // Render #include as keyword
             doc.setTextColor(SYNTAX_COLORS.keyword[0], SYNTAX_COLORS.keyword[1], SYNTAX_COLORS.keyword[2]);
             doc.text(token, x, y);
             x += doc.getTextWidth(token);
             
             // Render spacing
             let space = line.substring(i, k);
             doc.text(space, x, y);
             x += doc.getTextWidth(space);
             
             // Extract header
             i = k;
             token = '';
             while (i < len && line[i] !== '>') {
               token += line[i];
               i++;
             }
             if (i < len) { token += '>'; i++; }
             color = SYNTAX_COLORS.string; // Color headers as strings/green
           } else {
             color = SYNTAX_COLORS.keyword;
           }
        } else {
          color = SYNTAX_COLORS.keyword;
        }
      }
      // 4. Numbers (Integer and Float)
      else if (/[0-9]/.test(char)) {
        while(i < len && /[0-9.xXa-fA-F]/.test(line[i])) {
          token += line[i];
          i++;
        }
        // Ensure it wasn't part of an identifier
        color = SYNTAX_COLORS.number;
      }
      // 5. Identifiers (Keywords vs Functions vs Vars)
      else if (/[a-zA-Z_]/.test(char)) {
        while(i < len && /[a-zA-Z0-9_]/.test(line[i])) {
          token += line[i];
          i++;
        }
        if (KEYWORDS.has(token)) {
          color = SYNTAX_COLORS.keyword;
        } else {
          // Look ahead for '(' ignoring whitespace to detect function call/decl
          let j = i;
          while (j < len && /\s/.test(line[j])) j++;
          if (j < len && line[j] === '(') {
            color = SYNTAX_COLORS.function;
          } else {
            color = SYNTAX_COLORS.default;
          }
        }
      }
      // 6. Whitespace and Operators/Symbols
      else {
        token = char;
        color = SYNTAX_COLORS.default;
        i++;
      }

      // Render token
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(token, x, y);
      x += doc.getTextWidth(token);
    }
  }

  /**
   * Generates a final PDF from processed text, mapping 1 input page to 1 output page.
   */
  static generatePdf(pagesText: string[]): Blob {
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'pt',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
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
        
        doc.setFont(isCode ? 'courier' : 'times', isCode ? 'normal' : 'roman');
        doc.setFontSize(fontSize);

        if (isCode) {
            // Light Background for Code Block
            doc.setFillColor(248, 250, 252); // Very light gray (slate-50)
            doc.setDrawColor(226, 232, 240); // Subtle border
            doc.rect(margin - 6, currentY - 4, contentWidth + 12, block.height + 8, 'FD');
            
            // Syntax Highlighting Line by Line
            block.lines.forEach((line, lineIndex) => {
              // Calculate Y for this specific line relative to block start
              const lineY = currentY + (lineIndex * fontSize * layout.lineHeightFactor) + (fontSize * 0.8);
              this.renderCodeLine(doc, line, margin, lineY, fontSize);
            });
        } else {
            // Standard Body Text
            doc.setTextColor(15, 23, 42);
            doc.setLineHeightFactor(layout.lineHeightFactor);
            doc.text(block.lines, margin, currentY + (fontSize * 0.8)); 
        }

        currentY += block.height + layout.spacing;
      });
      
      // Page Footer
      doc.setFont('times', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text(`${index + 1}`, pageWidth / 2, pageHeight - 30, { align: 'center' });
    });

    return doc.output('blob');
  }
}
