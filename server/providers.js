// providers.js — de unde vine modelul si cum se vorbeste cu el.
//
// Rulat DOAR pe server: cheia nu are ce cauta in browser. Provider-agnostic, ales
// automat dupa prima variabila de mediu gasita. Toate variantele au nivel gratuit.
//
//   GEMINI_API_KEY      Google AI Studio   aistudio.google.com/apikey
//   GROQ_API_KEY        Groq               console.groq.com/keys
//   OPENROUTER_API_KEY  OpenRouter         openrouter.ai/keys  (modele cu sufix :free)
//   (niciuna)           Ollama local       ollama.com, apoi `ollama pull llama3.2`
//
// Nimic din fisierul asta nu stie ce e un agent sau ce e o figura: aici se trimit
// doua siruri de caractere si se primeste unul inapoi.

const PROVIDERS = [
  {
    id: 'gemini',
    env: 'GEMINI_API_KEY',
    get model() { return process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'; },
    native: true,
  },
  {
    id: 'groq',
    env: 'GROQ_API_KEY',
    get model() { return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'; },
    url: 'https://api.groq.com/openai/v1/chat/completions',
  },
  {
    id: 'openrouter',
    env: 'OPENROUTER_API_KEY',
    get model() { return process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'; },
    url: 'https://openrouter.ai/api/v1/chat/completions',
  },
  {
    id: 'ollama',
    env: null,
    get model() { return process.env.OLLAMA_MODEL || 'llama3.1'; },
    get url() { return (process.env.OLLAMA_URL || 'http://localhost:11434') + '/v1/chat/completions'; },
  },
];

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 9000;

// Raspunsul cerut e un obiect JSON de cateva zeci de tokeni. Plafonul e o plasa
// impotriva unui model care o ia razna, nu o constrangere reala.
const MAX_OUT = 200;

// Modelele care au respins `thinkingConfig`. Se afla din mers, la prima incercare:
// familia 2.5 il accepta, cele mai noi „lite" nu, iar lista se schimba in timp.
const FARA_GANDIRE = new Set();

/**
 * Gemini are dialect propriu.
 *
 * Doua reglaje conteaza pentru timpul de asteptare:
 *
 *   temperature 0    acelasi prompt pe aceeasi scena da acelasi DSL. Determinismul
 *                    e scopul declarat al proiectului, iar un raspuns stabil se
 *                    poate si tine minte (vezi memoria din ModelClient).
 *   thinkingBudget 0 modelele recente „gandesc" implicit inainte sa raspunda.
 *                    Masurat pe gemini-2.5-flash: 81 de tokeni de gandire si
 *                    1512 ms, fata de 892 ms si acelasi raspuns cu gandirea oprita.
 *                    Traducerea unei cereri in DSL nu are ce deliberare sa ceara.
 */
async function callGemini(key, model, sys, user, termen = TIMEOUT_MS) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + model + ':generateContent?key=' + key;

  const trimite = async faraGandire => {
    const gen = { responseMimeType: 'application/json', temperature: 0 };
    // Plafonul se pune DOAR cand gandirea e oprita: tokenii de gandire se scad din
    // acelasi buget, iar un plafon mic pe un model care gandeste taie raspunsul in
    // doua. Masurat: cu 120 de tokeni si gandirea pornita au iesit 96 de ganduri si
    // un JSON retezat la jumatate.
    if (faraGandire) {
      gen.thinkingConfig = { thinkingBudget: 0 };
      gen.maxOutputTokens = MAX_OUT;
    }

    const r = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(termen),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: gen,
      }),
    });
    return { r, j: await r.json() };
  };

  const incercamSaOprim = !FARA_GANDIRE.has(model);
  let { r, j } = await trimite(incercamSaOprim);

  // Modelele care nu cunosc parametrul raspund „invalid argument". Il retinem si
  // reincercam pe loc — pretul se plateste o singura data pe model, la pornire.
  if (!r.ok && incercamSaOprim && /invalid argument/i.test((j.error && j.error.message) || '')) {
    FARA_GANDIRE.add(model);
    ({ r, j } = await trimite(false));
  }

  if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);

  const cand = j.candidates && j.candidates[0];
  // Un raspuns retezat da oricum un JSON invalid; spunem de ce, ca sa nu para
  // ca modelul a raspuns aiurea.
  if (cand && cand.finishReason === 'MAX_TOKENS') {
    throw new Error('raspuns retezat la ' + MAX_OUT + ' tokeni (JSON incomplet)');
  }
  const text = cand && cand.content.parts.map(p => p.text).join('');
  return {
    text: text || '',
    usage: {
      in: (j.usageMetadata && j.usageMetadata.promptTokenCount) || 0,
      out: (j.usageMetadata && j.usageMetadata.candidatesTokenCount) || 0,
    },
  };
}

