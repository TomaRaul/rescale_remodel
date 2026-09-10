// Scene.js — scena: mai multe obiecte plasate pe o grila.
//
// Pana acum aplicatia avea O figura. Acum are o SCENA: o lista de obiecte, fiecare
// cu figura lui, textul lui si pozitia lui pe grila.
//
// SISTEMUL DE COORDONATE
//   Grila are celule de cate 50 px; panza porneste la 800x800, dar gabaritul ei se
//   poate schimba din prompt (vezi setPanza), intre 50 si 1200 px pe latura.
//   Originea (0,0) e in coltul din STANGA JOS, iar y creste in SUS — ca la matematica.
//   Canvas-ul are y-ul invers (creste in jos), asa ca toate conversiile trec prin
//   pointPixel / toLogic. Nimic altundeva in cod nu are voie sa presupuna sensul lui y.
//
// INVARIANTUL ramane per obiect: fiecare obiect isi conserva propriul Sum(len).
// Doua obiecte diferite au bugete independente.

import { Figure } from './Figure.js';

export const GRID = 16;
export const CELL = 50;

/**
 * Panza de PORNIRE, in pixeli: 16 celule de cate 50.
 *
 * A fost multa vreme si plafonul, iar cele doua stateau in aceeasi constanta — pana
 * cand plafonul a urcat la 1200 si s-a vazut ca nu inseamna acelasi lucru. Cat porneste
 * panza e o alegere de comoditate: atat incape comod in pagina si atat descrie promptul
 * de sistem. Cat poate creste e cu totul altceva, si scrie mai jos.
 */
export const CANVAS_PX = GRID * CELL;

/**
 * Cat poate creste panza, pe fiecare latura.
 *
 * Peste atat nu se mai trece: elementul de desen ar depasi coloana lui din pagina, iar
 * catalogul de figuri — care masoara gabaritele in celule — n-ar mai avea cod pentru ce
 * e mai mare. Cine cere mai mult primeste plafonul, si i se spune.
 */
export const PANZA_MAX = 1200;

/**
 * Gabaritul CURENT al panzei, in pixeli.
 *
 * Panza se poate micsora din prompt („micsoreaza panza la 250 pe 100"), deci marimea
 * nu mai e o constanta. E un obiect, nu doua exporturi de numere, tocmai ca cine il
 * importa sa citeasca mereu valoarea de acum, nu una copiata la incarcarea modulului.
 * Aici e singurul adevar despre cat e panza; tot restul codului citeste de aici.
 */
export const panza = { w: CANVAS_PX, h: CANVAS_PX };

/** Sub o celula de grila n-ar mai incapea nimic; peste PANZA_MAX n-ar incapea in pagina. */
export const PANZA_MIN = CELL;

/** O latura de panza, tinuta intre cat are rost si cat incape. */
export const limPanza = v => Math.max(PANZA_MIN, Math.min(PANZA_MAX, Math.round(Number(v) || 0)));

/**
 * Marginile din jurul zonei de desen, in pixeli.
 * Stanga si jos tin cifrele axelor; dreapta si sus exista ca ultima eticheta sa
 * nu fie taiata. Contextul e translatat cu (l, t) — restul codului lucreaza in
 * coordonate 0..latura panzei de acum.
 */
export const AX = { l: 34, r: 22, t: 12, b: 30 };

/**
 * SISTEMUL DE COORDONATE: PIXELI, cu originea in coltul din STANGA JOS.
 *
 * Grila e doar un reper vizual, la fiecare CELL pixeli. Coordonatele nu se
 * lipesc de ea: (25, 25) e un punct valid, la jumatatea primului patratel.
 * Singura conversie e rasturnarea lui y — pe canvas creste in jos.
 */
export function pointPixel(x, y) {
  return { x, y: panza.h - y };
}

/** Pixel de canvas -> coordonata logica, cu originea in stanga jos. */
export function toLogic(px, py) {
  return {
    x: Math.max(0, Math.min(panza.w, Math.round(px))),
    y: Math.max(0, Math.min(panza.h, Math.round(panza.h - py))),
  };
}

