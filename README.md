# Restructurare imagine + text prin catalog de atribute

Aplicație de desen pe pânză, condusă din limbaj natural, în care **modelul traduce
cererea în comenzi, dar nu calculează nimic**. Geometria — poziții, dimensiuni, așezarea
textului, împărțirea figurilor — se face local, determinist. Ce pleacă spre model e un
prompt de sistem strâns pe ramuri plus starea scenei; nu se trimite niciodată istoricul
conversației, deci **turul 50 costă cât turul 1**.

Domeniul e restrâns dinadins la o singură formă: patrulaterul cu unghiuri drepte (pătrat
sau dreptunghi). Fiecare formă în plus ar însemna reguli în plus în prompt, adică tokeni
la fiecare cerere și încă o șansă ca modelul să aleagă greșit.

---

## Ce face, pe scurt

- **Pânză** de 800×800 px (poate crește până la 1200), cu originea (0,0) în **stânga
  jos** și grilă de 50 px.
- **Două casete de comandă**, fiecare o refuză pe cealaltă: una doar pentru gabaritul
  pânzei, alta pentru figuri și text. Care casetă a fost folosită e un semnal de rutare
  dat de om — gratis și fără echivoc, spre deosebire de cuvinte.
- **Prompturi în română**: „fa un dreptunghi de 300 pe 150 la 400,400", „imparte figura
  0 in 3", „scrie MIAU in fiecare figura", „pune textul intr-o caseta", „micsoreaza
  panza la 250 pe 100".
- **Mouse pentru ce n-are ce traduce**: click selectează (Shift adaugă), tragerea mută
  toată selecția, tragerea din gol desenează un dreptunghi de selecție. Un gest e o
  singură schimbare, deci un singur Undo.
- **Contabilitate de tokeni vizibilă**: fiecare tur arată ce a costat, față de două
  strategii alternative pentru același rezultat.
- **Conturi personale**, prin Supabase: prima pagină e autentificarea, iar aplicația
  pornește doar cu sesiune. Fiecare își salvează pânzele sub numele lui și le încarcă
  înapoi; pânzele unuia nu se văd de la altul. Pe un server fără Supabase configurat,
  poarta se dă la o parte și aplicația merge ca înainte, doar că nu salvează nicăieri.

---

## Pornire

Cerință: **Node ≥ 22.13** (o cere `@mastra/core`).

```bash
npm install
cp .env.example .env      # și pune o singură cheie, oricare
npm start                 # compilează serverul și pornește pe 8080 / 8082 / 8081
```

Fără nicio cheie și fără Ollama pornit, aplicația tot merge: cade pe parserul local de
cuvinte-cheie, care înțelege mult mai puțin, dar răspunde instantaneu și gratis.

### Docker

```bash
docker compose up --build     # trei containere: log (8080), canvas-selection (8082), canvas (8081)
```

Imaginea are două etape: prima compilează `server/*.ts` în `dist/`, a doua rulează cu
`npm ci --omit=dev`, ca utilizator `node`.

**Un container pe pagină**, toate din aceeași imagine — se schimbă doar `ROL`:

| serviciu | port | ce servește |
|---|---|---|
| `log` | 8080 | autentificarea |
| `canvas-selection` | 8082 | alegerea pânzei |
| `canvas` | 8081 | pânza |

Nu vorbesc între ele. Fiecare container servește pagina lui **și** toate rutele `/api/*`,
deci fiecare pagină își cere datele de la containerul ei, pe aceeași origine — fără CORS
și fără rețea internă. Ce le leagă e Supabase, care e în afară.

```bash
docker compose up -d                          # toate trei
docker compose up -d canvas                   # doar pânza
ROLURI=log,canvas docker compose up -d log canvas   # două din trei
docker compose ps                             # stare și sănătate
docker compose logs -f canvas                 # logurile unuia
docker compose down                           # oprește tot
```