/** Groq, OpenRouter si Ollama vorbesc toate dialectul OpenAI. */
async function callOpenAIStyle(url, key, model, sys, user, termen = TIMEOUT_MS) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  const r = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(termen),
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: MAX_OUT,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
  return {
    text: (j.choices && j.choices[0] && j.choices[0].message.content) || '',
    usage: {
      in: (j.usage && j.usage.prompt_tokens) || 0,
      out: (j.usage && j.usage.completion_tokens) || 0,
    },
  };
}

/**
 * Ollama: daca nu e fixat prin OLLAMA_MODEL, il descoperim singuri din modelele
 * instalate local. Sarim peste modelele de embedding, care nu genereaza text.
 */
let _ollamaModel = null;
export async function resolveOllamaModel() {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  if (_ollamaModel) return _ollamaModel;
  const base = process.env.OLLAMA_URL || 'http://localhost:11434';
  const r = await fetch(base + '/api/tags');
  const j = await r.json();
  const usabil = (j.models || [])
    .map(m => m.name)
    .filter(n => !/embed|bge|minilm/i.test(n));
  if (!usabil.length) throw new Error('Ollama nu are niciun model de text instalat (ollama pull llama3.2)');
  _ollamaModel = usabil[0];
  return _ollamaModel;
}

export function activeProvider() {
  for (const p of PROVIDERS) {
    if (p.env && process.env[p.env]) return p;
  }
  return PROVIDERS[PROVIDERS.length - 1];   // Ollama, ultima varianta
}

/** Toti providerii cu cheie, in ordine. Fara nicio cheie: Ollama local. */
export function provideriConfigurati() {
  const cu = PROVIDERS.filter(p => p.env && process.env[p.env]);
  return cu.length ? cu : [PROVIDERS[PROVIDERS.length - 1]];
}

/**
 * Raspuns legitim „nu e treaba mea".
 *
 * Un agent chemat pentru o cerere care nu-l priveste raspunde gol. Nu e o eroare si
 * nu declanseaza reincercarea: turul merge mai departe cu ce au raspuns ceilalti.
 */
export class RaspunsGol extends Error {
  constructor(cine) {
    super('DSL gol: ' + cine + ' nu are ce raspunde');
    this.name = 'RaspunsGol';
  }
}

/**
 * Un canal catre model, cu lantul de rezerve.
 *
 * Nu stie nimic despre agenti: primeste doua siruri si o functie care spune cum se
 * citeste raspunsul. Fiecare agent isi face propriul apel, deci unul care cade pe
 * cota nu-l blocheaza pe celalalt.
 */
export class ModelClient {
  // Erorile de mai jos merita o alta incercare. Restul — cheie gresita, cerere
  // invalida — nu se repara prin repetare, deci se propaga imediat.
  static RETRIABIL = /no longer available|not found|NOT_FOUND|not supported|high demand|overload|503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|quota|exceeded|rate.?limit|abort|timeout|timed out/i;