/** Coordonatele valide sunt 0..latura panzei de ACUM, pe fiecare axa. */
export const inCanvas = (x, y) =>
  Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= panza.w && y >= 0 && y <= panza.h;

let _id = 0;

/**
 * Ordinea in care s-au generat textele.
 *
 * Un text nu e un obiect: poate sta pe o figura, langa alte texte ale ei. Ca sa aiba
 * totusi numar propriu — T0, T1, ca #0, #1 la figuri — fiecare CUVANT tine minte din
 * ce text face parte, prin numarul de ordine de mai jos.
 *
 * Numarul e monoton si nu se reia niciodata, dar nu el se arata: numarul afisat e
 * POZITIA lui in ordinea generarii, exact ca la figuri, unde #k e al k-lea obiect din
 * vector. Asa, dupa o stergere, numerotarea ramane compacta in loc sa sara.
 */
let _text = 0;
export const nextText = () => ++_text;

// ─────────────────────────────────────────────── scena ca DATE, pentru salvare
//
// `snapshot` si `toJSON` seamana, dar nu sunt acelasi lucru si nu se pot inlocui.
// Instantaneul e pentru Undo: ramane in memorie, deci poate purta obiecte vii —
// `Figure`, cu metodele ei. Forma de mai jos pleaca intr-o coloana de baza de date si
// se intoarce peste zile, poate in alta sesiune, asa ca n-are voie sa contina decat
// numere, siruri si liste.
//
// Diferenta se vede cel mai bine la panza: `snapshot` o pune ca PROPRIETATE pe lista,
// iar `JSON.stringify` a unei liste nu scrie decat elementele indexate — gabaritul s-ar
// pierde in tacere, si o scena salvata pe o panza de 400x300 s-ar intoarce pe una de
// 800x800, cu tot ce era in dreapta ei in afara cadrului.

/** Versiunea formei salvate. Creste doar cand un camp isi schimba INTELESUL. */
export const FORMAT = 1;

/** Cate legari cunoaste motorul. Ce nu e aici nu se poate desena, deci nu se citeste. */
const MODURI = new Set(['inside', 'pieces', 'path', 'sides', 'side',
                        'corners', 'corner', 'point', 'box', 'none']);

const numar = (v, implicit = 0) => (Number.isFinite(Number(v)) ? Number(v) : implicit);

/** Un punct citit din date STRAINE; null cand nu e unul. */
const punctJSON = q => (q && typeof q === 'object'
  && Number.isFinite(Number(q.x)) && Number.isFinite(Number(q.y))
  ? { x: Number(q.x), y: Number(q.y) }
  : null);

/**
 * O legare, in forma in care se poate scrie si citi la loc.
 *
 * Sirul ramane sir: „inside" e cea mai deasa legare de pe scena si n-are rost umflata
 * intr-un obiect. Restul se taie la campurile pe care le cunoaste `layout` — ce n-are
 * cine desena n-are de ce sa ocupe loc in baza de date.
 */
const legareJSON = b => {
  if (typeof b === 'string') return MODURI.has(b) ? b : 'inside';
  if (!b || typeof b !== 'object' || !MODURI.has(b.bind)) return 'inside';
  const out = { bind: b.bind };
  // `at` e un PUNCT la 'point' si la 'box', dar un NUME de latura sau de colt la
  // 'side' si 'corner'. Amandoua sunt legitime, deci amandoua se pastreaza.
  if (typeof b.at === 'string') out.at = b.at;
  else if (punctJSON(b.at)) out.at = punctJSON(b.at);
  if (b.in === true) out.in = true;
  if (Number.isFinite(Number(b.rot)) && Number(b.rot)) out.rot = Number(b.rot);
  if (Number.isFinite(Number(b.w)) && Number(b.w) > 0) out.w = Number(b.w);
  if (Number.isFinite(Number(b.h)) && Number(b.h) > 0) out.h = Number(b.h);
  return out;
};

/**
 * Poliliniile unei figuri, citite din date straine.
 *
 * Se sare peste ce nu se poate desena — o polilinie fara origine, un segment cu
 * lungime care nu e numar — si se pastreaza restul. E aceeasi purtare ca a cititorului
 * de DSL din `scheme.ts`: un rand stricat nu trebuie sa arunce toata pânza.
 */
