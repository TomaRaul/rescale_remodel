// serve.js — server static + proxy catre model.
//
// Rulare:  npm start        apoi deschide http://localhost:8080
//
// Proxy-ul exista dintr-un singur motiv: cheia API nu poate sta in JS-ul din browser,
// pentru ca oricine deschide DevTools ar vedea-o. Browserul cere /api/parse,
// serverul tine cheia si vorbeste cu modelul.
//
// Conturile merg pe acelasi tipar si prin acelasi proces: browserul se autentifica la
// Supabase si primeste un jeton, dar nu vorbeste niciodata direct cu baza de date.
// Cere /api/panze cu jetonul in antet, serverul il valideaza, afla din el cine e omul
// si abia el scrie randul. Niciun serviciu nou — inca un modul, ca `llm.js`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askModel, activeProvider, resolveOllamaModel } from './dist/llm.js';
import * as cont from './dist/supabase.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Incarca .env daca exista, ca sa nu trebuiasca setata variabila la fiecare pornire.
// Variabilele deja prezente in mediu au prioritate.
try {
  for (const raw of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    const q = v.slice(0, 1);
    if ((q === '"' || q === "'") && v.slice(-1) === q) v = v.slice(1, -1);
    if (v && !process.env[k]) process.env[k] = v;
  }
} catch { /* fara .env, se folosesc variabilele de mediu */ }
/**
 * Trei pagini, trei porturi. Fiecare port serveste O SINGURA pagina la „/".
 *
 *   8080  poarta        autentificarea; singurul loc in care se ajunge fara cont
 *   8082  panzele       alegi una dintre pânzele tale, sau incepi una noua
 *   8081  pânza         aplicatia propriu-zisa
 *
 * FARA `ROL`, un singur proces asculta pe toate trei — asa merge `npm start`. CU `ROL`,
 * procesul serveste o singura pagina, si atunci se pornesc trei containere, cate unul
 * pe rol. Harta si citirea mediului stau in `porturi.js`, fiindca le citeste si proba de
 * sanatate a containerului.
 *
 * Rutele /api/* raspund la fel pe orice port si in orice varianta. De aceea cele trei
 * containere NU trebuie sa vorbeasca intre ele: fiecare pagina isi cere datele de la
 * containerul ei, pe aceeasi origine, deci nu exista CORS nicaieri.
 *
 * PRETUL, si trebuie stiut: pentru browser, `localhost:8080` si `localhost:8081` sunt
 * ORIGINI DIFERITE. `localStorage` — unde clientul Supabase tine sesiunea — e izolat pe
 * origine, portul inclusiv. De aceea sesiunea se preda explicit la trecerea dintr-o
 * pagina in alta, prin fragmentul din URL (vezi `Cont.legatura`). Cu o singura pagina
 * si trei cai n-ar fi fost nevoie de nimic din toate astea.
 */
import { PAGINI, DESCRIERI, porturi, roluriDeServit, porturiAnuntate } from './porturi.js';

const PORTURI = porturi();

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

