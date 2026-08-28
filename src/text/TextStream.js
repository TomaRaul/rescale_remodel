// TextStream.js — textul ca flux masurat, parametrizat pe LUNGIME DE ARC.
//
// Un cuvant NU stocheaza (x, y), ci pozitia lui de-a lungul traseului. Cand
// geometria se schimba, pozitia in pixeli se recalculeaza — reflow-ul e gratuit.
//
// Continutul e inlocuibil din prompt: setWords() remasoara tot.

export class TextStream {
  /**
   * @param {string[]} words
   * @param {CanvasRenderingContext2D} measureCtx folosit doar pentru masurare
   * @param {number} fontPx
   */
  constructor(words, measureCtx, fontPx = 15) {
    this.ctx = measureCtx;
    this.fontPx = fontPx;
    this.setWords(words);
  }

  /** Inlocuieste continutul. Lista goala = textul chiar dispare, nu doar se ascunde. */
  setWords(words) {
    this.words = (words || []).map(w => String(w)).filter(w => w.length);
    this.remeasure();
    return this;
  }

  remeasure() {
    this.ctx.font = `600 ${this.fontPx}px "Segoe UI", system-ui, sans-serif`;
    this.advance = this.words.map(w => this.ctx.measureText(w).width);
  }

  /** Al doilea invariant al sistemului: latimea totala a textului. */
  totalWidth() {
    return this.advance.reduce((a, b) => a + b, 0);
  }

  /** Vedere peste un subset de cuvinte — baza legarii partiale. */
  items(indices) {
    const idx = indices || this.words.map((_, i) => i);
    return idx
      .filter(i => i >= 0 && i < this.words.length)
      .map(i => ({ i, text: this.words[i], w: this.advance[i] }));
  }
}
