// Operations.js — transformarile pe figuri.
//
// DOMENIUL E RESTRANS DELIBERAT: singura forma posibila e patrulaterul cu unghiuri
// drepte — patrat sau dreptunghi. Patru segmente, toate unghiurile de 90 de grade.
//
// De ce: fiecare forma in plus inseamna reguli in plus in promptul de sistem, deci
// tokeni la fiecare cerere si inca o sansa ca modelul sa aleaga gresit. Cu o singura
// forma, modelul nu mai are ce sa greseasca la geometrie — ramane doar sa citeasca
// dimensiunile si pozitia din cerere.
//
// INVARIANT: `Sum(len)` se conserva la orice operatie, cu doua exceptii explicite —
// `resize` si `stretch`, unde schimbarea marimii chiar asta a fost cerut.

import { Figure } from '../models/Figure.js';

/** Translateaza figura ca centrul ei sa cada in `at` (implicit centrul panzei). */
function centerOn(fig, canvas, at) {
  return moveTo(fig, at || { x: canvas.w / 2, y: canvas.h / 2 });
}

/** Mutare pura, fara scalare. */
export function moveTo(fig, at) {
  const c = fig.centroid();
  const dx = at.x - c.x, dy = at.y - c.y;
  for (const p of fig.polylines) { p.origin.x += dx; p.origin.y += dy; }
  return fig;
}

/** Scalare uniforma in jurul unui punct: lungimile si pozitiile deopotriva. */
function rescale(fig, k, about) {
  for (const p of fig.polylines) {
    p.origin.x = about.x + (p.origin.x - about.x) * k;
    p.origin.y = about.y + (p.origin.y - about.y) * k;
    for (const seg of p.segs) seg.len *= k;
  }
  return fig;
}

/**
 * Dreptunghiul: singura figura pe care o poate construi motorul.
 * `w` si `h` sunt in pixeli. Cand sunt egale, iese patrat — catalogul il si
 * numeste asa, fara caz special in cod.
 */
export function rect(canvas, w, h) {
  const W = Math.max(1, w), H = Math.max(1, h);
  return Figure.fromPoints([
    { x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H },
  ], true);
}

/**
 * Taiere in `into` dreptunghiuri asezate unul langa altul.
 *
 * Taind un dreptunghi in doua apar muchii NOI, deci perimetrul total ar creste.
 * Ca sa pastram Sum(len), taiem natural si apoi rescalam uniform rezultatul:
 * piesele ies mai mici si se departeaza usor, dar suma ramane neatinsa.
 */
export function split(fig, canvas, into = 2, dir = 'auto') {
  const n = Math.max(2, Math.min(6, Math.round(into)));
  const total = fig.totalLength();
  const b = fig.isEmpty ? { minX: 0, maxX: total / 4, minY: 0, maxY: total / 4 } : fig.bbox();
  const W = (b.maxX - b.minX) || 100;
  const H = (b.maxY - b.minY) || 100;
  // la dimensiuni egale preferam taieturile verticale: "doua dreptunghiuri" se
  // citeste natural ca doua bucati alaturate
  const peVerticala = dir === 'v' ? true : dir === 'h' ? false : W >= H - 1e-6;

  const w = peVerticala ? W / n : W;
  const h = peVerticala ? H : H / n;

  let k = 0;
  const polys = [];
  for (let i = 0; i < n; i++) {
    const x = b.minX + (peVerticala ? i * w : 0);
    const y = b.minY + (peVerticala ? 0 : i * h);
    const piesa = Figure.fromPoints([
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ], true);
    for (const seg of piesa.polylines[0].segs) seg.id = 'e' + (k++);
    polys.push(piesa.polylines[0]);
  }

  const out = new Figure(polys);
  rescale(out, total / out.totalLength(), out.centroid());   // invariantul se restabileste
  return centerOn(out, canvas);
}

/**
 * Intindere NEUNIFORMA: latimea si inaltimea se dau separat, in pixeli.
 *
 * Nu se pot scala doar lungimile segmentelor — la o intindere pe o singura axa se
 * schimba si unghiurile. De aceea figura se desface in varfuri, se scaleaza fiecare
 * varf, si se reconstruieste. Pe un patrulater cu unghiuri drepte, unghiurile raman
 * drepte, deci rezultatul e tot un dreptunghi.
 *
 * Schimba intentionat Sum(len).
 */
