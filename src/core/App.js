// App.js — orchestratorul. Nu calculeaza nimic singur: leaga modulele.
//
//   click (Shift = adauga la selectie) -> SELECTIE de obiecte
//   prompt -> [MODEL] DSL -> operatia se aplica pe TOATE obiectele selectate
//          -> LayoutEngine per obiect -> AnimationEngine -> CanvasRenderer
//
// Scena e o grila 16x16 de celule de 50px, cu originea (0,0) in STANGA JOS.
//   - DSL cu "at" sau "cells"  -> creeaza obiecte noi pe celulele cerute
//   - DSL fara coordonate      -> se aplica simultan pe tot ce e selectat
//                                 (sau pe toate obiectele, daca nu e nimic selectat)
//
// INVARIANT: fiecare obiect isi conserva PROPRIUL Sum(len). Bugete independente,
// ca o modificare pe un obiect sa nu miste altul.

import { Figure } from '../models/Figure.js';
import { Scene, Obiect, CELL, CANVAS_PX, PANZA_MIN, panza, AX, pointPixel, toLogic, inCanvas, nextText } from '../models/Scene.js';
import { search, skeleton, flatCatalog, leafCount, addressable, registry } from '../models/ShapeBST.js';
import { TextStream } from '../text/TextStream.js';
import { OPS } from '../engines/Operations.js';
import { layout, schimbaCaseta, limCaseta, restrange, CASETA } from '../engines/LayoutEngine.js';
import { Asezator } from '../text/Asezator.js';
import { AnimationEngine } from '../engines/AnimationEngine.js';
import { CanvasRenderer } from '../renderer/CanvasRenderer.js';
import { InputManager } from '../interaction/InputManager.js';
import { parseRemote, providerStatus, cereInlocuire, cerePanza, cereObiecte } from '../interaction/PromptParser.js';
import { compare } from '../interaction/TokenMeter.js';
import { CommandManager } from '../interaction/CommandManager.js';

/**
 * Panza, asa cum o vede restul aplicatiei.
 *
 * Latimea si inaltimea sunt GETTERE, nu numere copiate la incarcare: panza isi poate
 * schimba gabaritul din prompt, iar toate apelurile de mai jos — layout, asezator,
 * contorul de tokeni — primesc acelasi obiect. Cu doua numere fixe ar fi trebuit
 * reconstruit in fiecare loc, si primul uitat ar fi lucrat pe panza veche.
 */
const CANVAS = { get w() { return panza.w; }, get h() { return panza.h; }, pad: 6 };
const FONT = 17;

/**
 * Cat de mare poate ajunge litera cand creste odata cu caseta.
 *
 * Plafonul de 56px al lui `scale` a ramas acolo unde era — el opreste un „mareste
 * textul" repetat. Caseta insa poate ajunge cat panza, iar o litera de 56px intr-o
 * caseta de 700px arata tot a text mic intr-o cutie goala. Aici opresc alte doua
 * limite, amandoua legate de caseta: cel mai lat cuvant trebuie sa incapa pe un rand,
 * si un rand trebuie sa incapa pe inaltime.
 */
const FONT_MAX_CASETA = 160;

// Un element scos din pagina nu trebuie sa doboare aplicatia: cand lipseste,
// primim un obiect inert care inghite scrierile si intoarce sir gol la citire.
const LIPSA = new Proxy({}, {
  get: (_, k) => (k === 'value' ? '' : () => {}),
  set: () => true,
});
const $ = id => document.getElementById(id) || LIPSA;

export class App {
  /** Legarile care se raporteaza la conturul figurii. Fara figura, n-au reper. */
  static FARA_FIGURA = new Set(['inside', 'pieces', 'path', 'sides', 'side']);

  constructor() {
    this.renderer = new CanvasRenderer($('canvas'));
    this.renderer.resize(CANVAS.w, CANVAS.h, AX);
    this.renderer.setGrid(CELL);

    this.scena = new Scene();
    this.selectie = new Set();          // id-uri de obiect; goala = "toate"
    this.history = new CommandManager();
    this.convo = { turns: 0, inTot: 0, outTot: 0, sys: 0, hist: [] };
    // Fiecare cadru poate veni cu alt gabarit de panza: elementul de desen se
    // redimensioneaza inaintea desenarii. Cand nu s-a schimbat, nu se atinge —
    // `canvas.width` sterge continutul chiar si cand i se scrie aceeasi valoare.
    this.anim = new AnimationEngine(scene => {
      const p = scene.panza;
      if (p && (Math.round(p.w) !== this.renderer.w || Math.round(p.h) !== this.renderer.h)) {
        this.renderer.resize(Math.round(p.w), Math.round(p.h), AX);
      }
      this.renderer.render(scene);
    });

    this.skeleton = skeleton();
    this.flat = flatCatalog();
    $('addressable').textContent = addressable().toLocaleString('ro-RO');
    $('skelSize').textContent = this.skeleton.split('\n').length;

    new InputManager($('canvas'), () => this.scene, (id, aditiv) => this.select(id, aditiv), AX);

    this.wire();
    this.draw(true);
    this.inspect();
    this.showProvider();
  }

  faceStream(words = [], fontPx = FONT) {
    return new TextStream(words, this.renderer.ctx, fontPx);
  }

  async showProvider() {
    const s = await providerStatus();
    $('provider').textContent = s.provider + ' · ' + s.model;
  }

  /**
   * Cele doua casete de comanda: una doar pentru panza, alta pentru figuri si text.
   *
   * Care caseta a fost folosita e un semnal de rutare pe care il da OMUL, gratis —
   * si e fara echivoc, spre deosebire de cuvinte. „Mareste" scris in caseta panzei
   * nu mai poate fi citit ca o marire de figura, oricat de ambiguu ar fi verbul.
   */
  static CASETE = [
    { camp: 'promptPanza',  buton: 'goPanza',  doar: 'panza' },
    { camp: 'promptFiguri', buton: 'goFiguri', doar: 'figuri' },
  ];

  /** Caseta din care vine o cerere; fara domeniu, cea a figurilor. */
  static caseta(doar) {
    return App.CASETE.find(c => c.doar === doar) || App.CASETE[1];
  }

  wire() {
    for (const { camp, buton, doar } of App.CASETE) {
      $(buton).onclick = () => this.run($(camp).value, doar);
      $(camp).addEventListener('keydown', e => { if (e.key === 'Enter') this.run($(camp).value, doar); });
    }
    $('undo').onclick = () => {
      const s = this.history.undo(this.scena.snapshot());
      if (!s) return;
      this.scena.restore(s, (w, f) => this.faceStream(w, f));
      // Instantaneul duce cu el si gabaritul panzei; elementul de desen il urmeaza
      // prin animatie, ca la orice alta schimbare.
      this.selectie.clear();
      this.draw(); this.inspect();
    };
    $('deselect').onclick = () => { this.selectie.clear(); this.draw(); this.inspect(); };
  }

  select(id, aditiv) {
    if (id === null) this.selectie.clear();
    else if (aditiv) this.selectie.has(id) ? this.selectie.delete(id) : this.selectie.add(id);
    else { this.selectie.clear(); this.selectie.add(id); }
    this.draw(); this.inspect();
  }

  /**
   * FIGURILE de pe scena, in ordinea crearii. Ele sunt cele numerotate #0, #1, ...
   *
   * Un text scris pe panza goala e tot un obiect, dar fara contur — nu e o figura si
   * nu consuma un numar de figura. Altfel „figura 1" ar fi insemnat a doua figura doar
   * daca nu s-a scris niciun text intre timp, si exact asta deruta.
   */
  figuri() {
    return this.scena.obiecte.filter(o => !o.figure.isEmpty);
  }

  /**
   * Numerele de ordine ale textelor de pe scena, sortate crescator.
   *
   * Pozitia in lista e numarul aratat: T0 e primul text generat dintre cele ramase.
   * Ordinea de generare e monotona si nu se reia, dar numerotarea afisata e pozitionala
   * — ca la figuri, unde #k e al k-lea din vector — deci dupa o stergere numerele
   * raman compacte in loc sa sara.
   */
  ordineTexte() {
    const seq = new Set();
    for (const o of this.scena.obiecte) for (const s of o.texte) if (s) seq.add(s);
    return [...seq].sort((a, b) => a - b);
  }

  /**
   * Textul T{nr}: pe ce obiect sta si care cuvinte ale lui ii apartin.
   * @returns {{o:Obiect, words:number[], seq:number}|null}
   */
  text(nr) {
    const seq = this.ordineTexte()[nr];
    if (seq === undefined) return null;
    for (const o of this.scena.obiecte) {
      const words = o.texte.reduce((a, s, k) => (s === seq ? (a.push(k), a) : a), []);
      if (words.length) return { o, words, seq };
    }
    return null;
  }

  /**
   * Obiectele pe care lucreaza urmatoarea comanda, in ordinea prioritatii:
   *   1. `target` din DSL — un numar e o FIGURA (#1), „t1" e un TEXT
   *   2. selectia facuta cu click
   *   3. toate obiectele
   */
  tinte(target) {
    if (Array.isArray(target) && target.length) {
      const fig = this.figuri();
      const gasite = new Set();
      for (const t of target) {
        const s = String(t).trim();
        // „t1" — al doilea text; obiectul lui poate fi o figura sau un text liber
        const cerutText = /^t([0-9]+)$/i.exec(s);
        if (cerutText) {
          const r = this.text(Number(cerutText[1]));
          if (r) gasite.add(r.o);
          continue;
        }
        const n = Number(t);
        if (Number.isInteger(n) && s !== '') { if (fig[n]) gasite.add(fig[n]); continue; }
        const dupaId = this.scena.byId(s);       // id intern, tolerat
        if (dupaId) gasite.add(dupaId);
      }
      if (gasite.size) return [...gasite];
    }
    return this.selectie.size
      ? this.scena.obiecte.filter(o => this.selectie.has(o.id))
      : this.scena.obiecte;
  }

