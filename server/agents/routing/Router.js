// routing/Router.js — dispecerul.
//
// Clasificare pur locala, prin cuvinte-cheie: zero tokeni, zero milisecunde, niciun
// apel la model. Decide doua lucruri deodata — ce agenti sunt chemati si ce ramuri
// din promptul fiecaruia pleaca efectiv.
//
// Nu cunoaste agentii pe nume: se uita ce ramuri detine fiecare. Un agent nou nu
// cere nicio modificare aici, doar isi declara ramurile.

import { norm } from '../base/valori.js';

// Tiparele trebuie sa fie SPECIFICE: un cuvant care apare in cereri de mai multe
// feluri atrage inutil o sectiune intreaga, adica sute de tokeni la fiecare apel.
// De aceea verbele care se refera si la figuri si la text ("muta", "mareste") au o
// exceptie cand sunt urmate de un cuvant despre text.
/** Substantivele care spun „cererea asta e despre scris". Se potrivesc ca prefixe. */
const DESPRE_SCRIS = String.raw`(?:text|scris|cuvint|cuvant|cuvinte|caset|chenar|casut)`;

/**
 * Cantitatile care se strecoara intre verb si substantiv: „muta TOT textul".
 *
 * Exceptia se uita la cuvantul de LANGA verb. Cand acolo statea „tot", nu se potrivea
 * nimic: „muta tot textul sub figura 0" aprindea degeaba geometria si — mai rau — NU
 * aprindea `text-poz`. Tipograful primea doar ramura despre CE scrie textul, care n-are
 * cum sa exprime o mutare, deci raspundea gol, iar turul esua cu „niciun agent nu a
 * produs o comanda". Cererea nu facea nimic si nici nu spunea de ce.
 */
const CANTITATE = String.raw`(?:tot|toata|toate|toti|intreg|intreaga)\s+`;

// Aceleasi verbe se refera si la PANZA, iar ea si-a primit ramura ei: „micsoreaza
// panza" n-are de ce sa mai aprinda si operatiile pe figuri.
/**
 * Panza, in doua tipare.
 *
 * STRICT — „panza", „zona de desen" — inseamna fara echivoc gabaritul zonei de desen,
 * deci taie ramurile de figuri: „micsoreaza panza" n-are de ce sa plateasca operatiile
 * pe dreptunghiuri.
 *
 * LARG mai cuprinde si „scena", care in aplicatie inseamna si multimea obiectelor:
 * „goleste scena" e o cerere de clear, nu una despre gabarit. Ea spune doar ca cererea
 * NU e ambigua — deci nu-i cheama pe toti agentii — dar lasa si ramura de modificare
 * aprinsa, ca operatia de clear sa ramana in prompt.
 */
const DESPRE_PANZA = String.raw`(?:panz|canvas|zona de desen)`;
const PANZA_STRICT = new RegExp(String.raw`\b` + DESPRE_PANZA);
const PANZA_LARG = /\bpanz|\bcanvas|\bscen|\bzona de desen/;

const NU_TEXT = String.raw`(?!\w*\s+(?:` + CANTITATE + String.raw`)?` + DESPRE_SCRIS + String.raw`)`;

const NU_TEXT_PANZA = String.raw`(?!\w*\s+(?:` + CANTITATE + String.raw`)?(?:`
  + DESPRE_SCRIS + '|' + DESPRE_PANZA + String.raw`))`;

// „o caseta de 300 pe 80" da si ea doua dimensiuni, dar nu cere nicio figura:
// cifrele sunt ale casetei de text. Fara exceptia asta, cererea platea degeaba si
// promptul geometrului, iar un model slab chiar desena un dreptunghi de 300x80.
const NU_CASETA = String.raw`(?<!(caset|chenar|casut)\w*\s+(de\s+)?)`;

// Nici cifrele PANZEI nu cer o figura: „micsoreaza panza la 250 pe 100" da doua
// dimensiuni, dar ele sunt ale zonei de desen. Fara exceptia asta cererea platea
// degeaba si ramura de creare, iar un model slab chiar desena un dreptunghi de 250x100.
const NU_PANZA = String.raw`(?<!(panz|canvas|scen)\w*\s+(de\s+|la\s+)?)`;

