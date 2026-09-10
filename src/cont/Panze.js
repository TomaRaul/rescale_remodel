// Panze.js — depozitul, vazut din browser.
//
// Nicio cerere de aici nu pleaca spre Supabase. Toate merg spre PROPRIUL server, la
// `/api/panze`, cu jetonul in antetul `Authorization`. Serverul il valideaza, afla din
// el cine esti, si abia el atinge baza de date.
//
// De ce nu direct din browser, cand clientul Supabase stie si asta: fiindca atunci
// cine e utilizatorul ar fi o afirmatie a paginii, iar pagina e a lui. Aici e o
// afirmatie a serverului, verificata pe un jeton semnat. Serverul ramane singurul
// dispecer — acelasi tipar ca la `/api/parse`, unde cheia modelului nu are ce cauta
// in JS-ul din browser.
//
// Formatul unei panze e cel scris de `Scene.toJSON`. Modulul asta nu-l citeste si nu-l
// intelege: il duce si il aduce.

const BAZA = '/api/panze';

/**
 * O cerere catre depozit, cu jetonul atasat.
 *
 * Serverul raspunde cu JSON si la reusita si la esec, deci mesajul lui ajunge intreg la
 * om: „sesiune invalidă" si „pânza nu există" sunt lucruri diferite si merita spuse
 * diferit. Fara asta, orice ar pica ar arata la fel — „nu s-a putut salva".
 */
async function cerere(jeton, cale, opt = {}) {
  if (!jeton) throw new Error('you are not signed in');
  const r = await fetch(cale, {
    ...opt,
    headers: {
      ...(opt.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: 'Bearer ' + jeton,
      ...(opt.headers || {}),
    },
    // aceeasi plasa ca la /api/parse: o cerere care atarna nu tine butonul stins la infinit
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

/**
 * Salveaza scena sub un nume.
 *
 * Acelasi nume rescrie pânza de dinainte, nu adauga inca un rand: „Salvează" apasat de
 * zece ori pe acelasi desen trebuie sa dea o pânză, nu zece. Cine vrea o copie ii da
 * alt nume — asta e si singurul fel de a spune „salvează ca".
 */
export const salveaza = (jeton, nume, continut) =>
  cerere(jeton, BAZA, { method: 'POST', body: JSON.stringify({ nume, continut }) });

/** Panzele contului, cele mai noi intai. Fara continut: doar id, nume si data. */
export const lista = jeton => cerere(jeton, BAZA).then(r => r.panze || []);

/** Continutul unei panze anume. */
export const adu = (jeton, id) => cerere(jeton, BAZA + '/' + encodeURIComponent(id));

export const sterge = (jeton, id) =>
  cerere(jeton, BAZA + '/' + encodeURIComponent(id), { method: 'DELETE' });
