// Scene.js — scena: mai multe obiecte plasate pe o grila.
//
// Pana acum aplicatia avea O figura. Acum are o SCENA: o lista de obiecte, fiecare
// cu figura lui, textul lui si pozitia lui pe grila.
//
// SISTEMUL DE COORDONATE
//   Grila are celule de cate 50 px; panza porneste la 800x800, dar gabaritul ei se
//   poate schimba din prompt (vezi setPanza), intre 50 si 800 px pe latura.
//   Originea (0,0) e in coltul din STANGA JOS, iar y creste in SUS — ca la matematica.
//   Canvas-ul are y-ul invers (creste in jos), asa ca toate conversiile trec prin
//   pointPixel / toLogic. Nimic altundeva in cod nu are voie sa presupuna sensul lui y.
//
// INVARIANTUL ramane per obiect: fiecare obiect isi conserva propriul Sum(len).
// Doua obiecte diferite au bugete independente.

export const GRID = 16;
export const CELL = 50;
export const CANVAS_PX = GRID * CELL;         // 800 — gabaritul maxim, si cel de pornire

/**
 * Gabaritul CURENT al panzei, in pixeli.
 *
 * Panza se poate micsora din prompt („micsoreaza panza la 250 pe 100"), deci marimea
 * nu mai e o constanta. E un obiect, nu doua exporturi de numere, tocmai ca cine il
 * importa sa citeasca mereu valoarea de acum, nu una copiata la incarcarea modulului.
 * Aici e singurul adevar despre cat e panza; tot restul codului citeste de aici.
 */
export const panza = { w: CANVAS_PX, h: CANVAS_PX };

/** Sub o celula de grila n-ar mai incapea nimic; peste CANVAS_PX n-ar incapea in pagina. */
export const PANZA_MIN = CELL;

/** O latura de panza, tinuta intre cat are rost si cat incape. */
export const limPanza = v => Math.max(PANZA_MIN, Math.min(CANVAS_PX, Math.round(Number(v) || 0)));

/**
 * Marginile din jurul zonei de desen, in pixeli.
 * Stanga si jos tin cifrele axelor; dreapta si sus exista ca ultima eticheta sa
 * nu fie taiata. Contextul e translatat cu (l, t) — restul codului lucreaza in
 * coordonate 0..CANVAS_PX.
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
}
