// geometry/Geometru.js — agentul spatial.
//
// Se ocupa numai de figuri: creare, mutare, taiere, marime. Nu are nicio linie de
// prompt despre text si — mai important — nu are nicio linie de COD care sa citeasca
// text. Chiar daca modelul i-ar raspunde cu un camp „t", nimeni nu s-ar uita la el.

import { Agent } from '../base/Agent.js';
import { ia, cel, clamp, punct } from '../base/valori.js';

const ROL = [
  '',
  'ESTI AGENTUL DE GEOMETRIE. Te ocupi NUMAI de figuri: creare, mutare, taiere, marime.',
  'Nu stii nimic despre text si nu emiti niciodata campul "t". Daca cererea contine si',
  'o parte de text, ignor-o complet: se ocupa alt agent de ea, in paralel.',
  'Singura forma posibila e patrulaterul cu unghiuri drepte: patrat sau dreptunghi.',
  '',
  'Raspuns: { "g": <operatie sau null>, "n": [numere sau lipsa], "y": "<max 6 cuvinte>" }',
  'Daca cererea nu contine nicio comanda de geometrie, raspunde cu {"g":null}.',
  '',
  'UN SINGUR PAS: daca cererea insiruie mai multi pasi de geometrie, executa DOAR',
  'primul si scrie in "y" ce a ramas. Nu trimite liste de operatii.',
];

const CREARE = [
  '',
  '=== CREARE, campul "g" ===',
  '  {"o":"r","w":300,"h":150,"p":[400,400]}   dreptunghi nou',
  '        w, h = latimea si inaltimea in PIXELI. OBLIGATORII.',
  '        Cererea le da ca "a pe b" sau "axb": a e w, b e h.',
  '        "un patrat de 50" -> w:50, h:50.',
  '        O celula de grila are 50 de pixeli: "2 celule" -> 100.',
  '        Cifrele mici fara unitate sunt tot pixeli: "de 1" inseamna un pixel.',
  '        NU inventa dimensiuni; daca cererea nu spune cat de mare, omite w si h',
  '        si motorul cere marimea utilizatorului.',
  '        p = punctul unde se aseaza, ca [x,y]. Implicit acolo cade CENTRUL.',
  '        a = ancora: ce anume din figura cade in punct. "bl" "br" "tl" "tr"',
  '            pentru un colt, "top" "bottom" "left" "right" pentru mijlocul unei laturi.',
  '        m = [[100,100],[500,500]] creeaza cate una pe fiecare punct.',
  '        Mai multe figuri pot porni din ACELASI punct: se suprapun, nu se sterg.',
  '        x = true inlocuieste ce era acolo. Doar cand cererea zice "inlocuieste".',
  '',
  'cerere: un dreptunghi de 300 pe 150 in punctul (400,400)',
  '  -> {"g":{"o":"r","w":300,"h":150,"p":[400,400]},"y":"dreptunghi"}',
  'cerere: un patrat de 50 cu coltul stanga jos in punctul (25,25)',
  '  -> {"g":{"o":"r","w":50,"h":50,"p":[25,25],"a":"bl"},"y":"colt in punct"}',
];

const MODIFICA = [
  '',
  '=== MODIFICARE, campul "g" — pe figuri care EXISTA deja ===',
  '  {"o":"m","p":[400,400]}    MUTA figura in acel punct. Forma si marimea raman',
  '        neschimbate; se schimba doar locul. Accepta si a = ancora.',
  '        Ca sa pui o figura in interiorul alteia, foloseste pozitia celeilalte:',
  '        starea iti da pentru fiecare obiect CENTRUL lui, ca @x,y.',
  '        Nu folosi "r" ca sa muti — "r" creeaza o figura noua.',
  '  {"o":"s","n":3,"d":"v"}     taie figura in n dreptunghiuri (2..6), d = "v" sau "h"',
  '  {"o":"z","k":1.5}           mareste sau micsoreaza pe loc (k intre 0.1 si 10)',
  '  {"o":"z","w":400,"h":100}   dimensiune noua, exacta, in pixeli',
  '  {"o":"c"}                   sterge toata scena',
  '',
  'cerere: muta figura 1 in interiorul figurii 0 (obiecte: #0 PATRAT 300x300px @400,400,',
  '        #1 DREPTUNGHI 100x60px @700,120)',
  '  -> {"g":{"o":"m","p":[400,400]},"n":[1],"y":"mutat in centrul lui #0"}',
  'cerere: imparte-l in 2',
  '  -> {"g":{"o":"s","n":2,"d":"v"},"y":"doua bucati"}',
  'cerere: mareste dreptunghiul (obiecte: #0 PATRAT, #1 DREPTUNGHI)',
  '  -> {"g":{"o":"z","k":1.5},"n":[1],"y":"doar dreptunghiul"}',
];

