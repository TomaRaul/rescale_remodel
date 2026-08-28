// PromptParser.js — legatura cu modelul, plus o rezerva locala pe regex.
//
// Calea normala e `parseRemote`: promptul pleaca prin proxy-ul din serve.js catre
// agenti. Cand aceea pica — cheie lipsa, cota epuizata, retea moarta — se cade pe
// `parse`, care recunoaste local cateva forme uzuale.
//
// Rezerva NU incearca sa concureze modelul. Trebuie doar sa nu mint: ori intoarce
// ceva ce motorul chiar stie sa aplice, ori spune limpede ca n-a inteles. Un DSL
// plauzibil, dar cu operatii inexistente, e mai rau decat un refuz — pare ca s-a
// intamplat ceva si nu se intampla nimic.
//
// DSL-ul curent, acelasi pe care il emit agentii:
//   geom: { op:'rect',   w, h, at:{x,y}, anchor }
//         { op:'canvas_resize', w, h }   gabaritul PANZEI, nu al figurilor
//         { op:'split',  into, dir }
//         { op:'resize', scale }  |  { op:'resize', w, h }
//         { op:'move',   at:{x,y} }
//         { op:'clear' }
//   text: { set:[...] } | { add:[...] } | { scale } |
//         { bind:'inside'|'pieces'|'path'|'sides'|'side'|'corners'|'corner'|'point'|
//                'box'|'none',
//           at, in, repeat, box:{w,h}, boxDelta }

const NUM = { o: 1, un: 1, una: 1, doua: 2, doi: 2, trei: 3, patru: 4, cinci: 5, sase: 6 };

const norm = s => s.toLowerCase()
  .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't');

const num = tok => (tok in NUM ? NUM[tok] : parseInt(tok, 10));

/**
 * Cererea cere limpede INLOCUIREA textului, nu adaugarea lui langa cel vechi?
 *
 * Modelul alege inconsecvent intre `set` si `add`, iar App are o plasa: fara un verb
 * de inlocuire, un `set` primit devine `add`. Lista a inceput scurta si a costat —
 * „rescrie textul ca PISICA" nu era pe ea, asa ca inlocuirea devenea adaugare si
 * vechiul text ramanea pe panza, sub cel nou. Fiecare fel de a spune „in loc de"
 * care lipseste de aici se vede pe ecran ca doua texte suprapuse.
 */
export const cereInlocuire = prompt =>
  /(in loc|inlocui|rescri|schimb|modific|corect|actualiz|redenum|transform|sterg|elimin|scoate)/
    .test(norm(prompt));

/**
 * Despre ce e cererea, in cuvinte: PANZA sau obiectele de pe ea.
 *
 * Interfata are doua casete de comanda si fiecare o refuza pe cealalta. Tiparele stau
 * AICI, nu in App, ca sa fie unul singur: acelasi text decide si ce recunoaste rezerva
 * locala, si ce nici nu pleaca spre model.
 *
 * Sunt tipare de REFUZ, deci lipsa lor nu inseamna nimic: „mareste" nu se potriveste
 * cu niciunul si merge mai departe, in caseta in care a fost scris. Doar cererile care
 * spun limpede ca sunt in caseta gresita se opresc.
 */
const DESPRE_PANZA = /\b(panz|canvas|zona de desen)/;
const DESPRE_OBIECTE = /\b(figur|dreptunghi|patrat|forma|obiect|text|scri|rescri|cuvint|cuvant|cuvinte|font|caset|chenar|casut)/;

/** Cererea vorbeste despre panza? */
export const cerePanza = prompt => DESPRE_PANZA.test(norm(prompt));

/** Cererea vorbeste despre figuri sau despre text? */
export const cereObiecte = prompt => DESPRE_OBIECTE.test(norm(prompt));

const N = String.raw`(\d+|o|un|una|doi|doua|trei|patru|cinci|sase)`;

