# Restructurare de figuri și text prin comenzi în limbaj natural

Desenezi dreptunghiuri pe o pânză și le rearanjezi cu comenzi scrise: *„un pătrat de
50 cu colțul stânga jos în (25,25)", „împarte-l în 3", „scrie MIAU în fiecare",
„mărește dreptunghiul"*.

Modelul de limbaj traduce doar **intenția** într-o comandă structurată. Toată
geometria — poziții, dimensiuni, tăieri, așezarea textului — se calculează local,
determinist, fără să coste niciun token.

## Rulare

```bash
npm start     # http://localhost:8080
npm test      # verificare headless, 674 aserțiuni
```

Zero dependențe, zero build. `npm install` nu are ce instala. Serverul există dintr-un
singur motiv: modulele ES nu se încarcă de pe `file://`, iar cheia API n-are ce căuta
în JS-ul din browser.

### Conectarea la model

Aplicația merge și **fără** model — cade automat pe un parser de cuvinte-cheie.
Pentru comenzi libere, pune o cheie în `.env`:

```
GEMINI_API_KEY=cheia-ta
```

Cheia se ia de la [aistudio.google.com/apikey](https://aistudio.google.com/apikey) —
gratuit, fără card. Alternative acceptate: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, sau
Ollama local dacă nu e setată niciuna. Prima variabilă completată câștigă.

---

## Pânza și coordonatele

**800×800 pixeli** la pornire, cu originea `(0,0)` în **colțul din stânga jos**: x
crește spre dreapta, y în sus. Gabaritul se poate schimba din prompt — *„micșorează
pânza la 250 pe 100"* — între **50** și **800** pixeli pe latură; vezi
[pânza care se micșorează](#pânza-care-se-micșorează).

Coordonatele sunt **în pixeli**, nu indici de celulă. Grila desenată la fiecare 50px
e doar un reper vizual; cifrele de pe axe arată valori în pixeli (0, 50, 100 … 800),
iar orice valoare intermediară e validă — `(25,25)` sau `(137,412)` merg la fel de
bine.

```json
{"op":"rect","w":50,"h":50,"at":{"x":25,"y":25},"anchor":"bl"}
```

Un pătrat de 50×50 cu colțul din stânga jos în `(25,25)` are centrul exact în
`(50,50)`. Dimensiunile sunt tot în pixeli: `1x1` chiar înseamnă un pixel, nu o
celulă. Interfața avertizează când figura iese sub 8px, dar nu corectează cererea.

Singura conversie din tot codul e răsturnarea lui y (`pointPixel` / `toLogic` din
`src/models/Scene.js`). Nimic altundeva nu presupune sensul lui y.

## Domeniul

Singura formă pe care o poate construi motorul e **patrulaterul cu unghiuri drepte**:
pătrat sau dreptunghi. Patru segmente, toate unghiurile de 90°.

Restrângerea e deliberată. Fiecare formă în plus înseamnă reguli în plus în promptul
de sistem — deci tokeni la fiecare cerere și încă o șansă ca modelul să greșească. Cu
o singură formă, modelul nu mai are ce greși la geometrie; îi rămâne doar să citească
dimensiunile și poziția din cerere.

| Operație | Efect |
|---|---|
| `rect` | creează un dreptunghi (`w`, `h` obligatorii, în pixeli) |
| `move` | mută o figură existentă în alt punct, fără să-i schimbe forma |
| `split` | taie figura în 2–6 dreptunghiuri |
| `resize` | schimbă mărimea, cu `scale` sau cu `w`+`h` |
| `canvas_resize` | schimbă gabaritul **pânzei**, nu al figurilor |
| `clear` | golește scena |

### Plasarea

- `at` — punctul unde se așază figura
- `anchor` — **ce anume** din figură cade în acel punct. Implicit `center`;
  `bl` `br` `tl` `tr` pun un colț acolo, `top` `bottom` `left` `right` pun mijlocul
  unei laturi
- `cells` — o listă de puncte: creează câte o figură în fiecare

Mai multe figuri pot porni din **același punct** — implicit se suprapun, nu se șterg.
Fiecare își păstrează id-ul, textul și bugetul propriu. `"replace": true` cere explicit
înlocuirea.

### Mutarea

`move` schimbă doar locul, nu forma. Starea trimisă modelului raportează pentru
fiecare obiect **centrul** lui, în coordonate logice (vezi [vectorul de
centre](#vectorul-de-centre)) — de aceea „mută figura 1 în interiorul figurii 0"
funcționează: modelul citește centrul lui `#0` și îl folosește ca țintă pentru `#1`.

```json
{"g":{"o":"m","p":[400,400]},"n":[1]}
```

`move` acceptă și `anchor`, dacă vrei ca un colț anume să cadă în punct. Promptul
distinge explicit `move` de `rect`: `rect` **creează** o figură nouă, `move` o
**deplasează** pe cea existentă.

### Vectorul de centre

Poziția raportată nu e cea de la creare, ci **centrul de acum**. Fiecare obiect ține
minte două puncte, iar prima operație le desparte:

| | ce înseamnă | se schimbă |
|---|---|---|
| `at` | **punctul de așezare** cerut la creare — *„colțul stânga jos în (25,25)"* | doar la o mutare cerută pe față |
| `centru` | **unde se află obiectul acum** | la orice scalare, tăiere, mutare sau redimensionare a pânzei |

Scalarea le desparte cel mai vizibil. `resize` păstrează centroidul, deci pare că
centrul nu se mișcă — dar o figură crescută peste marginea pânzei e adusă înapoi în
cadru de [restrângere](#restrângerea-a-rămas-doar-plasă), iar acolo chiar se mută:

```
fa un patrat de 300 la 200,600   → #0 300×300, centrul @200,600
mareste figura 0 de doua ori     → #0 600×600, centrul @306,494
```

Centrul se **recalculează după fiecare operație de geometrie**, în același tur, nu la
următoarea citire. Contează pentru că un tur poate face amândouă: *„mărește figura 0 și
scrie MIAU în ea"* trebuie să scrie unde a ajuns figura, nu unde era înainte de
scalare. Se reîmprospătează și la granița dintre scenă și model, când se construiește
starea — ce pleacă spre model n-are voie să fie în urmă, altfel modelul țintește unde
figura **nu mai e**.

O figură își ia centrul din vârfurile conturului. Un [text fără
figură](#text-fără-figură) n-are contur din care să iasă un centroid: centrul lui e
mijlocul cuvintelor **așa cum se desenează**, citit din scena gata așezată, nu din
legări. Așa răspunsul e același indiferent dacă textul atârnă de un punct, de un colț
sau de o latură.

Vectorul intră și în instantaneul de undo, ca gabaritul pânzei: o scalare desfăcută
readuce și poziția, nu doar forma.

Pe el se sprijină [țintirea unei figuri dintr-o comandă de
text](#textul-aparține-unei-figuri).

### Cui i se aplică o comandă

Starea trimisă modelului conține **toată** scena, în **două serii de numere
independente**: figurile `#0`, `#1` … și textele `T0`, `T1` …, fiecare în ordinea în
care a fost creată. Ce e selectat se marchează cu `*`:

```
scena: 2 figuri, 2 texte, selectate marcate cu *
#0 PATRAT 300x300px @400,400
*#1 DREPTUNGHI 100x60px @700,120
T0 MIAU pe #1
T1 ALFA liber @400,400
cerere: muta figura 0 la 400,400
```

Tot, nu doar selecția — altfel modelul ar vedea o parte din scenă și „mută figura 0"
n-ar avea la ce se referi.

**De ce două serii.** Un text scris pe pânza goală e tot un obiect, dar fără contur.
Cu o numerotare unică, el consuma un număr, iar „figura 1" însemna a doua figură doar
dacă nu se scrisese niciun text între timp — exact genul de nepotrivire care se vede
abia când comanda cade pe altceva decât te așteptai. Acum figurile se numără între
figuri, textele între texte, și nu se influențează.

Un text scris **pe** o figură își primește și el numărul: `T0 MIAU pe #1` și `#1` sunt
același loc, sub două nume. `#1` înseamnă „figura, cu tot ce scrie pe ea"; `T0`
înseamnă „doar textul acela", chiar dacă figura mai găzduiește și altele.

Prioritatea:

1. **`target` din DSL** — un **număr** e o figură, `"t1"` e un text:
   `{"g":{"o":"m","p":[400,400]},"n":[0]}` mută figura 0,
   `{"t":{"b":"e","a":"bottom"},"n":["t1"]}` mișcă doar al doilea text.
   Așa merg formulările ordinale: „figura 0", „a doua", „textul 1", „al doilea text".
   Când modelul uită să țintească, ținta se deduce **local** din textul cererii,
   potrivind cuvinte („pătratul", „dreptunghiul") cu figurile de pe scenă.
2. **Selecția** (cele marcate cu `*`) — click selectează, **Shift-click** adaugă.
3. **Toate obiectele**, dacă nu e nimic selectat.

**Nimic nou nu se selectează** — nici o figură, nici un text. Selecția e o alegere a
omului, prin click, nu un efect secundar al desenării sau al scrierii: după *„fă un
pătrat"* sau *„scrie MIAU"*, pe pânză nu rămâne nimic selectat.

Are o consecință de știut: o comandă fără țintă cade atunci pe **toate** obiectele.
Fără nimic selectat, *„pune textul într-o casetă"* le ambalează pe toate — regula 3 de
mai sus.

**Un text nou face excepție**, din două motive care duc la aceeași concluzie.

**Nu se copiază.** Cu mai multe figuri pe pânză, *„scrie BETA"* nu pune același cuvânt
în fiecare: cererea a cerut **un** text, iar pe care dintre ele să cadă nu se ghicește.

**Nu se scrie peste un text care există deja.** Chiar și cu o singură figură pe pânză,
al doilea *„scrie …"* fără țintă nu se adaugă în același bloc, sub primul — asta ar
însemna exact „încă un rând peste textul de acolo", nu un text nou.

În amândouă cazurile textul devine obiect de sine stătător — `T0`, `T1` … — pus de
[așezător](#așezătorul) în cea mai goală parte a pânzei.

```
fa un dreptunghi de 300 pe 150 la 200,600   → #0
scrie BETA                                   → T0 pe #0, figura n-avea încă text
fa un patrat de 200 la 600,250              → #1
scrie GAMA                                   → T1 liber, nu GAMA pe #0 ȘI GAMA pe #1
```

```
fa un patrat de 200 la 400,400   → #0
scrie ALFA                        → T0 pe #0, figura e goală
scrie si BETA                     → T1 liber, nu al doilea rând sub ALFA
```

Ca să meargă pe o figură anume, ori o numești (*„scrie GAMA în pătrat"*), ori dai click
pe ea, ori ceri totul într-o singură cerere (*„fă un pătrat și scrie GAMA în el"*), care
trimite textul pe figura tocmai creată. Iar când chiar vrei câte unul peste tot, o spui:
*„scrie GAMA în fiecare"* — „fiecare", „toate", „pe amândouă" sunt exact cuvintele pe
care promptul agenților le leagă de *„nu ținti nimic"*, deci copierea rămâne o cerere
explicită, nu o scăpare.

Cazul din urmă nu mai trece prin selecție: `run()` reține obiectele de dinaintea
turului **ca referințe** și le scade la final, deci știe exact care s-au născut acum.
Cât timp figura nouă rămânea selectată, legătura mergea implicit prin selecție —
acum e numită pe față.

În practică se vede mai rar decât pare, fiindcă o comandă de text pe un obiect **fără
cuvinte nu face nimic**: pe o pânză cu un pătrat gol și un text liber, *„pune textul
într-o casetă"* atinge amândouă obiectele, dar numai textul are ce ambala. Regula
*„un prompt, un text"* nu depinde nici ea de selecție: cât timp pe pânză sunt doar
texte libere, fiecare *„scrie …"* face în continuare un obiect nou, cu numărul lui.

Ținta explicită bate selecția: dacă `#1` e selectat dar comanda zice `n:[0]`, se
aplică pe `#0` și `#1` rămâne neatins.

Cele două serii costă **~42 de tokeni** în baza comună de prompt, plătiți de fiecare
agent chemat. E prețul pentru ca „figura 1" să însemne același lucru de fiecare dată.

## Două casete de comandă

Interfața are **două** intrări în limbaj natural, nu una:

```
┌──────────────────────┬──────────────┬──────────────────────────┐
│ REDIMENSIONARE PÂNZĂ │              │ CREARE ȘI MODIFICARE ·   │
│                      │              │ FIGURI ȘI TEXT           │
│  [                 ] │    PÂNZA     │  [                     ] │
│   Aplică             │              │   Execută        Undo    │
├──────────────────────┤              ├──────────────────────────┤
│ Clasificare          │              │ DSL emis                 │
│ Figuri învățate      │              │ Cost pe conversație      │
│ Nod selectat         │              │ Cost per apel            │
└──────────────────────┴──────────────┴──────────────────────────┘
```

Titlul fiecărei casete spune la ce servește, iar casetele sunt **goale**: fără exemple
scrise în ele, ca să nu pară că numai forma aia de cerere e acceptată.

```
```

**Care casetă a fost folosită e un semnal de rutare pe care îl dă omul** — gratis, și
fără echivoc. Verbele „mărește", „micșorează", „mută" se potrivesc și pânzei, și
figurilor, și textului; routerul le trata ca ambigue și, în lipsa unui substantiv
lămuritor, chema **toți** agenții. Cu două casete, întrebarea nu se mai pune:

| cerere | într-o singură casetă | în caseta ei |
|---|---|---|
| `mărește` | 2759 tok, toți trei agenții | **554**, doar geometrul |
| `micșorează la 250 pe 100` | ambiguu | **554** |
| `250x100` | nerecunoscut | **554** |

Caseta pânzei costă **la fel de fiecare dată**, orice s-ar scrie în ea: ramura ei e
singura care pleacă vreodată de acolo. Caseta figurilor nu plătește niciodată
documentația pânzei.

### Izolarea nu se sprijină pe etichete

Faptul că panoul scrie „doar gabaritul" n-ar opri nimic singur. Ce oprește e codul,
în trei straturi:

1. **Înainte de apel** — cererea scrisă în caseta greșită nu pleacă deloc spre model:
   se spune local, gratis, unde îi e locul, iar textul rămâne scris ca să poată fi
   mutat. În **amândouă** sensurile:

   | scris în | cerere | fără refuz ieșea |
   |---|---|---|
   | caseta figurilor | *micșorează canvasul la 250 pe 100* | o micșorare a **figurilor**, cu `0.5` |
   | caseta pânzei | *fă un pătrat de 200* | o **pânză** de 200×200 |

   Tiparele sunt de **refuz**, nu de recunoaștere: ce nu numește nici pânza, nici
   figurile, nici textul trece mai departe în caseta în care a fost scris. *„250x100"*
   și *„mărește"* rămân cereri de gabarit în stânga, fără să fie nevoie de vreun
   substantiv.
2. **La rutare** — `Router.sectiuni(prompt, doar)` întoarce direct `['panza']` pentru
   caseta pânzei și scoate `panza` din listă pentru cealaltă. Serverul acceptă doar
   `"panza"` sau `"figuri"`, nimic altceva.
3. **La aplicare** — dacă modelul răspunde totuși cu altceva, `App.run` aruncă
   răspunsul și spune ce a ignorat. Aceeași regulă ca la agenți: geometrul nu are cod
   care să citească text, nu doar instrucțiunea să n-o facă.

Ramura pânzei îi cere și modelului să refuze — *„dacă cererea e despre figuri sau text,
răspunde `{"g":null}`"* — un rând care costă **21 de tokeni** din cei 554 ai ramurii.
E al patrulea strat, cel mai slab: o instrucțiune, nu o structură. Celelalte trei nu
depind de el.

Rezerva locală respectă aceeași împărțire: în caseta pânzei orice cifră e a
gabaritului și nu se recunoaște niciun text, deși parserul ar ști cum.

**Undo** rămâne unul singur, în dreapta, și desface ultima schimbare — oricare dintre
cele două.

## Pânza care se micșorează

Gabaritul zonei de desen e el însuși o operație, cerută din [caseta din
stânga](#două-casete-de-comandă): *„micșorează canvasul la 250 pe 100"*, *„400x300"*.
Fluxul e liniar, și fiecare pas stă exact acolo unde îi e locul — modelul dă intenția,
restul e matematică locală.

```
prompt ──► LLM ──► {"g":{"o":"p","w":250,"h":100}}      Geometru, ramura „pânză"
              │
              ├─► valideaza()          plafonează 50..800, aruncă ce e invalid
              │                        server/agents/geometry/Geometru.js
              ├─► scena.setPanza()     gabaritul nou + factorii kx, ky
              │                        src/models/Scene.js
              ├─► scaleazaToate()      scena urmează pânza, regula de trei pe axe
              │                        src/core/App.js · OPS.scaleXY
              ├─► restrangeToate()     plasă: aduce înăuntru ce era deja afară
              │                        src/core/App.js · LayoutEngine.restrange
              └─► render()             singurul modul care atinge un pixel
                                       src/renderer/CanvasRenderer.js
```

**Modelul nu calculează nicio poziție și nicio mărime.** Emite două cifre — lățimea și
înălțimea cerute — și atât. Ce se întâmplă cu figurile după aceea se socotește local,
determinist, fără niciun token.

### Scena urmează pânza: regula de trei simplă

O figură ocupă o **fracțiune** din pânză, iar fracțiunea aia se păstrează. Fiecare axă
o urmează pe a ei — `kx = W_nou / W_vechi`, `ky = H_nou / H_vechi`:

```
micsoreaza canvasul la 350 pe 200
fa un patrat de 50 la 100,100     → #0 PATRAT      50x50px  @100,100
                                     14,3% din lățime · 25,0% din înălțime

fa canvasul 700 pe 700            → kx = 700/350 = 2     ky = 700/200 = 3,5
                                  → #0 DREPTUNGHI 100x175px @200,350
                                     14,3% din lățime · 25,0% din înălțime
```

Aceleași procente, altă pânză. Și e **reversibil**: înapoi la 350×200 iese exact
`50x50px @100,100`.

**Un pătrat poate deveni dreptunghi** — și trebuie. `350×200` are raportul 1,75, iar
`700×700` are 1,0; „direct proporțional cu noile dimensiuni" înseamnă că lățimea urmează
lățimea și înălțimea urmează înălțimea, nu că forma se păstrează. Catalogul pe atribute
îl și renumește singur, fără nicio linie de cod în plus — exact ce ar trebui să facă.

Cine vrea forma păstrată are nevoie de un singur factor pentru ambele axe: media
geometrică `√(kx·ky)`, aceeași pe care o folosește deja litera.

### Ce se scalează, și de ce

| ce | cu cât | de ce |
|---|---|---|
| figura | vârfurile, cu `kx`, `ky` | nu lungimile: la o întindere pe o axă se schimbă unghiurile |
| punctele de text | `kx`, `ky` | textul liber și caseta atârnă de un punct de pânză |
| caseta | lățimea cu `kx`, înălțimea cu `ky` | e tot un dreptunghi |
| litera | `√(kx·ky)` | corpul are **o singură** mărime, deci nu poate urma două creșteri |
| `o.at` | `kx`, `ky` | punctul logic de așezare, ca poziția raportată să rămână adevărată |

Media geometrică pentru literă nu e o alegere nouă: e exact raportul folosit la
[redimensionarea casetei](#caseta-de-text), din același motiv.

Un punct cerut **în afara** pânzei de acum se refuză, cu notă. Validatorul de pe server
ține coordonatele în `0..800` — el nu știe cât e pânza în clipa asta — așa că pe una
micșorată chiar poate ajunge la motor un `(400,400)` care nu mai există. Fără refuz,
cererea cădea mai jos și *„fă un pătrat la 400,400"* ajungea să **rescrie** figurile
selectate în loc să creeze una nouă.

### Restrângerea a rămas doar plasă

`restrange` întoarce cu cât trebuie mutat un gabarit ca să intre întreg în pânză. După
o scalare proporțională n-are, în principiu, ce să găsească: ce încăpea încape în
continuare. Rămâne pentru ce era **deja** afară înainte de redimensionare.

E **numai translație** — nicio lungime nu se atinge — și se cere fără respiroul obișnuit
de 6px: o figură care atingea marginea o atinge și după, corect, iar un respiro adăugat
atunci ar strica exact proporția tocmai calculată. Pe o pânză de 100px înălțime, 6px
înseamnă 6%.

Ce e **mai mare** decât pânza nu se mută deloc: acolo n-ar exista poziție bună, iar
politica `scale-shape` din `LayoutEngine` o micșorează oricum la desenare, fără să-i
strice datele. Cele două politici nu se calcă: una mută ce încape, alta scalează ce nu.

### Textul vine gratis

Textul e parametrizat pe **lungime de arc**, nu pe coordonate fixe: un cuvânt știe
unde stă pe traseu, nu în ce pixel. Când figura se mută, așezarea se recalculează din
poziția pe traseu, iar reflow-ul apare ca o consecință, nu ca o operație separată.
Nicio linie de cod din pasul de restrângere nu atinge vreun cuvânt.

Un text **liber** — cel fără figură — n-are contur din care să-și ia gabaritul, așa că
i se măsoară chiar dreptunghiurile cuvintelor. Se mută la fel: aceeași translație.

### Pânza și-a primit ramura ei

Documentația operației a stat întâi în ramura `modifică`, ca patru rânduri. Măsurat cu
estimatorul din `test.mjs` (~4 caractere/token), urca ramura de la **667** la **719**
de tokeni — plătiți la *fiecare* mutare, tăiere sau redimensionare de figură:

| cerere | dacă ar sta în `modifică` | cu ramură proprie |
|---|---|---|
| micșorează pânza la 250 pe 100 | 719 | **531** |
| împarte figura 0 în 3 | 719 | **635** |
| mută figura 1 la 400,400 | 719 | **635** |

Aceeași socoteală care i-a dat [casetarului](#de-ce-caseta-și-a-primit-agentul-ei)
agentul lui. Aici a fost destulă o **ramură**, nu un agent nou: câmpul `g` e tot al
geometrului, deci nu se calcă nimeni la combinare.

Cuvintele care aprind ramura: **„pânză"**, **„canvas"**, **„scenă"**, **„zona de
desen"**. „canvas" e cel pe care îl scrie lumea în practică — fără el, cererea nimerea
ruta de *creare*, modelul nici nu primea operația, iar rezerva locală o citea ca pe o
micșorare a **figurilor**.

Cuvântul **„scena"** lipsește dinadins din tiparul strict: în aplicație înseamnă și
mulțimea obiectelor, iar *„golește scena"* e o cerere de `clear`, nu una despre
gabarit. Ea aprinde amândouă ramurile și plătește pentru asta; *„pânza"* și *„zona de
desen"* sunt fără echivoc.

### Ce știe modelul despre gabarit

Promptul de sistem spune „pânză de 800x800" — o constantă, deci nu se poate schimba de
la o cerere la alta fără să coste la fiecare. Când pânza **nu** mai e 800×800, gabaritul
de acum pleacă în **stare**, o linie de vreo 10 tokeni:

```
scena: 2 figuri, 1 texte
panza: 250x100px, originea (0,0) in stanga jos
#0 DREPTUNGHI 100x60px @60,40
...
```

Plătită doar când chiar s-a schimbat ceva. Pe o pânză normală, linia lipsește și costul
rămâne exact cât era.

### Undo

Instantaneul de undo duce cu el și gabaritul, ca proprietate a listei de obiecte.
Altfel figurile s-ar fi întors la pozițiile lor de dinainte, dar într-o pânză rămasă
mică — adică exact în afara ei. Duce, pentru fiecare obiect, și
[centrul](#vectorul-de-centre): o scalare desfăcută readuce poziția, nu doar forma.

Restrângerea, în schimb, **nu se desface singură** la loc: o figură adusă în cadru a
fost chiar mutată. Mărind pânza înapoi la 800×800 nu o trimite de unde a venit — pentru
asta e `Undo`.

## Invariantul

`Σ len` — suma lungimilor tuturor segmentelor — se conservă la orice operație.
Tăind un dreptunghi în trei apar muchii noi, deci perimetrul ar crește; motorul taie
natural și apoi rescalează uniform rezultatul, astfel încât suma să rămână neatinsă.

Trei excepții, toate explicite: `resize`, `stretch` și **schimbarea gabaritului
pânzei**. Acolo schimbarea mărimii chiar asta a fost cerut — la ultima, pentru toată
scena deodată — iar de la acel punct noul total devine cel conservat.

Invariantul e **per obiect**: fiecare figură are bugetul ei, ca o modificare pe una să
nu miște alta.

## Catalogul pe atribute

Figura nu e căutată într-o listă, ci **codificată** prin trei atribute independente:

```
[câte contururi | lățime în celule | înălțime în celule]

1|3|3   → PATRAT 150×150
1|6|3   → DREPTUNGHI 300×150
1|3|6   → DREPTUNGHI 150×300      orientarea contează
2|6|3   → GRUP_2                  după split
```

Numele se **deduce** din cod — lățime egală cu înălțimea dă `PATRAT`, altfel
`DREPTUNGHI`. Nu există tabel de forme de întreținut, iar o figură nouă își primește
numele fără cod nou și fără apel la model.

Atributele care ar fi constante nu apar: „contur închis", „4 laturi", „unghiuri de
90°" sunt adevărate mereu, iar o întrebare al cărei răspuns nu variază nu separă nimic
și nu merită niciun token.

Gabaritul se rotunjește la multipli de 50px pentru clasificare — altfel fiecare pixel
de diferență ar fi produs o intrare nouă în catalog. **2.048** combinații adresabile,
cu adâncime fixă de 3 comparații.

**Codul nu pleacă spre model.** E cheia catalogului, folosită local.

## Textul

Legarea e **per cuvânt**: fiecare cuvânt are propriul mod, deci se pot muta doar
câteva, restul rămânând pe loc.

| Mod | Efect |
|---|---|
| `inside` | un bloc în mijlocul figurii |
| `box` | o **casetă**: cuvintele curg pe rânduri într-un dreptunghi de lățime dată |
| `pieces` | câte un cuvânt în interiorul **fiecărei piese** |
| `point` + `at` | într-un **punct de pe pânză**, independent de figuri |
| `side` + `at` | pe o **latură anume**: `top` / `bottom` / `left` / `right` |
| `side` + `in` | aceeași latură, dar pe **partea dinăuntru** a figurii |
| `sides` | câte un cuvânt pe **fiecare latură**, rotit odată cu ea |
| `path` | curge de-a lungul conturului |
| `corners` | câte unul în fiecare din cele 4 colțuri ale pânzei |
| `corner` + `at` | tot textul într-un singur colț (`tl`/`tr`/`br`/`bl`) |
| `none` | ascuns, dar păstrat |

```json
{"set":["MIAU"],"bind":"pieces","repeat":true}           câte unul pe fiecare piesă
{"set":["SALUT"],"bind":"point","at":{"x":137,"y":412}}  într-un punct anume
{"bind":"box","box":{"w":300,"h":80}}                    într-o casetă de 300×80
{"boxDelta":40}                                          caseta, cu 40px mai mare
{"scale":1.4}                                            mărește fontul (0.4..3)
{"bind":"corner","at":"bl","words":[0,1]}                doar cuvintele 0 și 1
{"set":[]}                                               șterge textul definitiv
```

Implicit textul cade **în afara** laturii, lipit de ea. Cu `in: true` cade
**înăuntru**, ceea ce distinge două formulări apropiate:

```
„pe latura de sus", „deasupra figurii"      → at:"top"              (afară)
„sub latura superioară"                     → at:"top",  in:true    (înăuntru)
„sub figură"                                → at:"bottom"           (afară)
„deasupra laturii de jos"                   → at:"bottom", in:true  (înăuntru)
```

Regula pe care o știe modelul: dacă cererea zice *sub* o latură de sus, sau
*deasupra* uneia de jos, vrea interiorul figurii.

Cererea o poate spune și **pe față**, și atunci ea decide, indiferent de prepoziții:

```
„în interiorul laturii de sus", „înăuntrul laturii inferioare"   → in:true
„în exteriorul laturii din dreapta", „în afara laturii de jos"   → fără in
```

Substantivul se potrivește ca `latur\w*`, deci și genitivul: *„laturii de jos"*, nu
doar *„latura de jos"*. Cu forma fixă, *„deasupra laturii de jos"* nu potrivea nicio
latură și cădea pe alternativa `deasupra`, care înseamnă latura de **sus** — exact
opusul cererii.

Latura din `side` se alege **geometric** — „latura de sus" e cea mai de sus de pe
ecran, indiferent de la ce vârf începe conturul. Textul se așază lângă ea, împins
în afară față de centrul figurii, deci nu intră peste desen și nu ajunge în partea
opusă. Aceeași normală orientată spre exterior se folosește și la `sides`.

### Caseta de text

Toate celelalte legări urmează geometria figurii — o latură, un colț, conturul.
Caseta nu: textul își are **propriul dreptunghi**, iar lățimea lui e cea care rupe
rândurile, ca într-un paragraf.

```
pune textul într-o casetă                → cât cere textul, strânsă pe el
scrie SALUT LUME într-o casetă de 300 pe 80
mărește caseta cu 40 de pixeli           → 300 → 340
micșorează caseta cu 25 de pixeli        → 340 → 315
```

**Caseta se strânge în jurul textului, nu îl mută.** E un ambalaj: o cerere de casetă
pe un text care există deja nu e o cerere de mutare. Ancora se ia în ordinea asta:

1. punctul cerut în prompt — *„pune textul într-o casetă în punctul 150,650"*;
2. caseta care există deja pe obiect, ca o a doua cerere să nu o miște pe prima;
3. **locul în care se desena textul până acum**, citit din scenă înainte ca legarea
   nouă să apuce să-l schimbe;
4. mijlocul figurii, când textul chiar aparține uneia.

Pasul 3 lipsea. Un text fără figură și fără casetă n-avea nicio ancoră, iar `layout`
îl cădea în centrul **pânzei** — caseta apărea în mijloc și trăgea textul după ea:

```
scrie ALFA      → ALFA@400,400
scrie MIAU      → MIAU@229,221        așezătorul îi dă locul lui
textbox miau    → înainte:  MIAU@290,601 + casetă@290,601   ← teleportat
                  acum:     MIAU@229,221 + casetă@229,221   ← ambalat pe loc
```

**Fără cifre, caseta e cât textul.** Zero pe o axă înseamnă „exact cât cere textul",
și regula e aceeași pe amândouă:

| axă | `0` înseamnă |
|---|---|
| înălțime | exact cât cer rândurile — o casetă mai lată iese și mai scundă |
| lățime | exact cât cer cuvintele, plus spațiile dintre ele: un singur rând |

Lățimea era singura cu o cifră fixă în cod — **200px** — și asta se vedea: pentru
*„textbox miau"* ieșea un ambalaj de cinci ori mai lat decât cuvântul dinăuntru.

```
textbox miau                → înainte:  casetă 200×23 în jurul unui MIAU de 37px
                              acum:     casetă  37×23
pune textul într-o casetă   → SALUT LUME BUNA pe un rând: casetă 132×23
```

Plafonul pânzei rămâne singurul care mai poate rupe rândurile. Când o face, caseta
se strânge pe **cel mai lat rând** care a ieșit, nu pe lățimea la care s-a rupt:
douăsprezece cuvinte lungi dau două rânduri și o casetă de 786px, nu una de 800.

O lățime cerută pe față rămâne exactă — „auto" e doar implicitul. Iar o creștere
relativă pornește de la cât **măsoară** caseta acum, nu de la zero: pe una strânsă
pe text, *„mărește caseta cu 40"* dă 37 + 40 = 77, nu 40.

O înălțime dată explicit e un **minim** — textul nu se taie niciodată, caseta se întinde.

Mărimea se cere în două feluri, și nu se amestecă:

| Câmp | Formă scurtă | Ce face |
|---|---|---|
| `bind: "box"` | `b: "x"` | textul intră în casetă |
| `box: {w,h}` | `z: [300,80]` | lățimea și înălțimea **exacte**, în pixeli; fără el, cât textul |
| `boxDelta: n` | `f: 40` | **schimbă** ambele axe cu atâția pixeli; negativ le micșorează |
| `boxDelta: {w,h}` | `f: [50,200]` | schimbă **fiecare axă** separat: `+50` lățime, `+200` înălțime |

Cele trei sunt singurul lucru pe care îl citește [casetarul](#cei-trei-agenți) —
agentul lui, separat de tipograf.

Diferența e cea care contează pentru model: `f` nu-i cere să știe cât e caseta
acum. Promptul nu are istoric — modelul vede scena, nu lățimea unei casete —
așa că *„mărește caseta cu 40"* se traduce în `{"f":40}` și **motorul** face
adunarea, local. La fel ca `repeat`, care lasă motorul să numere laturile.

Marginile sunt locale și tăcute: sub 20px n-ar mai încăpea niciun cuvânt, peste
800px n-ar mai încăpea pe pânză. O cerere în afara lor se plafonează, nu se refuză.

**Textul crește odată cu caseta.** O casetă de două ori mai lată cu același corp de
literă arată a greșeală, nu a mărire, așa că `f` scalează și fontul — în raportul
lățimilor:

```
pune textul într-o casetă                          → 200×23   font 17px
mărește textboxul cu 50x200                        → 250×223  font 59px
mărește caseta cu 0 pe lățime și 100 pe înălțime   → 250×323  font 71px
mărește caseta cu 200 pe lățime și 0 pe înălțime   → 450×323  font 95px
```

Cu **două cifre**, fiecare axă crește cu cât s-a cerut. Diferența dintre un număr și o pereche contează pentru **înălțime**. Un singur număr
lasă înălțimea pe „auto" — ea crește oricum, odată cu litera. O pereche cere înălțimea
explicit, deci ea devine explicită, pornind de la cât măsoară caseta **acum**. Fără
perechea asta, „mărește cu 50x200" pierdea a doua cifră și caseta creștea doar pe
orizontală.

Litera are o **singură** mărime, deci nu poate urma două creșteri diferite. Raportul e
media geometrică a celor două axe — `√(kw · kh)` — singura care le ține pe amândouă în
seamă: aria textului crește cât aria casetei.

```
caseta            raportul textului
×2 pe ambele axe       ×2       la creștere uniformă iese exact acel raport
×1.5 lățime, ×2 înălțime ×1.73  între ele
×1 lățime, ×5.3 înălțime ×2.31  întinsă doar pe verticală, textul tot crește
```

Ultimul rând e cel care lipsea: cu raportul luat doar pe lățime, o casetă întinsă pe
verticală lăsa textul mic într-o cutie goală.

Creșterea se oprește la trei limite, toate legate de casetă: cel mai lat cuvânt
trebuie să încapă pe un rând, un rând trebuie să încapă pe înălțime, iar litera nu
trece de 160px. Când plafonul oprește caseta, raporturile ies mai mici decât cele
cerute: textul crește exact cât a crescut caseta, nu cât s-a cerut.

Din același motiv, un `scale` cerut în aceeași comandă se **ignoră** când caseta
chiar crește: altfel cele două s-ar înmulți și litera s-ar umfla de două ori.

**Caseta nu iese din pânză**, și n-o face prin scalare: micșorată, textul ar deveni
ilizibil. Se **împinge înăuntru**, nu se taie, iar cuvintele merg cu ea. Una cât toată
pânza, sau mai mare, se centrează — n-are unde să se ducă. Figura ajunge și ea în cadru,
dar pe alt drum: vezi [verificarea de cadru](#nimic-nu-iese-din-imagine).

Fără regula asta, o casetă pe o figură lipită de marginea pânzei ieșea pe jumătate
afară și se tăia la desenare, fără ca nimic să spună de ce.

### Tranziția pânzei

Gabaritul pânzei e **un canal de animație**, ca poziția unei muchii sau mărimea unui
cuvânt. Nu sare la valoarea nouă: elementul de desen se strânge sau crește pe același
ceas și aceeași curbă (`easeInOutCubic`, 900 ms) ca figurile de pe el.

```
  t      pânză        figură       raport   font
  0,00   800x800    200x200     0,250    17,0
  0,30   746x735    187x184     0,250    15,7
  0,50   550x500    138x125     0,250    11,1
  0,70   354x265     89x 66     0,250     6,5
  1,00   300x200     75x 50     0,250     5,2
```

Coloana **raport** e proprietatea care face tranziția să pară un singur obiect care se
strânge, nu două lucruri care se mișcă alături. Ea iese din matematică, nu din reglaj:

```
poziția   pos(t) = pos_vechi · (1 + (k−1)·t)
pânza       W(t) =   W_vechi · (1 + (k−1)·t)
```

Același factor, deci raportul figură/pânză e neschimbat în **toate** cadrele, nu doar
la capete. Iar `flatten` / `rebuild` din `AnimationEngine` n-au avut nevoie decât de
încă două canale — `panza.w` și `panza.h` — fiindcă mecanismul era deja acolo.

Redimensionarea elementului se face doar când valoarea chiar s-a schimbat: `canvas.width`
șterge conținutul chiar și când i se scrie aceeași valoare.

### Nimic nu iese din imagine

Verificarea rulează după **orice** operație de geometrie — creare, mutare, tăiere,
mărire — nu doar la redimensionarea pânzei. Are două trepte, fiindcă sunt două cauze
diferite:

**Figura încape, dar e așezată prost.** *„Fă un pătrat de 200 la 750,750"* pe o pânză
de 800 cere un centru valid, dar jumătate din figură cade peste margine. `restrange`
întoarce cu cât trebuie mutată, iar `restrangeToate` aplică translația — **în date**,
deci și pozițiile raportate modelului devin adevărate:

```
fa un patrat de 200 la 750,750   → cerut  x 650..850     ⚠ 50px afară
                                 → așezat x 594..794     ✓ în cadru
```

**Figura nu încape deloc.** Aici translația n-are ce rezolva. Datele rămân neatinse —
`Σ len` e cât a cerut mărirea, nu se falsifică — iar `scale-shape` o desenează întreagă,
micșorată. Atât făcea și înainte; ce lipsea era **locul**:

```
patrat 900x900, centrul în (20,20), pânză 800x800
înainte   k = 0.876   desenat x -327..461     ⚠ o treime în afara imaginii
acum      k = 0.876   desenat x    6..794     ✓ integral în imagine
```

Scalarea se face față de centrul **pânzei**, iar o figură al cărei centru e departe de
al pânzei rămâne pe dinafară chiar după ce a fost micșorată. Acum, după scalare,
rezultatul se și **așază** în cadru — la acel punct chiar există unde. Ambele sunt doar
la desenare: datele figurii rămân intacte.

Restrângerea pentru pânză se cere fără respiroul obișnuit de 6px, ca să nu strice
proporția tocmai calculată; cea de după operațiile pe figuri îl păstrează, fiindcă
acolo e chiar ce vrei — figura să nu stea lipită de margine.

### Câte casete pot fi pe pânză

Caseta **nu e un obiect** și nu are număr propriu. Numerotate sunt figurile — `#0`,
`#1` — și textele — `T0`, `T1`. Caseta e doar felul în care stau cuvintele **unui**
text. Deci:

```
fa un dreptunghi de 300 pe 150 la 200,600   → #0
scrie ALFA într-o casetă                     → caseta lui #0
fa un pătrat de 200 la 600,250              → #1
scrie BETA într-o casetă                     → caseta lui #1
mărește caseta cu 60 de pixeli               → doar #1, e singurul selectat
```

Se țintesc ca orice altceva: `n:[0]` din DSL, altfel selecția, altfel toate
obiectele. Fără nimic selectat, *„mărește caseta"* le mărește pe toate — aceeași
regulă ca la figuri.

Un al doilea *„scrie BETA într-o casetă"* pe **același** obiect nu face o casetă
nouă: BETA intră lângă ALFA, în caseta care există deja. Cuvintele se grupează după
legarea lor, iar caseta moștenită are aceeași lățime și aceeași ancoră, deci același
grup. Ca să ai două casete separate, textele trebuie să stea pe obiecte diferite.

Redimensionarea **nu re-leagă** textul. Dacă `„mărește caseta cu 40"` ar emite și
`bind:"box"`, lățimea de acum s-ar pierde și caseta ar sări înapoi la 200 înainte de
adunare — de aceea o cerere relativă emite numai `f`, iar rezerva locală taie
explicit legarea când găsește o diferență.

Când niciun cuvânt nu stă într-o casetă, comanda nu inventează una: spune
*„nu există casetă de redimensionat"*. Aceeași regulă ca la textul fără figură —
mai bine un refuz limpede decât ceva ce pare că s-a întâmplat.

### Textul aparține unei figuri

Fiecare figură are propriul flux de text. Ca să muți textul **de pe o figură pe
alta**, nu e destul să schimbi legarea — trebuie transferat:

```json
{"t":{"v":0,"b":"e","a":"bottom"},"n":[1]}
```

`n` spune de pe ce figură se ia, `v` pe care ajunge, iar `b`/`a` cum se așază pe
figura nouă. Fără `v`, textul rămâne pe figura lui și se poziționează față de ea —
ceea ce, la o cerere de tipul „mută textul de pe figura 1 sub figura 0", ar fi
figura greșită.

**Când modelul uită `v`.** Legările care se raportează la un contur — `inside`,
`side`, `pieces`, `sides`, `path` — n-au niciun reper când cuvintele stau pe **alt**
obiect: pe un text de sine stătător, sau pe altă figură. Un model care răspunde la
*„mută textul în mijlocul figurii 0"* doar cu `{"t":{"b":"i"}}` cerea, practic,
imposibilul: [rescrierea pentru text fără figură](#text-fără-figură) transforma
`inside` în `point` ancorat **unde era deja textul**, adică exact de unde s-a cerut să
plece. Comanda nu făcea nimic și nici nu spunea de ce. Nici `n:[0]` nu ajuta: ținta
arăta spre figură, dar cuvintele erau pe alt obiect, deci comanda cădea pe o figură
care n-avea text.

Figura cerută se deduce acum local, gratis, în ordinea:

1. **ținta dată de model** — `n:[0]`. Un `"t1"` e un text, nu o figură, deci nu se ia
   în seamă aici.
2. **numărul spus pe față în cerere** — *„figurii 0"*, *„dreptunghiul 1"*. Potrivirea e
   deterministă, deci se face local, ca [țintirea](#cui-i-se-aplică-o-comandă).

Ce devine figura găsită depinde de ce aduce cererea:

| cererea | figura numită e |
|---|---|
| aduce cuvinte noi (`s` sau `d`) | **ținta** pe care se scrie |
| doar reașază text care există deja | **destinația** transferului, ca `v` |

La transfer, ținta se golește după ce a fost citită: altfel sursele ar fi chiar figura
destinație — sărită fiindcă e egală cu ea însăși — și nu s-ar transfera nimic.

Deducerea se aprinde **doar** pentru legările care cer un contur. *„Mărește textul"*
n-are legare, deci nu numește nicio figură și nu e atinsă: rămâne unde e.

Unde ajunge textul se citește din [vectorul de centre](#vectorul-de-centre), deci
„mijlocul figurii 0" înseamnă centrul ei de **acum**:

```
fa un patrat de 300 la 200,600             → #0
fa un dreptunghi de 200 pe 100 la 600,200  → #1
scrie MIAU                                  → T0 liber: două figuri, nicio țintă
mareste figura 0 de doua ori                → #0 600×600, centrul se mută la @306,494
muta textul in mijlocul figurii 0           → T0 pe #0, @306,494 — nu @200,600
```

**Mutarea se vede, nu clipește.** Animația interpolează pe *cheia* cuvântului. Cât timp
cheia era id-ul obiectului plus indicele, un text mutat pe altă figură primea cheie
nouă: cel vechi se stingea pe figura de plecare, unul nou creștea pe cea de sosire —
două cuvinte pe ecran, nu unul care se mută.

Cheia e acum **textul din care face parte cuvântul, plus rangul lui în el** — `T1`,
cuvântul 0. Amândouă călătoresc cu textul, deci cheia supraviețuiește mutării și
`AnimationEngine` are ce interpola:

```
înainte   BETA@600,550 px17          ghost: BETA@600,550 px17 → px0
                                     nou:   BETA@200,296 px0  → px17
acum      BETA@593,545 → @541,512 → @400,423 → @259,333 → @200,296   px17 tot drumul
```

Rangul e poziția în interiorul textului, nu în obiect: pe figura nouă cuvintele se
așază după cele care erau deja acolo, deci indicele de obiect s-ar fi schimbat oricum.

### Text fără figură

Textul aparține unei figuri — asta e regula. Dar pe o pânză pe care nu s-a desenat
încă nimic nu există nicio figură de care să se agațe, iar comanda *„scrie MIAU"* nu
avea de ce să se aplice: nu se întâmpla nimic și nici nu se spunea de ce.

Acum textul devine el însuși obiect: figură goală, legare la punct absolut.

```
scrie MIAU                      → obiect nou în centrul pânzei (400,400)
scrie ALFA in punctul 150,650   → obiect nou exact acolo
mareste textul                  → nu creează nimic; „nu există text pe care să-l schimb"
```

Legarea se rescrie la `point`, singura care nu are nevoie de un contur: toate
celelalte moduri se raportează la laturi care, aici, nu există. Dacă mai târziu apare
o figură, textul rămâne unde e — sunt obiecte diferite.

Rescrierea nu se face doar la creare, ci la **fiecare** comandă. Al doilea text
primea `inside` — o legare de figură — iar `bbox()`-ul unui obiect gol e `(0,0)`,
adică exact colțul din stânga sus al pânzei. Acolo ajungea, pe jumătate în afară.

**Un prompt, un text.** Fiecare text scris primește numărul lui, `T0`, `T1` …, în
ordinea în care a fost scris:

```
scrie MIAU                 → T0 [MIAU]             obiect liber
pune textul într-o casetă  → caseta lui T0
scrie HAM                  → T1 [HAM]              text nou, nu al doilea cuvânt
pune textul într-o casetă  → caseta lui T1         separată de a lui T0
scrie SALUT LUME BUNA      → T2 [SALUT LUME BUNA]  propoziția întreagă, un text
```

Înainte, toate cuvintele scrise pe rând se adunau pe același obiect — `textLiber`
crea unul nou doar pe pânză goală. Iar „pune textul într-o casetă" privește **tot**
obiectul, deci le băga pe toate într-o singură casetă.

Pe o figură e la fel: fiecare *„scrie …"* face un text cu numărul lui. Al doilea nu
mai cade automat pe aceeași figură — ar ajunge sub primul, adică peste el — decât dacă
o numești sau dai click pe ea:

```
fa un pătrat               → #0
scrie ALFA                 → T0, pe #0        figura n-avea text
scrie și BETA              → T1, liber        nu al doilea rând sub ALFA
scrie și BETA în pătrat    → T1, pe #0        țintă numită: acolo cade
mărește textul 1           → doar BETA, ALFA rămâne cum era
```

Numărul afișat e **poziția** în ordinea generării, nu un identificator care crește la
nesfârșit: după ce ștergi un text, numerotarea se strânge la loc, exact ca la figuri,
unde `#k` e al k-lea din vector.

Un text își păstrează numărul când e mutat pe altă figură: `T1` rămâne `T1`, doar
locul se schimbă.

### Așezătorul

Unde cade un text nou nu e o valoare implicită, ci un calcul. `Asezator` are un
singur skill: dat un dreptunghi de așezat și dreptunghiurile deja ocupate, întoarce
punctul din **cea mai goală parte a pânzei** în care noul text încape fără să atingă
nimic.

```
scrie UNU     → UNU@400,400              pânza e goală: fix în mijloc
scrie DOI     → DOI@574,571              celălalt capăt al diagonalei
scrie TREI    → TREI@229,221
scrie PATRU   → PATRU@233,581
scrie CINCI   → CINCI@573,221
```

Pe o pânză goală textul cade în mijloc: primul n-are de la ce să fugă. De la al doilea
încolo întrebarea nu mai e „unde încape cel mai aproape", ci **„unde e cel mai gol"**
— se caută pe o grilă de 10px și se păstrează candidatul liber cu cel mai mare
*respiro*, adică distanța până la cel mai apropiat vecin.

**Marginea pânzei e și ea un vecin.** Fără pereții ăștia în socoteală, „cel mai gol
loc" era mereu un colț — acolo ești cel mai departe de ce e desenat — și textul ieșea
lipit de ramă, la 2px de ea. Cu ei, cel mai gol loc chiar e cel mai gol: la fel de
departe de textul dinainte pe cât e de margine.

Varianta dinainte păstra candidatul liber cel mai **apropiat** de centru, iar
`MARGINE` (10px) era tot ce despărțea două texte:

```
înainte   ALFA@400,400   BETA@399,431   GAMA@399,361      14px de gol între ele
acum      ALFA@400,400   BETA@270,190                     247px, respiro minim 90px
```

La un corp de 17px, 14px de gol arată ca rândurile unui paragraf — un teanc în jurul
centrului, nu texte așezate în locuri diferite.

Ordinea de parcurgere e fixă și comparația e strict „mai bun", deci la egalitate câștigă
primul candidat întâlnit: aceeași scenă dă mereu același loc.

Un punct cerut explicit în prompt — *„scrie ALFA în punctul 150,650"* — bate așezarea
automată: acolo ai spus, acolo cade.

**Așezătorul e chemat doar pentru cuvintele pe care le aduce cererea.** O comandă care
schimbă doar ambalajul sau legarea — *„pune textul într-o casetă"*, *„mărește textul"* —
nu cere o mutare, deci textul rămâne unde e. Până acum era chemat la orice schimbare de
legare, iar asta însemna că orice casetă cerută pe un text existent îl muta în cea mai
goală parte a pânzei. Cu regula nouă, un text NOU într-o casetă tot își primește locul
lui: acolo chiar sunt cuvinte care n-au avut niciodată unul.

**E un agent local, ca routerul: zero tokeni, zero așteptare.** Regula proiectului e
că geometria nu costă niciodată. Un model întrebat „unde să pun textul" ar trebui să
primească în prompt toate dreptunghiurile de pe pânză, ar da alt răspuns la fiecare
rulare, și tot n-ar putea garanta că două texte nu se suprapun. Căutarea de mai sus
garantează, iar testele o verifică pe șase texte așezate la rând — zero suprapuneri și
un respiro minim de 90px, cu mult peste cei 10px ceruți de marginea minimă.

### Mai multe texte pe pânză

`set` **înlocuiește** tot conținutul; `add` **adaugă** un text nou lângă cele
existente, iar legarea se aplică doar pe cuvintele nou adăugate — textele de dinainte
rămân unde erau.

```json
{"s":["ALFA"],"b":"i"}                 primul text, în mijloc
{"d":["BETA"],"b":"e","a":"top"}       al doilea, pe latura de sus
{"d":["GAMA"],"b":"e","a":"bottom"}    al treilea, jos
```

Modelul alege inconsecvent între cele două, așa că există și o plasă locală: dacă
obiectele vizate au deja text și cererea **nu** conține un verb de înlocuire, un `set`
primit de la model devine `add`. Mai bine două texte pe pânză decât unul șters fără
să fi fost cerut.

Lista verbelor (`cereInlocuire` din `PromptParser.js`) a început scurtă și a costat.
*„rescrie textul ca PISICA"* nu era pe ea, deci înlocuirea devenea adăugare: MIAU
rămânea pe pânză, cu PISICA peste el — exact opusul a ce ceruse cererea. Acum lista
acoperă „în loc de", „înlocuiește", „rescrie", „schimbă", „modifică", „corectează",
„actualizează", „redenumește", „transformă", „șterge", „elimină", „scoate".

Și înlocuirea păstrează **așezarea**: textul rescris rămâne în caseta lui, pe latura
lui, în punctul lui. `set` schimbă doar conținutul, nu și legarea — altfel *„rescrie
textul"* scotea cuvântul din casetă și îl trimitea în colțul `(0,0)`.

`set` se pune **doar** când cererea spune ce anume să scrie. Dacă zice doar „textul"
sau „scrisul", se schimbă numai modul de legare — conținutul existent rămâne.

`repeat` lasă **motorul** să numere țintele (laturi sau piese) — modelul nu trebuie să
știe câte sunt. `scale` schimbă doar corpul de literă; nu are voie să șteargă text.

Textul e parametrizat pe **lungime de arc**, nu pe coordonate. Când geometria se
schimbă, poziția în pixeli se recalculează din poziția pe traseu, deci reflow-ul e o
consecință gratuită, nu o operație separată.

## Cei trei agenți

O cerere nu merge la un singur model care știe tot. Trece întâi printr-un **router
local**, care decide ce specialiști sunt chemați, iar aceștia lucrează **în paralel**,
fiecare pe domeniul lui. Fiecare e o clasă, în fișierul lui:

```
                       cerere în limbaj natural
                                  │
                    ┌─────────────▼─────────────┐
                    │  Router                   │  regex, 0 tokeni, 0 ms
                    │  routing/                 │  nu cheamă niciun model
                    └──┬──────────┬──────────┬──┘
                       │          │          │
            ┌──────────▼──┐ ┌─────▼──────┐ ┌─▼───────────┐
            │  Geometru   │ │  Tipograf  │ │  Casetar    │ orchestration/
            │  geometry/  │ │  text/     │ │  textbox/   │  Promise.all
            │             │ │            │ │             │
            │ rect split  │ │ set add    │ │ caseta      │  apeluri
            │ resize move │ │ scale bind │ │ mărime      │  simultane
            │ clear       │ │ repeat     │ │ ±pixeli     │
            │ w h at      │ │ words to   │ │             │
            │ anchor      │ │            │ │             │
            └──────┬──────┘ └─────┬──────┘ └─────┬───────┘
                   │ „geom"       │ „text"       │ „caseta"
                   └──────────────┼──────────────┘
                                  ▼
                        DSL combinat → motor

                 fiecare cutie e un folder din server/agents/,
                 numit după taskul pe care îl face
```

Toți moștenesc `Agent`, care ține partea comună: baza de prompt, alegerea ramurilor,
citirea răspunsului, un tur de apel. `Echipa` îi rulează și le leagă răspunsurile;
`llm.js` rămâne o fațadă subțire, cu o singură ușă de intrare — `askModel`.

**Routerul** nu costă nimic: e clasificarea prin cuvinte-cheie care exista deja pentru
alegerea ramurilor. Aceleași tipare spun acum și ce agenți sunt necesari. Nu îi
cunoaște pe nume — se uită ce ramuri își declară fiecare.

**Geometrul** deține ramurile `creare`, `modifică` și `pânză`. Promptul lui nu conține
niciun rând despre text, iar `valideaza()` citește doar câmpul `g`.

**Tipograful** deține `text-nou` și `text-poz`. Nu știe nimic despre crearea sau
mutarea figurilor, iar `valideaza()` citește doar câmpul `t`.

**Casetarul** deține `caseta`. Nu știe ce scrie textul și nici unde altundeva ar putea
sta: doar dacă intră într-o casetă și cât de mare e ea.

### De ce caseta și-a primit agentul ei

Caseta a stat întâi în tipograf, ca încă patru rânduri de prompt. Măsurat, costa
**407 tokeni** — iar ramura `text-poz` se plătește la *fiecare* cerere de poziționare,
inclusiv „pune textul pe latura de sus", care n-are nicio treabă cu casetele:

```
cerere                            în tipograf   agent propriu
mărește caseta cu 40 de pixeli         1688        1135   -33%
pune textul într-o casetă              2161        2063    -5%
pune textul pe latura de sus           2161        1754   -19%   ← nici nu vorbește de casetă
scrie MIAU în figura                   2161        1754   -19%
```

Ultimele două rânduri sunt tot câștigul: cererile care **nu** cer o casetă nu mai
plătesc documentația ei. Prețul e la celălalt capăt — o cerere ambiguă cheamă acum
trei agenți în loc de doi, deci cazul cel mai rău urcă de la 3606 la **4334**. Tot
simultan, deci latența nu se schimbă.

Un agent nou e ieftin de adăugat tocmai fiindcă routerul nu-l cunoaște pe nume, dar
un câmp propriu **nu** era opțional: doi agenți care scriu amândoi în `text` s-ar
suprascrie la combinare, iar „primul câștigă" ar arunca în tăcere răspunsul celuilalt.
Casetarul umple `caseta`, iar `Echipa.combina` îl topește în `text` la final — ultimul,
ca legarea corectă să bată o eventuală ghiceală a tipografului.

### Când routerul nu e sigur, îi cheamă pe toți

Verbele „mărește", „micșorează", „mută" se potrivesc și figurilor, și textului. Dacă
apar **fără** un substantiv care să lămurească despre ce e vorba, routerul nu ghicește:

```
mareste dreptunghiul   → [geometrie]                   substantivul lămurește
mareste textul         → [text]                        substantivul lămurește
mareste caseta         → [caseta]                      substantivul lămurește
mareste                → [geometrie + text + caseta]   ambiguu, se cheamă toți
```

În cazul ambiguu fiecare agent răspunde pentru domeniul lui și rezultatele se combină.
Măsurat pe API-ul real:

```
> mareste
  agenti: [geometrie + text]  674ms
  geom: {"op":"resize","scale":1.5}
  text: {"scale":1.4}
```

Sub un singur model, aceeași cerere producea o singură interpretare — de obicei cea
greșită. Sub agenți separați, toate interpretările ajung pe pânză.

### Izolarea nu se bazează pe instrucțiuni

Un prompt care spune „nu emite câmpul `t`" e o rugăminte, nu o garanție. Izolarea
stă în cod: fiecare agent își validează singur câmpul, iar `Agent.citeste()` umple
numai câmpul lui.

```js
// Agent.js — clasa de bază
citeste(brut) {
  const d = Agent.extrageJSON(brut);
  const out = { geom: null, text: null, why: motiv(d) };
  out[this.camp] = this.valideaza(d);     // 'geom' la Geometru, 'text' la Tipograf
  tinta(d, out);
  if (!out[this.camp]) throw new RaspunsGol(this.nume);
  return out;
}
```

`Geometru` nu are nicio linie de cod care să citească text, `Tipograf` nu are niciuna
care să citească figuri, iar `Casetar` nu are niciuna care să citească conținut. Nu e
vorba de un câmp șters la sfârșit: dacă modelul i-ar răspunde geometrului cu un `"t"`,
pur și simplu nu se uită nimeni la el.

Tipograful și casetarul citesc amândoi câmpul `"t"` de pe fir — dar fiecare **altceva**
din el, și fiecare îl pune în câmpul lui. Casetarul vede doar `b:"x"`, `z` și `f`;
tipograful, tot restul. Un `s:["ALFA"]` trimis casetarului nu ajunge nicăieri.

Un agent care nu are ce răspunde aruncă `RaspunsGol` — „nu e treaba mea". Nu e o
eroare, nu declanșează reîncercarea, iar combinarea îl ignoră.

`validate(d, domeniu)` rămâne exportată pentru parserul local de rezervă, care nu are
agenți: fără `domeniu`, cheamă ambii validatori.

### Combinarea

Fiecare agent contribuie doar în domeniul lui; ținta și motivul se iau de la primul
care le dă. Dacă niciun agent nu produce nimic, cererea eșuează explicit, nu tăcut.

Câmpurile sunt distincte tocmai ca să nu se poată suprascrie — `geom`, `text`,
`caseta`. Ultimul e o excepție controlată: caseta chiar aparține comenzii de text, așa
că se topește în ea la sfârșitul combinării, după toți ceilalți. Ordinea contează —
dacă tipograful a ghicit `bind:"inside"` pentru o cerere care spunea „casetă", legarea
casetarului o suprascrie.

Un caz merită atenție: la *„fă un dreptunghi și scrie BETA în el"*, tipograful numește
ținta după numerotarea de **dinainte** de creare — figura nouă încă nu există când
răspunde el. `App` observă că geometria a creat un obiect și trimite textul pe figura
nou creată, nu pe cea care avea acel număr înainte.

### De unde vine timpul unui tur

Paralelizarea face turul să dureze cât **cel mai lent agent**, nu cât suma lor. Atât.
Nu face un agent mai rapid, și pe o cerere care privește un singur domeniu — *„scrie
ALFA pe latura de sus"* — nu are ce paraleliza: rulează doar tipograful.

Măsurat, cu *„mărește"*, cererea ambiguă care cheamă amândoi agenții:

```
tur 827ms | cel mai lent agent 826ms | suma ar fi fost 1513ms
tur 760ms | cel mai lent agent 759ms | suma ar fi fost 1378ms
tur 686ms | cel mai lent agent 686ms | suma ar fi fost 1299ms
```

Turul e egal cu maximul, nu cu suma: al doilea agent e practic gratis. Restul
timpului e un singur dus-întors la model, și acolo se dă bătălia.

### Când modelul tace

Paralelizarea nu ajută la nimic dacă modelul chemat nu răspunde deloc. Măsurat pe API-ul
real, răspunsurile bune vin în **480–1200 ms**. Când un model se blochează, nu întârzie —
tace până la termen:

```
PICĂ   9017ms  gemini:gemini-3.5-flash-lite      timeout
PICĂ   9494ms  gemini:gemini-flash-lite-latest   timeout
OK      907ms  gemini:gemini-2.5-flash
                                        tur: 19421ms pentru un răspuns de 907ms
```

Două reglaje taie asta, amândouă pornind de la aceeași observație: un răspuns care n-a
venit în câteva secunde nu mai vine.

**Cât timp mai e pe cine cădea, se renunță repede** — 1,8 s, față de 9 s. Întrebarea
acelei încercări nu e „cât de repede răspunde", ci „răspunde *acum*?". Dacă nu, se trece
mai departe. Doar **ultimul** candidat primește termenul întreg: acolo nu mai există
alternativă, iar a renunța repede înseamnă a nu primi niciun răspuns.

`1800 ms` e o dată și jumătate cel mai lent răspuns bun măsurat (1200 ms). Sub atât s-ar
tăia răspunsuri vii; peste, s-ar aștepta degeaba.

Regula a fost la început doar pentru **prima** încercare, cu 4 s — și asta lăsa jumătate
din problemă pe masă. Cu trei candidați:

```
             prima încercare   restul lanțului   cel mai rău caz
înainte           4000 ms        9000 + 9000        22,0 s
acum              1800 ms        1800 + 9000        12,6 s
```

Iar cazul obișnuit — primul model mut, al doilea răspunde în ~900 ms — a scăzut de la
**4,9 s** la **2,7 s**.

**Un model care tocmai a tăcut e ocolit 15 secunde**, ca și cel care a răspuns „quota
exceeded", doar mai puțin: o tăcere trece, o cotă epuizată nu. Fără memoria asta,
cererea următoare plătea din nou aceeași așteptare pe același model mort — iar la o
cerere ambiguă o plătea de câte ori sunt agenți.

```
cererea 1   10569ms   3 încercări   ← află care modele tac
cererea 2     792ms   1 încercare   ← merge direct la cel viu
cererea 3     802ms   1 încercare
```

Reglabile prin `LLM_TIMEOUT_SCURT_MS` și `LLM_PAUZA_TACERE_MS`.

### Ce a fost tăiat din dus-întors

**Gândirea.** Modelele recente deliberează implicit înainte să răspundă. Măsurat pe
`gemini-2.5-flash`, cu `usageMetadata.thoughtsTokenCount`:

```
implicit           1512ms   81 tokeni de gândire
thinkingBudget 0    892ms    0 tokeni de gândire   ← același răspuns
```

Traducerea unei cereri în DSL n-are ce deliberare să ceară, așa că gândirea se oprește.
Nu toate modelele acceptă parametrul — cele care îl resping se învață din mers, la
prima încercare, și pe urmă sunt ocolite.

O capcană găsită pe drum: `maxOutputTokens` **taie răspunsul** dacă gândirea e pornită,
fiindcă tokenii de gândire se scad din același buget — cu 120 de tokeni au ieșit 96 de
gânduri și un JSON retezat la jumătate. De aceea plafonul se pune doar când gândirea a
fost efectiv oprită.

**Temperatura 0.** Determinismul e scopul declarat al proiectului, iar un răspuns
stabil se poate și ține minte.

### Ce arată contorul

Un tur poate să nu coste **nimic**: răspunsul a venit din memorie, sau modelul n-a fost
întrebat și a citit rezerva locală. Amândouă raportează `usage` zero — și ăsta e
adevărul, nu o valoare lipsă.

Contorul trata zero ca lipsă și punea în loc o estimare pornită de la o constantă. Un
tur care costase zero apărea cu ~490 de tokeni, unul real cu ~1100: aceeași comandă,
două cifre care nu se puteau compara. Cifra mică nu era o economie, era o invenție.

```
modelul răspunde      1093   real
din memorie              0   · 0 real, din memorie sau rezervă
rezervă locală           0   · 0 real, din memorie sau rezervă
```

Acum contorul spune și **de unde vine cifra**. Fără asta, un zero pare o defecțiune și
o estimare pare o măsurătoare.

### Memoria răspunsurilor

La temperatura 0, aceeași cerere pe aceeași scenă dă același DSL. A doua oară nu mai
are rost cerută:

```
prima oară   1037ms   1839 tokeni
a 2-a oară      0ms      0 tokeni   ← din memorie
```

Cheia e un hash peste tot ce s-ar fi trimis — promptul de sistem (deci și ce agent, și
ce ramuri) plus starea scenei și cererea. Se schimbă orice, e altă cheie. Se rețin doar
răspunsurile care au trecut de validare, cel mult 200 (`LLM_MEMORIE`), cele mai vechi
ies primele. Badge-ul scrie „din memorie", altfel „0 tokeni" ar deruta.

Contează mai mult decât pare: când încerci formulări, jumătate din cereri sunt
repetări ale uneia dinainte.

### Mai multe chei: lanțul trece de la un provider la altul

Providerul principal e primul cu cheie în `.env`, în ordinea din tabel. Ceilalți nu
sunt ignorați — devin **rezerve**. Lanțul încearcă întâi toate modelele providerului
principal, apoi trece la următorul:

```
GEMINI_API_KEY + GROQ_API_KEY în .env
  →  gemini:gemini-3.5-flash-lite
     gemini:gemini-flash-lite-latest
     gemini:gemini-2.5-flash
     groq:llama-3.3-70b-versatile      ← preia când cota Gemini e epuizată
```

Contează pentru că nivelul gratuit Gemini se consumă repede, iar când se consumă
ajungi pe modelul lui cel mai lent. Cu o a doua cheie, aterizezi la alt provider în
loc să aștepți.

Indicatorul din interfață arată providerul **principal**, dar badge-ul de lângă „DSL
emis" arată pe cel care chiar a răspuns, plus jurnalul din `detalii` cu fiecare
încercare și motivul eșecului.

### Memoria cotei

Cele două modele „lite" cad pe cotă **în același moment, de fiecare dată** — se poartă
ca și cum ar împărți același buget. Cota nu se reface între două cereri la o secundă
distanță, așa că un model care tocmai a răspuns „quota exceeded" e ocolit **60 de
secunde** (`LLM_PAUZA_COTA_MS`). Fără asta, fiecare cerere plătea din nou două
dus-întorsuri inutile și le și lovea degeaba.

Dacă toate modelele sunt pe pauză, se încearcă totuși: mai bine lent decât deloc.

### Ce costă

Măsurat exact cu `countTokens`, promptul de sistem pe ramură, față de varianta cu un
singur model care primea aceleași ramuri:

```
ramura              agenți                        acum   înainte
creare              [geometrie]                    996      1092   -9%
modifică            [geometrie]                    952      1048   -9%
text-nou            [text]                         928      1072  -13%
text-nou+text-poz   [text]                        1754      1898   -8%
caseta              [caseta]                      1135         —     —
cazul cel mai rău   [geometrie + text + caseta]   4334      2840  +53%
```

Pe cererile obișnuite se câștigă **8–13%**, pentru că rutarea pe ramuri taie deja
partea grea. Rândul `caseta` n-are pereche: în varianta cu un singur model, casetele
nu existau.

Când sunt chemați toți agenții se **pierde** — baza comună pleacă de trei ori.
Compromisul e conștient, pentru că altceva se schimbă:

- **latența nu crește** când sunt chemați doi agenți: rulează simultan, iar turul
  durează cât cel mai lent dintre ei, nu cât suma (~700–1000 ms în măsurători);
- **cererile ambigue primesc două răspunsuri corecte** în loc de o singură ghiceală;
- **domeniile nu se mai contaminează**: geometrul nu mai poate rescrie textul din
  greșeală când cererea vorbește despre amândouă;
- **un domeniu nou nu scumpește domeniile vechi**: caseta a costat 684 de tokeni, dar
  numai cererile despre casete îi plătesc. „Pune textul pe latura de sus" costă exact
  cât costa înainte să existe casete.

## Bugetul de tokeni

Promptul de sistem e un arbore: o **bază comună**, trei **roluri** și **șase ramuri**
împărțite între ele. Clasificarea locală alege atât agenții, cât și ramurile lor:

```
COMUN  304 tok         pânza, coordonatele, țintirea, forma minificată
│
├── GEOMETRU  199      rolul, schema „g", „un pas pe tur"
│   ├── creare    493      rect · w/h · at · anchor · cells · replace
│   ├── modifică  449      move · split · resize · clear
│   └── pânză     ~215     canvas_resize — gabaritul zonei de desen
│
├── TIPOGRAF  151      rolul, schema „t", textul aparține unei figuri
│   ├── text-nou  473      set · add · scale — CE scrie textul
│   └── text-poz  826      cele 8 moduri de legare · at · in · words · to · repeat
│
└── CASETAR   147      rolul, schema „t" citită doar pentru casetă
    └── caseta    684      b:"x" · z mărimea exactă · f diferența, scalar sau pe axe
```

Cifra ramurii `pânză` e estimată (~4 caractere/token), nu măsurată cu `countTokens` ca
restul arborelui.
Măsurat exact cu `countTokens`, promptul de sistem trimis efectiv:

```
fa un dreptunghi de 300 pe 150 la 400,400  [geometrie]                    996   24%
imparte figura 0 in 3                      [geometrie]                    952   23%
muta figura 1 la 400,400                   [geometrie]                    952   23%
sterge textul                              [text]                         928   23%
mareste textul                             [text]                         928   23%
mareste caseta cu 40 de pixeli             [caseta]                      1135   26%
pune textul pe latura de sus               [text]                        1754   43%
scrie MIAU in figura                       [text]                        1754   43%
pune textul intr-o caseta                  [text + caseta]               2063   48%
mareste                                    [geometrie + text + caseta]   3841   89%
ceva necunoscut                            [geometrie + text + caseta]   4334  100%
```

Referința 100% e cazul cel mai scump: toți agenții, cu toate ramurile — **4334 de
tokeni**. O cerere obișnuită, care privește un singur domeniu, plătește un sfert.

Două economii se compun aici. Prima: fiecare agent primește **doar rolul lui**, deci o
cerere de geometrie nu mai plătește nimic pentru cele opt moduri de legare a textului.
A doua: separarea textului în conținut și poziție ține cererile de tip „șterge textul"
sau „mărește textul" la 928 de tokeni, față de 1754 dacă ar primi și pozițiile.
A treia: caseta e la agentul ei, deci „mărește caseta cu 40 de pixeli" plătește 1135
și nu atinge nici cele opt legări ale tipografului, nici operațiile geometrului.

### De ce contează specificitatea tiparelor

Un cuvânt care apare în cereri de mai multe feluri atrage inutil o ramură întreagă:

- „dreptunghi" singur nu declanșează `creare` — apare și în „mărește dreptunghiul".
  Creare cere un verb (`fă`, `creează`) sau o formă cu dimensiuni („dreptunghi de 300").
- „pune", „adaugă", „mută", „mărește" au excepție când urmează un cuvânt despre text:
  „pune textul pe latura de sus" e comandă de text, nu figură nouă.
- „interiorul" declanșează `modifică`, **dar nu** când e urmat de „fiecărui" —
  „mută în interiorul figurii" e geometrie, „scrie în interiorul fiecărui dreptunghi"
  e text.
- „text" **nu** declanșează `text-nou` când e urmat de „box": „textboxul" începe cu
  „text", dar nu spune ce anume să scrie. Fără excepție, *„mărește textboxul"* chema
  tipograful, care răspundea cu singurul lucru pe care știe să-l mărească — corpul de
  literă. Caseta creștea sau nu, dar ce se vedea pe ecran era litera umflată.

Un tipar poate rata și din altă direcție: excepția `NU_TEXT` se uită doar la cuvântul
de **lângă verb**. În *„mărește cu 100 de pixeli pe lungime și lățime textboxul"*
substantivul stă la capătul frazei, deci excepția nu-l vedea și ramura de geometrie se
aprindea degeaba — iar geometrul, chemat pe o cerere de text, răspunde ce știe el:
redimensionează figura. De aceea `sectiuni()` mai face o trecere pe toată fraza: dacă
se vorbește despre text sau casetă și despre **nicio** figură, ramurile de geometrie
sunt scoase.

A treia direcție de ratare e o **cantitate strecurată între verb și substantiv**.
`text-poz` avea în listă literalul „mută textul", deci *„mută **tot** textul sub figura
0"* nu-l mai potrivea. Aici paguba nu era doar de tokeni:

```
înainte   [geometrie + text]   text-nou, modifică      ← lipsește text-poz
acum      [text]               text-nou, text-poz
```

Tipograful primea doar ramura despre **ce scrie** textul, care n-are cum să exprime o
mutare, deci răspundea gol. Geometrul, chemat degeaba, n-avea nici el ce muta. Cu
amândoi tăcuți, turul eșua cu *„niciun agent nu a produs o comandă"* — cererea nu făcea
nimic și nici nu spunea de ce. Acum tiparul acceptă cantitatea la mijloc („tot",
„toate", „întreg"), la fel ca excepția `NU_TEXT`, care se lovea de aceeași problemă:
cuvântul de lângă verb era „tot", nu „textul".

Grija e ca excepția să nu fure cereri care chiar sunt despre figuri: doar cantitățile
trec la mijloc, nu orice cuvânt. *„mută pătratul sub figura 0"* și *„mărește tot
dreptunghiul"* rămân la geometru.

Fiecare astfel de excepție valorează câteva sute de tokeni la fiecare apel care ar fi
nimerit greșit — sau, ca aici, diferența dintre o comandă care merge și una care eșuează.

### Pragul de tokeni

Promptul de sistem crește pe nesimțite: fiecare regulă nouă pare ieftină luată singură.
De aceea pragurile sunt un **contract verificat la fiecare rulare** — `test.mjs` măsoară
promptul pe ramură și pică dacă trece de plafon, spunând pe ce caz:

```
PASS    ...~672 tokeni, sub pragul de 705      [geometrie]
PASS    ...~758 tokeni, sub pragul de 795      [caseta]
PASS   ...~1366 tokeni, sub pragul de 1435     [text, cu poziții]
PASS   ...~3070 tokeni, sub pragul de 3220     cazul cel mai rău
PASS  baza comună: ~203 tokeni
```

Marja e ~5%: strânsă cât să pice la un rând adăugat, largă cât să nu pice la o
reformulare. Verificat pe viu — un singur rând în plus în baza comună face testul să
pice în cinci locuri deodată, fiindcă baza se plătește o dată per agent chemat.

Tot de aici a venit și o economie: blocul de țintire a ajuns de la 154 la **104**
tokeni, sub cele 112 de dinainte să existe a doua serie de numere — descrie mai mult,
în mai puțin. Ce se vede oricum din starea trimisă (că `T0` stă „pe #1", că o figură are
gabarit) nu se mai explică în prompt.

Al doilea nivel de economie: apelurile **nu se acumulează**. Fiecare tur trimite
ramurile relevante plus obiectele de pe scenă — niciodată istoricul conversației.

## DSL-ul minificat

Pe fir, modelul emite forma scurtă — chei de un caracter și puncte ca perechi:

```json
{"g":{"o":"r","w":50,"h":50,"p":[25,25],"a":"bl"},"y":"colt in punct"}
```

`validate()` din `server/llm.js` o expandează înapoi la forma lungă, deci restul
aplicației nu află nimic despre minificare — App, motorul și testele lucrează cu chei
citibile. Forma lungă rămâne acceptată: parserul local de rezervă o produce, iar un
model care ignoră scurtările nu eșuează din cauza asta.

Măsurat exact cu endpoint-ul `countTokens`, nu estimat: **−11%** pe tokenii de ieșire.
Economia e concentrată însă într-un singur loc:

```
{"at":{"x":25,"y":25}}   13 tokeni
{"p":[25,25]}             9 tokeni     ← aici e tot câștigul

"op" 1 token    "o" 1 token
"split" 1 token  "s" 1 token           ← scurtarea cheilor nu economisește nimic
```

Cuvintele scurte sunt deja un singur token, deci `rect` → `r` nu schimbă nimic pentru
tokenizator. Comenzile fără coordonate ies la 0% economie; cele cu coordonate, la
13–17%.

## Un pas pe tur

Răspunsul poate conține cel mult **o operație de geometrie și una de text**. Cele două
se combină: *„mărește-l și scrie ALFA"* funcționează într-un singur tur.

Dar o cerere care înșiruie mai mulți pași de geometrie — *„fă un pătrat, apoi
împarte-l, apoi scrie în fiecare bucată"* — nu încape în DSL. Promptul îi cere
modelului să execute **doar primul pas** și să spună în `y` ce a rămas:

```
fa un patrat de 200 in punctul 300,300, apoi imparte-l in 2 si scrie MIAU
  → {"op":"rect","w":200,"h":200,"at":{"x":300,"y":300}}
    y: "creat patratul, urmeaza impartirea"
```

Fără regula asta, modelul încerca să emită o listă de operații, iar validarea o
respingea complet — comanda eșua în loc să facă măcar primul pas.

## Ce ține sistemul determinist

1. **Invariantul `Σ len`** — geometria e închisă matematic; modelul nu poate cere
   accidental o figură mai mare.
2. **Validarea DSL** (`validate()` din `server/llm.js`) — plafonează, filtrează și
   respinge tot ce e invalid înainte să atingă motorul. Dimensiuni absurde se
   plafonează, operațiile inexistente devin `null`, punctele din afara pânzei sunt
   ignorate.
3. **Clasificarea locală** — numele figurii se deduce din atribute; modelul nu e
   întrebat niciodată ce vede.
4. **Țintirea locală** — când modelul uită `target`, se deduce din textul cererii; la
   fel destinația unei comenzi de text, citită din vectorul de centre.
5. **Dimensiunea obligatorie** — dacă cererea nu spune cât de mare, se refuză
   generarea în loc să se inventeze o valoare.
6. **Defaults locale** pentru tot ce promptul nu specifică (orientarea tăierii,
   spațierea, poziția), altfel fiecare detaliu nespecificat ar fi ajuns o întrebare
   către model.
7. **Fără istoric** — modelele halucinează pe context vechi; aici nu există.
8. **Fallback pe parser local** — dacă modelul lipsește sau cade, aplicația continuă.

## Structura

```
index.html            214   interfața: pânza + două casete de comandă + panouri
serve.js              125   server static + proxy /api/parse
test.mjs             1898   verificare headless
server/
  llm.js              125   fațada: o singură ușă de intrare, askModel
  providers.js        416   providerii + ModelClient (lanțul de rezerve)
  agents/                 un folder per task
    base/                 ce plătesc toți agenții
      Agent.js        120   promptul comun, ramurile, citirea răspunsului
      valori.js        71   pânza, punctele, ținta — ce nu ține de niciun domeniu
    routing/              cine răspunde la cerere
      Router.js       177   dispecerul local: ce agenți, ce ramuri, ce casetă
    orchestration/        cum se leagă răspunsurile la loc
      Echipa.js       113   rulare în paralel + combinarea câmpurilor
    geometry/             domeniul spațial
      Geometru.js     182   rect · split · resize · move · clear · pânză
    text/                 domeniul cuvintelor
      Tipograf.js     208   conținut · legare · mărime · transfer
    textbox/              domeniul ambalajului
      Casetar.js      156   dacă textul intră în casetă și cât e de mare
src/
  core/App.js        1570   orchestratorul
  models/
    Figure.js         237   polilinii cu {len, turn}; coordonatele se derivă
    Scene.js          226   pânza, gabaritul ei, conversiile, obiectele, centrele lor
    ShapeBST.js        94   codificarea pe atribute + catalogul auto-extensibil
  engines/
    Operations.js     192   rect, split, resize, stretch, ancorare
    LayoutEngine.js   264   scenă absolută, scale-shape, restrângerea în pânză
    AnimationEngine.js 157   LERP, plus muchii care apar și dispar
  text/
    TextStream.js      44   text parametrizat pe lungime de arc
    TextBinder.js     327   cele 9 moduri de legare
    Asezator.js       107   unde cade un text nou: cel mai gol loc de pe pânză
  renderer/
    CanvasRenderer.js 154   singurul modul care atinge un pixel
  interaction/
    PromptParser.js   534   apel la model + rezerva locală, pe domeniul casetei
    InputManager.js    61   selecție prin click, Shift pentru multiplă
    TokenMeter.js      39   compară strategiile de prompting
    CommandManager.js  23   undo pe snapshot-uri de scenă
```

Numele `ShapeBST.js` e o rămășiță: nu mai e un arbore binar de căutare, ci o
codificare pe atribute.

### Un agent nou

Fiecare domeniu are folderul lui în `server/agents/`, numit după task: `geometry/`,
`text/`, `textbox/`. Lângă ele stau cele trei care nu sunt domenii, ci infrastructură —
`base/` (ce plătesc toți), `routing/` (cine răspunde), `orchestration/` (cum se leagă
răspunsurile la loc). Un domeniu nou înseamnă un folder nou, nu un fișier în plus
într-o grămadă comună.

`Geometru`, `Tipograf` și `Casetar` moștenesc `Agent` și declară trei lucruri: rolul
(rândurile de prompt care spun cine sunt), ramurile pe care le dețin, și
`valideaza(d)` — cum se citește câmpul lor din răspuns. Restul vine din clasa de bază.

Routerul nu îi cunoaște pe nume; se uită ce ramuri declară fiecare. `Casetar` chiar
așa a apărut: clasa, ramura ei în `Router.RUTE`, și trecerea în lista dată lui
`Echipa`. Nicio linie schimbată în `Geometru` sau în `Tipograf`.

Singurul lucru care nu vine gratis e **câmpul**. Doi agenți care umplu același câmp
se suprascriu la combinare, iar „primul câștigă" ar arunca în tăcere răspunsul
celuilalt. Un agent nou fie își ia câmpul lui, fie spune explicit cum se topește în
altul — cum face casetarul, la sfârșitul lui `Echipa.combina`.

## Tehnologii

HTML5 cu `<canvas>`, CSS scris direct în `<style>` (variabile CSS + CSS Grid), și
**JavaScript ES2022+ vanilla** cu module ES native — încărcate direct de browser, fără
bundler. Pe server, **Node.js 20** cu module native (`node:http`, `node:fs`) și `fetch`
global.

Fără framework, fără TypeScript, fără bundler, fără preprocesor CSS, fără framework de
testare. Singurul serviciu extern e API-ul Gemini, cu client scris de mână.

## Modelul

`server/llm.js` cunoaște patru provideri, aleși după prima variabilă de mediu
completată:

| Variabilă | Provider | Model implicit |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio | `gemini-3.5-flash-lite` |
| `GROQ_API_KEY` | Groq | `llama-3.3-70b-versatile` |
| `OPENROUTER_API_KEY` | OpenRouter | `llama-3.3-70b-instruct:free` |
| *(niciuna)* | Ollama local | primul model de text instalat |

Fiecare se poate fixa prin `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL` sau
`OLLAMA_MODEL`. Se pot pune mai multe chei deodată: prima din tabel e providerul
activ, restul devin rezerve în același lanț.

Pe Gemini există un lanț de rezerve — `gemini-3.5-flash-lite` →
`gemini-flash-lite-latest` → `gemini-2.5-flash`. Reîncercarea se declanșează la
retragerea modelului, supraîncărcare, cotă depășită, 429, 503, timeout sau JSON
malformat. Erorile reale — cheie greșită, cerere invalidă — nu declanșează
reîncercare. Fiecare apel are timeout de 9 s, reglabil prin `LLM_TIMEOUT_MS`.

Lanțul de rezerve e per agent: dacă geometrul cade pe cotă, își încearcă rezervele
singur, fără să blocheze tipograful. Un model care răspunde „quota exceeded" e ocolit
60 de secunde, ca următoarele cereri să nu mai plătească dus-întorsul către el. Un agent care eșuează complet nu anulează turul —
contribuie celălalt, și doar dacă niciunul nu produce nimic cererea eșuează explicit.

Provider-ul activ se vede cu `GET /api/status`, iar badge-ul de lângă „DSL emis"
arată modelul folosit, agenții chemați și durata reală a turului.

## Rezerva locală

Când modelul nu răspunde — cheie lipsă, cotă epuizată, rețea moartă — promptul e
citit local, cu regexuri, în `PromptParser.js`. Badge-ul scrie „regex local".

Rezerva nu concurează modelul; recunoaște formele uzuale și atât:

```
fa un patrat de 300 la 400,400   → {"op":"rect","w":300,"h":300,"at":{"x":400,"y":400}}
imparte in 3 pe orizontala        → {"op":"split","into":3,"dir":"h"}
mareste                           → {"op":"resize","scale":1.5}
muta la 400,400                   → {"op":"move","at":{"x":400,"y":400}}
scrie JOS sub latura de sus       → {"set":["JOS"],"bind":"side","at":"top","in":true}
scrie ALFA pe fiecare latura      → {"set":["ALFA"],"bind":"sides","repeat":true}
```

Rezerva acoperă și textul, nu doar figurile: conținut (`set`, `add`), poziție (toate
cele opt legări, inclusiv `point`), caseta și mărimea ei, mărimea fontului, transfer
între figuri și subset de cuvinte. Rezerva nu are agenți: emite tot deodată, iar
`validate()` fără domeniu trece răspunsul prin toți validatorii.

```
muta textul in punctul de coordonate 325, 325  → {"bind":"point","at":{"x":325,"y":325}}
muta textul de pe figura 1 pe figura 0         → {"to":0}
scrie si BETA                                   → {"add":["BETA"]}
muta primele doua cuvinte in stanga jos         → {"words":[0,1],"bind":"corner","at":"bl"}
pune textul intr-o caseta de 300 pe 80          → {"bind":"box","box":{"w":300,"h":80}}
mareste caseta cu 40 de pixeli                  → {"boxDelta":40}
mareste textboxul cu 50x200                     → {"boxDelta":{"w":50,"h":200}}
```

Regula care contează: **ce nu înțelege, refuză explicit**. Un DSL plauzibil dar cu
operații inexistente e mai rău decât un refuz — se afișează în interfață, pare că s-a
întâmplat ceva, și nu se aplică nimic.

Asta chiar s-a întâmplat: rezerva rămăsese la DSL-ul de acum două generații
(`polygon`, `rhombus`, `unfold`), din vremea când domeniul nu era încă restrâns la
patrulatere cu unghiuri drepte. Cât timp modelul răspundea, nimeni nu observa. Când
cota Gemini s-a epuizat, fiecare prompt cădea pe rezervă și nu genera nimic.

Când rezerva chiar nu înțelege, mesajul spune și **de ce s-a ajuns la ea**:

```
⚠ Nu am recunoscut nicio operație în prompt. — modelul n-a răspuns
  (You exceeded your current quota), a citit rezerva locală
```

Fără precizarea asta pare că promptul e de vină și îl rescrii degeaba: adevărata cauză
e că modelul n-a fost întrebat.

Testele împiedică repetarea: fiecare formă pe care o poate emite rezerva trece prin
`validate()` — aceeași funcție pe care o folosesc agenții — și se verifică că operația
supraviețuiește validării. Dacă DSL-ul se mai schimbă vreodată, rezerva pică la teste,
nu în interfață.

## Limitări cunoscute

- Două figuri identice în același punct se ascund una pe alta — se disting doar în
  panoul de obiecte.
- `CanvasRenderer` nu e acoperit de teste automate: are nevoie de DOM și se validează
  vizual. Din `AnimationEngine` e acoperită tranziția pânzei — testul împinge `tick`
  cu mâna, fiindcă `requestAnimationFrame` e inert acolo; restul se validează tot vizual. `App` **este** acoperit, printr-un canvas inert și un
  `fetch` care întoarce DSL-ul dat (secțiunea 10 din `test.mjs`) — acolo au apărut
  defectele care se vedeau doar la rulare, nu în modulele luate separat.
- Cota gratuită se consumă repede la prompturi trase în rafală; la depășire, lanțul de
  rezerve trece pe alt model.
- Cererile ambigue costă mai mult, nu mai puțin: se cheamă amândoi agenți, iar baza
  comună pleacă de două ori. Latența nu crește, fiindcă apelurile sunt simultane.
- Pe Ollama local nu există lanț de rezerve: se folosește un singur model, iar pe CPU
  latența e sensibil mai mare decât pe cloud.
- Pânza se micșorează până la 50px pe latură și crește înapoi până la 800; mai mare
  n-ar încăpea în coloana ei din pagină. O cerere în afara limitelor se plafonează și
  se spune în notă, nu se refuză.
- Restrângerea în pânză mută obiectele, deci nu se desface singură când pânza crește
  la loc: pentru asta e `Undo`.
