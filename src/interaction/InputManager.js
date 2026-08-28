// InputManager.js — selectia obiectelor prin click pe panza.
//
// Un click alege obiectul cel mai apropiat de cursor. Cu Shift (sau Ctrl) se
// ADAUGA la selectie, ca sa poti lucra pe mai multe obiecte simultan.
// Click in gol deselecteaza tot.
//
// Nu stie nimic despre figuri sau grila: primeste scena deja desenata si intoarce
// id-ul obiectului atins. Atat.

/** Distanta de la punct la segmentul AB. */
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {() => {edges:Array, words:Array}} getScene
   * @param {(id:string|null, aditiv:boolean) => void} onSelect
   */
  constructor(canvas, getScene, onSelect, ax = { l: 0, t: 0 }, prag = 20) {
    this.m = { l: 0, t: 0, ...ax };   // click-ul se raporteaza la zona de desen, nu la element
    this.canvas = canvas;
    this.getScene = getScene;
    this.onSelect = onSelect;
    this.prag = prag;
    canvas.addEventListener('click', e => this.handle(e));
    canvas.style.cursor = 'pointer';
  }

  handle(e) {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left - this.m.l;
    const py = e.clientY - r.top - this.m.t;
    const aditiv = e.shiftKey || e.ctrlKey || e.metaKey;

    const scene = this.getScene();
    if (!scene || !scene.edges) return;

    let best = null, bestD = Infinity;
    for (const edge of scene.edges) {
      if (edge.ghost || !edge.obj) continue;
      const d = distToSeg(px, py, edge.x1, edge.y1, edge.x2, edge.y2);
      if (d < bestD) { bestD = d; best = edge.obj; }
    }

    // textul e si el o tinta: un click pe cuvant selecteaza obiectul lui
    for (const w of scene.words || []) {
      if (!w.obj || !(w.size > 0)) continue;
      const d = Math.hypot(px - w.x, py - w.y);
      if (d < bestD) { bestD = d; best = w.obj; }
    }

    this.onSelect(bestD <= this.prag && best ? best : null, aditiv);
  }
}
