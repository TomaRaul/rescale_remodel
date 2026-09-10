// AnimationEngine.js — puntea dintre "unde sunt formele acum" si "unde trebuie sa ajunga".
//
// Corespondenta se face pe ID de muchie si pe INDEX de cuvant. Problema reala apare
// cand operatia SCHIMBA numarul de laturi (patrat 4 -> hexagon 6 -> triunghi 3):
//   - muchiile NOI se nasc dintr-un punct (lungime 0) si cresc;
//   - muchiile care DISPAR devin "fantome": se strang catre centrul figurii noi
//     si abia apoi sunt sterse. Asa se vede pe ecran ca 3 laturi au fost extrase,
//     in loc sa dispara brusc.
// Acelasi mecanism se aplica textului cand e scos (marimea merge la 0).

const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function flatten(scene) {
  const f = {};
  for (const e of scene.edges) {
    f[`${e.id}.x1`] = e.x1; f[`${e.id}.y1`] = e.y1;
    f[`${e.id}.x2`] = e.x2; f[`${e.id}.y2`] = e.y2;
  }
  for (const w of scene.words) {
    f[`w${w.i}.x`] = w.x; f[`w${w.i}.y`] = w.y;
    f[`w${w.i}.rot`] = w.rot; f[`w${w.i}.size`] = w.size;
  }
  // Gabaritul panzei e tot un canal numeric, ca oricare altul. Asa elementul de desen
  // creste sau se strange pe ACELASI ceas si aceeasi curba ca formele, in loc sa sara.
  //
  // Si e exact: pozitia unei figuri dupa redimensionare e pozitia veche inmultita cu k,
  // deci interpolarea da pos(t) = pos_vechi * (1 + (k-1)t), iar latura panzei da
  // W(t) = W_vechi * (1 + (k-1)t). Acelasi factor — raportul figura/panza ramane
  // neschimbat in TOATE cadrele, nu doar la capete.
  if (scene.panza) { f['panza.w'] = scene.panza.w; f['panza.h'] = scene.panza.h; }
  return f;
}

function rebuild(template, flat) {
  return {
    // casetele si cadrul de selectie trec neinterpolate: primele se recalculeaza
    // oricum la fiecare layout, al doilea atarna de cursor, nu de vreo animatie
    casete: template.casete || [],
    cadru: template.cadru || null,
    panza: flat['panza.w'] !== undefined
      ? { w: flat['panza.w'], h: flat['panza.h'] }
      : template.panza,
    edges: template.edges.map(e => ({
      ...e,
      x1: flat[`${e.id}.x1`], y1: flat[`${e.id}.y1`],
      x2: flat[`${e.id}.x2`], y2: flat[`${e.id}.y2`],
    })),
    words: template.words.map(w => ({
      ...w,
      x: flat[`w${w.i}.x`], y: flat[`w${w.i}.y`],
      rot: flat[`w${w.i}.rot`], size: flat[`w${w.i}.size`],
    })),
  };
}

const centroid = edges => {
  if (!edges.length) return { x: 0, y: 0 };
  const xs = edges.flatMap(e => [e.x1, e.x2]), ys = edges.flatMap(e => [e.y1, e.y2]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

export class AnimationEngine {
  constructor(onFrame, duration = 900) {
    this.onFrame = onFrame;
    this.duration = duration;
    this.current = null;   // canalele numerice curente
    this.stable = null;    // ultima scena reala (fara fantome)
    this.running = false;
  }

  goTo(scene, instant = false) {
    if (instant || !this.current) {
      this.current = flatten(scene);
      this.stable = scene;
      this.template = scene;
      this.ghostKeys = [];
      this.onFrame(scene);
      return;
    }

    const prev = this.stable;
    const c = centroid(scene.edges);

    // --- ce dispare devine fantoma, cu tinta stransa in centrul figurii noi
    const keepE = new Set(scene.edges.map(e => e.id));
    const ghostE = prev.edges.filter(e => !keepE.has(e.id))
      .map(e => ({ ...e, x1: c.x, y1: c.y, x2: c.x, y2: c.y, ghost: true }));

    const keepW = new Set(scene.words.map(w => w.i));
    const ghostW = prev.words.filter(w => !keepW.has(w.i))
      .map(w => ({ ...w, size: 0, ghost: true }));

    this.template = {
      edges: [...scene.edges, ...ghostE],
      words: [...scene.words, ...ghostW],
      casete: scene.casete || [],
      cadru: scene.cadru || null,
      panza: scene.panza,
    };
    this.ghostKeys = flattenKeys(ghostE, ghostW);

    const to = flatten(this.template);
    const from = { ...this.current };

    // --- ce apare pentru prima data porneste dintr-un punct si creste
    for (const e of scene.edges) {
      if (`${e.id}.x1` in from) continue;
      const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
      from[`${e.id}.x1`] = mx; from[`${e.id}.y1`] = my;
      from[`${e.id}.x2`] = mx; from[`${e.id}.y2`] = my;
    }
    for (const w of scene.words) {
      if (`w${w.i}.x` in from) continue;
      from[`w${w.i}.x`] = w.x; from[`w${w.i}.y`] = w.y;
      from[`w${w.i}.rot`] = w.rot; from[`w${w.i}.size`] = 0;
    }
    for (const k of Object.keys(to)) if (!(k in from)) from[k] = to[k];

    // rotatia pe drumul cel mai scurt
    for (const k of Object.keys(to)) {
      if (!k.endsWith('.rot')) continue;
      let d = to[k] - from[k];
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      to[k] = from[k] + d;
    }

    this.from = from;
    this.to = to;
    this.stable = scene;
    this.t0 = performance.now();
    if (!this.running) { this.running = true; requestAnimationFrame(this.tick); }
  }

  tick = (now) => {
    const raw = Math.min(1, (now - this.t0) / this.duration);
    const t = easeInOutCubic(raw);

    const cur = {};
    for (const k of Object.keys(this.to)) cur[k] = this.from[k] + (this.to[k] - this.from[k]) * t;
    this.current = cur;
    this.onFrame(rebuild(this.template, cur));

    if (raw < 1) { requestAnimationFrame(this.tick); return; }

    // animatia s-a terminat: fantomele si-au facut treaba, le stergem definitiv
    this.running = false;
    for (const k of this.ghostKeys) delete this.current[k];
    this.ghostKeys = [];
    this.template = this.stable;
    this.onFrame(rebuild(this.stable, this.current));
  };
}

function flattenKeys(edges, words) {
  return [
    ...edges.flatMap(e => [`${e.id}.x1`, `${e.id}.y1`, `${e.id}.x2`, `${e.id}.y2`]),
    ...words.flatMap(w => [`w${w.i}.x`, `w${w.i}.y`, `w${w.i}.rot`, `w${w.i}.size`]),
  ];
}
