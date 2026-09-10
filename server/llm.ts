// llm.ts — fata pe care o vede restul aplicatiei.
//
// Aici nu sta nicio cunostinta despre figuri, despre text sau despre provideri: totul e
// imprumutat de la modulele din server/mastra/. Rolul fisierului asta e sa pastreze o
// singura usa de intrare — `askModel` — si sa nu oblige `serve.js` sau testele sa stie
// cum e organizata echipa inauntru. Semnaturile sunt aceleasi si dupa migrare.
//
//   memorie    turul deja dat, servit pe loc  (local, zero tokeni, ZERO agenti)
//   Router     alege cine raspunde         (local, zero tokeni)
//   Geometru   figuri: rect, split, resize, move, clear
//   Tipograf   text: continut, legare, marime, transfer intre figuri
//   Casetar    caseta in care curge textul: daca intra in ea si cat de mare e
//   turul      Workflow-ul Mastra: ii ruleaza in paralel si combina raspunsurile

// Mastra trimite statistici de folosire daca nu i se spune altfel. Proiectul nu are
// nevoie de ele, iar o pornire locala n-are de ce sa vorbeasca cu nimeni. Se pune
// INAINTE de orice import din Mastra, si numai daca mediul n-a hotarat deja altceva.
process.env.MASTRA_TELEMETRY_DISABLED ??= '1';

import { turul, router } from './mastra/flux.js';
import { cheie, adu, tineMinte } from './memorie.js';
import { ECHIPA } from './mastra/agenti.js';
import { NL, PANZA } from './mastra/valori.js';
import type { Domeniu } from './mastra/scheme.js';

export { validate } from './mastra/scheme.js';
import { activeProvider } from './mastra/modele.js';
export { activeProvider, resolveOllamaModel } from './mastra/modele.js';
export { cate as cateMemorate, uita as uitaTot, MEMORIE_MAX } from './memorie.js';

// ---------------------------------------------------------------- rutarea

/** Ce sectiuni de prompt cere promptul asta. Clasificare locala, zero tokeni. */
export function sectiuni(prompt: string, doar?: string) {
  return router.sectiuni(prompt, doar);
}

/** Ce agenti sunt chemati, ca domenii: 'geometrie', 'text', 'caseta'. */
export function agenti(prompt: string, doar?: string) {
  return router.alege(prompt, doar).map(a => a.domeniu);
}

/** Promptul de sistem al unui singur agent — exact ce pleaca pe fir pentru el. */
export function promptAgent(agent: string, prompt?: string, doar?: string) {
  const a = ECHIPA.find(x => x.domeniu === agent);
  if (!a) return '';
  return a.prompt(prompt || doar ? router.sectiuni(prompt || '', doar) : undefined);
}

/** Toate prompturile la un loc. Nu se trimite asa nicaieri: e pentru masuratori. */
export function systemPrompt(prompt?: string) {
  return ECHIPA.map(a => promptAgent(a.domeniu, prompt)).join(NL);
}

// ---------------------------------------------------------------- starea scenei

type Stare = {
  noduri?: { i: number; nume: string; w: number; h: number; at: { x: number; y: number } }[];
  texte?: { i: number; cuvinte: string[]; pe?: number | null; sel?: boolean; at: { x: number; y: number } }[];
  parent?: { selectate?: number[]; panza?: { w: number; h: number } };
};

