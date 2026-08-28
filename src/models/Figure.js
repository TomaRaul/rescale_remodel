// Figure.js — stratul de date.
//
// O figura = o lista de POLILINII. O polilinie = segmente {id, len, turn}.
// Segmentul stocheaza REGULI (lungime + viraj), nu coordonate. Coordonatele se deriva.
//
// INVARIANTUL SISTEMULUI: suma lungimilor tuturor segmentelor e constanta.
// Orice operatie doar rearanjeaza aceeasi "cerneala" — inclusiv cand SCHIMBA
// numarul de laturi (4 -> 6 imparte acelasi total la 6, nu adauga material).

export class Figure {
  constructor(polylines = []) {
    this.polylines = polylines;
  }

  /**
   * Constructorul universal: dai varfurile, iese figura.
   * Orice figura noua (trapez, hexagon, ce vrei) se adauga scriind doar varfurile ei.
   */
  static fromPoints(pts, closed = true, idPrefix = 'e') {
    const n = pts.length;
    const m = closed ? n : n - 1;
    const dirs = [], lens = [];
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      lens.push(Math.hypot(b.x - a.x, b.y - a.y));
      dirs.push((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
    }
    const segs = lens.map((len, i) => {
      let turn = 0;
      if (closed || i < m - 1) {
        turn = dirs[(i + 1) % m] - dirs[i];
        while (turn > 180) turn -= 360;
        while (turn <= -180) turn += 360;
      }
      return { id: idPrefix + i, len, turn };
    });
    return new Figure([{ origin: { ...pts[0] }, heading: dirs[0], closed, segs }]);
  }

  /** Panza goala: niciun contur. De aici porneste aplicatia. */
  static empty() { return new Figure([]); }

  get isEmpty() { return this.polylines.every(p => !p.segs.length); }

  static square(side, cx, cy) {
    const h = side / 2;
    return Figure.fromPoints([
      { x: cx - h, y: cy - h }, { x: cx + h, y: cy - h },
      { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h },
    ], true);
  }

  get segments() { return this.polylines.flatMap(p => p.segs); }

  totalLength() { return this.segments.reduce((s, e) => s + e.len, 0); }

  /**
   * Laturile VIZIBILE: segmentele consecutive cu turn ~ 0 sunt coliniare, deci
   * ochiul vede o singura latura. Le pastram separate in date (pentru animatie),
   * dar le contopim aici — altfel unfold ar da "polilinie cu 4 laturi", nu "linie".
   */
  visualSides() {
    const out = [];
    for (const p of this.polylines) {
      if (!p.segs.length) continue;
      const sides = [];
      let run = 0, dir = p.heading, h = p.heading;
      for (let i = 0; i < p.segs.length; i++) {
        if (run === 0) dir = h;
        run += p.segs[i].len;
        h += p.segs[i].turn;
        const last = i === p.segs.length - 1;
        if (last || Math.abs(p.segs[i].turn) > 1e-6) { sides.push({ len: run, dir }); run = 0; }
      }
      out.push({ closed: p.closed, sides });
    }
    return out;
  }

  /**
   * Semnatura = vectorul de ATRIBUTE pe care se face clasificarea.
   * Nu contine numele figurii: numele se DEDUCE din atribute (vezi ShapeCatalog).
   * Asta e ce permite sistemului sa recunoasca figuri pe care nu le-a mai vazut.
   */
  signature() {
    const groups = this.visualSides();
    const all = groups.flatMap(g => g.sides);
    const lens = all.map(s => Math.round(s.len));

    // perechi de laturi paralele, numarate doar in interiorul conturelor inchise
    let parallels = 0;
    for (const g of groups) {
      if (!g.closed) continue;
      for (let i = 0; i < g.sides.length; i++) {
        for (let j = i + 1; j < g.sides.length; j++) {
          let d = Math.abs(g.sides[i].dir - g.sides[j].dir) % 180;
          if (Math.min(d, 180 - d) < 1.5) parallels++;
        }
      }
    }

    const turns = this.polylines.flatMap(p => p.segs.map(s => Math.abs(s.turn)))
                                .filter(t => t > 1e-6);

    // Convex = toate virajele coteste in acelasi sens. Un contur cu viraje in
    // ambele sensuri are "adancituri": stea, cruce, sageata, litera L.
    const semne = new Set(this.polylines.flatMap(p => p.segs)
      .map(x => x.turn).filter(t => Math.abs(t) > 1e-6).map(t => Math.sign(t)));

    const bb = this.bbox();

    return {
      // gabaritul, in pixeli; ShapeBST il converteste in celule
      bboxW: Math.round(bb.maxX - bb.minX),
      bboxH: Math.round(bb.maxY - bb.minY),
      nPoly: this.polylines.length,
      nSeg: all.length,
      // laturile celei mai complexe polilinii: la un grup de 4 dreptunghiuri
      // conteaza ca fiecare piesa are 4 laturi, nu ca in total sunt 16
      nSegMax: Math.max(0, ...groups.map(g => g.sides.length)),
      convex: semne.size <= 1,
      nRawSeg: this.segments.length,
      closed: groups.some(g => g.closed),
      allClosed: groups.length > 0 && groups.every(g => g.closed),
      equalLens: new Set(lens).size === 1,
      right: turns.length > 0 && turns.every(t => Math.abs(t - 90) < 1e-6),
      parallels: Math.min(6, parallels),
      distinctLens: Math.min(4, new Set(lens).size),
    };
  }

  /** Varfurile UNEI polilinii, in coordonate absolute. */
  pointsOf(p) {
    const out = [];
    let x = p.origin.x, y = p.origin.y, h = p.heading;
    out.push({ x, y });
    for (let i = 0; i < p.segs.length; i++) {
      const s = p.segs[i];
      const r = (h * Math.PI) / 180;
      x += s.len * Math.cos(r);
      y += s.len * Math.sin(r);
      h += s.turn;
      // la contur inchis ultimul varf coincide cu primul, nu-l repetam
      if (!(p.closed && i === p.segs.length - 1)) out.push({ x, y });
    }
    return out;
  }

  toEdges() {
    const out = [];
    for (const p of this.polylines) {
      let x = p.origin.x, y = p.origin.y, h = p.heading;
      for (const s of p.segs) {
        const r = (h * Math.PI) / 180;
        const nx = x + s.len * Math.cos(r);
        const ny = y + s.len * Math.sin(r);
        out.push({ id: s.id, x1: x, y1: y, x2: nx, y2: ny, len: s.len, angle: h });
        x = nx; y = ny; h += s.turn;
      }
    }
    return out;
  }

  /**
   * Laturile vizibile CU coordonate: segmentele coliniare contopite intr-una singura.
   * Necesar ca sa poti pune cate un cuvant pe fiecare latura, nu pe fiecare segment.
   */
  visualEdges() {
    const out = [];
    for (const p of this.polylines) {
      let x = p.origin.x, y = p.origin.y, h = p.heading;
      let sx = x, sy = y, run = 0, ang = h;
      for (let i = 0; i < p.segs.length; i++) {
        const s = p.segs[i];
        if (run === 0) { sx = x; sy = y; ang = h; }
        const r = (h * Math.PI) / 180;
        const nx = x + s.len * Math.cos(r);
        const ny = y + s.len * Math.sin(r);
        run += s.len;
        const last = i === p.segs.length - 1;
        if (last || Math.abs(s.turn) > 1e-6) {
          out.push({ x1: sx, y1: sy, x2: nx, y2: ny, len: run, angle: ang });
          run = 0;
        }
        x = nx; y = ny; h += s.turn;
      }
    }
    return out;
  }

  bbox() {
    const e = this.toEdges();
    if (!e.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const xs = e.flatMap(s => [s.x1, s.x2]);
    const ys = e.flatMap(s => [s.y1, s.y2]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  centroid() {
    const b = this.bbox();
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }

  /** Un singur contur, extras ca figura de sine statatoare — "nodul" selectabil. */
  subFigure(i) {
    const p = this.polylines[i];
    if (!p) return null;
    return new Figure([{
      origin: { ...p.origin }, heading: p.heading, closed: p.closed,
      segs: p.segs.map(s => ({ ...s })),
    }]);
  }

  /** Inlocuieste conturul `i` cu contururile unei alte figuri. */
  replaceAt(i, fig) {
    const out = this.clone();
    out.polylines.splice(i, 1, ...fig.polylines.map(p => ({
      origin: { ...p.origin }, heading: p.heading, closed: p.closed,
      segs: p.segs.map(s => ({ ...s })),
    })));
    return out.reindex();
  }

  /** Id-uri unice si stabile pe toata figura, dupa orice modificare structurala. */
  reindex() {
    let k = 0;
    for (const p of this.polylines) for (const s of p.segs) s.id = 'e' + (k++);
    return this;
  }

  clone() {
    return new Figure(this.polylines.map(p => ({
      origin: { ...p.origin }, heading: p.heading, closed: p.closed,
      segs: p.segs.map(s => ({ ...s })),
    })));
  }
}
