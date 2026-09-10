// mastra/scheme.ts — DSL-ul, in doua ipostaze.
//
// 1. SCHEMA, in Zod: contractul DSL-ului — chei de un caracter, puncte ca perechi de
//    numere, nimic in plus. Ea poate pleca la model prin `structuredOutput`, si atunci
//    forma nu mai e o rugaminte din prompt, ci o conditie a API-ului. Dar numai daca e
//    scrisa PE RAMURI: masuratoarea de mai jos arata ca o schema plata inrautateste
//    raspunsul in loc sa-l stranga. Cine o trimite si cine nu e scris in `agenti.ts`.
//
// 2. CITITORUL, care ia raspunsul si scoate din el forma pe care o intelege motorul.
//    El nu respinge, REPARA: taie ce e prea mare, rotunjeste, arunca pasul invalid si
//    pastreaza restul. De aceea nu e scris ca `.parse()` pe o schema stricta — un
//    model care greseste un camp din opt nu trebuie sa piarda turul intreg.
//
// Cele doua se uita la aceleasi chei, dar au treburi diferite: prima spune ce sa CEARA
// modelului, a doua ce sa FACA din ce a primit. Izolarea intre agenti sta tot in a
// doua: geometrul n-are cod care sa citeasca „t", deci un „t" strecurat nu ajunge
// nicaieri, oricat l-ar ruga promptul sa nu-l emita.

import { z } from 'zod';
import { ia, cel, clamp, punct, tinta, motiv, PANZA_MAX, type Punct } from './valori.js';

/**
 * Raspuns legitim „nu e treaba mea".
 *
 * Un agent chemat pentru o cerere care nu-l priveste raspunde gol. Nu e o eroare si nu
 * declanseaza lantul de rezerve al lui Mastra: turul merge mai departe cu ce au
 * raspuns ceilalti. Fara distinctia asta, un casetar chemat degeaba ar arde toate
 * modelele din lant ca sa afle iar si iar ca n-are ce spune.
 */
export class RaspunsGol extends Error {
  constructor(cine: string) {
    super('empty DSL: ' + cine + ' has nothing to answer');
    this.name = 'RaspunsGol';
  }
}

// ─────────────────────────────────────────────── schemele trimise modelului
//
// Forma lor nu e o chestiune de gust. MASURAT pe gemini-2.5-flash, cu promptul de
// creare neschimbat, la cererea „fa un dreptunghi de 300 pe 150 in punctul (400,400)":
//
//   fara schema, doar promptul   {"g":{"o":"r","w":300,"h":150,"p":[400,400]},"y":"..."}
//   obiect plat, toate optionale {"g":{"o":"r","w":300,"x":false}}          <- GRESIT
//   uniune discriminata pe "o"   {"g":{"o":"r","w":300,"h":150,"p":[400,400]}}
//
// Un obiect cu multe campuri optionale il incurca pe Gemini in decodarea constransa:
// emite primul camp, le pierde pe urmatoarele si inventeaza unul („x":false"). Cu
// operatia ca discriminator, fiecare ramura are putine campuri si raspunsul redevine
// corect. Aceeasi verificare pe „fa un dreptunghi" (fara cifre) da {"o":"r"} — deci
// omisiunea ceruta de prompt, cand cererea nu spune cat de mare, se pastreaza.
//
// Punctele sunt `z.array(z.number())`, nu `z.tuple`: tuplul devine `prefixItems` in
// JSON Schema, iar dialectul de structured output al Gemini nu-l cunoaste. Perechea se
// verifica oricum la citire, unde `punct()` accepta si [x,y] si {x,y}.

const PUNCT = z.array(z.number()).describe('[x,y] in pixeli');

const ANCORA = z.enum(['center', 'bl', 'br', 'tl', 'tr', 'top', 'bottom', 'left', 'right']);

