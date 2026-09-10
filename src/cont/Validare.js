// Validare.js — regulile pentru email, nume de utilizator si parola.
//
// Functii PURE: nu ating DOM-ul, nu ating reteaua, nu stiu ca exista Supabase. De aceea
// se pot verifica in `test.mjs`, fara browser — si tocmai de aia stau aici, separat de
// formular. O regula de parola scrisa direct intr-un `onclick` nu se poate proba, deci
// se strica tacut la prima rescriere a paginii.
//
// Se cheama din DOUA locuri, si nu e o dublare:
//   `Autentificare.js`  in timp ce omul scrie, ca sa vada pe loc ce mai lipseste
//   `Cont.inregistreaza` inainte de a pleca spre Supabase, ca sa nu poata fi ocolite
//                        de alt apelant care ar uita de ele
//
// CE NU SUNT REGULILE ASTEA: o aparare. Ele traiesc in browser, iar browserul e al
// omului — cine vrea poate vorbi direct cu API-ul Supabase, cu cheia publica, si sa
// sara peste tot ce scrie aici. Rolul lor e sa spuna limpede ce se asteapta, nu sa
// impiedice pe cineva hotarat. Singura impunere adevarata a parolei sta in
// Supabase Dashboard, la Authentication -> Policies (lungime minima si tipuri de
// caractere cerute), iar acolo trebuie pusa aceeasi cifra ca aici.

/** Cat de scurta poate fi parola. Aceeasi cifra trebuie pusa si in Supabase Dashboard. */
export const PAROLA_MIN = 8;

/** Cat de lung poate fi numele afisat. Peste atat, nu mai incape nicaieri in interfata. */
export const NUME_MIN = 3, NUME_MAX = 32;

/**
 * Un caracter special: orice nu e litera, cifra sau spatiu.
 *
 * Definit prin excludere, nu printr-o lista de semne. O lista scrisa de mana („!@#$…")
 * respinge tacit un „ș" dintr-o parola in romana sau un semn dintr-un alt alfabet, si
 * omul nu are cum sa ghiceasca de ce. `\p{L}` si `\p{N}` acopera toate literele si toate
 * cifrele lumii, deci ce ramane chiar e un semn.
 */
const SPECIAL = /[^\p{L}\p{N}\s]/u;

/**
 * Adresa de email.
 *
 * Ceruta: sa aiba „@" si sa se termine in „.com". Nu e o validare completa de RFC — nici
 * n-are cum sa fie, singura verificare adevarata a unei adrese e sa trimiti un mesaj la
 * ea — dar prinde exact ce s-a cerut, plus formele evident stricate: fara nimic inainte
 * de „@", fara nimic intre „@" si punct, cu spatii inauntru.
 *
 * DACA VREI DOAR ADRESE GMAIL: schimba `\.com$` in `@gmail\.com$` si scoate testul
 * separat pentru „@". Restul codului nu se atinge.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.com$/i;

/**
 * @typedef {{bun: boolean, motiv: string}} Verdict
 */

/** @returns {Verdict} */
export function verificaEmail(email) {
  const e = String(email || '').trim();
  if (!e) return { bun: false, motiv: 'Enter an email address.' };
  if (!e.includes('@')) return { bun: false, motiv: 'The address must contain "@".' };
  if (!/\.com$/i.test(e)) return { bun: false, motiv: 'The address must end in ".com".' };
  if (!EMAIL.test(e)) return { bun: false, motiv: 'That does not look like an email address.' };
  return { bun: true, motiv: '' };
}

/** @returns {Verdict} */
export function verificaNume(nume) {
  const n = String(nume || '').trim();
  if (!n) return { bun: false, motiv: 'Choose a username.' };
  if (n.length < NUME_MIN) {
    return { bun: false, motiv: `The username needs at least ${NUME_MIN} characters.` };
  }
  if (n.length > NUME_MAX) {
    return { bun: false, motiv: `The username can have at most ${NUME_MAX} characters.` };
  }
  return { bun: true, motiv: '' };
}

/**
 * Parola, regula cu regula.
 *
 * Intoarce si lista intreaga, nu doar primul esec: formularul o aprinde pe masura ce
 * omul scrie, si atunci se vede ce mai lipseste, nu doar ce a gresit ultima data.
 *
 * @returns {{bun: boolean, motiv: string, reguli: {text: string, indeplinita: boolean}[]}}
 */
export function verificaParola(parola) {
  const p = String(parola || '');
  const reguli = [
    { text: `at least ${PAROLA_MIN} characters`, indeplinita: p.length >= PAROLA_MIN },
    { text: 'one special character (!, ?, -, …)', indeplinita: SPECIAL.test(p) },
  ];
  const lipsa = reguli.filter(r => !r.indeplinita);
  return {
    bun: lipsa.length === 0,
    motiv: lipsa.length ? 'The password is missing: ' + lipsa.map(r => r.text).join(', ') + '.' : '',
    reguli,
  };
}

/**
 * Tot formularul de cont nou, dintr-o data.
 *
 * Intoarce primul lucru de reparat, in ordinea in care sunt campurile pe ecran — ca omul
 * sa nu fie trimis in jos si inapoi in sus.
 *
 * @returns {Verdict}
 */
export function verificaInregistrare({ email, nume, parola }) {
  for (const v of [verificaEmail(email), verificaNume(nume), verificaParola(parola)]) {
    if (!v.bun) return { bun: false, motiv: v.motiv };
  }
  return { bun: true, motiv: '' };
}
