// LayoutEngine.js — creierul matematic. Figura + text -> scena cu coordonate absolute.
//
// Legarea textului e PER CUVANT: `binds` poate fi un singur mod pentru tot textul,
// sau o lista cu cate un mod pentru fiecare cuvant. Cuvintele se grupeaza dupa mod
// si fiecare grup merge la binder-ul lui — asa se pot muta doar doua cuvinte,
// restul ramanand unde erau.
//
// Aici traieste si politica de overflow. Figura si textul au fiecare invariantul lor
// si nu au niciun motiv sa incapa in panza. Implicit: `scale-shape` — continutul e
// sacru, ambalajul se scaleaza.

import { bindInside, bindPath, bindCorners, bindCorner, bindSides, bindSide, bindPieces, bindPoint, bindBox } from '../text/TextBinder.js';
import { panza } from '../models/Scene.js';

/**
 * Caseta de text, in pixeli.
 *
 * Zero pe o axa inseamna „exact cat cere textul", pe amandoua:
 *   `h: 0`  inaltimea se strange pe randuri, deci o caseta mai lata iese si mai scunda
 *   `w: 0`  latimea se strange pe cuvinte — implicitul, fiindca o caseta e un ambalaj
 *
 * Sub `min` nu mai incape niciun cuvant, deci acolo se opreste micsorarea.
 */
export const CASETA = { w: 0, h: 0, min: 20 };

/** O latura de caseta, tinuta intre cat incape un cuvant si cat e panza. */
export const limCaseta = v =>
  Math.max(CASETA.min, Math.min(Math.max(panza.w, panza.h), Math.round(Number(v) || 0)));

/**
 * Cat trebuie mutat un gabarit ca sa intre INTREG in panza.
 *
 * Numai TRANSLATIE: nicio lungime nu se atinge, deci Sum(len) al obiectului ramane
 * neatins. Pe axa pe care obiectul e mai mare decat panza nu se muta nimic — acolo
 * n-ar exista pozitie buna, iar „scale-shape" din „layout" il micsoreaza oricum la
 * desenare. Cele doua politici nu se calca: una muta ce incape, alta scaleaza ce nu.
 *
 * Panza se poate micsora din prompt, iar originea (0,0) sta in stanga jos: taierea
 * ia spatiul de sus si din dreapta, deci ce era acolo ramane afara si trebuie adus
 * inauntru. Aici se socoteste cu cat.
 *
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} b gabaritul, in pixeli de canvas
 * @param {{w:number,h:number,pad:number}} canvas
 * @returns {{dx:number,dy:number}} translatia, in pixeli de canvas
 */
export function restrange(b, canvas) {
  const pad = canvas.pad || 0;
  const axa = (min, max, limita) => {
    // Epsilonul conteaza: dupa „scale-shape" figura masoara EXACT cat spatiul liber,
    // iar o eroare de virgula mobila in plus ar face-o „prea mare" si n-ar mai fi
    // asezata in cadru — adica exact cazul pentru care a fost scalata.
    if (max - min > limita - 2 * pad + 1e-6) return 0;   // nu incape: se ocupa scale-shape
    if (min < pad) return pad - min;                 // iesit prin stanga / prin sus
    if (max > limita - pad) return limita - pad - max;
    return 0;
  };
  return { dx: axa(b.minX, b.maxX, canvas.w), dy: axa(b.minY, b.maxY, canvas.h) };
}

/**
 * Caseta marita sau micsorata cu `d` pixeli.
 *
 * Diferenta se poate socoti doar aici, unde se stie cat e ACUM — modelul nu tine
 * minte marimea si nici n-ar trebui, promptul lui n-are istoric.
 *
 * Legarile se INLOCUIESC, nu se modifica pe loc: `Scene.snapshot` copiaza lista,
 * nu si obiectele din ea, deci o mutatie ar rescrie si starea salvata pentru undo.
 *
 * Intoarce si `raport` — de cate ori creste corpul de litera. Textul creste cu el:
 * o caseta de doua ori mai mare cu acelasi corp de litera arata a greseala, nu a
 * marire.
 *
 * Raportul e MEDIA GEOMETRICA a celor doua axe: `sqrt(kw * kh)`. Litera are o
 * singura marime, deci nu poate urma doua cresteri diferite; media geometrica e
 * singura care le tine pe amandoua in seama — aria textului creste cat aria casetei.
 * La o crestere uniforma (kw = kh) da exact acel raport, deci cazul obisnuit nu se
 * schimba. Doar pe latime era gresit: o caseta intinsa pe verticala lasa textul mic
 * intr-o cutie goala.
 *
 * Cand plafonul opreste caseta, raporturile ies mai mici decat s-a cerut si textul
 * creste tot cat a crescut caseta, nu cat s-a cerut.
 *
 * `d` e fie un NUMAR — aceeasi crestere pe ambele axe — fie `{w, h}`, cand cererea
 * da o cifra pentru fiecare. Diferenta conteaza pentru inaltime: la un numar,
 * inaltimea „auto" ramane auto si creste singura odata cu litera; la o pereche,
 * inaltimea a fost ceruta explicit, deci devine explicita, pornind de la cat
 * masoara caseta ACUM (`acum`).
 *
 * O axa lasata pe „auto" n-are nicio cifra scrisa in legare, deci diferenta n-are de
 * la ce sa porneasca: baza e cat MASOARA caseta pe panza, si de acolo axa devine
 * explicita. Fara asta, „mareste caseta cu 40" pe una stransa pe text o facea de 40px,
 * nu cu 40px mai lata.
 *
 * @param {Array} binds legarile obiectului, cate una pe cuvant
 * @param {number|{w:number,h:number}} d pixelii de adaugat; negativ micsoreaza
 * @param {number|{w:number,h:number}} [acum] cat se deseneaza caseta ACUM, baza pentru
 *        axele lasate pe „auto"; un numar se citeste, ca pana acum, drept inaltime
 * @returns {{binds:Array, caseta:{w:number,h:number}|null, raport:number}}
 *          `caseta` e null cand niciun cuvant nu statea intr-o caseta
 */
