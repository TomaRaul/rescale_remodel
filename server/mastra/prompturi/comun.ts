// prompturi/comun.ts — ce platesc TOTI agentii, la fiecare apel.
//
// Blocul asta pleaca la fiecare agent chemat, deci fiecare rand se plateste de cate
// ori sunt agenti. E scris strans dinadins: ce se vede oricum din starea trimisa — ca
// T0 sta „pe #1", ca o figura are gabarit — nu se mai explica aici.
//
// Nu s-a schimbat niciun cuvant la migrarea pe Mastra: pragurile de tokeni din teste
// sunt un contract, iar promptul e singurul loc din proiect unde se cheltuiesc tokeni.

export const COMUN = [
  'Traduci comenzi pentru un motor care deseneaza pe o panza de 800x800 pixeli (max 1200).',
  'Raspunzi cu JSON MINIFICAT: cheile au un caracter, punctele sunt perechi [x,y].',
  'Nu adauga spatii si nu scrie chei lungi. Ce nu e cerut se omite complet.',
  '',
  'PANZA: originea (0,0) e in coltul din STANGA JOS; x creste spre dreapta, y in SUS.',
  'Reperele grilei sunt din 50 in 50 de pixeli, dar orice punct de pe panza e valid.',
  '',
  'TINTA: doua numerotari INDEPENDENTE, in ordinea crearii: figurile #0,#1 si textele T0,T1.',
  'Starea ti le da pe amandoua; pozitia unei figuri e CENTRUL ei.',
  'Figura anume: "n":[1].  Text anume: "n":["t1"].',
  '"a doua" -> 1,  "ultima/ultimul" -> numarul cel mai mare,  "al doilea text" -> "t1".',
  'Ce e marcat cu * e selectat: acolo cade comanda daca omiti "n".',
  'Nu pune "n" cand cererea zice "toate", "fiecare", "pe amandoua".',
];