const G_rect = z.object({
  o: z.literal('r').describe('dreptunghi nou'),
  w: z.number().optional().describe('latime in pixeli'),
  h: z.number().optional().describe('inaltime in pixeli'),
  p: PUNCT.optional().describe('unde se aseaza'),
  a: ANCORA.optional().describe('ce anume din figura cade in punct'),
  m: z.array(PUNCT).optional().describe('cate o figura pe fiecare punct'),
  x: z.boolean().optional().describe('inlocuieste ce era acolo'),
});
const G_split = z.object({
  o: z.literal('s').describe('taie figura in bucati'),
  n: z.number().optional().describe('in cate bucati, 2..6'),
  d: z.enum(['v', 'h']).optional().describe('directia taierii'),
});
const G_resize = z.object({
  o: z.literal('z').describe('marimea figurii'),
  k: z.number().optional().describe('factor, 0.1..10'),
  w: z.number().optional(),
  h: z.number().optional(),
});
const G_move = z.object({
  o: z.literal('m').describe('muta figura'),
  p: PUNCT.optional().describe('unde'),
  a: ANCORA.optional(),
});
const G_clear = z.object({ o: z.literal('c').describe('sterge toata scena') });
const G_panza = z.object({
  o: z.literal('p').describe('gabaritul PANZEI, nu al figurilor'),
  w: z.number().optional(),
  h: z.number().optional(),
});

const OP_GEOM = z.discriminatedUnion('o', [G_rect, G_split, G_resize, G_move, G_clear, G_panza]);

/** Tinta si motivul: le emit toti agentii, deci sunt scrise o singura data. */
const COADA = {
  n: z.array(z.union([z.number(), z.string()])).optional()
    .describe('pe cine cade comanda: 1 e figura, "t1" e text'),
  y: z.string().optional().describe('motivul, max 6 cuvinte'),
};

export const IESIRE_GEOM = z.object({
  g: z.union([OP_GEOM, z.array(OP_GEOM)]).nullable()
    .describe('una sau mai multe operatii, in ordine; null daca nu e geometrie'),
  ...COADA,
});

/** Ce poate insoti orice comanda de text, indiferent de legare. */
const TEXT_COMUN = {
  s: z.array(z.string()).optional().describe('inlocuieste continutul; [] il sterge'),
  d: z.array(z.string()).optional().describe('adauga un text nou'),
  w: z.array(z.number()).optional().describe('indicii cuvintelor afectate'),
  v: z.number().optional().describe('muta textul pe figura cu numarul asta'),
  k: z.number().optional().describe('marimea literei, 0.4..3'),
  r: z.boolean().optional().describe('repeta cuvintele peste laturi sau piese'),
  g: z.number().optional().describe('rotatia, sfert de tura'),
};

// Legarea decide ce inseamna „a": o latura, un colt sau un punct. Ramurile astea o
// spun in schema, nu doar in proza promptului — si tot ele tin numarul de campuri mic
// pe fiecare varianta, care e ce conteaza pentru decodarea constransa.
const T_latura = z.object({
  b: z.literal('e').describe('pe o latura anume'),
  a: z.enum(['top', 'bottom', 'left', 'right']),
  in: z.boolean().optional().describe('INAUNTRUL figurii, sub latura'),
  ...TEXT_COMUN,
});
const T_colt = z.object({
  b: z.literal('k').describe('intr-un colt anume'),
  a: z.enum(['tl', 'tr', 'br', 'bl']),
  ...TEXT_COMUN,
});
const T_punct = z.object({
  b: z.literal('q').describe('intr-un punct de pe panza'),
  a: PUNCT,
  ...TEXT_COMUN,
});
const T_simplu = z.object({
  b: z.enum(['i', 'p', 's', 'l', 'c', 'n'])
    .describe('i=in figura p=pe fiecare piesa s=pe toate laturile l=pe contur c=in colturi n=ascuns'),
  ...TEXT_COMUN,
});
// Fara legare: o cerere care schimba doar ce scrie sau cat de mare e. Ultima in
// uniune, fiindca `z.object` ignora cheile in plus si ar inghiti si celelalte forme.
const T_fara = z.object(TEXT_COMUN);

