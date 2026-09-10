// Cont.js — identitatea, in browser. Cine esti, si dovada pe care o poti arata.
//
// Supabase e folosit STRICT ca furnizor de identitate: el tine parolele, el emite si
// reimprospateaza jeton-ul (JWT). Nimic din aplicatie nu vorbeste cu baza de date de
// aici — pentru asta e `Panze.js`, si el trece tot prin propriul nostru server. Aici
// se raspunde la o singura intrebare: „ce jeton am acum, daca am vreunul".
//
// De ce CDN si nu npm: `src/` se serveste ca ES modules, direct, fara pas de build.
// Regula asta e ce tine `index.html` sa functioneze cu un `python -m http.server` si
// ce face ca o schimbare in `src/` sa se vada la reincarcarea paginii. O dependenta
// locala in browser ar cere un bundler, adica exact pasul pe care proiectul nu-l are.
//
// Modulul de pe CDN se aduce LENES, prin `import()`, si numai dupa ce serverul a spus
// ca sunt conturi configurate. Cine ruleaza proiectul fara Supabase nu plateste nicio
// cerere de retea si nu vede nicio eroare in consola.

import { verificaInregistrare } from './Validare.js';

/**
 * De unde vine clientul, si de ce e fixata versiunea MAJORA.
 *
 * `@supabase/supabase-js@2` inseamna „ultimul 2.x", la fel ca `^2` din package.json:
 * browserul si serverul raman pe acelasi dialect fara sa fie nevoie sa se schimbe doua
 * cifre deodata. Fara `@2`, jsDelivr ar servi ultima versiune oricare ar fi ea, iar o
 * majora noua ar schimba API-ul sub picioarele paginii, in productie, fara commit.
 */
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/**
 * Ce spune serverul: adresa proiectului, cheia publica si PORTURILE celor trei pagini.
 *
 * Porturile vin de la server chiar si cand conturile sunt oprite — paginile tot trebuie
 * sa stie unde se duc una la alta, iar o cifra scrisa cu mana aici ar ramane in urma la
 * prima schimbare de `PORT_*` din `.env`.
 */
export async function configServer() {
  try {
    return await (await fetch('/api/config')).json();
  } catch {
    return { activ: false, porturi: {} };   // serverul nu raspunde: aplicatia merge oricum
  }
}

/**
 * Sesiunea, scrisa in fragmentul unui URL.
 *
 * FRAGMENT, nu interogare: partea de dupa „#" nu se trimite niciodata catre server, deci
 * nu ajunge in loguri, nu apare in `Referer` si nu ramane in istoricul serverului. E
 * exact locul in care Supabase insusi pune jetoanele la intoarcerea dintr-un login
 * OAuth. Pagina care il primeste il si sterge, pe loc.
 */
const CHEIE_ACCES = 'at', CHEIE_REIMPROSPATARE = 'rt';

/**
 * Semnalul de IESIRE, purtat tot prin fragment.
 *
 * `signOut()` goleste `localStorage`-ul UNEI SINGURE origini — a paginii pe care rulează.
 * Cu trei porturi sunt trei `localStorage`-uri, si fiecare isi tine sesiunea lui de cand
 * i-a fost predata. Iesirea de pe 8082 lasa deci poarta, pe 8080, cu sesiunea ei
 * neatinsa: ea o vede, te trimite inapoi la 8082, iar 8082 te trimite iar la poarta. Un
 * du-te-vino fara sfarsit, si exact asta se intampla inainte de lantul de mai jos.
 *
 * Acum iesirea trece pe la fiecare origine si o curata, terminand la poarta. Valoarea
 * cheii e lista porturilor RAMASE de curatat; goala inseamna „aici se opreste".
 */
const CHEIE_IESIRE = 'iesire';

/**
 * Drumul de curatare: toate originile in afara de cea de acum, cu POARTA ultima.
 *
 * Poarta la urma fiindca acolo se si opreste omul. Daca ar fi prima, ea s-ar curata,
 * apoi ar trimite mai departe spre celelalte, si s-ar intoarce la sfarsit intr-o pagina
 * de autentificare peste care tocmai trecuse.
 *
 * Functie exportata si pura — primeste harta si portul de acum — ca sa se poata verifica
 * in teste. Un lant gresit nu se vede decat ca un du-te-vino in browser, adica exact
 * felul de defect care merita prins altundeva decat cu ochiul.
 */
