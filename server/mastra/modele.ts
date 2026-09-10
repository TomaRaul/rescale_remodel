// mastra/modele.ts — de unde vine modelul si in ce ordine se incearca.
//
// Rulat DOAR pe server: cheia nu are ce cauta in browser. Inainte, aici statea si CUM
// se vorbeste cu fiecare API — doua dialecte scrise de mana, cu `fetch` si cu parsarea
// raspunsului. Acum ramane doar CINE si IN CE ORDINE: routerul de modele al lui Mastra
// stie sa vorbeasca cu toti, iar `model: [...]` face trecerea de la unul la altul.
//
//   GEMINI_API_KEY      Google AI Studio   aistudio.google.com/apikey
//   GROQ_API_KEY        Groq               console.groq.com/keys
//   OPENROUTER_API_KEY  OpenRouter         openrouter.ai/keys  (modele cu sufix :free)
//   (niciuna)           Ollama local       ollama.com, apoi `ollama pull llama3.2`
//
// Nimic din fisierul asta nu stie ce e un agent sau ce e o figura.

import type { ModelWithRetries } from '@mastra/core/agent';

/**
 * Raspunsul cerut e un obiect JSON de cateva zeci de tokeni. Plafonul e o plasa
 * impotriva unui model care o ia razna, nu o constrangere reala.
 */
const MAX_OUT = 200;

/**
 * Reglajele care conteaza pentru timpul de asteptare, si de ce.
 *
 *   temperature 0    acelasi prompt pe aceeasi scena da acelasi DSL. Determinismul e
 *                    scopul declarat al proiectului.
 *   thinkingBudget 0 modelele recente „gandesc" implicit inainte sa raspunda. Masurat
 *                    pe gemini-2.5-flash: 81 de tokeni de gandire si 1512 ms, fata de
 *                    892 ms si acelasi raspuns cu gandirea oprita. Traducerea unei
 *                    cereri in DSL nu are ce deliberare sa ceara.
 */
const REGLAJE = { temperature: 0, maxOutputTokens: MAX_OUT };

/** Oprirea gandirii, in dialectul Google. Mastra o duce mai departe neatinsa. */
const FARA_GANDIRE_GOOGLE = { google: { thinkingConfig: { thinkingBudget: 0 } } };

/**
 * Modelele Google care RESPING `thinkingConfig`.
 *
 * Masurat 2026-09-03: raspund „invalid argument" la parametru, dar nici nu gandesc
 * (thoughtsTokenCount = 0), deci nu se pierde nimic sarind peste el. Inainte lista se
 * completa singura, la prima incercare, dintr-un dus-intors esuat; cu Mastra intre noi
 * si API nu mai vedem eroarea aceea, deci lista e fixa. Pretul greselii e mic in
 * ambele sensuri: un model trecut aici degeaba ramane doar la viteza lui de acum.
 *
 * Tot ele nu primesc `maxOutputTokens`: cand gandirea merge, tokenii ei se scad din
 * acelasi buget, iar un plafon mic taie JSON-ul in doua. Masurat: cu 120 de tokeni si
 * gandirea pornita au iesit 96 de ganduri si un raspuns retezat la jumatate.
 */
const FARA_GANDIRE = new Set([
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
]);

/**
 * Rezervele Google, ordonate dupa viteza MASURATA pe API-ul real, nu dupa cat de mare e
 * modelul: cand primul cade din cota, rezerva devine timpul simtit de utilizator.
 *
 * Ce conteaza la primul candidat nu e MEDIANA, ci COADA. El e singurul care nu are pe
 * cine cadea inaintea lui.
 *
 * Masurat 2026-09-03, opt cereri de geometrie DIFERITE:
 *   model                      median     p90      max   peste 1800 ms
 *   gemini-2.5-flash            672 ms   792 ms   792 ms      0/8
 *   gemini-flash-lite-latest   1101 ms  12686 ms 12686 ms     3/8
 *   gemini-3.7-flash           1243 ms  1844 ms  1844 ms      1/8
 *
 * De aceea primul e `gemini-2.5-flash`: cel mai rapid SI cel mai strans. Celelalte doua
 * raman rezerve. Aliasul `-latest` e pastrat dinadins — nu rugineste cand Google muta
 * modelul de sub el.
 *
 * Scoase de tot: `gemini-3.5-flash-lite` (mediana 1656 ms, varf de 7.7 s),
 * `gemini-3.1-flash-lite` (2860 ms), `gemini-3.6-flash` si `gemini-flash-latest`
 * („high demand" la o rulare din trei).
 */
