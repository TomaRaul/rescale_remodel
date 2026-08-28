// llm.js — fata pe care o vede restul aplicatiei.
//
// Aici nu mai sta nicio cunostinta despre figuri, despre text sau despre provideri:
// totul e imprumutat de la clasele din server/agents/ si server/providers.js. Rolul
// fisierului asta e sa pastreze o singura usa de intrare — `askModel` — si sa nu
// oblige `serve.js` sau testele sa stie cum e organizata echipa inauntru.
//
//   Router     alege cine raspunde         (local, zero tokeni)
//   Geometru   figuri: rect, split, resize, move, clear
//   Tipograf   text: continut, legare, marime, transfer intre figuri
//   Casetar    caseta in care curge textul: daca intra in ea si cat de mare e
//   Echipa     ii ruleaza in paralel si combina raspunsurile

import { Echipa } from './agents/orchestration/Echipa.js';
import { Geometru } from './agents/geometry/Geometru.js';
import { Tipograf } from './agents/text/Tipograf.js';
import { Casetar } from './agents/textbox/Casetar.js';
import { ModelClient } from './providers.js';
import { NL, PANZA, motiv, tinta } from './agents/base/valori.js';

export { activeProvider, resolveOllamaModel } from './providers.js';

const GEOMETRU = new Geometru();
const TIPOGRAF = new Tipograf();
const CASETAR = new Casetar();
const ECHIPA = new Echipa([GEOMETRU, TIPOGRAF, CASETAR]);

// ---------------------------------------------------------------- rutarea

/** Ce sectiuni de prompt cere promptul asta. Clasificare locala, zero tokeni. */
export function sectiuni(prompt, doar) {
  return ECHIPA.router.sectiuni(prompt, doar);
}

/** Ce agenti sunt chemati, ca domenii: 'geometrie', 'text', 'caseta'. */
export function agenti(prompt, doar) {
  return ECHIPA.router.alege(prompt, doar).map(a => a.domeniu);
}

/** Promptul de sistem al unui singur agent — exact ce pleaca pe fir pentru el. */
export function promptAgent(agent, prompt, doar) {
  return ECHIPA.prompt(agent, prompt, doar);
}

/** Toate prompturile la un loc. Nu se trimite asa nicaieri: e pentru masuratori. */
export function systemPrompt(prompt) {
  return ECHIPA.agenti.map(a => promptAgent(a.domeniu, prompt)).join(NL);
}

// ---------------------------------------------------------------- starea scenei

export function buildUser(prompt, state) {
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
  const parti = [];
  if (noduri.length) parti.push(noduri.length + ' figuri');
  if (texte.length) parti.push(texte.length + ' texte');
  const cap = parti.length
    ? 'scena: ' + parti.join(', ') + (sel.size ? ', selectate marcate cu *' : '')
    : 'scena: goala';

  // Panza se poate micsora din prompt, iar promptul de sistem vorbeste de 800x800.
  // Cand nu mai e asa, gabaritul de ACUM pleaca in stare — o linie de vreo 10 tokeni,
  // platita doar cand chiar s-a schimbat ceva. Fara ea, modelul ar cere puncte care
  // pe panza de acum nu mai exista.
  const pz = p.panza;
  const gabarit = pz && typeof pz === 'object' && (pz.w !== PANZA || pz.h !== PANZA)
    ? ['panza: ' + pz.w + 'x' + pz.h + 'px, originea (0,0) in stanga jos']
    : [];
  return [cap, ...gabarit, ...noduri, ...texte, 'cerere: ' + prompt].join(NL);
}

// ---------------------------------------------------------------- turul

/**
 * Un tur: routerul alege agentii, ei raspund in paralel, raspunsurile se combina.
 * @returns {{dsl:object, provider:string, model:string, usage:object, ms:number,
 *            incercari:number, agenti:string[], sectiuni:string[]}}
 */
export async function askModel(prompt, state, doar) {
  const client = await ModelClient.creeaza();
  return ECHIPA.rezolva(client, prompt, buildUser(prompt, state), doar);
}

// ---------------------------------------------------------------- validarea

/**
 * DSL-ul, curatat si incadrat in limite.
 *
 * Fiecare agent isi valideaza singur campul, deci izolarea e structurala: cand
 * `domeniu` e dat, validatorii celorlalti nici macar nu sunt chemati. Fara
 * `domeniu` trec toti — asa o foloseste parserul local de rezerva, care nu are
 * agenti si emite dintr-o data si figura, si textul, si caseta.
 *
 * Caseta se topeste in „text", ca la `Echipa.combina`: are camp propriu doar cat
 * sa nu se calce cu tipograful, iar motorul primeste o singura comanda de text.
 *
 * @param {object} d raspunsul brut, in forma scurta sau in cea lunga
 * @param {'geometrie'|'text'|'caseta'} [domeniu]
 */
export function validate(d, domeniu) {
  const out = { geom: null, text: null, why: motiv(d) };
  if (!domeniu || domeniu === 'geometrie') out.geom = GEOMETRU.valideaza(d);
  if (!domeniu || domeniu === 'text') out.text = TIPOGRAF.valideaza(d);
  if (!domeniu || domeniu === 'caseta') {
    const c = CASETAR.valideaza(d);
    if (c) out.text = { ...(out.text || {}), ...c };
  }
  tinta(d, out);
  if (!out.geom && !out.text) throw new Error('DSL gol dupa validare');
  return out;
}
