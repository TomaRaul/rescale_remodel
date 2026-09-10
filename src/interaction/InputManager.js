// InputManager.js — selectia si mutarea obiectelor cu mouse-ul.
//
// Acelasi buton face trei lucruri, dupa ce atinge si cat se deplaseaza:
//   click pe obiect      -> selectie (Shift adauga)
//   tras de pe un obiect -> mutare, pe toata selectia
//   tras din gol         -> dreptunghi de selectie: tot ce atinge intra in selectie
//
// Pana acum singurul fel de a muta ceva era promptul, iar o asezare vazuta cu ochiul —
// „mai la stanga cu putin" — cerea o cerere intreaga catre model, pentru o operatie care
// n-are nimic de tradus. Gesturile o fac local, gratis.
//
// Care dintre cele trei se decide pe DISTANTA parcursa cu butonul apasat, nu pe timp:
// sub `PRAG_MUTARE` pixeli gestul ramane un click, ca o mana care tremura putin sa nu
// mute figura din greseala.
//
// Nu stie nimic despre figuri sau grila: primeste scena deja desenata, intoarce id-uri
// si deplasari in pixeli de canvas. Cine le aplica e App.

/** Distanta de la punct la segmentul AB. */
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return Math.hypot(px - x1, py - y1);              // segment de lungime zero
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Distanta de la punct la dreptunghi. Zero inauntru. */
const distToRect = (px, py, r) => Math.hypot(
  Math.max(r.x - px, 0, px - (r.x + r.w)),
  Math.max(r.y - py, 0, py - (r.y + r.h)));

/** Se ating doua dreptunghiuri? O margine comuna conteaza ca atingere. */
const seAting = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w
                       && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Gabaritul unui segment, ca dreptunghi. Pe o latura dreapta iese chiar latura. */
const cadrulLaturii = e => ({
  x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2),
  w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1),
});

/**
 * Dreptunghiul pe care il ocupa un cuvant, asa cum se deseneaza.
 *
 * Latimea e o ESTIMARE: masuratoarea exacta sta in fluxul de text, iar scena desenata nu
 * duce cu ea decat corpul de litera. Pentru incadrare e destul — cativa pixeli nu schimba
 * daca un cuvant e sau nu in dreptunghiul tras cu mana.
 */
const cadrulCuvantului = w => {
  const lat = String(w.text || '').length * w.size * 0.6;
  return {
    x: { right: w.x - lat, center: w.x - lat / 2 }[w.align] ?? w.x,          // altfel, aliniat la stanga
    y: { bottom: w.y - w.size, middle: w.y - w.size / 2 }[w.baseline] ?? w.y,
    w: lat, h: w.size,
  };
};

/**
 * Bucatile DESENATE ale scenei: laturi, cuvinte, casete. Fiecare isi da obiectul din care
 * face parte, dreptunghiul ei si distanta pana la un punct.
 *
 * Si click-ul, si cadrul se uita la aceeasi lista — de aceea nimeresc mereu acelasi lucru.
 * Ce nu se vede nu intra in ea.
 */
function bucati(scene) {
  const out = [];
  for (const e of scene?.edges || []) {
    if (e.ghost || !e.obj) continue;                               // fantoma: e pe cale sa dispara
    out.push({ obj: e.obj, cadru: cadrulLaturii(e),
               pana: (x, y) => distToSeg(x, y, e.x1, e.y1, e.x2, e.y2) });
  }
  for (const w of scene?.words || []) {
    if (!(w.size > 0) || !w.obj) continue;                         // cuvant scos sau inca necrescut
    out.push({ obj: w.obj, cadru: cadrulCuvantului(w),
               pana: (x, y) => Math.hypot(x - w.x, y - w.y) });
  }
  for (const c of scene?.casete || []) {
    if (c.obj) out.push({ obj: c.obj, cadru: c, pana: (x, y) => distToRect(x, y, c) });
  }
  return out;
}

/** Dreptunghiul dintre doua puncte, oricare ar fi ordinea lor. */
export const dreptunghi = (x0, y0, x1, y1) => ({
  x: Math.min(x0, x1), y: Math.min(y0, y1),
  w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
});

/**
 * Obiectul de sub cursor: cea mai apropiata bucata desenata, daca e in prag.
 *
 * Caseta se apuca de oriunde din cadrul ei, nu doar de pe scris: un chenar mai lat decat
 * textul are colturi goale in care click-ul nu nimerea nimic, desi degetul arata spre el.
 *
 * @param {{edges:Array, words:Array, casete:Array}} scene scena deja desenata
 * @param {number} px pixeli de canvas, raportati la zona de desen
 * @param {number} py
 * @param {number} prag cat de departe poate fi cursorul si tot sa nimereasca
 * @returns {string|null} id-ul obiectului, sau null cand nimic nu e destul de aproape
 */
export function gaseste(scene, px, py, prag = 20) {
  let bun = null, min = Infinity;
  for (const b of bucati(scene)) {
    const d = b.pana(px, py);
    if (d < min) { min = d; bun = b.obj; }                          // la egalitate, primul gasit
  }
  return min <= prag ? bun : null;
}

/**
 * Id-urile obiectelor ATINSE de dreptunghiul de selectie.
 *
 * Atinse, nu cuprinse intreg: asa se prinde un grup trecand cadrul peste el, fara sa fie
 * inconjurat cu totul. Se masoara pe ce se DESENEAZA, nu pe gabaritul obiectului: un
 * dreptunghi mare are mijlocul gol, iar un cadru tras prin golul lui n-a atins nimic.
 *
 * @param {{x:number,y:number,w:number,h:number}} r in pixeli de canvas
 * @returns {Set<string>}
 */
export const cuprinse = (scene, r) => new Set(
  r ? bucati(scene).filter(b => seAting(b.cadru, r)).map(b => b.obj) : []);