export const REZERVE = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-3.7-flash'];

type Provider = {
  id: string;
  /** prefixul din routerul Mastra: `<prefix>/<model>` */
  prefix: string;
  /** variabilele de mediu care ii dau cheia, in ordinea cautarii */
  env: string[] | null;
  model(): string;
  /** modele de acelasi pret, incercate inaintea trecerii la alt provider */
  rezerve?: string[];
};

const PROVIDERI: Provider[] = [
  {
    id: 'gemini',
    prefix: 'google',
    // `GEMINI_API_KEY` e numele folosit de proiect de la inceput; Mastra cauta singur
    // celelalte doua. Cheia se trece explicit in configuratia modelului, deci numele
    // vechi merge mai departe fara sa mutam nimic in .env.
    env: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    rezerve: REZERVE,
  },
  {
    id: 'groq',
    prefix: 'groq',
    env: ['GROQ_API_KEY'],
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },
  {
    id: 'openrouter',
    prefix: 'openrouter',
    env: ['OPENROUTER_API_KEY'],
    model: () => process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  },
];

/** Cheia primului nume de variabila care chiar are valoare. */
const cheia = (p: Provider) => {
  for (const nume of p.env || []) if (process.env[nume]) return process.env[nume];
  return undefined;
};

export function activeProvider() {
  for (const p of PROVIDERI) {
    if (cheia(p)) return { id: p.id, model: p.model(), env: (p.env as string[])[0] };
  }
  return { id: 'ollama', model: process.env.OLLAMA_MODEL || 'llama3.1', env: null };
}

// ─────────────────────────────────────────────── Ollama, ultima rezerva

/**
 * Cat asteptam lista de modele Ollama. E un server LOCAL: ori raspunde pe loc, ori nu e
 * pornit. Fara termen, un Ollama care atarna ar tine pe loc fiecare cerere, fiindca
 * lantul se construieste INAINTE de orice apel la model.
 */
const OLLAMA_PROBA_MS = Number(process.env.OLLAMA_PROBA_MS) || 600;

/**
 * Cat nu mai intrebam, dupa ce Ollama n-a raspuns. Cine nu era pornit acum n-a pornit
 * intre doua cereri la o secunda distanta. Fara memoria asta, o masina fara Ollama ar
 * plati proba la FIECARE prompt.
 */
const OLLAMA_PAUZA_MS = Number(process.env.OLLAMA_PAUZA_MS) || 30000;

// Ce s-a aflat despre fiecare GAZDA, nu despre „Ollama" in general: cu OLLAMA_URL mutat
// pe alt server, un model tinut minte de la cel dinainte ar fi un raspuns despre
// altcineva. Cheia pe gazda face si testele deterministe, fara sa atinga reteaua.
const _ollamaModel = new Map<string, string>();
const _ollamaTacut = new Map<string, number>();

export const ollamaBaza = () => process.env.OLLAMA_URL || 'http://localhost:11434';

export async function resolveOllamaModel(): Promise<string> {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  const base = ollamaBaza();
  const stiut = _ollamaModel.get(base);
  if (stiut) return stiut;
  if (Date.now() < (_ollamaTacut.get(base) || 0)) {
    throw new Error('Ollama did not answer; will retry later');
  }
  try {
    const r = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(OLLAMA_PROBA_MS) });
    const j = await r.json() as { models?: { name: string }[] };
    const usabil = (j.models || [])
      .map(m => m.name)
      .filter(n => !/embed|bge|minilm/i.test(n));
    if (!usabil.length) throw new Error('Ollama has no text model installed (ollama pull llama3.2)');
    _ollamaModel.set(base, usabil[0]);
    return usabil[0];
  } catch (e) {
    _ollamaTacut.set(base, Date.now() + OLLAMA_PAUZA_MS);
    throw e;
  }
}

