import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL_FLASH, SYSTEM_PROMPT } from "../constants";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  /**
   * Processes a single page (either raw text or image base64).
   * Performs cleaning, translation, and code preservation.
   */
  async processPage(input: string, isImage: boolean): Promise<string> {
    try {
      const parts: any[] = [];
      
      if (isImage) {
        // Input is base64 data URL: "data:image/jpeg;base64,..."
        const base64Data = input.split(',')[1];
        const mimeType = input.split(';')[0].split(':')[1];
        
        parts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        });
        parts.push({
          text: "Analise esta imagem. Extraia o texto, limpe-o e traduza para Português preservando código C/C++."
        });
      } else {
        // Input is raw text extracted from PDF
        parts.push({
          text: `Texto Original:\n${input}\n\nTarefa: Limpar, formatar e traduzir este texto para Português preservando código C/C++.`
        });
      }

      const response = await this.ai.models.generateContent({
        model: GEMINI_MODEL_FLASH,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.2, // Low temperature for more deterministic/faithful output
        },
        contents: {
          parts: parts
        }
      });

      return response.text || "";
    } catch (error) {
      console.error("Gemini processing error:", error);
      throw new Error("Falha ao processar página com IA.");
    }
  }
}
