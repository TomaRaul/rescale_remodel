// Verificare headless: rulează logica fără browser, cu un context de canvas simulat.
//   npm test
//
// Domeniul e restrâns la patrulatere cu unghiuri drepte — pătrat sau dreptunghi.

const B = './src/';
const { Figure }     = await import(B + 'models/Figure.js');
const CAT            = await import(B + 'models/ShapeBST.js');
const SC             = await import(B + 'models/Scene.js');
const { TextStream } = await import(B + 'text/TextStream.js');
const { OPS }        = await import(B + 'engines/Operations.js');
const { layout, schimbaCaseta, restrange, CASETA } = await import(B + 'engines/LayoutEngine.js');
const { Asezator }   = await import(B + 'text/Asezator.js');
const PP             = await import(B + 'interaction/PromptParser.js');
const TM             = await import(B + 'interaction/TokenMeter.js');
const LLM            = await import('./dist/llm.js');
const { GEOMETRU, TIPOGRAF, CASETAR } = await import('./dist/mastra/agenti.js');
const { Router }     = await import('./dist/mastra/router.js');
const { combina }    = await import('./dist/mastra/flux.js');
const { lantModele, REZERVE } = await import('./dist/mastra/modele.js');
const MEM = await import('./dist/memorie.js');
const { IESIRE_GEOM, IESIRE_TEXT, IESIRE_CASETA, MAX_PASI } = await import('./dist/mastra/scheme.js');

const { GRID, CELL, AX, CANVAS_PX, PANZA_MAX, pointPixel, toLogic, inCanvas } = SC;
/** Câte celule încap pe latura celei mai mari pânze — domeniul catalogului. */
const CELULE = PANZA_MAX / CELL;
const CANVAS = { w: CANVAS_PX, h: CANVAS_PX, pad: 6 };

// stub de măsurare care ține cont de mărimea fontului, ca în browser
const ctx = {
  font: '',
  measureText(t) {
    const f = String(this.font);
    const i = f.indexOf('px');
    let px = 17;
    if (i > 0) { const n = parseFloat(f.slice(0, i).split(' ').pop()); if (n > 0) px = n; }
    return { width: String(t).length * px * 0.55 };
  },
};

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };
const est = TM.est;   // acelasi estimator ca aplicatia, nu o copie care poate ramane in urma
const dreptunghi = (w, h) => OPS.rect(CANVAS, w, h);   // acum in PIXELI

// ─────────────────────────────────────────────────────────── 1. grila
console.log('=== 1. grila și coordonatele ===');
ok(GRID === 16 && CELL === 50, `grilă ${GRID}×${GRID}, reper la fiecare ${CELL}px`);
ok(CANVAS_PX === GRID * CELL, `pânza de PORNIRE, ${CANVAS_PX}×${CANVAS_PX}`);
// Pornirea și plafonul sunt două lucruri diferite: pânza începe la 800, dar poate fi
// dusă până la 1200. Cât timp stăteau în aceeași constantă, distincția nu se punea.
ok(PANZA_MAX === 1200 && PANZA_MAX > CANVAS_PX,
   `pânza poate crește până la ${PANZA_MAX}×${PANZA_MAX}, peste cea de pornire`);
ok(SC.limPanza(9999) === PANZA_MAX && SC.limPanza(10) === SC.PANZA_MIN,
   `o latură cerută se ține între ${SC.PANZA_MIN} și ${PANZA_MAX}px`);
const p00 = pointPixel(0, 0), p16 = pointPixel(CANVAS_PX, CANVAS_PX);
ok(p00.x === 0 && p00.y === CANVAS_PX, `(0,0) e în colțul din STÂNGA JOS: ${p00.x},${p00.y}`);
ok(p16.x === CANVAS_PX && p16.y === 0, `(800,800) e în dreapta sus: ${p16.x},${p16.y}`);
ok(pointPixel(4, 0).y > pointPixel(4, 10).y, 'y crește în SUS, invers față de canvas');
ok(pointPixel(25, 25).x === 25, 'coordonatele sunt PIXELI: (25,25) nu se lipește de grilă');
ok(inCanvas(0, CANVAS_PX) && inCanvas(25, 25) && !inCanvas(-1, 0) && !inCanvas(0, CANVAS_PX + 1),
   `coordonatele valide sunt 0..${CANVAS_PX}`);
const g = toLogic(pointPixel(137, 412).x, pointPixel(137, 412).y);
ok(g.x === 137 && g.y === 412, 'toLogic inversează exact pointPixel, la pixel');
ok(AX.l > 0 && AX.b > 0 && AX.r > 0 && AX.t > 0,
   `bandă de axe pe toate laturile (${AX.l}/${AX.r}/${AX.t}/${AX.b}) — eticheta 16 nu e tăiată`);

// ─────────────────────────────────────────────────────────── 2. domeniul
console.log('\n=== 2. domeniul: doar pătrat și dreptunghi ===');
ok(Object.keys(OPS).sort().join(',') === 'anchorAt,moveTo,rect,resize,scaleToFit,scaleXY,split,stretch',
   `operații expuse: ${Object.keys(OPS).join(', ')}`);

const patrat = dreptunghi(150, 150);
const drept = dreptunghi(300, 150);
for (const [f, nume, w, h] of [[patrat, 'SQUARE', 150, 150], [drept, 'RECTANGLE', 300, 150],
                               [dreptunghi(100, 400), 'RECTANGLE', 100, 400], [dreptunghi(800, 800), 'SQUARE', 800, 800]]) {
  const sig = f.signature();
  const hit = CAT.search(sig);
  const b = f.bbox();
  ok(hit.leaf === nume && sig.nSeg === 4 && sig.right && sig.closed
     && Math.abs((b.maxX - b.minX) - w) < 1 && Math.abs((b.maxY - b.minY) - h) < 1,
     `${w}×${h}px → ${hit.leaf}  cod=${hit.path}  4 laturi, unghiuri drepte`);
}
ok(patrat.signature().nSeg === 4, 'orice figură are exact 4 segmente');
ok(Math.round(drept.totalLength()) === 2 * (300 + 150),
   `Σ len = 2·(300+150) = ${Math.round(drept.totalLength())}`);

// ─────────────────────────────────────────────────────────── 3. catalogul
console.log('\n=== 3. catalogul pe atribute ===');
ok(CAT.ATTRIBUTES.length === 3, `${CAT.ATTRIBUTES.length} atribute: ${CAT.ATTRIBUTES.map(a => a.id).join(', ')}`);
ok(CAT.skeleton().split('\n').length === 3, 'scheletul are 3 întrebări, constant');
console.log('  ' + CAT.ATTRIBUTES.map(a => a.q).join('\n  '));
// Domeniul catalogului se măsoară după cea mai MARE pânză, nu după cea de pornire: pe
// una de 1200 chiar există figuri de 20 de celule, iar plafonate la 16 ar primi codul
// unei figuri de 16 — două forme diferite cu același nume.
ok(CAT.addressable() === 8 * CELULE * CELULE, `${CAT.addressable()} combinații adresabile`);
ok(CAT.code(dreptunghi(1000, 100).signature()).split('|')[1] === String(1000 / CELL),
   'o figură mai lată decât pânza de pornire își primește lățimea adevărată, nu 16');
ok(CAT.search(dreptunghi(200, 200).signature()).leaf === 'SQUARE', 'lățime = înălțime → PATRAT');
ok(CAT.search(dreptunghi(200, 250).signature()).leaf === 'RECTANGLE', 'lățime ≠ înălțime → DREPTUNGHI');
ok(CAT.search(Figure.empty().signature()).leaf === 'EMPTY', 'figura goală → GOL');
ok(CAT.search(dreptunghi(300, 150).signature()).path === CAT.search(dreptunghi(300, 150).signature()).path,
   'același gabarit → același cod');
ok(CAT.search(dreptunghi(300, 150).signature()).path !== CAT.search(dreptunghi(150, 300).signature()).path,
   '6×3 și 3×6 au coduri diferite — orientarea contează');
ok(est(CAT.skeleton()) < est(CAT.flatCatalog()) / 10,
   `schelet ${est(CAT.skeleton())} tok vs catalog plat ${est(CAT.flatCatalog())} tok`);

// ─────────────────────────────────────────────────────────── 4. invariantul
console.log('\n=== 4. invariantul Σ len ===');
const P = Math.round(drept.totalLength());
for (const [f, eticheta] of [
  [OPS.split(drept, CANVAS, 2), 'split 2'],
  [OPS.split(drept, CANVAS, 3), 'split 3'],
  [OPS.split(drept, CANVAS, 6), 'split 6'],
]) {
  ok(Math.round(f.totalLength()) === P, `${eticheta}: Σ len conservat (${Math.round(f.totalLength())})`);
}
const s2 = OPS.split(drept, CANVAS, 2);
ok(s2.polylines.length === 2 && s2.polylines.every(p => p.closed && p.segs.length === 4),
   'split dă piese închise, tot cu 4 laturi fiecare');
ok(CAT.search(s2.signature()).leaf === 'GROUP_2', 'două piese → GRUP_2');
const c0 = new Figure([s2.polylines[0]]).centroid();
const c1 = new Figure([s2.polylines[1]]).centroid();
ok(Math.abs(c0.x - c1.x) > 20, 'piesele stau alăturate pe orizontală, nu suprapuse');

// resize și stretch au voie să schimbe Σ len — sunt excepțiile explicite
const mare = OPS.resize(dreptunghi(150, 150), 2);
ok(Math.round(mare.totalLength()) === 2 * Math.round(patrat.totalLength()),
   'resize ×2 dublează Σ len — schimbare cerută explicit');
const cMic = dreptunghi(150, 150).centroid(), cMare = mare.centroid();
ok(Math.abs(cMic.x - cMare.x) < 0.5 && Math.abs(cMic.y - cMare.y) < 0.5,
   'resize păstrează figura pe loc (scalează în jurul centrului)');
const intins = OPS.stretch(dreptunghi(150, 150), 400, 100);
const bi = intins.bbox();
ok(Math.abs((bi.maxX - bi.minX) - 400) < 1 && Math.abs((bi.maxY - bi.minY) - 100) < 1,
   'stretch atinge exact dimensiunile cerute');
ok(intins.signature().right && intins.signature().nSeg === 4,
   'după întindere unghiurile rămân drepte — tot dreptunghi');

// ─────────────────────────────────────────────────────────── 5. ancorarea
console.log('\n=== 5. ancorarea în punct ===');
const tinta = pointPixel(100, 250);
for (const mod of ['center', 'bl', 'br', 'tl', 'tr', 'bottom', 'top', 'left', 'right']) {
  const f = dreptunghi(150, 150);
  OPS.anchorAt(f, tinta, mod);
  const b = f.bbox();
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const ref = {
    center: [cx, cy], bl: [b.minX, b.maxY], br: [b.maxX, b.maxY],
    tl: [b.minX, b.minY], tr: [b.maxX, b.minY],
    bottom: [cx, b.maxY], top: [cx, b.minY], left: [b.minX, cy], right: [b.maxX, cy],
  }[mod];
  ok(Math.abs(ref[0] - tinta.x) < 0.5 && Math.abs(ref[1] - tinta.y) < 0.5, `anchor "${mod}" cade exact în punct`);
}

// ─────────────────────────────────────────────────────────── 6. textul
console.log('\n=== 6. textul ===');
const flux = new TextStream(['UNU', 'DOI'], ctx, 17);
ok(flux.words.length === 2 && flux.totalWidth() > 0, 'flux măsurat');
const latimeInainte = flux.totalWidth();
flux.fontPx = 24; flux.remeasure();
ok(flux.words.length === 2 && flux.totalWidth() > latimeInainte,
   `mărimea schimbă lățimea (${Math.round(latimeInainte)} → ${Math.round(flux.totalWidth())}), nu șterge cuvinte`);
flux.setWords([]);
ok(flux.words.length === 0, 'lista goală ȘTERGE textul');

ok(drept.visualEdges().length === 4, 'un dreptunghi are 4 laturi vizibile');
const patruHam = new TextStream(['HAM', 'HAM', 'HAM', 'HAM'], ctx, 17);
const peLaturi = layout(drept, patruHam, 'sides', CANVAS).words;
ok(peLaturi.length === 4, 'câte un cuvânt pe fiecare latură');
ok(new Set(peLaturi.map(w => Math.round(((w.rot % 360) + 360) % 360))).size === 4,
   'fiecare e rotit cu latura lui');
const bd = drept.bbox();
const centruD = { x: (bd.minX + bd.maxX) / 2, y: (bd.minY + bd.maxY) / 2 };
ok(peLaturi.every(w => Math.hypot(w.x - centruD.x, w.y - centruD.y) > 20), 'niciunul nu cade în centru');

const doiMiau = new TextStream(['MIAU', 'MIAU'], ctx, 17);
const inPiese = layout(s2, doiMiau, 'pieces', CANVAS).words;
ok(inPiese.length === 2, 'modul pieces: câte unul pe piesă');
ok(Math.hypot(inPiese[0].x - c0.x, inPiese[0].y - c0.y) < 1
   && Math.hypot(inPiese[1].x - c1.x, inPiese[1].y - c1.y) < 1,
   'fiecare cade exact pe centrul piesei lui');
const unInside = layout(s2, new TextStream(['MIAU'], ctx, 17), 'inside', CANVAS).words;
ok(Math.abs(unInside[0].x - (c0.x + c1.x) / 2) < 1,
   'pentru comparație: "inside" pune textul pe mijloc, între piese');

const partial = layout(patrat, new TextStream(['A', 'B', 'C', 'D'], ctx, 17),
  [{ bind: 'corner', at: 'bl' }, { bind: 'corner', at: 'bl' }, 'inside', 'inside'], CANVAS).words;
ok(partial.length === 4, 'legare parțială: toate cuvintele sunt desenate');
ok(partial.filter(w => w.i < 2).every(w => w.x < 80 && w.y > CANVAS_PX - 120),
   'primele două au ajuns în stânga jos');
const bp = patrat.bbox();
const cxP = (bp.minX + bp.maxX) / 2;
ok(partial.filter(w => w.i >= 2).every(w => Math.abs(w.x - cxP) < 1),
   'celelalte au rămas centrate în figură');
for (const at of ['tl', 'tr', 'br', 'bl']) {
  const w = layout(patrat, new TextStream(['X', 'Y'], ctx, 17), { bind: 'corner', at }, CANVAS).words;
  ok(w.length === 2 && new Set(w.map(q => Math.round(q.x))).size === 1, `corner:${at} — stivuit pe o coloană`);
}
ok(layout(patrat, new TextStream(['X'], ctx, 17), 'none', CANVAS).words.length === 0,
   '"none" ascunde textul');

// text pe o latura ANUME, aleasa geometric
const bDr = drept.bbox();
for (const [care, verifica] of [
  ['top',    w => w.y < bDr.minY && bDr.minY - w.y < 40],
  ['bottom', w => w.y > bDr.maxY && w.y - bDr.maxY < 40],
  ['left',   w => w.x < bDr.minX && bDr.minX - w.x < 40],
  ['right',  w => w.x > bDr.maxX && w.x - bDr.maxX < 40],
]) {
  const w = layout(drept, new TextStream(['T'], ctx, 17), { bind: 'side', at: care }, CANVAS).words[0];
  ok(verifica(w), `side "${care}": textul cade lângă latura corectă, în afara ei (@${Math.round(w.x)},${Math.round(w.y)})`);
}
// varianta INTERIOARA: "sub latura de sus" inseamna inauntrul figurii
for (const [care, verifica, eticheta] of [
  ['top',    w => w.y > bDr.minY && w.y < bDr.maxY, 'sub latura de sus'],
  ['bottom', w => w.y < bDr.maxY && w.y > bDr.minY, 'deasupra laturii de jos'],
  ['left',   w => w.x > bDr.minX && w.x < bDr.maxX, 'în dreapta laturii din stânga'],
]) {
  const w = layout(drept, new TextStream(['T'], ctx, 17), { bind: 'side', at: care, in: true }, CANVAS).words[0];
  ok(verifica(w), `in:true — "${eticheta}" cade în INTERIORUL figurii (@${Math.round(w.x)},${Math.round(w.y)})`);
}
const afara = layout(drept, new TextStream(['T'], ctx, 17), { bind: 'side', at: 'top' }, CANVAS).words[0];
const inauntru = layout(drept, new TextStream(['T'], ctx, 17), { bind: 'side', at: 'top', in: true }, CANVAS).words[0];
ok(afara.y < bDr.minY && inauntru.y > bDr.minY, 'aceeași latură, două poziții opuse față de ea');

const sus = layout(drept, new TextStream(['T'], ctx, 17), { bind: 'side', at: 'top' }, CANVAS).words[0];
const jos = layout(drept, new TextStream(['T'], ctx, 17), { bind: 'side', at: 'bottom' }, CANVAS).words[0];
ok(sus.y < jos.y, '"top" e deasupra lui "bottom", nu invers');
const stg = layout(drept, new TextStream(['T'], ctx, 17), { bind: 'side', at: 'left' }, CANVAS).words[0];
ok(Math.abs(stg.rot) === 90, `textul pe laturile verticale e rotit (${stg.rot}°)`);
const doua = layout(drept, new TextStream(['A','B'], ctx, 17), { bind: 'side', at: 'top' }, CANVAS).words;
ok(doua.length === 2 && Math.abs(doua[0].y - doua[1].y) > 10, 'mai multe cuvinte pe aceeași latură se stivuiesc');

// toate cuvintele de la bindSides ies ÎN AFARA figurii, nu peste desen
const patruLat = layout(drept, new TextStream(['A','B','C','D'], ctx, 17), 'sides', CANVAS).words;
ok(patruLat.every(w => w.x < bDr.minX || w.x > bDr.maxX || w.y < bDr.minY || w.y > bDr.maxY),
   'modul "sides": niciun cuvânt nu cade peste interiorul figurii');

// text intr-un punct de pe grila, independent de figuri
const pt = pointPixel(200, 350);
const inPunct = layout(patrat, new TextStream(['SALUT'], ctx, 17), { bind: 'point', at: pt }, CANVAS).words;
ok(inPunct.length === 1 && Math.abs(inPunct[0].x - pt.x) < 1 && Math.abs(inPunct[0].y - pt.y) < 1,
   `"point": textul cade exact in (200,350) = ${pt.x},${pt.y}`);
const treiInPunct = layout(patrat, new TextStream(['A','B','C'], ctx, 17), { bind: 'point', at: pt }, CANVAS).words;
ok(treiInPunct.length === 3 && new Set(treiInPunct.map(w => Math.round(w.x))).size === 1,
   'mai multe cuvinte se stivuiesc pe aceeasi coloana, centrate pe punct');
ok(Math.abs((treiInPunct[0].y + treiInPunct[2].y) / 2 - pt.y) < 1, 'blocul e centrat vertical pe punct');
const bp2 = patrat.bbox();
ok(Math.abs(inPunct[0].x - (bp2.minX + bp2.maxX) / 2) > 1,
   '"point" e independent de figura — nu cade pe centrul ei');

// ─────────────────────────────────────────────────────────── 6b. suprapunerea
console.log('\n=== 6b. mai multe figuri din același punct ===');
const { Scene, Obiect } = SC;
const sc = new Scene();
const faObiect = (w, h) => new Obiect(dreptunghi(w, h), { x: 350, y: 350 }, new TextStream([], ctx, 17));
sc.add(faObiect(3, 3)); sc.add(faObiect(6, 2)); sc.add(faObiect(1, 1));
ok(sc.atPoint(350, 350).length === 3, 'trei figuri pot porni din același punct de origine');
ok(sc.length === 3, 'niciuna nu a fost ștearsă la adăugarea următoarei');
ok(new Set(sc.atPoint(350, 350).map(o => o.id)).size === 3, 'fiecare are id propriu, deci poate fi țintită separat');
ok(sc.atPoint(1, 1).length === 0, 'un punct fără figuri întoarce listă goală');
const buget = sc.obiecte.map(o => Math.round(o.figure.totalLength()));
ok(new Set(buget).size === 3, `bugete independente: ${buget.join(', ')}`);
ok(LLM.validate({ geom: { op: 'rect', w: 150, h: 150, at: { x: 350, y: 350 }, replace: true } }).geom.replace === true,
   '"replace": true trece prin validare — înlocuirea se cere explicit');
ok(LLM.validate({ geom: { op: 'rect', w: 150, h: 150, at: { x: 350, y: 350 } } }).geom.replace === undefined,
   'fără el, implicit e suprapunerea');


// ─────────────────────────────────── 6b. TOATE modurile de legare, pe orice figură
// Un cuvânt care ajunge la desenare cu coordonate NaN, ori care nu ajunge deloc,
// arată pe ecran exact ca un text care nu s-a generat. De aceea fiecare mod se
// verifică pe amândouă felurile de figură: întreagă și tăiată în bucăți.
console.log('\n=== 6b. fiecare mod de legare ajunge pe pânză ===');

const MODURI_TEXT = [
  ['inside', 'inside'],
  ['path', 'path'],
  ['sides', 'sides'],
  ['corners', 'corners'],
  ['pieces', 'pieces'],
  ['side sus', { bind: 'side', at: 'top' }],
  ['side jos', { bind: 'side', at: 'bottom' }],
  ['side stânga', { bind: 'side', at: 'left' }],
  ['side dreapta', { bind: 'side', at: 'right' }],
  ['side sus, înăuntru', { bind: 'side', at: 'top', in: true }],
  ['side jos, înăuntru', { bind: 'side', at: 'bottom', in: true }],
  ['corner tl', { bind: 'corner', at: 'tl' }],
  ['corner tr', { bind: 'corner', at: 'tr' }],
  ['corner br', { bind: 'corner', at: 'br' }],
  ['corner bl', { bind: 'corner', at: 'bl' }],
  ['point', { bind: 'point', at: { x: 200, y: 600 } }],
  ['box', { bind: 'box', w: 200, h: 0 }],
];

const desenabil = w => Number.isFinite(w.x) && Number.isFinite(w.y)
                    && Number.isFinite(w.size) && Number.isFinite(w.rot) && w.size > 0.5;

const intreaga = OPS.rect(Figure.empty(), 300, 200);
const taiata = OPS.split(OPS.rect(Figure.empty(), 300, 200), CANVAS, 3, 'v');
ok(taiata.polylines.length === 3, `figura tăiată chiar are 3 contururi (${taiata.polylines.length})`);

for (const [nume, mod] of MODURI_TEXT) {
  for (const [cumE, fig] of [['întreagă', intreaga], ['tăiată', taiata]]) {
    const st = new TextStream(['ALFA', 'BETA', 'GAMA'], ctx, 17);
    const w = layout(fig, st, st.words.map(() => mod), CANVAS).words;
    ok(w.length === 3 && w.every(desenabil),
       `${nume} pe figură ${cumE}: ${w.length} cuvinte desenabile`);
  }
}

// „none" e singurul care are voie sa nu deseneze nimic
ok(layout(intreaga, new TextStream(['X'], ctx, 17), 'none', CANVAS).words.length === 0,
   'doar "none" ascunde textul — restul desenează întotdeauna');

// figura goala poarta text daca legarea e la punct absolut: asa merge scrisul
// pe panza pe care nu s-a desenat nimic inca
const fluxGol = new TextStream(['SINGUR'], ctx, 17);
const peGol = layout(Figure.empty(), fluxGol, [{ bind: 'point', at: { x: 150, y: 150 } }], CANVAS).words;
ok(peGol.length === 1 && desenabil(peGol[0]) && Math.round(peGol[0].x) === 150,
   'text fără figură, legat la punct, ajunge exact în punctul cerut');

// marimea se aplica pe tot fluxul, nu sterge cuvinte
const fluxMare = new TextStream(['A', 'B'], ctx, 17);
fluxMare.fontPx = Math.round(fluxMare.fontPx * 1.4); fluxMare.remeasure();
const cuvinteMari = layout(intreaga, fluxMare, ['inside', 'inside'], CANVAS).words;
ok(cuvinteMari.length === 2 && cuvinteMari.every(w => w.size > 17), 'mărirea textului nu pierde cuvinte');

// legare MIXTA: fiecare cuvant cu modul lui, cum le lasa promptul „scrie si BETA"
const mixt = new TextStream(['UNU', 'DOI', 'TREI'], ctx, 17);
const wMixt = layout(intreaga, mixt,
  ['inside', { bind: 'side', at: 'top' }, { bind: 'corner', at: 'bl' }], CANVAS).words;
ok(wMixt.length === 3 && wMixt.every(desenabil), 'cuvinte cu legări DIFERITE pe aceeași figură');
ok(new Set(wMixt.map(w => `${Math.round(w.x)},${Math.round(w.y)}`)).size === 3,
   'cele trei legări dau trei poziții distincte, nu se suprapun');

// ─────────────────────────────────────────────────────── 6c. caseta de text
// Caseta e singurul mod care nu urmează geometria figurii: textul își are propriul
// dreptunghi, iar lățimea lui rupe rândurile. De aceea se verifică separat că
// ambalajul chiar ajunge pe pânză și că mărimea lui se poate schimba în pixeli.
console.log('\n=== 6c. caseta de text ===');

const inCaseta = (w, h, cuvinte = ['SALUT', 'LUME', 'DIN', 'CASETA']) => {
  const st = new TextStream(cuvinte, ctx, 17);
  const binds = st.words.map(() => ({ bind: 'box', w, h }));
  return { st, binds, sc: layout(intreaga, st, binds, CANVAS) };
};
const randuri = sc => new Set(sc.words.map(w => Math.round(w.y))).size;

