// PanouCont.js — panoul de cont din aplicatie: salvare, lista de panze, iesire.
//
// Autentificarea NU se face aici. Ea are pagina ei, `index.html`, si pana nu trece pe
// acolo nimeni nu ajunge in `app.html`. Panoul asta presupune deci ca omul e cunoscut,
// si se ocupa doar de ce urmeaza: cum isi salveaza si isi aduce inapoi pânzele.
//
// E singurul modul din `src/cont/` care stie ca exista un DOM al APLICATIEI. `Cont.js`
// raspunde la „cine esti", `Panze.js` duce si aduce, `Autentificare.js` tine poarta.
// Aceeasi impartire ca in restul proiectului: `App` orchestreaza si nu calculeaza,
// `CanvasRenderer` deseneaza si nu socoteste.
//
// Nu stie nimic despre figuri, texte sau DSL. Primeste doua functii — una care ii da
// scena ca date, alta care i-o pune la loc — si atat. Ce e inauntrul acelui obiect e
// treaba lui `Scene.toJSON`.

import * as Panze from './Panze.js';

const $ = id => document.getElementById(id);

/** Cat de lung poate fi numele unei panze. Acelasi plafon e si pe server. */
const NUME_MAX = 60;

export class PanouCont {
  /**
   * @param {import('./Cont.js').Cont|null} cont contul deja autentificat, sau null
   *        cand conturile nu sunt configurate pe server
   * @param {{stare: () => object, incarca: (date:object) => number}} carlige
   *        `stare` da scena ca date pure; `incarca` o pune inapoi si intoarce cate
   *        obiecte au ajuns pe pânză.
   */
  constructor(cont, carlige) {
    this.cont = cont;
    this.carlige = carlige;
    this.panza = $('cont');
    // Fara conturi pe server, sau fara panou in pagina, modulul tace si dispare.
    if (!cont || !this.panza) return;

    this.panza.hidden = false;
    $('contStare').textContent = cont.nume;
    this.leaga();

    // Iesirea — de aici, expirata, sau din alt tab — cere acelasi lucru: curatat pe
    // TOATE originile, si inapoi la poarta. Cu un simplu salt la poarta, ea si-ar gasi
    // sesiunea ei neatinsa si ar trimite inapoi incoace, la nesfarsit.
    this.cont.laSchimbare(s => { if (!s) this.cont.iesi(); });

    // Pânza ceruta din pagina de alegere. Vine ca id in interogare, nu ca desen: se
    // aduce de la server, cu jetonul, deci un continut intreg nu trece prin bara de
    // adresa si nu se poate schimba pe drum.
    const id = new URLSearchParams(location.search).get('panza');
    if (id) this.cu(() => this.deschide(id));
  }

  leaga() {
    $('contSalveaza').onclick = () => this.cu(() => this.salveaza());
    $('contIesi').onclick = () => this.cu(() => this.cont.iesi());
    $('contNume').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('contSalveaza').click();
    });

    // Butonul catre lista exista doar daca pagina de alegere chiar ruleaza. Intr-o
    // instalare cu doua containere din trei, serverul n-o anunta, si un buton care duce
    // intr-un port mort e mai rau decat un buton lipsa.
    const port = this.cont.porturi.panze;
    if (port) $('contPanze').onclick = () => this.cont.mergiLa(port);
    else $('contPanze').hidden = true;
  }

  /** Pânza ceruta la deschidere, adusa si pusa pe ecran. */
  async deschide(id) {
    const r = await Panze.adu(await this.cont.jeton(), id);
    const n = this.carlige.incarca(r.continut);
    $('contNume').value = r.nume;      // urmatorul „Salvează" rescrie exact pânza deschisa
    this.spune(n === 1 ? 'opened: ' + r.nume + ' · one object'
                       : 'opened: ' + r.nume + ' · ' + n + ' objects');
  }

  /**
   * Rularea unei actiuni care poate pica, cu butoanele stinse cat timp tine.
   *
   * Toate actiunile panoului sunt cereri de retea, deci toate pot pica si toate pot
   * dura. Fara stingere, o dubla apasare pe „Salvează" trimite doua cereri; fara
   * `catch`, o retea moarta ar da o eroare in consola si niciun semn pe ecran.
   */
  async cu(actiune) {
    this.ocupat(true);
    try {
      await actiune();
    } catch (e) {
      this.spune(String((e && e.message) || e), true);
    } finally {
      this.ocupat(false);
    }
  }

  ocupat(da) {
    for (const id of ['contSalveaza', 'contIesi']) $(id).disabled = da;
  }

  spune(text, rea = false) {
    const m = $('contMesaj');
    m.textContent = text;
    m.className = 'note' + (rea ? ' bad' : '');
  }

  /**
   * Salveaza scena sub numele din camp.
   *
   * Lista NU se mai reimprospateaza aici: ea traieste pe pagina de alegere, pe alt
   * port. Panoul asta a ramas cu o singura treaba — sa scrie ce e pe ecran.
   */
  async salveaza() {
    const nume = String($('contNume').value || '').trim().slice(0, NUME_MAX) || 'untitled';
    const r = await Panze.salveaza(await this.cont.jeton(), nume, this.carlige.stare());
    this.spune('saved: ' + r.nume);
  }
}