/** Caseta de text — „caseta", „chenar", „casuta", „text box". */
const CASETA = /\bcaset|\bchenar|\bcasut|\btext ?box/;

/**
 * Marimea casetei, in pixeli: „o caseta de 300 pe 80", „un chenar de 240".
 * Fara inaltime, caseta se strange singura pe randuri — de aceea h ramane 0.
 */
function marimeCaseta(p) {
  const m = p.match(/\b(?:caset|chenar|casut)\w*\s+(?:de|cu)?\s*(\d{1,4})\s*(?:pe|x|\/)\s*(\d{1,4})/);
  if (m) return { w: +m[1], h: +m[2] };
  const l = p.match(/\b(?:caset|chenar|casut)\w*\s+(?:de|cu)\s+(\d{1,4})\s*(?:px|pixeli)?/);
  return l ? { w: +l[1], h: 0 } : null;
}

/**
 * Cu cati pixeli se schimba caseta: „mareste caseta cu 20 de pixeli".
 *
 * Doar diferenta, nu marimea finala — cat e acum stie motorul, nu promptul.
 * Cand cererea da DOUA cifre — „cu 50x200", „cu 30 pe latime si 100 pe inaltime" —
 * intoarce o pereche, ca sa creasca fiecare axa cu cat s-a cerut. Cu un singur
 * numar, a doua axa se pierdea si caseta crestea doar pe orizontala.
 *
 * @returns {number|{w:number,h:number}|null} pixelii de adaugat, negativ la micsorare
 */
function casetaDelta(p) {
  if (!CASETA.test(p)) return null;
  const semn = /\b(mareste|mai mare|creste|extinde|lateste)/.test(p) ? 1
             : /\b(micsorea|mai mic|scade|redu|ingusteaza|strange)/.test(p) ? -1 : 0;
  if (!semn) return null;

  // fiecare axa numita pe rand: „cu 30 pe latime si 100 pe inaltime"
  const lat = p.match(/(\d{1,4})\s*(?:px|pixeli)?\s+(?:pe|in)\s+(?:latime|lungime)/);
  const inalt = p.match(/(\d{1,4})\s*(?:px|pixeli)?\s+(?:pe|in)\s+(?:inaltime|inaltimea)/);
  if (lat && inalt) return { w: semn * +lat[1], h: semn * +inalt[1] };

  // doua cifre lipite: „cu 50x200", „cu 50 pe 200"
  const pereche = p.match(/\bcu\s+(\d{1,4})\s*(?:x|pe|\/)\s*(\d{1,4})/);
  if (pereche) return { w: semn * +pereche[1], h: semn * +pereche[2] };

  const unul = p.match(/\bcu\s+(\d{1,4})/);
  return unul && +unul[1] > 0 ? semn * +unul[1] : null;
}

/**
 * Un punct din prompt: „la 400,400", „in punctul (25, 25)",
 * „in punctul de coordonate 325, 325".
 *
 * Intre cuvantul care anunta pozitia si cifre pot sta cateva cuvinte de umplutura,
 * de aceea saltul de pana la 30 de caractere. Fara el, „in punctul de coordonate
 * 325, 325" nu era recunoscut — si exact asa arata cererile scrise pe indelete.
 */
function punctDin(p) {
  const m = p.match(/\b(?:la|in|punctul|pozitia|coordonate|coordonatele)\b[^\d]{0,30}?(\d{1,4})\s*[,\s]\s*(\d{1,4})\b/);
  if (!m) return null;
  const x = +m[1], y = +m[2];
  return x >= 0 && x <= 800 && y >= 0 && y <= 800 ? { x, y } : null;
}

/**
 * Bucata capturata descrie o POZITIE, nu un continut de scris.
 * „rescrie textul in coltul din dreapta" cere o mutare, nu cuvantul „COLTUL".
 */
const ePozitie = t => /\b(colt|latur|mijloc|centru|punct|caset|chenar|interior|inauntru|contur|stanga|dreapta|sus|jos|fiecare|piesa|figur)/.test(t);