`ROLURI` spune fiecărui container **ce pagini există** în instalare. Fără el, poarta ar
trimite după autentificare într-un port care nu rulează. Cu `ROLURI=log,canvas`,
`/api/config` nu mai anunță pagina de alegere: poarta duce direct în pânză, iar butonul
*Pânzele mele* dispare din aplicație.

Harta rolurilor stă în `porturi.js`, citit și de `serve.js`, și de `sanatate.mjs` (proba
de sănătate a containerului). Cu o cifră scrisă în Dockerfile, containerul `canvas` ar
fi fost mereu `unhealthy` — el nu ascultă pe 8080. `ROL` acceptă și numele containerelor
(`log`, `canvas-selection`, `canvas`), și pe cele din cod (`poarta`, `panze`, `panza`);
unul scris greșit oprește pornirea și enumeră ce se acceptă, în loc să cadă tăcut pe un
implicit.

Fără `ROL`, un singur proces ascultă pe toate trei porturile — așa merge `npm start`.

### Scripturi

| comandă | ce face |
|---|---|
| `npm start` | `tsc` + `node serve.js` (cele trei porturi) |
| `npm test` | `tsc` + verificarea headless (`test.mjs`) |
| `npm run build` | doar compilarea serverului |
| `npm run typecheck` | `tsc --noEmit` |

---

## Modelul: chei, ordine, rezerve

E nevoie de **una singură**; prima găsită câștigă, în ordinea de mai jos.

| variabilă | provider | de unde |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | aistudio.google.com/apikey |
| `GROQ_API_KEY` | Groq | console.groq.com/keys |
| `OPENROUTER_API_KEY` | OpenRouter | openrouter.ai/keys (modele cu sufix `:free`) |
| *(niciuna)* | Ollama local | `ollama pull llama3.2` |

Lanțul de rezerve e al lui Mastra și trece **peste provideri**: când unul cade din cotă,
îl preia următorul. La Google se încearcă întâi `gemini-2.5-flash`, apoi
`gemini-flash-lite-latest` și `gemini-3.7-flash` — ordinea e după viteza **măsurată** pe
API-ul real, nu după mărimea modelului. La primul candidat nu contează mediana, ci
coada: el e singurul care n-are pe cine cădea înaintea lui.

**Ollama e mereu ultima rezervă** — și când există o cheie, nu doar când nu există. Intră
după toate modelele cu cheie și înaintea parserului de cuvinte-cheie; se stinge cu
`OLLAMA_REZERVA=0`.

Reglaje fixe: `temperature: 0` (același prompt pe aceeași scenă dă același DSL) și
gândirea oprită acolo unde se poate — măsurat pe `gemini-2.5-flash`, 81 de tokeni de
gândire și ~620 ms în plus pentru exact același răspuns.

Restul reglajelor opționale sunt documentate rând cu rând în `.env.example`.

---

## Arhitectura

```
browser (src/, JS pur, fără bundler)        server (TypeScript, compilat în dist/)
┌────────────────────────────────┐          ┌──────────────────────────────────┐
│ App.js        orchestrator     │  POST    │ serve.js   static + proxy        │
│ PromptParser  → /api/parse     │ ───────► │   /api/parse   /api/status       │
│   ↳ rezervă locală pe regex    │ DSL JSON │ llm.ts     singura ușă de intrare│
│ LayoutEngine  geometria        │ ◄─────── │   ↳ memorie.ts   cache LRU       │
│ TextBinder    legarea textului │          │   ↳ mastra/flux.ts   Workflow    │
│ AnimationEngine → Renderer     │          │      rutare → 3 agenți → combină │
└────────────────────────────────┘          └──────────────────────────────────┘
```

Proxy-ul din `serve.js` există dintr-un singur motiv: cheia API nu poate sta în JS-ul din
browser, unde oricine o vede din DevTools. Frontendul e ES modules servite direct, fără
pas de build.

### Turul unei cereri

1. **Memoria** (`server/memorie.ts`) — cheie FNV-1a peste cerere, starea scenei și caseta
   din care vine. Un tur repetat se servește pe loc: zero tokeni, zero agenți treziți,
   nici măcar graful nu se construiește. Ține minte ultimele 200 de răspunsuri, LRU.
