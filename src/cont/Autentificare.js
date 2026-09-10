// Autentificare.js — poarta. Singurul lucru care se poate face la `/` fara cont.
//
// Pagina de autentificare e SEPARATA de aplicatie, nu un panou deasupra ei. Diferenta
// nu e de estetica: cat timp formularul statea in aceeasi pagina cu pânza, marcajul
// aplicatiei exista deja in DOM, iar „nu poti intra fara cont" era o afirmatie despre
// ce se vede, nu despre ce s-a incarcat. Asa, `app.html` nici nu porneste fara sesiune.
//
// Trei drumuri pleaca de aici, si toate se hotarasc INAINTE sa se vada ceva:
//   sesiune gasita       -> direct in aplicatie; formularul nu clipeste niciodata
//   conturi neconfigurate-> aplicatia merge oricum, doar ca nu salveaza
//   nimic                -> formularul
//
// Ce NU face fisierul asta: nu stie ce e o figura, un text sau un DSL. Poarta si
// aplicatia nu impart nimic in afara de `Cont.js`.

import { Cont, configServer } from './Cont.js';
import { verificaEmail, verificaParola, verificaInregistrare } from './Validare.js';

const $ = id => document.getElementById(id);

/**
 * Cate plecari la rand mai suporta poarta inainte sa se opreasca si sa spuna ceva.
 *
 * Trei, nu una: o plecare e normala, doua se pot intampla la o predare de sesiune care
 * s-a intors o data. A patra inseamna ca ceva nu se intelege, si atunci mai bine un
 * mesaj decat un tab care clipeste.
 */
const SARITURI_MAX = 3;
const CHEIE_SARITURI = 'smartware:sarituri';

export class Autentificare {
  constructor() {
    this.cont = null;
    /** Formularul e in modul „cont nou"? Altfel, „intrare". */
    this.contNou = false;
    this.porneste();
  }

  async porneste() {
    this.cont = await Cont.creeaza();

    // Fara conturi pe server nu e nimic de pazit: se spune pe fata si se lasa trecerea,
    // direct in pânză — pagina de alegere n-ar avea ce lista, fiindca nu se salveaza
    // nicaieri. Un proiect care nu porneste fara baza de date ar fi altceva decat a fost.
    if (!this.cont) {
      const cfg = await configServer();
      const port = (cfg.porturi && cfg.porturi.panza) || location.port;
      $('oricum').onclick = () => {
        location.href = location.protocol + '//' + location.hostname + ':' + port + '/';
      };
      return this.arata('fara');
    }

    // `Cont.creeaza` a citit deja sesiunea pastrata, deci raspunsul e gata acum, nu
    // peste doua cadre: cine era logat nu apuca sa vada formularul.
    //
    // Dar „scrisa local" nu inseamna „inca valida". `verifica` intreaba serverul, si
    // sterge ce a fost intre timp revocat. Fara pasul asta, poarta preda o sesiune
    // moarta, pagina urmatoare n-o poate folosi si trimite inapoi incoace — unde
    // sesiunea moarta e tot acolo. Asta era bucla dintre 8080 si 8082.
    if (this.cont.autentificat && await this.cont.verifica()) return this.mergiMaiDeparte();

    // Drumul s-a oprit aici: formularul chiar se vede, deci nu mai e nicio bucla.
    this.uitaSariturile();
    this.arata('formular');
    this.leaga();
    // Sesiunea poate veni si din alta parte — alt tab care tocmai s-a autentificat.
    this.cont.laSchimbare(s => { if (s) this.mergiMaiDeparte(); });
  }

  /**
   * Dupa autentificare se merge la ALEGEREA pânzei, nu direct in pânză.
   *
   * Sesiunea calatoreste in fragmentul adresei: pagina de acolo e pe alt port, deci pe
   * alta origine, si n-ar gasi nimic in `localStorage`-ul ei.
   *
   * Cand pagina de alegere nu e pornita — o instalare cu doua containere din trei —
   * serverul n-o anunta deloc in `/api/config`, si se merge direct in pânză. Mai bine o
   * treapta sarita decat un port care nu raspunde si un ecran de eroare al browserului.
   */
  mergiMaiDeparte() {
    // Oprirea dura. Verificarea de mai sus taie cauza cunoscuta a buclei, dar orice
    // nepotrivire viitoare intre ce crede poarta si ce poate folosi pagina urmatoare ar
    // da tot un du-te-vino — iar un du-te-vino nu se poate opri din interiorul lui.
    // Contorul sta in `sessionStorage`: e al TABULUI si al originii asteia, deci nu
    // strica nimic altcuiva si dispare cand se inchide tabul.
    if (this.saritura() > SARITURI_MAX) return this.mAmBlocat();

    const p = this.cont.porturi;
    return this.cont.mergiLa(p.panze || p.panza);
  }

  /** A cata oara la rand pleaca poarta mai departe, fara sa se fi oprit intre timp. */
  saritura() {
    try {
      const n = Number(sessionStorage.getItem(CHEIE_SARITURI) || 0) + 1;
      sessionStorage.setItem(CHEIE_SARITURI, String(n));
      return n;
    } catch {
      return 1;            // depozit blocat (fereastra privata): fara contor, dar fara eroare
    }
  }

  /** Contorul se sterge cand drumul chiar s-a oprit aici — adica nu mai e nicio bucla. */
  uitaSariturile() {
    try { sessionStorage.removeItem(CHEIE_SARITURI); } catch { /* n-are ce sterge */ }
  }