export function schimbaCaseta(binds, d, acum = 0) {
  const peAxe = d && typeof d === 'object';
  const dw = Math.round(Number(peAxe ? d.w : d)) || 0;
  const dh = peAxe && Number.isFinite(Number(d.h)) ? Math.round(Number(d.h)) : null;
  if (!dw && !dh) return { binds, caseta: null, raport: 1 };

  // cat masoara caseta ACUM pe panza; un numar e, ca pana acum, doar inaltimea
  const desen = acum && typeof acum === 'object' ? acum : { w: 0, h: Number(acum) || 0 };
  const masurat = v => Math.max(0, Math.round(Number(v) || 0));

  let caseta = null, raport = 1;
  const out = binds.map(b => {
    if (!b || typeof b !== 'object' || b.bind !== 'box') return b;
    // latimea de la care pornim: cea scrisa in legare, altfel cat se deseneaza acum
    const latVeche = b.w > 0 ? b.w : masurat(desen.w);
    const w = dw ? limCaseta(latVeche + dw) : b.w;
    const kw = dw && latVeche > 0 ? w / latVeche : 1;

    // inaltimea de la care pornim: cea scrisa in legare, altfel cat se deseneaza acum
    const hVechi = b.h > 0 ? b.h : masurat(desen.h);
    let h, kh;
    if (dh === null) {
      // un singur numar: inaltimea „auto" ramane auto, se strange pe randuri
      h = b.h > 0 ? limCaseta(b.h + dw) : 0;
      kh = b.h > 0 && hVechi > 0 ? h / hVechi : kw;
    } else {
      // inaltime ceruta explicit: pornim de la cat e ACUM, chiar daca era auto
      h = limCaseta(hVechi + dh);
      kh = hVechi > 0 ? h / hVechi : kw;
    }

    raport = Math.sqrt(kw * kh);
    caseta = { ...b, w, h };
    return caseta;
  });
  return { binds: out, caseta, raport };
}

/** Un mod de legare, in forma canonica. */
const canon = b => (typeof b === 'string'
  ? { bind: b }
  : { bind: b.bind, at: b.at, in: b.in, rot: b.rot, w: b.w, h: b.h });
// `at` e un colt ('tr') pentru bind 'corner', dar un punct {x,y} pentru 'point'.
// Rotatia intra in cheie: doua cuvinte pe aceeasi latura, dar intoarse diferit, sunt
// grupuri diferite — altfel al doilea ar mosteni unghiul primului.
const cheie = b => b.bind
  + (b.at ? ':' + (typeof b.at === 'object' ? b.at.x + ',' + b.at.y : b.at) : '')
  + (b.in ? ':in' : '')
  + (b.rot ? ':r' + b.rot : '')
  + (b.bind === 'box' ? ':' + (b.w || 0) + 'x' + (b.h || 0) : '');

/** Oricare forma de `binds` -> o lista cu cate un mod pentru fiecare cuvant. */
export function normalizeBinds(binds, n) {
  if (Array.isArray(binds)) {
    return Array.from({ length: n }, (_, i) => canon(binds[i] || binds[0] || 'inside'));
  }
  const b = canon(binds || 'inside');
  return Array.from({ length: n }, () => b);
}

/**
 * @param {Figure} figure
 * @param {TextStream} stream
 * @param {string|object|Array} binds un mod pentru tot textul, sau cate unul pe cuvant
 * @param {{w:number,h:number,pad:number}} canvas
 */
