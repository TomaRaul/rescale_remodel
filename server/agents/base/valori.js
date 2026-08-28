// base/valori.js — marimile si micile unelte pe care le folosesc toti agentii.
//
// Aici stau doar lucrurile care nu apartin niciunui domeniu: pretul pe care il
// plateste geometria si textul deopotriva. Orice cunoastere despre figuri sau
// despre cuvinte sta in clasa agentului respectiv, nu aici.

export const NL = String.fromCharCode(10);

/** Latura panzei, in pixeli. Coordonatele in afara ei sunt respinse la validare. */
export const PANZA = 800;

/**
 * Prima cheie prezenta din lista.
 *
 * Modelul emite forma scurta — `o`, `w`, `p` — dar parserul local de rezerva emite
 * forma lunga, iar un model care ignora scurtarile nu trebuie sa esueze din cauza
 * asta. Amandoua trec prin acelasi drum: `ia(g, 'o', 'op')`.
 */
export const ia = (o, ...chei) => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of chei) if (o[k] !== undefined) return o[k];
  return undefined;
};

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Numar de pixeli, rotunjit si tinut pe panza. */
export const cel = v => clamp(Math.round(Number(v)), 1, PANZA);

/** Punct, fie ca vine ca [x,y] (forma minificata) fie ca {x,y} (forma lunga). */
export const punct = q => {
  if (!q) return null;
  const [rx, ry] = Array.isArray(q) ? q : [q.x, q.y];
  const x = Math.round(Number(rx)), y = Math.round(Number(ry));
  return Number.isInteger(x) && Number.isInteger(y)
      && x >= 0 && x <= PANZA && y >= 0 && y <= PANZA ? { x, y } : null;
};

/** Fara diacritice si cu litere mici: tiparele de rutare se scriu o singura data. */
export const norm = t => String(t).toLowerCase()
  .replace(/[ăâ]/g, 'a').replace(/î/g, 'i')
  .replace(/[șş]/g, 's').replace(/[țţ]/g, 't');

/**
 * Tinta comenzii.
 *
 * Un NUMAR e o figura: 0, 1, 2 ... in ordinea crearii. Un „t1" e un TEXT, din seria
 * lui, in ordinea in care au fost scrise. Cele doua numerotari sunt independente,
 * tocmai ca „figura 1" sa insemne mereu a doua figura, oricate texte ar fi intre ele.
 * Id-urile interne `oN` raman tolerate.
 *
 * Nu apartine niciunui domeniu — si geometrul si tipograful spun pe cine cade comanda.
 */
export function tinta(d, out) {
  const tg = ia(d, 'n', 'target');
  if (!Array.isArray(tg)) return out;
  const bune = tg.map(x => {
    const k = Number(x);
    if (Number.isInteger(k) && k >= 0 && k < 64) return k;
    const s = String(x).toLowerCase();
    return /^[ot][0-9]+$/.test(s) ? s : null;
  }).filter(x => x !== null).slice(0, 32);
  if (bune.length) out.target = bune;
  return out;
}

/** Motivul scurt pe care il intoarce modelul, taiat la o lungime rezonabila. */
export function motiv(d) {
  const why = ia(d, 'y', 'why');
  return typeof why === 'string' ? why.slice(0, 80) : '';
}