/**
 * Panza — ramura ei, nu inca patru randuri in „modifica".
 *
 * A stat intai acolo. Masurat, ridica ramura de la 667 la 719 de tokeni — platiti la
 * FIECARE mutare, taiere sau redimensionare, adica de cele mai multe ori degeaba.
 * Aceeasi socoteala care i-a dat casetarului agentul lui: ce nu se cere nu se
 * plateste. Aici a fost destula o RAMURA, nu un agent nou — campul „g" e tot al
 * geometrului, deci nu se calca nimeni la combinare.
 */
const PANZA = [
  '',
  '=== PANZA, campul "g" — zona de desen, NU figurile de pe ea ===',
  '  {"o":"p","w":400,"h":300}   gabaritul nou al panzei, in pixeli',
  '        Numai cand cererea vorbeste despre panza, canvas, scena sau zona de desen.',
  '        Figurile si textul se scaleaza ODATA cu ea, proportional, pe fiecare axa.',
  '        Nu le muta si nu le redimensiona tu: motorul o face local, cu regula de trei.',
  '        Nu muta si nu redimensiona figurile pentru asta: nu e treaba ta.',
  '        Daca cererea e despre figuri sau text, raspunde {"g":null}: nu e caseta lor.',
  '',
  'cerere: micsoreaza panza la 250 pe 100',
  '  -> {"g":{"o":"p","w":250,"h":100},"y":"panza mai mica"}',
  'cerere: fa panza patrata de 400',
  '  -> {"g":{"o":"p","w":400,"h":400},"y":"panza 400x400"}',
];

export class Geometru extends Agent {
  /** Operatiile pe care le accepta motorul, in forma lunga. */
  static OPS = ['rect', 'split', 'resize', 'clear', 'move', 'canvas_resize'];

  /** Forma minificata a operatiei, asa cum vine pe fir. */
  static OP_SCURT = { r: 'rect', s: 'split', z: 'resize', c: 'clear', m: 'move', p: 'canvas_resize' };

  /** Ce anume din figura cade in punctul dat: un colt, mijlocul unei laturi, centrul. */
  static ANCORE = ['center', 'bl', 'br', 'tl', 'tr', 'top', 'bottom', 'left', 'right'];

  constructor() {
    super({
      nume: 'geometru',
      domeniu: 'geometrie',
      camp: 'geom',
      rol: ROL,
      ramuri: { creare: CREARE, modifica: MODIFICA, panza: PANZA },
    });
  }

  /**
   * Campul „g": o singura operatie, curatata si incadrata in limitele panzei.
   * @returns {object|null} null daca cererea nu contine geometrie
   */
  valideaza(d) {
    const g = ia(d, 'g', 'geom');
    if (!g || typeof g !== 'object') return null;

    const brut = ia(g, 'o', 'op');
    const op = Geometru.OP_SCURT[brut] || brut;
    if (!Geometru.OPS.includes(op)) return null;

    const out = { op };

    if (op === 'rect' || op === 'resize' || op === 'canvas_resize') this.dimensiuni(g, out);
    if (op === 'resize' && out.w === undefined) {
      const k = ia(g, 'k', 'scale');
      out.scale = Number.isFinite(Number(k)) ? clamp(Number(k), 0.1, 10) : 1.5;
    }
    if (op === 'split') this.taiere(g, out);
    if (op === 'move') return this.mutare(g, out);
    if (op === 'rect') this.plasare(g, out);

    return out;
  }

  /** w si h in pixeli; „un patrat de 50" vine ca o singura marime. */
  dimensiuni(g, out) {
    const w = ia(g, 'w'), h = ia(g, 'h'), size = ia(g, 's', 'size');
    if (Number.isFinite(Number(w)) && Number.isFinite(Number(h))) {
      out.w = cel(w); out.h = cel(h);
    } else if (Number.isFinite(Number(size))) {
      out.w = cel(size); out.h = cel(size);
    }
  }

  taiere(g, out) {
    const n = ia(g, 'n', 'into');
    out.into = Number.isFinite(Number(n)) ? clamp(Math.round(Number(n)), 2, 6) : 2;
    const dir = ia(g, 'd', 'dir');
    if (dir === 'v' || dir === 'h') out.dir = dir;
  }

  /** Mutarea fara punct n-are ce sa insemne: mai bine nimic decat o figura teleportata. */
  mutare(g, out) {
    const unu = punct(ia(g, 'p', 'at'));
    if (!unu) return null;
    out.at = unu;
    const a = ia(g, 'a', 'anchor');
    if (Geometru.ANCORE.includes(a)) out.anchor = a;
    return out;
  }

  plasare(g, out) {
    const unu = punct(ia(g, 'p', 'at'));
    if (unu) out.at = unu;

    // mai multe figuri dintr-o cerere, cate una pe fiecare punct
    const multe = ia(g, 'm', 'cells');
    if (Array.isArray(multe)) {
      const bune = multe.map(punct).filter(Boolean).slice(0, 32);
      if (bune.length) out.cells = bune;
    }
    const a = ia(g, 'a', 'anchor');
    if (Geometru.ANCORE.includes(a)) out.anchor = a;
    if (ia(g, 'x', 'replace') === true) out.replace = true;
  }
}
