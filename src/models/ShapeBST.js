// ShapeBST.js — catalogul de figuri, ca arbore de atribute auto-extensibil.
//
// Domeniul e restrans la patrulatere cu unghiuri drepte, deci atributele care
// erau constante au disparut: "contur inchis", "4 laturi", "unghiuri de 90",
// "convex" — toate sunt adevarate mereu, iar o intrebare al carei raspuns nu
// variaza nu separa nimic si nu merita niciun token.
//
// Au ramas trei niveluri:
//   A1  cate contururi separate       (split produce mai multe piese)
//   A2  latimea, in celule
//   A3  inaltimea, in celule
//
// Numele se DEDUCE din cod, nu se cauta intr-o lista: latime === inaltime da
// PATRAT, altfel DREPTUNGHI. Nu exista tabel de forme de intretinut.

import { CELL, GRID } from './Scene.js';

/** Gabaritul in celule, plafonat la grila. */
const celule = px => Math.max(1, Math.min(GRID, Math.round(px / CELL)));

export const ATTRIBUTES = [
  { id: 'A1', q: 'câte contururi separate?', get: s => Math.min(8, s.nPoly), dom: 8 },
  { id: 'A2', q: 'ce lățime are, în celule?', get: s => celule(s.bboxW), dom: GRID },
  { id: 'A3', q: 'ce înălțime are, în celule?', get: s => celule(s.bboxH), dom: GRID },
];

export const code = sig => ATTRIBUTES.map(a => a.get(sig)).join('|');

/**
 * Toate operatiile sunt valabile pe orice figura din domeniu.
 *
 * Numele sunt cele din DSL — cele pe care motorul chiar le primeste. „stretch" a stat
 * aici o vreme, dar el e o functie interna a motorului, nu o operatie pe care sa o
 * poata cere cineva: in catalogul plat aparea o optiune care nu exista.
 */
const OPS_TOATE = ['rect', 'move', 'split', 'resize'];

/**
 * Deducerea numelui din atribute. Toata "inteligenta" catalogului incape aici,
 * pentru ca domeniul are exact doua forme.
 */
function derive(sig) {
  if (sig.nPoly === 0 || sig.nSeg === 0) return 'GOL';

  const w = celule(sig.bboxW), h = celule(sig.bboxH);
  if (sig.nPoly > 1) return `GRUP_${sig.nPoly}`;
  return w === h ? 'PATRAT' : 'DREPTUNGHI';
}

/** Ce a invatat sistemul pana acum. Porneste GOL. */
export const registry = new Map();

/**
 * Cautare. Zero apeluri la LLM.
 * @returns {{leaf, ops, desc, path, questions, comparisons, learned}}
 */
export function search(sig) {
  const k = code(sig);
  const known = registry.get(k);
  const entry = known ?? { leaf: derive(sig), ops: OPS_TOATE, desc: `cod ${k}` };
  if (!known) registry.set(k, entry);

  return {
    ...entry,
    path: k,
    questions: ATTRIBUTES.map(a => `${a.q} -> ${a.get(sig)}`),
    comparisons: ATTRIBUTES.length,
    learned: !known,
  };
}

/** Scheletul: cele trei intrebari. Constant, indiferent cate figuri exista. */
export function skeleton() {
  return ATTRIBUTES.map(a => `${a.id}: ${a.q}`).join('\n');
}

/** Varianta NAIVA, pentru comparatie: fiecare combinatie enumerata explicit. */
export function flatCatalog() {
  const out = [];
  for (let w = 1; w <= GRID; w++) {
    for (let h = 1; h <= GRID; h++) {
      out.push(`${w === h ? 'PATRAT' : 'DREPTUNGHI'} ${w}x${h}: ops ${OPS_TOATE.join(',')}`);
    }
  }
  return out.join('\n');
}

/** Cate figuri distincte poate adresa codificarea. */
export function addressable() {
  return ATTRIBUTES.reduce((a, x) => a * x.dom, 1);
}

/** Cate a invatat efectiv pana acum. */
export function leafCount() { return registry.size; }