const poliliniiJSON = lista => {
  const out = [];
  for (const p of Array.isArray(lista) ? lista : []) {
    const origin = punctJSON(p && p.origin);
    if (!origin || !Array.isArray(p.segs)) continue;
    const segs = p.segs
      .filter(s => s && Number.isFinite(Number(s.len)) && Number.isFinite(Number(s.turn)))
      .map((s, i) => ({ id: String(s.id || ('e' + i)), len: Number(s.len), turn: Number(s.turn) }));
    if (!segs.length) continue;
    out.push({ origin, heading: numar(p.heading), closed: p.closed !== false, segs });
  }
  return out;
};

/** Un obiect de pe scena: figura + textul ei + celula pe care sta. */
export class Obiect {
  constructor(figure, at, stream) {
    this.id = 'o' + (++_id);
    this.figure = figure;
    this.at = { x: at.x, y: at.y };
    /**
     * CENTRUL obiectului, in coordonate logice. Recalculat dupa fiecare operatie care
     * il poate muta — scalare, taiere, mutare, redimensionare a panzei — de
     * `App.actualizeazaCentre`.
     *
     * Nu se confunda cu `at`: acela e PUNCTUL DE ASEZARE, cel cerut la creare, si
     * ramane ce a fost („coltul stanga jos in (25,25)"). Centrul e unde se afla
     * obiectul ACUM. O scalare le desparte: figura isi pastreaza punctul de asezare,
     * dar centrul i se muta.
     *
     * Aici e vectorul dupa care se face identificarea — el pleaca in starea trimisa
     * modelului si tot el raspunde la „in mijlocul figurii 0". Porneste egal cu
     * punctul de asezare; prima recalculare il aduce pe cel adevarat.
     */
    this.centru = { x: at.x, y: at.y };
    this.stream = stream;
    this.binds = [];
    // cate un numar de ordine pe cuvant, paralel cu `binds`: din ce text vine cuvantul
    this.texte = [];
  }

  /** Id-uri de muchie unice pe toata scena, ca animatia sa nu confunde obiectele. */
  edgeKey(segId) { return this.id + ':' + segId; }

  /**
   * Cheia de animatie a unui cuvant: TEXTUL din care face parte plus rangul in el.
   *
   * Nu id-ul obiectului. Cand textul se muta pe alta figura isi schimba obiectul, dar
   * nu si identitatea — iar animatia interpoleaza pe cheie. Cu obiectul in cheie, la
   * mutare vedeai un cuvant care dispare pe o figura si altul care creste pe cealalta:
   * o clipire, nu o tranzitie. Numarul textului calatoreste cu el, deci se preteaza.
   *
   * Rangul e pozitia cuvantului IN interiorul textului lui, nu in obiect: pe figura
   * noua cuvintele se aseaza dupa cele care erau deja acolo, deci indicele de obiect
   * s-ar fi schimbat oricum.
   */
  wordKey(i) {
    const seq = this.texte[i];
    if (!seq) return this.id + 'w' + i;         // cuvant fara text: cheie veche
    let rang = 0;
    for (let k = 0; k < i; k++) if (this.texte[k] === seq) rang++;
    return 't' + seq + 'w' + rang;
  }
}

export class Scene {
  constructor() { this.obiecte = []; }

  get length() { return this.obiecte.length; }

  add(obj) { this.obiecte.push(obj); return obj; }

  byId(id) { return this.obiecte.find(o => o.id === id) || null; }

  /** Toate obiectele care pornesc din punctul (x, y) — pot fi mai multe, suprapuse. */
  atPoint(x, y) {
    return this.obiecte.filter(o => o.at.x === x && o.at.y === y);
  }

  remove(id) {
    const i = this.obiecte.findIndex(o => o.id === id);
    if (i >= 0) this.obiecte.splice(i, 1);
  }

  clear() { this.obiecte.length = 0; }