/** Cererea vorbeste despre un punct anume, nu doar despre o figura asezata undeva. */
const cerePunct = p => /\bpunct|\bcoordonat/.test(p);

/**
 * Care TEXT anume priveste cererea: „textul 1", „al doilea text".
 *
 * Textele au seria lor, T0, T1 ..., separata de cea a figurilor. Fara regula asta
 * rezerva locala aplica orice comanda de text pe TOATE textele obiectului, deci se
 * purta altfel decat modelul, care stie sa tinteasca unul singur.
 *
 * @returns {string[]|null} tinta in forma pe care o citeste App: ['t1']
 */
const ORDINAL = { primul: 0, prima: 0, doilea: 1, doua: 1, treilea: 2, treia: 2, patrulea: 3, patra: 3 };

function tintaTextDin(p) {
  const m = p.match(/\btext\w*\s+(\d{1,2})\b/);
  if (m) return ['t' + Number(m[1])];
  const o = p.match(/\b(?:al|a)\s+(primul|prima|doilea|doua|treilea|treia|patrulea|patra)\s+text/);
  return o ? ['t' + ORDINAL[o[1]]] : null;
}

/**
 * Care latura o priveste cererea.
 *
 * Substantivul se potriveste ca `latur\w*`, ca sa prinda si genitivul: „laturii de
 * jos", nu doar „latura de jos". Cu forma fixa, „deasupra laturii de jos" nu potrivea
 * nicio latura si cadea pe alternativa `deasupra`, care inseamna latura de SUS — adica
 * exact opusul cererii.
 *
 * Directia se cauta INAINTEA prepozitiilor: „deasupra" si „sub" spun pe ce parte cade
 * textul, nu care latura e. Latura o spune „sus/jos/stanga/dreapta".
 */
function laturaDin(p) {
  const NUME = [
    ['top',    /\blatur\w*\s+(?:de\s+|din\s+)?(?:sus|superioar)/],
    ['bottom', /\blatur\w*\s+(?:de\s+|din\s+)?(?:jos|inferioar)/],
    ['left',   /\blatur\w*\s+(?:de\s+|din\s+)?stanga/],
    ['right',  /\blatur\w*\s+(?:de\s+|din\s+)?dreapta/],
  ];
  for (const [nume, re] of NUME) if (re.test(p)) return nume;
  // fara cuvantul „latura", pozitia se da fata de figura intreaga
  if (/\bdeasupra\b/.test(p)) return 'top';
  if (/\bdedesubt\b|\bsub figur|\bsub patrat|\bsub dreptunghi/.test(p)) return 'bottom';
  return null;
}

/**
 * Textul cade INAUNTRUL laturii sau in afara ei.
 *
 * Implicit in afara, lipit de latura. Doua feluri de a cere interiorul:
 *   explicit   „in interiorul laturii de sus", „inauntrul laturii din stanga"
 *   prin sens  „SUB o latura de sus", „DEASUPRA uneia de jos" — prepozitia arata
 *              spre centrul figurii, deci textul cade inauntru
 *
 * Explicitul bate sensul: „in exteriorul laturii de sus" ramane afara chiar daca
 * fraza mai contine un „sub".
 */
function interiorulLaturii(p, latura) {
  if (/\bin\s+exterior|\bin\s+afara|\bpe\s+dinafara/.test(p)) return false;
  if (/\bin\s+interior|\binauntr|\bpe\s+dinauntru/.test(p)) return true;
  if (latura === 'top' && /\bsub\b/.test(p)) return true;
  if (latura === 'bottom' && /\bdeasupra\b/.test(p)) return true;
  return false;
}