  /**
   * Tintele unei comenzi de TEXT: obiectul si, cand cererea numeste un text anume,
   * doar cuvintele acelui text.
   *
   * Fara restrangerea asta, „mareste textul 1" ar fi marit tot ce scrie pe obiectul
   * care se intampla sa gazduiasca T1 — inclusiv celelalte texte ale lui.
   *
   * Un `words` venit de la model se citeste ATUNCI ca pozitie in interiorul textului:
   * „primele doua cuvinte din textul 1".
   *
   * @returns {{o:Obiect, words:number[]|null}[]} words null = tot textul obiectului
   */
  tinteText(target, words) {
    const cerute = (Array.isArray(target) ? target : [])
      .map(x => /^t([0-9]+)$/i.exec(String(x).trim())).filter(Boolean);

    if (cerute.length) {
      // Mai multe texte pot sta pe ACELASI obiect. Se strang intr-o singura intrare,
      // cu toti indicii la un loc. Doua intrari pentru acelasi obiect ar fi fost
      // prelucrate pe rand, iar a doua ar fi citit indici socotiti INAINTE ca prima
      // sa-si scoata cuvintele — adica pozitii care intre timp s-au mutat. Asa a ajuns
      // „muta tot textul" sa lase un text pe loc si sa scrie „undefined" la destinatie.
      const peObiect = new Map();
      for (const m of cerute) {
        const r = this.text(Number(m[1]));
        if (!r) continue;
        const alese = Array.isArray(words) && words.length
          ? words.map(i => r.words[i]).filter(k => k !== undefined)
          : r.words;
        if (!alese.length) continue;
        const deja = peObiect.get(r.o);
        if (deja) for (const k of alese) deja.add(k);
        else peObiect.set(r.o, new Set(alese));
      }
      if (peObiect.size) {
        return [...peObiect].map(([o, set]) => ({ o, words: [...set].sort((a, b) => a - b) }));
      }
    }
    return this.tinte(target).map(o => ({ o, words: null }));
  }

  // ---------------------------------------------------------------- desenare

  draw(instant = false) {
    const edges = [], words = [], casete = [];
    for (const o of this.scena.obiecte) {
      const sc = layout(o.figure, o.stream, o.binds, CANVAS);
      const sel = this.selectie.has(o.id);
      for (const e of sc.edges) edges.push({ ...e, id: o.edgeKey(e.id), sel, obj: o.id });
      for (const w of sc.words) words.push({ ...w, i: o.wordKey(w.i), sel, obj: o.id });
      // casetele nu se animeaza: sunt ambalajul textului, nu continut
      for (const c of sc.casete || []) casete.push({ ...c, sel, obj: o.id });
    }
    // Gabaritul panzei intra in scena, deci se si animeaza: dupa „micsoreaza canvasul
    // la 250 pe 100" elementul de desen se strange pe aceeasi curba ca figurile, nu
    // sare intr-un cadru.
    this.scene = { edges, words, casete, panza: { w: CANVAS.w, h: CANVAS.h } };
    this.anim.goTo(this.scene, instant);
  }

  // ---------------------------------------------------------------- raportare

  nodeInfo(fig) {
    const sig = fig.signature();
    const hit = search(sig);
    return { nume: hit.leaf, cod: hit.path, laturi: sig.nSegMax, piese: sig.nPoly,
             total: Math.round(fig.totalLength()), _hit: hit };
  }

  /**
   * Recalculeaza CENTRUL fiecarui obiect si il scrie in vectorul dupa care se face
   * identificarea.
   *
   * Centrul nu e punctul de asezare. `at` ramane ce s-a cerut la creare — „coltul
   * stanga jos in (25,25)" — pe cand centrul e unde se afla obiectul ACUM. Orice
   * operatie care schimba forma sau locul le desparte: o scalare pastreaza punctul
   * de asezare, dar muta centrul; la fel taierea, mutarea si redimensionarea panzei,
   * care mai si aduce figurile inapoi in cadru.
   *
   * Pana acum centrul se recalcula ad-hoc, in fiecare consumator, din `figure.centroid()`.
   * Mergea, dar nimeni nu-l tinea minte: nu exista un loc in care sa scrie unde e
   * figura, deci nici pe care sa se sprijine o cerere ca „muta textul in mijlocul
   * figurii 0". Acum exista, e unul singur, si se reimprospateaza dupa fiecare
   * operatie de geometrie.
   *
   * Un obiect FARA figura — un text de sine statator — n-are contur din care sa iasa
   * un centroid: centrul lui e mijlocul cuvintelor asa cum se deseneaza. De aceea
   * trece prin `undeSta`, nu prin `centroid`.
   *
   * @returns {{x:number,y:number}[]} vectorul de centre, in ordinea obiectelor
   */
  actualizeazaCentre() {
    for (const o of this.scena.obiecte) {
      if (!o.figure.isEmpty) {
        // conturul isi da centrul din varfuri; nu se plafoneaza la panza, ca o figura
        // mai mare decat ea sa-si raporteze centrul adevarat, nu unul impins in cadru
        const c = o.figure.centroid();
        o.centru = { x: Math.round(c.x), y: Math.round(panza.h - c.y) };
      } else {
        const p = this.undeSta(o);
        o.centru = p ? toLogic(p.x, p.y) : { x: o.at.x, y: o.at.y };
      }
    }
    return this.scena.obiecte.map(o => o.centru);
  }

  /**
   * Ce pleaca spre model: TOATE obiectele de pe scena, fiecare cu numarul lui.
   *
   * Nu doar cele selectate. Altfel, dupa ce creezi o figura (care se selecteaza
   * automat), modelul ar vedea o singura figura si n-ar avea cum sa raspunda la
   * "muta figura 1" — indicele acela n-ar exista in starea primita.
   *
   * Care sunt selectate se spune separat, ca modelul sa stie pe ce se aplica o
   * comanda fara tinta explicita.
   */
  payload() {
    // Vectorul de centre se reimprospateaza INAINTE de citire. Aici e granita dintre
    // scena si model: ce pleaca de aici trebuie sa fie adevarat, iar un centru ramas
    // in urma dupa o scalare inseamna un model care tinteste unde figura NU mai e.
    this.actualizeazaCentre();

    const sel = [];
    const figuri = this.figuri();
    const noduri = figuri.map((o, i) => {
      const n = this.nodeInfo(o.figure);
      const sig = o.figure.signature();
      if (this.selectie.has(o.id)) sel.push(i);
      // pozitia raportata e CENTRUL figurii, in coordonate logice
      return {
        i, id: o.id, nume: n.nume,
        w: Math.round(sig.bboxW), h: Math.round(sig.bboxH),
        at: { x: o.centru.x, y: o.centru.y },
      };
    });

    // Textele au seria lor, T0, T1, ... in ordinea in care au fost scrise. Un text
    // sta fie pe o figura (`pe`), fie singur pe panza — si atunci isi da pozitia.
    const texte = this.ordineTexte().map((seq, i) => {
      const o = this.scena.obiecte.find(x => x.texte.includes(seq));
      const peFigura = figuri.indexOf(o);
      // acelasi vector: un text liber isi raporteaza centrul cuvintelor asa cum sunt
      // desenate ACUM, nu punctul in care a fost asezat candva
      const c = o.centru;
      return {
        i,
        cuvinte: o.stream.words.filter((_, k) => o.texte[k] === seq),
        pe: peFigura >= 0 ? peFigura : null,
        at: { x: c.x, y: c.y },
        sel: this.selectie.has(o.id),
      };
    });

    return {
      noduri, texte,
      parent: {
        figuri: noduri.length, texte: texte.length, obiecte: this.scena.length,
        selectate: sel, panza: { w: panza.w, h: panza.h }, celula: CELL,
      },
    };
  }

  inspect() {
    const p = this.payload();
    const vizate = this.tinte();
    const primul = vizate[0];

    if (primul) {
      const info = this.nodeInfo(primul.figure);
      $('bstPath').textContent = info.cod;
      $('bstLeaf').innerHTML = info.nume + (info._hit.learned ? ' <span class="new">FIGURĂ NOUĂ</span>' : '');
      $('bstQ').innerHTML = info._hit.questions.map(q => `<div class="q">${q}</div>`).join('');
      $('bstCmp').textContent = `${info._hit.comparisons} atribute (constant)`;
    } else {
      $('bstPath').textContent = '—';
      $('bstLeaf').textContent = 'pânză goală';
      $('bstQ').innerHTML = '';
      $('bstCmp').textContent = '—';
    }

    const moduri = new Set();
    for (const o of this.scena.obiecte)
      for (const b of o.binds) moduri.add(typeof b === 'string' ? b : b.bind + ':' + b.at);
    $('bindMode').textContent = moduri.size ? [...moduri].join(' + ') : '—';
    $('invariant').textContent = Math.round(this.scena.totalLength());
    $('learned').innerHTML = [...registry.values()].map(v => `<span class="chip">${v.leaf}</span>`).join('');
    $('learnCount').textContent = leafCount();

    const n = this.scena.length;
    const numere = this.figuri().map((o, k) => (this.selectie.has(o.id) ? `#${k}` : null)).filter(Boolean);
    $('selInfo').innerHTML = !n
      ? '<span class="dim">pânza e goală — cere o figură, opțional cu coordonate</span>'
      : this.selectie.size
        ? `selectate: <b>${numere.join(' ')}</b> din ${n} · comenzile fără țintă se aplică pe ele`
        : `<span class="dim">${n} obiecte, niciunul selectat — comenzile se aplică pe <b>toate</b></span>`;

    $('payload').textContent = JSON.stringify(p, null, 1);
    // textele isi arata numarul lor, T0, T1 ..., si unde stau: pe o figura sau libere
    $('textState').innerHTML = p.texte.length
      ? p.texte.map(t => {
          const activ = !this.selectie.size || t.sel;
          const unde = t.pe !== null ? `pe #${t.pe}` : `liber @${t.at.x},${t.at.y}`;
          return `<span class="chip" style="opacity:${activ ? 1 : .4}">T${t.i} ${unde}: ${t.cuvinte.join(' ')}</span>`;
        }).join('')
      : '<span class="dim">niciun text</span>';
    return p;
  }

  // ---------------------------------------------------------------- operatii