2. **Routerul** (`server/mastra/router.ts`) — clasificare locală prin cuvinte-cheie,
   **zero tokeni, zero milisecunde**. Decide două lucruri deodată: ce agenți sunt chemați
   și ce ramuri din promptul fiecăruia pleacă efectiv pe fir. Nu-i cunoaște pe agenți pe
   nume — se uită ce ramuri își declară fiecare, deci un agent nou nu cere nicio
   modificare aici.
3. **Agenții, în paralel** (`server/mastra/agenti.ts`) — Workflow Mastra cu `.parallel()`.
   Turul durează cât cel mai lent agent chemat, nu cât suma lor; un agent nechemat se
   întoarce imediat, fără să atingă rețeaua.
4. **Combinarea** (`server/mastra/flux.ts`) — fiecare agent scrie doar în câmpul lui, deci
   nu se pot suprascrie. Un agent care spune „nu e treaba mea" (`RaspunsGol`) nu e o
   eroare; turul eșuează doar dacă nimeni n-a produs nimic, și atunci se raportează
   cauza reală, nu constatarea.

### Echipa

| agent | câmp DSL | ramuri | de ce răspunde |
|---|---|---|---|
| **Geometru** | `g` | `creare`, `modifica`, `panza` | figuri: creare, mutare, tăiere, mărime |
| **Tipograf** | `t` | `text-nou`, `text-poz` | ce scrie textul și unde stă |
| **Casetar** | `caseta` → `t` | `caseta` | dacă textul intră într-o casetă și cât e de mare |

