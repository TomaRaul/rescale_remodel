// TextBinder.js — modurile de legare a textului.
//
//   inside   : in interiorul unui contur inchis
//   path     : curge pe traseu, parametrizat pe arc (se indreapta singur la unfold)
//   corners  : cate un cuvant in FIECARE din cele 4 colturi ale panzei
//   corner   : TOT (sub)setul de cuvinte stivuit intr-UN colt
//   none     : ascuns
//
// Toate primesc `items` = [{i, text, w}], adica DOAR cuvintele care le revin.
// De asta se pot lega cuvinte diferite in moduri diferite in acelasi timp.

import { Figure } from '../models/Figure.js';

/** Punct + tangenta la arc-ul `s` de-a lungul listei de muchii. */
function sampleAt(edges, s) {
  let acc = 0;
  for (const e of edges) {
    if (s <= acc + e.len || e === edges[edges.length - 1]) {
      const t = e.len === 0 ? 0 : (s - acc) / e.len;
      return { x: e.x1 + (e.x2 - e.x1) * t, y: e.y1 + (e.y2 - e.y1) * t, rot: e.angle };
    }
    acc += e.len;
  }
  return { x: 0, y: 0, rot: 0 };
}

/** Textul pe traseu: fiecare cuvant la arc-ul lui, rotit dupa tangenta muchiei. */
export function bindPath(figure, items, fontPx, offset = -10) {
  if (!items.length) return [];
  const edges = figure.toEdges();
  const pathLen = figure.totalLength();
  const W = items.reduce((a, it) => a + it.w, 0);
  const slack = Math.max(0, pathLen - W) / (items.length + 1);

  const out = [];
  let s = slack;
  for (const it of items) {
    const p = sampleAt(edges, s + it.w / 2);      // ancoram la mijlocul cuvantului
    const r = (p.rot * Math.PI) / 180;
    out.push({
      i: it.i, text: it.text,
      x: p.x - Math.sin(r) * offset,
      y: p.y + Math.cos(r) * offset,
      rot: p.rot, size: fontPx, align: 'center', baseline: 'middle',
    });
    s += it.w + slack;
  }
  return out;
}

/**
 * Latura ceruta prin nume, aleasa GEOMETRIC, nu dupa ordinea din polilinie.
 *
 * "latura de sus" inseamna cea mai de sus latura de pe ecran, indiferent de la ce
 * varf incepe conturul sau in ce sens e parcurs. Textul se aseaza langa ea, impins
 * in afara fata de centrul figurii — asa nu intra peste desen si nu ajunge in
 * partea opusa.
 */
export function bindSide(figure, items, fontPx, care = 'top', dist = 12, inauntru = false) {
  if (!items.length) return [];
  const laturi = figure.visualEdges();
  if (!laturi.length) return [];

  const mij = e => ({ x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 });
  // pe canvas y creste in JOS: latura "de sus" e cea cu y minim
  const scor = {
    top:    e => mij(e).y,
    bottom: e => -mij(e).y,
    left:   e => mij(e).x,
    right:  e => -mij(e).x,
  }[care] || (e => mij(e).y);

  let aleasa = laturi[0];
  for (const e of laturi) if (scor(e) < scor(aleasa)) aleasa = e;

  const c = figure.centroid();
  const m = mij(aleasa);
  // Directia normala la latura: dinspre centrul figurii spre mijlocul ei = IN AFARA.
  // Cu `inauntru`, semnul se inverseaza si textul cade lipit de latura, dar in interior:
  // "pe latura de sus" e in afara, "sub latura de sus" e inauntru.
  const semn = inauntru ? -1 : 1;
  const dx = m.x - c.x, dy = m.y - c.y;
  const L = Math.hypot(dx, dy) || 1;
  const ox = (dx / L) * (dist + fontPx * 0.5) * semn;
  const oy = (dy / L) * (dist + fontPx * 0.5) * semn;

  const orizontala = Math.abs(aleasa.y1 - aleasa.y2) < Math.abs(aleasa.x1 - aleasa.x2);
  const rot = orizontala ? 0 : (care === 'left' ? -90 : 90);
  const lh = fontPx * 1.3;
  const n = items.length;

  return items.map((it, k) => {
    const d = (k - (n - 1) / 2) * lh;      // mai multe cuvinte se stivuiesc perpendicular
    return {
      i: it.i, text: it.text,
      x: m.x + ox + (orizontala ? 0 : d),
      y: m.y + oy + (orizontala ? d : 0),
      rot, size: fontPx, align: 'center', baseline: 'middle',
    };
  });
}

/**
 * Cate un cuvant pe FIECARE latura vizibila, la mijlocul ei, rotit odata cu ea.
 * Daca sunt mai putine cuvinte decat laturi, se reiau ciclic — asa un singur
 * "HAM" ajunge pe toate cele patru laturi ale patratului.
 */