  /**
   * Dimensiunea ceruta, in celule. Acelasi raspuns indiferent daca DSL-ul vine de la
   * model (unde validarea extinde deja `size`) sau de la parserul local de rezerva.
   * @returns {{w:number,h:number}|null} null daca cererea nu spune cat de mare
   */
  dimensiuni(g) {
    const lim = v => Math.max(1, Math.min(CANVAS_PX, Math.round(v)));
    const w = Number(g.w), h = Number(g.h), s = Number(g.size);
    if (Number.isFinite(w) && Number.isFinite(h)) return { w: lim(w), h: lim(h) };
    if (Number.isFinite(s)) return { w: lim(s), h: lim(s) };
    return null;
  }

  /**
   * Tinta dedusa LOCAL din textul cererii, cand modelul n-a pus `target`.
   *
   * Modelele mici uita frecvent sa tinteasca, sau tintesc figura gresita. Dar
   * potrivirea "cuvant din cerere" -> "figura de pe scena" e determinista: o facem
   * aici, gratuit. Conservator: daca potrivirea prinde toate obiectele sau niciunul,
   * nu ne bagam si lasam comportamentul implicit.
   */
  /** Fara diacritice si cu litere mici: tiparele locale se scriu o singura data. */
  static norm(t) {
    return String(t).toLowerCase()
      .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't');
  }

  /**
   * Cererea spune pe fata ca priveste TOT ce e pe panza?
   *
   * „scrie MIAU in fiecare" chiar vrea cate un text pe fiecare figura, iar promptul
   * agentilor le cere explicit sa NU tinteasca atunci. Fara semnul asta, regula „un
   * text nou fara tinta nu se multiplica" ar taia exact cererile care cer copierea.
   */
  cereToate(prompt) {
    return /\b(toate|toti|fiecare|amandoua|ambele|tot)\b/.test(App.norm(prompt));
  }

  tintaDinPrompt(prompt) {
    const p = App.norm(prompt);

    // cererea vizeaza explicit tot: nu tintim nimic
    if (this.cereToate(prompt)) return null;

    // Regulile pot numi doar forme pe care catalogul chiar le produce: GOL, GRUP_n,
    // PATRAT, DREPTUNGHI (vezi `derive` din ShapeBST). Domeniul s-a restrans la
    // patrulatere cu unghiuri drepte, iar tiparele ramase in urma — cerc, triunghi,
    // hexagon, stea — nu se potriveau niciodata cu nimic: cod care se citeste ca o
    // capabilitate, dar nu poate tinti nicio figura.
    const REGULI = [
      [/\bdreptunghi/, n => n.includes('DREPTUNGHI')],
      [/\bpatrat/,     n => n.includes('PATRAT')],
    ];

    // se potrivesc doar FIGURI: numerele deduse aici sunt numere de figura, #0, #1
    const figuri = this.figuri();
    const gasite = new Set();
    figuri.forEach((o, poz) => {
      const nume = this.nodeInfo(o.figure).nume;
      for (const [re, potriveste] of REGULI) {
        if (re.test(p) && potriveste(nume)) { gasite.add(poz); break; }
      }
    });

    // nimic sau chiar tot => nu aduce informatie
    if (!gasite.size || gasite.size === figuri.length) return null;
    return [...gasite];
  }

  applyGeom(fig, g, canvas) {
    if (g.op === 'split') return OPS.split(fig, canvas, g.into ?? 2, g.dir);

    // mutare: figura ramane neschimbata ca forma, doar isi schimba locul
    if (g.op === 'move') {
      if (!g.at || !inCanvas(g.at.x, g.at.y)) return fig;
      return OPS.anchorAt(fig, pointPixel(g.at.x, g.at.y), g.anchor || 'center');
    }

    if (g.op === 'resize') {
      const d = this.dimensiuni(g);
      if (d) return OPS.stretch(fig, d.w, d.h).reindex();
      return OPS.resize(fig, Number(g.scale) || 1);
    }

    // rect: singura forma pe care o poate construi motorul. w si h sunt PIXELI.
    const d = this.dimensiuni(g) || { w: 150, h: 150 };
    return OPS.rect(canvas, d.w, d.h);
  }

  /**
   * Construieste figura, o dimensioneaza in CELULE si ii aseaza coltul din
   * stanga jos pe celula ceruta.
   *
   * `at` e un PUNCT de pe grila. Implicit acolo cade CENTRUL figurii; cu `anchor`
   * poti cere sa cada un colt sau mijlocul unei laturi. `size` e latura in celule.
   */
  creeaza(g, at) {
    const fig = this.applyGeom(Figure.empty(), g, CANVAS);
    OPS.anchorAt(fig, pointPixel(at.x, at.y), g.anchor || 'center');
    return fig.reindex();
  }


  /**
   * Pune un obiect pe un punct. Implicit SE SUPRAPUNE peste ce era acolo — mai multe
   * figuri pot porni din acelasi punct de origine, fiecare cu textul si bugetul ei.
   *
   * Inlocuirea se cere explicit, cu `replace: true`, pentru cazul in care chiar vrei
   * sa refaci figura de acolo in loc sa adaugi inca una peste ea.
   */
  plaseaza(g, at) {
    if (g.replace === true) {
      for (const v of this.scena.obiecte.filter(o => o.at.x === at.x && o.at.y === at.y)) {
        this.scena.remove(v.id);
      }
    }
    return this.scena.add(new Obiect(this.creeaza(g, at), at, this.faceStream()));
  }

  /**
   * Text fara figura: obiect de sine statator, cu figura goala.
   *
   * `at` din comanda e in coordonate logice; daca lipseste, textul cade in centrul
   * panzei, ca si prima figura. Legarea devine `point`, singura care nu are nevoie
   * de un contur — restul modurilor se raporteaza la laturi care nu exista.
   *
   * @returns {Obiect|null} null cand comanda n-are ce scrie (de pilda „mareste textul")
   */
  textLiber(t, notes) {
    const areContinut = (Array.isArray(t.set) && t.set.length)
                     || (Array.isArray(t.add) && t.add.length);
    if (!areContinut) {
      notes.push('nu există text pe care să-l schimb — scrie întâi ceva, de exemplu „scrie MIAU"');
      return null;
    }

    // un punct cerut in prompt se respecta; altfel locul il alege asezatorul, mai
    // tarziu, cand se stie cat ocupa textul si ce mai e pe panza
    const cerut = t.at && typeof t.at === 'object' && inCanvas(t.at.x, t.at.y);
    const p = cerut ? { x: t.at.x, y: t.at.y } : { x: panza.w >> 1, y: panza.h >> 1 };

    // Un text nou NU se preselecteaza, ca si o figura noua: selectia e o alegere a
    // omului, prin click, nu un efect secundar al scrierii.
    const o = this.scena.add(new Obiect(Figure.empty(), p, this.faceStream()));
    this.selectie.clear();

    // Fara contur, doar punctul si caseta au sens: restul modurilor se raporteaza
    // la laturi care aici nu exista. Caseta isi duce propriul dreptunghi, deci ramane.
    if (t.bind !== 'box') t.bind = 'point';
    if (cerut) t.at = p; else delete t.at;
    notes.push(cerut
      ? `text fără figură, așezat în (${p.x},${p.y})`
      : 'text nou, obiect separat');
    return o;
  }

  /**
   * Pe ce FIGURA cere textul sa ajunga: „muta textul in mijlocul figurii 0".
   *
   * Textul apartine unei figuri, iar legarile care se raporteaza la un contur —
   * `inside`, `side`, `pieces`, `sides`, `path` — n-au niciun reper cand cuvintele
   * stau pe alt obiect: pe un text de sine statator, sau pe alta figura. Pasul 4d din
   * `aplicaText` le rescria atunci in „point", ancorat unde era deja textul, adica
   * exact acolo de unde s-a cerut sa plece. Comanda nu facea nimic.
   *
   * Raspunsul se citeste din vectorul de centre: „mijlocul figurii 0" e centrul ei de
   * ACUM, cel recalculat dupa ultima scalare, nu cel dinainte.
   *
   * @returns {number|null} numarul figurii cerute, sau null daca cererea nu numeste una
   */
  figuraCeruta(prompt, dsl) {
    const b = dsl.text && dsl.text.bind;
    // Doar legarile care cer un CONTUR ridica intrebarea „a carei figuri?". „mareste
    // textul" n-are legare, deci nu numeste nicio figura si nu se atinge de nimic.
    if (!b || !App.FARA_FIGURA.has(b)) return null;

    const n = this.figuri().length;
    const bun = k => (Number.isInteger(k) && k >= 0 && k < n ? k : null);

    // 1. tinta data de model. „t1" e un TEXT, nu o figura, deci nu trece de Number()
    if (Array.isArray(dsl.target) && dsl.target.length === 1) {
      const k = bun(Number(dsl.target[0]));
      if (k !== null) return k;
    }

    // 2. numarul spus pe fata in cerere. Modelele mici emit des doar legarea si uita
    //    destinatia; potrivirea e determinista, deci se face local, pe gratis.
    const m = App.norm(prompt).match(
      /\b(?:figura|figurii|dreptunghiul|dreptunghiului|patratul|patratului|forma|formei)\s+(\d{1,2})\b/);
    return m ? bun(Number(m[1])) : null;
  }

  /**
   * Muta textul de pe obiectele sursa pe figura destinatie.
   *
   * Textul apartine unei figuri, deci "muta textul de pe figura 2 sub figura 1"
   * inseamna sa-l transferi intre obiecte, nu doar sa schimbi legarea. Fara asta,
   * comanda ar aseza textul in raport cu figura pe care sta deja — figura gresita.
   *
   * @param {{o:Obiect, words:number[]|null}[]} vizate sursele; `words` null = tot
   *        textul obiectului, altfel doar cuvintele textului numit in cerere
   */
  mutaText(vizate, destIdx, t, notes = []) {
    // destinatia e o FIGURA: textul se aseaza fata de conturul ei
    const dest = this.figuri()[destIdx];
    if (!dest) return null;

    const cuvinte = [], legari = [], numere = [];
    for (const { o, words } of vizate) {
      if (o === dest || !o.stream.words.length) continue;
      // cand cererea numeste un text anume, pleaca doar cuvintele lui: celelalte
      // texte ale figurii sursa raman unde erau.
      // Indicii se filtreaza pe lungimea de ACUM: unul in afara ei ar fi impins
      // `undefined` in fluxul destinatiei, iar `String(undefined)` chiar se deseneaza.
      const idx = (words || o.stream.words.map((_, k) => k))
        .filter(k => Number.isInteger(k) && k >= 0 && k < o.stream.words.length);
      if (!idx.length) continue;
      const pleaca = new Set(idx);
      for (const k of idx) {
        cuvinte.push(o.stream.words[k]);
        legari.push(o.binds[k]);
        // textul isi pastreaza numarul cand se muta: T1 ramane T1 pe alta figura
        numere.push(o.texte[k]);
      }
      o.binds = o.binds.filter((_, k) => !pleaca.has(k));
      o.texte = o.texte.filter((_, k) => !pleaca.has(k));
      o.stream.setWords(o.stream.words.filter((_, k) => !pleaca.has(k)));
    }
    // Nimic de transferat NU inseamna nimic de facut. Textul poate fi deja pe figura
    // ceruta, iar cererea sa priveasca doar asezarea lui: „muta textul sub latura de
    // jos a figurii 1", cand textul sta chiar pe #1. Sursa e sarita mai sus fiindca e
    // egala cu destinatia, deci nu se aduna niciun cuvant — dar legarea tot trebuie
    // aplicata. Fara ramura asta comanda nu facea nimic si raporta totusi „text mutat".
    if (!cuvinte.length) {
      if (!dest.stream.words.length) {
        notes.push(`figura #${destIdx} n-are text de mutat`);
        return dest;
      }
      // si aici, un text numit in cerere se reaseaza singur, nu tot ce scrie pe figura
      const peDest = vizate.find(v => v.o === dest);
      const words = peDest && peDest.words ? peDest.words : undefined;
      this.aplicaText(dest, { ...t, set: undefined, add: undefined, words }, notes);
      notes.push(`textul era deja pe figura #${destIdx}, doar reașezat`);
      return dest;
    }

    const start = dest.stream.words.length;
    dest.stream.setWords([...dest.stream.words, ...cuvinte]);
    dest.binds = [...dest.binds, ...legari];
    dest.texte = [...dest.texte, ...numere];
    // legarea ceruta se aplica DOAR pe cuvintele tocmai mutate
    this.aplicaText(dest, { ...t, set: undefined, add: undefined,
                            words: cuvinte.map((_, k) => start + k) }, notes);
    notes.push(`text mutat pe figura #${destIdx}`);
    return dest;
  }

  /**
   * Unde stau ACUM cuvintele obiectului, in pixeli de canvas: centrul gabaritului lor.
   *
   * Se citeste din scena DESENATA, nu din legari: un cuvant poate atarna de un punct,
   * de un colt sau de o latura, iar raspunsul trebuie sa fie acelasi in toate cazurile.
   *
   * @returns {{x:number,y:number}|null} null cand obiectul n-are niciun cuvant desenat
   */
  undeSta(o) {
    const sc = layout(o.figure, o.stream, o.binds, CANVAS);
    if (!sc.words.length) return null;
    const xs = sc.words.map(w => w.x), ys = sc.words.map(w => w.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }

  /**
   * Modul „caseta" pentru comanda curenta.
   *
   * Marimea se ia, in ordine, din: ce cere comanda, caseta care exista deja pe
   * obiect, valoarea implicita. Mostenirea conteaza — fara ea, un al doilea prompt
   * care doar mai baga un cuvant in caseta ar reseta latimea pusa de primul.
   *
   * Ancora se mosteneste la fel, si din acelasi motiv: cuvintele se grupeaza dupa
   * legarea lor, iar o ancora diferita inseamna alt grup, deci ALTA caseta. Fara
   * mostenire, al doilea cuvant isi facea caseta lui, lipita de bbox-ul figurii —
   * iar pe un text fara figura bbox-ul e (0,0), adica in afara panzei.
   *
   * `staDeja` e locul in care textul se desena INAINTE de comanda asta. Caseta e un
   * ambalaj: ea se stange in jurul textului, acolo unde e, nu il muta in alta parte.
   * Fara reperul asta, un text fara figura si fara caseta n-avea nicio ancora, iar
   * `layout` il cadea in centrul PANZEI — caseta aparea in mijloc si tragea textul
   * dupa ea, oriunde ar fi stat el.
   */
  casetaMod(t, o, staDeja) {
    const deja = o.binds.find(b => b && typeof b === 'object' && b.bind === 'box');
    const baza = t.box || deja || CASETA;
    const mod = {
      bind: 'box',
      w: baza.w > 0 ? limCaseta(baza.w) : 0,
      h: baza.h > 0 ? limCaseta(baza.h) : 0,
    };
    // Un punct desprinde caseta de figura. Fara el: caseta care exista deja, apoi
    // locul in care sta textul acum, apoi — pe o figura — mijlocul ei.
    const at = t.at && inCanvas(t.at.x, t.at.y)
      ? pointPixel(t.at.x, t.at.y)
      : (deja && deja.at) || staDeja || null;
    if (at) mod.at = at;
    return mod;
  }

  /**
   * Dreptunghiurile pe care le ocupa textul unui obiect pe panza.
   *
   * Caseta se ia ca atare; un cuvant liber devine dreptunghiul lui, dedus din
   * latimea masurata si din corpul de litera. Sunt intoarse separat, nu unite:
   * doua cuvinte in colturi opuse ar da un dreptunghi cat toata panza, si n-ar mai
   * incapea nimic nicaieri.
   */
  dreptunghiuriText(o) {
    if (!o.stream.words.length) return [];
    const sc = layout(o.figure, o.stream, o.binds, CANVAS);
    const parti = sc.casete.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
    for (const w of sc.words) {
      const lat = o.stream.advance[w.i] || w.text.length * w.size * 0.6;
      parti.push({
        x: w.align === 'right' ? w.x - lat : w.align === 'center' ? w.x - lat / 2 : w.x,
        y: w.baseline === 'bottom' ? w.y - w.size : w.baseline === 'middle' ? w.y - w.size / 2 : w.y,
        w: lat, h: w.size,
      });
    }
    return parti;
  }

  /** Gabaritul unei liste de dreptunghiuri. */
  static gabarit(parti) {
    const x0 = Math.min(...parti.map(r => r.x)), x1 = Math.max(...parti.map(r => r.x + r.w));
    const y0 = Math.min(...parti.map(r => r.y)), y1 = Math.max(...parti.map(r => r.y + r.h));
    return { w: x1 - x0, h: y1 - y0 };
  }

  /**
   * Aseaza cuvintele `grup` ale unui obiect FARA figura, cat mai aproape de centrul
   * panzei, fara sa acopere textele care exista deja.
   *
   * Punctul il alege `Asezator`, local si determinist. Aici se face doar legatura:
   * ce dreptunghiuri sunt ocupate, cat de mare e textul nou, si scrierea punctului
   * inapoi in legari.
   */
  asazaLiber(o, grup, notes) {
    if (!grup.length) return;
    const inGrup = new Set(grup);

    // ce ocupa deja panza: textele celorlalte obiecte, plus cuvintele acestui obiect
    // care NU fac parte din grupul asezat acum
    const sc = layout(o.figure, o.stream, o.binds, CANVAS);
    const ocupate = [
      ...this.scena.obiecte.filter(x => x !== o).flatMap(x => this.dreptunghiuriText(x)),
      // si CONTURURILE desenate: un text fara tinta n-are de ce sa cada peste o figura,
      // cand tocmai faptul ca nu e a niciuneia l-a facut obiect de sine statator
      ...this.scena.obiecte.filter(x => x !== o && !x.figure.isEmpty).map(x => {
        const b = x.figure.bbox();
        return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
      }),
      ...sc.words.filter(w => !inGrup.has(w.i)).map(w => {
        const lat = o.stream.advance[w.i] || w.text.length * w.size * 0.6;
        return { x: w.x - lat / 2, y: w.y - w.size / 2, w: lat, h: w.size };
      }),
    ];

    const p = Asezator.alege(this.marimeGrup(o, grup), ocupate, CANVAS);

    grup.forEach(k => {
      const b = o.binds[k];
      const mod = typeof b === 'string' ? { bind: b } : { ...b };
      if (mod.bind === 'point' || mod.bind === 'box') mod.at = { x: p.x, y: p.y };
      o.binds[k] = mod;
    });
    o.at = toLogic(p.x, p.y);
    if (notes) notes.push(`text nou așezat în (${o.at.x},${o.at.y}), fără suprapunere`);
  }

  /**
   * Cat ocupa grupul de cuvinte care urmeaza sa fie asezat.
   *
   * E o estimare, nu o masuratoare: grupul inca n-are pozitie, deci n-are nici
   * dreptunghi de citit din scena. Caseta isi da latimea exacta; inaltimea si
   * blocurile de cuvinte se socotesc din corpul de litera si din cate randuri ies.
   * Pentru evitarea suprapunerii e destul — o eroare de cateva pixeli se pierde in
   * marginea de respiro a asezatorului.
   */
  marimeGrup(o, grup) {
    const rand = o.stream.fontPx * 1.35;
    const caseta = grup.map(k => o.binds[k])
      .find(b => b && typeof b === 'object' && b.bind === 'box');
    if (caseta) {
      // O axa pe „auto" nu e scrisa nicaieri: se estimeaza din cuvinte, ca in bindBox.
      // Pe latime auto textul sta pe UN rand, deci si inaltimea ceruta e de un rand.
      const lat = caseta.w > 0
        ? caseta.w
        : grup.reduce((a, k) => a + (o.stream.advance[k] || 0), 0)
          + Math.max(0, grup.length - 1) * o.stream.fontPx * 0.32;
      const randuri = caseta.w > 0 ? Math.max(1, grup.length) : 1;
      return { w: Math.max(1, lat), h: caseta.h > 0 ? caseta.h : randuri * rand };
    }
    // legate la punct, cuvintele se stivuiesc pe verticala
    const lat = Math.max(1, ...grup.map(k => o.stream.advance[k] || 0));
    return { w: lat, h: Math.max(1, grup.length) * rand };
  }

  aplicaText(o, t, notes = []) {
    // Unde se desena textul INAINTE de comanda asta. Se citeste acum, cat legarile
    // sunt inca cele vechi: pasii de mai jos le inlocuiesc, iar dupa aceea reperul
    // n-ar mai fi locul de unde a plecat textul, ci cel in care tocmai l-au mutat.
    // Doar pe un obiect fara figura conteaza — acolo nu exista contur de care sa se
    // agate ambalajul cerut acum.
    const staDeja = o.figure.isEmpty && o.stream.words.length ? this.undeSta(o) : null;

    // 1. `set` INLOCUIESTE tot continutul — dar NU si asezarea.
    //    Textul rescris ramane unde era: in caseta lui, pe latura lui, in punctul lui.
    //    Cu legarea resetata la „inside", „rescrie textul ca PISICA" scotea cuvantul
    //    din caseta si il trimitea in (0,0) — bbox-ul unui obiect fara figura.
    //    Cand cererea numeste UN text — „rescrie textul 1" — inlocuirea cade doar pe
    //    cuvintele lui: celelalte texte de pe aceeasi figura raman neatinse.
    let vizate = Array.isArray(t.words) && t.words.length ? t.words.slice() : null;

    if (Array.isArray(t.set)) {
      const vechi = o.binds.slice();
      const vechiT = o.texte.slice();
      const doar = vizate
        ? vizate.filter(k => Number.isInteger(k) && k >= 0 && k < o.stream.words.length)
        : null;

      if (doar && doar.length) {
        // Se scot cuvintele textului tintit si se pun cele noi pe locul lor. Fara asta,
        // `setWords` inlocuia TOT obiectul, deci „rescrie textul 1" stergea si textul 0.
        const scoase = new Set(doar);
        const primul = Math.min(...doar);
        const nr = vechiT[primul] || nextText();
        const legare = vechi[primul] || 'inside';
        const words = [], binds = [], texte = [];
        const puse = [];
        o.stream.words.forEach((w, k) => {
          if (k === primul) {
            for (const nou of t.set) { puse.push(words.length); words.push(nou); binds.push(legare); texte.push(nr); }
          }
          if (scoase.has(k)) return;
          words.push(w); binds.push(vechi[k]); texte.push(vechiT[k]);
        });
        o.stream.setWords(words);
        o.binds = binds;
        o.texte = texte;
        // pozitiile s-au mutat odata cu inlocuirea: comanda priveste de-acum cuvintele noi
        vizate = puse.length ? puse : null;
      } else {
        o.stream.setWords(t.set);
        o.binds = o.stream.words.map((_, k) => vechi[k] || vechi[0] || 'inside');
        // O rescriere nu naste un text nou: T1 rescris ramane T1. Doar cand obiectul
        // n-avea nimic scris pana acum apare un numar nou.
        const pastrat = vechiT.find(Boolean) || nextText();
        o.texte = o.stream.words.map((_, k) => vechiT[k] || pastrat);
      }
    }

    // 2. `add` ADAUGA un text nou, pastrand ce era deja si legarile lui.
    //    Fara asta, al doilea prompt de text muta primul text in loc sa creeze unul nou.
    let noi = null;
    if (Array.isArray(t.add) && t.add.length) {
      const start = o.stream.words.length;
      o.stream.setWords([...o.stream.words, ...t.add]);
      noi = t.add.map((_, k) => start + k);
      // cuvintele adaugate acum sunt UN text, cu numarul lui: T{urmatorul}
      const nr = nextText();
      noi.forEach(k => { o.texte[k] = nr; });
    }

    // Cand cererea mareste caseta, textul creste PROPORTIONAL cu ea (pasul 4c).
    // Daca modelul a cerut si un `scale`, el se ignora: altfel cele doua se inmultesc
    // si „mareste caseta cu 100" ajunge sa umfle litera de doua ori.
    const cereCaseta = t.boxDelta !== undefined && t.boxDelta !== null;
    const casetaCreste = cereCaseta
      && o.binds.some(b => b && typeof b === 'object' && b.bind === 'box');

    // 3. marimea e comuna intregului flux de text al obiectului
    if (Number.isFinite(Number(t.scale)) && !casetaCreste) {
      const k = Math.max(0.4, Math.min(3, Number(t.scale)));
      o.stream.fontPx = Math.max(7, Math.min(56, Math.round(o.stream.fontPx * k)));
      o.stream.remeasure();
    }

    const n = o.stream.words.length;
    if (o.binds.length !== n) {
      o.binds = Array.from({ length: n }, (_, i) => o.binds[i] || 'inside');
    }
    // fiecare cuvant trebuie sa apartina unui text; cele ramase fara numar intra in
    // primul de pe obiect, ca sa nu apara texte fantoma in numerotare
    if (o.texte.length !== n || o.texte.some(s => !s)) {
      const primul = o.texte.find(Boolean) || nextText();
      o.texte = Array.from({ length: n }, (_, i) => o.texte[i] || primul);
    }

    // 4. legarea. Daca tocmai s-a adaugat text, se aplica DOAR pe cuvintele noi —
    //    altfel al doilea prompt ar muta si textul dinainte.
    let idx = null;
    if (t.bind) {
      const mod = t.bind === 'point' && t.at && inCanvas(t.at.x, t.at.y)
                    ? { bind: 'point', at: pointPixel(t.at.x, t.at.y) }
                : t.bind === 'box'
                    ? this.casetaMod(t, o, staDeja)
                : t.bind === 'side' && t.at
                    ? { bind: 'side', at: t.at, in: t.in === true }
                : t.bind === 'corner' && t.at
                    ? { bind: 'corner', at: t.at }
                : t.bind;

      const cerute = vizate ? vizate.filter(k => Number.isInteger(k) && k >= 0 && k < n) : null;
      idx = cerute || noi || o.stream.words.map((_, k) => k);
      idx.forEach(k => { o.binds[k] = mod; });
    }

    // 4b. rotatia calatoreste CU legarea, nu separat: asa se pastreaza per cuvant,
    //     intra in snapshot fara cod nou si se interpoleaza singura la animatie.
    if (Number.isFinite(Number(t.rot))) {
      const grade = ((Math.round(Number(t.rot) / 90) * 90) % 360 + 360) % 360;
      const cerute = vizate ? vizate.filter(k => Number.isInteger(k) && k >= 0 && k < n) : null;
      const grup = cerute || idx || noi || o.stream.words.map((_, k) => k);
      grup.forEach(k => {
        const b0 = o.binds[k];
        const obiect = typeof b0 === 'string' ? { bind: b0 } : { ...b0 };
        if (grade) obiect.rot = grade; else delete obiect.rot;   // 360 = inapoi la initial
        o.binds[k] = obiect;
      });
    }

    // 4c. caseta, marita sau micsorata cu un numar de pixeli.
    //     „cu 20 mai mare" se poate socoti doar aici, unde se stie cat e ACUM —
    //     modelul nu tine minte marimea, si nici n-ar trebui. Legarile se
    //     INLOCUIESC, nu se modifica pe loc: snapshot-urile de undo copiaza lista,
    //     nu si obiectele din ea, deci o mutatie ar rescrie si trecutul.
    if (cereCaseta) {
      const d = t.boxDelta;
      // inaltimea desenata ACUM: baza pentru o crestere pe verticala ceruta explicit,
      // cand caseta era pe „auto" si n-avea nicio inaltime scrisa in legare
      const acum = layout(o.figure, o.stream, o.binds, CANVAS).casete[0];
      const r = schimbaCaseta(o.binds, d, acum || 0);
      o.binds = r.binds;
      if (r.caseta && r.raport !== 1) {
        // Textul creste odata cu ambalajul lui. Singura oprire: cel mai lat cuvant
        // trebuie sa incapa pe un rand — altfel ar iesi din caseta, iar caseta nu
        // taie niciodata textul, deci ar creste ea ca sa-l cuprinda.
        const celMaiLat = Math.max(0, ...o.stream.advance);
        const peLatime = celMaiLat > 0
          ? Math.floor(r.caseta.w * o.stream.fontPx / celMaiLat)
          : Infinity;
        const peInaltime = r.caseta.h > 0 ? Math.floor(r.caseta.h / 1.35) : Infinity;
        const cerut = Math.round(o.stream.fontPx * r.raport);
        o.stream.fontPx = Math.max(7, Math.min(FONT_MAX_CASETA, peLatime, peInaltime, cerut));
        o.stream.remeasure();
      }
      const cerut = typeof d === 'object'
        ? `${d.w >= 0 ? '+' : ''}${d.w}×${d.h >= 0 ? '+' : ''}${d.h}px`
        : `${d > 0 ? '+' : ''}${d}px`;
      notes.push(r.caseta
        ? `caseta ${cerut} → ${r.caseta.w}×${r.caseta.h > 0 ? r.caseta.h : 'auto'}px`
          + `, text ×${r.raport.toFixed(2)}`
        : 'nu există casetă de redimensionat — pune întâi textul într-una, de exemplu „pune textul într-o casetă"');
    }

    // 4d. Text FARA figura: legarile care se raporteaza la laturi n-au la ce se
    //     agata. bbox-ul unui obiect gol e (0,0) — exact coltul din stanga sus al
    //     panzei, si acolo ajungea al doilea text, pe jumatate in afara. Devin bloc
    //     intr-un punct, ancorat acolo unde textul se desena si pana acum.
    // o inlocuire fara legare ceruta priveste tot textul obiectului
    const grupNou = idx || noi
      || (Array.isArray(t.set) && t.set.length ? o.stream.words.map((_, k) => k) : null);
    if (o.figure.isEmpty && grupNou && grupNou.length) {
      // Punctul primeste ANCORA de la bun inceput. Pana acum si-o lua de la asezator,
      // chemat imediat mai jos; cand acela nu mai e chemat — o comanda care schimba
      // doar ambalajul — un punct fara ancora n-ar mai desena nimic.
      const ancora = staDeja || pointPixel(o.at.x, o.at.y);
      grupNou.forEach(k => {
        const b = o.binds[k];
        const nume = typeof b === 'string' ? b : b && b.bind;
        if (App.FARA_FIGURA.has(nume)) o.binds[k] = { bind: 'point', at: ancora };
      });

      // Asezatorul cauta un loc liber doar pentru cuvintele ADUSE de cerere. O comanda
      // care schimba doar ambalajul sau legarea — „pune textul intr-o caseta" — nu e o
      // cerere de mutare: textul ramane unde e, iar caseta se stange in jurul lui.
      // Fara distinctia asta, orice caseta ceruta pe un text existent il teleporta in
      // cea mai goala parte a panzei, cu ambalaj cu tot.
      const aduse = Array.isArray(t.set) && t.set.length
        ? (vizate && vizate.length ? vizate : o.stream.words.map((_, k) => k))
        : noi;
      // un punct cerut explicit in prompt bate asezarea automata
      const locCerut = t.at && typeof t.at === 'object' && inCanvas(t.at.x, t.at.y);
      if (!locCerut && aduse && aduse.length) this.asazaLiber(o, aduse, notes);
    }

    // 5. repetarea acopera tintele, dar numai pentru grupul afectat de comanda
    const modNume = b => (typeof b === 'string' ? b : b && b.bind);
    const grup = idx || noi || o.stream.words.map((_, k) => k);
    const moduri = new Set(grup.map(k => modNume(o.binds[k])));
    if (t.repeat && grup.length) {
      const tinte = moduri.has('pieces') ? o.figure.polylines.filter(pl => pl.segs.length).length
                  : moduri.has('sides')  ? o.figure.visualEdges().length : 0;
      if (tinte > grup.length) {
        const inGrup = new Set(grup);
        const baza = grup.map(k => o.stream.words[k]);
        const bazaB = grup.map(k => o.binds[k]);
        const bazaT = grup.map(k => o.texte[k]);
        const restW = o.stream.words.filter((_, k) => !inGrup.has(k));
        const restB = o.binds.filter((_, k) => !inGrup.has(k));
        const restT = o.texte.filter((_, k) => !inGrup.has(k));
        o.stream.setWords([...restW, ...Array.from({ length: tinte }, (_, k) => baza[k % baza.length])]);
        o.binds = [...restB, ...Array.from({ length: tinte }, (_, k) => bazaB[k % bazaB.length])];
        // copiile raman ale ACELUIASI text: „MIAU pe fiecare latura" e un text, nu patru
        o.texte = [...restT, ...Array.from({ length: tinte }, (_, k) => bazaT[k % bazaT.length])];
      }
    }
  }

  /**
   * Scena urmeaza panza: regula de trei simpla, pe fiecare axa.
   *
   * O figura de 50x50 pe o panza de 350x200 ocupa a saptea parte din latime si a
   * patra din inaltime. Dupa trecerea la 700x700 ocupa tot atat — deci 100x175.
   * Scalarea e pe AXE, nu uniforma: „direct proportional cu noile dimensiuni"
   * inseamna ca fiecare axa o urmeaza pe a ei. Cand se schimba raportul panzei, un
   * patrat devine dreptunghi, iar catalogul il si renumeste — exact ce trebuie sa faca.
   *
   * In pixeli de canvas transformarea e chiar inmultirea cu (kx, ky) fata de origine;
   * pozitia LOGICA iese proportionala de la sine, fiindca ky = H_nou/H_vechi.
   *
   * Ce se scaleaza, si de ce:
   *   figura     varfurile, prin `scaleXY` — nu lungimile, altfel se strica unghiurile
   *   punctele   de care atarna textul liber si caseta, in pixeli de canvas
   *   caseta     latimea cu kx, inaltimea cu ky, ca orice dreptunghi
   *   litera     cu MEDIA GEOMETRICA, sqrt(kx*ky): corpul are o singura marime, deci
   *              nu poate urma doua cresteri diferite. Acelasi raport ca la casete.
   *   o.at       punctul logic de asezare, ca pozitia raportata sa ramana adevarata
   *
   * SCHIMBA INTENTIONAT Sum(len), ca `resize` si `stretch`. De aici incolo, noul total
   * e cel conservat.
   */
  scaleazaToate(kx, ky, notes) {
    if (Math.abs(kx - 1) < 1e-9 && Math.abs(ky - 1) < 1e-9) return 0;
    const kf = Math.sqrt(kx * ky);

    for (const o of this.scena.obiecte) {
      if (!o.figure.isEmpty) o.figure = OPS.scaleXY(o.figure, kx, ky).reindex();

      // Legarile se INLOCUIESC, nu se modifica pe loc: `snapshot` copiaza lista, nu
      // si obiectele din ea, deci o mutatie ar rescrie si starea salvata pentru undo.
      o.binds = o.binds.map(b => {
        if (!b || typeof b !== 'object') return b;
        const m = { ...b };
        if (m.at && typeof m.at === 'object') m.at = { x: m.at.x * kx, y: m.at.y * ky };
        if (m.bind === 'box') {
          // zero inseamna „cat cere textul": axa aia se strange singura, cu litera
          if (m.w > 0) m.w = limCaseta(m.w * kx);
          if (m.h > 0) m.h = limCaseta(m.h * ky);
        }
        return m;
      });

      if (Math.abs(kf - 1) > 1e-9) {
        o.stream.fontPx = Math.max(1, o.stream.fontPx * kf);
        o.stream.remeasure();
      }
      o.at = { x: Math.round(o.at.x * kx), y: Math.round(o.at.y * ky) };
    }

    if (notes) {
      notes.push(`scena scalată ×${kx.toFixed(2)} pe lățime, ×${ky.toFixed(2)} pe înălțime`);
    }
    return this.scena.length;
  }

  /**
   * Aduce inauntru tot ce a ramas in afara panzei — pasul de dupa schimbarea gabaritului.
   *
   * Figura isi da gabaritul ei; un text liber n-are contur, deci gabaritul lui sunt
   * chiar dreptunghiurile cuvintelor. Amandoua se muta la fel: o TRANSLATIE in pixeli
   * de canvas, care nu atinge nicio lungime — Sum(len) al fiecarui obiect ramane
   * neatins, ca la orice mutare.
   *
   * Ce e mai mare decat panza nu se muta: acolo se ocupa „scale-shape" din
   * LayoutEngine, care il micsoreaza la desenare fara sa-i strice datele.
   *
   * `pad` e respiroul cerut de marginea panzei. Dupa o scalare proportionala se cere
   * ZERO, dinadins: o figura care atingea marginea o atinge si dupa, corect, iar un
   * respiro adaugat atunci ar strica exact proportia tocmai calculata. Pe o panza de
   * 100px inaltime, 6px inseamna 6%.
   */
  restrangeToate(notes, pad = CANVAS.pad) {
    const cadru = { w: CANVAS.w, h: CANVAS.h, pad };
    let mutate = 0, mari = 0;
    for (const o of this.scena.obiecte) {
      const b = o.figure.isEmpty
        ? App.gabaritCanvas(this.dreptunghiuriText(o))
        : o.figure.bbox();
      if (!b) continue;

      // Mai mare decat panza: translatia n-are ce rezolva, oricat ar muta. Se spune,
      // si atat — „scale-shape" o deseneaza intreaga, micsorata, fara sa-i strice
      // datele. A o micsora aici ar schimba Sum(len) la o cerere care n-a cerut asta.
      if (b.maxX - b.minX > cadru.w - 2 * pad || b.maxY - b.minY > cadru.h - 2 * pad) mari++;

      const { dx, dy } = restrange(b, cadru);
      if (!dx && !dy) continue;
      Scene.mutaCanvas(o, dx, dy);
      // pozitia raportata e LOGICA, iar pe canvas y creste in jos: de aceea se scade
      o.at = { x: Math.round(o.at.x + dx), y: Math.round(o.at.y - dy) };
      mutate++;
    }
    if (notes && mutate) {
      notes.push(mutate > 1 ? mutate + ' obiecte aduse în pânză' : 'un obiect adus în pânză');
    }
    if (notes && mari) {
      notes.push(mari > 1
        ? mari + ' figuri mai mari decât pânza: rămân întregi, se desenează micșorate'
        : 'o figură e mai mare decât pânza: rămâne întreagă, se desenează micșorată');
    }
    return mutate;
  }

  /** Gabaritul unei liste de dreptunghiuri de canvas. Null cand lista e goala. */
  static gabaritCanvas(parti) {
    if (!parti.length) return null;
    return {
      minX: Math.min(...parti.map(r => r.x)), maxX: Math.max(...parti.map(r => r.x + r.w)),
      minY: Math.min(...parti.map(r => r.y)), maxY: Math.max(...parti.map(r => r.y + r.h)),
    };
  }

  /** Geometria: creare pe coordonate, sau transformare simultana a selectiei. */
  aplicaGeom(g, notes, target) {
    // PANZA insasi, nu figurile de pe ea: se schimba gabaritul zonei de desen.
    // Originea (0,0) sta in stanga jos, deci micsorarea taie spatiul de SUS si din
    // DREAPTA. Obiectele isi pastreaza coordonatele logice — are grija „setPanza" —
    // iar ce ramane in afara e adus inauntru aici, local si determinist.
    if (g.op === 'canvas_resize') {
      const d = this.dimensiuni(g);
      if (!d) {
        notes.push('lipsește dimensiunea pânzei — scrie cât de mare, de exemplu „400x300”');
        return false;
      }
      const vechi = { w: CANVAS.w, h: CANVAS.h };
      const nou = this.scena.setPanza(d.w, d.h);
      // elementul de desen NU se redimensioneaza aici: intra in scena si se animeaza
      notes.push(`pânza ${vechi.w}×${vechi.h} → ${nou.w}×${nou.h}px`);
      if (nou.w !== d.w || nou.h !== d.h) {
        notes.push(`cerut ${d.w}×${d.h}, plafonat la ${PANZA_MIN}..${CANVAS_PX}px pe latură`);
      }
      // Scena urmeaza panza, proportional. Restrangerea ramane doar ca plasa — si
      // fara respiro, ca sa nu strice proportia tocmai calculata.
      this.scaleazaToate(nou.kx, nou.ky, notes);
      this.restrangeToate(notes, 0);
      return true;
    }

    if (g.op === 'clear') {
      this.scena.clear(); this.selectie.clear();
      notes.push('scena golită');
      return true;
    }

    // `move` foloseste tot coordonate, dar pe obiecte EXISTENTE: nu creeaza nimic
    const cerute = g.op === 'move' ? []
                 : Array.isArray(g.cells) ? g.cells : (g.at ? [g.at] : []);
    const celule = cerute.filter(c => inCanvas(c.x, c.y));

    // Un punct cerut, dar in afara panzei. Validatorul de pe server tine coordonatele
    // in 0..800 — el nu stie cat e panza ACUM — deci pe una micsorata poate ajunge aici
    // un (400,400) care nu mai exista. Fara oprirea asta, cererea cadea mai jos si
    // „fa un patrat la 400,400" ajungea sa RESCRIE figurile selectate, in loc sa creeze
    // una noua: pare ca s-a intamplat altceva, fara sa spuna nimeni de ce.
    if (cerute.length && !celule.length) {
      notes.push(`punctul cerut e în afara pânzei de ${CANVAS.w}×${CANVAS.h}px`);
      return false;
    }

    // O figura noua are nevoie de dimensiune explicita. Nu inventam una implicita:
    // mai bine refuzam si cerem marimea decat sa desenam altceva decat s-a cerut.
    const creeazaNou = celule.length > 0 || !this.tinte(target).length;
    if (creeazaNou && !this.dimensiuni(g)) {
      notes.push('lipsește dimensiunea — scrie cât de mare, în pixeli, de exemplu „150x100”');
      return false;
    }

    if (celule.length) {
      // O figura noua NU se preselecteaza: dupa creare, pe panza nu e nimic selectat.
      // Selectia e o alegere a omului, prin click — nu un efect secundar al desenarii.
      this.selectie.clear();
      for (const c of celule) this.plaseaza(g, c);
      const d = this.dimensiuni(g);
      const dim = `${d.w}x${d.h}px`;
      // dimensiunile sunt in PIXELI: "1x1" e un punct, nu o celula. Semnalam, nu blocam.
      if (d.w < 8 || d.h < 8) {
        notes.push(`⚠ ${d.w}×${d.h}px e cât un punct — dimensiunile sunt în pixeli, o celulă are ${CELL}px`);
      }
      const supra = celule.filter(c => this.scena.obiecte.some(o => o.at.x === c.x && o.at.y === c.y)).length;
      if (supra && g.replace !== true) notes.push(`${supra} suprapuse peste figuri existente`);
      notes.push(`${celule.length} obiect${celule.length > 1 ? 'e' : ''} de ${dim} celule, ${g.anchor || 'centru'} la: `
                 + celule.map(c => `(${c.x},${c.y})`).join(' '));
      return true;
    }

    const t = this.tinte(target);
    if (!t.length) {
      const at = { x: panza.w >> 1, y: panza.h >> 1 };
      this.plaseaza(g, at);           // nici prima figura nu se preselecteaza
      notes.push(`primul obiect, plasat în centru (${at.x},${at.y})`);
      return true;
    }

    for (const o of t) {
      if (g.op === 'move') {
        // aici scopul E schimbarea locului, deci nu readucem figura unde era
        o.figure = this.applyGeom(o.figure, g, CANVAS).reindex();
        if (g.at) o.at = { x: g.at.x, y: g.at.y };
      } else {
        const centru = o.figure.centroid();
        o.figure = OPS.moveTo(this.applyGeom(o.figure, g, CANVAS), centru).reindex();
      }
    }
    notes.push(`aplicat simultan pe ${t.length} obiect${t.length > 1 ? 'e' : ''}`);
    if (g.op === 'move') notes.push(`mutat la (${g.at ? g.at.x + ',' + g.at.y : '?'}) prin ${g.anchor || 'centru'}`);
    if (g.op === 'resize') notes.push(
      g.w ? `redimensionat la ${g.w}x${g.h}px` : `scalat cu ${g.scale}×`);
    return true;
  }

  /**
   * @param {string} prompt
   * @param {'panza'|'figuri'} [doar] din ce caseta de comanda vine cererea
   */
  async run(prompt, doar = null) {
    if (!prompt.trim()) return;
    const cutie = App.caseta(doar);

    // Cererea scrisa in caseta gresita nu se trimite DELOC: se spune local, gratis,
    // unde ii e locul, iar textul ramane scris in caseta, ca sa poata fi mutat.
    //
    // In amandoua sensurile. Fara refuzul din dreapta, „micsoreaza canvasul la 250 pe
    // 100" ajungea o micsorare a FIGURILOR, cu 0.5. Fara cel din stanga, „fa un patrat
    // de 200" facea o PANZA de 200x200 — caseta aia citeste orice cifra ca gabarit.
    // Amandoua sunt exact confuzia pe care cele doua casete o elimina.
    const gresita = doar === 'figuri' ? cerePanza(prompt)
                  : doar === 'panza' ? cereObiecte(prompt)
                  : false;
    if (gresita) {
      $('dsl').innerHTML = '<span class="bad">⚠ ' + (doar === 'figuri'
        ? 'gabaritul pânzei se cere în caseta din stânga'
        : 'caseta pânzei schimbă doar gabaritul — figurile și textul se cer în dreapta')
        + '</span>';
      $('resolved').textContent = 'nimic nu s-a trimis spre model';
      return;
    }

    $(cutie.camp).value = '';      // comanda a fost preluata, caseta se goleste
    const p = this.payload();

    $('dsl').innerHTML = '<span class="dim">se întreabă modelul…</span>';
    $(cutie.buton).disabled = true;
    let dsl;
    try { dsl = await parseRemote(prompt, p, doar); }
    finally { $(cutie.buton).disabled = false; }

    $('srcBadge').textContent = dsl._src || '—';
    $('srcBadge').className = 'badge ' + (dsl._live ? 'live' : 'fallback');

    if (dsl.error) {
      // Cand modelul n-a raspuns, cererea a fost citita de rezerva locala, care stie
      // mult mai putin. Fara precizarea asta pare ca promptul e de vina, si omul il
      // rescrie degeaba: adevarata cauza e ca modelul n-a fost intrebat.
      const cauza = dsl._live === false && dsl._why
        ? `<span class="dim"> — modelul n-a răspuns (${dsl._why}), a citit rezerva locală</span>`
        : '';
      $('dsl').innerHTML = `<span class="bad">⚠ ${dsl.error}</span>${cauza}`;
      $('resolved').textContent = dsl._why ? 'model indisponibil: ' + dsl._why : '';
      return;
    }

    // Fiecare caseta isi are domeniul ei, iar izolarea NU se sprijina pe rugaminti in
    // prompt: ce nu tine de caseta in care s-a scris nu se aplica, punct. E aceeasi
    // regula ca la agenti — geometrul nu are cod care sa citeasca text, nu doar
    // instructiunea sa n-o faca. Se spune insa pe fata ce s-a ignorat, ca sa nu para
    // ca nu s-a intamplat nimic.
    const eDePanza = dsl.geom && dsl.geom.op === 'canvas_resize';
    const strain = doar === 'panza' ? (dsl.geom && !eDePanza) || Boolean(dsl.text)
                 : doar === 'figuri' ? eDePanza
                 : false;
    if (strain) {
      const unde = doar === 'panza'
        ? 'caseta pânzei schimbă doar gabaritul ei — figurile și textul se cer în dreapta'
        : 'gabaritul pânzei se cere în caseta din stânga';
      $('dsl').innerHTML = `<span class="bad">⚠ ${unde}</span>`;
      $('resolved').textContent = 'ignorat: ' + JSON.stringify({ geom: dsl.geom, text: dsl.text });
      return;
    }

    this.history.push(this.scena.snapshot());
    const notes = [];

    // Modelul alege inconsecvent intre inlocuire si adaugare. Daca obiectele vizate
    // au deja text si cererea NU cere explicit inlocuirea, transformam `set` in `add`:
    // mai bine doua texte pe panza decat unul sters fara sa fi fost cerut.
    if (dsl.text && Array.isArray(dsl.text.set) && dsl.text.set.length && !dsl.text.add) {
      const cere = cereInlocuire(prompt);
      const auText = this.tinte(dsl.target).some(o => o.stream.words.length);
      if (auText && !cere) {
        dsl.text = { ...dsl.text, add: dsl.text.set };
        delete dsl.text.set;
        notes.push('text adăugat lângă cel existent, nu peste el');
      } else if (auText) {
        notes.push('text înlocuit, nu adăugat');
      }
    }

    // daca modelul n-a numit tinta, o deducem local din textul cererii
    if (!Array.isArray(dsl.target) || !dsl.target.length) {
      const local = this.tintaDinPrompt(prompt);
      if (local) {
        dsl.target = local;
        notes.push(`țintă dedusă local: ${local.join(', ')}`);
      }
    }

    // Obiectele de dinainte, retinute ca REFERINTE: asa stim exact care s-au nascut in
    // turul asta, fara sa ne bazam pe faptul ca o figura noua ramane selectata.
    const inainte = this.scena.obiecte.slice();
    if (dsl.geom) {
      const facut = this.aplicaGeom(dsl.geom, notes, dsl.target);

      // Verificarea de cadru, dupa ORICE operatie de geometrie: creare pe margine,
      // marire, mutare sau taiere. Pana acum o figura putea ramane pe jumatate in
      // afara imaginii — „un patrat de 200 la 750,750" iesea cu 50px peste marginea
      // de sus si de dreapta — si nimic n-o aducea inapoi pana la urmatoarea
      // redimensionare a panzei.
      //
      // Redimensionarea panzei si-a facut deja restrangerea, cu alt respiro (zero),
      // ca sa nu strice proportia calculata acolo. Aici respiroul obisnuit e bun.
      if (facut && dsl.geom.op !== 'canvas_resize') this.restrangeToate(notes);

      // Dupa ORICE operatie de geometrie — scalare, taiere, mutare, redimensionarea
      // panzei — centrele s-au mutat. Vectorul se reface ACUM, nu la urmatoarea
      // citire: partea de text a aceluiasi tur trebuie sa tinteasca unde a ajuns
      // figura, nu unde era inainte de operatie.
      this.actualizeazaCentre();
    }
    const create = this.scena.obiecte.filter(o => !inainte.includes(o));

    if (dsl.text) {
      // Figura numita in cerere, cand legarea are nevoie de un contur. Se sare peste
      // cand turul tocmai a creat o figura: acolo decide regula de mai jos, textul e
      // al figurii noi.
      if (!create.length && !Number.isInteger(dsl.text.to)) {
        const nr = this.figuraCeruta(prompt, dsl);
        if (nr !== null) {
          const aduce = (Array.isArray(dsl.text.set) && dsl.text.set.length)
                     || (Array.isArray(dsl.text.add) && dsl.text.add.length);
          if (aduce) {
            // cuvinte NOI: figura numita e tinta pe care se scrie
            dsl.target = [nr];
            notes.push(`text scris pe figura #${nr}`);
          } else {
            // Text care exista deja: figura numita e DESTINATIA transferului, iar
            // sursele redevin cele implicite. Fara golirea tintei, `mutaText` ar cauta
            // cuvintele chiar pe figura destinatie — sarita fiindca e egala cu ea
            // insasi — si n-ar transfera nimic.
            const c = this.figuri()[nr].centru;
            dsl.text = { ...dsl.text, to: nr };
            dsl.target = null;
            notes.push(`destinație dedusă local: figura #${nr}, centrul @${c.x},${c.y}`);
          }
        }
      }

      // Cand aceeasi cerere creeaza o figura SI scrie in ea, tinta numita de agentul
      // de text priveste numerotarea de DINAINTE de creare: figura noua inca nu exista
      // cand a raspuns el. Textul apartine figurii tocmai create.
      //
      // Legatura mergea prin selectie, cat timp o figura noua se selecta automat. Acum
      // nu se mai preselecteaza nimic, deci figura tocmai creata se numeste pe fata.
      const fortate = create.length && !Number.isInteger(dsl.text.to) ? create : null;
      if (fortate) {
        if (Array.isArray(dsl.target) && dsl.target.length) {
          notes.push('textul merge pe figura nou creată, nu pe ținta dinainte');
        }
        dsl.target = null;
      }

      let t = fortate || this.tinte(dsl.target);
      if (Number.isInteger(dsl.text.to)) {
        // nota o pune `mutaText`: doar el stie daca s-a transferat ceva sau doar s-a reasezat
        const vizate = this.tinteText(dsl.target, dsl.text.words);
        const dest = this.mutaText(vizate, dsl.text.to, dsl.text, notes);
        if (!dest) notes.push('destinație inexistentă');
        t = vizate.map(v => v.o);
      } else {
        // Textul apartine unei figuri, dar pe panza goala nu e nici una de care sa
        // se agate. Atunci textul devine el insusi obiect: figura goala, legare la
        // punct absolut. Altfel comanda „scrie MIAU" pe scena goala nu facea nimic
        // si nici nu spunea de ce.
        //
        // Si un text NOU peste text liber care exista deja face tot un obiect nou,
        // nu inca un cuvant la cel vechi. Altfel toate cuvintele scrise pe rand se
        // adunau pe acelasi obiect, iar „pune textul intr-o caseta" — care priveste
        // TOT obiectul — le baga pe toate intr-una singura. Un prompt, un text.
        // Cuvinte NOI aduse de cerere: „add" le aduce mereu, „set" doar cand n-are ce
        // rescrie — „rescrie textul ca PISICA" schimba textul care exista deja.
        const adauga = Array.isArray(dsl.text.add) && dsl.text.add.length > 0;
        const cuvinteNoi = adauga
          || (Array.isArray(dsl.text.set) && dsl.text.set.length > 0
              && !t.some(o => o.stream.words.length));

        // Fara tinta numita si fara selectie, comanda cade pe TOATE obiectele. La un
        // text NOU asta insemna acelasi cuvant copiat in mijlocul fiecarei figuri,
        // cand cererea ceruse UN text. Pe care figura sa cada nu se ghiceste: textul
        // devine obiect propriu, cu numarul lui — T0, T1 — asezat de Asezator.
        //
        // Acelasi lucru cand tinta implicita ARE deja text: cererea a cerut UN text,
        // nu inca un rand la cel de acolo. Fara regula asta, pe o panza cu o singura
        // figura scrisa, al doilea „scrie …" se aseza in acelasi bloc, sub primul —
        // adica exact peste textul care exista deja.
        //
        // Exceptia e cererea care spune pe fata „in fiecare", „pe toate": acolo
        // copierea chiar s-a cerut, iar promptul agentilor le cere sa NU tinteasca.
        const faraTinta = !(Array.isArray(dsl.target) && dsl.target.length) && !this.selectie.size;
        const doarLibere = t.length > 0 && t.every(o => o.figure.isEmpty);
        const areDejaText = t.length > 0 && t.every(o => o.stream.words.length);
        const singur = cuvinteNoi && (doarLibere
          || (faraTinta && !this.cereToate(prompt) && (t.length > 1 || areDejaText)));

        if (!t.length || singur) {
          if (singur && !doarLibere) {
            notes.push(areDejaText && t.length === 1
              ? 'text nou, separat — nu se scrie peste cel existent; numește figura sau dă click pe ea ca să-l adaugi acolo'
              : 'un singur text, nu câte unul în fiecare figură — numește figura sau dă click pe ea');
          }
          const cerere = adauga && singur
            ? { ...dsl.text, set: dsl.text.add, add: undefined }
            : dsl.text;
          const nou = this.textLiber(cerere, notes);
          if (nou) { t = [nou]; dsl.text = cerere; }
          for (const o of t) this.aplicaText(o, dsl.text, notes);
        } else {
          // Cand cererea numeste un TEXT anume — „mareste textul 1" — comanda cade doar
          // pe cuvintele lui, nu pe tot ce scrie pe obiectul care il gazduieste.
          const vizate = fortate
            ? fortate.map(o => ({ o, words: null }))
            : this.tinteText(dsl.target, dsl.text.words);
          for (const { o, words } of vizate) {
            this.aplicaText(o, words ? { ...dsl.text, words } : dsl.text, notes);
          }
          t = vizate.map(v => v.o);
        }
      }
      notes.push(`text pe ${t.length} obiect${t.length > 1 ? 'e' : ''}` + (Array.isArray(dsl.target) && dsl.target.length ? ` (țintit: ${dsl.target.join(', ')})` : ''));
    }

    this.draw();

    const shown = { geom: dsl.geom, text: dsl.text };
    if (dsl.why) shown.why = dsl.why;
    $('dsl').textContent = JSON.stringify(shown);
    if (dsl._why && !dsl._live) notes.push('model indisponibil, s-a folosit parserul local');
    $('resolved').textContent = notes.join(' · ');

    const ok = this.scena.obiecte.every(o => o.figure.totalLength() > 0);
    $('invCheck').innerHTML = ok
      ? '<span class="ok">fiecare obiect își păstrează Σ len</span>'
      : '<span class="bad">un obiect a rămas fără lungime</span>';

    this.inspect();
    this.meter(prompt, shown, dsl._usage);
    // un tur din memorie sau citit de rezerva locala n-a costat niciun token
    this.convoMeter(prompt, JSON.stringify(shown), dsl._usage, dsl._memorat === true || dsl._live !== true);
  }

  // ---------------------------------------------------------------- contabilitate

  /**
   * Contabilitatea pe conversatie.
   *
   * Un tur poate sa nu coste NIMIC: raspunsul a venit din memorie, sau modelul n-a
   * fost intrebat si a citit rezerva locala. Amandoua raporteaza `usage` zero, si
   * asta e adevarul — nu o valoare lipsa.
   *
   * Inainte, `real?.in || estimare` trata zero ca lipsa si punea in loc o estimare
   * pornita de la o constanta. Un tur care costase zero aparea cu ~490 de tokeni, iar
   * unul real cu ~1100: aceeasi comanda, doua cifre care nu se puteau compara. Cifra
   * mica nu era o economie, era o inventie.
   *
   * @param {{in:number,out:number}|undefined} real usage-ul chiar masurat; lipseste
   *        doar cand n-a existat niciun apel
   * @param {boolean} gratis turul n-a costat nimic (memorie sau rezerva locala)
   */
  convoMeter(prompt, dslStr, real, gratis) {
    const est = t => Math.ceil((t || '').length / 4);
    const masurat = Boolean(real) && !gratis;
    const inTok = masurat ? real.in : (gratis ? 0 : (this.convo.sys || 400) + est(prompt));
    const outTok = masurat ? real.out : (gratis ? 0 : est(dslStr));
    if (masurat && real.in && !this.convo.sys) this.convo.sys = real.in - est(prompt);

    const c = this.convo;
    c.turns++; c.inTot += inTok; c.outTot += outTok;
    c.hist.push(est(prompt) + outTok);

    const sys = c.sys || 400;
    const cuIstoric = sys * c.turns + c.hist.reduce((a, v, i) => a + v * (c.hist.length - i), 0);
    const flat = c.inTot + c.outTot;

    // Spunem si DE UNDE vine cifra. Fara asta, un zero pare o defectiune si o estimare
    // pare o masuratoare — exact confuzia care facea doua tururi identice sa arate diferit.
    const sursa = gratis ? '<span class="dim"> · 0 real, din memorie sau rezervă</span>'
                : masurat ? ''
                : '<span class="dim"> · estimat, modelul n-a fost întrebat</span>';

    $('convoTurns').textContent = c.turns;
    $('convoNow').innerHTML = (inTok + outTok) + sursa;
    $('convoTotal').textContent = flat;
    $('convoHist').innerHTML = flat
      ? `${cuIstoric} <span class="dim">(${(cuIstoric / flat).toFixed(1)}× mai mult)</span>`
      : '<span class="dim">—</span>';
  }

  meter(prompt, dsl, real) {
    const p = this.payload();
    const summary = p.noduri.map(n => `${n.nume} ${n.cod} @${n.at.x},${n.at.y}`).join('; ') || 'scenă goală';
    const c = compare({ prompt, skeleton: this.skeleton, flat: this.flat, summary, dsl,
                        scene: this.scene, canvas: CANVAS });
    if (real && (real.in || real.out)) c.tree = { in: real.in, out: real.out, label: 'Noduri + scenă · REAL' };

    const base = c.tree.in + c.tree.out;
    $('tokenBody').innerHTML = ['tree', 'flat', 'vision'].map(k => {
      const r = c[k], tot = r.in + r.out;
      return `<tr class="${k === 'tree' ? 'win' : ''}"><td>${r.label}</td><td>${r.in}</td>` +
             `<td>${r.out}</td><td><b>${tot}</b></td><td>${k === 'tree' ? '1×' : (tot / base).toFixed(1) + '×'}</td></tr>`;
    }).join('');
    $('dslOut').textContent = c.payloads.dsl;
    $('coordsOut').textContent = c.payloads.fullCoords;
  }
}
