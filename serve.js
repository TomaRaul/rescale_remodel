// serve.js — server static + proxy catre model.
//
// Rulare:  npm start        apoi deschide http://localhost:8080
//
// Proxy-ul exista dintr-un singur motiv: cheia API nu poate sta in JS-ul din browser,
// pentru ca oricine deschide DevTools ar vedea-o. Browserul cere /api/parse,
// serverul tine cheia si vorbeste cu modelul.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askModel, activeProvider, resolveOllamaModel } from './server/llm.js';

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
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

const json = (res, codeNum, body) => {
  res.writeHead(codeNum, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => {
    b += c;
    if (b.length > 1e5) { req.destroy(); reject(new Error('corp prea mare')); }
  });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // ce provider e activ — folosit de interfata ca sa afiseze indicatorul
  if (url === '/api/status') {
    const p = activeProvider();
    let model = p.model;
    if (p.id === 'ollama') {
      try { model = await resolveOllamaModel(); } catch { model = 'niciun model instalat'; }
    }
    return json(res, 200, { provider: p.id, model, needsKey: Boolean(p.env) });
  }

  // prompt -> DSL
  if (url === '/api/parse' && req.method === 'POST') {
    try {
      const { prompt, state, doar } = JSON.parse(await readBody(req));
      if (!prompt || !state) return json(res, 400, { error: 'lipsesc prompt sau state' });
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

  // fisiere statice
  const rel = decodeURIComponent(url);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
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
});

// Oprire curata: inchidem serverul si eliberam portul explicit.
// Pe Windows, `npm start` mai intreaba "Terminate batch job (Y/N)?" — intrebarea vine
// de la cmd.exe pentru wrapper-ul .cmd al lui npm, nu de la Node, care s-a oprit deja.
// Cu `node serve.js` direct, intrebarea nu apare.
let seInchide = false;
for (const semnal of ['SIGINT', 'SIGTERM']) {
  process.on(semnal, () => {
    if (seInchide) process.exit(0);
    seInchide = true;
    console.log('\nSe oprește serverul, portul ' + PORT + ' se eliberează…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();   // daca o conexiune atarna
  });
}

server.listen(PORT, () => {
  const p = activeProvider();
  const stare = p.env
    ? `model: ${p.id} (${p.model})`
    : `model: ollama local (${p.model}) — nicio cheie API găsită în mediu`;
  console.log(`Deschide  http://localhost:${PORT}`);
  console.log(stare);
  if (!p.env) {
    console.log('Fără cheie și fără Ollama pornit, aplicația merge pe parserul de cuvinte-cheie.');
  }
});