const RUTE = [
  // CE scrie textul
  // „text(?! ?box)": „textboxul" incepe cu „text", dar nu e o cerere despre CE scrie
  // textul. Fara exceptie, „mareste textboxul" chema tipograful, care raspundea cu
  // singurul lucru pe care il stie sa mareasca — corpul de litera.
  { nume: 'text-nou', re: /\b(scrie|rescri|scris|textul|text(?! ?box)|cuvint|cuvant|cuvinte|font|in loc de)/ },

  // UNDE sta textul. "in figura" trebuie sa fie aici: fara ea, o cerere de tipul
  // "scrie MIAU in figura" n-ar primi documentatia modurilor de legare.
  // „muta … textul" nu mai e un literal: intre verb si substantiv poate sta o cantitate,
  // deci „muta textul", „muta tot textul" si „muta toate textele" cer aceeasi ramura.
  // „in interiorul / in exteriorul laturii de sus" — cererea spune pe fata pe ce parte
  // a laturii cade textul. Genitivul „laturii" nu era prins de forma fixa „pe latura",
  // deci tipograful primea doar documentatia despre CE scrie textul si raspundea gol.
  // Tiparul cere „interiorul|exteriorul" INAINTEA laturii, ca „muta patratul langa
  // latura de sus" sa ramana geometrie curata.
  { nume: 'text-poz', re: new RegExp(String.raw`\b(?:interiorul|exteriorul|inauntrul|in afara)\s+latur`
    + String.raw`|\b(pe latura|pe laturi|laturile|muchi|colt|colturi|in mijloc|in figura|inauntru|in fiecare|fiecarui|fiecarei|fiecare piesa|fiecare dreptunghi|deasupra|dedesubt|sub latura|pe contur|de-a lungul|in punctul|primele|ultimul cuvant|ascunde)`
    + String.raw`|\bmuta\w*\s+(?:` + CANTITATE + String.raw`)?` + DESPRE_SCRIS) },

  // Caseta de text. Ramura proprie, deci se plateste doar cand se cere: cuvintele
  // astea nu mai trag dupa ele documentatia celor opt legari ale tipografului.
  { nume: 'caseta', re: /\bcaset|\bchenar|\bcasut|\btext ?box|ca un paragraf/ },

  // PANZA insasi, nu figurile de pe ea. Ramura ei, ca la caseta: „micsoreaza panza"
  // nu mai plateste operatiile pe figuri, iar „imparte figura 0 in 3" nu mai plateste
  // documentatia panzei — cea care urcase ramura „modifica" de la 667 la 719 tokeni.
  { nume: 'panza', re: PANZA_LARG },

  { nume: 'creare', re: new RegExp(String.raw`\b(fa|fac|creeaza|genereaza|deseneaza|vreau|inca un|inca o|figura noua)\b|\b(adauga|pune)` + NU_TEXT + String.raw`\b|(dreptunghi|patrat)\w*\s+(de|cu)\s+\d|\b` + NU_CASETA + NU_PANZA + String.raw`\d+\s*(pe|x)\s*\d`) },

  { nume: 'modifica', re: new RegExp(String.raw`\b(muta|mareste|micsorea)` + NU_TEXT_PANZA + String.raw`\b|\b(mutare|deplas|imparte|impart|taie|split|redimension|scade|clear|goleste|jumatate|dublu|mai mare|mai mic|interiorul(?!\s+fiecar)|inlocui)`) },
];

// Verbe care se potrivesc si figurilor si textului. Daca apar FARA un substantiv
// care sa lamureasca despre ce e vorba, routerul nu ghiceste.
const AMBIGUU = /\b(mareste|micsorea|muta|scade|redimension|mai mare|mai mic|dublu|jumatate)/;
const DESPRE_FIGURA = /\b(figur|dreptunghi|patrat|forma|obiect)/;
const DESPRE_TEXT = /\b(text|scris|cuvint|cuvant|cuvinte|font|caset|chenar|casut)/;