/** Ancora: ce anume din figura cade in punct. */
function ancoraDin(p) {
  if (!/\bcolt|\bmijlocul laturii|\blatura de/.test(p)) return null;
  if (/(stanga[^.]*jos|jos[^.]*stanga)/.test(p)) return 'bl';
  if (/(dreapta[^.]*jos|jos[^.]*dreapta)/.test(p)) return 'br';
  if (/(stanga[^.]*sus|sus[^.]*stanga)/.test(p)) return 'tl';
  if (/(dreapta[^.]*sus|sus[^.]*dreapta)/.test(p)) return 'tr';
  return null;
}

/** Latimea si inaltimea: „300 pe 150", „300x150", „un patrat de 200". */
function marimeDin(p) {
  let m = p.match(new RegExp(String.raw`(\d{1,4})\s*(?:pe|x|\/)\s*(\d{1,4})`));
  if (m) return { w: +m[1], h: +m[2] };
  m = p.match(/\b(?:patrat|dreptunghi|figura|forma)\w*\s+(?:de|cu)\s+(\d{1,4})/);
  if (m) return { w: +m[1], h: +m[1] };
  m = p.match(/\bde\s+(\d{1,4})\s*(?:px|pixeli)/);
  if (m) return { w: +m[1], h: +m[1] };
  return null;
}

/**
 * Gabaritul cerut pentru panza. Fara cifre intoarce operatia fara marime, ca `parse`
 * sa poata spune limpede „nu stiu cat de mare" in loc sa ghiceasca.
 */
function panzaDin(p) {
  const unul = p.match(/\b(?:de|la)\s+(\d{1,4})\s*(?:px|pixeli)?(?!\s*(?:pe|x|\/))/);
  const d = marimeDin(p) || (unul ? { w: +unul[1], h: +unul[1] } : null);
  return d ? { op: 'canvas_resize', w: d.w, h: d.h } : { op: 'canvas_resize' };
}

/**
 * @param {string} p cererea, normalizata
 * @param {'panza'|'figuri'} [doar] din ce caseta de comanda vine
 */
function geometrie(p, doar) {
  // Caseta panzei: orice s-ar scrie in ea e despre gabarit, deci nu se mai incearca
  // niciun alt tipar. Tocmai asta e rostul ei — „mareste" scris acolo nu mai are cum
  // sa ajunga o marire de figura, oricat de ambiguu ar fi cuvantul.
  if (doar === 'panza') return panzaDin(p);

  if (/\b(clear|goleste|sterge tot|sterge scena|scena goala|reset)/.test(p)) {
    return { op: 'clear' };
  }

  // PANZA insasi, nu figurile de pe ea: „micsoreaza panza la 250 pe 100",
  // „fa panza 400 pe 400". Verificata INAINTEA marimii si a crearii — altfel
  // „fa panza 400 pe 400" ar fi citit ca o figura de 400x400, iar „micsoreaza panza"
  // ca o scalare a figurilor de pe ea. In caseta figurilor nu se incearca deloc.
  if (doar !== 'figuri' && /\bpanz|\bcanvas|\b(scena|zona) de desen/.test(p)) {
    return panzaDin(p);
  }

  // taierea in bucati
  if (/\b(imparte|impart|taie|split|injumatat)/.test(p)) {
    const m = p.match(new RegExp(N + String.raw`\s*(?:dreptunghi|bucat|part|piese|jumatat)`))
           || p.match(new RegExp(String.raw`\bin\s+` + N));
    const g = { op: 'split', into: m ? num(m[1]) : 2 };
    if (/\borizontal|pe orizontala|in randuri/.test(p)) g.dir = 'h';
    else if (/\bvertical|pe verticala|in coloane/.test(p)) g.dir = 'v';
    return g;
  }

  // marimea, dar NU cand cererea vorbeste despre text
  const despreText = /\b(text|scris|cuvint|cuvant|cuvinte|font|caset|chenar|casut)/.test(p);
  if (!despreText && /\b(mareste|mai mare|dublu|dubleaza)/.test(p)) {
    return { op: 'resize', scale: /\bdubl/.test(p) ? 2 : 1.5 };
  }
  if (!despreText && /\b(micsorea|mai mic|jumatate|injumatateste)/.test(p)) {
    return { op: 'resize', scale: 0.5 };
  }

  const at = punctDin(p);
  const dim = marimeDin(p);

  // mutarea schimba doar locul; are nevoie de un punct
  if (/\b(muta|mutare|deplas)/.test(p) && !despreText) {
    return at ? { op: 'move', at } : null;
  }

  // redimensionare exacta
  if (/\bredimension|\bfa-l de\b|\bdimensiunea\b/.test(p) && dim) {
    return { op: 'resize', w: dim.w, h: dim.h };
  }

  // figura noua: are nevoie de un verb de creare SAU de o forma cu dimensiuni
  // „adauga" si „pune" se potrivesc si figurilor si textului, deci au aceeasi exceptie
  // ca in Router: nu creeaza nimic cand sunt urmate de un cuvant despre scris.
  // Fara ea, „pune textul sub figura" era citit ca „fa o figura" — fara dimensiuni,
  // deci rezerva raspundea „nu stiu cat de mare" in loc sa aseze textul.
  const creeaza = /\b(fa|fac|creeaza|genereaza|deseneaza|vreau|inca un|inca o)\b/.test(p)
    || /\b(adauga|pune)(?!\w*\s+(?:tot|toata|toate|toti)?\s*(?:text|scris|cuvint|cuvant|caset|chenar|casut))\b/.test(p);
  const forma = /\b(patrat|dreptunghi|figura|forma)/.test(p);
  if ((creeaza && forma) || (forma && dim)) {
    const g = { op: 'rect' };
    if (dim) { g.w = dim.w; g.h = dim.h; }
    if (at) g.at = at;
    const anc = ancoraDin(p);
    if (anc) g.anchor = anc;
    return g;
  }

  return null;
}