/**
 * Ollama ca ULTIMA rezerva, sau null cand nu e de gasit.
 *
 * Nu arunca niciodata: lipsa lui n-are voie sa rupa un lant care incepe cu o cheie buna.
 *
 * Un model local pe procesor poate fi mai lent decat rabdarea browserului (30 s in
 * `parseRemote`). Masurat pe llama3.2: DSL valid, dar in 5-28 s. Cine prefera drumul
 * scurt spre parserul de cuvinte-cheie stinge rezerva cu OLLAMA_REZERVA=0.
 */
async function ollamaDeRezerva(): Promise<ModelWithRetries | null> {
  if (/^(0|nu|false|off)$/i.test(String(process.env.OLLAMA_REZERVA ?? '1'))) return null;
  try {
    const model = await resolveOllamaModel();
    return {
      // Ollama expune un API in dialect OpenAI, deci intra ca model „compatibil", cu
      // adresa scrisa pe fata. Nu e in registrul Mastra si nici n-are de ce sa fie:
      // ce modele sunt instalate se afla doar de la masina asta.
      model: { id: `ollama/${model}`, url: ollamaBaza() + '/v1', apiKey: 'ollama' },
      maxRetries: 0,
      modelSettings: REGLAJE,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────── lantul

/**
 * Lantul de rezerve, in ordine, PESTE PROVIDERI.
 *
 * Cand cota unui provider se epuizeaza, urmatorul din lista preia. Fara asta, o a doua
 * cheie in .env n-ar folosi la nimic.
 *
 * `maxRetries: 0` peste tot in afara de ULTIMUL: reincercarea aceluiasi model care
 * tocmai a raspuns „cota depasita" nu are ce sa repare, iar lantul are oricum pe cine
 * cadea. Doar la capat mai are rost sa insisti — acolo nu mai urmeaza nimeni.
 *
 * ATENTIE la ce NU mai face lantul asta: nu mai are termen scurt per candidat.
 * `providers.js` dadea 1800 ms unei incercari care mai avea pe cine cadea si termenul
 * intreg doar ultimeia, ca un model blocat sa nu coste 9 secunde degeaba. Mastra alege
 * modelul urmator dupa EROARE, nu dupa ceas, iar `abortSignal` n-ar taia un candidat,
 * ci tot lantul. Cine vrea plafonul inapoi il pune deasupra, pe apelul agentului.
 */
export async function lantModele(): Promise<ModelWithRetries[]> {
  const lant: ModelWithRetries[] = [];

  for (const p of PROVIDERI) {
    const apiKey = cheia(p);
    if (!apiKey) continue;

    const numeModel = p.model();
    // modelul cerut explicit primul, apoi rezervele de acelasi pret ale providerului
    const modele = [numeModel, ...(p.rezerve || []).filter(m => m !== numeModel)];

    for (const m of modele) {
      const intrare: ModelWithRetries = {
        model: { id: `${p.prefix}/${m}`, apiKey },
        maxRetries: 0,
        modelSettings: REGLAJE,
      };
      if (p.prefix === 'google') {
        if (FARA_GANDIRE.has(m)) {
          // gandirea nu se poate opri aici, deci nici plafonul de iesire nu e sigur
          intrare.modelSettings = { temperature: 0 };
        } else {
          intrare.providerOptions = FARA_GANDIRE_GOOGLE;
        }
      }
      lant.push(intrare);
    }
  }

  // Ollama, ultima rezerva — INAINTEA parserului de cuvinte-cheie, si CHIAR daca exista
  // o cheie. Altfel un model local pornit pe aceeasi masina ar sta degeaba exact cand
  // Gemini cade din cota, iar cererea ar sari direct la regex, care stie mult mai putin.
  const local = await ollamaDeRezerva();
  if (local) lant.push(local);

  if (!lant.length) throw new Error('no model available: put a key in .env or start Ollama');

  // ultimul nu mai are pe cine cadea, deci acolo merita insistat
  lant[lant.length - 1].maxRetries = 2;
  return lant;
}