  /**
   * Gabaritul nou al panzei.
   *
   * Doar MARIMEA: obiectele nu se ating aici. Scena le urmeaza, cu regula de trei
   * simpla pe fiecare axa, dar scalarea o face App — cu factorii intorsi de aici.
   * Asa fiecare strat ramane la ce e al lui: scena tine gabaritul si obiectele, dar
   * nu stie sa desfaca o figura in varfuri; aia e treaba motorului de operatii.
   *
   * Factorii se socotesc fata de gabaritul de DINAINTE, deci o panza dusa de la
   * 350x200 la 700x700 da kx = 2 si ky = 3.5.
   *
   * @returns {{w:number,h:number,kx:number,ky:number}} gabaritul aplicat, dupa
   *          plafonare, si factorii fata de cel dinainte
   */
  setPanza(w, h) {
    const W = limPanza(w), H = limPanza(h);
    const kx = W / panza.w, ky = H / panza.h;
    panza.w = W; panza.h = H;
    return { w: W, h: H, kx, ky };
  }

  /**
   * Translatie in pixeli de canvas: si conturul, si punctele de care atarna textul.
   *
   * Legarile se INLOCUIESC, nu se modifica pe loc: „snapshot" copiaza lista, nu si
   * obiectele din ea, deci o mutatie ar rescrie si starea salvata pentru undo.
   */
  static mutaCanvas(o, dx, dy) {
    if (!dx && !dy) return;
    for (const p of o.figure.polylines) { p.origin.x += dx; p.origin.y += dy; }
    o.binds = o.binds.map(b => (b && typeof b === 'object' && b.at && typeof b.at === 'object'
      ? { ...b, at: { x: b.at.x + dx, y: b.at.y + dy } }
      : b));
  }

  /** Suma lungimilor pe toata scena — util pentru raportare, nu ca invariant global. */
  totalLength() {
    return this.obiecte.reduce((a, o) => a + o.figure.totalLength(), 0);
  }

  /**
   * Instantaneul include si GABARITUL panzei, ca proprietate a listei.
   *
   * Undo dupa „micsoreaza panza" trebuie sa readuca si panza, nu doar obiectele —
   * altfel figurile s-ar intoarce la pozitiile lor de dinainte, dar intr-o panza
   * ramasa mica, adica exact in afara ei. Sta pe lista, nu intr-un obiect nou, ca sa
   * nu se schimbe forma pe care o asteapta CommandManager si toate apelurile.
   */
  snapshot() {
    const snap = this.obiecte.map(o => ({
      id: o.id, figure: o.figure.clone(), at: { ...o.at }, centru: { ...o.centru },
      words: [...o.stream.words], binds: [...o.binds], texte: [...o.texte],
      fontPx: o.stream.fontPx,
    }));
    snap.panza = { ...panza };
    return snap;
  }

  restore(snap, faceStream) {
    if (snap.panza) { panza.w = snap.panza.w; panza.h = snap.panza.h; }
    this.obiecte = snap.map(s => {
      const o = new Obiect(s.figure, s.at, faceStream(s.words, s.fontPx));
      o.id = s.id;
      // centrul calatoreste cu instantaneul: undo dupa o scalare trebuie sa readuca
      // si pozitia de dinainte, nu doar forma
      o.centru = s.centru ? { ...s.centru } : { ...s.at };
      o.binds = [...s.binds];
      o.texte = [...(s.texte || [])];
      return o;
    });
  }

  /**
   * Scena ca DATE PURE: ce se scrie in `continut_json` si se citeste la loc.
   *
   * Numele campurilor sunt cele din `snapshot`, dinadins: cele doua forme se citesc
   * una langa alta, iar cine adauga un camp la obiect vede imediat ca are doua locuri
   * de trecut, nu unul.
   *
   * Ce NU se salveaza: id-urile de obiect si numerele de text. Amandoua sunt serii
   * locale sesiunii — `o1`, `o2` din contorul modulului — iar duse dintr-o sesiune in
   * alta s-ar ciocni cu ale obiectelor create dupa incarcare. La citire se dau altele,
   * pastrand ORDINEA, care e singurul lucru care conteaza din ele.
   */
  toJSON() {
    return {
      v: FORMAT,
      panza: { w: panza.w, h: panza.h },
      obiecte: this.obiecte.map(o => ({
        at: { x: o.at.x, y: o.at.y },
        centru: { x: o.centru.x, y: o.centru.y },
        figure: o.figure.polylines.map(p => ({
          origin: { x: p.origin.x, y: p.origin.y },
          heading: p.heading,
          closed: Boolean(p.closed),
          segs: p.segs.map(s => ({ id: s.id, len: s.len, turn: s.turn })),
        })),
        words: [...o.stream.words],
        fontPx: o.stream.fontPx,
        binds: o.binds.map(legareJSON),
        texte: [...o.texte],
      })),
    };
  }

