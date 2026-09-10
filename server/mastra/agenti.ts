// mastra/agenti.ts — cei trei agenti specializati, ca instante Mastra.
//
// Un agent e trei lucruri la un loc: o bucata de prompt care ii spune cine e, o multime
// de ramuri din care routerul alege, si un cititor care stie sa citeasca UN SINGUR camp
// din raspuns. Al treilea e cel important: izolarea intre agenti nu se sprijina pe
// rugamintea din prompt („nu emite campul t"), ci pe faptul ca geometrul pur si simplu
// nu are cod care sa citeasca text.
//
// Ce s-a schimbat la migrare: `instructions` nu mai e un sir fix, ci o FUNCTIE. Mastra
// o cheama la fiecare cerere, cu contextul ei, iar acolo gaseste ramurile alese de
// router. Asa promptul ramane exact cat trebuie — care e tot scopul proiectului — desi
// agentul se construieste o singura data, la pornire.

import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type { z } from 'zod';
import { NL } from './valori.js';
import type { Dispecerabil } from './router.js';
import {
  IESIRE_GEOM, IESIRE_TEXT, IESIRE_CASETA,
  citesteGeom, citesteText, citesteCaseta,
  RaspunsGol, extrageJSON, type Domeniu,
} from './scheme.js';
import { COMUN } from './prompturi/comun.js';
import * as G from './prompturi/geometrie.js';
import * as T from './prompturi/text.js';
import * as C from './prompturi/caseta.js';
import { lantModele } from './modele.js';
import { motiv, tinta } from './valori.js';

/** Cheia sub care calatoresc ramurile alese de router, de la flux la `instructions`. */
export const CHEIA_SECTIUNI = 'sectiuni';

type Spec = {
  nume: string;
  domeniu: Domeniu;
  /** ce camp din DSL umple: 'geom' | 'text' | 'caseta' */
  camp: 'geom' | 'text' | 'caseta';
  rol: string[];
  ramuri: Record<string, string[]>;
  schema: z.ZodTypeAny;
  citeste(d: unknown): unknown;
  /** Daca schema pleaca la model prin `structuredOutput`. Vezi campul din clasa. */
  schemaLaModel: boolean;
};

/**
 * Un agent specializat: descrierea lui si instanta Mastra pe care o inveleste.
 *
 * Descrierea e cea pe care o consulta routerul — ramurile, domeniul. Instanta e cea
 * care vorbeste cu modelul. Sunt tinute impreuna fiindca ramurile hotarasc si ce agenti
 * se cheama, si ce prompt primeste fiecare.
 */
export class AgentSpecializat implements Dispecerabil {
  nume: string;
  domeniu: Domeniu;
  camp: 'geom' | 'text' | 'caseta';
  rol: string[];
  ramuri: Record<string, string[]>;
  schema: z.ZodTypeAny;
  citeste: (d: unknown) => unknown;

  /**
   * Daca schema pleaca la model, sau doar promptul o descrie.
   *
   * Nu e o preferinta, e o constatare. O schema trimisa la Gemini prin `structuredOutput`
   * imbunatateste raspunsul doar daca e scrisa pe ramuri stranse; una cu multe campuri
   * optionale il INRAUTATESTE, tacut — vezi masuratoarea din `scheme.ts`. De aceea
   * fiecare agent o trimite abia dupa ce forma lui a fost verificata pe modelul real.
   *
   * Verificat: geometria, pe gemini-2.5-flash, sapte cereri (creare cu si fara cifre,
   * taiere, marire, mutare, stergere, lant de doi pasi) — toate corecte.
   * NEverificat inca pe Gemini: textul si caseta. Pana atunci merg pe prompt, adica
   * exact contractul dinainte de migrare, care era corect. Cand vor fi verificate, se
   * pune `schemaLaModel: true` la ele si nu se mai schimba nimic altundeva.
   */
  schemaLaModel: boolean;
  agent: Agent;

  constructor(spec: Spec) {
    this.nume = spec.nume;
    this.domeniu = spec.domeniu;
    this.camp = spec.camp;
    this.rol = spec.rol;
    this.ramuri = spec.ramuri;
    this.schema = spec.schema;
    this.citeste = spec.citeste;
    this.schemaLaModel = spec.schemaLaModel;

    this.agent = new Agent({
      id: spec.domeniu,
      name: spec.nume,
      // Promptul se compune la FIECARE cerere, din ramurile pe care le-a cerut routerul.
      // Fara asta, migrarea ar fi costat exact ce economiseste proiectul: un prompt fix
      // ar trimite toate ramurile de fiecare data.
      instructions: ({ requestContext }) => {
        const sec = requestContext?.getRaw(CHEIA_SECTIUNI) as string[] | undefined;
        return this.prompt(sec);
      },
      // Lantul e acelasi pentru toti trei, dar se rezolva per cerere: o cheie adaugata
      // in .env fara repornire intra in joc de la urmatorul prompt.
      model: () => lantModele(),
    });
  }