export function stretch(fig, latime, inaltime) {
  const b = fig.bbox();
  const w = (b.maxX - b.minX) || 1;
  const h = (b.maxY - b.minY) || 1;
  const kx = (latime > 0 ? latime : w) / w;
  const ky = (inaltime > 0 ? inaltime : h) / h;
  if (Math.abs(kx - 1) < 1e-6 && Math.abs(ky - 1) < 1e-6) return fig;

  let id = 0;
  const polys = [];
  for (const pl of fig.polylines) {
    if (!pl.segs.length) continue;
    const pts = fig.pointsOf(pl).map(q => ({
      x: b.minX + (q.x - b.minX) * kx,
      y: b.minY + (q.y - b.minY) * ky,
    }));
    const nou = Figure.fromPoints(pts, pl.closed);
    for (const seg of nou.polylines[0].segs) seg.id = 'e' + (id++);
    polys.push(nou.polylines[0]);
  }
  return polys.length ? new Figure(polys) : fig;
}

/**
 * Scalare NEUNIFORMA fata de originea panzei — coltul (0,0) in pixeli de canvas.
 *
 * Folosita cand se schimba gabaritul panzei: scena o urmeaza, cu regula de trei simpla
 * pe fiecare axa. In pixeli de canvas transformarea e chiar inmultirea cu (kx, ky) fata
 * de origine, iar pozitia LOGICA iese proportionala de la sine, fiindca ky = H_nou/H_vechi.
 *
 * Ca la `stretch`, nu se pot scala doar lungimile segmentelor: la o intindere pe o
 * singura axa se schimba si unghiurile. De aceea figura se desface in varfuri, se
 * scaleaza fiecare varf, si se reconstruieste. Pe un patrulater cu unghiuri drepte
 * unghiurile raman drepte, deci rezultatul e tot un dreptunghi.
 *
 * Schimba intentionat Sum(len), ca `resize` si `stretch`.
 */
export function scaleXY(fig, kx, ky) {
  if (Math.abs(kx - 1) < 1e-9 && Math.abs(ky - 1) < 1e-9) return fig;

  let id = 0;
  const polys = [];
  for (const pl of fig.polylines) {
    if (!pl.segs.length) continue;
    const pts = fig.pointsOf(pl).map(q => ({ x: q.x * kx, y: q.y * ky }));
    const nou = Figure.fromPoints(pts, pl.closed);
    for (const seg of nou.polylines[0].segs) seg.id = 'e' + (id++);
    polys.push(nou.polylines[0]);
  }
  return polys.length ? new Figure(polys) : fig;
}

/** Redimensionare uniforma in jurul centrului. Schimba intentionat Sum(len). */
export function resize(fig, k) {
  const factor = Math.max(0.1, Math.min(10, Number(k) || 1));
  if (Math.abs(factor - 1) < 1e-6) return fig;
  return rescale(fig, factor, fig.centroid());
}

/** Scaleaza figura ca latura ei cea mai mare sa fie exact `dorit` pixeli. */
export function scaleToFit(fig, dorit) {
  const b = fig.bbox();
  const d = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if (!(d > 1e-9) || !(dorit > 0)) return fig;
  return rescale(fig, dorit / d, { x: b.minX, y: b.minY });
}

/**
 * Aseaza figura astfel incat un punct ANUME al ei sa cada in tinta.
 * Implicit centrul; se pot cere si colturile sau mijloacele laturilor.
 * Atentie la y: pe canvas creste in JOS, deci "bottom" inseamna maxY.
 */
export function anchorAt(fig, tinta, mod = 'center') {
  const b = fig.bbox();
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const jos = b.maxY, sus = b.minY;

  const puncte = {
    center: { x: cx,     y: cy  },
    bl:     { x: b.minX, y: jos },
    br:     { x: b.maxX, y: jos },
    tl:     { x: b.minX, y: sus },
    tr:     { x: b.maxX, y: sus },
    bottom: { x: cx,     y: jos },
    top:    { x: cx,     y: sus },
    left:   { x: b.minX, y: cy  },
    right:  { x: b.maxX, y: cy  },
  };
  const ref = puncte[mod] || puncte.center;
  const dx = tinta.x - ref.x, dy = tinta.y - ref.y;
  for (const p of fig.polylines) { p.origin.x += dx; p.origin.y += dy; }
  return fig;
}

export const OPS = { rect, split, stretch, scaleXY, resize, scaleToFit, anchorAt, moveTo };