export class InputManager {
  /** Sub atatia pixeli parcursi, gestul e tot un click: nici mutare, nici cadru. */
  static PRAG_MUTARE = 3;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {() => {edges:Array, words:Array, casete:Array}} getScene
   * @param {object} actiuni ce urmeaza dupa ce gestul s-a lamurit:
   *   select(id, aditiv)   click fara deplasare; id null = click in gol
   *   apuca(id, aditiv)    s-a apasat pe un obiect, inca nu se stie ce urmeaza
   *   incepe()             gestul a devenit mutare — aici se salveaza pentru undo
   *   muta(dx, dy)         deplasare, in pixeli de canvas
   *   termina()            s-a ridicat butonul dupa o mutare
   *   incepeCadru(aditiv)  gestul a devenit incadrare, pornita din gol
   *   intindeCadru(r)      dreptunghiul de acum
   *   terminaCadru()       s-a ridicat butonul dupa o incadrare
   */
  constructor(canvas, getScene, actiuni, ax = { l: 0, t: 0 }, prag = 20) {
    const nimic = () => {};
    this.m = { l: 0, t: 0, ...ax };       // gestul se raporteaza la zona de desen, nu la element
    this.canvas = canvas;
    this.getScene = getScene;
    this.prag = prag;
    this.apasat = null;
    this.act = { select: nimic, apuca: nimic, incepe: nimic, muta: nimic, termina: nimic,
                 incepeCadru: nimic, intindeCadru: nimic, terminaCadru: nimic, ...actiuni };

    canvas.addEventListener('pointerdown', e => this.jos(e));
    canvas.addEventListener('pointermove', e => this.misca(e));
    canvas.addEventListener('pointerup', e => this.sus(e));
    canvas.addEventListener('pointercancel', () => this.renunta());
  }

  /**
   * Punctul, in pixeli de canvas, raportat la zona de DESEN.
   *
   * Elementul isi are latimea scrisa in `style.width`, dar CSS-ul il lasa sa se micsoreze
   * (`max-width:100%`) cand nu incape in coloana lui — pe o fereastra ingusta, sau cu o
   * panza dusa spre 1200. Atunci un pixel de ecran nu mai e un pixel de panza, iar fara
   * raportul de mai jos click-ul cadea langa figura si o tragere de 100px de mouse muta
   * obiectul cu altceva decat 100.
   *
   * Un singur raport ajunge pentru amandoua axele: inaltimea elementului e `auto`, deci
   * se strange in acelasi fel ca latimea.
   */
  punct(e) {
    const r = this.canvas.getBoundingClientRect();
    const lat = parseFloat(this.canvas.style.width);
    const k = r.width && lat > 0 ? lat / r.width : 1;                   // cat l-a micsorat CSS-ul
    return { x: (e.clientX - r.left) * k - this.m.l, y: (e.clientY - r.top) * k - this.m.t };
  }

  /** Cursorul, schimbat doar cand chiar difera: altfel se rescrie la fiecare cadru. */
  cursor(c) { if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c; }

  jos(e) {
    if (e.button) return;                                              // doar butonul din stanga
    e.preventDefault?.();                                              // fara selectie de text in pagina
    const p = this.punct(e);
    const id = gaseste(this.getScene(), p.x, p.y, this.prag);
    this.apasat = {
      id, aditiv: e.shiftKey || e.ctrlKey || e.metaKey,
      x0: p.x, y0: p.y,                   // punctul apasat: de el atarna coltul cadrului
      x: p.x, y: p.y,                     // ultimul punct dus in socoteala, la mutare
      muta: false, cadru: false,          // ce s-a lamurit ca e gestul; deocamdata, un click
    };
    this.canvas.setPointerCapture?.(e.pointerId);   // gestul tine si cand cursorul iese de pe panza
    if (id) this.act.apuca(id, this.apasat.aditiv);
  }

  misca(e) {
    const p = this.punct(e);
    const a = this.apasat;
    if (!a) return this.cursor(gaseste(this.getScene(), p.x, p.y, this.prag) ? 'grab' : 'default');

    const dus = Math.hypot(p.x - a.x0, p.y - a.y0);   // fata de APASARE, nu de cadrul dinainte
    if (!a.id) {                                                       // pornit din gol: se intinde un cadru
      if (!a.cadru && dus < InputManager.PRAG_MUTARE) return;
      if (!a.cadru) { a.cadru = true; this.cursor('crosshair'); this.act.incepeCadru(a.aditiv); }
      return this.act.intindeCadru(dreptunghi(a.x0, a.y0, p.x, p.y));
    }
    if (!a.muta) {
      if (dus < InputManager.PRAG_MUTARE) return;                      // inca e un click
      a.muta = true;
      this.cursor('grabbing');
      this.act.incepe();
    }
    const dx = p.x - a.x, dy = p.y - a.y;   // primul pas duce si pixelii de pana la prag
    a.x = p.x; a.y = p.y;
    this.act.muta(dx, dy);
  }

  sus(e) {
    const a = this.apasat;
    this.apasat = null;
    if (!a) return;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);

    if (a.cadru) { this.act.terminaCadru(); return this.cursor('default'); }
    if (a.muta) { this.act.termina(); return this.cursor('grab'); }
    this.act.select(a.id, a.aditiv);                                   // gest fara deplasare: e un click
    this.cursor(a.id ? 'grab' : 'default');
  }

  /** Gestul a fost intrerupt de sistem. Ce s-a facut ramane facut, ca la ridicare. */
  renunta() {
    const a = this.apasat;
    this.apasat = null;
    if (a?.cadru) this.act.terminaCadru();
    else if (a?.muta) this.act.termina();
    this.cursor('default');
  }
}
