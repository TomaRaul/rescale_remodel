// sanatate.mjs — proba de sanatate a containerului. Chemata din HEALTHCHECK.
//
// Intreaba portul PROPRIU, nu unul fix. Cand cele trei pagini stau in trei containere,
// containerul „canvas" nu asculta pe 8080, iar o proba scrisa pe 8080 l-ar da mereu
// „unhealthy" desi merge perfect.
//
// Portul se afla din `porturi.js`, acelasi modul pe care il citeste si serverul. Nicio
// cifra scrisa de doua ori.

import { portulMeu } from './porturi.js';

const port = portulMeu();

try {
  const r = await fetch('http://127.0.0.1:' + port + '/', {
    signal: AbortSignal.timeout(2500),
  });
  process.exit(r.ok ? 0 : 1);
} catch {
  process.exit(1);
}