export const IESIRE_TEXT = z.object({
  t: z.union([T_latura, T_colt, T_punct, T_simplu, T_fara]).nullable()
    .describe('comanda de text; null daca nu e despre text'),
  ...COADA,
});

const K_caseta = z.object({
  b: z.literal('x').describe('pune textul intr-o caseta'),
  a: PUNCT.optional().describe('unde sta caseta pe panza'),
  z: z.array(z.number()).optional().describe('marimea exacta [latime,inaltime]'),
});
const K_schimbare = z.object({
  f: z.union([z.number(), z.array(z.number())])
    .describe('cu cat se schimba fata de cat e ACUM; pereche = [latime,inaltime]'),
});

export const IESIRE_CASETA = z.object({
  t: z.union([K_caseta, K_schimbare]).nullable()
    .describe('comanda de caseta; null daca nu e despre caseta'),
  ...COADA,
});

/**
 * JSON-ul dintr-un raspuns care n-a venit pe schema.
 *
 * Cand agentul nu trimite schema la model (vezi `schemaLaModel`), raspunsul e text, iar
 * unele modele pun o propozitie in jurul lui. Luam ce e intre acolade.
 */
export function extrageJSON(brut: string): unknown {
  try { return JSON.parse(brut); } catch { /* se incearca mai jos */ }
  const a = brut.indexOf('{'), b = brut.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('answer without JSON: ' + brut.slice(0, 120));
  return JSON.parse(brut.slice(a, b + 1));
}


// ─────────────────────────────────────────────── geometria, la citire

/** Operatiile pe care le accepta motorul, in forma lunga. */
export const OPS = ['rect', 'split', 'resize', 'clear', 'move', 'canvas_resize'];

/** Forma minificata a operatiei, asa cum vine pe fir. */
const OP_SCURT: Record<string, string> = {
  r: 'rect', s: 'split', z: 'resize', c: 'clear', m: 'move', p: 'canvas_resize',
};

/** Ce anume din figura cade in punctul dat: un colt, mijlocul unei laturi, centrul. */
export const ANCORE = ['center', 'bl', 'br', 'tl', 'tr', 'top', 'bottom', 'left', 'right'];

/**
 * Cati pasi incap intr-o singura cerere.
 *
 * Un lant mai lung nu mai e o cerere, e un program: fiecare pas se aplica orbeste,
 * fara ca omul sa vada intre timp ce s-a intamplat. Opt e destul pentru „fa trei
 * patrate si imparte-l pe primul", si destul de putin cat un raspuns aiurit sa nu
 * umple panza.
 */
export const MAX_PASI = 8;

type Geom = Record<string, unknown>;

/** w si h in pixeli; „un patrat de 50" vine ca o singura marime. */
function dimensiuni(g: unknown, out: Geom) {
  const w = ia(g, 'w'), h = ia(g, 'h'), size = ia(g, 's', 'size');
  if (Number.isFinite(Number(w)) && Number.isFinite(Number(h))) {
    out.w = cel(w); out.h = cel(h);
  } else if (Number.isFinite(Number(size))) {
    out.w = cel(size); out.h = cel(size);
  }
}

function taiere(g: unknown, out: Geom) {
  const n = ia(g, 'n', 'into');
  out.into = Number.isFinite(Number(n)) ? clamp(Math.round(Number(n)), 2, 6) : 2;
  const dir = ia(g, 'd', 'dir');
  if (dir === 'v' || dir === 'h') out.dir = dir;
}

/** Mutarea fara punct n-are ce sa insemne: mai bine nimic decat o figura teleportata. */
function mutare(g: unknown, out: Geom) {
  const unu = punct(ia(g, 'p', 'at'));
  if (!unu) return null;
  out.at = unu;
  const a = ia(g, 'a', 'anchor');
  if (ANCORE.includes(a as string)) out.anchor = a;
  return out;
}

