// text/Tipograf.js — agentul pe text.
//
// Se ocupa numai de text: ce scrie, unde sta, cat de mare e, pe ce figura apartine.
// Nu stie sa creeze si nu stie sa mute figuri — nici in prompt, nici in cod.

import { Agent } from '../base/Agent.js';
import { ia, clamp, punct } from '../base/valori.js';

const ROL = [
  '',
  'ESTI AGENTUL DE TEXT. Te ocupi NUMAI de text: ce scrie, unde sta, cat de mare e.',
  'Nu stii nimic despre crearea sau mutarea figurilor si nu emiti niciodata campul "g".',
  'Daca cererea contine si o parte de geometrie, ignor-o: se ocupa alt agent de ea.',
  '',
  'Raspuns: { "t": <comanda de text sau null>, "n": [numere sau lipsa], "y": "<max 6 cuvinte>" }',
  'Daca cererea nu contine nicio comanda de text, raspunde cu {"t":null}.',
  '',
  'Textul apartine unei figuri: fiecare obiect are fluxul lui de cuvinte.',
];

const TEXT_NOU = [
  '',
  '=== TEXT: CONTINUT, campul "t" ===',
  '  s = ["ALFA","BETA"]   inlocuieste CONTINUTUL textului. [] il sterge definitiv.',
  '        Pune-l DOAR cand cererea spune ce anume sa scrie: "scrie ALFA",',
  '        "pune cuvantul MIAU", "scrie in loc de text PISICA".',
  '        Daca cererea zice doar "textul", "scrisul", "cuvintele" — fara sa spuna',
  '        ce anume — se refera la textul care exista deja: OMITE s.',
  '        Nu transforma niciodata fraza cererii in continut de text.',
  '  d = ["BETA"]          ADAUGA un text NOU, pastrand textele care exista deja.',
  '        Legarea se aplica DOAR pe textul nou adaugat; cel vechi ramane unde era.',
  '',
  '  CUM ALEGI INTRE s SI d — te uiti la starea primita:',
  '    obiectul NU are text inca            -> s (primul text)',
  '    obiectul ARE text si ceri unul nou   -> d (se adauga langa el)',
  '    cererea zice "in loc de", "inlocuieste", "sterge si scrie" -> s',
  '    cererea zice "sterge textul"          -> s cu lista goala',
  '',
  '  k = 1.4               mareste (peste 1) sau micsoreaza (sub 1) textul, 0.4..3.',
  '                        NU folosi s:[] pentru marime — aia sterge textul.',
  '',
  'cerere: scrie MIAU in figura  -> {"t":{"s":["MIAU"],"b":"i"},"y":"text in figura"}',
  'cerere: scrie si BETA (exista deja text)  -> {"t":{"d":["BETA"]},"y":"text nou"}',
  'cerere: sterge textul  -> {"t":{"s":[]},"y":"text sters"}',
  'cerere: mareste textul  -> {"t":{"k":1.4},"y":"text mai mare"}',
];

const TEXT_POZ = [
  '',
  '=== TEXT: POZITIE, campul "t" ===',
  '  b = unde se aseaza. Alege dupa CE SPUNE cererea:',
  '        "in figura", "in mijloc", "inauntru"        -> "i"',
  '        "in fiecare dreptunghi", "in fiecare piesa"  -> "p"  (adauga r:true)',
  '        "pe latura de sus / jos / stanga / dreapta"  -> "e" si a="top"/"bottom"/"left"/"right"',
  '              implicit textul cade IN AFARA laturii, lipit de ea.',
  '              Adauga in:true ca sa cada INAUNTRUL figurii, sub latura aceea.',
  '              "pe latura de sus", "deasupra figurii"      -> a="top"  (afara)',
  '              "sub latura de sus", "sub latura superioara" -> a="top", in:true',
  '              "deasupra laturii de jos"                    -> a="bottom", in:true',
  '              Regula: daca cererea zice SUB o latura de sus, sau DEASUPRA uneia',
  '              de jos, vrea interiorul figurii — pune in:true.',
  '              Cererea o poate spune si pe fata, si atunci ea decide:',
  '              "in interiorul laturii X" / "inauntrul laturii X" -> in:true',
  '              "in exteriorul laturii X" / "in afara laturii X"  -> fara in',
  '        "pe fiecare latura", "pe toate laturile"     -> "s"  (adauga r:true)',
  '        "de-a lungul conturului", "pe contur"        -> "l"',
  '        "in punctul (x,y)"                           -> "q" si a=[x,y], in pixeli',
  '        "in colturi", "cate unul in fiecare colt"    -> "c"',
  '        "in coltul din stanga sus" si asemenea       -> "k" si a="tl"/"tr"/"br"/"bl"',
  '        "ascunde textul"                             -> "n"',
  '  ATENTIE: o singura latura anume cere "e", NU "s". "s" pune text pe TOATE laturile.',
  '',
  '  v = 0       MUTA textul pe ALTA figura, cea cu numarul dat.',
  '        Textul apartine unei figuri. "muta textul de pe figura 1 sub figura 0"',
  '        inseamna TRANSFER: n=[1] spune de unde, v=0 unde, b si a cum se aseaza.',
  '        Fara v, textul ramane pe figura lui si se aseaza fata de ea.',
  '  w = [0,1]   indicii cuvintelor afectate. Fara el se muta tot textul.',
  '  r = true    repeta cuvintele ca sa acopere toate laturile sau piesele.',
  '              Motorul le numara, nu tu.',
  '',
  'cerere: scrie MIAU in interiorul fiecarui dreptunghi',
  '  -> {"t":{"s":["MIAU"],"b":"p","r":true},"y":"pe fiecare piesa"}',
  'cerere: scrie JOS sub latura superioara a figurii',
  '  -> {"t":{"s":["JOS"],"b":"e","a":"top","in":true},"y":"inauntru, sub latura de sus"}',
  'cerere: pune textul pe latura din stanga',
  '  -> {"t":{"b":"e","a":"left"},"y":"pe latura din stanga"}',
  'cerere: muta textul de pe figura 1 sub latura de jos a figurii 0',
  '  -> {"t":{"v":0,"b":"e","a":"bottom"},"n":[1],"y":"text mutat pe figura 0"}',
  'cerere: muta textul 1 sub latura de jos a figurii 0',
  '  -> {"t":{"v":0,"b":"e","a":"bottom"},"n":["t1"],"y":"al doilea text, pe figura 0"}',
  'cerere: muta primele doua cuvinte in stanga jos',
  '  -> {"t":{"b":"k","a":"bl","w":[0,1]},"y":"doar primele doua"}',
];

