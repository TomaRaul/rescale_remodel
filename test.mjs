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
const LLM            = await import('./server/llm.js');
const { Geometru }   = await import('./server/agents/geometry/Geometru.js');
const { Tipograf }   = await import('./server/agents/text/Tipograf.js');
const { Router }     = await import('./server/agents/routing/Router.js');
const { Casetar }    = await import('./server/agents/textbox/Casetar.js');
const { Echipa }     = await import('./server/agents/orchestration/Echipa.js');
const { ModelClient } = await import('./server/providers.js');

const { GRID, CELL, AX, CANVAS_PX, pointPixel, toLogic, inCanvas } = SC;
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
const est = t => Math.ceil((t || '').length / 4);
const dreptunghi = (w, h) => OPS.rect(CANVAS, w, h);   // acum in PIXELI

// ─────────────────────────────────────────────────────────── 1. grila
console.log('=== 1. grila și coordonatele ===');
ok(GRID === 16 && CELL === 50, `grilă ${GRID}×${GRID}, reper la fiecare ${CELL}px`);
ok(CANVAS_PX === GRID * CELL, `zonă de desen ${CANVAS_PX}×${CANVAS_PX}`);
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
for (const [f, nume, w, h] of [[patrat, 'PATRAT', 150, 150], [drept, 'DREPTUNGHI', 300, 150],
                               [dreptunghi(100, 400), 'DREPTUNGHI', 100, 400], [dreptunghi(800, 800), 'PATRAT', 800, 800]]) {
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
ok(CAT.addressable() === 8 * GRID * GRID, `${CAT.addressable()} combinații adresabile`);
ok(CAT.search(dreptunghi(200, 200).signature()).leaf === 'PATRAT', 'lățime = înălțime → PATRAT');
ok(CAT.search(dreptunghi(200, 250).signature()).leaf === 'DREPTUNGHI', 'lățime ≠ înălțime → DREPTUNGHI');
ok(CAT.search(Figure.empty().signature()).leaf === 'GOL', 'figura goală → GOL');
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
ok(CAT.search(s2.signature()).leaf === 'GRUP_2', 'două piese → GRUP_2');
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
ok(V({ geom: { op: 'rect', w: 9999, h: 0, at: { x: 1, y: 1 } } }).geom.w === 800, 'dimensiuni absurde sunt plafonate la lățimea pânzei');
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
ok(V({ t: { b: 'x', z: [9999, 9999] } }).text.box.w === 800, 'o casetă mai mare decât pânza e plafonată');
ok(V({ t: { f: 40 } }).text.boxDelta === 40, 'f → boxDelta, mărirea casetei în pixeli');
ok(V({ t: { f: -25 } }).text.boxDelta === -25, 'f negativ micșorează caseta');
ok(V({ t: { f: [50, 200] } }).text.boxDelta.w === 50, 'f ca pereche → lățimea, prima cifră');
ok(V({ t: { f: [50, 200] } }).text.boxDelta.h === 200, 'f ca pereche → înălțimea, a doua cifră');
ok(V({ t: { f: [9999, -9999] } }).text.boxDelta.w === 800, 'perechea e plafonată pe fiecare axă');
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
// Cifrele sunt estimate (~4 caractere/token), nu `countTokens`: contează ca prag
// stabil şi comparabil între rulări, nu ca adevăr absolut. Marja e ~5% peste măsurat:
// strânsă cât să pice la un rând adăugat, largă cât să nu pice la o reformulare.
console.log('\n--- pragul de tokeni pe ramură ---');
const PRAGURI = [
  ['fa un dreptunghi de 300 pe 150 la 400,400', 'geometrie',              705],
  ['imparte figura 0 in 3',                     'geometrie',              667],
  ['muta figura 1 la 400,400',                  'geometrie',              667],
  ['sterge textul',                             'text',                   705],
  ['mareste textul',                            'text',                   705],
  ['mareste caseta cu 40 de pixeli',            'caseta',                 795],
  ['pune textul pe latura de sus',              'text',                  1435],
  ['scrie MIAU in figura',                      'text',                  1435],
  ['pune textul intr-o caseta',                 'text+caseta',           1435],
  ['micsoreaza panza la 250 pe 100',            'geometrie',              560],
  ['ceva necunoscut',                           'geometrie+text+caseta', 3400],
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
const { Agent: AgentBaza } = await import('./server/agents/base/Agent.js');
ok(est(AgentBaza.COMUN.join('\n')) <= 213,
   `baza comună: ~${est(AgentBaza.COMUN.join('\n'))} tokeni, plătiţi de fiecare agent chemat`);

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
const geo = new Geometru(), tip = new Tipograf();
ok(geo.valideaza({ t: { s: ['ALFA'] } }) === null,
   'Geometru.valideaza ignoră complet un câmp de text');
ok(tip.valideaza({ g: { o: 'r', w: 50, h: 50 } }) === null,
   'Tipograf.valideaza ignoră complet o operație de figură');
ok(geo.valideaza({ g: { o: 's', n: 3 } }).into === 3, 'Geometru citește split');
ok(tip.valideaza({ t: { b: 'i', s: ['X'] } }).bind === 'inside', 'Tipograf citește bind');

// --- casetarul: al treilea agent, cu domeniul lui
const cas = new Casetar();
ok(cas.valideaza({ t: { s: ['ALFA'], b: 'i', k: 1.4 } }) === null,
   'Casetar ignoră complet conținutul și legările tipografului');
ok(cas.valideaza({ g: { o: 'r', w: 50, h: 50 } }) === null, 'Casetar ignoră complet figurile');
ok(cas.valideaza({ t: { b: 'x' } }).bind === 'box', 'Casetar citește b:x');
ok(cas.valideaza({ t: { z: [300, 80] } }).box.w === 300, 'Casetar citește z');
ok(cas.valideaza({ t: { f: 40 } }).boxDelta === 40, 'Casetar citește f');
// izolarea e COD LIPSA, nu un câmp șters la final
ok(tip.valideaza({ t: { b: 'x' } }) === null,
   'Tipograf nu mai recunoaște caseta — a rămas fără cod pentru ea');
ok(tip.valideaza({ t: { f: 40 } }) === null, 'Tipograf ignoră mărimea casetei');
ok(cas.numeRamuri.join(',') === 'caseta', 'Casetar își declară ramura');
ok(cas.camp === 'caseta' && tip.camp === 'text' && geo.camp === 'geom',
   'trei câmpuri diferite: doi agenți nu se pot suprascrie la combinare');
// routerul nu-l cunoaște pe nume, se uită la ramura declarată
ok(new Router([geo, tip, cas]).alege('mareste caseta cu 40 de pixeli')[0] === cas,
   'routerul alege casetarul după ramura lui, fără să-l știe pe nume');

// combinarea: „caseta" se topește în „text", și vine ULTIMA
const combCas = Echipa.combina([
  { agent: tip, dsl: { geom: null, text: { set: ['ALFA'], bind: 'inside' }, why: 'text' },
    usage: { in: 1, out: 1 }, model: 'm', incercari: 1 },
  { agent: cas, dsl: { geom: null, caseta: { bind: 'box', box: { w: 300, h: 0 } }, why: 'caseta' },
    usage: { in: 1, out: 1 }, model: 'm', incercari: 1 },
]);
ok(combCas.dsl.text.set.join() === 'ALFA', 'conținutul vine de la tipograf');
ok(combCas.dsl.text.bind === 'box',
   'legarea vine de la casetar, chiar dacă tipograful a ghicit „inside"');
ok(combCas.dsl.text.box.w === 300, 'mărimea casetei trece prin combinare');
ok(combCas.dsl.caseta === undefined, 'câmpul „caseta" nu ajunge la motor — se topește în „text"');

// „nu e treaba mea" e un raspuns, nu o eroare
let aruncatGol = false;
try { geo.citeste('{"g":null,"y":"nimic"}'); } catch (e) { aruncatGol = e.name === 'RaspunsGol'; }
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
const comb = Echipa.combina([
  { agent: geo, dsl: { geom: { op: 'rect' }, text: null, why: 'figura' }, usage: { in: 10, out: 2 }, model: 'm', incercari: 1 },
  { agent: tip, dsl: { geom: null, text: { bind: 'inside' }, why: 'text', target: [1] }, usage: { in: 20, out: 3 }, model: 'm', incercari: 1 },
]);
ok(comb.dsl.geom.op === 'rect' && comb.dsl.text.bind === 'inside', 'combinarea ia din fiecare agent domeniul lui');
ok(comb.dsl.target.join() === '1', 'ținta trece prin combinare');
ok(comb.usage.in === 30 && comb.usage.out === 5, 'consumul se adună peste agenți');
ok(comb.dsl.why === 'figura; text', 'motivele se lipesc');


// ── lantul de rezerve si memoria cotei ────────────────────────────────────────
// Un model epuizat nu se reface intre doua apeluri la o secunda distanta, deci
// merita ocolit — altfel fiecare cerere plateste din nou dus-intorsul catre el.
const fals = { id: 'test', env: null, native: false, url: 'http://exemplu' };
const altul = { id: 'altul', env: null, native: false, url: 'http://altul' };
const per = (p, model) => ({ p, model });
const mc = new ModelClient([per(fals, 'a'), per(fals, 'b'), per(altul, 'c')]);
const lista = c => c.deIncercat().map(ModelClient.nume).join();

ok(lista(mc) === 'test:a,test:b,altul:c', 'fără eșecuri, se încearcă toți candidații în ordine');
ok(mc.provider.id === 'test', 'primul candidat dă providerul principal, cel afișat în interfață');

ModelClient.pauzeaza('test:a');
ok(lista(mc) === 'test:b,altul:c', 'un model epuizat e ocolit la apelurile următoare');
ModelClient.pauzeaza('test:b');
ok(lista(mc) === 'altul:c',
   'când un provider e epuizat de tot, lanțul trece la ALT provider');
ModelClient.pauzeaza('altul:c');
ok(lista(mc) === 'test:a,test:b,altul:c',
   'dacă TOȚI sunt pe pauză, se încearcă totuși — mai bine lent decât deloc');
ModelClient._pauzat.clear();

ok(ModelClient.nume(per(fals, 'a')) !== ModelClient.nume(per(altul, 'a')),
   'același nume de model la doi provideri sunt candidați diferiți');

ok(ModelClient.COTA.test('You exceeded your current quota'), 'eroarea de cotă e recunoscută');
ok(!ModelClient.COTA.test('API key not valid'), 'o cheie greșită NU e tratată ca epuizare de cotă');

// apelurile esuate se numara si se pun in jurnal, ca un tur lent sa aiba explicatie
const client = new ModelClient([per(fals, 'x'), per(altul, 'y')]);
client.unApel = async c => {
  if (c.model === 'x') throw new Error('You exceeded your current quota');
  return { text: '{"g":{"o":"c"}}', usage: { in: 1, out: 1 } };
};
const rr = await client.cere('sys', 'user', b => JSON.parse(b));
const jur = rr.jurnal;
ok(rr.incercari === 2 && jur.length === 2, 'jurnalul are câte o intrare pe încercare');
ok(jur[0].ok === false && jur[1].ok === true, 'jurnalul spune care a picat și care a răspuns');
ok(jur[0].provider === 'test' && jur[1].provider === 'altul',
   'jurnalul spune de la ce provider a venit fiecare încercare');
ok(rr.provider === 'altul' && rr.model === 'y',
   'se raportează providerul care CHIAR a răspuns, nu cel principal');
ok(ModelClient.ocolit('test:x'), 'modelul care a picat pe cotă rămâne ocolit');
ModelClient._pauzat.clear();
ModelClient._memorie.clear();



// lantul se construieste PESTE provideri: o a doua cheie in .env chiar foloseste
const cheiVechi = { g: process.env.GEMINI_API_KEY, q: process.env.GROQ_API_KEY };
process.env.GEMINI_API_KEY = 'test';
delete process.env.GROQ_API_KEY;
const doarGemini = await ModelClient.creeaza();
ok(doarGemini.candidati.every(c => c.p.id === 'gemini'),
   'cu o singură cheie, lanțul e tot la un provider');

process.env.GROQ_API_KEY = 'test';
const amandoua = await ModelClient.creeaza();
const idm = amandoua.candidati.map(c => c.p.id);
ok(idm[0] === 'gemini' && idm.includes('groq'),
   'cu două chei, lanțul trece la Groq după ce se termină modelele Gemini');
ok(idm.lastIndexOf('gemini') < idm.indexOf('groq'),
   'toate rezervele Gemini se încearcă înaintea schimbării de provider');
ok(amandoua.provider.id === 'gemini',
   'providerul principal rămâne primul din listă — Groq e rezervă, nu înlocuitor');

if (cheiVechi.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = cheiVechi.g;
if (cheiVechi.q === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = cheiVechi.q;

// ── termenele de asteptare ────────────────────────────────────────────────────
// Timpul simtit de om nu vine din cat raspunde modelul, ci din cat se asteapta unul
// care NU raspunde. Regula: renunti repede cat timp mai ai pe cine cadea.
{
  const stub = m => ({ p: { id: 'test', env: null, native: false, url: 'http://x' }, model: m });
  const termeneDin = async candidati => {
    ModelClient._pauzat.clear();
    ModelClient._memorie.clear();
    const c = new ModelClient(candidati);
    const vazute = [];
    c.unApel = async (_c, _s, _u, termen) => { vazute.push(termen); throw new Error('timeout'); };
    try { await c.cere('sistem', 'cerere', x => x); } catch { /* toate au tăcut */ }
    ModelClient._pauzat.clear();
    return vazute;
  };

  const trei = await termeneDin([stub('a'), stub('b'), stub('c')]);
  const S = ModelClient.TIMEOUT_SCURT_MS;
  ok(trei.length === 3 && trei[0] === S && trei[1] === S && trei[2] === undefined,
     `termene: ${trei.map(t => t ?? 'întreg').join(', ')} — scurt cât mai e o rezervă`);

  // Regula era doar pentru PRIMA încercare, și asta lăsa jumătate din problemă pe masă:
  // două modele mute la rând costau 4s + 9s, deși al treilea răspundea în 900ms.
  ok(trei[1] !== undefined, 'și a doua încercare renunță repede, dacă mai e un candidat');

  const unul = await termeneDin([stub('unic')]);
  ok(unul.length === 1 && unul[0] === undefined,
     'cu un singur candidat termenul rămâne întreg: a renunța repede = a nu primi nimic');

  ok(S <= 2000, `termenul scurt e ${S}ms — o dată și jumătate cel mai lent răspuns bun măsurat`);
}

// ── memoria raspunsurilor ─────────────────────────────────────────────────────
// La temperatura 0, acelasi prompt pe aceeasi scena da acelasi DSL, deci a doua
// oara nu mai are rost cerut. Cheia trebuie sa prinda ORICE schimbare.
ModelClient._memorie.clear();
const k1 = ModelClient.cheie('m', 'sistem', 'cerere');
ok(k1 === ModelClient.cheie('m', 'sistem', 'cerere'), 'aceeași intrare dă aceeași cheie');
ok(k1 !== ModelClient.cheie('m', 'sistem', 'alta cerere'), 'altă cerere → altă cheie');
ok(k1 !== ModelClient.cheie('m', 'alt sistem', 'cerere'), 'alt prompt de sistem → altă cheie');
ok(k1 !== ModelClient.cheie('n', 'sistem', 'cerere'), 'alt model → altă cheie');
ok(ModelClient.cheie('m', 'ab' + 'X'.repeat(400), 'c') !== ModelClient.cheie('m', 'ba' + 'X'.repeat(400), 'c'),
   'o schimbare la ÎNCEPUTUL promptului lung schimbă cheia');

let apeluri = 0;
const cm = new ModelClient([per(fals, 'm')]);
cm.unApel = async () => { apeluri++; return { text: '{"g":{"o":"c"}}', usage: { in: 100, out: 5 } }; };
const p1 = await cm.cere('sys', 'user', b => JSON.parse(b));
const p2 = await cm.cere('sys', 'user', b => JSON.parse(b));
ok(apeluri === 1, 'a doua cerere identică nu mai ajunge la model');
ok(p2.memorat === true && p2.usage.in === 0 && p2.usage.out === 0,
   'răspunsul memorat e marcat și nu costă tokeni');
ok(JSON.stringify(p1.rezultat) === JSON.stringify(p2.rezultat), 'rezultatul e același');
await cm.cere('sys', 'ALTĂ cerere', b => JSON.parse(b));
ok(apeluri === 2, 'o cerere diferită chiar ajunge la model');

// un raspuns care nu trece de validare NU se tine minte
let stricat = 0;
const cs = new ModelClient([per(fals, 'm')]);
cs.unApel = async () => { stricat++; return { text: 'nu e json', usage: { in: 1, out: 1 } }; };
try { await cs.cere('s', 'u', b => JSON.parse(b)); } catch { /* asteptat */ }
try { await cs.cere('s', 'u', b => JSON.parse(b)); } catch { /* asteptat */ }
ok(stricat === 2, 'un răspuns invalid nu se ține minte — se cere din nou');
ModelClient._memorie.clear();

// harta nu creste la nesfarsit
const vechi = ModelClient.MEMORIE_MAX;
ModelClient.MEMORIE_MAX = 3;
for (let i = 0; i < 6; i++) ModelClient.tineMinte('k' + i, 'v');
ok(ModelClient._memorie.size === 3, 'memoria e plafonată');
ok(!ModelClient._memorie.has('k0') && ModelClient._memorie.has('k5'),
   'cele mai vechi intrări ies primele');
ModelClient.MEMORIE_MAX = vechi;
ModelClient._memorie.clear();

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
  noduri: [{ i: 0, id: 'o1', nume: 'PATRAT', w: 150, h: 150, at: { x: 100, y: 250 } },
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
ok(est(user) < 45, `descrierea stării: ${est(user)} tokeni pentru 2 figuri și 2 texte`);
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
  ok(absurd.w === CANVAS_PX && absurd.h === 1,
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

console.log(fail ? `\n### ${fail} TESTE PICATE` : '\n### TOATE TESTELE TREC');
process.exit(fail ? 1 : 0);