const cutie = inCaseta(200, 0);
ok(cutie.sc.casete.length === 1, `caseta ajunge în scenă ca dreptunghi de desenat (${cutie.sc.casete.length})`);
ok(Math.round(cutie.sc.casete[0].w) === 200, 'lățimea casetei e exact cea cerută');
ok(cutie.sc.words.length === 4 && cutie.sc.words.every(desenabil),
   'toate cuvintele din casetă sunt desenabile');

// latimea RUPE randurile — asta face caseta sa fie caseta, nu doar un chenar
ok(randuri(inCaseta(60, 0).sc) > randuri(inCaseta(400, 0).sc),
   `o casetă îngustă rupe textul pe mai multe rânduri (${randuri(inCaseta(60, 0).sc)} față de ${randuri(inCaseta(400, 0).sc)})`);
ok(inCaseta(400, 0).sc.casete[0].h < inCaseta(400, 300).sc.casete[0].h,
   'înălțimea 0 strânge caseta pe rânduri; una cerută explicit o ține deschisă');

// --- lățimea „auto": caseta se strânge pe text, exact ca înălțimea
// 200px ficși erau un ambalaj de cinci ori mai lat decât cuvântul dinăuntru:
// „textbox miau" desena o cutie de 200px în jurul unui MIAU de 37px.
ok(CASETA.w === 0, 'implicitul e „auto" pe lățime, nu o cifră fixă');

const unCuvant = new TextStream(['MIAU'], ctx, 17);
const stransa = layout(intreaga, unCuvant, [{ bind: 'box', w: 0, h: 0 }], CANVAS);
ok(Math.abs(stransa.casete[0].w - unCuvant.advance[0]) < 1,
   `caseta „auto" măsoară exact cât cuvântul: ${Math.round(stransa.casete[0].w)}px` +
   ` pentru ${Math.round(unCuvant.advance[0])}px de text`);
ok(stransa.casete[0].w < 100, `adică mult sub cei 200px ficși de dinainte`);
ok(stransa.words[0].x - unCuvant.advance[0] / 2 >= stransa.casete[0].x - 0.5
   && stransa.words[0].x + unCuvant.advance[0] / 2 <= stransa.casete[0].x + stransa.casete[0].w + 0.5,
   'iar cuvântul chiar încape în ea, fără să iasă');

const auto3 = inCaseta(0, 0, ['SALUT', 'LUME', 'BUNA']);
ok(randuri(auto3.sc) === 1, 'mai multe cuvinte încap pe UN rând: lățimea e cât cere textul');
const natural = auto3.st.advance.reduce((a, b) => a + b, 0) + 2 * 17 * 0.32;
ok(Math.abs(auto3.sc.casete[0].w - natural) < 1,
   `și caseta măsoară exact atât: ${Math.round(auto3.sc.casete[0].w)}px, cuvinte plus spații`);

// o lățime cerută pe față rămâne exactă — „auto" e doar implicitul
ok(Math.round(inCaseta(300, 0).sc.casete[0].w) === 300,
   'o lățime cerută explicit nu se strânge pe text');

// text mai lat decât pânza: rândurile se rup, iar caseta se strânge pe cel mai lat
const preaLung = new TextStream(Array.from({ length: 12 }, () => 'AAAAAAAAAA'), ctx, 17);
const rupt = layout(intreaga, preaLung,
  preaLung.words.map(() => ({ bind: 'box', w: 0, h: 0 })), CANVAS);
ok(randuri(rupt) > 1, `un text mai lat decât pânza se rupe pe ${randuri(rupt)} rânduri`);
ok(rupt.casete[0].w < CANVAS_PX,
   `iar caseta se strânge pe cel mai lat rând (${Math.round(rupt.casete[0].w)}px), nu pe toată pânza`);

// creșterea relativă pornește de la cât MĂSOARĂ caseta, nu de la zero
const dinAuto = schimbaCaseta([{ bind: 'box', w: 0, h: 0 }], 40, { w: 37, h: 23 });
ok(dinAuto.caseta.w === 77,
   'o casetă „auto" crește de la cât se desenează acum: 37 + 40 = 77');
ok(dinAuto.caseta.h === 0, 'iar înălțimea rămâne „auto" la un singur număr');
ok(Math.abs(dinAuto.raport - Math.sqrt((77 / 37) * (77 / 37))) < 1e-9,
   `textul crește în raportul casetei: ×${dinAuto.raport.toFixed(2)}`);

// --- mărirea și micșorarea în PIXELI
const baza = inCaseta(200, 0).binds;
ok(schimbaCaseta(baza, 40).caseta.w === 240, 'caseta +40px devine 240 lățime');
ok(schimbaCaseta(baza, -50).caseta.w === 150, 'caseta −50px devine 150 lățime');
ok(schimbaCaseta(baza, 40).caseta.h === 0, 'înălțimea auto rămâne auto la redimensionare');
ok(schimbaCaseta([{ bind: 'box', w: 200, h: 80 }], 20).caseta.h === 100,
   'o înălțime cerută explicit crește odată cu lățimea');
ok(schimbaCaseta(baza, -5000).caseta.w === CASETA.min,
   `micșorarea se oprește la ${CASETA.min}px — sub atât nu mai încape niciun cuvânt`);
ok(schimbaCaseta(baza, 5000).caseta.w === CANVAS_PX, 'mărirea se oprește la lățimea pânzei');
ok(schimbaCaseta(baza, 0).caseta === null, 'o schimbare de 0px nu e o comandă');
ok(schimbaCaseta(['inside', 'inside'], 40).caseta === null,
   'fără nicio casetă pe obiect nu e ce redimensiona — se raportează, nu se inventează');

// legarile se INLOCUIESC: `Scene.snapshot` copiaza lista, nu si obiectele din ea,
// deci o mutatie pe loc ar rescrie si starea salvata pentru undo
const latimeInainteDeSchimbare = baza[0].w;
schimbaCaseta(baza, 120);
ok(baza[0].w === latimeInainteDeSchimbare,
   'redimensionarea nu atinge legările vechi — undo rămâne valid');

// si chiar se vede pe panza, nu doar in date
const maiLata = layout(intreaga, cutie.st, schimbaCaseta(baza, 120).binds, CANVAS);
ok(Math.round(maiLata.casete[0].w) === 320,
   `după +120px caseta desenată e de 320px (${Math.round(maiLata.casete[0].w)})`);
ok(randuri(maiLata) <= randuri(cutie.sc),
   'o casetă mai lată nu are nevoie de mai multe rânduri');

// --- textul crește ODATĂ cu caseta, în același raport
// O casetă de două ori mai lată cu același corp de literă arată a greșeală, nu a
// mărire. Raportul e pe lățime — ea e cea care rupe rândurile.
ok(schimbaCaseta(baza, 200).raport === 2, 'de la 200 la 400 raportul e ×2');
// când ambele axe cresc în ACELAȘI raport, media geometrică dă exact acel raport:
// cazul uniform rămâne neschimbat față de regula veche
ok(Math.abs(schimbaCaseta([{ bind: 'box', w: 200, h: 200 }], 200).raport - 2) < 1e-9,
   'ambele axe ×2 → textul tot ×2, ca înainte');
// un delta scalar adaugă aceiași PIXELI, nu același raport: pe o casetă turtită
// axele cresc diferit, iar textul urmează media lor
const turtita = schimbaCaseta([{ bind: 'box', w: 200, h: 100 }], 100);
ok(Math.abs(turtita.raport - Math.sqrt(1.5 * 2)) < 1e-9,
   `pe o casetă turtită axele cresc diferit: ×${turtita.raport.toFixed(2)}, între 1.5 și 2`);
ok(schimbaCaseta(baza, -100).raport === 0.5, 'de la 200 la 100 raportul e ×0.5');
ok(schimbaCaseta(baza, 0).raport === 1, 'fără schimbare, raportul e 1');
ok(schimbaCaseta(['inside'], 200).raport === 1, 'fără casetă nu există raport de aplicat');
// plafonul taie raportul, nu doar lățimea: textul crește cât a crescut caseta,
// nu cât s-a cerut
// --- creștere SEPARATĂ pe fiecare axă
// Un singur număr pierdea a doua cifră: „mărește cu 50x200" creștea doar pe x.
const peAxe = schimbaCaseta([{ bind: 'box', w: 200, h: 0 }], { w: 50, h: 200 }, 23);
ok(peAxe.caseta.w === 250, 'perechea crește lățimea cu prima cifră');
ok(peAxe.caseta.h === 223, 'și înălțimea cu a doua, pornind de la cât măsoară acum (23)');
// litera are o singură mărime, deci urmează media geometrică a celor două axe
ok(Math.abs(peAxe.raport - Math.sqrt((250 / 200) * (223 / 23))) < 1e-9,
   `raportul textului ține cont de AMBELE axe: ×${peAxe.raport.toFixed(2)}`);

const doarInalt = schimbaCaseta([{ bind: 'box', w: 200, h: 0 }], { w: 0, h: 100 }, 23);
ok(doarInalt.caseta.w === 200 && doarInalt.caseta.h === 123,
   'o creștere doar pe verticală lasă lățimea neatinsă');
ok(Math.abs(doarInalt.raport - Math.sqrt(123 / 23)) < 1e-9,
   `o creștere doar pe verticală chiar mărește textul: ×${doarInalt.raport.toFixed(2)}`);
ok(doarInalt.raport > 1, 'exact ce lipsea: pe verticală textul rămânea mic într-o cutie goală');

const explicita = schimbaCaseta([{ bind: 'box', w: 200, h: 80 }], { w: 10, h: 20 });
ok(explicita.caseta.h === 100, 'o înălțime deja explicită crește de la ea, nu de la desen');

// un singur număr păstrează înălțimea „auto" — ea crește singură, cu litera
const scalar = schimbaCaseta([{ bind: 'box', w: 200, h: 0 }], 40, 23);
ok(scalar.caseta.h === 0, 'un singur număr lasă înălțimea pe „auto"');
ok(scalar.caseta.w === 240, 'dar lățimea tot crește');

ok(schimbaCaseta([{ bind: 'box', w: 200, h: 0 }], { w: 0, h: 0 }).caseta === null,
   'o pereche de zerouri nu e o comandă');
ok(schimbaCaseta([{ bind: 'box', w: 700, h: 600 }], { w: 500, h: 500 }).caseta.w === CANVAS_PX,
   'plafonul se aplică pe fiecare axă separat');

// creșterea pe o singură axă rămâne sub cea pe amândouă: media geometrică o temperează
const doarLat = schimbaCaseta([{ bind: 'box', w: 200, h: 0 }], { w: 200, h: 0 }, 100);
const ambele = schimbaCaseta([{ bind: 'box', w: 200, h: 0 }], { w: 200, h: 100 }, 100);
ok(doarLat.raport < ambele.raport,
   `întinsă pe o axă textul crește mai puțin (×${doarLat.raport.toFixed(2)}) decât pe amândouă (×${ambele.raport.toFixed(2)})`);

const plafonat = schimbaCaseta([{ bind: 'box', w: 700, h: 0 }], 500);
ok(plafonat.caseta.w === CANVAS_PX && Math.abs(plafonat.raport - CANVAS_PX / 700) < 1e-9,
   `oprită de plafon, caseta crește ×${plafonat.raport.toFixed(2)}, nu ×1.71 cât s-a cerut`);

// --- caseta nu iese din pânză
// Figura are voie: politica `scale-shape` o micșorează. Caseta n-are ce scala —
// textul ar deveni ilizibil — deci se împinge înăuntru și se verifică aici.
const inPanza = b => b.x >= -0.01 && b.y >= -0.01
                  && b.x + b.w <= CANVAS_PX + 0.01 && b.y + b.h <= CANVAS_PX + 0.01;
const casetaPe = (fig, w, h = 0) => {
  const st = new TextStream(['ALFA', 'BETA'], ctx, 17);
  return layout(fig, st, st.words.map(() => ({ bind: 'box', w, h })), CANVAS);
};
// `rect` pornește din (0,0), deci figura stă lipită de un colț al pânzei
const laMargine = OPS.rect(Figure.empty(), 300, 200);
const laCelalaltColt = OPS.moveTo(OPS.rect(Figure.empty(), 100, 60), { x: 770, y: 770 });

for (const w of [200, 320, 700, CANVAS_PX]) {
  ok(inPanza(casetaPe(laMargine, w).casete[0]),
     `o casetă de ${w}px pe o figură din colț rămâne pe pânză`);
}
ok(inPanza(casetaPe(laCelalaltColt, 400).casete[0]),
   'și în colțul opus caseta e împinsă înăuntru, nu tăiată');
ok(inPanza(casetaPe(Figure.empty(), 300).casete[0]),
   'o casetă fără figură cade în mijlocul pânzei, nu în colțul (0,0)');

// una mai mare decât pânza n-are unde să se ducă: se centrează
const catPanza = casetaPe(laMargine, CANVAS_PX, CANVAS_PX).casete[0];
ok(inPanza(catPanza) && Math.round(catPanza.x) === 0 && Math.round(catPanza.y) === 0,
   'o casetă cât toată pânza se centrează, fără să iasă');

// cuvintele merg CU caseta: dacă ea a fost împinsă, ele o urmează
const impinsa = casetaPe(laMargine, 700);
ok(impinsa.words.every(w => w.x >= 0 && w.x <= CANVAS_PX && w.y >= 0 && w.y <= CANVAS_PX),
   'cuvintele urmează caseta împinsă — nu rămân în afara pânzei');

// mărirea repetată nu scoate caseta afară
let cresc = casetaPe(laMargine, 200);
let bindCresc = [{ bind: 'box', w: 200, h: 0 }, { bind: 'box', w: 200, h: 0 }];
for (let i = 0; i < 12; i++) bindCresc = schimbaCaseta(bindCresc, 100).binds;
const stFinal = new TextStream(['ALFA', 'BETA'], ctx, 17);
cresc = layout(laMargine, stFinal, bindCresc, CANVAS);
ok(inPanza(cresc.casete[0]),
   'după 12 măriri consecutive caseta e tot pe pânză (se oprește la lățimea ei)');

// ─────────────────────────────────────────────── 6d. așezătorul: unde cade un text nou
// Al doilea text ajungea în colțul (0,0) al pânzei — bbox-ul unui obiect fără figură.
// Acum poziția o alege `Asezator`: local, determinist, zero tokeni.
console.log('\n=== 6d. așezătorul ===');

const PANZA = { w: CANVAS_PX, h: CANVAS_PX };
const mij = { x: CANVAS_PX / 2, y: CANVAS_PX / 2 };

ok(JSON.stringify(Asezator.alege({ w: 100, h: 40 }, [], PANZA)) === JSON.stringify(mij),
   'pe o pânză goală textul cade fix în mijloc');

// mijlocul ocupat: se caută cel mai GOL loc, nu cel mai apropiat loc liber.
// Varianta veche păstra candidatul liber cel mai aproape de centru, iar `MARGINE` era
// tot ce despărțea două texte: la un corp de 17px ieșeau 14px de gol, adică un teanc
// în jurul centrului care se citea ca rândurile unui paragraf.
const laMijloc = Asezator.cadru(mij, 200, 40);
const alDoilea = Asezator.alege({ w: 200, h: 40 }, [laMijloc], PANZA);
const catDeDeparte = Math.round(Math.hypot(alDoilea.x - mij.x, alDoilea.y - mij.y));
ok(!Asezator.seAting(Asezator.cadru(alDoilea, 200, 40), laMijloc),
   'al doilea text nu atinge primul');
ok(catDeDeparte > 200,
   `al doilea text cade DEPARTE de primul (${catDeDeparte}px), nu lipit sub el`);

// ...dar nici lipit de ramă: marginea pânzei e și ea un vecin, deci un colț nu mai e
// „cel mai gol loc". Fără pereții ăștia în socoteală, textul ieșea la 2px de margine.
const cadruDoi = Asezator.cadru(alDoilea, 200, 40);
ok(cadruDoi.x > 20 && cadruDoi.y > 20
   && cadruDoi.x + cadruDoi.w < CANVAS_PX - 20 && cadruDoi.y + cadruDoi.h < CANVAS_PX - 20,
   `și păstrează respiro față de marginea pânzei (@${Math.round(alDoilea.x)},${Math.round(alDoilea.y)})`);

// mai multe texte la rând: fiecare liber, fiecare pe pânză
let asezate = [];
for (let i = 0; i < 6; i++) {
  const p2 = Asezator.alege({ w: 200, h: 40 }, asezate, PANZA);
  asezate.push(Asezator.cadru(p2, 200, 40));
}
let ciocniri = 0;
for (let i = 0; i < asezate.length; i++)
  for (let j = i + 1; j < asezate.length; j++)
    if (Asezator.seAting(asezate[i], asezate[j], 0)) ciocniri++;
ok(ciocniri === 0, `șase texte așezate la rând, zero suprapuneri`);
ok(asezate.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= CANVAS_PX && r.y + r.h <= CANVAS_PX),
   'toate rămân pe pânză');
// și nu doar „nu se ating": fiecare rămâne la o distanță care se vede. Marginea
// minimă de 10px e podeaua, nu ținta — cel mai gol loc e mult peste ea cât timp
// pânza mai are unde.
const respiroMinim = asezate.map((r, i) =>
  Asezator.respiro(r, asezate.filter((_, k) => k !== i), PANZA));
ok(respiroMinim.every(d => d > 3 * Asezator.MARGINE),
   `șase texte, respiro minim ${Math.round(Math.min(...respiroMinim))}px — peste ${Asezator.MARGINE}px cât cere marginea`);

// determinist: aceeași scenă dă același loc
ok(JSON.stringify(Asezator.alege({ w: 200, h: 40 }, [laMijloc], PANZA))
   === JSON.stringify(alDoilea), 'aceeași scenă dă exact același loc');

// pânza plină: mai bine suprapus în mijloc decât aruncat afară
const totul = [{ x: 0, y: 0, w: CANVAS_PX, h: CANVAS_PX }];
const inghesuit = Asezator.alege({ w: 100, h: 40 }, totul, PANZA);
ok(inghesuit.x >= 50 && inghesuit.x <= CANVAS_PX - 50,
   'pe o pânză plină textul cade tot înăuntru, nu în afara ei');

// un text mai mare decât pânza e adus înăuntru, nu lăsat să iasă
const urias = Asezator.alege({ w: 2000, h: 2000 }, [], PANZA);
ok(urias.x === CANVAS_PX / 2 && urias.y === CANVAS_PX / 2,
   'un text mai mare decât pânza se centrează');

// fiecare text scris pe rand isi are caseta lui: doua casete de 200 nu incap
// una peste alta, deci a doua e impinsa langa prima
const douaCasete = [];
for (let i = 0; i < 3; i++) {
  const p3 = Asezator.alege({ w: 200, h: 23 }, douaCasete, PANZA);
  douaCasete.push(Asezator.cadru(p3, 200, 23));
}
let peste = 0;
for (let i = 0; i < douaCasete.length; i++)
  for (let j = i + 1; j < douaCasete.length; j++)
    if (Asezator.seAting(douaCasete[i], douaCasete[j], 0)) peste++;
ok(peste === 0, 'trei casete scrise pe rând nu ajung una peste alta');
ok(new Set(douaCasete.map(r => r.y)).size === 3,
   'fiecare casetă își are locul ei, nu se suprapun în același punct');

// ─────────────────────────────────────────────────────────── 7. validarea DSL
console.log('\n=== 7. validarea DSL ===');
const V = LLM.validate;
ok(V({ geom: { op: 'rect', w: 300, h: 150, at: { x: 400, y: 400 } } }).geom.w === 300, 'rect cu w/h trece');
ok(V({ geom: { op: 'rect', size: 200, at: { x: 100, y: 100 } } }).geom.h === 200, '"size" se extinde în w=h');
ok(V({ geom: { op: 'rect', w: 9999, h: 0, at: { x: 1, y: 1 } } }).geom.w === PANZA_MAX,
   'dimensiuni absurde sunt plafonate la cea mai mare pânză cu putință');
ok(V({ geom: { op: 'rect', w: 150, h: 150, at: { x: 1000, y: 1000 } } }).geom.at.x === 1000,
   'un punct care încape pe o pânză crescută trece validarea');
ok(V({ geom: { op: 'rect', at: { x: 1, y: 1 } } }).geom.w === undefined,
   'fără dimensiune, w rămâne lipsă — motorul refuză generarea');
ok(V({ geom: { op: 'rect', w: 150, h: 150, at: { x: 9999, y: 1 } } }).geom.at === undefined,
   'punct în afara pânzei e ignorat');
ok(V({ geom: { op: 'rect', w: 150, h: 150, anchor: 'bl', at: { x: 25, y: 25 } } }).geom.anchor === 'bl', 'anchor valid trece');
ok(V({ geom: { op: 'rect', w: 150, h: 150, anchor: 'HACK', at: { x: 25, y: 25 } } }).geom.anchor === undefined, 'anchor invalid e ignorat');
ok(V({ geom: { op: 'split', into: 99 } }).geom.into === 6, 'split plafonat la 6');
ok(V({ geom: { op: 'resize', scale: 99 } }).geom.scale === 10, 'scale plafonat la 10');
ok(V({ geom: { op: 'resize', w: 400, h: 100 } }).geom.scale === undefined, 'resize cu w/h nu primește scale redundant');
ok(V({ geom: { op: 'clear' } }).geom.op === 'clear', 'clear trece');
ok(V({ geom: { op: 'rect', w: 150, h: 150, cells: [{ x: 100, y: 100 }, { x: 9999, y: 9 }] } }).geom.cells.length === 1,
   'din cells rămân doar punctele valide');
for (const disparuta of ['polygon', 'circle', 'digits', 'shape', 'compose', 'unfold', 'regroup', 'add', 'rhombus', 'trapezoid']) {
  ok(V({ geom: { op: disparuta, n: 6 }, text: { bind: 'none' } }).geom === null,
     `operația "${disparuta}" nu mai există în domeniu → respinsă`);
}
// forma MINIFICATA: modelul emite chei de un caracter si puncte ca [x,y];
// validarea le expandeaza la forma lunga, deci restul aplicatiei nu afla nimic
const lung = V({ geom: { op: 'rect', w: 50, h: 50, at: { x: 25, y: 25 }, anchor: 'bl' } });
const scurt = V({ g: { o: 'r', w: 50, h: 50, p: [25, 25], a: 'bl' } });
ok(JSON.stringify(lung) === JSON.stringify(scurt), 'forma scurtă și cea lungă dau exact același rezultat');
ok(scurt.geom.at.x === 25 && scurt.geom.at.y === 25, 'punctul [25,25] devine {x:25,y:25}');
ok(V({ g: { o: 's', n: 3, d: 'v' } }).geom.into === 3, 'o:s → split, n → into');
ok(V({ g: { o: 'z', k: 1.5 } }).geom.scale === 1.5, 'o:z → resize, k → scale');
ok(V({ g: { o: 'c' } }).geom.op === 'clear', 'o:c → clear');
ok(V({ g: { o: 'm', p: [400, 400] } }).geom.op === 'move', 'o:m → move');
ok(V({ g: { o: 'm', p: [400, 400], a: 'bl' } }).geom.anchor === 'bl', 'move acceptă ancoră');
let faraPunct = false;
try { V({ g: { o: 'm' } }); } catch { faraPunct = true; }
ok(faraPunct, 'move fără punct e respins — nu are unde să mute');
ok(V({ t: { s: ['MIAU'], b: 'p', r: true } }).text.bind === 'pieces', 'b:p → pieces, r → repeat');
ok(V({ t: { b: 'e', a: 'top', in: true } }).text.in === true, 'in:true trece — latura pe dinăuntru');
ok(V({ t: { b: 'e', a: 'top' } }).text.in === undefined, 'fără in, implicit e în afara laturii');
ok(V({ t: { d: ['BETA'], b: 'e', a: 'top' } }).text.add.join() === 'BETA', 'd → add, adaugă text nou');
ok(V({ t: { v: 0, b: 'e', a: 'bottom' } }).text.to === 0, 'v → to, mută textul pe altă figură');
ok(V({ t: { v: 'x', b: 'i' } }).text.to === undefined, 'destinație nenumerică e ignorată');
let addGol = false;
try { V({ t: { d: [] } }); } catch { addGol = true; }
ok(addGol, 'add gol nu produce comandă — e respins ca DSL gol');
ok(V({ t: { s: ['X'], b: 'q', a: [137, 412] } }).text.at.y === 412, 'b:q → point, a ca [x,y]');
ok(V({ t: { b: 'k', a: 'bl', w: [0, 1] } }).text.words.length === 2, 'b:k → corner, w → words');
ok(V({ t: { b: 'x' } }).text.bind === 'box', 'b:x → box, caseta de text');
ok(V({ t: { b: 'x', z: [300, 80] } }).text.box.w === 300, 'z → box, [lățime, înălțime] în pixeli');
ok(V({ t: { b: 'x', z: [300, 80] } }).text.box.h === 80, 'înălțimea cerută trece');
ok(V({ t: { b: 'x', z: [300] } }).text.box.h === 0, 'fără înălțime, caseta se strânge pe rânduri (h:0)');
ok(V({ t: { b: 'x', z: [5, 5] } }).text.box.w === 20, 'o casetă absurd de mică e ridicată la minim');
ok(V({ t: { b: 'x', z: [9999, 9999] } }).text.box.w === PANZA_MAX, 'o casetă absurd de mare e plafonată');
ok(V({ t: { f: 40 } }).text.boxDelta === 40, 'f → boxDelta, mărirea casetei în pixeli');
ok(V({ t: { f: -25 } }).text.boxDelta === -25, 'f negativ micșorează caseta');
ok(V({ t: { f: [50, 200] } }).text.boxDelta.w === 50, 'f ca pereche → lățimea, prima cifră');
ok(V({ t: { f: [50, 200] } }).text.boxDelta.h === 200, 'f ca pereche → înălțimea, a doua cifră');
ok(V({ t: { f: [9999, -9999] } }).text.boxDelta.w === PANZA_MAX, 'perechea e plafonată pe fiecare axă');
ok(V({ t: { f: [0, 200] } }).text.boxDelta.h === 200, 'zero pe o axă e valid: crește doar cealaltă');
let perecheGoala = false;
try { V({ t: { f: [0, 0] } }); } catch { perecheGoala = true; }
ok(perecheGoala, 'o pereche de zerouri nu e o comandă');
ok(V({ text: { boxDelta: { w: 10, h: 20 } } }).text.boxDelta.h === 20, 'forma lungă a perechii trece la fel');
let deltaZero = false;
try { V({ t: { f: 0 } }); } catch { deltaZero = true; }
ok(deltaZero, 'o schimbare de 0px nu e o comandă — DSL gol');
// forma LUNGA, cea pe care o produce parserul local de rezerva
ok(V({ text: { bind: 'box', box: { w: 240, h: 0 } } }).text.box.w === 240, 'forma lungă „box" trece la fel');
ok(V({ text: { boxDelta: 30 } }).text.boxDelta === 30, 'forma lungă „boxDelta" trece la fel');
ok(V({ t: { s: [] }, n: ['o1'] }).target.join() === 'o1', 'n → target (id intern, tolerat)');
ok(V({ t: { s: [] }, n: [1] }).target[0] === 1, 'ținta poate fi un INDEX din scenă, ca într-un vector');
// Un numar e o FIGURA, „t1" e un TEXT: doua serii independente, ca „figura 1" sa
// insemne mereu a doua figura, oricate texte s-ar fi scris intre ele.
ok(V({ t: { s: [] }, n: ['t1'] }).target.join() === 't1', 'ținta poate fi un TEXT: "t1"');
ok(V({ t: { s: [] }, n: ['T2'] }).target.join() === 't2', 'majusculele se normalizează: T2 → t2');
ok(V({ t: { s: [] }, n: [0, 't1'] }).target.join() === '0,t1', 'figură și text în aceeași țintă');
ok(V({ t: { s: [] }, n: [0, 2] }).target.length === 2, 'mai mulți indici deodată');
ok(V({ t: { s: [] }, n: [99, 'HACK', 1] }).target.join() === '1', 'indici absurzi și gunoi sunt filtrați');
ok(V({ g: { o: 'r', w: 50, h: 50, p: [25, 25] }, y: 'ceva' }).why === 'ceva', 'y → why');
ok(V({ g: { o: 'r', w: 50, h: 50, m: [[100, 100], [500, 500]] } }).geom.cells.length === 2, 'm → cells, ca listă de perechi');
ok(V({ g: { o: 'r', w: 50, h: 50, p: [9999, 1] } }).geom.at === undefined, 'punct invalid în formă scurtă e ignorat');