export class Tipograf extends Agent {
  /** Cele opt feluri de a lega textul de o figura, plus ascunderea lui. */
  static BIND = ['inside', 'pieces', 'path', 'sides', 'side', 'corners', 'corner', 'point', 'none'];

  static BIND_SCURT = {
    i: 'inside', p: 'pieces', q: 'point', s: 'sides', e: 'side',
    l: 'path', c: 'corners', k: 'corner', n: 'none',
  };

  static LATURI = ['top', 'bottom', 'left', 'right'];
  static COLTURI = ['tl', 'tr', 'br', 'bl'];

  /** Sferturile de tura, singurele unghiuri acceptate. 360 e tot 0: pozitia initiala. */
  static ROTATII = [0, 90, 180, 270];

  /**
   * Unghiul, adus la cel mai apropiat sfert de tura.
   *
   * Un text intors cu 37 de grade nu se aliniaza cu nimic din figura si arata a
   * greseala. Domeniul e restrans intentionat, ca si formele: patru pozitii, toate
   * paralele cu laturile.
   *
   * @returns {number|null} null cand nu s-a cerut nicio rotatie
   */
  static grade(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    // 360 -> 0, -90 -> 270, 450 -> 90
    const intreg = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
    return Tipograf.ROTATII.includes(intreg) ? intreg : 0;
  }

  constructor() {
    super({
      nume: 'tipograf',
      domeniu: 'text',
      camp: 'text',
      rol: ROL,
      ramuri: { 'text-nou': TEXT_NOU, 'text-poz': TEXT_POZ },
    });
  }

  /**
   * Campul „t". O comanda de text e valida daca schimba macar ceva: unde sta textul,
   * ce scrie, pe ce figura e sau cat de mare. Altfel n-are ce aplica motorul.
   * @returns {object|null}
   */
  valideaza(d) {
    const t = ia(d, 't', 'text');
    if (!t || typeof t !== 'object') return null;

    const T = {};
    this.legare(t, T);
    this.continut(t, T);

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

    const g = Tipograf.grade(ia(t, 'g', 'rot'));
    if (g !== null) T.rot = g;

    const schimbaCeva = T.bind || T.set || T.add || T.to !== undefined
                     || T.scale !== undefined || T.rot !== undefined;
    return schimbaCeva ? T : null;
  }

  /** Unde se aseaza textul fata de figura. */
  legare(t, T) {
    const brut = ia(t, 'b', 'bind');
    const bind = Tipograf.BIND_SCURT[brut] || brut;
    if (!Tipograf.BIND.includes(bind)) return;

    T.bind = bind;
    const a = ia(t, 'a', 'at');

    if (bind === 'corner') T.at = Tipograf.COLTURI.includes(a) ? a : 'tr';
    if (bind === 'side') {
      T.at = Tipograf.LATURI.includes(a) ? a : 'top';
      // implicit textul cade in afara laturii; „in" il aduce inauntrul figurii
      if (ia(t, 'in', 'inside') === true) T.in = true;
    }
    if (bind === 'point') {
      const q = punct(a);
      if (q) T.at = q; else T.bind = 'inside';   // punct invalid -> inapoi in figura
    }
  }

  /** Ce scrie: inlocuire („s") sau adaugare langa textul existent („d"). */
  continut(t, T) {
    const curata = a => a.slice(0, 16)
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
}
