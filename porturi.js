// porturi.js — cine asculta unde, si ce pagina serveste.
//
// Sta separat de `serve.js` fiindca il citesc DOUA lucruri: serverul insusi si proba de
// sanatate a containerului (`sanatate.mjs`). Cat timp harta statea in `serve.js`, proba
// din Dockerfile isi avea propria copie a cifrelor — iar o schimbare de port trecea
// neobservata acolo si containerul aparea „unhealthy" fara motiv vizibil.
//
// UN PROCES SAU TREI
//
// Fara `ROL`, un singur proces asculta pe toate trei porturile — asa merge `npm start`,
// si asa a mers si primul docker-compose. Cu `ROL` pus, procesul serveste O SINGURA
// pagina, pe portul ei: atunci se pornesc trei containere, cate unul pe rol, si se poate
// porni doar o parte din ele.
//
// Rutele /api/* raspund la fel in oricare dintre variante, pe orice port. De aceea cele
// trei containere NU trebuie sa vorbeasca intre ele: fiecare pagina isi cere datele de
// la containerul ei, pe aceeasi origine, si toate trei ajung la acelasi Supabase.
//
// Functiile primesc mediul ca parametru, cu `process.env` ca implicit. Nu e o
// preferinta de stil: asa se pot verifica in `test.mjs`, unde un modul deja incarcat
// n-ar mai reciti variabilele daca le-ar fi citit la import.

/** Rolurile, in ordinea in care le vede omul. */
export const ROLURI_TOATE = ['poarta', 'panze', 'panza'];

/** Ce pagina raspunde la „/" pentru fiecare rol. */
export const PAGINI = { poarta: 'index.html', panze: 'panze.html', panza: 'app.html' };

/** Cum se numeste fiecare rol cand i se spune omului ce s-a pornit. */
export const DESCRIERI = {
  poarta: 'sign in',
  panze: 'canvas picker',
  panza: 'canvas',
};

/**
 * Numele acceptate pentru un rol.
 *
 * Codul e in romana, dar containerele se cheama „log", „canvas-selection" si „canvas".
 * Ca sa nu fie nevoie de o traducere tinuta minte pe dinafara, `ROL` accepta ambele
 * feluri de a le scrie: `ROL=canvas` si `ROL=panza` inseamna acelasi lucru.
 */
const NUME = {
  poarta: 'poarta', log: 'poarta', login: 'poarta', autentificare: 'poarta',
  panze: 'panze', 'canvas-selection': 'panze', selection: 'panze', alegere: 'panze',
  panza: 'panza', canvas: 'panza', app: 'panza',
};

/** Portul fiecarui rol, dupa mediu. */
export function porturi(env = process.env) {
  return {
    poarta: Number(env.PORT_POARTA) || Number(env.PORT) || 8080,
    panze: Number(env.PORT_PANZE) || 8082,
    panza: Number(env.PORT_PANZA) || 8081,
  };
}

/**
 * Rolul acestui proces, sau `null` cand le serveste pe toate.
 *
 * Un `ROL` scris gresit NU se ignora si nu cade pe un implicit: se arunca. Un container
 * pornit cu `ROL=canvass` care ar servi tacut poarta e mai rau decat unul care refuza sa
 * porneasca si spune de ce.
 */
export function rol(env = process.env) {
  const brut = String(env.ROL || '').trim().toLowerCase();
  if (!brut) return null;
  const r = NUME[brut];
  if (!r) {
    throw new Error(`ROL necunoscut: „${brut}". Acceptate: `
      + [...new Set(Object.keys(NUME))].join(', '));
  }
  return r;
}

/** Rolurile pe care le serveste ACEST proces: unul singur, sau toate trei. */
export function roluriDeServit(env = process.env) {
  const r = rol(env);
  return r ? [r] : [...ROLURI_TOATE];
}

/**
 * Ce roluri EXISTA in toata instalarea — nu neaparat in procesul asta.
 *
 * Conteaza cand se pornesc doar doua containere din trei. Paginile se trimit una la alta
 * dupa porturile anuntate de `/api/config`; daca ar fi anuntat si unul care nu ruleaza,
 * omul ar fi trimis dupa autentificare intr-un port care nu raspunde, si n-ar avea de
 * unde sa stie de ce.
 *
 * Implicit: toate trei. Cine porneste o parte le enumera pe cele pornite, in `ROLURI`.
 */
export function roluri(env = process.env) {
  const brut = String(env.ROLURI || '').trim();
  if (!brut) return [...ROLURI_TOATE];
  const alese = brut.split(',').map(s => NUME[s.trim().toLowerCase()]).filter(Boolean);
  return alese.length ? [...new Set(alese)] : [...ROLURI_TOATE];
}

/** Porturile pe care le anunta `/api/config`: doar ale rolurilor care chiar exista. */
export function porturiAnuntate(env = process.env) {
  const toate = porturi(env), exista = roluri(env);
  return Object.fromEntries(Object.entries(toate).filter(([r]) => exista.includes(r)));
}

/** Portul pe care raspunde proba de sanatate: al rolului propriu, altfel al portii. */
export function portulMeu(env = process.env) {
  return porturi(env)[roluriDeServit(env)[0]];
}