export class Router {
  /** @param {import('../base/Agent.js').Agent[]} agenti echipa pe care o dispeceaza */
  constructor(agenti) {
    this.agenti = agenti;
  }

  /** Toate rutele cunoscute, in ordinea in care sunt incercate. */
  static get rute() {
    return RUTE.map(r => r.nume);
  }

  /**
   * Ce sectiuni de prompt are nevoie cererea asta.
   * Daca nu se potriveste nimic, le trimitem pe toate — mai bine scump decat gresit.
   */
  sectiuni(prompt, doar) {
    // Interfata are DOUA casete de comanda: una doar pentru panza, alta pentru figuri
    // si text. Care caseta a fost folosita e un semnal de rutare pe care il da OMUL,
    // gratis — si e fara echivoc, spre deosebire de cuvinte: „mareste" scris in caseta
    // panzei nu mai poate fi citit ca o marire de figura. Cand semnalul exista,
    // routerul nu mai are ce ghici.
    if (doar === 'panza') return ['panza'];

    const p = norm(prompt);
    let alese = RUTE.filter(r => r.re.test(p)).map(r => r.nume);

    // caseta figurilor nu plateste niciodata documentatia panzei
    if (doar === 'figuri') alese = alese.filter(r => r !== 'panza');

    // NU_TEXT se uita doar la cuvantul de langa verb. In „mareste cu 100 de pixeli
    // pe lungime si latime textboxul" substantivul sta la capatul frazei, deci
    // exceptia nu-l vede si ramura de geometrie se aprindea degeaba — iar geometrul
    // chemat pe o cerere de text raspunde ce stie el: redimensioneaza figura.
    // Regula e aceeasi ca la `alege`: daca se vorbeste despre text sau caseta si
    // despre nicio figura, geometria n-are ce cauta in cerere.
    if (DESPRE_TEXT.test(p) && !DESPRE_FIGURA.test(p)) {
      alese = alese.filter(r => r !== 'creare' && r !== 'modifica');
    }

    // Aceeasi regula pentru PANZA: cand cererea vorbeste despre ea si despre nicio
    // figura, operatiile pe figuri n-au ce cauta. „fa panza 400 pe 400" incepe cu un
    // verb de creare, dar nu creeaza nicio figura — fara filtrul asta platea si
    // ramura de creare, iar un model slab chiar desena un dreptunghi de 400x400.
    if (PANZA_STRICT.test(p) && !DESPRE_FIGURA.test(p)) {
      alese = alese.filter(r => r !== 'creare' && r !== 'modifica');
    }
    // „nu s-a potrivit nimic" inseamna tot ce e permis in caseta asta, nu tot ce exista
    const toate = doar === 'figuri' ? Router.rute.filter(r => r !== 'panza') : Router.rute;
    return alese.length ? alese : toate;
  }

  /**
   * Ce agenti sunt chemati.
   *
   * Cand verbul e ambiguu si nimic din cerere nu lamureste despre ce e vorba, ii
   * cheama pe toti: fiecare raspunde pentru domeniul lui si rezultatele se combina.
   * Costa mai mult decat o ghiceala, dar o ghiceala gresita costa un tur intreg.
   */
  alege(prompt, doar) {
    // Caseta panzei cheama exact agentul care detine ramura ei — gasit tot dupa ramuri,
    // nu dupa nume: routerul nu-i cunoaste pe agenti pe nume, nici aici.
    if (doar === 'panza') {
      const ai = this.agenti.filter(a => a.numeRamuri.includes('panza'));
      return ai.length ? ai : this.agenti.slice();
    }
    const p = norm(prompt);
    if (AMBIGUU.test(p) && !DESPRE_FIGURA.test(p) && !DESPRE_TEXT.test(p)
        && !PANZA_LARG.test(p)) {
      return this.agenti.slice();
    }
    const sec = this.sectiuni(prompt, doar);
    const ale = this.agenti.filter(a => a.maPriveste(sec));
    return ale.length ? ale : this.agenti.slice();
  }
}