function text(p, prompt) {
  // Fara un cuvant despre scris, cererea nu e despre text. Altfel „un patrat cu
  // coltul stanga jos in punctul 25,25" ar produce si o legare de text, desi
  // punctul acela e ancora figurii, nu locul unui cuvant.
  if (!/\b(scrie|scrii|rescri|text|scris|cuvint|cuvant|cuvinte|font|caset|chenar|casut)/.test(p)) return null;

  // ce anume sa scrie: „scrie ALFA BETA", „scrie X in loc de text"
  const inlocuire = p.match(/\b(?:scrie|pune|inlocuieste)\s+(?:cuvintele?\s+)?(.+?)\s+in loc(?:ul)? de\s+/)
                 || p.match(/\bin loc(?:ul)? de\s+text\w*\s+(?:pune|scrie)\s+(.+)$/);
  // „rescrie textul ca PISICA", „rescrie MIAU cu PISICA", „rescrie PISICA".
  // Verbul nu incepe cu „scrie", deci tiparul de mai jos nu-l prindea, iar cererea
  // trecea ca si cum n-ar fi spus nimic despre continut.
  const rescriere = p.match(/\brescri\w*\s+(?:(?:\S+\s+)?(?:ca|cu|in|la)\s+)?(.+)$/);

  let cuvinte = null;
  if (inlocuire) {
    cuvinte = curataCuvinte(inlocuire[1], prompt);
  } else if (rescriere && !ePozitie(rescriere[1])) {
    cuvinte = curataCuvinte(rescriere[1], prompt);
  } else {
    // „scrie MIAU", „scrie MIAU in figura" — se opreste inainte de partea de pozitie
    const m = p.match(/\b(?:scrie|scrii|adauga textul|pune textul|pune cuvantul)\s+(.+)$/);
    // Lista taie continutul acolo unde incepe POZITIA. „inauntrul", „interiorul" si
    // „exteriorul" trebuie sa fie pe ea: fara „in" inaintea lor nu se potrivea nimic,
    // iar „scrie JOS inauntrul laturii inferioare" scria pe figura toata coada frazei.
    if (m) cuvinte = curataCuvinte(
      m[1].split(/\s+(?:in|intr-o|intr-un|pe|la|sub|deasupra|dedesubt|inauntrul|interiorul|exteriorul|de-a lungul)\s+/)[0], prompt);
  }

  const t = {};
  if (cuvinte && cuvinte.length) {
    // „scrie SI BETA" adauga langa textul care exista; „scrie BETA" il inlocuieste
    if (/\b(?:scrie|adauga|pune|mai)\s+si\b|\bmai\s+(?:scrie|adauga)\b|\bin plus\b/.test(p)) {
      t.add = cuvinte;
    } else {
      t.set = cuvinte;
    }
  }

  // stergerea textului
  if (!t.set && !t.add && /\b(sterge|elimina|scoate|ascunde|fara)\w*\s*(textul|text|scrisul|cuvintele)/.test(p)) {
    return { bind: 'none' };
  }

  // Transferul pe ALTA figura: „muta textul DE PE figura 1 PE figura 0".
  // „de pe figura 1" spune SURSA, nu destinatia — se scoate din text inainte de
  // cautare, altfel sursa e luata drept destinatie si textul pleaca unde nu trebuie.
  if (/\b(muta|mutare|transfera|pune)\w*\s+(?:(?:al|a)\s+\w+\s+)?(?:textul|text|scrisul|cuvintele)/.test(p)) {
    const faraSursa = p.replace(/\bde\s+pe\s+(?:figura|dreptunghiul|patratul|forma)\s*\d+/g, ' ');
    // Intre prepozitie si figura pot sta cuvinte: „sub LATURA INFERIOARA A figurii 1".
    // Cu prepozitia lipita de substantiv, exact formularea asta pierdea destinatia si
    // textul ramanea pe figura lui, asezat fata de ea — figura gresita.
    const dest = faraSursa.match(/\b(?:pe|in|la|sub|deasupra|langa|interiorul)\b[^\d]{0,40}?\b(?:figura|figurii|dreptunghiul|dreptunghiului|patratul|patratului|forma|formei)\s*(\d+)/);
    if (dest) t.to = +dest[1];
  }

  // doar o parte din cuvinte: „primele doua cuvinte", „ultimul cuvant"
  const primele = p.match(new RegExp(String.raw`\bprimele?\s+` + N + String.raw`\s+cuvinte?`));
  if (primele) {
    const k = num(primele[1]);
    if (k > 0 && k < 32) t.words = Array.from({ length: k }, (_, i) => i);
  } else if (/\bprimul cuvant\b/.test(p)) {
    t.words = [0];
  }

  // caseta, marita sau micsorata cu un numar de pixeli
  const delta = casetaDelta(p);
  if (delta !== null) t.boxDelta = delta;

  // Marimea CORPULUI DE LITERA. Nu si cand se cere caseta: acolo textul creste
  // proportional cu ea, in motor — altfel s-ar inmulti cele doua mariri.
  if (delta === null && /\b(text(?! ?box)|scris|cuvint|cuvant|font)/.test(p)) {
    if (/\b(mareste|mai mare|dublu)/.test(p)) t.scale = 1.4;
    else if (/\b(micsorea|mai mic|jumatate)/.test(p)) t.scale = 0.7;
  }

  // unde se aseaza
  const b = legare(p);
  // O cerere de redimensionare nu re-leaga textul: „mareste caseta cu 20" schimba
  // doar marimea, iar un bind:'box' pus aici ar readuce-o la latimea implicita.
  if (b && !(delta !== null && b.bind === 'box')) Object.assign(t, b);

  return Object.keys(t).length ? t : null;
}

