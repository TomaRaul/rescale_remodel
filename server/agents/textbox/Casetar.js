// textbox/Casetar.js — agentul casetei de text.
//
// Se ocupa de UN SINGUR lucru: dreptunghiul in care curg cuvintele. Daca textul
// intra intr-o caseta, cat de mare e ea, si cu cati pixeli se schimba. Nu stie ce
// scrie textul, nu stie unde altundeva ar putea sta, nu stie ce e o figura.
//
// De ce un agent separat, si nu inca patru randuri in promptul tipografului:
// caseta costa ~370 de tokeni de documentatie, iar ramura `text-poz` a tipografului
// se plateste la FIECARE cerere de pozitionare — inclusiv „pune textul pe latura de
// sus", care n-are nicio treaba cu casetele. Asa, cine intreaba de caseta plateste
// caseta, si nimeni altcineva.
//
// Campul lui e „caseta", nu „text", desi amandoua ajung in aceeasi comanda: doi
// agenti care scriu in acelasi camp s-ar suprascrie la combinare. Se topesc la loc
// in `Echipa.combina`, dupa ce fiecare si-a validat partea lui.

import { Agent } from '../base/Agent.js';
import { ia, clamp, punct, PANZA } from '../base/valori.js';

const ROL = [
  '',
  'ESTI AGENTUL DE CASETA. Te ocupi NUMAI de caseta in care sta textul: daca textul',
  'intra intr-o caseta si cat de mare e ea. Nu stii ce scrie textul, nu stii unde',
  'altundeva ar putea sta si nu stii nimic despre figuri. Daca cererea contine si',
  'altceva, ignora complet: se ocupa alti agenti de ea, in paralel.',
  '',
  'Raspuns: { "t": <comanda de caseta sau null>, "n": [numere sau lipsa], "y": "<max 6 cuvinte>" }',
  'Daca cererea nu vorbeste despre caseta, raspunde cu {"t":null}.',
];

const CASETA = [
  '',
  '=== CASETA DE TEXT, campul "t" ===',
  'Caseta e un dreptunghi in care cuvintele curg pe RANDURI, ca intr-un paragraf.',
  'Latimea ei e cea care rupe randurile.',
  '',
  '  b = "x"       pune textul intr-o caseta.',
  '        "intr-o caseta", "intr-un chenar", "in text box", "ca un paragraf".',
  '        a = [x,y] aseaza caseta intr-un PUNCT anume de pe panza.',
  '                  Fara a, caseta sta in mijlocul figurii.',
  '  z = [200,80]  marimea EXACTA, in pixeli: [latime, inaltime].',
  '        Inaltimea 0 sau lipsa inseamna "exact cat cer randurile".',
  '        Pune z DOAR cand cererea da cifre: "o caseta de 300 pe 80".',
  '  f = 20        SCHIMBA marimea cu atatia pixeli fata de cat e ACUM.',
  '        Negativ o micsoreaza: "micsoreaza caseta cu 30" -> f:-30.',
  '        Motorul stie cat e caseta acum, tu nu. De aceea la o cerere relativa',
  '        pui NUMAI f — fara z si fara b.',
  '  f = [50,200]  cand cererea da DOUA cifre, una pe fiecare axa: [latime, inaltime].',
  '        "mareste caseta cu 50x200" -> f:[50,200]. "a pe b": a e latimea, b inaltimea.',
  '        Un singur numar creste ambele axe; o pereche le creste separat.',
  '        NU arunca a doua cifra si NU o transforma in z — z e marimea finala,',
  '        f e cat se adauga la cea de acum.',
  '',
  'cerere: pune textul intr-o caseta',
  '  -> {"t":{"b":"x"},"y":"text in caseta"}',
  'cerere: scrie SALUT LUME intr-o caseta de 300 pe 80',
  '  -> {"t":{"b":"x","z":[300,80]},"y":"caseta 300x80"}',
  'cerere: mareste caseta cu 40 de pixeli',
  '  -> {"t":{"f":40},"y":"caseta mai mare"}',
  'cerere: mareste textboxul cu 50x200',
  '  -> {"t":{"f":[50,200]},"y":"+50 latime, +200 inaltime"}',
  'cerere: mareste caseta cu 30 pe latime si 100 pe inaltime',
  '  -> {"t":{"f":[30,100]},"y":"separat pe axe"}',
  'cerere: micsoreaza chenarul cu 25 de pixeli',
  '  -> {"t":{"f":-25},"y":"caseta mai mica"}',
];