  /**
   * Scena adusa inapoi din date. INLOCUIESTE tot ce era pe pânză.
   *
   * Datele vin din afara procesului, deci sunt tratate ca atare: nimic nu se crede pe
   * cuvant, ce nu se poate desena se sare, si nicio forma stricata n-are voie sa arunce.
   * Un rand corupt in baza de date trebuie sa dea o pânză mai saraca, nu o aplicatie
   * moarta.
   *
   * Numerele de text se REFAC, in ordinea celor salvate: T0 ramane primul text, T1 al
   * doilea. Numerotarea aratata e oricum pozitionala (vezi `App.ordineTexte`), deci
   * numai ordinea trebuia pastrata, nu si cifrele.
   *
   * @param {object} date ce s-a citit din `continut_json`
   * @param {(words:string[], fontPx:number) => object} faceStream fabrica de fluxuri
   * @returns {number} cate obiecte au fost incarcate
   */
  incarca(date, faceStream) {
    const d = date && typeof date === 'object' ? date : {};
    const brute = Array.isArray(d.obiecte) ? d.obiecte : [];

    // Gabaritul intai: `at` si poliliniile sunt in pixelii pânzei pe care s-a salvat,
    // deci pânza trebuie sa fie aceea inainte ca obiectele sa se aseze pe ea.
    const latura = v => (Number.isFinite(Number(v)) ? limPanza(v) : CANVAS_PX);
    panza.w = latura(d.panza && d.panza.w);
    panza.h = latura(d.panza && d.panza.h);

    // vechiul numar de text -> unul nou, in ordine crescatoare, deci ordinea se pastreaza
    const vechi = [...new Set(brute.flatMap(o => (Array.isArray(o && o.texte) ? o.texte : []))
                                   .filter(s => Number.isFinite(Number(s)) && Number(s) > 0)
                                   .map(Number))].sort((a, b) => a - b);
    const serie = new Map(vechi.map(s => [s, nextText()]));

    this.obiecte = [];
    for (const b of brute) {
      if (!b || typeof b !== 'object') continue;
      const at = punctJSON(b.at);
      if (!at) continue;                       // fara punct de asezare n-are unde sta

      const cuvinte = (Array.isArray(b.words) ? b.words : [])
        .filter(w => typeof w === 'string' || typeof w === 'number')
        .map(String);
      const figura = new Figure(poliliniiJSON(b.figure));
      // un obiect fara contur SI fara cuvinte n-ar desena nimic: nu merita reinviat
      if (figura.isEmpty && !cuvinte.length) continue;

      const fontPx = Math.max(1, numar(b.fontPx, 17));
      const o = new Obiect(figura, at, faceStream(cuvinte, fontPx));
      o.centru = punctJSON(b.centru) || { x: at.x, y: at.y };
      // cate o legare pe cuvant, ca in restul codului; ce lipseste devine 'inside'
      const legari = Array.isArray(b.binds) ? b.binds : [];
      o.binds = cuvinte.map((_, i) => legareJSON(legari[i] !== undefined ? legari[i] : legari[0]));
      // Un cuvant fara numar salvat tot trebuie sa capete unul, altfel n-ar aparea in
      // starea trimisa modelului si „textul 1" n-ar avea la ce sa se refere. Toate
      // cele fara numar dintr-un obiect primesc ACELASI: erau un text, nu mai multe.
      const salvate = Array.isArray(b.texte) ? b.texte : [];
      let fara = 0;
      o.texte = cuvinte.map((_, i) => serie.get(Number(salvate[i])) || (fara || (fara = nextText())));
      this.obiecte.push(o);
    }
    return this.obiecte.length;
  }
}
