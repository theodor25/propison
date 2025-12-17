export class ImageProcessor {
  /**
   * Processes a base64 string image: loads it, upscales if needed, applies filters, and returns processed base64.
   */
  static async processBase64(base64: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Target width ~2000px for robust OCR
        const targetWidth = 2000;
        let w = img.width;
        let h = img.height;
        
        // Upscale if too small
        if (w < targetWidth) {
          const scale = targetWidth / w;
          w = Math.floor(w * scale);
          h = Math.floor(h * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Canvas context failed"));
          return;
        }

        // High quality scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        
        // Apply filters directly to canvas data
        this.processCanvas(canvas);
        
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = base64;
    });
  }

  /**
   * Applies Grayscale -> Contrast -> Binarization pipeline to a canvas.
   */
  static processCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const len = data.length;
    
    // Contrast factor (0-255). 60 provides significant boost to separate text from noise.
    const contrast = 60; 
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < len; i += 4) {
      // 1. Grayscale (Luminance)
      const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      
      // 2. Increase Contrast
      let c = factor * (gray - 128) + 128;
      
      // 3. Binarize (Thresholding)
      // Hard threshold to eliminate gray artifacts "v a l o r"
      const final = c > 128 ? 255 : 0;
      
      data[i] = final;
      data[i + 1] = final;
      data[i + 2] = final;
      // Alpha channel (data[i+3]) remains unchanged
    }
    
    ctx.putImageData(imageData, 0, 0);
  }
}