Izolarea între agenți **nu** se sprijină pe rugămintea din prompt („nu emite câmpul t"),
ci pe cod lipsă: geometrul pur și simplu nu are cititor pentru text, deci un câmp
strecurat nu ajunge nicăieri. Casetarul are câmp propriu tocmai ca doi agenți să nu scrie
în același loc; se topește în `text` la combinare, ultimul.

Ramurile sunt separate din același motiv economic: „imparte figura 0 in 3" n-are de ce să
plătească documentația pânzei (52 de tokeni la fiecare tăiere), iar „pune textul pe
latura de sus" n-are de ce să plătească documentația casetelor (~370 de tokeni).

### DSL-ul

JSON minificat: cheile au un caracter, punctele sunt perechi `[x,y]`, ce nu e cerut se
omite complet.

```jsonc
{"g":{"o":"r","w":300,"h":150,"p":[400,400]},"y":"dreptunghi"}
```

Operații de geometrie: `r` dreptunghi nou · `s` taie în bucăți · `z` redimensionează ·
`m` mută · `c` golește scena · `p` gabaritul **pânzei**, nu al figurilor. Când cererea
înșiră mai multe operații, `g` devine listă (cel mult 8), aplicate pe rând, cu un singur
Undo peste tot lanțul.

Comanda de text poartă legarea în `b`: `i` în figură · `e` pe o latură · `k` într-un colț
· `q` într-un punct de pe pânză · `p` pe fiecare piesă · `s` pe toate laturile · `l` pe
contur · `c` în colțuri · `x` în casetă · `n` ascuns.

Ținta e `n`: un număr e o figură (`#0`, `#1`…), un `"t1"` e un text. Cele două numerotări
sunt independente, ca „figura 1" să însemne mereu a doua figură, oricâte texte s-ar fi
scris între timp.

`server/mastra/scheme.ts` ține DSL-ul în două ipostaze: **schema Zod**, care poate pleca
la model prin `structuredOutput`, și **cititorul**, care nu respinge, ci repară — taie ce
e prea mare, rotunjește, aruncă pasul invalid și păstrează restul. Un model care greșește
un câmp din opt nu trebuie să piardă turul întreg.

> Schema pleacă la model doar unde a fost **verificată pe modelul real** — deocamdată la
> geometrie. Măsurat pe `gemini-2.5-flash`, o schemă plată cu multe câmpuri opționale
> înrăutățește răspunsul: emite primul câmp, le pierde pe următoarele și inventează unul.
> Cu operația ca discriminator, răspunsul redevine corect. Textul și caseta merg
> deocamdată pe proza promptului, adică exact contractul dinainte de migrarea pe Mastra.

---

## Conturi și pânze salvate

Supabase e folosit **strict** ca furnizor de identitate și de stocare. Nu s-a adăugat
niciun serviciu: `server/supabase.ts` e încă un modul în același proces, ca `llm.ts`, iar
`serve.js` rămâne singurul dispecer.

### Trei pagini, trei porturi

| port | pagină | ce e |
|---|---|---|
| **8080** | `index.html` | **poarta**: intrare, sau cont nou (email + nume + parolă) |
| **8082** | `panze.html` | **alegerea**: deschizi o pânză salvată, sau începi una nouă |
| **8081** | `app.html` | **pânza**: prompturile, desenul, salvarea |

Nu sunt trei procese: e același `serve.js` și același handler, ascultând în trei locuri.
Rutele `/api/*` răspund pe toate trei, deci fiecare pagină își cere datele de la ea
de-acasă și nu există CORS nicăieri. Porturile se schimbă din `.env`
(`PORT_POARTA`, `PORT_PANZE`, `PORT_PANZA`), iar paginile le află de la server prin
`/api/config` — nicio cifră scrisă cu mâna în JS.

Autentificarea e o pagină **separată**, nu un panou peste pânză. Diferența nu e de
estetică: cât timp formularul stătea în aceeași pagină cu aplicația, marcajul aplicației
exista deja în DOM, iar „nu poți intra fără cont" era o afirmație despre *ce se vede*, nu
despre *ce s-a încărcat*.

### Contul nou: ce se cere și ce se verifică

Formularul are două moduri, comutate din legătura de sub el. La **intrare**: email și
parolă. La **cont nou**: email, nume de utilizator și parolă, cu regulile bifate pe
măsură ce scrii.

| câmp | regula |
|---|---|
| email | conține `@` și se termină în `.com`, fără spații, cu ceva de-o parte și de alta |
| nume de utilizator | între 3 și 32 de caractere |
| parolă | cel puțin **8** caractere **și** cel puțin un caracter special |

„Caracter special" e definit prin excludere — orice nu e literă, cifră sau spațiu
(`/[^\p{L}\p{N}\s]/u`). O listă scrisă de mână (`!@#$…`) ar respinge tăcut un semn
dintr-un alt alfabet, iar omul n-ar avea cum să ghicească de ce.

Regulile stau în `src/cont/Validare.js`, ca **funcții pure** — fără DOM, fără rețea. De
aceea intră în `test.mjs` (35 de verificări): o regulă scrisă direct într-un `onclick` nu
se poate proba, deci se strică tăcut la prima rescriere a paginii. Se cheamă din două
locuri — din formular, pentru feedback în timp real, și din `Cont.inregistreaza()`,
înainte de plecarea spre Supabase, ca să nu poată fi ocolite de alt apelant.

La **intrare** parola nu se validează după aceste reguli: una veche, făcută pe alte
reguli, trebuie să mai poată fi folosită. Regulile privesc parolele noi.

Numele de utilizator pleacă în `user_metadata` al lui Supabase, nu într-un tabel al
nostru. E un nume de **afișare** — intrarea se face tot pe email, fiindcă aia e cheia pe
care o știe Supabase. Cu un tabel separat i s-ar putea impune și unicitatea, dar ar cere
încă un pas de configurare pentru ceva ce deocamdată doar se scrie pe ecran.

> **Validarea din browser e UX, nu apărare.** Trăiește în pagină, iar pagina e a omului:
> cine vrea poate vorbi direct cu API-ul Supabase, cu cheia publică. Impunerea adevărată a
> parolei se pune în Supabase Dashboard, la **Authentication → Policies** (lungime minimă
> și tipuri de caractere cerute) — acolo trebuie pusă aceeași cifră, 8. Pentru regula
> `@`/`.com` nu există echivalent în dashboard.

### Prețul celor trei porturi: sesiunea nu trece singură

Pentru browser, `localhost:8080` și `localhost:8081` sunt **origini diferite** — portul
face parte din origine. `localStorage`, unde clientul Supabase ține sesiunea, e izolat pe
origine. Cine s-ar autentifica pe 8080 ar ajunge pe 8081 **nelogat**, la nesfârșit.

De aceea sesiunea se predă explicit la fiecare trecere, prin **fragmentul** adresei —
partea de după `#`, care nu se trimite niciodată către server, nu intră în loguri și nu
apare în `Referer`. E exact locul în care Supabase însuși pune jetoanele la întoarcerea
dintr-un login OAuth. Pagina care îl primește îl instalează cu `setSession()` și îl
șterge pe loc, cu `replaceState`. De acolo încolo fiecare port își are sesiunea lui și
se reîmprospătează singur.

Tot ce ține de asta stă în `Cont.legatura()` și `Cont.preiaDinURL()`. Cu o singură pagină
și trei căi n-ar fi fost nevoie de nimic din toate astea.

Id-ul pânzei alese trece prin **interogare** (`/?panza=<uuid>`), nu conținutul: pânza și-l
cere singură de la server, cu jetonul ei, deci un desen întreg nu trece printr-o bară de
adresă.

Acum sunt trei încuietori, una peste alta:

1. poarta (8080) trimite mai departe doar dacă găsește o sesiune păstrată
2. `panze.html` și `app.html` au `<body hidden>` și verifică sesiunea **înainte** să
   construiască ceva — la 8081, înainte de `new App()`, deci nu e o pânză ascunsă, e o
   pânză care nu s-a făcut
3. `/api/parse` cere `Authorization: Bearer …` când conturile sunt pornite — altfel poarta
   ar fi o ușă de sticlă: cine știe adresa ar consuma cota cu un `curl`, fără să deschidă
   aplicația

Un 401 pe `/api/parse` (jeton expirat, sesiune închisă din alt tab) trimite pagina înapoi
la poartă. Nu cade pe rezerva locală de regex — asta ar face aplicația să pară că merge
fără cont.

> Ce nu garantează: `serve.js` servește fișiere statice, deci `app.html` și `src/` se pot
> descărca oricum. Codul e vizibil; **datele și modelul nu**. Pentru a ascunde și
> fișierele ar fi nevoie de sesiuni pe cookie, verificate la servirea fiecărui fișier.

### Fără Supabase configurat

Aplicația merge ca înainte, nu se blochează: poarta spune că nu sunt conturi pornite și
oferă un buton *Intră fără cont*, care duce direct la 8081 — pagina de alegere n-ar avea
ce lista. `/api/parse` rămâne deschis, iar panoul de cont nu apare în aplicație. Un proiect clonat curat trebuie să pornească, nu să ceară o bază de date.

### Fluxul

```
index.html (poarta)              serverul tău                     Supabase
  │  signInWithPassword()  ─────────────────────────────────────►  auth
  │  ◄──────────────────────────────────────────────────  JWT (sesiune)
  │  location.replace('/app.html')
  │
app.html (aplicația)
  │
  │  POST /api/panze                                              
  │  Authorization: Bearer <JWT>  ──►  getUser(jwt) ────────────►  auth
  │                                    ◄──────────  user.id confirmat
  │                                    insert unde user_id = ...  ►  tabelul panze
  │  ◄──────────────────────  { id, nume, created_at }
```

Browserul nu vorbește niciodată direct cu baza de date. Dacă ar face-o, „cine e
utilizatorul" ar fi o afirmație a paginii — iar pagina e a lui. Aici e o afirmație a
serverului, verificată pe un jeton semnat: exact motivul pentru care și cheia modelului
stă în `serve.js`, nu în `src/`.

### Cele două încuietori

Cheia de serviciu trece **peste** Row Level Security — ăsta e rostul ei. Deci regula din
baza de date nu apără serverul de el însuși: o interogare fără `.eq('user_id', …)` ar
citi rândurile tuturor, iar RLS n-ar spune nimic.

De aceea id-ul nu vine niciodată din corpul cererii, ci din `utilizator()`, adică dintr-un
jeton verificat. Cele două încuietori sunt diferite și amândouă trebuie să existe: **RLS**
oprește un client care ar vorbi direct cu baza, **filtrul din server** oprește serverul să
se autopăcălească.

### Rutele

| rută | ce face |
|---|---|
| `GET /api/config` | adresa proiectului și cheia publică, pentru browser |
| `GET /api/panze` | lista pânzelor contului (id, nume, dată — fără conținut) |
| `POST /api/panze` | salvează scena; **același nume rescrie**, un nume nou face o copie |
| `GET /api/panze/<id>` | conținutul unei pânze |
| `DELETE /api/panze/<id>` | șterge o pânză |

Toate, în afară de `/api/config`, cer `Authorization: Bearer <JWT>`.

### Ce se salvează

`Scene.toJSON()` — scena ca date pure. Seamănă cu `snapshot()` (cel de Undo), dar nu e
același lucru și nu se pot înlocui: instantaneul rămâne în memorie, deci poate purta
obiecte vii cu metodele lor, pe când forma salvată pleacă într-o coloană `jsonb` și se
întoarce peste zile, poate în altă sesiune.

Diferența se vede cel mai bine la pânză: `snapshot` o pune ca *proprietate* pe listă, iar
`JSON.stringify` al unei liste nu scrie decât elementele indexate — gabaritul s-ar pierde
tăcut, și o scenă salvată pe 400×300 s-ar întoarce pe 800×800, cu tot ce era în dreapta
ei în afara cadrului.

Id-urile de obiect și numerele de text **nu** se salvează: sunt serii locale sesiunii și
s-ar ciocni cu ce se desenează după încărcare. La citire primesc altele, păstrând ordinea
— singurul lucru care contează din ele, fiindcă numerotarea afișată e poziţională.

Citirea tratează datele ca venind din afară, fiindcă chiar de acolo vin: un rând corupt
dă o pânză mai săracă, nu o excepție. E aceeași purtare ca a cititorului de DSL — nu
respinge, repară.

O încărcare intră în istoric ca orice altă schimbare, deci **Undo** o desface.

---

## Ce se calculează local, gratis

- **Catalogul de figuri** (`src/models/ShapeBST.js`) — trei întrebări de atribut: câte
  contururi separate, lățimea în celule, înălțimea în celule. Numele se **deduce** din
  cod (lățime = înălțime → PĂTRAT, altfel DREPTUNGHI), nu se caută într-o listă de
  întreținut. Catalogul pornește gol și se completează singur, iar costul clasificării e
  constant, indiferent câte figuri există.
- **Așezătorul** (`src/text/Asezator.js`) — unde cade un text nou: caută cea mai goală
  parte a pânzei în care încape fără să atingă nimic. Un model întrebat asta ar primi în
  prompt toate dreptunghiurile de pe pânză, ar da alt răspuns la fiecare rulare și tot
  n-ar putea garanta că două texte nu se suprapun. Căutarea garantează.
- **Invariantul** — fiecare obiect își conservă propriul `Σ len`. Orice operație doar
  rearanjează aceeași „cerneală", inclusiv când schimbă numărul de laturi; singurele
  excepții explicite sunt `resize` și `stretch`, unde chiar asta s-a cerut.
- **Contorul de tokeni** (`src/interaction/TokenMeter.js`) — compară trei strategii
  pentru același rezultat: atribute (O(1) în numărul de figuri), catalog plat (O(n)) și
  vision cu coordonate. Estimatorul e calibrat pe tokenizatorul real al lui Gemini:
  2,8 caractere pe token pentru textul ăsta, nu cei 4 care se citesc peste tot — JSON-ul
  plin de `{`, `"`, `:` și cifre nu e proză.

---

## Harta fișierelor

```
index.html                  :8080  poarta — autentificarea, singura fără cont
panze.html                  :8082  alegerea pânzei, sau una nouă
app.html                    :8081  aplicația: trei coloane, pânza la mijloc
serve.js                    server static + proxy /api/parse, /api/status
porturi.js                  harta rolurilor și porturilor (citită și de sănătate)
sanatate.mjs                proba de sănătate a containerului (HEALTHCHECK)
test.mjs                    verificare headless, fără browser și fără rețea

server/                     TypeScript, compilat în dist/
  llm.ts                    singura ușă de intrare: askModel, buildUser
  memorie.ts                răspunsurile deja date (LRU pe cheie FNV-1a)
  supabase.ts               conturile și depozitul: getUser(jwt) + tabelul panze
  mastra/
    flux.ts                 Workflow: rutare → agenți în paralel → combinare
    router.ts               dispecerul pe cuvinte-cheie, zero tokeni
    agenti.ts               Geometru, Tipograf, Casetar
    modele.ts               providerii și lanțul de rezerve
    scheme.ts               schema Zod + cititorul care repară
    valori.ts               mărimile și uneltele comune
    prompturi/              comun, geometrie, text, caseta — pe ramuri

src/                        browser, ES modules servite direct
  core/App.js               orchestratorul; nu calculează nimic singur, leagă modulele
  models/                   Figure, Scene (+ toJSON/incarca), ShapeBST
  engines/                  LayoutEngine (geometria), Operations, AnimationEngine
  text/                     TextStream, TextBinder, Asezator
  interaction/              PromptParser (+ rezerva pe regex), InputManager,
                            TokenMeter, CommandManager
  cont/                     Cont (identitatea + predarea sesiunii între porturi),
                            Validare (regulile de email/nume/parolă, funcții pure),
                            Autentificare (poarta), PanouPanze (alegerea),
                            Panze (depozitul), PanouCont (salvarea, în aplicație)
  renderer/CanvasRenderer   singurul modul din proiect care atinge un pixel
```

Browserul nu are nicio dependență locală: clientul Supabase se aduce prin `import()` de
pe CDN, **lenevit** — abia după ce serverul confirmă că sunt conturi configurate. Cine
rulează proiectul fără Supabase nu plătește nicio cerere de rețea în plus.

---

## Teste

```bash
npm test
```

910 verificări în 24 de secțiuni, fără browser și **fără niciun apel la API**: canvasul e
un stub de măsurare, iar lanțul de modele se inspectează, nu se rulează.

Printre ele, un contract mai puțin obișnuit: **pragurile de tokeni pe ramură**. Promptul
de sistem e singurul loc din proiect unde se cheltuiesc tokeni și crește pe nesimțite —
fiecare regulă nouă pare ieftină luată singură. Testul fixează un plafon pe unsprezece
cereri tipice și verifică și ce agenți sunt chemați, așa că o schimbare care îngrașă
promptul pică imediat, în loc ca prețul să se vadă abia pe factură.

---

## Ce nu face

- Nicio altă formă în afară de pătrat și dreptunghi.
- Nicio persistență fără cont: scena trăiește în pagină, iar memoria răspunsurilor în
  procesul serverului. O repornire uită tot ce n-a fost salvat într-un cont.
- Nicio partajare: o pânză e a unui singur cont. Nu există link public și nici
  colaborare în timp real.
- `serve.js` rămâne un server de dezvoltare: servește directorul lui (cu verificare de
  cale, dar atât) și n-are limitare de rată pe rutele de cont.
- Fără termen scurt per candidat în lanțul de modele: Mastra alege modelul următor după
  **eroare**, nu după ceas, iar un `abortSignal` n-ar tăia un candidat, ci tot lanțul.
  Cine vrea plafonul înapoi îl pune deasupra, pe apelul agentului.