function plasare(g: unknown, out: Geom) {
  const unu = punct(ia(g, 'p', 'at'));
  if (unu) out.at = unu;

  // mai multe figuri dintr-o cerere, cate una pe fiecare punct
  const multe = ia(g, 'm', 'cells');
  if (Array.isArray(multe)) {
    const bune = multe.map(punct).filter(Boolean).slice(0, 32);
    if (bune.length) out.cells = bune;
  }
  const a = ia(g, 'a', 'anchor');
  if (ANCORE.includes(a as string)) out.anchor = a;
  if (ia(g, 'x', 'replace') === true) out.replace = true;
}

/**
 * O singura operatie, curatata. Inima citirii: si un „g" simplu, si fiecare pas dintr-o
 * lista trec pe aici, deci un lant nu poate cuprinde nimic ce n-ar fi fost acceptat
 * singur.
 *
 * @returns null cand operatia nu e una pe care motorul o cunoaste
 */
export function operatie(g: unknown): Geom | null {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;

  const brut = ia(g, 'o', 'op') as string;
  const op = OP_SCURT[brut] || brut;
  if (!OPS.includes(op)) return null;

  const out: Geom = { op };

  if (op === 'rect' || op === 'resize' || op === 'canvas_resize') dimensiuni(g, out);
  if (op === 'resize' && out.w === undefined) {
    const k = ia(g, 'k', 'scale');
    out.scale = Number.isFinite(Number(k)) ? clamp(Number(k), 0.1, 10) : 1.5;
  }
  if (op === 'split') taiere(g, out);
  if (op === 'move') return mutare(g, out);
  if (op === 'rect') plasare(g, out);

  return out;
}

/**
 * Campul „g": una sau mai multe operatii, incadrate in limitele panzei.
 *
 * O cerere poate insirui mai multi pasi — „fa un patrat si un dreptunghi" — si atunci
 * „g" vine ca lista. Un pas care nu trece se arunca, nu strica restul: mai bine trei
 * figuri din patru decat un tur pierdut. Cand ramane unul singur, iese ca OBIECT, nu ca
 * lista de unul: asa restul aplicatiei nu vede nicio schimbare pentru cererile
 * obisnuite, care sunt cele mai multe.
 */
export function citesteGeom(d: unknown): Geom | Geom[] | null {
  const g = ia(d, 'g', 'geom');
  if (Array.isArray(g)) {
    const pasi = g.map(operatie).filter(Boolean).slice(0, MAX_PASI) as Geom[];
    return pasi.length ? (pasi.length === 1 ? pasi[0] : pasi) : null;
  }
  return operatie(g);
}

// ─────────────────────────────────────────────── textul, la citire

/** Cele opt feluri de a lega textul de o figura, plus ascunderea lui. */
export const BIND = ['inside', 'pieces', 'path', 'sides', 'side', 'corners', 'corner', 'point', 'none'];

const BIND_SCURT: Record<string, string> = {
  i: 'inside', p: 'pieces', q: 'point', s: 'sides', e: 'side',
  l: 'path', c: 'corners', k: 'corner', n: 'none',
};

export const LATURI = ['top', 'bottom', 'left', 'right'];
export const COLTURI = ['tl', 'tr', 'br', 'bl'];

/** Sferturile de tura, singurele unghiuri acceptate. 360 e tot 0: pozitia initiala. */
export const ROTATII = [0, 90, 180, 270];

/**
 * Unghiul, adus la cel mai apropiat sfert de tura.
 *
 * Un text intors cu 37 de grade nu se aliniaza cu nimic din figura si arata a greseala.
 * Domeniul e restrans intentionat, ca si formele: patru pozitii, toate paralele cu
 * laturile.
 *
 * @returns null cand nu s-a cerut nicio rotatie
 */
export function grade(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // 360 -> 0, -90 -> 270, 450 -> 90
  const intreg = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
  return ROTATII.includes(intreg) ? intreg : 0;
}

type Text = Record<string, unknown>;