export function bindSides(figure, items, fontPx, offset = 12) {
  if (!items.length) return [];
  const laturi = figure.visualEdges();
  if (!laturi.length) return [];

  // grupam cuvintele pe laturi: latura k primeste cuvintele cu indicele k, k+n, ...
  const peLatura = laturi.map(() => []);
  items.forEach((it, k) => peLatura[k % laturi.length].push(it));

  const c = figure.centroid();
  const out = [];
  peLatura.forEach((grup, k) => {
    if (!grup.length) return;
    const L = laturi[k];
    const r = (L.angle * Math.PI) / 180;
    // normala la latura, orientata mereu SPRE EXTERIOR fata de centrul figurii
    const mx = (L.x1 + L.x2) / 2, my = (L.y1 + L.y2) / 2;
    const nx = -Math.sin(r), ny = Math.cos(r);
    const semn = (mx - c.x) * nx + (my - c.y) * ny >= 0 ? 1 : -1;
    grup.forEach((it, j) => {
      // mai multe cuvinte pe aceeasi latura se distribuie de-a lungul ei
      const t = (j + 1) / (grup.length + 1);
      const px = L.x1 + (L.x2 - L.x1) * t;
      const py = L.y1 + (L.y2 - L.y1) * t;
      out.push({
        i: it.i, text: it.text,
        x: px + nx * semn * offset,
        y: py + ny * semn * offset,
        rot: L.angle, size: fontPx, align: 'center', baseline: 'middle',
      });
    });
  });
  return out;
}

/**
 * Cate un cuvant in interiorul FIECAREI piese (contur inchis), centrat in ea.
 * Diferit de bindInside, care centreaza un singur bloc pe toata figura — de aia
 * un "MIAU" pe doua dreptunghiuri ajungea pe muchia dintre ele, nu in fiecare.
 */
export function bindPieces(figure, items, fontPx) {
  if (!items.length) return [];
  const inchise = figure.polylines.filter(p => p.closed && p.segs.length);
  const tinte = (inchise.length ? inchise : figure.polylines).filter(p => p.segs.length);
  if (!tinte.length) return [];

  const centre = tinte.map(p => new Figure([p]).centroid());

  const peBucata = tinte.map(() => []);
  items.forEach((it, k) => peBucata[k % tinte.length].push(it));

  const out = [];
  peBucata.forEach((grup, k) => {
    const c = centre[k];
    const lh = fontPx * 1.35;
    const top = c.y - ((grup.length - 1) * lh) / 2;
    grup.forEach((it, j) => out.push({
      i: it.i, text: it.text, x: c.x, y: top + j * lh,
      rot: 0, size: fontPx, align: 'center', baseline: 'middle',
    }));
  });
  return out;
}

/**
 * Text asezat intr-un PUNCT anume de pe panza, independent de orice figura.
 * Punctul vine deja in pixeli — conversia din coordonate de grila se face in App,
 * ca binder-ul sa nu stie nimic despre grila.
 */
/**
 * Caseta de text: cuvintele se aseaza pe RANDURI intr-un dreptunghi de latime data.
 *
 * E singurul mod care nu urmeaza geometria figurii. Restul leaga textul de laturi,
 * de colturi sau de contur; aici textul isi are propriul ambalaj, cu latimea si
 * inaltimea masurate in pixeli. De aceea intoarce si caseta insasi — cine deseneaza
 * are nevoie de ea, iar cine o redimensioneaza are nevoie de marimea de acum.
 *
 * Latimea 0 sau lipsa inseamna „exact cat cere textul", ca inaltimea: caseta e un
 * ambalaj, iar unul mai lat decat continutul lui arata a greseala, nu a caseta. Se
 * incearca un singur rand; daca acela n-ar incapea pe panza, randurile se rup si
 * caseta se strange pe cel mai lat dintre ele.
 *
 * Latimea taie randurile; inaltimea nu taie nimic, doar aseaza blocul pe verticala.
 * Un cuvant mai lat decat caseta ramane pe randul lui: mai bine iese putin decat
 * sa dispara.
 *
 * Caseta nu iese din panza. Figura poate: ea are invariantul ei si politica
 * `scale-shape` o micsoreaza cand nu incape. Caseta n-are ce scala — textul ar
 * deveni ilizibil — asa ca se IMPINGE inauntru. O caseta lipita de marginea de jos
 * a unei figuri de la baza panzei ar fi iesit pe jumatate afara si s-ar fi taiat
 * la desenare, fara ca nimic sa spuna de ce.
 *
 * @param {{x:number,y:number}} centru unde cade mijlocul casetei, in pixeli
 * @param {{w:number,h:number}} caseta dimensiunile cerute, in pixeli
 * @param {{w:number,h:number}} [panza] limitele in care e tinuta; lipsa = nelimitat
 * @returns {{words:object[], box:{x:number,y:number,w:number,h:number}}}
 */