let gol = false;
try { V({ geom: { op: 'inexistent' }, text: null }); } catch { gol = true; }
ok(gol, 'DSL complet gol aruncă eroare, nu ajunge în motor');
ok(V({ text: { scale: 1.4 } }).text.scale === 1.4, 'comandă doar de mărime e validă');
ok(V({ text: { set: ['MIAU'], bind: 'pieces', repeat: true } }).text.repeat === true, 'repeat trece');
ok(V({ text: { bind: 'corner', at: 'X', words: ['a', 2, -5] } }).text.words.join() === '2', 'indici invalizi filtrați');
ok(V({ text: { set: [] }, target: ['o1', 'HACK'] }).target.join() === 'o1', 'target: doar id-uri valide');

// ─────────────────────────────────────────────────────────── 8. rutarea pe agenți
console.log('\n=== 8. rutarea pe agenți ===');
const costAgenti = p2 => LLM.agenti(p2).reduce((a, ag) => a + est(LLM.promptAgent(ag, p2)), 0);
const DOMENII = ['geometrie', 'text', 'caseta'];
const totToti = DOMENII.reduce((a, d) => a + est(LLM.promptAgent(d)), 0);
console.log(`  toți agenții, cu tot: ${totToti} tokeni`);

for (const [prompt, asteptat] of [
  ['un dreptunghi 300x150 la (400,400)', ['geometrie']],
  ['imparte-l in 2', ['geometrie']],
  ['muta figura 1 in interiorul figurii 0', ['geometrie']],
  ['mareste dreptunghiul', ['geometrie']],
  ['sterge textul', ['text']],
  ['mareste textul', ['text']],
  ['scrie MIAU in fiecare', ['text']],
  ['pune textul pe latura de sus', ['text']],
  ['pune textul intr-o caseta', ['text', 'caseta']],
  ['mareste caseta cu 40 de pixeli', ['caseta']],
  ['micsoreaza chenarul cu 25 de pixeli', ['caseta']],
  ['micsoreaza panza la 250 pe 100', ['geometrie']],
]) {
  const ag = LLM.agenti(prompt);
  const n = costAgenti(prompt);
  const potrivit = asteptat.every(x => ag.includes(x)) && ag.length === asteptat.length;
  ok(potrivit && n < totToti, `"${prompt}" → [${ag.join('+')}] ${n} tok (${Math.round(100 * n / totToti)}%)`);
}

// verbele ambigue îi cheamă pe TOȚI: fiecare răspunde pentru domeniul lui
for (const prompt of ['mareste', 'muta la 400,400', 'fa-l mai mic']) {
  ok(LLM.agenti(prompt).length === DOMENII.length, `"${prompt}" e ambiguu → se cheamă toți agenții`);
}
ok(LLM.agenti('bla bla necunoscut').length === DOMENII.length,
   'prompt nerecunoscut → toți agenții (mai bine scump decât greșit)');

// o cerere de caseta NU mai plătește documentația celor opt legări ale tipografului
ok(costAgenti('mareste caseta cu 40 de pixeli') < est(LLM.promptAgent('text')),
   'o cerere de casetă costă mai puțin decât promptul întreg al tipografului');

// „o casetă de 300 pe 80" dă și ea două dimensiuni, dar nu cere nicio figură:
// fără excepția asta, cererea plătea degeaba și promptul geometrului
ok(!LLM.agenti('scrie SALUT intr-o caseta de 300 pe 80').includes('geometrie'),
   'cifrele unei casete nu cheamă degeaba agentul de geometrie');
ok(LLM.agenti('scrie SALUT intr-o caseta de 300 pe 80').includes('caseta'),
   'o cerere de casetă chiar ajunge la casetar');
ok(LLM.agenti('fa un dreptunghi de 300 pe 150').join() === 'geometrie',
   'aceleași cifre pe o figură cheamă în continuare geometrul');

// „textboxul" începe cu „text", dar nu e o cerere despre CE scrie textul. Fără
// excepție, „mărește textboxul" chema tipograful, care mărea corpul de literă.
for (const prompt of ['mareste textboxul cu 100 de pixeli', 'mareste text boxul cu 100']) {
  ok(LLM.agenti(prompt).join() === 'caseta', `"${prompt}" → doar casetarul`);
}
// substantivul poate sta la CAPĂTUL frazei, unde excepția de lângă verb nu-l vede
const tarziu = 'mareste cu 100 de pixeli pe lungime si latime textboxul';
ok(LLM.agenti(tarziu).join() === 'caseta',
   'substantivul de la capătul frazei ține geometria departe de cerere');
ok(!LLM.sectiuni(tarziu).includes('modifica'),
   'ramura de geometrie nu se mai aprinde pe o cerere de casetă');
// dar o cerere care numește ȘI o figură rămâne pe amândouă
ok(LLM.agenti('muta textul de pe figura 1 pe figura 0').includes('text'),
   'o cerere care numește și figura, și textul rămâne la tipograf');
ok(LLM.agenti('fa un patrat de 200 si scrie MIAU').includes('geometrie'),
   'o cerere mixtă cheamă în continuare geometrul');

// O cantitate strecurată între verb și substantiv rupea tiparul: „muta textul" era un
// literal, deci „muta TOT textul" nu aprindea `text-poz`. Tipograful primea doar ramura
// despre CE scrie textul, care n-are cum să exprime o mutare — răspundea gol, iar turul
// eșua cu „niciun agent nu a produs o comandă". Cererea nu făcea nimic și nici nu spunea de ce.
for (const cerere of ['muta tot textul sub figura 0', 'muta toate textele sub figura 0',
                      'muta tot scrisul in coltul din stanga jos',
                      'muta tot textul sub latura de jos a figurii 0']) {
  ok(LLM.sectiuni(cerere).includes('text-poz'), `"${cerere}" aprinde text-poz`);
  ok(LLM.agenti(cerere).join() === 'text', `"${cerere}" → doar tipograful, fără geometrie`);
}
// dar cantitatea nu are voie să fure cereri care chiar sunt despre figuri
ok(LLM.agenti('muta patratul sub figura 0').join() === 'geometrie',
   'un substantiv de figură lângă verb rămâne la geometru');
ok(LLM.agenti('mareste tot dreptunghiul').join() === 'geometrie',
   '„mărește tot dreptunghiul" e tot geometrie');

// ─────────────────────────────────── PRAGUL DE TOKENI
// Promptul de sistem e singurul loc din tot proiectul unde se cheltuiesc tokeni, iar
// el creşte pe nesimţite: fiecare regulă nouă pare ieftină luată singură. Pragurile de
// mai jos sunt un CONTRACT — dacă o schimbare le depăşeşte, testul pică şi spune pe ce
// caz, în loc ca preţul să se vadă abia pe factură.
//
// Cifrele sunt estimate, nu `countTokens`: un test nu are voie să cheme API-ul, iar ce
// se cere aici e un prag stabil şi comparabil între rulări. Estimatorul e însă CALIBRAT
// pe tokenizatorul real (vezi `CHR_PER_TOKEN` din TokenMeter.js): pe cele unsprezece
// cazuri de mai jos se abate cu -1.7% de la totalul măsurat şi cu cel mult 8% pe caz.
// Marja e ~5% peste estimat: strânsă cât să pice la un rând adăugat, largă cât să nu
// pice la o reformulare.
//
// Pragurile au fost rescrise odată cu estimatorul, în 2026-09-03. Cele vechi erau scrise
// într-o monedă cu 45% mai ieftină decât realitatea: „760" însemna de fapt 1130 de tokeni
// pe factură, iar testul trecea. Un contract în unităţi greşite nu e un contract.
console.log('\n--- pragul de tokeni pe ramură ---');
const PRAGURI = [
  // Crearea plăteşte şi exemplul de LANŢ — „un pătrat … şi un dreptunghi …" într-un
  // singur prompt. Fără el, un model mic nu emite niciodată lista şi capacitatea nu
  // există în practică. Măsurat cu tokenizatorul real: 103 tokeni, pentru operaţii care
  // altfel cereau două ture întregi.
  ['fa un dreptunghi de 300 pe 150 la 400,400', 'geometrie',             1090],
  ['imparte figura 0 in 3',                     'geometrie',              970],
  ['muta figura 1 la 400,400',                  'geometrie',              970],
  ['sterge textul',                             'text',                  1010],
  ['mareste textul',                            'text',                  1010],
  ['mareste caseta cu 40 de pixeli',            'caseta',                1145],
  ['pune textul pe latura de sus',              'text',                  2055],
  ['scrie MIAU in figura',                      'text',                  2055],
  ['pune textul intr-o caseta',                 'text+caseta',           2150],
  ['micsoreaza panza la 250 pe 100',            'geometrie',              830],
  ['ceva necunoscut',                           'geometrie+text+caseta', 4970],
];
for (const [cerere, agentiAsteptati, prag] of PRAGURI) {
  const ag = LLM.agenti(cerere);
  const cost = ag.reduce((a, d) => a + est(LLM.promptAgent(d, cerere)), 0);
  ok(ag.join('+') === agentiAsteptati,
     `"${cerere}" → [${ag.join('+')}]`);
  ok(cost <= prag, `  ...~${cost} tokeni, sub pragul de ${prag}`);
}
// Baza comună pleacă o dată PER AGENT chemat, deci fiecare rând din ea se plăteşte
// de până la trei ori. E locul unde un rând în plus costă cel mai mult.
const { COMUN } = await import('./dist/mastra/prompturi/comun.js');
ok(est(COMUN.join('\n')) <= 310,
   `baza comună: ~${est(COMUN.join('\n'))} tokeni, plătiţi de fiecare agent chemat`);

// izolarea domeniilor e impusă la validare, nu doar prin instrucțiuni
const geoCuText = V({ g: { o: 'r', w: 50, h: 50, p: [10, 10] }, t: { s: ['HACK'] } }, 'geometrie');
ok(geoCuText.geom && geoCuText.text === null,
   'agentul de geometrie nu poate emite text — câmpul e aruncat la validare');
const txtCuGeom = V({ g: { o: 'c' }, t: { s: ['OK'] } }, 'text');
ok(txtCuGeom.text && txtCuGeom.geom === null,
   'agentul de text nu poate emite geometrie');
const faraDomeniu = V({ g: { o: 'c' }, t: { s: ['OK'] } });
ok(faraDomeniu.geom && faraDomeniu.text,
   'fără domeniu, validarea rămâne permisivă — o folosește și parserul local');
// al treilea domeniu se izolează la fel
const doarText = V({ t: { s: ['X'], b: 'x', z: [300, 80] } }, 'text');
ok(doarText.text.set.join() === 'X' && doarText.text.bind === undefined,
   'cu domeniu „text", caseta nu e citită');
const doarCaseta = V({ t: { s: ['X'], b: 'x', z: [300, 80] } }, 'caseta');
ok(doarCaseta.text.bind === 'box' && doarCaseta.text.set === undefined,
   'cu domeniu „caseta", conținutul nu e citit');
ok(V({ t: { s: ['X'], b: 'x', z: [300, 80] } }).text.set.join() === 'X'
   && V({ t: { s: ['X'], b: 'x', z: [300, 80] } }).text.bind === 'box',
   'fără domeniu trec toate trei, iar caseta se topește în text');


// fiecare agent citeste DOAR campul lui: nu e o stergere la final, e cod lipsa
const geo = GEOMETRU, tip = TIPOGRAF;
ok(geo.citeste({ t: { s: ['ALFA'] } }) === null,
   'Geometru citește doar câmpul lui: ignoră complet un câmp de text');
ok(tip.citeste({ g: { o: 'r', w: 50, h: 50 } }) === null,
   'Tipograf citește doar câmpul lui: ignoră complet o operație de figură');
ok(geo.citeste({ g: { o: 's', n: 3 } }).into === 3, 'Geometru citește split');
ok(tip.citeste({ t: { b: 'i', s: ['X'] } }).bind === 'inside', 'Tipograf citește bind');

// --- casetarul: al treilea agent, cu domeniul lui
const cas = CASETAR;
ok(cas.citeste({ t: { s: ['ALFA'], b: 'i', k: 1.4 } }) === null,
   'Casetar ignoră complet conținutul și legările tipografului');
ok(cas.citeste({ g: { o: 'r', w: 50, h: 50 } }) === null, 'Casetar ignoră complet figurile');
ok(cas.citeste({ t: { b: 'x' } }).bind === 'box', 'Casetar citește b:x');
ok(cas.citeste({ t: { z: [300, 80] } }).box.w === 300, 'Casetar citește z');
ok(cas.citeste({ t: { f: 40 } }).boxDelta === 40, 'Casetar citește f');
// izolarea e COD LIPSA, nu un câmp șters la final
ok(tip.citeste({ t: { b: 'x' } }) === null,
   'Tipograf nu mai recunoaște caseta — a rămas fără cod pentru ea');
ok(tip.citeste({ t: { f: 40 } }) === null, 'Tipograf ignoră mărimea casetei');
ok(cas.numeRamuri.join(',') === 'caseta', 'Casetar își declară ramura');
ok(cas.camp === 'caseta' && tip.camp === 'text' && geo.camp === 'geom',
   'trei câmpuri diferite: doi agenți nu se pot suprascrie la combinare');
// routerul nu-l cunoaște pe nume, se uită la ramura declarată
ok(new Router([geo, tip, cas]).alege('mareste caseta cu 40 de pixeli')[0] === cas,
   'routerul alege casetarul după ramura lui, fără să-l știe pe nume');

// combinarea: „caseta" se topește în „text", și vine ULTIMA
const combCas = combina([
  { domeniu: 'text', chemat: true, camp: 'text',
    dsl: { geom: null, text: { set: ['ALFA'], bind: 'inside' }, why: 'text' }, usage: { in: 1, out: 1 } },
  { domeniu: 'caseta', chemat: true, camp: 'caseta',
    dsl: { geom: null, caseta: { bind: 'box', box: { w: 300, h: 0 } }, why: 'caseta' }, usage: { in: 1, out: 1 } },
]);
ok(combCas.dsl.text.set.join() === 'ALFA', 'conținutul vine de la tipograf');
ok(combCas.dsl.text.bind === 'box',
   'legarea vine de la casetar, chiar dacă tipograful a ghicit „inside"');
ok(combCas.dsl.text.box.w === 300, 'mărimea casetei trece prin combinare');
ok(combCas.dsl.caseta === undefined, 'câmpul „caseta" nu ajunge la motor — se topește în „text"');

// „nu e treaba mea" e un raspuns, nu o eroare
let aruncatGol = false;
try { geo.citesteRaspuns({ g: null, y: 'nimic' }); } catch (e) { aruncatGol = e.name === 'RaspunsGol'; }
ok(aruncatGol, 'un agent fără ce răspunde aruncă RaspunsGol, nu o eroare oarecare');

// routerul nu-i cunoaste pe agenti pe nume, se uita ce ramuri declara
ok(geo.numeRamuri.join(',') === 'creare,modifica,panza', 'Geometru își declară ramurile');
ok(tip.numeRamuri.join(',') === 'text-nou,text-poz', 'Tipograf își declară ramurile');
const r1 = new Router([geo, tip]);
ok(r1.alege('imparte-l in 2').length === 1 && r1.alege('imparte-l in 2')[0] === geo,
   'routerul alege agentul după ramura potrivită, nu după nume');
ok(new Router([geo]).alege('sterge textul').length === 1,
   'cu un singur agent în echipă, el primește tot — nu rămâne nimeni nechemat');

// combinarea: fiecare pune doar in campul lui
const comb = combina([
  { domeniu: 'geometrie', chemat: true, camp: 'geom',
    dsl: { geom: { op: 'rect' }, text: null, why: 'figura' }, usage: { in: 10, out: 2 } },
  { domeniu: 'text', chemat: true, camp: 'text',
    dsl: { geom: null, text: { bind: 'inside' }, why: 'text', target: [1] }, usage: { in: 20, out: 3 } },
]);
ok(comb.dsl.geom.op === 'rect' && comb.dsl.text.bind === 'inside', 'combinarea ia din fiecare agent domeniul lui');
ok(comb.dsl.target.join() === '1', 'ținta trece prin combinare');
ok(comb.usage.in === 30 && comb.usage.out === 5, 'consumul se adună peste agenți');
ok(comb.dsl.why === 'figura; text', 'motivele se lipesc');