/** Unde se aseaza textul fata de figura. */
function legareText(t: unknown, T: Text) {
  const brut = ia(t, 'b', 'bind') as string;
  const bind = BIND_SCURT[brut] || brut;
  if (!BIND.includes(bind)) return;

  T.bind = bind;
  const a = ia(t, 'a', 'at');

  if (bind === 'corner') T.at = COLTURI.includes(a as string) ? a : 'tr';
  if (bind === 'side') {
    T.at = LATURI.includes(a as string) ? a : 'top';
    // implicit textul cade in afara laturii; „in" il aduce inauntrul figurii
    if (ia(t, 'in', 'inside') === true) T.in = true;
  }
  if (bind === 'point') {
    const q = punct(a);
    if (q) T.at = q; else T.bind = 'inside';   // punct invalid -> inapoi in figura
  }
}

/** Ce scrie: inlocuire („s") sau adaugare langa textul existent („d"). */
function continut(t: unknown, T: Text) {
  const curata = (a: unknown[]) => a.slice(0, 16)
    .map(x => String(x).slice(0, 24).trim())
    .filter(x => x.length);

  const set = ia(t, 's', 'set');
  if (Array.isArray(set)) T.set = curata(set);   // lista goala sterge textul

  const adaugat = ia(t, 'd', 'add');
  if (Array.isArray(adaugat)) {
    const c = curata(adaugat);
    if (c.length) T.add = c;
  }
}

/**
 * Campul „t". O comanda de text e valida daca schimba macar ceva: unde sta textul, ce
 * scrie, pe ce figura e sau cat de mare. Altfel n-are ce aplica motorul.
 */
export function citesteText(d: unknown): Text | null {
  const t = ia(d, 't', 'text');
  if (!t || typeof t !== 'object') return null;

  const T: Text = {};
  legareText(t, T);
  continut(t, T);

  const words = ia(t, 'w', 'words');
  if (Array.isArray(words)) {
    T.words = words.map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n < 64).slice(0, 32);
  }
  // textul apartine unei figuri: „v" il muta pe alta
  const to = ia(t, 'v', 'to');
  if (Number.isInteger(Number(to)) && Number(to) >= 0 && Number(to) < 64) T.to = Number(to);

  const k = ia(t, 'k', 'scale');
  if (Number.isFinite(Number(k))) T.scale = clamp(Number(k), 0.4, 3);
  if (ia(t, 'r', 'repeat') === true) T.repeat = true;

  const g = grade(ia(t, 'g', 'rot'));
  if (g !== null) T.rot = g;

  const schimbaCeva = T.bind || T.set || T.add || T.to !== undefined
                   || T.scale !== undefined || T.rot !== undefined;
  return schimbaCeva ? T : null;
}

// ─────────────────────────────────────────────── caseta, la citire

/** Caseta implicita: 0 pe o axa = „exact cat cere textul", deci se strange pe el. */
export const CASETA_IMPLICIT = { w: 0, h: 0 };

/** Sub atat nu mai incape niciun cuvant, deci acolo se opreste micsorarea. */
export const CASETA_MIN = 20;

/** Textul intra in caseta; optional, intr-un punct anume de pe panza. */
function legareCaseta(t: unknown, T: Text) {
  const b = ia(t, 'b', 'bind');
  if (b !== 'x' && b !== 'box') return;
  T.bind = 'box';
  // caseta sta implicit in mijlocul figurii; un punct o desprinde de ea
  const q = punct(ia(t, 'a', 'at'));
  if (q) T.at = q;
}

/**
 * Cat de mare e caseta. Doua feluri de a o cere, si nu se amesteca.
 *
 * „z" da marimea exacta. „f" o schimba cu atatia pixeli fata de cat e acum — si tocmai
 * de aceea nu poate fi rezolvata aici: promptul n-are istoric, modelul nu vede latimea
 * de acum. Adunarea o face motorul, local.
 *
 * Latimea nu poate lipsi: ea taie randurile. Inaltimea poate — atunci caseta se strange
 * singura pe text.
 */