  /**
   * S-a plimbat prea mult: ne oprim si spunem de ce.
   *
   * Sesiunea se sterge local, ca reincarcarea sa porneasca dintr-un loc curat. Un mesaj
   * pe ecran e mai bun decat un tab care clipeste la nesfarsit si o consola pe care n-o
   * deschide nimeni.
   */
  async mAmBlocat() {
    this.uitaSariturile();
    try { await this.cont.client.auth.signOut({ scope: 'local' }); } catch { /* gol */ }
    this.arata('formular');
    this.leaga();
    this.spune('Your previous session is no longer valid. Sign in again.', 'bad');
  }

  /** Care dintre cele trei panouri se vede. Restul dispar. */
  arata(care) {
    for (const id of ['asteapta', 'formular', 'fara']) $(id).hidden = id !== care;
  }

  leaga() {
    $('trimite').onclick = () => this.cu(() => (this.contNou ? this.creeaza() : this.intra()));

    $('schimba').onclick = e => { e.preventDefault(); this.mod(!this.contNou); };

    for (const camp of ['email', 'nume', 'parola']) {
      $(camp).addEventListener('keydown', e => { if (e.key === 'Enter') $('trimite').click(); });
    }
    // Regulile se reevalueaza la fiecare tasta, dar numai in modul „cont nou":
    // la intrare, parola e cea de dinainte si n-are rost judecata dupa reguli de acum.
    $('parola').addEventListener('input', () => { if (this.contNou) this.arataReguli(); });

    this.mod(false);
  }

  /**
   * Comuta intre „intrare" si „cont nou".
   *
   * Un singur formular cu doua infatisari, nu doua formulare: campurile comune —
   * email, parola — isi pastreaza ce s-a scris in ele, deci cine a gresit butonul nu
   * rescrie tot.
   */
  mod(contNou) {
    this.contNou = contNou;
    $('campNume').hidden = !contNou;
    $('reguli').hidden = !contNou;
    $('trimite').textContent = contNou ? 'Create account' : 'Sign in';
    $('intrebare').textContent = contNou ? 'Already have an account?' : 'No account?';
    $('schimba').textContent = contNou ? 'Sign in' : 'Create one';
    $('parola').autocomplete = contNou ? 'new-password' : 'current-password';
    $('sub').textContent = contNou
      ? 'The account holds your canvases. The email address is what you sign in with later.'
      : 'Canvas drawing driven by natural language. Canvases are saved to your account, '
        + 'so you sign in before you draw.';
    this.spune('');
    if (contNou) this.arataReguli();
    $(contNou ? 'email' : 'email').focus();
  }

  /** Bifele de sub campul de parola, refacute la fiecare tasta. */
  arataReguli() {
    const { reguli } = verificaParola(this.parola());
    const ul = $('reguli');
    ul.textContent = '';
    for (const r of reguli) {
      const li = document.createElement('li');
      li.textContent = r.text;
      if (r.indeplinita) li.className = 'da';
      ul.append(li);
    }
  }

  async intra() {
    // La INTRARE nu se valideaza forma parolei: o parola veche, facuta pe alte reguli,
    // trebuie sa mai poata fi folosita. Regulile privesc parolele NOI.
    const e = verificaEmail(this.email());
    if (!e.bun) throw new Error(e.motiv);
    await this.cont.intra(this.email(), this.parola());
    // Nu se redirecteaza de aici: `laSchimbare` o face oricum, pe acelasi drum
    // pe care intra si o sesiune venita din alt tab. Un singur loc, o singura cale.
    this.spune('signing in…', 'ok');
  }

  async creeaza() {
    // `Cont.inregistreaza` verifica si el, si aia e verificarea care conteaza. Aici se
    // cheama doar ca mesajul sa apara fara sa mai plece o cerere pe retea degeaba.
    const v = verificaInregistrare({ email: this.email(), nume: this.nume(), parola: this.parola() });
    if (!v.bun) throw new Error(v.motiv);

    const r = await this.cont.inregistreaza(this.email(), this.parola(), this.nume());
    // Cu confirmarea pe email pornita, contul exista dar sesiunea nu. Fara mesajul
    // asta, omul apasa „Intră" si nu intelege de ce i se spune ca datele-s gresite.
    this.spune(r.cereConfirmare
      ? 'Account created. Confirm the address from the email you received, then sign in.'
      : 'signing in…', 'ok');
  }

  email() { return String($('email').value || '').trim(); }
  nume() { return String($('nume').value || '').trim(); }
  parola() { return String($('parola').value || ''); }

  /** O actiune de retea, cu butoanele stinse cat tine si cu esecul spus pe ecran. */
  async cu(actiune) {
    this.ocupat(true);
    try {
      await actiune();
    } catch (e) {
      this.spune(String((e && e.message) || e), 'bad');
      this.ocupat(false);           // la esec se poate reincerca; la reusita, plecam
      return;
    }
    // La reusita butoanele raman stinse: urmeaza redirectarea, si o a doua apasare
    // in fereastra aceea n-ar face decat sa trimita inca o cerere degeaba.
  }

  ocupat(da) { $('trimite').disabled = da; }

  spune(text, fel = '') {
    const m = $('mesaj');
    m.textContent = text;
    m.className = 'note' + (fel ? ' ' + fel : '');
  }
}
