// CanvasRenderer.js — singurul modul din proiect care are voie sa atinga un pixel.
// Nu calculeaza nimic: primeste scena gata facuta si o deseneaza.

export class CanvasRenderer {
  /**
   * Culorile, toate intr-un loc. Panza e ALBA, deci nimic de aici nu poate fi pastelat:
   * un albastru deschis pe alb se pierde, iar cifrele de pe axe devin ilizibile.
   * Aceleasi valori stau si in `:root` din index.html — pagina si desenul sunt o temă.
   */
  static SCRIS = '#000000';
  static CONTUR = '#000000';
  static GRILA = 'rgba(15,23,42,.07)';
  static GRILA_TARE = 'rgba(15,23,42,.17)';
  static CIFRE = 'rgba(30,41,59,.45)';
  static CIFRE_TARI = 'rgba(30,41,59,.85)';
  static HALOU = 'rgba(29,78,216,.20)';
  static CASETA = '#64748b';

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.cell = 0;
  }

  /**
   * `w` x `h` e zona de DESEN. Elementul canvas e mai mare cu banda de axe (ax),
   * iar contextul e translatat spre dreapta cu atat: codul de desen ramane in
   * coordonate 0..w, iar cifrele se scriu la coordonate negative sau peste h,
   * adica in afara zonei de desen.
   */
  resize(w, h, ax = { l: 0, r: 0, t: 0, b: 0 }) {
    const m = { l: 0, r: 0, t: 0, b: 0, ...ax };
    const W = w + m.l + m.r, H = h + m.t + m.b;
    this.canvas.width = W * this.dpr;
    this.canvas.height = H * this.dpr;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, m.l * this.dpr, m.t * this.dpr);
    this.w = w; this.h = h; this.m = m;
  }

  /**
   * Pasul grilei, in pixeli. CATE linii ies nu se mai da din afara: panza isi poate
   * schimba gabaritul, iar un numar fix de celule ar desena linii pe langa ea.
   */
  setGrid(cell) { this.cell = cell; }

  /**
   * Grila de coordonate, cu originea (0,0) in coltul din STANGA JOS.
   * Canvas-ul are y-ul invers, deci randul logic y se deseneaza la (n-1-y).
   */
  grid(c) {
    const { cell } = this;
    if (!cell) return;

    // Liniile se numara din gabaritul de ACUM, nu dintr-un numar fix de celule: pe o
    // panza de 250x100 ies cinci coloane si doua randuri, nu saisprezece pe fiecare
    // axa desenate pe langa ea. Ultima linie se traseaza si cand cade fix pe margine.
    const valori = limita => {
      const out = [];
      for (let v = 0; v <= limita + 1e-6; v += cell) out.push(v);
      return out;
    };
    const tare = v => Math.round(v / cell) % 4 === 0;
    c.save();

    c.lineWidth = 1;
    for (const v of valori(this.w)) {
      c.strokeStyle = tare(v) ? CanvasRenderer.GRILA_TARE : CanvasRenderer.GRILA;
      c.beginPath(); c.moveTo(v + .5, 0); c.lineTo(v + .5, this.h); c.stroke();
    }
    for (const v of valori(this.h)) {
      c.strokeStyle = tare(v) ? CanvasRenderer.GRILA_TARE : CanvasRenderer.GRILA;
      c.beginPath(); c.moveTo(0, v + .5); c.lineTo(this.w, v + .5); c.stroke();
    }

    // Cifrele sunt VALORI IN PIXELI, nu indici de celula.
    // Stau in dreptul liniilor si in afara zonei de desen.
    c.font = '10px "Cascadia Code", Consolas, monospace';

    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const v of valori(this.w)) {
      c.fillStyle = tare(v) ? CanvasRenderer.CIFRE_TARI : CanvasRenderer.CIFRE;
      c.fillText(v, v, this.h + 7);                        // x, sub linia de jos
    }

    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of valori(this.h)) {
      c.fillStyle = tare(v) ? CanvasRenderer.CIFRE_TARI : CanvasRenderer.CIFRE;
      c.fillText(v, -7, this.h - v);                       // y, in stanga, creste in SUS
    }

    c.restore();
  }

  render(scene) {
    const c = this.ctx;
    c.clearRect(-this.m.l, -this.m.t, this.w + this.m.l + this.m.r, this.h + this.m.t + this.m.b);
    this.grid(c);

    const areSelectie = scene.edges.some(e => e.sel);
    c.lineCap = 'round';

    // Conturul e negru, ca textul: o singura culoare pentru tot ce se deseneaza.
    // Ce e selectat se distinge prin halou si prin grosime, nu prin culoare, iar ce
    // NU e selectat se estompeaza — deci selectia ramane citibila fara nicio paleta.
    scene.edges.forEach(e => {
      c.globalAlpha = !areSelectie || e.sel ? 1 : 0.2;      // ce nu e selectat se estompeaza

      if (e.sel) {                                          // halou sub obiectul selectat
        c.strokeStyle = CanvasRenderer.HALOU;
        c.lineWidth = 12;
        c.beginPath(); c.moveTo(e.x1, e.y1); c.lineTo(e.x2, e.y2); c.stroke();
      }

      c.strokeStyle = CanvasRenderer.CONTUR;
      c.lineWidth = e.sel ? 5 : 4;
      c.beginPath(); c.moveTo(e.x1, e.y1); c.lineTo(e.x2, e.y2); c.stroke();

      c.fillStyle = CanvasRenderer.CONTUR;
      c.beginPath(); c.arc(e.x1, e.y1, 3.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(e.x2, e.y2, 3.5, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    });

    // Caseta se deseneaza INAINTEA textului, ca sa stea dedesubt. E doar ambalaj:
    // linie subtire, intrerupta, fara umplutura — sa se vada ca e un contur de
    // asezare, nu o latura a figurii.
    for (const b of scene.casete || []) {
      c.save();
      c.globalAlpha = !areSelectie || b.sel ? 0.55 : 0.15;
      c.strokeStyle = CanvasRenderer.CASETA;
      c.lineWidth = 1;
      c.setLineDash([5, 4]);
      c.strokeRect(b.x, b.y, b.w, b.h);
      c.restore();
    }

    for (const w of scene.words) {
      if (!(w.size > 0.5)) continue;                        // cuvant scos sau inca necrescut
      c.save();
      c.globalAlpha = !areSelectie || w.sel ? 1 : 0.25;
      c.translate(w.x, w.y);
      c.rotate((w.rot * Math.PI) / 180);
      c.font = `600 ${w.size}px "Segoe UI", system-ui, sans-serif`;
      c.textAlign = w.align;
      c.textBaseline = w.baseline;
      c.fillStyle = CanvasRenderer.SCRIS;
      c.fillText(w.text, 0, 0);
      c.restore();
    }
  }
}