function marimeCaseta(t: unknown, T: Text) {
  const z = ia(t, 'z', 'box') as unknown;
  if (z) {
    const [rw, rh] = Array.isArray(z)
      ? z
      : [(z as { w: number; h: number }).w, (z as { w: number; h: number }).h];
    const w = Math.round(Number(rw)), h = Math.round(Number(rh));
    if (Number.isFinite(w) && w > 0) {
      T.box = {
        w: clamp(w, CASETA_MIN, PANZA_MAX),
        h: Number.isFinite(h) && h > 0 ? clamp(h, CASETA_MIN, PANZA_MAX) : 0,
      };
    }
  }

  // „f" e fie un numar — aceeasi crestere pe ambele axe — fie o pereche
  // [latime, inaltime], cand cererea da o cifra pentru fiecare. Fara perechea asta,
  // „mareste cu 50x200" pierdea a doua cifra si caseta crestea doar pe x.
  const f = ia(t, 'f', 'boxDelta') as unknown;
  const pereche = Array.isArray(f)
    ? f
    : (f && typeof f === 'object' ? [(f as Punct & { w: number; h: number }).w, (f as { w: number; h: number }).h] : null);
  if (pereche) {
    const lat = Math.round(Number(pereche[0])), inalt = Math.round(Number(pereche[1]));
    const d = {
      w: Number.isFinite(lat) ? clamp(lat, -PANZA_MAX, PANZA_MAX) : 0,
      h: Number.isFinite(inalt) ? clamp(inalt, -PANZA_MAX, PANZA_MAX) : 0,
    };
    if (d.w || d.h) T.boxDelta = d;
  } else if (Number.isFinite(Number(f))) {
    const n = Math.round(Number(f));
    // zero n-ar schimba nimic, deci n-ar fi o comanda
    if (n !== 0) T.boxDelta = clamp(n, -PANZA_MAX, PANZA_MAX);
  }
}

/**
 * Campul „t", citit DOAR pentru ce tine de caseta.
 *
 * Daca modelul a strecurat si continut sau alta legare, nu se uita nimeni: nu e un camp
 * sters la final, e cod care nu exista. Tipograful face invers.
 */
export function citesteCaseta(d: unknown): Text | null {
  const t = ia(d, 't', 'text');
  if (!t || typeof t !== 'object') return null;

  const T: Text = {};
  legareCaseta(t, T);
  marimeCaseta(t, T);

  const schimbaCeva = T.bind || T.box !== undefined || T.boxDelta !== undefined;
  return schimbaCeva ? T : null;
}

// ─────────────────────────────────────────────── usa comuna

export type DSL = {
  geom: Geom | Geom[] | null;
  text: Text | null;
  why: string;
  target?: (number | string)[];
};

/** Cititorul fiecarui domeniu, gasit dupa numele lui. */
export const CITITOR = {
  geometrie: citesteGeom,
  text: citesteText,
  caseta: citesteCaseta,
} as const;

export type Domeniu = keyof typeof CITITOR;

/**
 * DSL-ul, curatat si incadrat in limite.
 *
 * Fiecare domeniu isi citeste singur campul, deci izolarea e structurala: cand
 * `domeniu` e dat, cititorii celorlalti nici macar nu sunt chemati. Fara `domeniu` trec
 * toti — asa o foloseste parserul local de rezerva, care nu are agenti si emite dintr-o
 * data si figura, si textul, si caseta.
 *
 * Caseta se topeste in „text": are cititor propriu doar cat sa nu se calce cu
 * tipograful, iar motorul primeste o singura comanda de text.
 */
export function validate(d: unknown, domeniu?: Domeniu): DSL {
  const out: DSL = { geom: null, text: null, why: motiv(d) };
  if (!domeniu || domeniu === 'geometrie') out.geom = citesteGeom(d);
  if (!domeniu || domeniu === 'text') out.text = citesteText(d);
  if (!domeniu || domeniu === 'caseta') {
    const c = citesteCaseta(d);
    if (c) out.text = { ...(out.text || {}), ...c };
  }
  tinta(d, out as unknown as Record<string, unknown>);
  if (!out.geom && !out.text) throw new Error('empty DSL after validation');
  return out;
}