  // Rezervele sunt ordonate dupa viteza masurata pe API-ul real, nu dupa cat de mare
  // e modelul: cand primul cade din cota, rezerva devine timpul simtit de utilizator.
  static REZERVE = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];

  /** Cat timp ocolim un model care a raspuns „cota depasita". */
  static PAUZA_COTA_MS = Number(process.env.LLM_PAUZA_COTA_MS) || 60000;

  static COTA = /quota|exceeded|RESOURCE_EXHAUSTED|rate.?limit|429/i;

  // Cota nu se reface intre doua apeluri facute la o secunda distanta. Fara memoria
  // asta, FIECARE cerere plateste din nou dus-intorsul catre modelele epuizate — si
  // le si loveste degeaba, ceea ce nu ajuta cota sa se refaca.
  static _pauzat = new Map();

  static ocolit(model) {
    const pana = ModelClient._pauzat.get(model);
    return Boolean(pana && pana > Date.now());
  }

  static pauzeaza(model, ms = ModelClient.PAUZA_COTA_MS) {
    ModelClient._pauzat.set(model, Date.now() + ms);
  }

  /**
   * Un model care nu raspunde deloc, pana la termen.
   *
   * Masurat pe API-ul real: raspunsurile bune vin in 480–1200 ms. Cand un model se
   * blocheaza, nu intarzie — tace pana la timeout. Cu termenul intreg, fiecare blocaj
   * costa 9 secunde degeaba, iar un tur putea arde 9+9 inainte sa ajunga la un model
   * care raspunde in 900 ms.
   *
   * De aceea o incercare care mai ARE pe cine cadea primeste termen scurt: intrebarea
   * ei nu e „cat de repede raspunde", ci „raspunde acum?". Daca nu, se trece mai
   * departe. Doar ULTIMUL candidat primeste termenul intreg — acolo nu mai exista
   * alternativa, iar a renunta repede inseamna a nu primi niciun raspuns.
   *
   * Regula era la inceput doar pentru PRIMA incercare, si asta lasa jumatate din
   * problema pe masa: cu doua modele mute la rand se platea 4s + 9s, desi al treilea
   * raspundea in 900 ms. Acum se plateste 1.8s + 1.8s.
   *
   * 1800 ms e o data si jumatate cel mai lent raspuns bun masurat (1200 ms). Sub atat
   * s-ar taia raspunsuri vii; peste, s-ar astepta degeaba.
   */
  static TIMEOUT_SCURT_MS =
    Number(process.env.LLM_TIMEOUT_SCURT_MS || process.env.LLM_TIMEOUT_PRIM_MS) || 1800;

  static TACERE = /abort|timeout|timed out/i;

  /**
   * Cat ocolim un model care tocmai s-a blocat.
   *
   * Mai scurt decat pauza de cota: un blocaj e trecator, o cota epuizata nu. Fara
   * memoria asta, urmatoarea cerere platea din nou asteptarea pe acelasi model mort —
   * si, la o cerere ambigua, o platea de cate ori sunt agenti, in paralel.
   */
  static PAUZA_TACERE_MS = Number(process.env.LLM_PAUZA_TACERE_MS) || 15000;

  /**
   * Candidatii de incercat acum, fara cei stiuti epuizati.
   * Daca toti sunt pe pauza, ii incercam totusi: mai bine lent decat deloc.
   */
  deIncercat() {
    const liberi = this.candidati.filter(c => !ModelClient.ocolit(ModelClient.nume(c)));
    return liberi.length ? liberi : this.candidati;
  }

  /**
   * Fabrica: lantul de rezerve, in ordine, PESTE PROVIDERI.
   *
   * Cand cota unui provider se epuizeaza, urmatorul din lista preia. Fara asta, o
   * a doua cheie in .env n-ar folosi la nimic: providerul activ era ales o data si
   * rezervele erau toate ale lui.
   */
  static async creeaza() {
    const lant = [];
    for (const p of provideriConfigurati()) {
      const model = p.id === 'ollama' ? await resolveOllamaModel() : p.model;
      lant.push({ p, model });
      // Gemini are mai multe modele de acelasi pret; le incercam pe toate inainte
      // sa trecem la alt provider.
      if (p.native) {
        for (const m of ModelClient.REZERVE) if (m !== model) lant.push({ p, model: m });
      }
    }
    return new ModelClient(lant);
  }

  /** @param {{p: object, model: string}[]} candidati lantul, in ordinea incercarii */
  constructor(candidati) {
    this.candidati = candidati;
    this.provider = candidati[0].p;   // cel principal, pentru indicatorul din interfata
  }

  static nume(c) {
    return c.p.id + ':' + c.model;
  }

  async unApel(c, sys, user, termen) {
    const key = c.p.env ? process.env[c.p.env] : null;
    return c.p.native
      ? callGemini(key, c.model, sys, user, termen)
      : callOpenAIStyle(c.p.url, key, c.model, sys, user, termen);
  }

  /**
   * Memoria raspunsurilor.
   *
   * La temperatura 0, acelasi prompt pe aceeasi scena da acelasi raspuns. A doua
   * oara nu mai are rost sa fie cerut: se intoarce pe loc si nu costa niciun token.
   * Conteaza mai mult decat pare — cand incerci formulari, jumatate din cereri sunt
   * repetari ale uneia dinainte.
   *
   * Cheia e intregul continut trimis: promptul de sistem (deci si ce agent, si ce
   * ramuri) plus starea scenei. Se schimba orice — alta figura, alt text, alt
   * cuvant in cerere — si e alta cheie.
   */
  static MEMORIE_MAX = Number(process.env.LLM_MEMORIE) || 200;
  static _memorie = new Map();

  /** FNV-1a peste tot continutul: o schimbare oriunde in prompt da alta cheie. */
  static cheie(nume, sys, user) {
    const t = nume + ' ' + sys + ' ' + user;
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36) + ':' + t.length;
  }

  static tineMinte(k, v) {
    const m = ModelClient._memorie;
    m.delete(k);
    m.set(k, v);
    // cele mai vechi ies primele; harta pastreaza ordinea inserarii
    while (m.size > ModelClient.MEMORIE_MAX) m.delete(m.keys().next().value);
  }

  /**
   * @param {(brut: string) => object} citeste transforma raspunsul brut in rezultat.
   *        Poate arunca: un JSON stricat nu opreste turul, se trece la modelul urmator.
   * @returns {{rezultat: object|null, model: string, usage: object, incercari: number}}
   */
  async cere(sys, user, citeste) {
    let rezultat = null, res = null, ultima = null, incercari = 0;
    const lista = this.deIncercat();
    let folosit = lista[0];

    // Cate o intrare pe incercare: ce model, de la ce provider, cat a durat, de ce a
    // picat. Candidatii se incearca UNA DUPA ALTA, deci aici se aduna timpul cand
    // primele modele tac. Fara jurnalul asta, un tur lent arata la fel indiferent de cauza.
    const jurnal = [];

    for (const cand of lista) {
      incercari++;
      const nume = ModelClient.nume(cand);
      const t0 = Date.now();
      try {
        const k = ModelClient.cheie(nume, sys, user);
        const stiut = ModelClient._memorie.get(k);
        if (stiut !== undefined) {
          // raspuns tinut minte: zero tokeni, zero asteptare
          jurnal.push({ model: cand.model, provider: cand.p.id, ms: Date.now() - t0, ok: true, memorat: true });
          return {
            rezultat: citeste(stiut), model: cand.model, provider: cand.p.id,
            incercari, jurnal, usage: { in: 0, out: 0 }, memorat: true,
          };
        }

        // Renuntam repede cat timp mai avem pe cine cadea — la ORICE incercare, nu
        // doar la prima. Ultimul candidat primeste termenul intreg: acolo nu mai e
        // alternativa, deci rabdarea chiar are ce sa astepte.
        const maiSunt = incercari < lista.length;
        const termen = maiSunt ? ModelClient.TIMEOUT_SCURT_MS : undefined;
        res = await this.unApel(cand, sys, user, termen);
        rezultat = citeste(res.text);
        ModelClient.tineMinte(k, res.text);   // doar raspunsurile care au trecut de validare
        folosit = cand;
        jurnal.push({ model: cand.model, provider: cand.p.id, ms: Date.now() - t0, ok: true });
        break;
      } catch (e) {
        ultima = e;
        rezultat = null;
        const msg = String(e.message || e);
        jurnal.push({
          model: cand.model, provider: cand.p.id,
          ms: Date.now() - t0, ok: false, de_ce: msg.slice(0, 80),
        });

        // „nu e treaba mea" e un raspuns, nu un esec: nu mai incercam alt model
        if (e instanceof RaspunsGol || /DSL gol/.test(msg)) {
          return {
            rezultat: null, model: cand.model, provider: cand.p.id, incercari, jurnal,
            usage: res ? res.usage : { in: 0, out: 0 },
          };
        }
        // model epuizat: il ocolim la apelurile urmatoare, nu doar la asta
        if (ModelClient.COTA.test(msg)) ModelClient.pauzeaza(nume);
        // model blocat: la fel, dar mai scurt — tacerea trece, cota nu
        else if (ModelClient.TACERE.test(msg)) ModelClient.pauzeaza(nume, ModelClient.PAUZA_TACERE_MS);

        const raspunsProst = /JSON|json|Unexpected|Expected/.test(msg);
        if (!ModelClient.RETRIABIL.test(msg) && !raspunsProst) { e.jurnal = jurnal; throw e; }
      }
    }

    if (!rezultat) { if (ultima) ultima.jurnal = jurnal; throw ultima; }
    return {
      rezultat, model: folosit.model, provider: folosit.p.id,
      usage: res.usage, incercari, jurnal,
    };
  }
}