function legare(p) {
  // Punctul are prioritate: „in punctul 325,325" e o pozitie exacta, nu o latura.
  // Cuvantul „punct" nu e obligatoriu — „muta scrisul la 325 325" spune acelasi
  // lucru, iar o pereche de coordonate intr-o cerere de mutare a textului nu poate
  // insemna altceva.
  const mutaText = /\b(muta|mutare|pune|aseaza|plaseaza)\w*\s+(?:(?:al|a)\s+\w+\s+)?(?:textul|text|scrisul|cuvintele|cuvantul)/.test(p);
  if (cerePunct(p) || mutaText) {
    const q = punctDin(p);
    if (q) return { bind: 'point', at: q };
  }

  // Caseta e un ambalaj propriu, nu o latura a figurii — de aceea vine inaintea
  // laturilor si a colturilor, care s-ar potrivi si ele pe cuvinte ca „in mijloc".
  if (CASETA.test(p)) {
    const b = { bind: 'box' };
    const d = marimeCaseta(p);
    if (d) b.box = d;
    return b;
  }

  if (/\bpe (?:fiecare|toate) laturi|\bpe fiecare latura\b|\bpe toate laturile/.test(p)) {
    return { bind: 'sides', repeat: true };
  }
  if (/\bin fiecare (?:dreptunghi|piesa|bucata)|\bfiecare piesa/.test(p)) return { bind: 'pieces', repeat: true };

  const latura = laturaDin(p);
  if (latura) {
    const b = { bind: 'side', at: latura };
    if (interiorulLaturii(p, latura)) b.in = true;
    return b;
  }

  if (/\bcolt|colturi/.test(p)) {
    const at = /(dreapta[^.]*sus|sus[^.]*dreapta)/.test(p) ? 'tr'
             : /(stanga[^.]*sus|sus[^.]*stanga)/.test(p) ? 'tl'
             : /(dreapta[^.]*jos|jos[^.]*dreapta)/.test(p) ? 'br'
             : /(stanga[^.]*jos|jos[^.]*stanga)/.test(p) ? 'bl' : null;
    const unSingur = at !== null || /\b(tot|toate|intreg|intreaga)\b/.test(p);
    return unSingur ? { bind: 'corner', at: at || 'tr' } : { bind: 'corners' };
  }

  // O directie singura („in stanga jos") inseamna tot un colt, chiar fara cuvantul
  // „colt" — asa se scrie de obicei: „muta primele doua cuvinte in stanga jos".
  const dir = /(stanga[^.]*jos|jos[^.]*stanga)/.test(p) ? 'bl'
            : /(dreapta[^.]*jos|jos[^.]*dreapta)/.test(p) ? 'br'
            : /(stanga[^.]*sus|sus[^.]*stanga)/.test(p) ? 'tl'
            : /(dreapta[^.]*sus|sus[^.]*dreapta)/.test(p) ? 'tr' : null;
  if (dir) return { bind: 'corner', at: dir };

  if (/\bcontur|de-a lungul|traseu|pe forma/.test(p)) return { bind: 'path' };
  if (/\binterior|inauntru|in mijloc|in centru|in figura|in patrat|in dreptunghi/.test(p)) {
    return { bind: 'inside' };
  }
  return null;
}