export function lantIesire(porturi, portCurent) {
  const acum = Number(portCurent);
  return ['panza', 'panze', 'poarta']
    .map(r => Number((porturi || {})[r]))
    .filter(p => p && p !== acum);
}

export class Cont {
  /**
   * Contul, sau `null` cand conturile nu sunt configurate.
   *
   * Nu arunca niciodata: lipsa Supabase nu e o eroare, e o configuratie. Aceeasi
   * socoteala ca la modele — fara cheie, aplicatia cade pe parserul local si merge
   * mai departe; fara Supabase, deseneaza si nu salveaza.
   *
   * Se INTOARCE cu sesiunea deja citita. Conteaza pentru amandoua paginile: poarta
   * trebuie sa stie pe loc daca sa arate formularul sau sa redirecteze, iar aplicatia
   * trebuie sa stie inainte sa deseneze ceva. Cu raspunsul lasat pe seama lui
   * `onAuthStateChange`, care vine peste cateva cadre, cine era logat apuca sa vada
   * formularul, si cine nu era apuca sa vada pânza.
   */
  static async creeaza() {
    const cfg = await configServer();
    if (!cfg || !cfg.url || !cfg.anonKey) return null;
    let createClient;
    try {
      ({ createClient } = await import(CDN));
    } catch {
      return null;                     // CDN blocat sau offline: tot fara cont, tot fara eroare
    }
    const cont = new Cont(createClient(cfg.url, cfg.anonKey));
    cont.porturi = cfg.porturi || {};

    // IESIREA se citeste prima. E un semnal mai tare decat orice sesiune pastrata aici:
    // spune ca undeva s-a apasat „Ieși", si ca origina asta trebuie golita chiar daca
    // ea inca isi tine sesiunea. Fara ordinea asta, poarta si-ar gasi sesiunea veche,
    // ar crede ca esti logat si te-ar trimite inapoi de unde tocmai ai iesit.
    if (await cont.preiaIesire()) return cont;

    // Apoi sesiunea predata de pagina de dinainte, daca a fost una; abia apoi cea
    // pastrata aici. Ordinea conteaza: o predare proaspata bate o sesiune veche.
    await cont.preiaDinURL();
    await cont.reia();
    return cont;
  }

  /** Sesiunea pastrata in browser, citita acum. Clientul o reimprospateaza singur. */
  async reia() {
    const { data } = await this.client.auth.getSession();
    this.sesiune = (data && data.session) || null;
    return this.sesiune;
  }

  /**
   * Sesiunea de aici mai e VALIDA pe server?
   *
   * `getSession()` doar citeste depozitul local: intoarce ce gaseste scris, chiar daca
   * jetonul a fost intre timp revocat — iesirea de pe alta origine face exact asta.
   * `getUser()` intreaba serverul, deci raspunde la alta intrebare.
   *
   * De ce conteaza: poarta preda sesiunea mai departe, in fragment. Cu una moarta,
   * pagina urmatoare n-o poate folosi, se vede nelogata si trimite inapoi la poarta —
   * care isi gaseste iar aceeasi sesiune moarta scrisa local. Asta era bucla dintre
   * 8080 si 8082. Verificarea o taie la radacina: ce nu mai e bun se sterge aici, si
   * omul vede formularul in loc sa fie plimbat.
   *
   * Costa un dus-intors, o singura data, la incarcarea portii. Nu se cheama in aplicatie.
   */
  async verifica() {
    if (!this.sesiune) return false;
    try {
      const { data, error } = await this.client.auth.getUser();
      if (!error && data && data.user) return true;
    } catch { /* retea moarta: tot ca nevalida o tratam */ }
    try { await this.client.auth.signOut({ scope: 'local' }); } catch { /* gol oricum */ }
    this.sesiune = null;
    return false;
  }