// ── lantul de rezerve, acum construit pentru Mastra ───────────────────────────
// `providers.js` a plecat: nu mai scriem noi apelul catre Gemini sau Groq. Ce a ramas
// in mana noastra e ORDINEA — ce model se incearca, cu ce reglaje si cu cate
// reincercari — fiindca ea decide timpul simtit de om cand primul cade din cota.
//
// Ce NU se mai poate testa aici, fiindca nu mai exista: termenul scurt per candidat,
// pauza pe modelul epuizat si memoria raspunsurilor. Mastra alege modelul urmator dupa
// EROARE, nu dupa ceas.
{
  const cheiVechi = { g: process.env.GEMINI_API_KEY, q: process.env.GROQ_API_KEY };
  const olVechi = process.env.OLLAMA_MODEL, urlVechi = process.env.OLLAMA_URL;
  // fara Ollama in joc, lantul e doar cel cu chei — asa testul nu depinde de masina
  process.env.OLLAMA_REZERVA = '0';

  const idul = c => (typeof c.model === 'object' && c.model.id) || String(c.model);

  process.env.GEMINI_API_KEY = 'test';
  delete process.env.GROQ_API_KEY;
  const doarGemini = await lantModele();
  ok(doarGemini.every(c => idul(c).startsWith('google/')),
     'cu o singură cheie, toți candidații sunt la același provider');
  ok(idul(doarGemini[0]) === 'google/gemini-2.5-flash',
     'primul e cel mai rapid model măsurat, nu cel mai mare');
  ok(doarGemini.length === REZERVE.length,
     `toate rezervele Gemini intră în lanț: ${doarGemini.length}`);

  // cheia veche a proiectului merge mai departe: se trece explicit în configurația
  // modelului, deci nu trebuie redenumită în .env pentru routerul Mastra
  ok(doarGemini.every(c => c.model.apiKey === 'test'),
     'GEMINI_API_KEY ajunge la model fără să fie mutată în GOOGLE_API_KEY');

  process.env.GROQ_API_KEY = 'test';
  const amandoua = await lantModele();
  const ids = amandoua.map(idul);
  ok(ids[0].startsWith('google/') && ids.some(i => i.startsWith('groq/')),
     'cu două chei, lanțul trece la Groq după ce se termină modelele Gemini');
  ok(ids.findLastIndex(i => i.startsWith('google/')) < ids.findIndex(i => i.startsWith('groq/')),
     'toate rezervele Gemini se încearcă înaintea schimbării de provider');

  // gandirea oprita: masurat 892ms fata de 1512ms, pe acelasi raspuns
  const gandire = c => c.providerOptions && c.providerOptions.google
    && c.providerOptions.google.thinkingConfig.thinkingBudget;
  ok(gandire(amandoua[0]) === 0, 'primul model Gemini pornește cu gândirea oprită');
  ok(amandoua.filter(c => idul(c).startsWith('google/')).some(c => gandire(c) === undefined),
     'modelele care resping parametrul nu-l primesc degeaba');
  ok(!amandoua.some(c => idul(c).startsWith('groq/') && gandire(c) !== undefined),
     'reglajul e al Google, nu pleacă la ceilalți provideri');

  // Plafonul de ieșire e nesigur DOAR acolo unde gândirea merge și nu poate fi oprită:
  // tokenii ei se scad din același buget și taie JSON-ul în două. Măsurat: cu 120 de
  // tokeni și gândirea pornită au ieșit 96 de gânduri și un răspuns retezat la jumătate.
  // Ceilalți provideri nu gândesc, deci la ei plafonul e sigur fără niciun parametru.
  const google = amandoua.filter(c => idul(c).startsWith('google/'));
  ok(google.every(c => gandire(c) === 0
        ? c.modelSettings.maxOutputTokens === 200
        : c.modelSettings.maxOutputTokens === undefined),
     'la Google, plafonul de ieșire însoțește doar modelele cu gândirea oprită');
  ok(amandoua.filter(c => !idul(c).startsWith('google/'))
        .every(c => c.modelSettings.maxOutputTokens === 200),
     'la ceilalți provideri plafonul se pune oricum: acolo nu se gândește');
  ok(amandoua.every(c => c.modelSettings.temperature === 0),
     'temperatura 0 peste tot: același prompt dă același DSL');

  // „renunți repede cât timp mai ai pe cine cădea", cât se mai poate exprima
  ok(amandoua.slice(0, -1).every(c => c.maxRetries === 0),
     'niciun model nu se reîncearcă atâta timp cât lanțul are pe cine cădea');
  ok(amandoua[amandoua.length - 1].maxRetries > 0,
     'ultimul insistă — după el nu mai urmează nimeni');

  // Ollama, ultima rezervă — ȘI când există o cheie. Până la migrare cele două se
  // excludeau: modelul local intra în lanț doar când nu exista nicio cheie.
  delete process.env.OLLAMA_REZERVA;
  process.env.OLLAMA_MODEL = 'llama3.2';        // scurtcircuitează proba de rețea
  const cuLocal = await lantModele();
  const ultim = cuLocal[cuLocal.length - 1];
  ok(idul(ultim) === 'ollama/llama3.2', 'cu Ollama pornit, el încheie lanțul');
  ok(ultim.model.url.endsWith('/v1'),
     'intră ca model „compatibil OpenAI", cu adresa locală scrisă pe față');
  ok(cuLocal.filter(c => idul(c).startsWith('ollama/')).length === 1,
     '...o singură dată, nu câte una la fiecare provider');

  process.env.OLLAMA_REZERVA = '0';
  const stins = await lantModele();
  ok(!stins.some(c => idul(c).startsWith('ollama/')),
     'OLLAMA_REZERVA=0 îl scoate din lanț: se cade direct pe parserul local');

  // „oprit": proba pică, iar lanțul rămâne exact cum era. Memoria e ținută pe GAZDĂ,
  // deci un port mort e o gazdă nouă — testul nu depinde de ce rulează pe mașină.
  delete process.env.OLLAMA_REZERVA;
  delete process.env.OLLAMA_MODEL;
  process.env.OLLAMA_URL = 'http://127.0.0.1:1';        // nimeni nu ascultă acolo
  const t0 = Date.now();
  const faraLocal = await lantModele();
  const probaMs = Date.now() - t0;
  ok(!faraLocal.some(c => idul(c).startsWith('ollama/')),
     'fără Ollama, lanțul rămâne doar pe modelele cu cheie');
  ok(probaMs < 2000, `...iar proba nu ține cererea pe loc: ${probaMs}ms`);

  const t1 = Date.now();
  await lantModele();
  ok(Date.now() - t1 < 100, 'un Ollama absent nu se mai probează la fiecare cerere');

  // fără nicio cheie și fără model local, tăcerea trebuie să fie explicită
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  let faraNimic = false;
  try { await lantModele(); } catch { faraNimic = true; }
  ok(faraNimic, 'fără cheie și fără Ollama, lanțul spune limpede că nu are ce încerca');

  if (olVechi === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = olVechi;
  if (urlVechi === undefined) delete process.env.OLLAMA_URL; else process.env.OLLAMA_URL = urlVechi;
  if (cheiVechi.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = cheiVechi.g;
  if (cheiVechi.q === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = cheiVechi.q;
}

// ── schema pleacă la model, nu doar în proza promptului ───────────────────────
// Înainte, forma minificată trăia doar în documentația din prompt și în speranța că
// modelul o respectă. Acum e o schemă Zod trimisă API-ului ca JSON Schema.
{
  const chei = s => Object.keys(s.shape);
  ok(chei(IESIRE_GEOM).join(',') === 'g,n,y', 'geometrul cere exact g, n, y');
  ok(chei(IESIRE_TEXT).join(',') === 't,n,y', 'tipograful cere exact t, n, y');
  ok(chei(IESIRE_CASETA).join(',') === 't,n,y', 'casetarul cere exact t, n, y');
  ok(!chei(IESIRE_GEOM).includes('t'), 'schema geometrului nu are unde să pună text');
  ok(!chei(IESIRE_TEXT).includes('g'), 'schema tipografului nu are unde să pună o figură');

  // cheile sunt de UN caracter, ca DSL-ul minificat — asta se plătește în tokeni
  const scurte = s => chei(s).every(k => k.length === 1);
  ok(scurte(IESIRE_GEOM) && scurte(IESIRE_TEXT) && scurte(IESIRE_CASETA),
     'toate cheile de nivel înalt au un singur caracter');

  // schema chiar respinge ce nu e în domeniu, nu doar documentează
  ok(IESIRE_GEOM.safeParse({ g: { o: 'r', w: 50, h: 50 } }).success, 'o operație validă trece schema');
  ok(!IESIRE_GEOM.safeParse({ g: { o: 'poligon' } }).success,
     'o operație care nu există în domeniu e respinsă de schemă, înainte de citire');
  ok(IESIRE_GEOM.safeParse({ g: null }).success, '„nu e treaba mea" e un răspuns valid');
  ok(IESIRE_GEOM.safeParse({ g: [{ o: 'r', w: 1, h: 1 }, { o: 'c' }] }).success,
     'lista de pași trece: o cerere poate înșirui mai multe operații');
}

// ── memoria raspunsurilor ─────────────────────────────────────────────────────
// La temperatura 0, acelasi prompt pe aceeasi scena da acelasi DSL, deci a doua oara nu
// mai are rost cerut. Verificarea se face INAINTE de orice agent: un tur repetat nu
// construieste graful si nu atinge reteaua. Cheia trebuie sa prinda ORICE schimbare.
{
  MEM.uita();
  const stare = { noduri: [{ i: 0, nume: 'SQUARE', w: 150, h: 150, at: { x: 100, y: 250 } }],
                  texte: [], parent: {} };
  const alta  = { noduri: [{ i: 0, nume: 'PATRAT', w: 300, h: 300, at: { x: 100, y: 250 } }],
                  texte: [], parent: {} };
  const k = (p, st, doar) => MEM.cheie(p, LLM.buildUser(p, st), doar);

  ok(k('mareste', stare) === k('mareste', stare), 'aceeași cerere pe aceeași scenă dă aceeași cheie');
  ok(k('mareste', stare) !== k('mareste', alta), 'o figură de altă mărime e altă cheie');
  ok(k('mareste', stare) !== k('micsoreaza', stare), 'alt cuvânt în cerere e altă cheie');
  ok(k('mareste', stare) !== k('mareste', stare, 'panza'),
     'aceeași cerere din caseta pânzei e altă cheie: rutarea diferă, deci și răspunsul');

  // ordinea CONTEAZĂ: memoria taie înaintea agenților, nu după ei. Semănăm un răspuns
  // și cerem același tur — dacă ar chema agenții, ar da peste rețea și ar dura.
  const inventat = { dsl: { geom: { op: 'clear' }, text: null, why: 'inventat' },
                     agenti: ['geometrie'], sectiuni: ['modifica'], detalii: [],
                     provider: 'test', model: 'niciunul' };
  MEM.tineMinte(k('sterge tot', stare), inventat);
  const t0 = Date.now();
  const r = await LLM.askModel('sterge tot', stare);
  const ms = Date.now() - t0;
  ok(r.memorat === true, 'un tur repetat se raportează ca venit din memorie');
  ok(r.dsl.why === 'inventat', '...și chiar întoarce DSL-ul ținut minte, nu unul nou');
  ok(r.usage.in === 0 && r.usage.out === 0, '...cu consum ZERO: turul n-a costat niciun token');
  ok(r.incercari === 0, '...și fără nicio încercare: niciun agent nu a fost trezit');
  ok(ms < 100, `...instantaneu, fără rețea: ${ms}ms`);
  ok(r.model === 'niciunul' && r.provider === 'test',
     'providerul raportat e cel care a răspuns ATUNCI, nu cel activ acum');

  // plafonul: cele mai vechi ies primele
  MEM.uita();
  for (let i = 0; i < MEM.MEMORIE_MAX + 5; i++) MEM.tineMinte('k' + i, inventat);
  ok(MEM.cate() === MEM.MEMORIE_MAX, `memoria e plafonată la ${MEM.MEMORIE_MAX}`);
  ok(MEM.adu('k0') === undefined && MEM.adu('k' + (MEM.MEMORIE_MAX + 4)) !== undefined,
     'cele mai vechi intrări ies primele');

  // o intrare folosită din nou trece la coadă: nu iese doar fiindcă e veche
  MEM.uita();
  MEM.tineMinte('vechi', inventat);
  for (let i = 0; i < MEM.MEMORIE_MAX - 1; i++) MEM.tineMinte('n' + i, inventat);
  MEM.adu('vechi');
  MEM.tineMinte('inca-una', inventat);
  ok(MEM.adu('vechi') !== undefined,
     'o intrare cerută recent supraviețuiește: plafonul scoate ce nu se mai folosește');
  MEM.uita();
}

{
  // Schema e scrisă pe RAMURI

  // Schema e scrisă pe RAMURI, nu ca un obiect plat cu multe câmpuri opționale.
  // Măsurat pe gemini-2.5-flash: forma plată pierdea „h" și punctul și inventa
  // „x":false; discriminarea pe operație dă răspunsul corect. Testul ține forma.
  const ramuri = IESIRE_GEOM.shape.g.unwrap().options[0].options;
  ok(Array.isArray(ramuri) && ramuri.length === 6,
     `„g" e o uniune cu o ramură pe operație: ${ramuri.length} ramuri`);
  ok(IESIRE_GEOM.safeParse({ g: { o: 'c' } }).success,
     'o operație fără parametri rămâne validă: „șterge tot" nu cere dimensiuni');
  // ramura taierii n-are câmp de punct, deci un „p" strecurat nu supraviețuiește
  const taiere = IESIRE_GEOM.parse({ g: { o: 's', n: 3, d: 'v', p: [1, 2] } });
  ok(taiere.g.n === 3 && taiere.g.p === undefined,
     'un câmp din altă ramură e aruncat: fiecare operație are exact câmpurile ei');
  // iar o valoare de tip greșit chiar pică, nu e reparată în tăcere
  ok(!IESIRE_GEOM.safeParse({ g: { o: 'r', w: 'trei sute' } }).success,
     'o dimensiune scrisă în litere e respinsă de schemă');

  // Cine trimite schema la model e o CONSTATARE, nu o preferință: se pune abia după ce
  // forma a fost verificată pe modelul real. Vezi comentariul din agenti.ts.
  ok(GEOMETRU.schemaLaModel === true, 'geometria trimite schema: verificată pe Gemini');
  ok(TIPOGRAF.schemaLaModel === false && CASETAR.schemaLaModel === false,
     'textul și caseta merg pe prompt până când schema lor e verificată la fel');
}


// promptul fiecărui agent nu conține domeniul celorlalți
const promptGeo = LLM.promptAgent('geometrie');
const promptTxt = LLM.promptAgent('text');
const promptCas = LLM.promptAgent('caseta');
ok(!/"bind"|inside|pieces|corners/.test(promptGeo), 'promptul geometrului nu pomenește moduri de text');
ok(!/"o":"r"|"o":"s"|dreptunghi nou/.test(promptTxt), 'promptul tipografului nu pomenește operații de figuri');
ok(!/caset|chenar|"b":"x"/.test(promptTxt), 'promptul tipografului nu mai pomenește caseta — a plecat la agentul ei');
ok(!/"o":"r"|inside|pieces|latura/.test(promptCas), 'promptul casetarului nu pomenește nici figuri, nici legări de text');
ok(est(promptGeo) < totToti * 0.6 && est(promptTxt) < totToti * 0.7,
   `fiecare agent e mai mic decât suma: geometrie ${est(promptGeo)}, text ${est(promptTxt)}, caseta ${est(promptCas)}`);
ok(est(promptCas) < est(promptTxt),
   `casetarul rămâne mai ieftin decât tipograful: ${est(promptCas)} față de ${est(promptTxt)}`);


const state = {
  noduri: [{ i: 0, id: 'o1', nume: 'SQUARE', w: 150, h: 150, at: { x: 100, y: 250 } },
           { i: 1, id: 'o2', nume: 'DREPTUNGHI', w: 300, h: 150, at: { x: 500, y: 500 } }],
  texte: [{ i: 0, cuvinte: ['MIAU'], pe: 0, at: { x: 100, y: 250 }, sel: false },
          { i: 1, cuvinte: ['ALFA'], pe: null, at: { x: 400, y: 400 }, sel: false }],
  parent: { figuri: 2, texte: 2, obiecte: 3, selectate: [], panza: CANVAS_PX, celula: CELL },
};
const user = LLM.buildUser('mareste dreptunghiul', state);
ok(user.includes('#0') && user.includes('#1'), 'figurile sunt numerotate #0, #1 în starea trimisă');
// Doua serii independente: figurile isi au numerele lor, textele pe ale lor. Fara asta,
// „figura 1" insemna a doua figura doar daca nu s-a scris niciun text intre ele.
ok(user.includes('T0') && user.includes('T1'), 'textele au seria lor, T0, T1');
ok(/T0 MIAU pe #0/.test(user), 'un text scris pe o figură spune pe care stă');
ok(/T1 ALFA liber @400,400/.test(user), 'un text fără figură își dă poziția');
ok(!/#2/.test(user), 'textul liber NU consumă un număr de figură');
console.log('  --- ce pleacă efectiv spre model ---');
console.log(user.split('\n').map(l => '  ' + l).join('\n'));
ok(est(user) < 65, `descrierea stării: ${est(user)} tokeni pentru 2 figuri și 2 texte`);
ok(!user.includes('|'), 'codul de atribute NU pleacă spre model — e cheia catalogului, locală');

const c = TM.compare({
  prompt: 'mareste dreptunghiul', skeleton: CAT.skeleton(), flat: CAT.flatCatalog(),
  summary: user, dsl: { geom: { op: 'resize', scale: 1.5 } },
  scene: { edges: drept.toEdges(), words: [] }, canvas: CANVAS,
});
ok(c.tree.in + c.tree.out < c.flat.in + c.flat.out, 'atribute < catalog plat');
ok(c.tree.in + c.tree.out < c.vision.in + c.vision.out, 'atribute < vision');


// ── parserul local nu are voie sa emita operatii pe care motorul nu le stie ────
// Bug real: rezerva a ramas in urma si emitea {"op":"polygon"}. DSL-ul arata
// plauzibil, se afisa in interfata si NU se aplica nimic. Un refuz e mai bun.
const CORPUS = [
  'fa un patrat de 300 la 400,400',
  'fa un dreptunghi de 300 pe 150',
  'un patrat de 50 cu coltul stanga jos in punctul 25,25',
  'imparte in 2',
  'imparte figura in 3 dreptunghiuri pe orizontala',
  'mareste',
  'micsoreaza figura',
  'dubleaza figura',
  'muta la 400,400',
  'goleste scena',
  'scrie MIAU',
  'scrie MIAU in figura',
  'scrie ALFA pe latura de sus',
  'scrie JOS sub latura de sus',
  'scrie X in colturi',
  'pune textul pe contur',
  'scrie ALFA pe fiecare latura',
  'sterge textul',
  'mareste textul',
  'micsoreaza textul',
  'scrie BETA in loc de text',
];

let emise = 0, respinse = 0;
for (const prompt of CORPUS) {
  const d = PP.parse(prompt);
  if (d.error) { respinse++; continue; }
  emise++;
  let acceptat = true, motiv = '';
  try { V(d); } catch (e) { acceptat = false; motiv = e.message; }
  ok(acceptat, `local: "${prompt}" → ${JSON.stringify(d.geom || d.text)}${acceptat ? '' : '  RESPINS: ' + motiv}`);

  // validarea nu are voie sa arunce campuri: ce a emis parserul chiar ajunge in motor
  if (acceptat) {
    const v = V(d);
    if (d.geom) ok(v.geom && v.geom.op === d.geom.op, `  ...op-ul "${d.geom.op}" supraviețuiește validării`);
    if (d.text) ok(v.text !== null, '  ...comanda de text supraviețuiește validării');
  }
}
ok(emise >= 18, `parserul local recunoaște ${emise} din ${CORPUS.length} forme uzuale`);

// cazurile de text care lipseau din rezerva — au aparut fiindca modelul a picat
// exact pe ele si utilizatorul a vazut „nu am recunoscut nicio operatie"
const LOCAL_TEXT = [
  ['muta textul in punctul de coordonate 325, 325', { bind: 'point', at: { x: 325, y: 325 } }],
  ['muta textul in punctul 325,325', { bind: 'point', at: { x: 325, y: 325 } }],
  ['muta scrisul la 325 325', { bind: 'point', at: { x: 325, y: 325 } }],
  ['scrie ALFA in punctul 150,650', { set: ['ALFA'], bind: 'point', at: { x: 150, y: 650 } }],
  ['muta textul de pe figura 1 pe figura 0', { to: 0 }],
  ['muta textul de pe figura 1 in interiorul figurii 0', { to: 0, bind: 'inside' }],
  // Intre prepozitie si figura pot sta cuvinte. Cu ele lipite, „sub LATURA INFERIOARA A
  // figurii 1" pierdea destinatia si textul ramanea pe figura lui, asezat fata de ea.
  ['muta textul sub latura inferioara a figurii 1', { to: 1, bind: 'side', at: 'bottom' }],
  // Interiorul și exteriorul unei laturi, cerute pe față. Substantivul se potrivește ca
  // `latur\w*`, altfel genitivul „laturii" nu era prins deloc, iar „deasupra laturii de
  // jos" cădea pe alternativa `deasupra` — adică latura de SUS, exact opusul cererii.
  ['pune textul in interiorul laturii de sus', { bind: 'side', at: 'top', in: true }],
  ['pune textul in exteriorul laturii de sus', { bind: 'side', at: 'top' }],
  ['pune textul in interiorul laturii din stanga', { bind: 'side', at: 'left', in: true }],
  ['pune textul in exteriorul laturii din dreapta', { bind: 'side', at: 'right' }],
  // conținutul se taie acolo unde începe poziția: doar „JOS" e text, restul e unde
  ['scrie JOS inauntrul laturii inferioare', { set: ['JOS'], bind: 'side', at: 'bottom', in: true }],
  ['pune textul deasupra laturii de jos', { bind: 'side', at: 'bottom', in: true }],
  ['pune textul sub latura de jos', { bind: 'side', at: 'bottom' }],
  ['pune textul sub latura de sus', { bind: 'side', at: 'top', in: true }],
  ['pune textul sub figura', { bind: 'side', at: 'bottom' }],
  ['muta al doilea text sub latura de jos a figurii 1', { to: 1, bind: 'side', at: 'bottom' }],
  ['muta textul de pe figura 3 sub latura de jos a figurii 1', { to: 1, bind: 'side', at: 'bottom' }],
  ['muta textul in coltul din stanga sus al figurii 2', { to: 2, bind: 'corner', at: 'tl' }],
  ['scrie si BETA', { add: ['BETA'] }],
  ['muta primele doua cuvinte in stanga jos', { words: [0, 1], bind: 'corner', at: 'bl' }],
  ['scrie X in coltul din dreapta sus', { set: ['X'], bind: 'corner', at: 'tr' }],
  ['pune textul intr-o caseta', { bind: 'box' }],
  ['scrie SALUT LUME intr-o caseta', { set: ['SALUT', 'LUME'], bind: 'box' }],
  ['scrie SALUT LUME intr-o caseta de 300 pe 80', { bind: 'box', box: { w: 300, h: 80 } }],
  ['pune textul intr-un chenar de 240', { bind: 'box', box: { w: 240, h: 0 } }],
  ['mareste caseta cu 40 de pixeli', { boxDelta: 40 }],
  ['micsoreaza caseta cu 25 de pixeli', { boxDelta: -25 }],
  ['mareste chenarul cu 60', { boxDelta: 60 }],
  ['mareste textboxul cu 100 de pixeli', { boxDelta: 100 }],
  ['mareste cu 100 de pixeli pe lungime si latime textboxul', { boxDelta: 100 }],
  ['rescrie textul ca PISICA', { set: ['PISICA'] }],
  ['rescrie MIAU cu PISICA', { set: ['PISICA'] }],
  ['rescrie PISICA', { set: ['PISICA'] }],
  ['mareste textboxul cu 50x200', { boxDelta: { w: 50, h: 200 } }],
  ['mareste caseta cu 50 pe 200', { boxDelta: { w: 50, h: 200 } }],
  ['mareste caseta cu 30 pe latime si 100 pe inaltime', { boxDelta: { w: 30, h: 100 } }],
  ['micsoreaza caseta cu 20x40', { boxDelta: { w: -20, h: -40 } }],
];
for (const [prompt, astept] of LOCAL_TEXT) {
  const d = PP.parse(prompt);
  const potrivit = d.text && Object.entries(astept)
    .every(([k, v]) => JSON.stringify(d.text[k]) === JSON.stringify(v));
  ok(potrivit, `local: "${prompt}" → ${JSON.stringify(d.text)}`);
  if (potrivit) { let bun = true; try { V(d); } catch { bun = false; } ok(bun, '  ...trece de validare'); }
}

// „de pe figura 1" e SURSA, nu destinatia
ok(PP.parse('muta textul de pe figura 1 pe figura 0').text.to === 0,
   'sursa („de pe figura 1") nu e confundată cu destinația');

// o cerere de figura nu produce si o comanda de text
ok(PP.parse('fa un patrat de 50 cu coltul stanga jos in punctul 25,25').text === null,
   'ancora unei figuri nu devine poziție de text');
ok(PP.parse('fa un dreptunghi de 300 pe 150 la 400,400').text === null,
   'crearea unei figuri nu atinge textul');

// „mărește caseta" e o cerere de text: n-are voie să atingă figura
ok(PP.parse('mareste caseta cu 40 de pixeli').geom === null,
   '„mărește caseta" nu redimensionează figura');
ok(PP.parse('mareste caseta cu 40 de pixeli').text.scale === undefined,
   '„mărește caseta" nu mărește nici corpul de literă — doar ambalajul');
ok(PP.parse('mareste textboxul cu 100 de pixeli').text.scale === undefined,
   '„mărește textboxul" nu ajunge o mărire de font — creșterea vine din raportul casetei');
ok(PP.parse('mareste textul').text.scale === 1.4,
   '„mărește textul", fără casetă, chiar mărește corpul de literă');
// o cerere de redimensionare nu re-leagă textul, altfel ar reseta lățimea de acum
ok(PP.parse('mareste caseta cu 40 de pixeli').text.bind === undefined,
   'redimensionarea casetei nu rescrie legarea, deci nu pierde lățimea');
ok(!/caseta|chenar|intr/i.test(String(PP.parse('pune textul intr-o caseta').text.set)),
   'cuvintele care descriu caseta nu ajung conținut de scris');

// „rescrie" nu începe cu „scrie", deci tiparul vechi nu-l prindea deloc
ok(PP.parse('rescrie textul in coltul din dreapta sus').text.bind === 'corner',
   '„rescrie ... în colț" e o mutare, nu cuvântul „COLȚUL" scris pe pânză');
ok(PP.parse('rescrie textul in coltul din dreapta sus').text.set === undefined,
   'o poziție capturată după „rescrie" nu devine conținut');
let rescrieGol = false;
try { V(PP.parse('rescrie textul')); } catch { rescrieGol = true; }
ok(rescrieGol, '„rescrie textul", fără să spună ce, e refuzat — nu inventează un cuvânt');

// ce nu intelege, refuza EXPLICIT — nu inventeaza
ok(PP.parse('transforma in forma de L').error, 'ce nu recunoaște întoarce eroare, nu un DSL inaplicabil');
ok(PP.parse('fa un patrat').error, 'o figură fără dimensiune e refuzată, nu desenată la nimereală');
ok(!/polygon|rhombus|trapezoid|unfold|regroup|digits/.test(JSON.stringify(CORPUS.map(x => PP.parse(x)))),
   'nicio urmă din DSL-ul vechi (polygon, rhombus, unfold...)');

// verbele prin care cererea cere limpede ÎNLOCUIREA, nu adăugarea.
// Lista prea scurtă a costat: „rescrie textul ca PISICA" nu era pe ea, deci plasa
// transforma înlocuirea în adăugare și vechiul text rămânea pe pânză, sub cel nou.
for (const cere of ['scrie PISICA in loc de MIAU', 'inlocuieste textul cu PISICA',
                    'rescrie textul ca PISICA', 'rescrie MIAU cu PISICA',
                    'modifica textul in PISICA', 'schimba textul in PISICA',
                    'corecteaza textul in PISICA', 'sterge textul si scrie PISICA']) {
  ok(PP.cereInlocuire(cere), `"${cere}" e recunoscută ca înlocuire`);
}
for (const adauga of ['scrie si BETA', 'mai scrie BETA', 'adauga textul BETA']) {
  ok(!PP.cereInlocuire(adauga), `"${adauga}" NU e înlocuire — textul vechi rămâne`);
}

// ─────────────────────────────────────────────────────────── 9. parserul local
console.log('\n=== 9. parserul local de rezervă ===');
for (const [prompt, op] of [
  ['imparte in 2 dreptunghiuri', 'split'],
  ['sterge textul', null],
]) {
  const d = PP.parse(prompt);
  ok(d.geom?.op === op || (op === null && d.text), `"${prompt}" → ${JSON.stringify(d)}`);
}
ok(PP.parse('ceva complet necunoscut xyz').error, 'ce nu se recunoaște întoarce eroare, nu ghicește');

// Textele au seria lor, deci si rezerva locala trebuie sa tinteasca unul singur —
// altfel „mareste textul 1" ar fi marit toate textele obiectului, spre deosebire de
// ce face modelul pe aceeasi cerere.
for (const [prompt, tinta] of [
  ['mareste textul 1', 't1'],
  ['muta textul 0 in coltul din stanga jos', 't0'],
  ['muta al doilea text sub latura de jos a figurii 1', 't1'],
]) {
  ok(PP.parse(prompt).target?.join() === tinta, `local: "${prompt}" țintește ${tinta}`);
}
ok(PP.parse('mareste textul').target === undefined, '„mărește textul", fără număr, nu țintește niciun text anume');

// ─────────────────────────────────────────────────────────── 10. App
console.log('\n=== 10. App: țintirea textelor și mutarea între figuri ===');

// App atinge DOM-ul, deci are nevoie de un schelet: un canvas inert și un fetch care
// întoarce DSL-ul dat. Restul e logica reală — aici au apărut defectele care se vedeau
// doar la rulare: textul mutat care rămânea pe loc, și cel duplicat.
{
  const nimic = () => {};
  const ctxApp = new Proxy({
    font: '',
    measureText(t) {
      const f = String(this.font); const i = f.indexOf('px');
      let px = 17;
      if (i > 0) { const n = parseFloat(f.slice(0, i).split(' ').pop()); if (n > 0) px = n; }
      return { width: String(t).length * px * 0.55 };
    },
  }, { get: (o, k) => (k in o ? o[k] : nimic), set: (o, k, v) => (o[k] = v, true) });

  const canvas = { style: {}, addEventListener: nimic, getContext: () => ctxApp,
                   getBoundingClientRect: () => ({ left: 0, top: 0 }), width: 0, height: 0 };
  globalThis.document = { getElementById: id => (id === 'canvas' ? canvas : null) };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = nimic;
  globalThis.performance = globalThis.performance || { now: () => 0 };

  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['text'] }),
  });

  const { App } = await import(B + 'core/App.js');
  const app = new App();
  const ruleaza = async (prompt, dsl) => { DSL = dsl; await app.run(prompt); };
  const texte = () => app.payload().texte
    .map(t => `T${t.i}[${t.cuvinte.join(' ')}]${t.pe !== null ? '@#' + t.pe : '@liber'}`).join(' ');
  const cuvinte = () => app.scena.obiecte.map(o => o.stream.words.join(',')).join(' | ');
  const rect = (w, h, x, y) => ({ geom: { op: 'rect', w, h, at: { x, y } }, text: null });

  // seriile sunt independente: figurile se numără între figuri, textele între texte
  await ruleaza('scrie ALFA', { geom: null, text: { set: ['ALFA'], bind: 'inside' } });
  await ruleaza('fa un dreptunghi', rect(300, 150, 200, 600));
  ok(app.payload().noduri.length === 1 && app.payload().texte.length === 1,
     'un text liber nu consumă un număr de figură: 1 figură, 1 text');
  ok(!app.selectie.size, 'nici figura, nici textul nou nu rămân selectate');

  await ruleaza('fa un patrat', rect(200, 200, 600, 250));
  await ruleaza('scrie BETA in patrat', { geom: null, text: { set: ['BETA'], bind: 'inside' }, target: [1] });
  await ruleaza('scrie si GAMA in patrat', { geom: null, text: { add: ['GAMA'], bind: 'inside' }, target: [1] });
  ok(texte() === 'T0[ALFA]@liber T1[BETA]@#1 T2[GAMA]@#1',
     `fiecare text scris își primește numărul: ${texte()}`);

  // Textul era deja pe figura cerută, deci nu se transfera nimic — iar comanda ieșea
  // fără să aplice legarea, raportând totuși „text mutat".
  await ruleaza('muta textul 1 sub latura de jos a figurii 1',
                { geom: null, text: { bind: 'side', at: 'bottom', to: 1 }, target: ['t1'] });
  const patrat = app.scena.obiecte.find(o => o.stream.words.includes('BETA'));
  ok(patrat.binds[0] && patrat.binds[0].bind === 'side' && patrat.binds[0].at === 'bottom',
     'text deja pe figura țintă: se reașază, nu se ignoră');
  ok(patrat.binds[1] === 'inside', 'iar textul vecin de pe aceeași figură rămâne neatins');

  // Două texte de pe ACELAȘI obiect dădeau două intrări pentru el, iar a doua citea
  // indici socotiți înainte ca prima să-și scoată cuvintele: un text rămânea pe loc
  // și la destinație ajungea „undefined".
  await ruleaza('muta tot textul sub figura 0',
                { geom: null, text: { bind: 'side', at: 'bottom', to: 0 }, target: ['t1', 't2'] });
  ok(!cuvinte().includes('undefined'), `niciun cuvânt fantomă la destinație: ${cuvinte()}`);
  const peDrept = app.payload().texte.filter(t => t.pe === 0).flatMap(t => t.cuvinte);
  ok(peDrept.join(',') === 'BETA,GAMA', `ambele texte ajung pe #0: ${peDrept.join(',')}`);
  ok(app.payload().texte.every(t => t.pe !== 1), 'niciunul nu rămâne pe figura de plecare');

  // Animația interpolează pe CHEIA cuvântului. Cu id-ul obiectului în cheie, un text
  // mutat pe altă figură primea cheie nouă: vechiul cuvânt dispărea, unul nou creștea
  // în locul lui — o clipire, nu o tranziție. Cheia e acum textul plus rangul în el,
  // iar amândouă călătoresc cu textul.
  await ruleaza('fa inca un patrat', rect(150, 150, 400, 150));
  await ruleaza('scrie DELTA in patratul nou', { geom: null, text: { set: ['DELTA'], bind: 'inside' }, target: [2] });
  const cheiaInainte = app.scene.words.filter(w => w.text === 'DELTA').map(w => w.i);
  const undeInainte = app.scene.words.find(w => w.text === 'DELTA');
  await ruleaza('muta textul pe figura 0', {
    geom: null,
    text: { bind: 'side', at: 'bottom', to: 0 },
    target: ['t' + app.payload().texte.find(t => t.cuvinte.includes('DELTA')).i],
  });
  const dupa = app.scene.words.find(w => w.text === 'DELTA');
  ok(dupa && cheiaInainte[0] === dupa.i,
     `cuvântul mutat își păstrează cheia de animație (${cheiaInainte[0]}) — glisează, nu clipește`);
  ok(dupa && (Math.round(dupa.x) !== Math.round(undeInainte.x)
           || Math.round(dupa.y) !== Math.round(undeInainte.y)),
     'dar chiar și-a schimbat poziția, deci e ce interpolează animația');
  ok(!app.anim.ghostKeys.some(k => k.startsWith('w' + cheiaInainte[0] + '.')),
     'nu se naște nicio fantomă pentru cuvântul mutat');

  // Un text NOU fără țintă nu se multiplică. Cu mai multe figuri pe pânză, „scrie
  // OMEGA" punea același cuvânt în mijlocul fiecăreia, deși cererea cerea UN text.
  const cateFiguri = app.payload().noduri.length;
  ok(cateFiguri > 1, `pânza are ${cateFiguri} figuri, deci comanda fără țintă ar cădea pe toate`);
  await ruleaza('scrie OMEGA', { geom: null, text: { set: ['OMEGA'], bind: 'inside' } });
  const peOmega = app.scena.obiecte.filter(o => o.stream.words.includes('OMEGA'));
  ok(peOmega.length === 1, `un singur text nou, nu câte unul pe fiecare figură: ${peOmega.length}`);
  const omega = app.payload().texte.filter(t => t.cuvinte.includes('OMEGA'));
  ok(omega.length === 1 && omega[0].pe === null,
     `textul nou își primește numărul lui, ca obiect propriu: T${omega[0] && omega[0].i} liber`);
  ok(!app.figuri().some(o => o.stream.words.includes('OMEGA')),
     'și nu s-a agățat de nicio figură');

  // …dar cererea care cere pe față copierea o primește: „în fiecare" e chiar semnul
  // pe care promptul agenților îl leagă de „nu ținti nimic".
  await ruleaza('scrie ZETA in fiecare figura', { geom: null, text: { add: ['ZETA'], bind: 'inside' } });
  ok(app.scena.obiecte.filter(o => o.stream.words.includes('ZETA')).length > 1,
     '„în fiecare" copiază în continuare pe toate obiectele');
}

// Caseta e un AMBALAJ: se strânge în jurul textului, acolo unde e. Cerută pe un text
// care există deja, NU e o cerere de mutare. Până acum așezătorul era chemat la orice
// schimbare de legare, deci „textbox miau" teleporta textul în cea mai goală parte a
// pânzei, cu casetă cu tot — iar caseta apărea oriunde, numai în jurul textului nu.
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['caseta'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl) => { DSL = dsl; await app.run(prompt); };
  const unde = text => {
    const w = app.scene.words.find(x => x.text === text);
    return w ? { x: Math.round(w.x), y: Math.round(w.y) } : null;
  };

  await ruleaza('scrie ALFA', { geom: null, text: { set: ['ALFA'], bind: 'inside' } });
  await ruleaza('scrie MIAU', { geom: null, text: { set: ['MIAU'], bind: 'inside' } });
  const inainte = unde('MIAU');
  ok(inainte && (inainte.x !== 400 || inainte.y !== 400),
     `al doilea text a fost așezat în altă parte (@${inainte.x},${inainte.y})`);

  // „textbox miau": routerul cheamă DOAR casetarul, care emite {"t":{"b":"x"}} — o
  // legare, fără niciun conținut. Nimic din cerere nu spune „mută".
  await ruleaza('textbox miau', { geom: null, text: { bind: 'box' }, target: ['t1'] });
  const dupa = unde('MIAU');
  ok(dupa && dupa.x === inainte.x && dupa.y === inainte.y,
     `caseta nu mută textul: @${dupa.x},${dupa.y}, exact unde era`);

  ok(app.scene.casete.length === 1, 'a apărut exact o casetă, pe textul țintit');
  const cutie = app.scene.casete[0];
  ok(Math.abs(cutie.x + cutie.w / 2 - dupa.x) < 1 && Math.abs(cutie.y + cutie.h / 2 - dupa.y) < 1,
     'și e centrată pe text — se strânge în jurul lui');
  ok(cutie.x <= dupa.x && dupa.x <= cutie.x + cutie.w
     && cutie.y <= dupa.y && dupa.y <= cutie.y + cutie.h,
     'textul chiar cade ÎNĂUNTRUL casetei desenate');
  ok(JSON.stringify(unde('ALFA')) === JSON.stringify({ x: 400, y: 400 }),
     'iar textul vecin a rămas neatins');

  // o cerere care ADUCE cuvinte cheamă în continuare așezătorul: textul nou are
  // nevoie de un loc, cel vechi nu
  await ruleaza('scrie BETA intr-o caseta',
                { geom: null, text: { set: ['BETA'], bind: 'box' } });
  const beta = unde('BETA');
  ok(beta && (beta.x !== dupa.x || beta.y !== dupa.y),
     `un text NOU în casetă își primește locul lui (@${beta.x},${beta.y})`);
}

