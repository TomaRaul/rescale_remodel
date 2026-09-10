// PanouPanze.js — pagina de mijloc: care pânză se deschide, sau una noua.
//
// Sta intre poarta si aplicatie, pe portul ei. Nu deseneaza nimic si nu stie ce e o
// figura: cere lista de la propriul server, si trimite mai departe catre pânză, cu
// id-ul ales in interogare.
//
// De ce e o pagina si nu un panou in aplicatie: fiindca alegerea se face INAINTE sa
// existe o pânză. Cat timp lista statea langa desen, „deschide alta" insemna sa arunci
// peste ce era pe ecran, si nu se vedea de nicaieri cu ce ai inceput.
//
// Sesiunea vine in fragmentul adresei, de la poarta, si pleaca la fel mai departe:
// cele trei pagini sunt pe porturi diferite, deci pe ORIGINI diferite, iar
// `localStorage` nu trece dintr-una in alta. Vezi `Cont.legatura`.

import { Cont } from './Cont.js';
import * as Panze from './Panze.js';

const $ = id => document.getElementById(id);

export class PanouPanze {
  constructor() {
    this.cont = null;
    this.porneste();
  }

  async porneste() {
    this.cont = await Cont.creeaza();

    // Fara conturi, pagina asta n-are ce lista si n-ar trebui sa fie deschisa deloc:
    // se trece direct in pânză.
    if (!this.cont) return this.sari('panza');

    // Fara sesiune, inapoi la poarta — dar pe drumul de CURATARE, nu printr-un salt
    // simplu. Un salt simplu lasa poarta cu sesiunea ei scrisa local: ea o vede, crede
    // ca esti logat, si te trimite inapoi incoace. Asta era bucla dintre 8080 si 8082.
    if (!this.cont.autentificat) return this.cont.iesi();

    document.body.hidden = false;
    // Numele ales la inregistrare; pentru conturile mai vechi, adresa de email.
    $('cine').textContent = this.cont.nume;
    this.leaga();
    // Sesiunea disparuta — apasat „Ieși", expirata, sau inchisa din alt tab — cere
    // acelasi lucru: curatat pe TOATE originile, si inapoi la poarta. `iesi` stie
    // drumul si se apara singur de o a doua chemare, deci nu se bat intre ele.
    this.cont.laSchimbare(s => { if (!s) this.cont.iesi(); });
    this.cu(() => this.reimprospateaza());
  }

  /** Du-te la pagina de pe alt port. Fara sesiune de dus, mergem pe adresa goala. */
  sari(rol, cale = '/') {
    const port = (this.cont && this.cont.porturi[rol]) || '';
    if (this.cont) return this.cont.mergiLa(port, cale);
    location.replace(location.protocol + '//' + location.hostname + ':' + port + cale);
  }

  leaga() {
    $('noua').onclick = () => this.sari('panza');
    $('iesi').onclick = () => this.cu(() => this.cont.iesi());
  }

  /** O actiune de retea, cu butoanele stinse cat tine si cu esecul spus pe ecran. */
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

  ocupat(da) { $('noua').disabled = da; $('iesi').disabled = da; }

  spune(text, rea = false) {
    const m = $('mesaj');
    m.textContent = text;
    m.className = 'note' + (rea ? ' bad' : '');
  }

  async reimprospateaza() {
    const panze = await Panze.lista(await this.cont.jeton());
    const lista = $('lista');
    lista.textContent = '';
    if (!panze.length) {
      const gol = document.createElement('span');
      gol.className = 'dim';
      gol.textContent = 'No saved canvases yet. Start a new one.';
      lista.append(gol);
      return;
    }
    for (const p of panze) lista.append(this.rand(p));
  }

  /**
   * Un rand din lista.
   *
   * Construit din noduri, cu `textContent`, nu dintr-un sir lipit in `innerHTML`:
   * numele vine din baza de date, adica din afara, si un nume care contine `<script>`
   * n-are voie sa devina cod fiindca a trecut printr-o pagina.
   */
  rand(p) {
    const rand = document.createElement('div');
    rand.className = 'panza';

    const nume = document.createElement('b');
    nume.textContent = p.nume;
    nume.title = 'open "' + p.nume + '"';
    // Id-ul pleaca in interogare, nu continutul: pânza si-l cere singura, cu jetonul
    // ei, de la server. Asa nu trece un desen intreg printr-o bara de adresa.
    nume.onclick = () => this.sari('panza', '/?panza=' + encodeURIComponent(p.id));

    const cand = document.createElement('span');
    cand.textContent = new Date(p.created_at).toLocaleDateString('en-GB');

    const sterge = document.createElement('button');
    sterge.textContent = '×';
    sterge.title = 'delete "' + p.nume + '"';
    sterge.onclick = () => this.cu(async () => {
      await Panze.sterge(await this.cont.jeton(), p.id);
      this.spune('deleted: ' + p.nume);
      await this.reimprospateaza();
    });

    rand.append(nume, cand, sterge);
    return rand;
  }
}