/** Cuvintele de scris, luate din promptul ORIGINAL ca sa nu piarda diacriticele. */
function curataCuvinte(bucataNorm, prompt) {
  const brut = String(bucataNorm).replace(/[.,!?]+$/, '').trim();
  if (!brut) return null;
  // „pune textul PE CONTUR" nu spune CE sa scrie, ci UNDE sa stea textul de acum.
  // Fara verificarea asta, pozitia ajunge continut si se scrie „PE CONTUR" pe figura.
  if (/^(intr|in|pe|la|sub|deasupra|dedesubt|langa|de-a lungul|inauntru|intre)\b/.test(brut)) return null;
  // cauta aceeasi bucata in promptul original, ca sa pastreze forma scrisa
  const i = norm(prompt).indexOf(brut);
  const sursa = i >= 0 ? prompt.slice(i, i + brut.length) : brut;
  return sursa.split(/\s+/)
    // „scrie SI BETA" — „si" e liantul cererii, nu un cuvant de pus pe figura
    .filter(w => w.length && !/^(text|textul|cuvintele|cuvant|cuvantul|si|și|inca)$/i.test(w))
    .slice(0, 16)
    .map(w => w.toUpperCase());
}

/**
 * Rezerva locala. Intoarce DSL in forma lunga, sau `{error}` daca n-a inteles.
 *
 * Un `rect` fara dimensiuni n-are ce desena, iar motorul ar cere marimea degeaba:
 * mai bine spunem direct ca nu stim cat de mare.
 */