  /** Numele rutelor pe care le detine agentul asta. Routerul se uita la ele. */
  get numeRamuri(): string[] {
    return Object.keys(this.ramuri);
  }

  /** Ma priveste cererea asta? Da, daca routerul a ales vreuna dintre ramurile mele. */
  maPriveste(sectiuni: string[]): boolean {
    return this.numeRamuri.some(r => sectiuni.includes(r));
  }

  /**
   * Ramurile mele cerute de router. Daca niciuna nu s-a potrivit, le iau pe toate: mai
   * bine un prompt scump decat unul din care lipseste exact ce trebuia.
   */
  ramuriCerute(sectiuni?: string[]): string[] {
    const ale = this.numeRamuri.filter(r => (sectiuni || []).includes(r));
    return ale.length ? ale : this.numeRamuri;
  }

  /** Promptul de sistem: baza comuna + rolul meu + doar ramurile de care e nevoie. */
  prompt(sectiuni?: string[]): string {
    const ram = this.ramuriCerute(sectiuni || this.numeRamuri);
    return [
      ...COMUN,
      ...this.rol,
      ...ram.flatMap(r => this.ramuri[r]),
    ].join(NL);
  }

  /**
   * Din raspunsul modelului, DSL-ul validat — numai in domeniul meu.
   *
   * Daca modelul a strecurat totusi campul celuilalt, nu ajunge nicaieri: nu-l citeste
   * nimeni. Iar daca n-am ce raspunde, arunc `RaspunsGol`, care nu e o eroare — e felul
   * agentului de a spune „nu e treaba mea".
   */
  citesteRaspuns(d: unknown) {
    const out: Record<string, unknown> = { geom: null, text: null, why: motiv(d) };
    out[this.camp] = this.citeste(d);
    tinta(d, out);
    if (!out[this.camp]) throw new RaspunsGol(this.nume);
    return out;
  }

  /**
   * Un tur: promptul meu pleaca la model si se intoarce DSL validat.
   *
   * Cand schema pleaca si ea, raspunsul vine gata obiect si forma minificata nu mai e o
   * rugaminte din prompt, ci o conditie a API-ului. Cand nu, se citeste din text ca
   * inainte. Restul drumului e acelasi in ambele cazuri: cititorul domeniului.
   */
  async raspunde(sectiuni: string[], user: string) {
    const t0 = Date.now();
    const requestContext = new RequestContext();
    requestContext.setRaw(CHEIA_SECTIUNI, sectiuni);

    const r = this.schemaLaModel
      ? await this.agent.generate(user, { structuredOutput: { schema: this.schema }, requestContext })
      : await this.agent.generate(user, { requestContext });

    const brut = this.schemaLaModel ? r.object : extrageJSON(String(r.text));

    // Numele campurilor de consum difera intre versiunile de AI SDK; luam ce gasim.
    const u = (r.usage || {}) as Record<string, number>;
    return {
      agent: this,
      dsl: this.citesteRaspuns(brut),
      usage: { in: u.inputTokens ?? u.promptTokens ?? 0, out: u.outputTokens ?? u.completionTokens ?? 0 },
      ms: Date.now() - t0,
    };
  }
}

export const GEOMETRU = new AgentSpecializat({
  nume: 'geometru',
  domeniu: 'geometrie',
  camp: 'geom',
  rol: G.ROL,
  ramuri: { creare: G.CREARE, modifica: G.MODIFICA, panza: G.PANZA },
  schema: IESIRE_GEOM,
  citeste: citesteGeom,
  // verificat pe gemini-2.5-flash: sapte cereri, toate corecte
  schemaLaModel: true,
});

export const TIPOGRAF = new AgentSpecializat({
  nume: 'tipograf',
  domeniu: 'text',
  camp: 'text',
  rol: T.ROL,
  ramuri: { 'text-nou': T.TEXT_NOU, 'text-poz': T.TEXT_POZ },
  schema: IESIRE_TEXT,
  citeste: citesteText,
  // ramurile sunt scrise, dar neverificate inca pe Gemini: pana atunci, promptul
  schemaLaModel: false,
});

/**
 * Casetarul are camp propriu — „caseta", nu „text" — desi amandoua ajung in aceeasi
 * comanda: doi agenti care scriu in acelasi camp s-ar suprascrie la combinare, iar
 * „primul castiga" ar arunca in tacere raspunsul celuilalt. Se topesc la loc in flux,
 * dupa ce fiecare si-a citit partea lui.
 */
export const CASETAR = new AgentSpecializat({
  nume: 'casetar',
  domeniu: 'caseta',
  camp: 'caseta',
  rol: C.ROL,
  ramuri: { caseta: C.CASETA },
  schema: IESIRE_CASETA,
  citeste: citesteCaseta,
  schemaLaModel: false,
});

export const ECHIPA = [GEOMETRU, TIPOGRAF, CASETAR];
