// mastra/flux.ts — cine pe cine cheama si cum se leaga raspunsurile la loc.
//
// Inainte, aici statea `Promise.all` peste agentii alesi de router. Acum e un Workflow
// Mastra, iar diferenta nu e de viteza — `.parallel()` face acelasi lucru — ci de
// forma: graful e DECLARAT, deci se vede din afara ce ruleaza si in ce ordine.
//
// Un amanunt care se vede in cod si merita spus: `.parallel()` cere un grup FIX de
// pasi, iar routerul alege agentii la fiecare cerere. Impacarea e ca toti trei sunt in
// graf, dar pasul unui agent nechemat se intoarce imediat, fara sa atinga reteaua.
// Costul in tokeni ramane acelasi — un agent nechemat nu trimite niciun prompt — si
// castigam un graf care nu se schimba de la o cerere la alta.
//
// Turul dureaza cat cel mai LENT agent chemat, nu cat suma lor, deci o cerere ambigua —
// care ii cheama pe amandoi — nu e simtita mai incet.

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { Router } from './router.js';
import { ECHIPA, type AgentSpecializat } from './agenti.js';
import { RaspunsGol } from './scheme.js';

export const router = new Router(ECHIPA);

/** Ce intra in tur. `doar` spune din ce caseta de comanda vine cererea. */
const INTRARE = z.object({
  cerere: z.string(),
  user: z.string(),
  doar: z.string().optional(),
});

/** Plumbaria dintre pasi nu se trimite nicaieri, deci nu merita tipizata mai strans. */
const ORICE = z.any();

const RUTARE = z.object({
  user: z.string(),
  sectiuni: z.array(z.string()),
  ceruti: z.array(z.string()),
});

/**
 * Pasul zero: routerul. Local, zero tokeni, zero milisecunde.
 *
 * Decide doua lucruri deodata — ce agenti sunt chemati si ce ramuri din promptul
 * fiecaruia pleaca efectiv pe fir.
 */
const pasRutare = createStep({
  id: 'rutare',
  inputSchema: INTRARE,
  outputSchema: RUTARE,
  execute: async ({ inputData }) => ({
    user: inputData.user,
    sectiuni: router.sectiuni(inputData.cerere, inputData.doar),
    ceruti: router.alege(inputData.cerere, inputData.doar).map(a => a.domeniu),
  }),
});

/**
 * Pasul unui agent. Trei la fel, cate unul pe domeniu.
 *
 * Doua feluri de „nu am raspuns", si nu se confunda:
 *   nechemat  routerul nu l-a ales. Nu se atinge de retea, nu costa nimic.
 *   RaspunsGol modelul a fost intrebat si a spus „nu e treaba mea". Legitim, nu eroare.
 * Restul erorilor se retin si merg in detalii, dar nu anuleaza turul: contribuie
 * ceilalti. Doar daca NIMENI nu produce nimic cererea esueaza, si atunci explicit.
 */
function pasAgent(a: AgentSpecializat) {
  return createStep({
    id: a.domeniu,
    inputSchema: RUTARE,
    outputSchema: ORICE,
    execute: async ({ inputData }) => {
      if (!inputData.ceruti.includes(a.domeniu)) return { domeniu: a.domeniu, chemat: false };
      try {
        const r = await a.raspunde(inputData.sectiuni, inputData.user);
        return { domeniu: a.domeniu, chemat: true, camp: a.camp, dsl: r.dsl, usage: r.usage, ms: r.ms };
      } catch (e) {
        const gol = e instanceof RaspunsGol;
        return {
          domeniu: a.domeniu, chemat: true, camp: a.camp, dsl: null,
          usage: { in: 0, out: 0 }, ms: 0,
          eroare: gol ? undefined : String((e as Error).message || e).slice(0, 80),
          gol,
        };
      }
    },
  });
}

type Raspuns = {
  domeniu: string; chemat: boolean; camp?: string;
  dsl?: Record<string, unknown> | null;
  usage?: { in: number; out: number }; ms?: number;
  eroare?: string; gol?: boolean;
};

/**
 * Combinarea: fiecare agent contribuie doar in campul lui, deci nu au cum sa se
 * suprascrie. Tinta si motivul se iau de la primul care le da.
 */
export function combina(rezultate: Raspuns[]) {
  const dsl: Record<string, unknown> = { geom: null, text: null, caseta: null, why: '' };
  const usage = { in: 0, out: 0 };
  const motive: string[] = [];

  for (const r of rezultate) {
    if (!r.chemat) continue;
    usage.in += r.usage?.in || 0;
    usage.out += r.usage?.out || 0;
    if (!r.dsl || !r.camp) continue;              // agentul a spus „nu e treaba mea"
    if (r.dsl[r.camp] && !dsl[r.camp]) dsl[r.camp] = r.dsl[r.camp];
    if (r.dsl.target && !dsl.target) dsl.target = r.dsl.target;
    if (r.dsl.why) motive.push(r.dsl.why as string);
  }

  // Casetarul are camp propriu ca sa nu se calce cu tipograful la citire. Aici se topesc
  // la loc: motorul primeste o singura comanda de text. Caseta vine ULTIMA, deci daca
  // tipograful a ghicit „b":"i" pentru o cerere de caseta, legarea corecta o pune tot
  // casetarul.
  if (dsl.caseta) dsl.text = { ...(dsl.text as object || {}), ...(dsl.caseta as object) };
  delete dsl.caseta;

  dsl.why = motive.join('; ').slice(0, 80);
  return { dsl, usage };
}

const pasCombina = createStep({
  id: 'combina',
  inputSchema: ORICE,
  outputSchema: ORICE,
  execute: async ({ inputData }) => {
    // `.parallel()` intoarce un obiect cu cate o intrare pe id de pas
    const rezultate = Object.values(inputData as Record<string, Raspuns>);
    const chemati = rezultate.filter(r => r.chemat);

    const { dsl, usage } = combina(rezultate);

    // Cand nu s-a produs nimic, cauza conteaza mai mult decat constatarea: daca vreun
    // agent a picat cu o eroare adevarata — cheie gresita, retea moarta — ea se
    // raporteaza, nu „niciun agent nu a produs o comanda". Cel din urma mesaj ramane
    // pentru cazul in care chiar toti au spus, legitim, ca nu e treaba lor.
    if (!dsl.geom && !dsl.text) {
      const picat = chemati.find(r => r.eroare);
      throw new Error(picat ? picat.eroare : 'niciun agent nu a produs o comanda');
    }

    return {
      dsl, usage,
      agenti: chemati.map(r => r.domeniu),
      // Cat a durat FIECARE agent. Turul e cel mai lent dintre ei; daca unul singur a
      // durat mult, cauza e in lantul lui de rezerve, nu in paralelizare.
      detalii: chemati.map(r => ({ agent: r.domeniu, ms: r.ms, eroare: r.eroare })),
    };
  },
});

export const turul = createWorkflow({
  id: 'tur',
  inputSchema: INTRARE,
  outputSchema: ORICE,
})
  .then(pasRutare)
  .parallel(ECHIPA.map(pasAgent))
  .then(pasCombina)
  .commit();