/**
 * @param {string} prompt
 * @param {'panza'|'figuri'} [doar] din ce caseta de comanda vine cererea. Rezerva
 *        locala respecta aceeasi impartire ca agentii: in caseta panzei nu se
 *        recunoaste nimic despre text, si invers.
 */
export function parse(prompt, doar) {
  const p = norm(prompt);

  // Fiecare caseta o refuza pe cealalta, pe fata. Mai bine un refuz limpede decat o
  // panza redimensionata din greseala, cand omul cerea un patrat de 200.
  if (doar === 'panza' && DESPRE_OBIECTE.test(p)) {
    return { error: 'Caseta pânzei schimbă doar gabaritul — figurile și textul se cer în dreapta.' };
  }
  if (doar === 'figuri' && DESPRE_PANZA.test(p)) {
    return { error: 'Gabaritul pânzei se cere în caseta din stânga.' };
  }

  const geom = geometrie(p, doar);
  const txt = doar === 'panza' ? null : text(p, prompt);

  if (geom && (geom.op === 'rect' || geom.op === 'canvas_resize') && geom.w === undefined) {
    return { error: 'Local nu știu cât de mare — scrie dimensiunea, de exemplu „300x150".' };
  }
  if (!geom && !txt) return { error: 'Nu am recunoscut nicio operație în prompt.' };
  const out = { geom: geom || null, text: txt || null };
  // „textul 1" tinteste al doilea TEXT, nu al doilea obiect: seriile sunt separate
  const tt = txt ? tintaTextDin(p) : null;
  if (tt) out.target = tt;
  return out;
}

// ---------------------------------------------------------------------------
// Calea REALA: promptul pleaca la model prin proxy-ul din serve.js.
// Daca serverul nu are cheie, modelul pica sau raspunde aiurea, cadem automat
// pe parse() de mai sus. Aplicatia nu ramane niciodata fara raspuns.
// ---------------------------------------------------------------------------

export async function parseRemote(prompt, state, doar) {
  try {
    const r = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, state, doar }),
      // plasa finala: chiar daca serverul atarna, dupa 30s cadem pe parserul local
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    const durata = j.ms ? ' · ' + (j.ms / 1000).toFixed(1) + 's' : '';
    const retry = j.incercari > 1 ? ' · ' + j.incercari + ' încercări' : '';
    // Ce agenti au raspuns. Cand apar amandoi, cererea a fost ambigua si fiecare a
    // raspuns pentru domeniul lui — merita vazut, altfel „doua schimbari dintr-o
    // cerere" arata ca o eroare.
    const NUME = { geometrie: 'geometru', text: 'tipograf', caseta: 'casetar' };
    const ag = Array.isArray(j.agenti) && j.agenti.length
      ? ' · ' + j.agenti.map(a => NUME[a] || a).join('+') : '';
    // un raspuns tinut minte n-a costat nimic; merita spus, altfel „0 tokeni" deruteaza
    const mem = j.memorat ? ' · din memorie' : '';
    return { ...j.dsl, _src: j.model + ag + mem + durata + retry, _usage: j.usage,
             _live: true, _memorat: Boolean(j.memorat) };
  } catch (e) {
    const local = parse(prompt, doar);
    return { ...local, _src: 'regex local', _live: false, _why: String(e.message || e) };
  }
}

export async function providerStatus() {
  try { return await (await fetch('/api/status')).json(); }
  catch { return { provider: 'offline', model: '—' }; }
}