// ─────────────────────────────────────────────────────────── 11. pânza cu gabarit variabil
console.log('\n=== 11. pânza: gabarit variabil și restrângerea în cadru ===');

// PASUL 2 — validarea: modelul emite intenția, atât. Cifrele absurde se plafonează
// înainte să atingă motorul.
{
  const cv = V({ g: { o: 'p', w: 250, h: 100 } }, 'geometrie');
  ok(cv.geom.op === 'canvas_resize' && cv.geom.w === 250 && cv.geom.h === 100,
     'forma scurtă {"o":"p"} → canvas_resize 250x100');
  ok(V({ g: { op: 'canvas_resize', w: 300, h: 300 } }, 'geometrie').geom.op === 'canvas_resize',
     'și forma lungă trece prin același validator');
  const absurd = V({ g: { o: 'p', w: 99999, h: -5 } }, 'geometrie').geom;
  ok(absurd.w === PANZA_MAX && absurd.h === 1,
     `dimensiunile absurde se plafonează la validare: ${absurd.w}x${absurd.h}`);
  ok(V({ g: { o: 'p' } }, 'geometrie').geom.w === undefined,
     'fără dimensiuni nu se inventează una: motorul cere mărimea');
}

// PASUL 1 — rutarea: o cerere despre pânză nu plătește nimic pentru figuri, și invers.
// Pânza și-a primit RAMURA ei tocmai din motivul ăsta: în „modifica" urca ramura de la
// 667 la 719 de tokeni, plătiți la fiecare mutare sau tăiere.
ok(LLM.agenti('micsoreaza panza la 250 pe 100').join() === 'geometrie',
   'o cerere despre pânză cheamă doar geometrul');
ok(LLM.sectiuni('micsoreaza panza la 250 pe 100').join() === 'panza',
   '...și doar ramura ei: nici creare, nici modificare');
ok(LLM.sectiuni('fa panza 400 pe 400').join() === 'panza',
   '„fa panza 400 pe 400" nu aprinde crearea de figuri, deși începe cu „fa"');
ok(!LLM.sectiuni('imparte figura 0 in 3').includes('panza'),
   'invers, o tăiere de figură nu plătește documentația pânzei');
ok(LLM.sectiuni('goleste scena').includes('modifica'),
   '„goleste scena" rămâne o cerere de clear: „scena" nu taie ramura de modificare');

// rezerva locală, pentru când modelul tace
ok(JSON.stringify(PP.parse('micsoreaza panza la 250 pe 100').geom)
   === JSON.stringify({ op: 'canvas_resize', w: 250, h: 100 }),
   'parserul local recunoaște și el cererea');
ok(PP.parse('fa panza 400 pe 400').geom.op === 'canvas_resize',
   '„fa panza 400 pe 400" nu mai e citit ca o figură de 400x400');
ok(PP.parse('mareste panza').error, 'fără mărime, rezerva spune limpede că nu știe cât');

// „canvas" e cuvântul pe care îl scrie lumea, nu „pânză" — și lipsea din vocabular.
// Cererea nimerea ruta de CREARE, deci modelul nici nu primea operația, iar rezerva
// locală o citea ca pe o micșorare a FIGURILOR: `{"op":"resize","scale":0.5}`.
for (const cerere of ['micsoreaza canvasul la 250 pe 100', 'fa canvas ul 400 pe 300',
                      'schimba dimensiunea canvasului la 500x500']) {
  ok(LLM.sectiuni(cerere).join() === 'panza', `"${cerere}" → ramura pânzei`);
  ok(PP.parse(cerere).geom.op === 'canvas_resize', '   ...și rezerva locală citește canvas_resize');
}

// PASUL 4 — matematica restrângerii, luată singură. Doar translație: nicio lungime
// nu se atinge, deci invariantul nu are cum să se miște.
{
  const mica = { w: 250, h: 100, pad: 6 };
  const deasupra = { minX: 20, maxX: 120, minY: -140, maxY: -80 };
  const d = restrange(deasupra, mica);
  ok(d.dy === 6 - deasupra.minY && d.dx === 0,
     `ce iese pe sus se coboară cu ${d.dy}px, fără nicio mișcare pe x`);
  const dreapta = restrange({ minX: 300, maxX: 380, minY: 20, maxY: 60 }, mica);
  ok(dreapta.dx === 250 - 6 - 380 && dreapta.dy === 0, 'ce iese pe dreapta se trage la stânga');
  ok(restrange({ minX: 20, maxX: 120, minY: 20, maxY: 80 }, mica).dy === 0,
     'ce încape deja nu se mișcă');
  ok(restrange({ minX: -50, maxX: 400, minY: 10, maxY: 50 }, mica).dx === 0,
     'ce e mai lat decât pânza nu se translatează: acolo se ocupă scale-shape');
}

// PAȘII 3-6 — fluxul întreg, prin App: gabarit nou, obiectele reașezate, textul după ele.
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['geometrie'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl) => { DSL = dsl; await app.run(prompt); };
  const centru = i => app.payload().noduri[i].at;
  const sigma = () => app.scena.obiecte.map(o => Math.round(o.figure.totalLength()));
  const gabarit = i => {
    const b = app.figuri()[i].figure.bbox();
    return { w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY) };
  };

  await ruleaza('fa un dreptunghi de 100 pe 60 la 60,40',
                { geom: { op: 'rect', w: 100, h: 60, at: { x: 60, y: 40 } }, text: null });
  await ruleaza('fa un patrat de 80 la 400,600',
                { geom: { op: 'rect', w: 80, h: 80, at: { x: 400, y: 600 } }, text: null });
  await ruleaza('scrie SUS in patrat',
                { geom: null, text: { set: ['SUS'], bind: 'inside' }, target: [1] });

  const josInainte = { ...centru(0) };
  const latInainte = { ...gabarit(0) };
  const lungimiInainte = sigma();
  const textInainte = app.scene.words.find(w => w.text === 'SUS');
  const instantaneu = app.scena.snapshot();

  // `requestAnimationFrame` e inert în teste, deci niciun cadru n-a fost desenat până
  // acum și canalele animației au rămas la starea de la pornire. Un desen INSTANT le
  // aduce la zi, ca animația următoare să pornească de unde se vede chiar acum.
  app.draw(true);

  await ruleaza('micsoreaza panza la 250 pe 100',
                { geom: { op: 'canvas_resize', w: 250, h: 100 }, text: null });

  // pasul 3: gabaritul chiar s-a schimbat
  ok(SC.panza.w === 250 && SC.panza.h === 100, `pânza e acum ${SC.panza.w}x${SC.panza.h}`);

  // Elementul de desen NU sare la mărimea nouă: gabaritul pânzei e un canal de
  // animație, ca pozițiile. Aici împingem animația cu mâna, cadru cu cadru, fiindcă
  // `requestAnimationFrame` e inert în teste.
  const idFig = app.figuri()[0].id;
  const cadre = [];
  const original = app.anim.onFrame;
  app.anim.onFrame = s => { cadre.push(s); original(s); };

  app.anim.tick(app.anim.t0 + app.anim.duration / 2);
  ok(app.renderer.w > 250 && app.renderer.w < CANVAS_PX,
     `la jumătatea animației elementul e pe drum, nu la capăt: ${app.renderer.w}px`);

  // Proprietatea care face tranziția să pară un singur obiect care se strânge:
  // pos(t) = pos_vechi·(1 + (k-1)t) și W(t) = W_vechi·(1 + (k-1)t) — ACELAȘI factor,
  // deci raportul figură/pânză e neschimbat în TOATE cadrele, nu doar la capete.
  const raport = cadru => {
    const E = cadru.edges.filter(e => !e.ghost && e.obj === idFig);
    const xs = E.flatMap(e => [e.x1, e.x2]);
    return (Math.max(...xs) - Math.min(...xs)) / cadru.panza.w;
  };
  const laMijloc = raport(cadre[cadre.length - 1]);

  app.anim.tick(app.anim.t0 + 99999);
  ok(app.renderer.w === 250 && app.renderer.h === 100,
     'iar la capăt zona de desen s-a strâns odată cu pânza');
  const laCapat = raport(cadre[cadre.length - 1]);
  ok(Math.abs(laMijloc - laCapat) < 0.005,
     `raportul figură/pânză e același pe tot drumul: ${laMijloc.toFixed(3)} → ${laCapat.toFixed(3)}`);
  app.anim.onFrame = original;

  // pasul 4: scena urmează pânza, cu regula de trei simplă pe fiecare axă.
  // 800→250 pe lățime și 800→100 pe înălțime, deci kx = 0.3125 și ky = 0.125.
  const kx = 250 / CANVAS_PX, ky = 100 / CANVAS_PX;
  ok(Math.abs(centru(0).x - josInainte.x * kx) <= 1 && Math.abs(centru(0).y - josInainte.y * ky) <= 1,
     `poziția scalează proporțional: (${josInainte.x},${josInainte.y}) → (${centru(0).x},${centru(0).y})`);
  ok(Math.abs(gabarit(0).w - latInainte.w * kx) <= 1 && Math.abs(gabarit(0).h - latInainte.h * ky) <= 1,
     `și mărimea la fel: ${latInainte.w}x${latInainte.h} → ${gabarit(0).w}x${gabarit(0).h}`);

  // ...deci nimic nu mai ajunge în afara cadrului: restrângerea rămâne doar plasă
  const sus = centru(1);
  ok(sus.x >= 0 && sus.x <= 250 && sus.y >= 0 && sus.y <= 100,
     `figura de sus a rămas în cadru, la (${sus.x},${sus.y})`);

  // Scalarea SCHIMBĂ intenționat Σ len, ca `resize` și `stretch`: de aici încolo, noul
  // total e cel conservat. Raportul e cel al pânzei, nu unul inventat.
  ok(sigma().every((s, i) => s < lungimiInainte[i]),
     `Σ len scade odată cu pânza: ${lungimiInainte.join(' | ')} → ${sigma().join(' | ')}`);

  // pasul 5: textul e parametrizat pe lungime de arc, deci urmează figura fără nicio
  // operație separată — reflow-ul e o consecință, nu un pas
  const textAcum = app.scene.words.find(w => w.text === 'SUS');
  ok(textAcum && Math.round(textAcum.y) !== Math.round(textInainte.y),
     'textul s-a mutat odată cu figura, ca reflow, nu ca operație separată');
  ok(textAcum && textAcum.x >= 0 && textAcum.x <= 250 && textAcum.y >= 0 && textAcum.y <= 100,
     `și a rămas în pânză, la (${Math.round(textAcum.x)},${Math.round(textAcum.y)})`);

  // Un punct cerut în AFARA pânzei micșorate. Validatorul de pe server ține
  // coordonatele în 0..800 — el nu știe cât e pânza acum — deci un (400,400) chiar
  // poate ajunge la motor. Refuz limpede, nu rescrierea figurilor care există.
  const formeInainte = app.scena.obiecte.map(o => JSON.stringify(o.figure.bbox()));
  await ruleaza('fa un patrat de 40 la 400,400',
                { geom: { op: 'rect', w: 40, h: 40, at: { x: 400, y: 400 } }, text: null });
  ok(app.scena.obiecte.length === 2, 'un punct în afara pânzei nu creează nimic');
  ok(JSON.stringify(app.scena.obiecte.map(o => JSON.stringify(o.figure.bbox()))) === JSON.stringify(formeInainte),
     '...și nici nu rescrie figurile care există deja');

  // plafonarea: sub o celulă de grilă nu mai are ce încăpea
  await ruleaza('fa panza 10 pe 10', { geom: { op: 'canvas_resize', w: 10, h: 10 }, text: null });
  ok(SC.panza.w === SC.PANZA_MIN && SC.panza.h === SC.PANZA_MIN,
     `o pânză de 10x10 se plafonează la ${SC.PANZA_MIN}px pe latură`);

  // undo: instantaneul duce cu el și gabaritul, nu doar obiectele — altfel figurile
  // s-ar întoarce la pozițiile lor de dinainte, într-o pânză rămasă mică
  app.scena.restore(instantaneu, (w, f) => app.faceStream(w, f));
  ok(SC.panza.w === CANVAS_PX && SC.panza.h === CANVAS_PX,
     'undo readuce și pânza la 800x800, nu doar obiectele');
  ok(app.payload().noduri[1].at.x === 400 && app.payload().noduri[1].at.y === 600,
     'iar figura mutată de restrângere se întoarce exact de unde a plecat');
}

// Verificarea de cadru: nicio figură nu rămâne pe dinafară, indiferent ce a produs-o.
{
  // „scale-shape" dădea MĂRIMEA bună, nu și LOCUL: scalează față de centrul PÂNZEI,
  // iar o figură cu centrul departe de al pânzei rămânea pe dinafară chiar micșorată.
  // Măsurat, un pătrat de 900x900 cu colțul la (-430,-430) se desena de la -327 la 461.
  const mare = Figure.fromPoints([{ x: -430, y: -430 }, { x: 470, y: -430 },
                                  { x: 470, y: 470 }, { x: -430, y: 470 }], true);
  const sc = layout(mare, new TextStream([], ctx, 17), 'inside', CANVAS);
  const xs = sc.edges.flatMap(e => [e.x1, e.x2]), ys = sc.edges.flatMap(e => [e.y1, e.y2]);
  ok(sc.scale < 1, `figura mai mare decât pânza se micșorează la desenare: k = ${sc.scale.toFixed(3)}`);
  ok(Math.min(...xs) >= -0.5 && Math.min(...ys) >= -0.5
     && Math.max(...xs) <= CANVAS.w + 0.5 && Math.max(...ys) <= CANVAS.h + 0.5,
     `...și se AȘAZĂ în cadru: x ${Math.round(Math.min(...xs))}..${Math.round(Math.max(...xs))}`);
}

{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['geometrie'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl, doar) => { DSL = dsl; await app.run(prompt, doar); };
  const inImagine = () => {
    const E = app.scene.edges.filter(x => !x.ghost);
    if (!E.length) return true;
    const xs = E.flatMap(x => [x.x1, x.x2]), ys = E.flatMap(x => [x.y1, x.y2]);
    return Math.min(...xs) >= -0.5 && Math.min(...ys) >= -0.5
        && Math.max(...xs) <= SC.panza.w + 0.5 && Math.max(...ys) <= SC.panza.h + 0.5;
  };

  // La CREARE: un pătrat de 200 cerut cu centrul în (750,750) ieșea cu 50px peste
  // marginea de sus și de dreapta, și nimic nu-l aducea înapoi.
  await ruleaza('fa un patrat de 200 la 750,750',
                { geom: { op: 'rect', w: 200, h: 200, at: { x: 750, y: 750 } }, text: null }, 'figuri');
  const b = app.figuri()[0].figure.bbox();
  ok(b.maxX <= CANVAS_PX + 0.5 && b.maxY <= CANVAS_PX + 0.5,
     `figura cerută pe margine e adusă în cadru la creare: până la x=${Math.round(b.maxX)}`);
  ok(inImagine(), '   ...și se desenează integral în imagine');

  // La MĂRIRE peste pânză: datele rămân cât s-a cerut — invariantul nu se falsifică —
  // dar desenul rămâne în imagine.
  await ruleaza('mareste de 5 ori', { geom: { op: 'resize', scale: 5 }, text: null }, 'figuri');
  ok(Math.round(app.figuri()[0].figure.totalLength()) === 4000,
     'mărirea peste pânză nu falsifică datele: Σ len e cât a cerut mărirea');
  ok(inImagine(), '   ...dar desenul rămâne în imagine, micșorat și așezat în cadru');

  await ruleaza('muta in coltul din stanga jos',
                { geom: { op: 'move', at: { x: 20, y: 20 } }, text: null }, 'figuri');
  ok(inImagine(), 'și după o mutare care ar scoate-o din cadru');

  await ruleaza('micsoreaza canvasul la 300 pe 200',
                { geom: { op: 'canvas_resize', w: 300, h: 200 }, text: null }, 'panza');
  ok(inImagine(), 'și după ce pânza se micșorează sub ea');

  app.scena.setPanza(CANVAS_PX, CANVAS_PX);
}

// ─────────────────────────────────────────────────────────── 12. cele două casete
console.log('\n=== 12. două casete de comandă: pânza separat de figuri și text ===');

