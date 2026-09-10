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

import { CELL, PANZA_MAX } from './Scene.js';

/**
 * Cate celule incap pe latura celei mai MARI panze, nu a celei de pornire.
 *
 * Domeniul catalogului trebuie sa acopere tot ce se poate desena. Cat timp panza se
 * oprea la 800, cele 16 celule ale grilei erau si plafonul figurilor, si nimic nu se
 * lovea de el. De cand panza poate creste la 1200, o figura de 20 de celule chiar
 * exista — iar plafonata la 16 ar primi acelasi cod ca una de 16, adica doua figuri
 * diferite cu acelasi nume. Catalogul se masoara dupa ce poate incapea, nu dupa cat
 * incape acum.
 */
const CELULE = Math.round(PANZA_MAX / CELL);

/** Gabaritul in celule, plafonat la domeniu. */
const celule = px => Math.max(1, Math.min(CELULE, Math.round(px / CELL)));

export const ATTRIBUTES = [
  { id: 'A1', q: 'how many separate outlines?', get: s => Math.min(8, s.nPoly), dom: 8 },
  { id: 'A2', q: 'how wide is it, in cells?', get: s => celule(s.bboxW), dom: CELULE },
  { id: 'A3', q: 'how tall is it, in cells?', get: s => celule(s.bboxH), dom: CELULE },
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
  if (sig.nPoly === 0 || sig.nSeg === 0) return 'EMPTY';

  const w = celule(sig.bboxW), h = celule(sig.bboxH);
  if (sig.nPoly > 1) return `GROUP_${sig.nPoly}`;
  return w === h ? 'SQUARE' : 'RECTANGLE';
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
  const entry = known ?? { leaf: derive(sig), ops: OPS_TOATE, desc: `code ${k}` };
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
  for (let w = 1; w <= CELULE; w++) {
    for (let h = 1; h <= CELULE; h++) {
      out.push(`${w === h ? 'SQUARE' : 'RECTANGLE'} ${w}x${h}: ops ${OPS_TOATE.join(',')}`);
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