export function bindBox(items, centru, caseta, fontPx, panza) {
  const lh = fontPx * 1.35;
  const spatiu = fontPx * 0.32;
  const latMax = panza ? panza.w : Infinity;

  // Fara o latime ceruta, caseta se strange pe text: se incearca un singur rand, cat
  // cer cuvintele plus spatiile dintre ele. Plafonul panzei ramane singurul care mai
  // poate forta ruperea randurilor.
  const auto = !(caseta && caseta.w > 0);
  const totul = items.reduce((a, it) => a + it.w, 0)
              + Math.max(0, items.length - 1) * spatiu;
  const rupe = Math.min(latMax, Math.max(fontPx, auto ? totul : caseta.w));

  // randurile: se aduna cuvinte cat incap in latime
  const randuri = [];
  let curent = null;
  for (const it of items) {
    const lat = curent ? curent.lat + spatiu + it.w : it.w;
    if (curent && lat <= rupe) { curent.items.push(it); curent.lat = lat; }
    else { curent = { items: [it], lat: it.w }; randuri.push(curent); }
  }

  // pe „auto" caseta masoara cat cel mai LAT RAND, nu cat s-a incercat sa se rupa:
  // daca plafonul panzei a rupt randurile, ambalajul se strange pe ce a iesit
  const w = auto
    ? Math.min(latMax, Math.max(fontPx, ...randuri.map(r => r.lat)))
    : rupe;

  // inaltimea ceruta e respectata, dar nu sub cat ocupa randurile
  const nevoie = randuri.length * lh;
  const h = Math.min(panza ? panza.h : Infinity,
                     Math.max(nevoie, caseta && caseta.h > 0 ? caseta.h : nevoie));

  // Impinsa inauntru, nu taiata. Cand e cat panza sau mai mare, se centreaza:
  // n-are unde sa se mai duca, iar centrul e singura pozitie fara favoriti.
  const inauntru = (v, marime, limita) => (marime >= limita
    ? limita / 2
    : Math.max(marime / 2, Math.min(limita - marime / 2, v)));
  const cx = panza ? inauntru(centru.x, w, panza.w) : centru.x;
  const cy = panza ? inauntru(centru.y, h, panza.h) : centru.y;

  const box = { x: cx - w / 2, y: cy - h / 2, w, h };
  const primulRand = cy - ((randuri.length - 1) * lh) / 2;

  const out = [];
  randuri.forEach((r, k) => {
    let x = cx - r.lat / 2;                       // randul se centreaza in caseta
    for (const it of r.items) {
      out.push({
        i: it.i, text: it.text,
        x: x + it.w / 2, y: primulRand + k * lh,
        rot: 0, size: fontPx, align: 'center', baseline: 'middle',
      });
      x += it.w + spatiu;
    }
  });

  return { words: out, box };
}

export function bindPoint(items, punct, fontPx) {
  if (!items.length || !punct) return [];
  const lh = fontPx * 1.35;
  const top = punct.y - ((items.length - 1) * lh) / 2;
  return items.map((it, k) => ({
    i: it.i, text: it.text, x: punct.x, y: top + k * lh,
    rot: 0, size: fontPx, align: 'center', baseline: 'middle',
  }));
}

/** Bloc centrat pe bbox-ul figurii. */
export function bindInside(figure, items, fontPx) {
  if (!items.length) return [];
  const b = figure.bbox();
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const lh = fontPx * 1.45;
  const top = cy - ((items.length - 1) * lh) / 2;
  return items.map((it, k) => ({
    i: it.i, text: it.text, x: cx, y: top + k * lh,
    rot: 0, size: fontPx, align: 'center', baseline: 'middle',
  }));
}

/** Colturile panzei. */
const COLTURI = {
  tl: { kx: 0, ky: 0, align: 'left',  baseline: 'top',    dy:  1 },
  tr: { kx: 1, ky: 0, align: 'right', baseline: 'top',    dy:  1 },
  br: { kx: 1, ky: 1, align: 'right', baseline: 'bottom', dy: -1 },
  bl: { kx: 0, ky: 1, align: 'left',  baseline: 'bottom', dy: -1 },
};
const ORDINE = ['tl', 'tr', 'br', 'bl'];

/** TOT setul primit, stivuit intr-un singur colt. */
export function bindCorner(items, canvas, fontPx, at = 'tr', pad = 18) {
  if (!items.length) return [];
  const c = COLTURI[at] || COLTURI.tr;
  const x = c.kx ? canvas.w - pad : pad;
  const y0 = c.ky ? canvas.h - pad : pad;
  const lh = fontPx * 1.4;
  const n = items.length;
  return items.map((it, k) => ({
    i: it.i, text: it.text, x,
    y: y0 + c.dy * (c.dy > 0 ? k : n - 1 - k) * lh,
    rot: 0, size: fontPx, align: c.align, baseline: c.baseline,
  }));
}

/** Cate un cuvant in fiecare colt, in ordinea sursei; peste 4 se stivuiesc. */
export function bindCorners(items, canvas, fontPx, pad = 18) {
  const folosit = {};
  return items.map((it, k) => {
    const at = ORDINE[k % 4];
    const c = COLTURI[at];
    const rand = folosit[at] = (folosit[at] ?? -1) + 1;
    return {
      i: it.i, text: it.text,
      x: c.kx ? canvas.w - pad : pad,
      y: (c.ky ? canvas.h - pad : pad) + c.dy * rand * fontPx * 1.4,
      rot: 0, size: fontPx, align: c.align, baseline: c.baseline,
    };
  });
}