// Care casetă a fost folosită e un semnal de rutare pe care îl dă OMUL, gratis — și e
// fără echivoc, spre deosebire de cuvinte.
{
  const cost = (p, doar) => LLM.agenti(p, doar)
    .reduce((a, d) => a + est(LLM.promptAgent(d, p, doar)), 0);

  // „mărește" e cel mai ambiguu verb din aplicație: fără context cheamă toți agenții
  ok(LLM.agenti('mareste').length === 3, '„mărește" singur rămâne ambiguu: toți agenții');
  ok(LLM.agenti('mareste', 'panza').join() === 'geometrie',
     '...dar scris în caseta pânzei nu mai e: doar geometrul');
  ok(LLM.sectiuni('mareste', 'panza').join() === 'panza', '...și doar ramura pânzei');
  ok(cost('mareste', 'panza') < cost('mareste') / 4,
     `caseta pânzei: ${cost('mareste', 'panza')} tokeni față de ${cost('mareste')} fără ea`);

  // costul casetei pânzei nu depinde de ce s-a scris în ea: mereu aceeași ramură
  const costuri = ['mareste', 'micsoreaza la 250 pe 100', '250x100', 'orice altceva']
    .map(p => cost(p, 'panza'));
  ok(new Set(costuri).size === 1, `caseta pânzei costă la fel de fiecare dată: ${costuri[0]} tokeni`);

  // caseta figurilor nu plătește niciodată documentația pânzei
  for (const p of ['fa un patrat de 200', 'scrie MIAU', 'mareste']) {
    ok(!LLM.sectiuni(p, 'figuri').includes('panza'), `"${p}" în caseta figurilor nu atinge ramura pânzei`);
  }

  // Refuzul merge în AMBELE sensuri. Fără cel din stânga, „fă un pătrat de 200" scris
  // în caseta pânzei făcea o PÂNZĂ de 200x200 — acolo orice cifră e citită ca gabarit.
  for (const cerere of ['fa un patrat de 200', 'scrie MIAU', 'mareste caseta cu 40',
                        'sterge textul', 'muta dreptunghiul la 100,100']) {
    ok(PP.parse(cerere, 'panza').error, `"${cerere}" e refuzat în caseta pânzei`);
    ok(!PP.parse(cerere, 'figuri').error, `   ...dar merge normal în caseta figurilor`);
  }
  // ...iar ce nu numește nici figuri, nici text, trece: caseta pânzei nu cere cuvinte
  ok(PP.parse('250x100', 'panza').geom.op === 'canvas_resize',
     '„250x100", fără niciun substantiv, rămâne o cerere de gabarit');
  ok(PP.parse('micsoreaza la 400', 'panza').geom.w === 400,
     'și „micșorează la 400" la fel — tiparele sunt de REFUZ, nu de recunoaștere');

  // rezerva locală respectă aceeași împărțire
  ok(PP.parse('mareste la 250 pe 100', 'panza').geom.op === 'canvas_resize',
     'rezerva locală, în caseta pânzei: orice cifră e a gabaritului');
  ok(PP.parse('scrie MIAU', 'panza').error,
     '...și nu recunoaște text acolo, deși ar ști cum');
  ok(PP.parse('scrie MIAU', 'figuri').text, 'invers, în caseta figurilor textul merge normal');
}

// Izolarea nu se sprijină pe rugăminți în prompt: ce nu ține de casetă nu se APLICĂ.
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['geometrie'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl, doar) => { DSL = dsl; await app.run(prompt, doar); };
  const latime = () => {
    const b = app.figuri()[0].figure.bbox();
    return Math.round(b.maxX - b.minX);
  };

  await ruleaza('fa un patrat de 200 la 400,400',
                { geom: { op: 'rect', w: 200, h: 200, at: { x: 400, y: 400 } }, text: null }, 'figuri');
  ok(latime() === 200, 'caseta figurilor creează figuri, ca până acum');

  // Cererea de pânză scrisă în caseta greșită nu pleacă deloc spre model. Fără oprirea
  // asta, modelul răspundea ce știe el — o micșorare a FIGURILOR, cu 0.5.
  await ruleaza('micsoreaza canvasul la 250 pe 100',
                { geom: { op: 'resize', scale: 0.5 }, text: null }, 'figuri');
  ok(latime() === 200, 'o cerere de pânză în caseta figurilor nu micșorează figurile');
  ok(SC.panza.w === CANVAS_PX, '...și nici pânza: nimic nu s-a întâmplat, dar se spune de ce');

  // Refuzul din stânga oprește cererea ÎNAINTE de apel, ca și cel din dreapta:
  // modelul nici nu e întrebat, deci n-are cum să răspundă cu un gabarit de 200x200.
  await ruleaza('fa un patrat de 400 la 100,100',
                { geom: { op: 'canvas_resize', w: 400, h: 400 }, text: null }, 'panza');
  ok(SC.panza.w === CANVAS_PX && SC.panza.h === CANVAS_PX,
     'o cerere despre figuri, scrisă în caseta pânzei, nu schimbă gabaritul');
  ok(app.figuri().length === 1, '...și nici nu creează figura: se spune doar unde îi e locul');

  // Invers: caseta pânzei aruncă ce nu e despre gabarit, chiar dacă modelul a emis-o.
  await ruleaza('mareste',
                { geom: { op: 'resize', scale: 1.5 }, text: { set: ['X'], bind: 'inside' } }, 'panza');
  ok(latime() === 200, 'caseta pânzei nu redimensionează figuri, orice ar răspunde modelul');
  ok(app.scena.obiecte.every(o => !o.stream.words.length), '...și nu scrie text');

  // ...dar cererea care chiar îi aparține merge
  await ruleaza('micsoreaza la 300 pe 300',
                { geom: { op: 'canvas_resize', w: 300, h: 300 }, text: null }, 'panza');
  ok(SC.panza.w === 300 && SC.panza.h === 300, `caseta pânzei schimbă gabaritul: ${SC.panza.w}x${SC.panza.h}`);

  app.scena.setPanza(CANVAS_PX, CANVAS_PX);
}

console.log('\n=== 13. vectorul de centre: ținta „în mijlocul figurii N" ===');

// Centrul unei figuri se mută la fiecare scalare, tăiere sau mutare. Se recalcula
// ad-hoc, în fiecare consumator, dar nu-l ținea minte nimeni — deci nu exista pe ce să
// se sprijine o cerere ca „mută textul în mijlocul figurii 0". Acum e un vector, unul
// singur, reîmprospătat după fiecare operație de geometrie.
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['text'] }),
  });

  // două figuri și un text care NU e al niciuneia: fără țintă, un text nou devine
  // obiect de sine stătător, cu figura goală
  const scena = async () => {
    const app = new App();
    app.scena.clear();
    app.plaseaza({ op: 'rect', w: 300, h: 300 }, { x: 200, y: 600 });
    app.plaseaza({ op: 'rect', w: 200, h: 100 }, { x: 600, y: 200 });
    DSL = { geom: null, text: { set: ['MIAU'] } };
    await app.run('scrie MIAU');
    return app;
  };

  // unde se DESENEAZĂ textul, în coordonate logice — citit din scenă, nu din legări
  const textLa = app => {
    const cadru = { w: SC.panza.w, h: SC.panza.h, pad: 6 };
    for (const o of app.scena.obiecte) {
      const sc = layout(o.figure, o.stream, o.binds, cadru);
      if (!sc.words.length) continue;
      const xs = sc.words.map(w => w.x), ys = sc.words.map(w => w.y);
      return {
        x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        y: Math.round(SC.panza.h - (Math.min(...ys) + Math.max(...ys)) / 2),
      };
    }
    return null;
  };

  // --- vectorul se reface după scalare
  {
    const app = await scena();
    const inainte = { ...app.figuri()[0].centru };
    DSL = { geom: { op: 'resize', scale: 2 }, text: null, target: [0] };
    await app.run('mareste figura 0 de doua ori');
    const dupa = app.figuri()[0].centru;
    const real = app.figuri()[0].figure.centroid();
    ok(dupa.x !== inainte.x || dupa.y !== inainte.y,
       `scalarea mută centrul: @${inainte.x},${inainte.y} → @${dupa.x},${dupa.y}`);
    ok(dupa.x === Math.round(real.x) && dupa.y === Math.round(SC.panza.h - real.y),
       'vectorul ține centrul REAL al figurii, recalculat după scalare');
    const n = app.payload().noduri[0];
    ok(n.at.x === dupa.x && n.at.y === dupa.y, 'același vector pleacă în starea trimisă modelului');
  }

  // --- comanda care nu mergea: legarea cere un contur, textul stă pe alt obiect
  for (const [cum, dsl] of [
    ['cu v:0 de la model',  { geom: null, text: { to: 0, bind: 'inside' } }],
    ['fără v, doar legarea', { geom: null, text: { bind: 'inside' } }],
    ['fără v, dar cu ținta', { geom: null, text: { bind: 'inside' }, target: [0] }],
  ]) {
    const app = await scena();
    const c = app.figuri()[0].centru;
    ok(app.payload().texte[0].pe === null, `textul pornește liber, al niciunei figuri — ${cum}`);
    DSL = dsl;
    await app.run('muta textul in mijlocul figurii 0');
    const p = textLa(app);
    ok(p.x === c.x && p.y === c.y, `   ...și ajunge în centrul lui #0, @${p.x},${p.y} — ${cum}`);
    ok(app.payload().texte[0].pe === 0, `   ...iar de-acum îi aparține — ${cum}`);
  }

  // --- centrul de DUPĂ scalare, nu cel dinainte: altfel textul ajunge unde figura NU mai e
  {
    const app = await scena();
    DSL = { geom: { op: 'resize', scale: 2 }, text: null, target: [0] };
    await app.run('mareste figura 0 de doua ori');
    const c = app.figuri()[0].centru;
    DSL = { geom: null, text: { bind: 'inside' } };
    await app.run('muta textul in mijlocul figurii 0');
    const p = textLa(app);
    ok(p.x === c.x && p.y === c.y,
       `după scalare textul ajunge în centrul NOU, @${p.x},${p.y}`);
  }

  // --- deducerea locală se aprinde DOAR pentru legările care cer un contur
  {
    const app = await scena();
    DSL = { geom: null, text: { scale: 1.4 } };
    await app.run('mareste textul');
    ok(app.payload().texte[0].pe === null,
       '„mărește textul" n-are legare, deci nu numește nicio figură: textul rămâne liber');
  }
  {
    const app = await scena();
    DSL = { geom: null, text: { set: ['ALFA'], bind: 'inside' } };
    await app.run('scrie ALFA in mijlocul figurii 1');
    const t = app.payload().texte;
    ok(t.length === 2 && t[1].pe === 1, 'cuvintele NOI se scriu pe figura numită, nu se transferă');
    ok(t[0].pe === null, '...iar textul dinainte rămâne unde era');
  }
  {
    const app = await scena();
    DSL = { geom: null, text: { set: ['NOU'] } };
    await app.run('scrie NOU');
    const t = app.payload().texte;
    ok(t.length === 2 && t[1].pe === null,
       'fără o figură numită, un text nou rămâne obiect de sine stătător, ca până acum');
  }

  // --- centrul intră în instantaneu: undo după o scalare readuce și poziția
  {
    const app = await scena();
    DSL = { geom: { op: 'resize', scale: 2 }, text: null, target: [0] };
    await app.run('mareste figura 0 de doua ori');
    const snap = app.scena.snapshot();
    ok(snap[0].centru !== undefined, 'instantaneul poartă centrul cu el');
    app.scena.restore(snap, (w, f) => app.faceStream(w, f));
    ok(app.scena.obiecte[0].centru.x === snap[0].centru.x
       && app.scena.obiecte[0].centru.y === snap[0].centru.y, '...și restaurarea îl pune la loc');
  }
}

// ─────────────────────────────────────────────────────────── 14. mutarea cu mouse-ul
console.log('\n=== 14. mutarea cu mouse-ul: click, tragere, Undo ===');

// Până acum singurul fel de a muta ceva era promptul, iar o așezare văzută cu ochiul —
// „mai la stânga cu puțin" — cerea o cerere întreagă către model, pentru o operație
// care n-are nimic de tradus. Tragerea o face local, gratis. Ce se verifică aici e că
// nu strică nimic din ce ținea deja: Σ len, cadrul pânzei și un Undo pe gest.
{
  const IM = await import(B + 'interaction/InputManager.js');

  // --- ținta de sub cursor, ca funcție pură: scena desenată plus un punct
  const desen = {
    edges: [{ id: 'a', x1: 100, y1: 100, x2: 300, y2: 100, obj: 'o1' }],
    words: [{ i: 0, x: 500, y: 500, size: 17, obj: 'o2' }],
    casete: [{ x: 600, y: 100, w: 120, h: 60, obj: 'o3' }],
  };
  ok(IM.gaseste(desen, 200, 104) === 'o1', 'click pe contur nimerește figura');
  ok(IM.gaseste(desen, 505, 505) === 'o2', 'click pe cuvânt nimerește textul lui');
  ok(IM.gaseste(desen, 660, 130) === 'o3', 'click ÎN casetă o nimerește, și unde nu scrie nimic');
  ok(IM.gaseste(desen, 660, 165) === 'o3', '...și la câțiva pixeli sub ea, cât ține pragul');
  ok(IM.gaseste(desen, 400, 400) === null, 'click în gol nu nimerește nimic');
  ok(IM.gaseste({ edges: [{ ...desen.edges[0], ghost: true }] }, 200, 104) === null,
     'o muchie-fantomă nu e țintă: e pe cale să dispară');
  ok(IM.gaseste({ edges: [], words: [{ ...desen.words[0], size: 0 }] }, 500, 500) === null,
     'un cuvânt necrescut nu e țintă');
}

{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['text'] }),
  });

  const cadru = () => ({ w: SC.panza.w, h: SC.panza.h, pad: 6 });
  /** Centrele cuvintelor, așa cum se DESENEAZĂ — singurul lucru pe care îl vede omul. */
  const centre = o => layout(o.figure, o.stream, o.binds, cadru()).words
    .map(w => App.centruCuvant(w, o.stream.advance[w.i] || 0))
    .map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));

  // --- apucarea: ce ține degetul trebuie să fie selectat până începe mutarea
  const app = new App();
  app.scena.clear();
  app.scena.setPanza(CANVAS_PX, CANVAS_PX);
  const a = app.plaseaza({ op: 'rect', w: 200, h: 100 }, { x: 400, y: 400 });
  const b = app.plaseaza({ op: 'rect', w: 100, h: 100 }, { x: 700, y: 700 });

  ok(!app.selectie.size, 'o figură nou creată nu rămâne selectată');
  app.apuca(a.id, false);
  ok(app.selectie.size === 1 && app.selectie.has(a.id), 'apăsarea pe o figură o selectează');

  app.select(b.id, true);
  ok(app.selectie.size === 2, 'Shift adaugă la selecție');
  app.apuca(a.id, false);
  ok(app.selectie.size === 2,
     'apăsarea pe un obiect DEJA selectat nu strică selecția: se mută toate odată');

  // --- tragerea: doar translație, pe toată selecția
  const lungA = a.figure.totalLength(), lungB = b.figure.totalLength();
  const bbA = a.figure.bbox(), bbB = b.figure.bbox();
  app.incepeMutarea();
  app.mutaSelectia(30, -20);

  const dupaA = a.figure.bbox(), dupaB = b.figure.bbox();
  ok(Math.round(dupaA.minX - bbA.minX) === 30 && Math.round(dupaA.minY - bbA.minY) === -20,
     'tragerea mută figura exact cu deplasarea cursorului');
  ok(Math.round(dupaB.minX - bbB.minX) === 30 && Math.round(dupaB.minY - bbB.minY) === -20,
     '...și pe a doua din selecție la fel, cu același gest');
  ok(Math.abs(a.figure.totalLength() - lungA) < 1e-9
     && Math.abs(b.figure.totalLength() - lungB) < 1e-9,
     'mutarea nu atinge nicio lungime: Σ len rămâne neschimbat');
  ok(app.actualizeazaCentre()[0].x === Math.round(400 + 30)
     && app.actualizeazaCentre()[0].y === Math.round(400 + 20),
     'centrul raportat urmează figura: y logic crește în SUS, deci o tragere în sus îl mărește');

  // --- cadrul pânzei: cursorul poate merge mai departe, obiectul se oprește la ramă
  app.mutaSelectia(500, 0);
  ok(b.figure.bbox().maxX <= SC.panza.w - 6 + 1e-6,
     'tragerea nu scoate nimic din pânză: obiectul se oprește la ramă');

  // --- Undo: un singur pas pentru tot gestul, nu unul pe cadru
  const inapoi = app.history.undo(app.scena.snapshot());
  app.scena.restore(inapoi, (w, f) => app.faceStream(w, f));
  ok(Math.round(app.scena.obiecte[0].figure.bbox().minX) === Math.round(bbA.minX)
     && Math.round(app.scena.obiecte[1].figure.bbox().minX) === Math.round(bbB.minX),
     'Undo desface tragerea întreagă, nu ultimul pixel din ea');

  // --- textul agățat de PÂNZĂ: fără punct al lui, o translație n-ar avea ce muta
  const app2 = new App();
  app2.scena.clear();
  app2.scena.setPanza(CANVAS_PX, CANVAS_PX);
  DSL = { geom: null, text: { set: ['SALUT'] } };
  await app2.run('scrie SALUT');
  const t = app2.scena.obiecte[0];
  t.binds = t.binds.map(() => ({ bind: 'corner', at: 'tl' }));

  const eraLa = centre(t);
  app2.ancoreaza(t);
  ok(JSON.stringify(centre(t)) === JSON.stringify(eraLa),
     'desprinderea din colț nu mișcă textul cu niciun pixel');
  ok(t.binds.every(x => x.bind === 'point' && x.at && typeof x.at === 'object'),
     '...dar de-acum are un punct al lui, care se poate muta');

  app2.selectie.clear(); app2.selectie.add(t.id);
  app2.mutaSelectia(40, 25);
  const acum = centre(t);
  ok(acum[0].x - eraLa[0].x === 40 && acum[0].y - eraLa[0].y === 25,
     'iar tragerea îl duce exact cu cât s-a tras');

  // --- textul legat de un CONTUR nu are nevoie de ancoră: urmează figura
  const app3 = new App();
  app3.scena.clear();
  app3.scena.setPanza(CANVAS_PX, CANVAS_PX);
  app3.plaseaza({ op: 'rect', w: 300, h: 200 }, { x: 400, y: 400 });
  DSL = { geom: null, text: { set: ['MIAU'], bind: 'inside' }, target: [0] };
  await app3.run('scrie MIAU in figura');
  const f = app3.scena.obiecte[0];
  const textEraLa = centre(f);
  app3.selectie.clear(); app3.selectie.add(f.id);
  app3.incepeMutarea();
  app3.mutaSelectia(-60, 45);
  const textAcum = centre(f);
  ok(textAcum[0].x - textEraLa[0].x === -60 && textAcum[0].y - textEraLa[0].y === 45,
     'un text legat de contur se trage odată cu figura, fără nicio ancoră');
  ok(f.binds.every(x => (typeof x === 'string' ? x : x.bind) === 'inside'),
     '...iar legarea lui rămâne cea de contur, nu se preface în punct');
}

// ─────────────────────────────────────────────────────────── 15. incadrarea
console.log('\n=== 15. dreptunghi de selecție: mai multe obiecte dintr-un gest ===');

// Shift-click adună obiectele unul câte unul. Cadrul le ia pe toate odată — și e
// singurul fel în care poți prinde ce e împrăștiat pe pânză fără să numeri click-uri.
// Ce se verifică: ce atinge cadrul, ce NU atinge, și că grupul strâns așa se mută
// ca unul singur.
{
  const IM = await import(B + 'interaction/InputManager.js');

  ok(JSON.stringify(IM.dreptunghi(300, 200, 100, 50)) === JSON.stringify(IM.dreptunghi(100, 50, 300, 200)),
     'cadrul iese la fel tras în orice direcție: colțurile se ordonează singure');

  const desen = {
    edges: [
      { id: 'a', x1: 100, y1: 100, x2: 200, y2: 100, obj: 'o1' },
      { id: 'b', x1: 600, y1: 600, x2: 700, y2: 600, obj: 'o2' },
    ],
    words: [{ i: 0, text: 'MIAU', x: 400, y: 400, size: 17, align: 'center', baseline: 'middle', obj: 'o3' }],
    casete: [{ x: 500, y: 100, w: 100, h: 50, obj: 'o4' }],
  };
  const cuprinse = (x, y, w, h) => [...IM.cuprinse(desen, { x, y, w, h })].sort().join(',');

  ok(cuprinse(50, 50, 200, 200) === 'o1', 'cadrul prinde figura pe care o atinge');
  ok(cuprinse(0, 0, 800, 800) === 'o1,o2,o3,o4', 'un cadru peste toată pânza le prinde pe toate');
  ok(cuprinse(380, 390, 40, 20) === 'o3', 'un cuvânt e prins de dreptunghiul lui, nu de un punct');
  ok(cuprinse(560, 120, 20, 20) === 'o4', 'caseta e prinsă și pe unde nu scrie nimic');
  ok(cuprinse(250, 250, 100, 100) === '', 'un cadru tras prin gol nu prinde nimic');
  ok(IM.cuprinse({ edges: [{ ...desen.edges[0], ghost: true }] }, { x: 0, y: 0, w: 800, h: 800 }).size === 0,
     'muchiile-fantomă rămân în afara selecției');
}

{
  const { App } = await import(B + 'core/App.js');
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status') ? { provider: 'stub', model: 'stub' } : {}),
  });

  const app = new App();
  app.scena.clear();
  app.scena.setPanza(CANVAS_PX, CANVAS_PX);
  const a = app.plaseaza({ op: 'rect', w: 200, h: 100 }, { x: 400, y: 400 });   // canvas: x 300..500, y 350..450
  const b = app.plaseaza({ op: 'rect', w: 100, h: 100 }, { x: 700, y: 700 });   // canvas: x 650..750, y  50..150
  app.draw(true);

  // --- ce atinge cadrul intră în selecție, chiar în timpul tragerii
  app.incepeCadru(false);
  app.intindeCadru({ x: 250, y: 300, w: 300, h: 200 });
  ok(app.selectie.size === 1 && app.selectie.has(a.id),
     'cadrul prinde doar figura pe care o atinge, nu și pe cea de alături');
  ok(app.scene.cadru && app.scene.cadru.w === 300,
     'dreptunghiul se vede pe pânză cât timp e tras');
  ok(app.scene.edges.some(e => e.obj === a.id && e.sel) && app.scene.edges.every(e => e.obj !== b.id || !e.sel),
     'evidențierea e cea de la click: se vede DIN TIMPUL tragerii ce va fi prins');

  // --- micșorat înapoi, obiectul iese din selecție: se poate corecta fără să ridici degetul
  app.intindeCadru({ x: 250, y: 300, w: 20, h: 20 });
  ok(!app.selectie.size, 'un cadru strâns la loc lasă selecția goală: gestul e reversibil');

  app.intindeCadru({ x: 250, y: 300, w: 300, h: 200 });
  app.terminaCadru();
  ok(app.selectie.size === 1 && app.scene.cadru === null,
     'la ridicarea butonului dreptunghiul dispare, selecția rămâne');

  // --- Shift: cadrul ADAUGĂ la ce era deja selectat
  app.incepeCadru(true);
  app.intindeCadru({ x: 600, y: 0, w: 200, h: 200 });
  app.terminaCadru();
  ok(app.selectie.size === 2 && app.selectie.has(a.id) && app.selectie.has(b.id),
     'cu Shift, al doilea cadru adaugă la selecție în loc să o înlocuiască');

  app.select(null, true);
  ok(app.selectie.size === 2, 'un click în gol cu Shift nu dărâmă selecția construită');

  // --- grupul strâns cu cadrul se mută ca unul singur
  const bbA = a.figure.bbox(), bbB = b.figure.bbox();
  const lungA = a.figure.totalLength();
  app.incepeMutarea();
  app.mutaSelectia(-40, 30);
  ok(Math.round(a.figure.bbox().minX - bbA.minX) === -40
     && Math.round(b.figure.bbox().minX - bbB.minX) === -40,
     'tragerea mută tot grupul prins cu cadrul, cu aceeași deplasare');
  ok(Math.round(a.figure.bbox().minY - bbA.minY) === 30
     && Math.round(b.figure.bbox().minY - bbB.minY) === 30,
     '...pe amândouă axele, deodată');
  ok(Math.abs(a.figure.totalLength() - lungA) < 1e-9,
     'și aici mutarea e doar translație: Σ len rămâne neatins');

  const inapoi = app.history.undo(app.scena.snapshot());
  app.scena.restore(inapoi, (w, f) => app.faceStream(w, f));
  ok(Math.round(app.scena.obiecte[0].figure.bbox().minX) === Math.round(bbA.minX)
     && Math.round(app.scena.obiecte[1].figure.bbox().minX) === Math.round(bbB.minX),
     'un Undo desface mutarea întregului grup, nu obiect cu obiect');

  app.select(null, false);
  ok(!app.selectie.size, 'un click simplu în gol deselectează, ca până acum');
}