export function layout(figure, stream, binds, canvas) {
  let edges = figure.toEdges();
  const per = normalizeBinds(binds, stream.words.length);

  // grupam cuvintele dupa modul lor de legare
  const grupuri = new Map();
  per.forEach((b, i) => {
    const k = cheie(b);
    if (!grupuri.has(k)) grupuri.set(k, { mod: b, idx: [] });
    grupuri.get(k).idx.push(i);
  });

  let words = [];
  const casete = [];                   // dreptunghiurile de text, pentru desenare
  const legatDeFigura = new Set();     // cuvintele care se scaleaza odata cu figura
  for (const { mod, idx } of grupuri.values()) {
    if (mod.bind === 'none') continue;
    const items = stream.items(idx);
    let produse;

    if (mod.bind === 'box') {
      // Caseta se aseaza in punctul cerut, altfel in centrul figurii. Pe un text
      // FARA figura nu exista contur, iar bbox-ul ar da (0,0) — adica un colt de
      // panza, cu jumatate din caseta in afara ei. Acolo cade in mijlocul panzei.
      const bb = figure.bbox();
      const centru = mod.at && typeof mod.at === 'object'
        ? mod.at
        : figure.isEmpty
          ? { x: canvas.w / 2, y: canvas.h / 2 }
          : { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
      const r = bindBox(items, centru, { w: mod.w, h: mod.h }, stream.fontPx, canvas);
      produse = r.words;
      casete.push(r.box);
      idx.forEach(i => legatDeFigura.add(i));
    }
    else if (mod.bind === 'corner')  produse = bindCorner(items, canvas, stream.fontPx, mod.at);
    else if (mod.bind === 'corners') produse = bindCorners(items, canvas, stream.fontPx);
    else if (mod.bind === 'point')   produse = bindPoint(items, mod.at, stream.fontPx);
    else if (mod.bind === 'pieces') { produse = bindPieces(figure, items, stream.fontPx); idx.forEach(i => legatDeFigura.add(i)); }
    else if (mod.bind === 'side')   { produse = bindSide(figure, items, stream.fontPx, mod.at, 12, mod.in === true); idx.forEach(i => legatDeFigura.add(i)); }
    else if (mod.bind === 'sides')  { produse = bindSides(figure, items, stream.fontPx); idx.forEach(i => legatDeFigura.add(i)); }
    else if (mod.bind === 'path')   { produse = bindPath(figure, items, stream.fontPx); idx.forEach(i => legatDeFigura.add(i)); }
    else                            { produse = bindInside(figure, items, stream.fontPx); idx.forEach(i => legatDeFigura.add(i)); }

    // Rotatia se ADUNA peste unghiul pus de binder. Pe contur, cuvintele urmeaza
    // deja panta laturii; „intoarce cu 90" inseamna inca 90 fata de ea, nu 90
    // absolut — altfel un text asezat pe o latura verticala ar sari de pe ea.
    if (mod.rot) produse = produse.map(w => ({ ...w, rot: ((w.rot || 0) + mod.rot) % 360 }));

    words.push(...produse);
  }
  words.sort((a, b) => a.i - b.i);

  // --- scale-shape: daca figura depaseste panza, o micsoram uniform
  const b = figure.bbox();
  const avail = { w: canvas.w - 2 * canvas.pad, h: canvas.h - 2 * canvas.pad };
  const need = { w: b.maxX - b.minX, h: b.maxY - b.minY };
  const k = Math.min(1, avail.w / (need.w || 1), avail.h / (need.h || 1));

  if (k < 1) {
    const cx = canvas.w / 2, cy = canvas.h / 2;
    const sc = (x, y) => ({ x: cx + (x - cx) * k, y: cy + (y - cy) * k });

    // Scalarea singura da MARIMEA buna, nu si LOCUL. Se face fata de centrul PANZEI,
    // iar o figura al carei centru e departe de al panzei ramane pe dinafara chiar
    // dupa ce a fost micsorata: masurat, un patrat de 900x900 cu centrul in (20,20)
    // se desena de la -327 la 461, adica o treime in afara imaginii.
    //
    // De aceea, dupa scalare, rezultatul se si TRANSLATEAZA in cadru — acum incape,
    // deci exista unde. Amandoua sunt doar la desenare: datele figurii raman intacte,
    // cu Sum(len) neatins.
    const dupa = {
      minX: sc(b.minX, 0).x, maxX: sc(b.maxX, 0).x,
      minY: sc(0, b.minY).y, maxY: sc(0, b.maxY).y,
    };
    const { dx, dy } = restrange(dupa, canvas);
    const tr = (x, y) => { const p = sc(x, y); return { x: p.x + dx, y: p.y + dy }; };

    edges = edges.map(e => {
      const a = tr(e.x1, e.y1), c = tr(e.x2, e.y2);
      return { ...e, x1: a.x, y1: a.y, x2: c.x, y2: c.y, len: e.len * k };
    });
    // doar textul legat de figura se scaleaza; cel ancorat pe panza ramane pe loc
    words = words.map(w => {
      if (!legatDeFigura.has(w.i)) return w;
      const p = tr(w.x, w.y);
      return { ...w, x: p.x, y: p.y, size: w.size * k };
    });
    // caseta se scaleaza odata cu figura de care e legata
    for (let j = 0; j < casete.length; j++) {
      const c = casete[j];
      const p = tr(c.x, c.y);
      casete[j] = { x: p.x, y: p.y, w: c.w * k, h: c.h * k };
    }
  }

  return { edges, words, casete, scale: k };
}