export function buildUser(prompt: string, state: Stare) {
  // Doua serii de numere, independente: figurile #0, #1 ... si textele T0, T1 ...
  // Un text sta fie pe o figura, fie singur pe panza — de aceea are linia lui, nu e
  // lipit de figura. Asa „figura 1" ramane a doua FIGURA, oricate texte s-ar fi scris
  // intre timp, iar „textul 1" e al doilea TEXT.
  // Steluta marcheaza ce e selectat: pe acolo cad comenzile fara tinta.
  const sel = new Set((state.parent && state.parent.selectate) || []);
  const noduri = (state.noduri || []).map(n =>
    (sel.has(n.i) ? '*' : '') + '#' + n.i + ' ' + n.nume + ' '
    + n.w + 'x' + n.h + 'px @' + n.at.x + ',' + n.at.y);

  const texte = (state.texte || []).map(t =>
    (t.sel ? '*' : '') + 'T' + t.i + ' ' + t.cuvinte.join(' ')
    + (t.pe !== null && t.pe !== undefined ? ' pe #' + t.pe : ' liber @' + t.at.x + ',' + t.at.y));

  const p = state.parent || {};
  const parti: string[] = [];
  if (noduri.length) parti.push(noduri.length + ' figuri');
  if (texte.length) parti.push(texte.length + ' texte');
  const cap = parti.length
    ? 'scena: ' + parti.join(', ') + (sel.size ? ', selectate marcate cu *' : '')
    : 'scena: goala';

  // Panza se poate micsora din prompt, iar promptul de sistem vorbeste de 800x800.
  // Cand nu mai e asa, gabaritul de ACUM pleaca in stare — o linie de vreo 10 tokeni,
  // platita doar cand chiar s-a schimbat ceva. Fara ea, modelul ar cere puncte care pe
  // panza de acum nu mai exista.
  const pz = p.panza;
  const gabarit = pz && typeof pz === 'object' && (pz.w !== PANZA || pz.h !== PANZA)
    ? ['panza: ' + pz.w + 'x' + pz.h + 'px, originea (0,0) in stanga jos']
    : [];
  return [cap, ...gabarit, ...noduri, ...texte, 'cerere: ' + prompt].join(NL);
}

// ---------------------------------------------------------------- turul

/**
 * Un tur: memoria intai, si abia daca nu stie — routerul, agentii in paralel, combinarea.
 *
 * Ordinea conteaza si e singurul lucru important din functia asta. Verificarea memoriei
 * se face INAINTE de orice altceva: un tur repetat nu construieste graful, nu trezeste
 * niciun agent si nu atinge reteaua. Costa o inmultire pe caracter si atat.
 *
 * `incercari` ramane in raspuns pentru interfata, dar nu mai spune mare lucru: lantul de
 * rezerve e al lui Mastra si nu raporteaza prin cate modele a trecut.
 */
export async function askModel(prompt: string, state: Stare, doar?: string) {
  const t0 = Date.now();
  const user = buildUser(prompt, state);

  // ── 1. memoria ────────────────────────────────────────────────────────────
  const k = cheie(prompt, user, doar);
  const stiut = adu(k);
  if (stiut) {
    // Consumul e ZERO, nu cel de data trecuta: turul asta chiar n-a costat nimic, si
    // asa il si numara contorul din interfata.
    return { ...stiut, usage: { in: 0, out: 0 }, ms: Date.now() - t0, incercari: 0, memorat: true };
  }

  // ── 2. apelul extern ──────────────────────────────────────────────────────
  const run = await turul.createRun();
  const res = await run.start({
    inputData: { cerere: prompt, user, doar },
  });

  if (res.status !== 'success') {
    const e = (res as { error?: Error }).error;
    throw new Error(String((e && e.message) || e || 'the turn did not succeed'));
  }

  const r = res.result as {
    dsl: Record<string, unknown>;
    usage: { in: number; out: number };
    agenti: string[];
    detalii: unknown[];
  };

  const activ = activeProvider();
  const amintire = {
    dsl: r.dsl,
    agenti: r.agenti,
    sectiuni: router.sectiuni(prompt, doar),
    detalii: r.detalii,
    provider: activ.id,
    model: activ.model,
  };
  // Se tine minte doar ce a trecut de validare: un tur care a esuat n-a ajuns pana aici.
  tineMinte(k, amintire);

  return { ...amintire, usage: r.usage, ms: Date.now() - t0, incercari: 1, memorat: false };
}

export type { Domeniu };