// ===========================================================================================
// 16. MARGINEA OPRESTE TOATA SELECTIA, NU DOAR FIGURA CARE O ATINGE
// ===========================================================================================
//
// Restrans obiect cu obiect — asa se facea, cu „restrangeToate" dupa fiecare pas de mutare —
// cel ajuns la margine se oprea, iar celalalt mergea mai departe dupa cursor. Doua figuri
// trase impreuna spre aceeasi muchie se strangeau una in alta si ramaneau in linie, desi
// gestul fusese o translatie. Distanta dintre ele nu trebuie sa se schimbe niciodata.
console.log('\n=== 16. marginea oprește toată selecția, nu doar figura care o atinge ===');
{
  const { App } = await import(B + 'core/App.js');
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status') ? { provider: 'stub', model: 'stub' } : {}),
  });

  const PAD = 6;                                        // respiroul cerut de marginea pânzei
  const app = new App();
  app.scena.clear();
  app.scena.setPanza(CANVAS_PX, CANVAS_PX);
  const a = app.plaseaza({ op: 'rect', w: 100, h: 100 }, { x: 700, y: 400 });   // canvas: x 650..750
  const b = app.plaseaza({ op: 'rect', w: 100, h: 100 }, { x: 200, y: 400 });   // canvas: x 150..250
  app.draw(true);
  app.selectie = new Set([a.id, b.id]);

  const distanta = () => a.figure.bbox().minX - b.figure.bbox().minX;
  const departe = distanta();                           // 500px între ele, atât trebuie să rămână
  const lungB = b.figure.totalLength();

  // --- tras spre dreapta mai mult decât încape: se face doar cât intră, pe amândouă
  app.incepeMutarea();
  app.mutaSelectia(200, 0);
  ok(Math.round(a.figure.bbox().maxX) === CANVAS_PX - PAD,
     'figura din față se oprește exact pe muchie');
  ok(Math.round(distanta()) === Math.round(departe),
     'cea din spate se oprește odată cu ea: distanța dintre figuri rămâne cea de la început');

  // --- de aici încolo, în direcția aceea nu mai mișcă nimic
  const inainte = b.figure.bbox().minX;
  app.mutaSelectia(80, 0);
  ok(Math.round(b.figure.bbox().minX) === Math.round(inainte),
     'cu marginea atinsă, figura îndepărtată nu mai înaintează spre ea');
  ok(Math.round(distanta()) === Math.round(departe), '...și distanța tot nu se schimbă');

  // --- axa liberă rămâne liberă: pe lângă margine selecția alunecă, întreagă
  const sus = { a: a.figure.bbox().minY, b: b.figure.bbox().minY };
  app.mutaSelectia(80, 30);
  ok(Math.round(a.figure.bbox().minY - sus.a) === 30
     && Math.round(b.figure.bbox().minY - sus.b) === 30,
     'blocat pe o axă, grupul se mută normal pe cealaltă');
  ok(Math.round(a.figure.bbox().maxX) === CANVAS_PX - PAD
     && Math.round(distanta()) === Math.round(departe),
     '...fără să miște nimic pe axa blocată');
  ok(Math.abs(b.figure.totalLength() - lungB) < 1e-9,
     'oprirea la margine e tot translație: Σ len rămâne neatins');

  app.terminaMutarea();

  // --- aceeași margine ține și pentru o figură singură, ca până acum
  app.selectie = new Set([b.id]);
  app.incepeMutarea();
  app.mutaSelectia(-900, 0);
  ok(Math.round(b.figure.bbox().minX) === PAD,
     'o figură trasă singură se oprește tot pe muchie, nu iese din pânză');
  app.terminaMutarea();
}

// ===========================================================================================
// 17. MAI MULTE OPERAȚII DINTR-UN SINGUR PROMPT
// ===========================================================================================
//
// Până acum o cerere aducea o singură operație: „fă două pătrate" cerea două prompturi,
// adică două drumuri la model pentru ceva spus o dată. Acum „g" poate fi o LISTĂ de pași,
// aplicați pe rând, ca și cum ar fi fost ceruți separat — dar cu un singur Undo peste tot.
console.log('\n=== 17. mai multe operații dintr-un singur prompt ===');

// --- validarea listei, la agentul de geometrie
{
  const geo = GEOMETRU;
  const doi = geo.citeste({ g: [{ o: 'r', w: 100, h: 100, p: [200, 200] },
                                  { o: 'r', w: 300, h: 150, p: [600, 600] }] });
  ok(Array.isArray(doi) && doi.length === 2, 'campul „g" poate fi o listă de operații');
  ok(doi[0].op === 'rect' && doi[0].w === 100 && doi[1].w === 300,
     'fiecare pas trece prin aceeași validare ca una singură');
  ok(doi[0].at.x === 200 && doi[1].at.y === 600, 'fiecare pas își păstrează punctul lui');

  ok(geo.citeste({ g: { o: 'r', w: 100, h: 100 } }).op === 'rect',
     'o cerere obișnuită rămâne un obiect, nu o listă');
  ok(geo.citeste({ g: [{ o: 'r', w: 100, h: 100 }] }).op === 'rect',
     'o listă de un singur pas se strânge tot la obiect: restul codului nu vede nicio schimbare');

  const curat = geo.citeste({ g: [{ o: 'r', w: 50, h: 50 }, { o: 'HACK' }, null, 'nu'] });
  ok(!Array.isArray(curat) && curat.op === 'rect',
     'pașii pe care motorul nu-i cunoaște se aruncă, ceilalți rămân');
  ok(geo.citeste({ g: [{ o: 'HACK' }, { o: 'NIMIC' }] }) === null,
     'o listă din care nu rămâne nimic e ca și cum n-ar fi fost geometrie');

  const multi = geo.citeste({ g: Array.from({ length: 20 }, () => ({ o: 'r', w: 10, h: 10 })) });
  ok(multi.length === MAX_PASI,
     'lanțul se taie la ' + MAX_PASI + ' pași: o cerere, nu un program');
}

// --- rezerva locală: aceleași cereri, fără model
{
  const doua = PP.parse('fa 2 patrate de 100').geom;
  ok(Array.isArray(doua) && doua.length === 2 && doua[0].w === 100,
     '„fa 2 patrate de 100" dă doi pași, nu unul');
  ok(PP.parse('creeaza doua patrate de 100').geom.length === 2,
     'numărul scris în litere se citește la fel');

  const lant = PP.parse('fa un patrat de 100 la 200,200 si un dreptunghi de 300 pe 150 la 600,600').geom;
  ok(lant.length === 2 && lant[0].w === 100 && lant[1].w === 300 && lant[1].h === 150,
     'două figuri diferite, înșiruite cu „și", ies ca doi pași');
  ok(lant[0].at.x === 200 && lant[1].at.x === 600, 'fiecare cu punctul lui');

  ok(PP.parse('fa un dreptunghi de 300 pe 150').geom.op === 'rect',
     'o singură figură rămâne o singură operație');

  // „și" nu taie orice: bucata trebuie să fie ea însăși un pas de geometrie
  const text = PP.parse('scrie ALFA si BETA');
  ok(text.geom === null && text.text.set.join(' ') === 'ALFA BETA',
     '„scrie ALFA si BETA" rămâne un singur text cu două cuvinte, nu două cereri');
  const mixt = PP.parse('fa un patrat de 100 si scrie MIAU');
  ok(!Array.isArray(mixt.geom) && mixt.geom.w === 100 && mixt.text.set[0] === 'MIAU',
     'figură plus text: tot un pas de geometrie, textul merge pe lângă');

  ok(PP.parse('fa 2 patrate').error, 'fără dimensiune se spune, nu se inventează');
}

// --- aplicarea pe scenă
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['geometrie'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl) => { DSL = dsl; await app.run(prompt); };
  const gabarit = i => {
    const b = app.figuri()[i].figure.bbox();
    return { w: Math.round(b.maxX - b.minX), h: Math.round(b.maxY - b.minY) };
  };

  await ruleaza('fa un patrat de 100 la 200,200 si un dreptunghi de 300 pe 150 la 600,600', {
    geom: [{ op: 'rect', w: 100, h: 100, at: { x: 200, y: 200 } },
           { op: 'rect', w: 300, h: 150, at: { x: 600, y: 600 } }],
    text: null,
  });
  ok(app.figuri().length === 2, 'un singur prompt, două figuri');
  ok(gabarit(0).w === 100 && gabarit(1).w === 300 && gabarit(1).h === 150,
     'fiecare pas și-a păstrat dimensiunea cerută');
  ok(app.payload().noduri[0].at.x === 200 && app.payload().noduri[1].at.x === 600,
     'și punctul lui');
  ok(app.scena.obiecte.every(o => o.figure.totalLength() > 0), 'fiecare obiect nou are Σ len');

  // un Undo desface CEREREA, nu ultimul ei pas: instantaneul se ia o dată, înainte de lanț
  const inapoi = app.history.undo(app.scena.snapshot());
  app.scena.restore(inapoi, (w, f) => app.faceStream(w, f));
  ok(app.scena.obiecte.length === 0, 'un Undo desface tot lanțul, nu doar ultimul pas');

  // --- fără puncte: pașii nu se calcă unul pe altul
  await ruleaza('fa doua patrate de 100', {
    geom: [{ op: 'rect', w: 100, h: 100 }, { op: 'rect', w: 100, h: 100 }],
    text: null,
  });
  ok(app.figuri().length === 2, 'două pătrate fără punct: tot două figuri');
  const [a, b] = app.figuri().map(o => o.figure.bbox());
  const peste = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
  ok(!peste, 'al doilea își caută loc liber, nu se așază peste primul');
  ok(gabarit(0).w === 100 && gabarit(1).w === 100,
     'iar primul rămâne cum a fost făcut: în lanț, „rect" creează, nu remodelează');

  // --- lanț mixt: creare, apoi o operație pe ce s-a creat
  app.scena.clear();
  await ruleaza('fa un patrat de 200 la 400,400 apoi imparte-l in 2', {
    geom: [{ op: 'rect', w: 200, h: 200, at: { x: 400, y: 400 } },
           { op: 'split', into: 2, dir: 'v' }],
    text: null,
  });
  ok(app.scena.obiecte.length === 1 && app.figuri()[0].figure.polylines.length === 2,
     'pasul al doilea lucrează pe ce a născut primul');

  // --- o singură operație se poartă exact ca înainte: „fă-l de …" remodelează
  app.scena.clear();
  await ruleaza('fa un patrat de 200 la 400,400',
                { geom: { op: 'rect', w: 200, h: 200, at: { x: 400, y: 400 } }, text: null });
  await ruleaza('fa-l de 300 pe 100', { geom: { op: 'rect', w: 300, h: 100 }, text: null });
  ok(app.figuri().length === 1 && gabarit(0).w === 300 && gabarit(0).h === 100,
     'un „rect" singur, fără punct, remodelează figura de pe pânză — ca până acum');
}

// nota de suprapunere: numărată înainte de așezare, altfel figura nouă se găsea pe sine
{
  const { App } = await import(B + 'core/App.js');
  const app = new App();
  app.scena.clear();
  const patrat = { op: 'rect', w: 100, h: 100, at: { x: 300, y: 300 } };

  const prima = [];
  app.aplicaGeom(patrat, prima, null);
  ok(!prima.some(n => /suprapuse/.test(n)),
     'prima figură pe o pânză goală nu se raportează suprapusă peste nimic');

  const adoua = [];
  app.aplicaGeom(patrat, adoua, null);
  ok(adoua.some(n => /^1 suprapuse/.test(n)), 'una chiar peste alta se spune, o dată');
}

// ===========================================================================================
// 18. CASETA DINTR-UN BUTON, NU DINTR-UN PROMPT
// ===========================================================================================
//
// Ambalarea unui text era numai o cerere de prompt — „pune textul într-o casetă" — adică un
// drum la model pentru o comandă care n-are nimic de tradus: ce text, se știe din selecție.
// Butonul o face local, gratis, și face și drumul invers.
console.log('\n=== 18. caseta dintr-un buton, nu dintr-un prompt ===');
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['text'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl) => { DSL = dsl; await app.run(prompt); };
  /** Casetele DESENATE — singurul lucru pe care îl vede omul. */
  const casete = () => app.scene.casete.length;
  const undeScrie = () => app.scene.words.map(w => ({ x: Math.round(w.x), y: Math.round(w.y) }));

  await ruleaza('fa un patrat de 300 la 400,400',
                { geom: { op: 'rect', w: 300, h: 300, at: { x: 400, y: 400 } }, text: null });
  await ruleaza('scrie MIAU in patrat',
                { geom: null, text: { set: ['MIAU'], bind: 'inside' } });
  const fig = app.figuri()[0];

  ok(!casete(), 'la început textul n-are casetă');
  ok(!App.inCaseta(fig), '...nici legarea lui nu spune altceva');

  // --- selectez figura cu textul și apăs butonul
  app.selectie = new Set([fig.id]);
  ok(app.texteVizate().length === 1, 'selecția are un text de ambalat: butonul e aprins');
  app.comutaCaseta();
  ok(casete() === 1, 'o apăsare bagă textul în casetă, fără niciun prompt');
  ok(App.inCaseta(fig), 'legarea chiar a devenit „box"');

  // --- a doua apăsare îl scoate, și îl lasă unde se vedea
  const inainte = undeScrie();
  app.comutaCaseta();
  ok(!casete(), 'a doua apăsare îl scoate din casetă');
  ok(!App.inCaseta(fig), '...și legarea nu mai e „box"');
  ok(fig.binds.every(b => b === 'inside'),
     'pe o figură textul se întoarce înăuntrul ei, unde ar fi stat oricum');
  const dupa = undeScrie();
  ok(dupa.length === inainte.length
     && dupa.every((p, i) => Math.abs(p.x - inainte[i].x) < 60 && Math.abs(p.y - inainte[i].y) < 60),
     'scos din casetă, textul rămâne aproximativ unde se vedea, nu sare în colț');

  // --- un Undo desface apăsarea întreagă
  app.comutaCaseta();
  ok(casete() === 1, 'pus la loc în casetă');
  const inapoi = app.history.undo(app.scena.snapshot());
  app.scena.restore(inapoi, (w, f) => app.faceStream(w, f));
  app.draw(true);
  ok(!casete(), 'un Undo desface apăsarea, ca orice altă schimbare');

  // --- text LIBER: n-are contur de care să se agațe, deci rămâne legat de punctul lui
  app.scena.clear();
  app.selectie.clear();
  await ruleaza('scrie ALFA', { geom: null, text: { set: ['ALFA'], bind: 'inside' } });
  const liber = app.scena.obiecte[0];
  app.selectie = new Set([liber.id]);
  const inainteLiber = undeScrie();
  app.comutaCaseta();
  ok(casete() === 1, 'și un text liber intră în casetă dintr-o apăsare');
  app.comutaCaseta();
  ok(liber.binds.every(b => b && b.bind === 'point'),
     'scos, un text fără figură rămâne legat de PUNCT, nu de un contur care nu există');
  const dupaLiber = undeScrie();
  ok(dupaLiber.every((p, i) => Math.abs(p.x - inainteLiber[i].x) < 60
                            && Math.abs(p.y - inainteLiber[i].y) < 60),
     '...și nu pleacă în (0,0), colțul pânzei');

  // --- fără text pe pânză nu e ce ambala: butonul nu face nimic
  app.scena.clear();
  app.selectie.clear();
  ok(!app.texteVizate().length, 'pânză fără text: butonul se stinge');
  const inainteGol = JSON.stringify(app.scena.snapshot());
  app.comutaCaseta();
  ok(JSON.stringify(app.scena.snapshot()) === inainteGol,
     'apăsarea pe gol nu schimbă nimic');

  // --- fără selecție cade pe tot, ca orice comandă fără țintă
  await ruleaza('scrie UNU', { geom: null, text: { set: ['UNU'], bind: 'inside' } });
  await ruleaza('scrie DOI', { geom: null, text: { set: ['DOI'], bind: 'inside' } });
  app.selectie.clear();
  ok(app.texteVizate().length === 2, 'fără selecție, butonul privește toate textele');
  app.comutaCaseta();
  ok(casete() === 2, 'și le bagă pe amândouă în câte o casetă, dintr-o apăsare');
}

// ===========================================================================================
// 19. PÂNZA CREȘTE PÂNĂ LA 1200, DAR PORNEȘTE TOT DE LA 800
// ===========================================================================================
//
// Pornirea și plafonul stăteau în aceeași constantă — `CANVAS_PX`, „gabaritul maxim, și cel
// de pornire". Sunt însă două lucruri: cât e comod să înceapă și cât se poate cere. Testele
// de mai jos verifică granița dintre ele, pe tot drumul: validare, motor, catalog.
console.log('\n=== 19. pânza crește până la 1200, pornește de la 800 ===');
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['geometrie'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl, doar) => { DSL = dsl; await app.run(prompt, doar); };

  ok(SC.panza.w === CANVAS_PX && SC.panza.h === CANVAS_PX,
     `aplicația pornește cu pânza de ${CANVAS_PX}×${CANVAS_PX}`);

  // --- creșterea până la plafon
  await ruleaza('fa panza 1200 pe 1200',
                { geom: { op: 'canvas_resize', w: 1200, h: 1200 }, text: null }, 'panza');
  ok(SC.panza.w === PANZA_MAX && SC.panza.h === PANZA_MAX,
     `o pânză cerută de ${PANZA_MAX}×${PANZA_MAX} chiar se face atât`);
  // gabaritul pânzei intră în scenă, deci ajunge la element prin animație; instantaneu,
  // ca să se poată citi acum
  app.draw(true);
  ok(app.renderer.w === PANZA_MAX,
     'și elementul de desen o urmează: nu rămâne la gabaritul vechi');

  // --- pe pânza crescută, punctele de peste 800 sunt bune
  ok(inCanvas(1100, 1100), 'un punct la 1100,1100 e pe pânză acum');
  await ruleaza('fa un patrat de 200 la 1100,1100',
                { geom: { op: 'rect', w: 200, h: 200, at: { x: 1100, y: 1100 } }, text: null });
  ok(app.figuri().length === 1, 'o figură cerută acolo chiar se creează');
  const b = app.figuri()[0].figure.bbox();
  ok(b.maxX <= PANZA_MAX && b.minY >= 0, '...și e adusă în pânză, ca oricare alta');

  // --- o figură mai mare decât pânza de pornire e o cerere cinstită acum
  app.scena.clear();
  await ruleaza('fa un patrat de 1000 la 600,600',
                { geom: { op: 'rect', w: 1000, h: 1000, at: { x: 600, y: 600 } }, text: null });
  const mare = app.figuri()[0].figure.bbox();
  ok(Math.round(mare.maxX - mare.minX) === 1000,
     'o figură de 1000px nu mai e tăiată la 800: pe pânza asta încape');
  ok(CAT.code(app.figuri()[0].figure.signature()).split('|')[1] === '20',
     '...iar catalogul îi dă lățimea adevărată, 20 de celule');

  // --- peste plafon nu se trece, și se spune
  const note = [];
  app.aplicaGeom({ op: 'canvas_resize', w: 5000, h: 5000 }, note);
  ok(SC.panza.w === PANZA_MAX,
     `o cerere de 5000 se oprește la ${PANZA_MAX}, nu crește la nesfârșit`);
  ok(note.some(n => n.includes(String(PANZA_MAX))),
     'plafonarea se spune pe față, cu cifra: nu se întâmplă în tăcere');

  // --- și înapoi la pornire, fără urme
  await ruleaza('fa panza 800 pe 800',
                { geom: { op: 'canvas_resize', w: 800, h: 800 }, text: null }, 'panza');
  ok(SC.panza.w === CANVAS_PX && !inCanvas(1100, 1100),
     'micșorată la loc, un punct la 1100 nu mai e pe pânză');
  app.scena.clear();
}

// ===========================================================================================
// 20. UN TEXT NOU E AL PÂNZEI, NU AL FIGURII DE PE EA
// ===========================================================================================
//
// Cu o singură figură goală pe pânză, ea era singura țintă implicită, așa că orice text nou
// ajungea legat „inside" de ea: se desena în mijlocul figurii și se muta odată cu ea. Dar un
// text nou nu e al figurii care se întâmplă să fie desenată — e al pânzei. Cade în mijlocul
// ei, la gabaritul de ACUM, și rămâne obiect de sine stătător, cu numărul lui.
//
// Cine îl vrea înăuntru o poate cere pe față („în pătrat"), poate numi figura, sau poate da
// click pe ea înainte — toate trei rămân neatinse.
console.log('\n=== 20. un text nou e al pânzei, nu al figurii de pe ea ===');
{
  const { App } = await import(B + 'core/App.js');
  let DSL = null;
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => (String(url).includes('status')
      ? { provider: 'stub', model: 'stub' }
      : { dsl: DSL, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['text'] }),
  });
  const app = new App();
  const ruleaza = async (prompt, dsl, doar) => { DSL = dsl; await app.run(prompt, doar); };
  const rect = (w, h, x, y) => ({ geom: { op: 'rect', w, h, at: { x, y } }, text: null });
  const scrie = (cuv, extra) => ({ geom: null, text: { set: [cuv], bind: 'inside', ...extra } });
  const liber = () => app.payload().texte.filter(t => t.pe === null);
  const peFiguri = () => app.payload().texte.filter(t => t.pe !== null);

  app.scena.clear();
  app.scena.setPanza(CANVAS_PX, CANVAS_PX);

  // --- o figură goală pe pânză: textul nu se lipește de ea
  await ruleaza('fa un patrat de 200 la 200,600', rect(200, 200, 200, 600));
  await ruleaza('scrie MIAU', scrie('MIAU'));
  ok(liber().length === 1 && !peFiguri().length,
     'cu o figură pe pânză, textul nou rămâne obiect liber, nu al ei');
  ok(!app.figuri()[0].stream.words.length, 'figura chiar n-a primit niciun cuvânt');
  ok(liber()[0].at.x === CANVAS_PX / 2 && liber()[0].at.y === CANVAS_PX / 2,
     `și cade în mijlocul pânzei: (${liber()[0].at.x},${liber()[0].at.y})`);

  // --- mijlocul e al pânzei de ACUM, nu al celei de pornire
  app.scena.clear();
  await ruleaza('fa panza 400 pe 300',
                { geom: { op: 'canvas_resize', w: 400, h: 300 }, text: null }, 'panza');
  await ruleaza('fa un patrat de 80 la 100,80', rect(80, 80, 100, 80));
  await ruleaza('scrie MIAU', scrie('MIAU'));
  ok(SC.panza.w === 400 && SC.panza.h === 300, 'pânza s-a micșorat la 400×300');
  ok(liber().length === 1 && liber()[0].at.x === 200 && liber()[0].at.y === 150,
     `mijlocul se socotește din gabaritul de acum: (${liber()[0].at.x},${liber()[0].at.y})`);

  // --- conturul nu mai împinge textul deoparte: mijlocul cerut e chiar mijlocul
  app.scena.clear();
  await ruleaza('fa panza 800 pe 800',
                { geom: { op: 'canvas_resize', w: 800, h: 800 }, text: null }, 'panza');
  await ruleaza('fa un patrat de 300 la 400,400', rect(300, 300, 400, 400));
  await ruleaza('scrie MIAU', scrie('MIAU'));
  ok(liber().length === 1 && liber()[0].at.x === 400 && liber()[0].at.y === 400,
     'o figură chiar în centru nu mai mută textul din centru — poziția e a pânzei');

  // --- dar două TEXTE tot nu se calcă: acolo așezătorul rămâne la treabă
  await ruleaza('scrie BETA', scrie('BETA'));
  const doua = liber();
  ok(doua.length === 2, 'al doilea text e tot obiect propriu, nu un rând sub primul');
  ok(doua[0].at.x !== doua[1].at.x || doua[0].at.y !== doua[1].at.y,
     `și se ferește de primul: (${doua[0].at.x},${doua[0].at.y}) vs (${doua[1].at.x},${doua[1].at.y})`);

  // --- cererea care NUMEȘTE figura o primește, ca până acum
  app.scena.clear();
  await ruleaza('fa un patrat de 200 la 400,400', rect(200, 200, 400, 400));
  await ruleaza('scrie MIAU in patrat', scrie('MIAU'));
  ok(peFiguri().length === 1 && !liber().length,
     'cerut pe față — „în pătrat" — textul chiar intră în figură');

  // --- la fel, cu ținta dată de model
  app.scena.clear();
  await ruleaza('fa un patrat de 200 la 400,400', rect(200, 200, 400, 400));
  await ruleaza('scrie MIAU', { ...scrie('MIAU'), target: [0] });
  ok(peFiguri().length === 1, 'o țintă numită de model bate regula: textul e al figurii #0');

  // --- și cu figura aleasă prin click
  app.scena.clear();
  await ruleaza('fa un patrat de 200 la 400,400', rect(200, 200, 400, 400));
  app.selectie = new Set([app.figuri()[0].id]);
  await ruleaza('scrie MIAU', scrie('MIAU'));
  ok(peFiguri().length === 1, 'figura selectată cu click primește textul, ca înainte');
  app.selectie.clear();

  // --- „în fiecare" cere copierea, deci se copiază
  app.scena.clear();
  await ruleaza('fa un patrat de 100 la 200,200', rect(100, 100, 200, 200));
  await ruleaza('fa un patrat de 100 la 600,600', rect(100, 100, 600, 600));
  await ruleaza('scrie MIAU in fiecare figura', { geom: null, text: { set: ['MIAU'], bind: 'inside' } });
  ok(peFiguri().length === 2 && !liber().length,
     '„în fiecare figură" pune câte unul în amândouă — copierea chiar s-a cerut');

  // --- același tur creează figura ȘI scrie: textul e tot al pânzei
  app.scena.clear();
  await ruleaza('fa un patrat de 200 la 400,400 si scrie MIAU',
                { geom: { op: 'rect', w: 200, h: 200, at: { x: 400, y: 400 } },
                  text: { set: ['MIAU'], bind: 'inside' } });
  ok(app.figuri().length === 1 && !app.figuri()[0].stream.words.length,
     'figura tocmai creată rămâne fără text');
  ok(liber().length === 1 && liber()[0].at.x === 400 && liber()[0].at.y === 400,
     'textul cerut în același tur e obiect propriu, în mijlocul pânzei');

  // --- dar dacă cererea spune „în pătrat", tot acolo ajunge
  app.scena.clear();
  await ruleaza('fa un patrat de 200 la 400,400 si scrie MIAU in patrat',
                { geom: { op: 'rect', w: 200, h: 200, at: { x: 400, y: 400 } },
                  text: { set: ['MIAU'], bind: 'inside' } });
  ok(peFiguri().length === 1 && !liber().length,
     '...cerut pe față, textul intră în figura creată în același tur');

  // --- un text nou peste unul liber care există deja: tot obiect separat, ca înainte
  app.scena.clear();
  await ruleaza('scrie ALFA', scrie('ALFA'));
  await ruleaza('scrie BETA', scrie('BETA'));
  ok(liber().length === 2, 'pe pânza goală, două prompturi dau două texte, nu unul lung');

  app.scena.clear();
  app.scena.setPanza(CANVAS_PX, CANVAS_PX);
}

