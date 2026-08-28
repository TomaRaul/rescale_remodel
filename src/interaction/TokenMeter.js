// TokenMeter.js — contabilitatea de tokeni. Motivul pentru care exista tot proiectul.
//
// Compara trei strategii pentru ACELASI rezultat:
//   A. atribute — LLM-ul vede doar intrebarile de atribut            O(1) in nr. de figuri
//   B. plat     — LLM-ul vede lista completa de figuri                O(n)
//   C. vision  — LLM-ul vede imaginea si emite toate coordonatele
//
// Estimarea e ~4 caractere/token; pentru imagini, ~(w*h)/750 (ordinul de marime folosit
// de modelele Claude). Nu e exact, dar raportul dintre coloane e ce conteaza.

export const est = s => Math.ceil((s ?? '').length / 4);
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
    tree:   { in: base + est(skeleton), out: est(dslStr),     label: `Atribute (${intrebari} întrebări + DSL)` },
    flat:   { in: base + est(flat),     out: est(dslStr),     label: 'Catalog plat + DSL' },
    vision: { in: base + imageTokens(canvas.w, canvas.h), out: est(fullCoords), label: 'Vision + coordonate' },
    payloads: { skeleton, flat, dsl: dslStr, fullCoords },
  };
}
