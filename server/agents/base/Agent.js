// base/Agent.js — ce au in comun toti agentii.
//
// Un agent e trei lucruri la un loc: o bucata de prompt care ii spune cine e, o
// multime de ramuri din care routerul alege, si un validator care stie sa citeasca
// UN SINGUR camp din raspuns. Al treilea e cel important: izolarea intre agenti nu
// se sprijina pe rugamintea din prompt („nu emite campul t"), ci pe faptul ca
// geometrul pur si simplu nu are cod care sa citeasca text.

import { NL, motiv, tinta } from './valori.js';
import { RaspunsGol } from '../../providers.js';

export class Agent {
  /**
   * Partea de prompt pe care o platesc toti agentii: panza, coordonatele, cum se
   * numeste o figura si forma minificata a raspunsului. Aici nu intra nimic despre
   * figuri sau despre cuvinte — altfel s-ar trimite si celui care n-are nevoie.
   */
  static COMUN = [
    'Traduci comenzi pentru un motor care deseneaza pe o panza de 800x800 pixeli.',
    'Raspunzi cu JSON MINIFICAT: cheile au un caracter, punctele sunt perechi [x,y].',
    'Nu adauga spatii si nu scrie chei lungi. Ce nu e cerut se omite complet.',
    '',
    'PANZA: originea (0,0) e in coltul din STANGA JOS; x creste spre dreapta, y in SUS.',
    'Reperele grilei sunt din 50 in 50 de pixeli, dar orice valoare 0..800 e valida.',
    '',
    // Blocul asta pleaca la FIECARE agent chemat, deci fiecare rand se plateste de
    // cate ori sunt agenti. E scris strans dinadins: ce se vede oricum din starea
    // trimisa — ca T0 sta „pe #1", ca o figura are gabarit — nu se mai explica aici.
    'TINTA: doua numerotari INDEPENDENTE, in ordinea crearii: figurile #0,#1 si textele T0,T1.',
    'Starea ti le da pe amandoua; pozitia unei figuri e CENTRUL ei.',
    'Figura anume: "n":[1].  Text anume: "n":["t1"].',
    '"a doua" -> 1,  "ultima/ultimul" -> numarul cel mai mare,  "al doilea text" -> "t1".',
    'Ce e marcat cu * e selectat: acolo cade comanda daca omiti "n".',
    'Nu pune "n" cand cererea zice "toate", "fiecare", "pe amandoua".',
  ];

  /**
   * @param {object} spec
   * @param {string} spec.nume      cum apare in interfata: „geometru", „tipograf"
   * @param {string} spec.domeniu   cheia de rutare: 'geometrie' | 'text'
   * @param {string} spec.camp      ce camp din DSL umple: 'geom' | 'text'
   * @param {string[]} spec.rol     randurile de prompt care ii descriu rolul
   * @param {Record<string,string[]>} spec.ramuri  sectiunile lui, pe nume de ruta
   */
  constructor({ nume, domeniu, camp, rol, ramuri }) {
    this.nume = nume;
    this.domeniu = domeniu;
    this.camp = camp;
    this.rol = rol;
    this.ramuri = ramuri;
  }

  /** Numele rutelor pe care le detine agentul asta. Routerul se uita la ele. */
  get numeRamuri() {
    return Object.keys(this.ramuri);
  }

  /** Ma priveste cererea asta? Da, daca routerul a ales vreuna dintre ramurile mele. */
  maPriveste(sectiuni) {
    return this.numeRamuri.some(r => sectiuni.includes(r));
  }

  /**
   * Ramurile mele cerute de router. Daca niciuna nu s-a potrivit, le iau pe toate:
   * mai bine un prompt scump decat unul din care lipseste exact ce trebuia.
   */
  ramuriCerute(sectiuni) {
    const ale = this.numeRamuri.filter(r => sectiuni.includes(r));
    return ale.length ? ale : this.numeRamuri;
  }

  /** Promptul de sistem: baza comuna + rolul meu + doar ramurile de care e nevoie. */
  prompt(sectiuni) {
    const ram = this.ramuriCerute(sectiuni || this.numeRamuri);
    return [
      ...Agent.COMUN,
      ...this.rol,
      ...ram.flatMap(r => this.ramuri[r]),
    ].join(NL);
  }

  /**
   * Din raspunsul brut al modelului, DSL-ul validat — numai in domeniul meu.
   *
   * Daca modelul a strecurat totusi campul celuilalt, nu ajunge nicaieri: nu-l
   * citeste nimeni. Iar daca n-am ce raspunde, arunc `RaspunsGol`, care nu e o
   * eroare — e felul agentului de a spune „nu e treaba mea".
   */
  citeste(brut) {
    const d = Agent.extrageJSON(brut);
    const out = { geom: null, text: null, why: motiv(d) };
    out[this.camp] = this.valideaza(d);
    tinta(d, out);
    if (!out[this.camp]) throw new RaspunsGol(this.nume);
    return out;
  }

  /** Fiecare agent isi citeste campul lui. Fara asta, clasa nu e completa. */
  valideaza() {
    throw new Error('agentul ' + this.nume + ' nu stie sa valideze nimic');
  }

  /** Un tur: promptul meu pleaca la model si se intoarce DSL validat. */
  async raspunde(client, sectiuni, user) {
    const t0 = Date.now();
    const r = await client.cere(this.prompt(sectiuni), user, brut => this.citeste(brut));
    return {
      agent: this, dsl: r.rezultat, model: r.model, provider: r.provider, usage: r.usage,
      incercari: r.incercari, ms: Date.now() - t0, jurnal: r.jurnal, memorat: r.memorat,
    };
  }

  /** Unele modele pun text in jurul JSON-ului. Luam ce e intre acolade. */
  static extrageJSON(brut) {
    try { return JSON.parse(brut); } catch { /* se incearca mai jos */ }
    const a = brut.indexOf('{'), b = brut.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('raspuns fara JSON: ' + brut.slice(0, 120));
    return JSON.parse(brut.slice(a, b + 1));
  }
}
