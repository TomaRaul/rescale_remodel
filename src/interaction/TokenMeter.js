// TokenMeter.js — contabilitatea de tokeni. Motivul pentru care exista tot proiectul.
//
// Compara trei strategii pentru ACELASI rezultat:
//   A. atribute — LLM-ul vede doar intrebarile de atribut            O(1) in nr. de figuri
//   B. plat     — LLM-ul vede lista completa de figuri                O(n)
//   C. vision  — LLM-ul vede imaginea si emite toate coordonatele
//
// Estimarea e CALIBRATA, nu ghicita. Pentru imagini, ~(w*h)/750 (ordinul de marime
// folosit de modelele Claude); pentru text, cifra de mai jos.

/**
 * Cate caractere intra intr-un token, in textul pe care il trimite CHIAR aplicatia asta.
 *
 * A stat multa vreme pe 4 — cifra care se citeste peste tot, si care e potrivita pentru
 * proza obisnuita. Numai ca prompturile de aici nu sunt proza: sunt pline de {, ", :, [
 * si de cifre, iar acolo un token inseamna mult mai putine caractere.
 *
 * Masurat cu `countTokens` al lui Gemini, pe cele unsprezece cereri din pragurile
 * testului: 17655 tokeni REALI fata de 12156 estimati cu 4 — o subestimare de 45%. Cu
 * 2.8, aceleasi unsprezece cazuri ies la -1.7% fata de total si sub 8% pe fiecare caz.
 *
 * Conteaza pentru ca pragurile din `test.mjs` sunt un CONTRACT. Scrise intr-o moneda cu
 * 45% mai ieftina decat realitatea, un tur care „respecta" 760 costa de fapt 1130 —
 * testul trecea, si pretul se vedea abia pe factura. Un contract in unitati gresite nu
 * e un contract.
 *
 * Cifra e a tokenizatorului Gemini si a acestui fel de text. Alt model o misca putin,
 * dar nu inapoi la 4; iar raportul dintre coloanele tabelului ramane oricum ce conteaza.
 */
const CHR_PER_TOKEN = 2.8;

export const est = s => Math.ceil((s ?? '').length / CHR_PER_TOKEN);
export const imageTokens = (w, h) => Math.ceil((w * h) / 750);

export function compare({ prompt, skeleton, flat, summary, dsl, scene, canvas }) {
  const dslStr = JSON.stringify(dsl);
  const fullCoords = JSON.stringify({
    edges: scene.edges.map(e => ({
      id: e.id,
      x1: +e.x1.toFixed(1), y1: +e.y1.toFixed(1),
      x2: +e.x2.toFixed(1), y2: +e.y2.toFixed(1),
    })),
    words: scene.words.map(w => ({
      t: w.text, x: +w.x.toFixed(1), y: +w.y.toFixed(1), r: w.rot,
    })),
  });

  const base = est(prompt) + est(summary);

  // Cate intrebari are scheletul se NUMARA, nu se scrie: atributele se pot adauga sau
  // scoate din catalog, iar o cifra scrisa aici ramane in urma fara sa spuna nimeni.
  const intrebari = (skeleton || '').split('\n').filter(r => r.trim()).length;

  return {
    tree:   { in: base + est(skeleton), out: est(dslStr),     label: `Attributes (${intrebari} questions + DSL)` },
    flat:   { in: base + est(flat),     out: est(dslStr),     label: 'Flat catalog + DSL' },
    vision: { in: base + imageTokens(canvas.w, canvas.h), out: est(fullCoords), label: 'Vision + coordinates' },
    payloads: { skeleton, flat, dsl: dslStr, fullCoords },
  };
}