const json = (res, codeNum, body) => {
  res.writeHead(codeNum, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

// Plafonul e argument, nu constanta: un prompt are cateva sute de octeti, o scena
// salvata are zeci de kilobytes. Cu o singura cifra pentru amandoua, ori promptul
// ramane fara plasa, ori pânza nu incape.
const readBody = (req, max = 1e5) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => {
    b += c;
    if (b.length > max) { req.destroy(); reject(new Error('body too large')); }
  });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

/** Jetonul din antetul `Authorization: Bearer …`, sau sirul gol. */
const jeton = req => {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
};

/**
 * Acelasi handler pentru toate trei porturile; `rol` spune pe care a intrat cererea.
 * Doar radacina „/" depinde de el — tot restul, fisiere si /api/*, e la fel peste tot.
 */
const handler = rol => async (req, res) => {
  const url = req.url.split('?')[0];

  // ce provider e activ — folosit de interfata ca sa afiseze indicatorul
  if (url === '/api/status') {
    const p = activeProvider();
    let model = p.model;
    if (p.id === 'ollama') {
      try { model = await resolveOllamaModel(); } catch { model = 'no model installed'; }
    }
    return json(res, 200, { provider: p.id, model, needsKey: Boolean(p.env) });
  }

  // prompt -> DSL
  if (url === '/api/parse' && req.method === 'POST') {
    // Cand conturile sunt pornite, modelul e al celor care au cont. Fara poarta asta,
    // pagina de autentificare ar fi doar o usa de sticla: cine stie adresa ar putea
    // consuma cota cu un `curl`, fara sa deschida macar aplicatia.
    //
    // Cand nu sunt configurate, ruta ramane deschisa ca inainte — un proiect clonat
    // fara Supabase trebuie sa mearga la fel ca pana acum.
    if (cont.activ()) {
      try {
        await cont.utilizator(jeton(req));
      } catch (e) {
        return json(res, 401, { error: String(e.message || e) });
      }
    }
    try {
      const { prompt, state, doar } = JSON.parse(await readBody(req));
      if (!prompt || !state) return json(res, 400, { error: 'missing prompt or state' });
      // din ce caseta de comanda vine cererea; orice altceva se ignora, ca sa nu poata
      // un client sa ceara o rutare care nu exista
      const domeniu = doar === 'panza' || doar === 'figuri' ? doar : undefined;
      const r = await askModel(String(prompt).slice(0, 2000), state, domeniu);
      return json(res, 200, r);
    } catch (e) {
      // 503 = clientul cade elegant pe parserul local de cuvinte-cheie
      return json(res, 503, { error: String(e.message || e) });
    }
  }

  // ── conturile ────────────────────────────────────────────────────────────────

  // Ce ii trebuie browserului ca sa se autentifice singur. Cheia „anon" e publica prin
  // constructie: fara sesiune nu deschide nimic, fiindca RLS taie randurile care nu
  // sunt ale ei. Cheia de serviciu nu pleaca de aici niciodata.
  // Porturile pleaca MEREU, si cand conturile sunt oprite: paginile trebuie sa stie
  // unde se duc una la alta, iar o cifra scrisa cu mana in JS ar ramane in urma la
  // prima schimbare de `PORT_*`. Un singur adevar, cel din mediu.
  if (url === '/api/config') {
    // Se anunta doar rolurile care CHIAR exista in instalarea asta. Cand se pornesc
    // doar doua containere din trei, pagina care lipseste nu mai apare in harta, iar
    // cine ar fi fost trimis acolo e trimis mai departe (vezi `Autentificare`).
    return json(res, 200, {
      ...(cont.configPublic() || { activ: false }),
      porturi: porturiAnuntate(),
    });
  }

  if (url === '/api/panze' || url.startsWith('/api/panze/')) {
    if (!cont.activ()) {
      return json(res, 503, { error: 'accounts are not configured on the server' });
    }

    // Cine e omul se afla INAINTE de orice atingere a tabelului, si dintr-un jeton
    // semnat — nu dintr-un camp al cererii. Tot ce urmeaza foloseste id-ul asta.
    let om;
    try {
      om = await cont.utilizator(jeton(req));
    } catch (e) {
      return json(res, 401, { error: String(e.message || e) });
    }

    const id = url.startsWith('/api/panze/')
      ? decodeURIComponent(url.slice('/api/panze/'.length))
      : '';

    try {
      if (req.method === 'GET' && !id) {
        return json(res, 200, { panze: await cont.lista(om.id) });
      }
      if (req.method === 'GET') {
        const p = await cont.adu(om.id, id);
        return p ? json(res, 200, p) : json(res, 404, { error: 'no such canvas' });
      }
      if (req.method === 'POST' && !id) {
        const { nume, continut } = JSON.parse(await readBody(req, cont.CONTINUT_MAX));
        return json(res, 200, await cont.salveaza(om.id, nume, continut));
      }
      if (req.method === 'DELETE' && id) {
        await cont.sterge(om.id, id);
        return json(res, 200, { ok: true });
      }
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  // fisiere statice
  // Radacina fiecarui port da pagina lui. Fisierele se servesc la fel de peste tot:
  // `src/` e comun celor trei pagini, deci n-are rost impartit pe porturi.
  const rel = decodeURIComponent(url);
  const file = path.join(ROOT, rel === '/' ? PAGINI[rol] : rel);
  // Comparatia se face cu SEPARATOR, nu doar cu prefixul: „C:\proiect2" incepe tot cu
  // „C:\proiect", deci un director frate cu nume asemanator ar fi trecut de verificare.
  // `path.join` a rezolvat deja orice „..", asa ca ce ramane in afara chiar e in afara.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found: ' + rel); return; }
    const type = (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
};

// Oprire curata: inchidem serverele si eliberam porturile explicit.
// Pe Windows, `npm start` mai intreaba "Terminate batch job (Y/N)?" — intrebarea vine
// de la cmd.exe pentru wrapper-ul .cmd al lui npm, nu de la Node, care s-a oprit deja.
// Cu `node serve.js` direct, intrebarea nu apare.
// Cate un ascultator pe rol — unul singur cand `ROL` e pus, toate trei cand nu e.
// Daca doua roluri primesc acelasi port — cineva a pus PORT_PANZE=8080 — se porneste
// unul singur, si se spune care pagina castiga, in loc sa cada al doilea cu EADDRINUSE
// si sa para ca proiectul e stricat.
const servere = [];
const ocupate = new Map();
for (const rol of roluriDeServit()) {
  const port = PORTURI[rol];
  const deja = ocupate.get(port);
  if (deja) {
    console.log(`warning: port ${port} is claimed by both "${rol}" and "${deja}" — "${deja}" wins`);
    continue;
  }
  ocupate.set(port, rol);
  servere.push({ rol, port, server: http.createServer(handler(rol)) });
}

let seInchide = false;
for (const semnal of ['SIGINT', 'SIGTERM']) {
  process.on(semnal, () => {
    if (seInchide) process.exit(0);
    seInchide = true;
    const lista = servere.map(s => s.port).join(', ');
    console.log('\nStopping the server, ports ' + lista + ' are being released…');
    let ramase = servere.length;
    for (const s of servere) s.server.close(() => { if (--ramase === 0) process.exit(0); });
    setTimeout(() => process.exit(0), 1500).unref();   // daca o conexiune atarna
  });
}

let pornite = 0;
const laPornire = () => {
  if (++pornite < servere.length) return;

  const p = activeProvider();
  const stare = p.env
    ? `model: ${p.id} (${p.model})`
    : `model: local ollama (${p.model}) — no API key found in the environment`;

  // Un container serveste o singura pagina, deci se scrie exact ce raspunde AICI. Cand
  // toate trei sunt in acelasi proces, se scriu toate, cu poarta prima.
  const asa = [...servere].sort((a, b) =>
    (a.rol === 'poarta' ? -1 : 0) - (b.rol === 'poarta' ? -1 : 0));
  asa.forEach((s, i) => {
    const eticheta = i === 0 ? 'Open     ' : '         ';
    console.log(`${eticheta} http://localhost:${s.port}   (${DESCRIERI[s.rol]})`);
  });
  console.log(stare);
  // Conturile lipsesc la fel de linistit ca o cheie de model: aplicatia deseneaza si
  // fara ele, doar ca nu salveaza. Se spune o data, la pornire, ca sa nu se caute
  // degeaba panoul in pagina.
  console.log(cont.activ()
    ? 'accounts: supabase (saving canvases is enabled)'
    : 'accounts: off — without SUPABASE_URL and SUPABASE_SERVICE_KEY you go straight to the canvas');
  if (!p.env) {
    console.log('With no key and no Ollama running, the app falls back to the keyword parser.');
  } else {
    // Proba pentru Ollama se face ACUM, la pornire, nu la prima cerere: răspunsul se
    // ține minte, deci omul care scrie primul prompt nu mai plătește nici măcar cele
    // 600ms de așteptare. Eșecul e normal — înseamnă doar că nu e pornit.
    resolveOllamaModel().then(
      m => console.log(`local fallback: ollama (${m}), after the models with a key`),
      () => console.log('local fallback: the keyword parser (Ollama is not running)'),
    );
  }
};

for (const s of servere) s.server.listen(s.port, laPornire);
