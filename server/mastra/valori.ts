// mastra/valori.ts — marimile si micile unelte pe care le folosesc toti agentii.
//
// Aici stau doar lucrurile care nu apartin niciunui domeniu: pretul pe care il
// plateste geometria si textul deopotriva. Orice cunoastere despre figuri sau
// despre cuvinte sta in promptul si schema agentului respectiv, nu aici.
//
// Fisierul asta nu importa nimic din Mastra: e aceeasi aritmetica de dinainte de
// migrare, si tot ea tine testele de validare in picioare.

export const NL = String.fromCharCode(10);

/**
 * Latura panzei de PORNIRE, in pixeli. Atat descrie promptul de sistem, si tot dupa ea
 * se hotaraste daca starea mai trebuie sa poarte o linie cu gabaritul de acum.
 */
export const PANZA = 800;

/**
 * Cat poate ajunge panza, pe latura. Aici e plafonul VALIDARII: coordonatele si
 * marimile de peste el se resping.
 *
 * Nu se confunda cu cea de pornire. Serverul nu stie cat e panza in clipa asta — o afla
 * din stare, dar validarea se face pe forma raspunsului, inainte — deci taie dupa cel
 * mai mare gabarit cu putinta. Ce trece de aici si totusi nu incape pe panza de acum e
 * oprit in motor, de „inCanvas", care stie exact cat e.
 */
export const PANZA_MAX = 1200;

/**
 * Prima cheie prezenta din lista.
 *
 * Modelul emite forma scurta — `o`, `w`, `p` — dar parserul local de rezerva emite
 * forma lunga, iar un model care ignora scurtarile nu trebuie sa esueze din cauza
 * asta. Amandoua trec prin acelasi drum: `ia(g, 'o', 'op')`.
 */
export const ia = (o: unknown, ...chei: string[]): unknown => {
  if (!o || typeof o !== 'object') return undefined;
  const rec = o as Record<string, unknown>;
  for (const k of chei) if (rec[k] !== undefined) return rec[k];
  return undefined;
};

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Numar de pixeli, rotunjit si tinut pe cea mai mare panza cu putinta. */
export const cel = (v: unknown) => clamp(Math.round(Number(v)), 1, PANZA_MAX);

export type Punct = { x: number; y: number };

/** Punct, fie ca vine ca [x,y] (forma minificata) fie ca {x,y} (forma lunga). */
export const punct = (q: unknown): Punct | null => {
  if (!q) return null;
  const [rx, ry] = Array.isArray(q)
    ? q
    : [(q as Punct).x, (q as Punct).y];
  const x = Math.round(Number(rx)), y = Math.round(Number(ry));
  return Number.isInteger(x) && Number.isInteger(y)
      && x >= 0 && x <= PANZA_MAX && y >= 0 && y <= PANZA_MAX ? { x, y } : null;
};

/** Fara diacritice si cu litere mici: tiparele de rutare se scriu o singura data. */
export const norm = (t: unknown) => String(t).toLowerCase()
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
export function tinta(d: unknown, out: Record<string, unknown>) {
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
export function motiv(d: unknown) {
  const why = ia(d, 'y', 'why');
  return typeof why === 'string' ? why.slice(0, 80) : '';
}
