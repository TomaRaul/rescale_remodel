// Asezator.js — agentul care alege UNDE cade un text nou.
//
// Are un singur skill: dat un dreptunghi de asezat si dreptunghiurile deja ocupate,
// intoarce punctul din CEA MAI GOALA parte a panzei in care noul text incape fara
// sa atinga nimic.
//
// E un agent LOCAL, ca routerul: zero tokeni, zero asteptare. Regula proiectului e
// ca geometria nu costa niciodata — pozitiile, dimensiunile si asezarea se calculeaza
// determinist, aici. Un model intrebat „unde sa pun textul" ar trebui sa primeasca in
// prompt toate dreptunghiurile de pe panza, ar da alt raspuns la fiecare rulare, si
// tot n-ar putea garanta ca doua texte nu se suprapun. Cautarea de mai jos garanteaza.

export class Asezator {
  /** Rezolutia cautarii, in pixeli. Mai mic = asezare mai stransa, mai multi candidati. */
  static PAS = 10;

  /** Spatiul minim dintre doua texte, ca sa nu para lipite. */
  static MARGINE = 10;

  /** Se ating doua dreptunghiuri, tinand cont de marginea de respiro? */
  static seAting(a, b, margine = Asezator.MARGINE) {
    return a.x < b.x + b.w + margine
        && a.x + a.w + margine > b.x
        && a.y < b.y + b.h + margine
        && a.y + a.h + margine > b.y;
  }

  /** Dreptunghiul de latime `w` si inaltime `h` cu CENTRUL in `p`. */
  static cadru(p, w, h) {
    return { x: p.x - w / 2, y: p.y - h / 2, w, h };
  }

  /** Distanta dintre doua dreptunghiuri. Zero cand se ating sau se suprapun. */
  static distanta(a, b) {
    const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
    const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
    return Math.hypot(dx, dy);
  }

  /**
   * Cat de gol e locul: distanta pana la cel mai apropiat vecin.
   *
   * Vecin e si MARGINEA panzei, nu doar celelalte texte. Fara peretii astia, „cel mai
   * gol loc" era mereu un colt — acolo esti cel mai departe de ce e desenat — si textul
   * iesea lipit de rama, la 2px de ea. Cu ei in socoteala, cel mai gol loc chiar e cel
   * mai gol: la fel de departe de textul dinainte pe cat e de rama.
   */
  static respiro(cadru, ocupate, panza) {
    let min = panza
      ? Math.min(cadru.x, cadru.y,
                 panza.w - (cadru.x + cadru.w), panza.h - (cadru.y + cadru.h))
      : Infinity;
    for (const o of ocupate) {
      const d = Asezator.distanta(cadru, o);
      if (d < min) min = d;
    }
    return min;
  }

  /**
   * Punctul in care textul nou incape liber, cat mai DEPARTE de ce e deja scris.
   *
   * Pe o panza goala textul cade fix in mijloc: primul text n-are de la ce sa fuga.
   * De la al doilea incolo intrebarea nu mai e „unde incape cel mai aproape", ci
   * „unde e cel mai gol". Se cauta pe o grila de pas `PAS` si se pastreaza candidatul
   * liber cu cel mai mare respiro — distanta pana la cel mai apropiat vecin, fie el
   * un alt text, fie marginea panzei.
   *
   * Varianta dinainte pastra candidatul liber cel mai APROPIAT de centru, iar
   * `MARGINE` era tot ce despartea doua texte: la un corp de 17px ieseau 14px de gol,
   * adica un teanc in jurul centrului care se citea ca randurile unui paragraf, nu ca
   * texte asezate in locuri diferite.
   *
   * Ordinea de parcurgere e fixa si comparatia e strict „mai bun", deci la egalitate
   * castiga primul candidat intalnit: aceeasi scena da mereu acelasi loc.
   *
   * @param {{w:number,h:number}} marime cat ocupa textul nou, in pixeli
   * @param {{x:number,y:number,w:number,h:number}[]} ocupate ce e deja pe panza
   * @param {{w:number,h:number}} panza
   * @returns {{x:number,y:number}} CENTRUL unde sa cada, in pixeli de canvas
   */
  static alege(marime, ocupate, panza) {
    const w = Math.min(Math.max(1, marime.w), panza.w);
    const h = Math.min(Math.max(1, marime.h), panza.h);
    const hw = w / 2, hh = h / 2;
    const cx = panza.w / 2, cy = panza.h / 2;

    const inPanza = (v, jum, limita) => Math.max(jum, Math.min(limita - jum, v));

    // mijlocul panzei, adus inauntru daca textul e mai mare decat jumatate de panza
    const mijloc = { x: inPanza(cx, hw, panza.w), y: inPanza(cy, hh, panza.h) };
    if (!ocupate.length) return mijloc;

    let bun = null, celMaiGol = -Infinity;
    for (let x = hw; x <= panza.w - hw; x += Asezator.PAS) {
      for (let y = hh; y <= panza.h - hh; y += Asezator.PAS) {
        const cadru = Asezator.cadru({ x, y }, w, h);
        if (ocupate.some(o => Asezator.seAting(cadru, o))) continue;
        const gol = Asezator.respiro(cadru, ocupate, panza);
        if (gol > celMaiGol) { celMaiGol = gol; bun = { x, y }; }
      }
    }

    // panza plina: mai bine suprapus in mijloc decat aruncat intr-un colt
    return bun || mijloc;
  }
}