// ─────────────────────────────────────────── 21. scena ca date: salvare și încărcare
//
// `continut_json` din baza de date se scrie de aici și se citește tot de aici, deci
// forma trebuie să supraviețuiască unui `JSON.stringify` întreg — nu doar să pară că o
// face. Testele de mai jos țin trei lucruri deodată:
//
//   1. dus-întorsul e fidel: figuri, cuvinte, legări, pânză, Σ len
//   2. datele care vin din afară nu pot dărâma aplicația — un rând corupt dă o pânză
//      mai săracă, nu o excepție
//   3. seriile locale sesiunii (id-uri de obiect, numere de text) se refac, ca o pânză
//      încărcată să nu se ciocnească cu ce se desenează după ea
console.log('\n=== 21. scena ca date: salvare și încărcare ===');
{
  const faceStream = (w, f) => new TextStream(w, ctx, f);
  const scena = new SC.Scene();
  scena.setPanza(400, 300);

  const t1 = SC.nextText(), t2 = SC.nextText();
  const o1 = scena.add(new SC.Obiect(dreptunghi(120, 80), { x: 200, y: 150 },
                                     faceStream(['ALFA', 'BETA'], 17)));
  o1.binds = ['inside', { bind: 'side', at: 'top', in: true }];
  o1.texte = [t1, t1];
  const o2 = scena.add(new SC.Obiect(Figure.empty(), { x: 60, y: 240 },
                                     faceStream(['LIBER'], 21)));
  o2.binds = [{ bind: 'point', at: { x: 60, y: 60 }, rot: 90 }];
  o2.texte = [t2];

  const sumaVeche = scena.totalLength();

  // --- de ce nu se poate salva `snapshot`: gabaritul stă ca PROPRIETATE pe listă, iar
  // `JSON.stringify` a unei liste nu scrie decât elementele indexate. S-ar pierde tăcut.
  ok(JSON.parse(JSON.stringify(scena.snapshot())).panza === undefined,
     'instantaneul de Undo pierde pânza la serializare — de asta există toJSON');
  ok(SC.FORMAT === 1, `forma salvată își spune versiunea: v${SC.FORMAT}`);

  // --- dus-întorsul trece printr-un șir, ca prin baza de date, nu prin același obiect
  const salvat = JSON.parse(JSON.stringify(scena.toJSON()));
  ok(salvat.panza.w === 400 && salvat.panza.h === 300,
     'pânza chiar ajunge în date: 400×300');
  ok(salvat.obiecte.length === 2, 'ambele obiecte sunt scrise');

  SC.panza.w = CANVAS_PX; SC.panza.h = CANVAS_PX;      // altă sesiune, altă pânză
  const noua = new SC.Scene();
  const n = noua.incarca(salvat, faceStream);

  ok(n === 2 && noua.length === 2, 'se încarcă exact cele două obiecte');
  ok(SC.panza.w === 400 && SC.panza.h === 300,
     'pânza se pune ÎNAINTEA obiectelor: ele sunt în pixelii ei');
  ok(Math.abs(noua.totalLength() - sumaVeche) < 1e-9,
     `Σ len trece neatins prin salvare: ${Math.round(sumaVeche)}`);

  const [n1, n2] = noua.obiecte;
  ok(n1.at.x === 200 && n1.at.y === 150, 'punctul de așezare se păstrează');
  ok(n1.stream.words.join() === 'ALFA,BETA' && n1.stream.fontPx === 17,
     'cuvintele și corpul de literă se păstrează');
  ok(n1.figure.polylines.length === 1 && n1.figure.polylines[0].segs.length === 4,
     'figura se reconstruiește cu toate laturile');
  ok(n1.figure instanceof Figure && typeof n1.figure.bbox === 'function',
     'și e o Figure vie, nu date inerte: are metodele ei');
  ok(n1.binds[0] === 'inside', 'legarea simplă rămâne șir — nu se umflă degeaba');
  ok(n1.binds[1].bind === 'side' && n1.binds[1].at === 'top' && n1.binds[1].in === true,
     'legarea pe latură își păstrează latura și fața');
  ok(n2.binds[0].bind === 'point' && n2.binds[0].at.x === 60 && n2.binds[0].rot === 90,
     'legarea în punct își păstrează punctul și rotația');
  ok(n2.figure.isEmpty && n2.stream.words.join() === 'LIBER',
     'un text liber, fără contur, se întoarce tot fără contur');

  // --- seriile locale sesiunii se REFAC, dar ordinea lor nu se schimbă
  ok(n1.id !== o1.id && n2.id !== o2.id,
     'id-urile de obiect sunt noi: nu se pot ciocni cu ce se desenează după încărcare');
  ok(n1.texte[0] > t2 && n2.texte[0] > t2,
     'numerele de text sunt și ele noi, peste tot ce era în sesiune');
  ok(n1.texte[0] === n1.texte[1], 'un text rămâne UN text: ambele cuvinte au același număr');
  ok(n1.texte[0] < n2.texte[0], '...iar ordinea se păstrează: T0 rămâne primul');

  // --- date din afară: nimic nu are voie să arunce
  const gunoi = [null, undefined, 42, 'text', {}, { obiecte: 'nu e listă' },
                 { obiecte: [null, 7, {}] }, { panza: { w: 'x', h: null }, obiecte: [] }];
  let aruncat = 0, obiecteDinGunoi = 0;
  for (const g of gunoi) {
    try { obiecteDinGunoi += new SC.Scene().incarca(g, faceStream); } catch { aruncat++; }
  }
  ok(aruncat === 0, `${gunoi.length} forme stricate, niciuna nu aruncă`);
  ok(obiecteDinGunoi === 0, '...și niciuna nu produce obiecte inventate');
  SC.panza.w = 400; SC.panza.h = 300;

  // --- un rând corupt sărăcește pânza, nu o dărâmă
  const stricat = JSON.parse(JSON.stringify(salvat));
  stricat.obiecte[0].figure[0].segs[1].len = 'nu e număr';
  stricat.obiecte.push({ at: { x: 10, y: 10 } });                 // fără figură și fără cuvinte
  stricat.obiecte.push({ at: null, words: ['X'] });               // fără punct de așezare
  const partial = new SC.Scene();
  ok(partial.incarca(stricat, faceStream) === 2,
     'obiectele nedesenabile se sar, cele bune rămân');
  ok(partial.obiecte[0].figure.polylines[0].segs.length === 3,
     'din figura stricată se păstrează laturile valide, restul se taie');

  // --- legare necunoscută: motorul n-are cum să o deseneze, deci devine cea firească
  const inventat = { panza: { w: 400, h: 300 },
                     obiecte: [{ at: { x: 5, y: 5 }, words: ['X'],
                                 binds: [{ bind: 'teleportare' }], figure: [] }] };
  const scInv = new SC.Scene();
  ok(scInv.incarca(inventat, faceStream) === 1,
     'un obiect fără contur, dar cu text, se încarcă');
  ok(scInv.obiecte[0].binds[0] === 'inside',
     'o legare pe care motorul n-o cunoaște cade pe „inside", nu pe ecran');

  // --- pânza salvată se plafonează la citire, ca oricare alta
  const uriasa = { panza: { w: 9999, h: 9999 }, obiecte: [] };
  new SC.Scene().incarca(uriasa, faceStream);
  ok(SC.panza.w === PANZA_MAX && SC.panza.h === PANZA_MAX,
     `o pânză salvată de 9999 se oprește la ${PANZA_MAX}, ca orice cerere`);

  SC.panza.w = CANVAS_PX; SC.panza.h = CANVAS_PX;
}

// ────────────────────────── 25. ieșirea din cont, peste toate cele trei origini
//
// `signOut()` golește `localStorage`-ul UNEI SINGURE origini. Cu trei porturi sunt trei
// depozite, fiecare cu sesiunea lui de când i-a fost predată. Ieșirea de pe 8082 lăsa
// deci poarta, pe 8080, cu sesiunea ei neatinsă: ea o vedea, trimitea înapoi la 8082,
// iar 8082 trimitea iar la poartă — du-te-vino fără sfârșit.
//
// Un lanț greșit nu se vede decât ca buclă în browser, adică exact felul de defect care
// merită prins altundeva decât cu ochiul. De aceea `lantIesire` e o funcție pură.
console.log('\n=== 25. ieșirea din cont, peste toate originile ===');
{
  const { lantIesire } = await import(B + 'cont/Cont.js');
  const TOATE = { poarta: 8080, panze: 8082, panza: 8081 };

  // --- de pe fiecare pagină, celelalte se curăță, iar POARTA e ultima
  const de8082 = lantIesire(TOATE, 8082);
  ok(de8082.join() === '8081,8080',
     'ieșire de pe pagina de alegere: întâi pânza, apoi poarta');
  ok(de8082[de8082.length - 1] === 8080, '...poarta e ULTIMA — acolo se oprește omul');

  const de8081 = lantIesire(TOATE, 8081);
  ok(de8081.join() === '8082,8080', 'ieșire din pânză: alegerea, apoi poarta');

  const de8080 = lantIesire(TOATE, 8080);
  ok(de8080.join() === '8081,8082',
     'ieșire chiar de la poartă: se curăță celelalte două');
  ok(!de8080.includes(8080), '...și nu se trimite singură la ea însăși — asta era bucla');

  // --- portul curent nu apare niciodată în lanț, oricum ar veni scris
  for (const p of [8080, '8080', 8081, '8081', 8082, '8082']) {
    ok(!lantIesire(TOATE, p).includes(Number(p)),
       `portul de acum (${typeof p} ${p}) nu se curăță pe sine`);
  }

  // --- instalare cu două containere: lanțul are doar ce există
  const doua = { poarta: 8080, panza: 8081 };
  ok(lantIesire(doua, 8081).join() === '8080',
     'cu două containere, lanțul are un singur pas');
  ok(lantIesire(doua, 8080).join() === '8081', '...și invers, tot unul');

  // --- un singur container: nu e nimic altundeva de curățat, deci nu se pleacă nicăieri
  ok(lantIesire({ panza: 8081 }, 8081).length === 0,
     'cu un singur container, lanțul e gol — nu se navighează în gol');
  ok(lantIesire({}, 8081).length === 0, 'fără porturi anunțate, lanț gol');
  ok(lantIesire(null, 8081).length === 0, 'fără hartă deloc, lanț gol — nu aruncă');

  // --- porturi mutate din .env: lanțul le urmează, nu presupune 8080/8081/8082
  const mutate = { poarta: 9000, panze: 9002, panza: 9001 };
  ok(lantIesire(mutate, 9002).join() === '9001,9000',
     'porturile mutate din .env sunt urmate întocmai');
}

// ─────────────────────────────── 24. rolurile: un proces sau trei containere
//
// `porturi.js` e citit de DOUĂ lucruri — serverul și proba de sănătate a containerului.
// Dacă cele două n-ar fi de acord ce port ascultă un rol, containerul ar apărea
// „unhealthy" deși merge, iar cauza n-ar fi vizibilă de nicăieri.
//
// Funcțiile primesc mediul ca parametru tocmai ca să poată fi verificate aici: un modul
// deja încărcat n-ar reciti `process.env` dacă l-ar fi citit la import.
console.log('\n=== 24. rolurile: un proces sau trei containere ===');
{
  const P = await import('./porturi.js');

  // --- fără ROL: un proces, toate trei paginile (așa merge `npm start`)
  ok(P.roluriDeServit({}).join() === 'poarta,panze,panza',
     'fără ROL, un singur proces servește toate trei paginile');
  const pt = P.porturi({});
  ok(pt.poarta === 8080 && pt.panze === 8082 && pt.panza === 8081,
     `porturile implicite: poarta ${pt.poarta}, panze ${pt.panze}, panza ${pt.panza}`);
  ok(P.portulMeu({}) === 8080, 'proba de sănătate cade pe poartă când rolurile-s toate');

  // --- cu ROL: un singur rol, pe portul lui
  for (const [rol, port] of [['poarta', 8080], ['panze', 8082], ['panza', 8081]]) {
    ok(P.roluriDeServit({ ROL: rol }).join() === rol, `ROL=${rol} servește doar „${rol}"`);
    ok(P.portulMeu({ ROL: rol }) === port, `...și proba îl caută pe ${port}, nu pe 8080`);
  }

  // --- numele containerelor merg la fel de bine ca cele din cod
  ok(P.roluriDeServit({ ROL: 'canvas' })[0] === 'panza', 'ROL=canvas înseamnă „panza"');
  ok(P.roluriDeServit({ ROL: 'log' })[0] === 'poarta', 'ROL=log înseamnă „poarta"');
  ok(P.roluriDeServit({ ROL: 'canvas-selection' })[0] === 'panze',
     'ROL=canvas-selection înseamnă „panze"');
  ok(P.roluriDeServit({ ROL: '  CANVAS  ' })[0] === 'panza',
     'spațiile și majusculele nu contează');

  // Un ROL scris greșit ARUNCĂ. Un container care ar servi tăcut altă pagină decât cea
  // cerută e mai rău decât unul care refuză să pornească și spune de ce.
  let aruncat = '';
  try { P.rol({ ROL: 'canvass' }); } catch (e) { aruncat = e.message; }
  ok(aruncat.includes('canvass') && aruncat.includes('Acceptate'),
     'un ROL greșit oprește pornirea și enumeră ce se acceptă, în loc să cadă pe un implicit');

  // --- porturile ANUNȚATE: doar rolurile care chiar rulează
  ok(Object.keys(P.porturiAnuntate({})).join() === 'poarta,panze,panza',
     'implicit se anunță toate trei');
  const doua = P.porturiAnuntate({ ROLURI: 'log,canvas' });
  ok(!('panze' in doua) && doua.poarta === 8080 && doua.panza === 8081,
     'cu ROLURI=log,canvas pagina de alegere nu mai e anunțată — nimeni nu e trimis acolo');
  ok(Object.keys(P.porturiAnuntate({ ROLURI: 'inexistent' })).length === 3,
     'un ROLURI numai cu gunoi cade pe toate trei, nu pe niciunul');

  // --- porturile se pot muta din mediu, iar proba le urmează
  const mutat = { ROL: 'canvas', PORT_PANZA: '9091' };
  ok(P.porturi(mutat).panza === 9091 && P.portulMeu(mutat) === 9091,
     'un port mutat din .env e urmat și de server, și de proba de sănătate');
  ok(P.porturi({ PORT: '7000' }).poarta === 7000, '`PORT` singur ține locul lui PORT_POARTA');

  // --- fiecare rol are pagina lui, și toate trei există pe disc
  const fs = await import('node:fs');
  for (const r of P.ROLURI_TOATE) {
    ok(fs.existsSync(P.PAGINI[r]), `rolul „${r}" servește ${P.PAGINI[r]}, care există`);
  }
}

// ─────────────────────────────────── 23. regulile formularului de cont nou
//
// Sunt funcții pure, deci se pot proba fără browser — și tocmai de aia stau într-un
// modul separat, nu într-un `onclick`. O regulă de parolă scrisă direct în pagină nu se
// poate verifica, deci se strică tăcut la prima rescriere a formularului.
//
// Ce NU dovedesc testele astea: că regulile sunt o apărare. Ele trăiesc în browser, iar
// browserul e al omului. Impunerea adevărată a parolei stă în Supabase Dashboard, la
// Authentication → Policies.
console.log('\n=== 23. regulile de email, nume și parolă ===');
{
  const V = await import(B + 'cont/Validare.js');

  // --- emailul: „@" și „.com", cum s-a cerut
  const emailBun = ['a@gmail.com', 'Raul.Toma@exemplu.com', 'x@sub.domeniu.com'];
  const emailRau = {
    'raul': 'fără „@" deloc',
    'raul@gmail': 'fără „.com"',
    'raul@gmail.ro': 'alt domeniu de nivel superior',
    '@gmail.com': 'nimic înainte de „@"',
    'raul@.com': 'nimic între „@" și punct',
    'ra ul@gmail.com': 'spațiu în adresă',
    'a@b@gmail.com': 'două „@"',
  };
  for (const e of emailBun) ok(V.verificaEmail(e).bun, `email valid: ${e}`);
  for (const [e, de] of Object.entries(emailRau)) {
    const v = V.verificaEmail(e);
    ok(!v.bun && v.motiv.length > 0, `email respins (${de}): "${e}" → ${v.motiv}`);
  }
  ok(V.verificaEmail('  a@gmail.com  ').bun, 'spațiile din jur se taie, nu se resping');

  // --- parola: cel puțin 8 caractere ȘI un caracter special
  ok(V.PAROLA_MIN === 8, `pragul e ${V.PAROLA_MIN} caractere`);
  ok(V.verificaParola('parola!1').bun, 'parolă bună: 8 caractere și un „!"');
  ok(V.verificaParola('Ab1?cdef').bun, '...la fel, cu „?"');
  ok(!V.verificaParola('parola!').bun, 'șapte caractere: prea scurtă, chiar cu semn');
  ok(!V.verificaParola('parolalunga').bun, 'lungă, dar fără niciun caracter special');
  ok(!V.verificaParola('').bun, 'goală: respinsă');

  // Caracterul special e definit prin EXCLUDERE — orice nu e literă, cifră sau spațiu.
  // O listă scrisă de mână ar respinge tăcut semne dintr-un alt alfabet.
  ok(V.verificaParola('abcdefg-').bun, 'liniuța e caracter special');
  ok(V.verificaParola('abcdefg€').bun, '...și „€", deși n-ar fi pe nicio listă scrisă de mână');
  ok(!V.verificaParola('abcdefgh').bun, 'doar litere: nu');
  ok(!V.verificaParola('12345678').bun, 'doar cifre: nu');
  ok(!V.verificaParola('abcdefg ').bun, 'spațiul NU trece drept caracter special');
  ok(V.verificaParola('parolăé!').bun, 'diacriticele sunt litere, nu semne — dar „!" salvează parola');
  ok(!V.verificaParola('parolăéà').bun, '...iar fără semn, diacriticele singure nu ajung');

  // Lista de reguli pleacă întreagă, ca formularul să le poată aprinde pe rând
  const r = V.verificaParola('scurt');
  ok(r.reguli.length === 2 && r.reguli.every(x => 'text' in x && 'indeplinita' in x),
     'se întorc toate regulile, nu doar prima picată — formularul le bifează pe rând');
  ok(r.reguli.filter(x => x.indeplinita).length === 0, '„scurt" nu îndeplinește niciuna');
  ok(V.verificaParola('scurt!').reguli.filter(x => x.indeplinita).length === 1,
     '„scurt!" o îndeplinește pe cea de semn, dar nu pe cea de lungime');

  // --- numele de utilizator
  ok(V.verificaNume('raul').bun, 'nume valid');
  ok(!V.verificaNume('ra').bun, `sub ${V.NUME_MIN} caractere: respins`);
  ok(!V.verificaNume('').bun, 'gol: respins');
  ok(!V.verificaNume('x'.repeat(V.NUME_MAX + 1)).bun, `peste ${V.NUME_MAX}: respins`);

  // --- tot formularul: se raportează primul lucru de reparat, în ordinea de pe ecran
  ok(V.verificaInregistrare({ email: 'a@gmail.com', nume: 'raul', parola: 'parola!1' }).bun,
     'formular complet și corect');
  ok(V.verificaInregistrare({ email: 'gresit', nume: 'ra', parola: 'x' }).motiv
     === V.verificaEmail('gresit').motiv,
     'cu mai multe greșeli, se spune prima de pe ecran — emailul, nu parola');
  ok(V.verificaInregistrare({ email: 'a@gmail.com', nume: 'ra', parola: 'x' }).motiv
     === V.verificaNume('ra').motiv,
     '...apoi numele, și abia la urmă parola');
}

// ─────────────────────────────────────────── 22. poarta: jetonul până la /api/parse
//
// Autentificarea nu e doar un ecran. Dacă jetonul nu ajunge pe fir, poarta e o ușă de
// sticlă: pagina cere cont, dar `/api/parse` răspunde oricui. Iar dacă un 401 s-ar
// pierde în rezerva locală pe regex, aplicația ar părea că merge fără sesiune.
console.log('\n=== 22. poarta: jetonul pe fir și sesiunea pierdută ===');
{
  const fetchVechi = globalThis.fetch;
  let antet = null, raspuns = { ok: true, status: 200, dsl: { geom: null, text: { set: ['X'] } } };
  globalThis.fetch = async (url, opt) => {
    antet = (opt && opt.headers && opt.headers.Authorization) || null;
    return {
      ok: raspuns.ok, status: raspuns.status,
      json: async () => (raspuns.ok
        ? { dsl: raspuns.dsl, model: 'stub', usage: { in: 0, out: 0 }, ms: 0, agenti: ['text'] }
        : { error: 'sesiune invalidă' }),
    };
  };

  await PP.parseRemote('scrie X', {}, 'figuri', 'JETONUL-MEU');
  ok(antet === 'Bearer JETONUL-MEU',
     'jetonul pleacă spre /api/parse ca „Bearer …" — poarta nu e doar un ecran');

  antet = null;
  await PP.parseRemote('scrie X', {}, 'figuri');
  ok(antet === null,
     'fără cont configurat nu se trimite niciun antet — ruta rămâne deschisă ca înainte');

  // --- 401: sesiunea s-a pierdut. Rezerva locală răspunde, dar codul merge mai departe.
  raspuns = { ok: false, status: 401 };
  const pierdut = await PP.parseRemote('scrie X', {}, 'figuri', 'expirat');
  ok(pierdut._cod === 401,
     'un 401 se raportează ca atare, nu se pierde în rezerva locală');
  ok(pierdut._live === false,
     '...iar răspunsul e marcat ca venit de la regex, nu de la model');

  // --- o pană adevărată de model NU e 401: acolo rezerva locală chiar e răspunsul bun
  raspuns = { ok: false, status: 503 };
  const cazut = await PP.parseRemote('scrie X', {}, 'figuri', 'bun');
  ok(cazut._cod === 503 && cazut._cod !== 401,
     'o pană de model rămâne 503: cele două nu se confundă, și nu cer același lucru');

  globalThis.fetch = fetchVechi;
}

// --- integrarea cu App: o încărcare e o schimbare ca oricare alta, deci se desface
{
  const { App } = await import(B + 'core/App.js');
  const app = new App();
  app.scena.clear();
  app.scena.setPanza(CANVAS_PX, CANVAS_PX);

  const o = app.scena.add(new SC.Obiect(dreptunghi(200, 100), { x: 400, y: 400 },
                                        app.faceStream(['UNU'], 17)));
  o.binds = ['inside'];
  o.texte = [SC.nextText()];
  const dinCont = JSON.parse(JSON.stringify(app.scena.toJSON()));

  app.scena.clear();
  app.selectie.add('o-care-nu-mai-exista');
  const istoricInainte = app.history.past.length;

  ok(app.incarcaScena(dinCont) === 1, 'App pune pe pânză scena venită din cont');
  ok(app.scena.obiecte[0].stream.words.join() === 'UNU', '...cu textul ei cu tot');
  ok(!app.selectie.size, 'selecția veche nu supraviețuiește încărcării');
  ok(app.history.past.length === istoricInainte + 1,
     'încărcarea intră în istoric ÎNAINTE să schimbe ceva');

  const inapoi = app.history.undo(app.scena.snapshot());
  app.scena.restore(inapoi, (w, f) => app.faceStream(w, f));
  ok(app.scena.length === 0, 'Undo chiar întoarce pânza la ce era înainte de încărcare');

  app.scena.clear();
  app.scena.setPanza(CANVAS_PX, CANVAS_PX);
}

console.log(fail ? `\n### ${fail} TESTE PICATE` : '\n### TOATE TESTELE TREC');
process.exit(fail ? 1 : 0);