  /**
   * Sesiunea predata de pagina de pe alt port, daca e vreuna in fragment.
   *
   * Fara pasul asta, cele trei pagini n-ar avea cum sa se recunoasca intre ele:
   * `localStorage` e izolat pe origine, iar portul face parte din origine. Cine intra
   * pe 8080 si e trimis la 8081 ar ajunge acolo nelogat, si tot asa la infinit.
   *
   * Fragmentul se sterge IMEDIAT, cu `replaceState`: nu ramane in bara de adresa, nu
   * se copiaza din greseala si nu intra in istoricul „inapoi".
   */
  async preiaDinURL() {
    const brut = String(location.hash || '').replace(/^#/, '');
    if (!brut) return null;
    const p = new URLSearchParams(brut);
    const acces = p.get(CHEIE_ACCES), reimprospatare = p.get(CHEIE_REIMPROSPATARE);
    if (!acces || !reimprospatare) return null;

    history.replaceState(null, '', location.pathname + location.search);
    try {
      const { data, error } = await this.client.auth.setSession({
        access_token: acces, refresh_token: reimprospatare,
      });
      if (error) return null;          // jeton expirat pe drum: se cade la poarta, curat
      this.sesiune = (data && data.session) || null;
      return this.sesiune;
    } catch {
      return null;
    }
  }

  /**
   * Adresa altei pagini, cu sesiunea de acum lipita in fragment.
   *
   * @param {number} port portul paginii catre care se pleaca
   * @param {string} [cale] calea si interogarea, ex. „/?panza=<id>"
   */
  async legatura(port, cale = '/') {
    const baza = location.protocol + '//' + location.hostname + ':' + port + cale;
    const { data } = await this.client.auth.getSession();
    const s = data && data.session;
    if (!s) return baza;
    return baza + '#' + new URLSearchParams({
      [CHEIE_ACCES]: s.access_token,
      [CHEIE_REIMPROSPATARE]: s.refresh_token,
    });
  }

  /**
   * Du-te la pagina de pe portul asta, ducand sesiunea cu tine.
   *
   * Un port lipsa nu e o eroare, e o instalare cu mai putine containere: nu se
   * navigheaza nicaieri, si se spune apelantului, ca sa hotarasca el. Fara verificarea
   * asta ar iesi o adresa „http://localhost:undefined/".
   *
   * @returns {Promise<boolean>} daca s-a plecat efectiv
   */
  async mergiLa(port, cale = '/') {
    if (!port) return false;
    location.replace(await this.legatura(port, cale));
    return true;
  }

  constructor(client) {
    this.client = client;
    this.sesiune = null;
    /** Porturile celor trei pagini, asa cum le stie serverul. */
    this.porturi = {};
    /** Plecam deja spre poarta? Tine iesirea sa nu porneasca de doua ori deodata. */
    this._pleaca = false;
    this._asculta = [];
    // `onAuthStateChange` se declanseaza si la pornire, cu sesiunea gasita in browser,
    // deci reincarcarea paginii nu cere o noua autentificare: jetonul a fost pastrat
    // si reimprospatat de client.
    this.client.auth.onAuthStateChange((_, sesiune) => {
      this.sesiune = sesiune || null;
      for (const fn of this._asculta) fn(this.sesiune);
    });
  }

  /** Cine e chemat cand sesiunea se schimba — intrare, iesire, expirare. */
  laSchimbare(fn) { this._asculta.push(fn); return this; }

  get autentificat() { return Boolean(this.sesiune); }
  get email() { return (this.sesiune && this.sesiune.user && this.sesiune.user.email) || ''; }

  /**
   * Numele de afisare: cel ales la inregistrare, altfel adresa de email.
   *
   * Rezerva pe email nu e de forma. Conturile facute inainte ca formularul sa ceara un
   * nume n-au niciunul in `user_metadata`, si trebuie sa arate ceva, nu „undefined".
   */
  get nume() {
    const u = this.sesiune && this.sesiune.user;
    return (u && u.user_metadata && u.user_metadata.username) || this.email;
  }

  /**
   * Jetonul de acum, sau sirul gol.
   *
   * Se cere clientului la FIECARE apel, nu se tine minte: un jeton are viata scurta, iar
   * `getSession` il reimprospateaza singur cand e cazul. Cu unul copiat intr-un camp,
   * prima salvare de dupa expirare ar pica cu „sesiune invalida" desi omul e logat.
   */
  async jeton() {
    const { data } = await this.client.auth.getSession();
    return (data && data.session && data.session.access_token) || '';
  }

  /**
   * Intrarea in cont. Erorile Supabase vin in `error`, nu ca exceptie — le ridicam
   * noi, ca apelantul sa aiba un singur fel de esec de tratat.
   */
  async intra(email, parola) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password: parola });
    if (error) throw new Error(error.message);
    return data.session;
  }

  /**
   * Cont nou: email, nume de utilizator si parola.
   *
   * Regulile se verifica AICI, nu doar in formular. Formularul le arata in timp ce omul
   * scrie — asta e treaba lui — dar daca ar fi singurul loc in care sunt, orice alt
   * apelant al metodei asteia le-ar ocoli fara sa-si dea seama.
   *
   * Numele pleaca in `user_metadata`, nu intr-un tabel al nostru. E un nume de AFISARE:
   * intrarea in cont se face tot pe email, fiindca aia e cheia pe care o stie Supabase.
   * Cu tabel separat s-ar putea impune si unicitatea lui, dar ar cere inca un pas de
   * configurare in dashboard pentru ceva ce deocamdata doar se scrie pe ecran.
   *
   * Cand proiectul cere confirmare pe email, Supabase intoarce un utilizator FARA
   * sesiune: contul exista, dar nu e inca folosibil. Diferenta se spune pe fata, altfel
   * omul apasa „Salvează" si nu intelege de ce i se cere iar sa intre.
   */
  async inregistreaza(email, parola, nume) {
    const v = verificaInregistrare({ email, nume, parola });
    if (!v.bun) throw new Error(v.motiv);

    const { data, error } = await this.client.auth.signUp({
      email: String(email).trim(),
      password: parola,
      options: { data: { username: String(nume).trim() } },
    });
    if (error) throw new Error(error.message);
    return { sesiune: data.session, cereConfirmare: !data.session };
  }

  /**
   * Iesirea din cont, pe TOATE originile.
   *
   * `signOut()` face doua lucruri: revoca jetoanele pe server (o data, global) si
   * goleste `localStorage`-ul originii de aici. Al doilea e cel care nu se poate face
   * decat pe rand: fiecare port e alta origine, cu alt `localStorage`. De aceea pagina
   * pleaca apoi pe la celelalte, cu semnalul de iesire in fragment, si se opreste la
   * poarta.
   *
   * Se cheama si cand sesiunea dispare fara sa fi apasat nimeni „Ieși" — a expirat, sau
   * s-a iesit din alt tab. E acelasi lucru de facut: curatat peste tot, si inapoi la
   * poarta.
   */
  async iesi() {
    if (this._pleaca) return;     // deja plecam; a doua chemare n-are ce adauga
    this._pleaca = true;
    try {
      await this.client.auth.signOut();
    } catch { /* jeton deja revocat: tot de curatat ramane */ }
    this.sesiune = null;
    return this.spreIesire(lantIesire(this.porturi, location.port));
  }

  /**
   * Semnalul de iesire lasat de pagina de dinainte, daca e unul.
   *
   * @returns {boolean} true daca pagina asta a fost curatata — atunci apelantul nu mai
   *          are ce citi din `localStorage`, si nici de ce sa se uite dupa o predare.
   */
  async preiaIesire() {
    const p = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    if (!p.has(CHEIE_IESIRE)) return false;

    history.replaceState(null, '', location.pathname + location.search);
    this._pleaca = true;          // ce urmeaza e tot plecare: nimeni sa nu porneasca alta
    try {
      // „local": revocarea pe server s-a facut deja, la prima pagina. Aici a mai ramas
      // doar golirea depozitului, iar o cerere globala cu un jeton deja revocat ar da o
      // eroare care n-ar insemna nimic.
      await this.client.auth.signOut({ scope: 'local' });
    } catch { /* depozitul se goleste oricum mai jos */ }
    this.sesiune = null;

    const ramase = String(p.get(CHEIE_IESIRE) || '').split(',').map(Number).filter(Boolean);
    if (ramase.length) this.spreIesire(ramase);
    else this._pleaca = false;    // aici se opreste drumul: pagina asta chiar ramane
    return true;
  }

  /**
   * Mai departe pe lantul de curatare; ce ramane de facut calatoreste in fragment.
   * @returns {boolean} daca s-a plecat efectiv de pe pagina asta
   */
  spreIesire([urmator, ...ramase]) {
    if (!urmator) return false;   // nimic de curatat altundeva: ramanem unde suntem
    const baza = location.protocol + '//' + location.hostname + ':' + urmator + '/';
    location.replace(baza + '#' + new URLSearchParams({ [CHEIE_IESIRE]: ramase.join(',') }));
    return true;
  }
}
