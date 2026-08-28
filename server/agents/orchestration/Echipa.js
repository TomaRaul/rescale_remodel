// orchestration/Echipa.js — cine pe cine cheama si cum se leaga raspunsurile la loc.
//
// Agentii ruleaza IN PARALEL. Turul dureaza cat cel mai lent dintre ei, nu cat suma,
// deci o cerere ambigua — care ii cheama pe amandoi — nu e simtita mai incet.

import { Router } from '../routing/Router.js';
import { ModelClient } from '../../providers.js';

export class Echipa {
  /** @param {import('../base/Agent.js').Agent[]} agenti */
  constructor(agenti) {
    this.agenti = agenti;
    this.router = new Router(agenti);
  }

  /** Agentul cu domeniul cerut, pentru apelurile care tintesc unul anume. */
  agent(domeniu) {
    return this.agenti.find(a => a.domeniu === domeniu) || null;
  }

  /** Promptul de sistem al unui agent, pentru masuratori si teste. */
  prompt(domeniu, cerere, doar) {
    const a = this.agent(domeniu);
    if (!a) return '';
    return a.prompt(cerere || doar ? this.router.sectiuni(cerere || '', doar) : null);
  }

  /**
   * Un tur complet: routerul alege, agentii raspund simultan, rezultatele se combina.
   *
   * Un agent care esueaza nu anuleaza turul — contribuie ceilalti. Doar daca niciunul
   * nu produce nimic cererea esueaza, si atunci explicit.
   */
  async rezolva(client, cerere, user, doar) {
    const sec = this.router.sectiuni(cerere, doar);
    const ceruti = this.router.alege(cerere, doar);
    const t0 = Date.now();

    const rezultate = await Promise.all(ceruti.map(a =>
      a.raspunde(client, sec, user).catch(err => ({ agent: a, err }))
    ));

    const bune = rezultate.filter(r => !r.err);
    if (!bune.length) throw rezultate[0].err;

    const { dsl, usage, model, provider, incercari } = Echipa.combina(bune);
    if (!dsl.geom && !dsl.text) throw new Error('niciun agent nu a produs o comanda');

    return {
      dsl, model, usage, incercari,
      // providerul care CHIAR a raspuns, nu cel principal: cand cota primului se
      // epuizeaza, raspunsul poate veni de la altul si merita sa se vada
      provider: provider || client.provider.id,
      ms: Date.now() - t0,
      agenti: ceruti.map(a => a.domeniu),
      sectiuni: sec,
      // turul intreg a venit din memorie: niciun apel, niciun token
      memorat: bune.length > 0 && bune.every(r => r.memorat),
      // Cat a durat FIECARE agent si prin cate modele a trecut. Turul e cel mai lent
      // dintre ei; daca unul singur a durat mult, cauza e in lantul lui de rezerve,
      // nu in paralelizare.
      detalii: rezultate.map(r => ({
        agent: r.agent.domeniu,
        provider: r.provider,
        ms: r.ms,
        incercari: r.incercari,
        jurnal: r.jurnal,
        memorat: r.memorat,
        eroare: r.err ? String(r.err.message || r.err).slice(0, 80) : undefined,
      })),
    };
  }

  /**
   * Combinarea: fiecare agent contribuie doar in campul lui, deci nu au cum sa se
   * suprascrie. Tinta si motivul se iau de la primul care le da.
   */
  static combina(rezultate) {
    const dsl = { geom: null, text: null, caseta: null, why: '' };
    const usage = { in: 0, out: 0 };
    const motive = [];
    let model = null, provider = null, incercari = 0;

    for (const r of rezultate) {
      usage.in += r.usage.in;
      usage.out += r.usage.out;
      incercari += r.incercari;
      model = model || r.model;
      provider = provider || r.provider;
      if (!r.dsl) continue;                       // agentul a spus „nu e treaba mea"
      const camp = r.agent.camp;
      if (r.dsl[camp] && !dsl[camp]) dsl[camp] = r.dsl[camp];
      if (r.dsl.target && !dsl.target) dsl.target = r.dsl.target;
      if (r.dsl.why) motive.push(r.dsl.why);
    }

    // Casetarul are camp propriu ca sa nu se calce cu tipograful la validare — doi
    // agenti care scriu in acelasi camp s-ar suprascrie, iar „primul castiga" ar
    // arunca in tacere raspunsul celuilalt. Aici se topesc la loc: motorul primeste
    // o singura comanda de text. Caseta vine ULTIMA, deci daca tipograful a ghicit
    // „b":"i" pentru o cerere de caseta, legarea corecta o pune tot casetarul.
    if (dsl.caseta) dsl.text = { ...(dsl.text || {}), ...dsl.caseta };
    delete dsl.caseta;

    dsl.why = motive.join('; ').slice(0, 80);
    return { dsl, usage, model, provider, incercari };
  }

  /** Echipa implicita a aplicatiei. */
  static async client() {
    return ModelClient.creeaza();
  }
}