export class Casetar extends Agent {
  /** Caseta implicita: 0 pe o axa = „exact cat cere textul", deci se strange pe el. */
  static IMPLICIT = { w: 0, h: 0 };

  /** Sub atat nu mai incape niciun cuvant, deci acolo se opreste micsorarea. */
  static MIN = 20;

  constructor() {
    super({
      nume: 'casetar',
      domeniu: 'caseta',
      camp: 'caseta',
      rol: ROL,
      ramuri: { caseta: CASETA },
    });
  }

  /**
   * Campul „t", citit DOAR pentru ce tine de caseta.
   *
   * Daca modelul a strecurat si continut sau alta legare, nu se uita nimeni: nu e
   * un camp sters la final, e cod care nu exista. Tipograful face invers.
   *
   * @returns {object|null} null cand cererea nu vorbeste despre caseta
   */
  valideaza(d) {
    const t = ia(d, 't', 'text');
    if (!t || typeof t !== 'object') return null;

    const T = {};
    this.legare(t, T);
    this.marime(t, T);

    const schimbaCeva = T.bind || T.box !== undefined || T.boxDelta !== undefined;
    return schimbaCeva ? T : null;
  }

  /** Textul intra in caseta; optional, intr-un punct anume de pe panza. */
  legare(t, T) {
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
   * „z" da marimea exacta. „f" o schimba cu atatia pixeli fata de cat e acum —
   * si tocmai de aceea nu poate fi rezolvata aici: promptul n-are istoric, modelul
   * nu vede latimea de acum. Adunarea o face motorul, local.
   *
   * Latimea nu poate lipsi: ea taie randurile. Inaltimea poate — atunci caseta se
   * strange singura pe text.
   */
  marime(t, T) {
    const z = ia(t, 'z', 'box');
    if (z) {
      const [rw, rh] = Array.isArray(z) ? z : [z.w, z.h];
      const w = Math.round(Number(rw)), h = Math.round(Number(rh));
      if (Number.isFinite(w) && w > 0) {
        T.box = {
          w: clamp(w, Casetar.MIN, PANZA),
          h: Number.isFinite(h) && h > 0 ? clamp(h, Casetar.MIN, PANZA) : 0,
        };
      }
    }

    // „f" e fie un numar — aceeasi crestere pe ambele axe — fie o pereche
    // [latime, inaltime], cand cererea da o cifra pentru fiecare. Fara perechea
    // asta, „mareste cu 50x200" pierdea a doua cifra si caseta crestea doar pe x.
    const f = ia(t, 'f', 'boxDelta');
    const pereche = Array.isArray(f) ? f : (f && typeof f === 'object' ? [f.w, f.h] : null);
    if (pereche) {
      const lat = Math.round(Number(pereche[0])), inalt = Math.round(Number(pereche[1]));
      const d = {
        w: Number.isFinite(lat) ? clamp(lat, -PANZA, PANZA) : 0,
        h: Number.isFinite(inalt) ? clamp(inalt, -PANZA, PANZA) : 0,
      };
      if (d.w || d.h) T.boxDelta = d;
    } else if (Number.isFinite(Number(f))) {
      const n = Math.round(Number(f));
      // zero n-ar schimba nimic, deci n-ar fi o comanda
      if (n !== 0) T.boxDelta = clamp(n, -PANZA, PANZA);
    }
  }
}
