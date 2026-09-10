// supabase.ts — conturile si depozitul, partea care ruleaza pe SERVER.
//
// Supabase e folosit strict ca furnizor de identitate si de stocare. Nu se adauga
// niciun serviciu: fisierul asta e inca un modul in acelasi proces, ca `llm.ts`, si
// `serve.js` ramane singurul dispecer.
//
//   SUPABASE_URL           adresa proiectului
//   SUPABASE_ANON_KEY      cheia publica; pleaca in browser prin /api/config
//   SUPABASE_SERVICE_KEY   cheia de serviciu; NU pleaca de aici niciodata
//
// DE CE FILTRAM NOI DUPA user_id, CAND EXISTA RLS
//
// Cheia de serviciu trece PESTE Row Level Security — asta e si rostul ei. Deci regula
// scrisa in baza de date nu ne apara pe noi: ea apara cererile facute cu cheia publica,
// direct din browser. O interogare de aici fara `.eq('user_id', ...)` ar citi randurile
// tuturor, iar RLS n-ar spune nimic.
//
// De aceea id-ul nu vine niciodata din corpul cererii, ci din `utilizator()`, adica
// dintr-un jeton semnat pe care l-a verificat Supabase. Cele doua incuietori sunt
// diferite si amandoua trebuie sa existe: RLS opreste un client care ar vorbi direct cu
// baza, filtrul de aici opreste serverul sa se autopacaleasca.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Tabelul din care se citeste si in care se scrie. */
const TABEL = 'panze';

/** Cat de mare poate fi o scena salvata. O pânză plina de figuri sta sub 100 KB. */
export const CONTINUT_MAX = 1_000_000;

/** Cat de lung poate fi numele unei panze. Acelasi plafon e si in interfata. */
export const NUME_MAX = 60;

/** Cate panze se intorc intr-o lista. Peste atat, panoul n-ar mai fi de citit. */
const LISTA_MAX = 50;

export type PanzaScurt = { id: string; nume: string; created_at: string };

const mediu = (nume: string) => process.env[nume] || '';

/**
 * Sunt conturile pornite pe server?
 *
 * Cere si adresa si cheia de serviciu: cu una singura nu se poate nici valida un jeton,
 * nici scrie un rand. Fara ele, rutele de cont raspund limpede ca nu sunt configurate,
 * in loc sa pice cu o eroare de client neinitializat.
 */
export const activ = () => Boolean(mediu('SUPABASE_URL') && mediu('SUPABASE_SERVICE_KEY'));

/**
 * Ce are nevoie browserul ca sa se autentifice singur.
 *
 * Cheia „anon" e publica prin constructie — ea nu deschide nimic pe cont propriu,
 * fiindca RLS taie randurile care nu sunt ale sesiunii. Se serveste de la server, si nu
 * se scrie in `src/`, ca sa existe un singur loc in care sta configuratia: acelasi
 * `.env` care da si cheia modelului.
 */
export function configPublic() {
  const url = mediu('SUPABASE_URL'), anonKey = mediu('SUPABASE_ANON_KEY');
  return url && anonKey ? { url, anonKey } : null;
}

let _client: SupabaseClient | null = null;

/**
 * Clientul de serviciu, construit o singura data.
 *
 * `persistSession` si `autoRefreshToken` sunt stinse dinadins: pe server nu exista „o"
 * sesiune de tinut minte, iar clientul e impartit intre toate cererile. Cu ele pornite,
 * sesiunea unui om ar putea ramane lipita de client si ar fi vazuta de urmatorul.
 */
function client(): SupabaseClient {
  if (!activ()) throw new Error('accounts are not configured on the server');
  if (!_client) {
    _client = createClient(mediu('SUPABASE_URL'), mediu('SUPABASE_SERVICE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

/**
 * Cine e omul din spatele jetonului.
 *
 * Singurul loc din proiect in care se afla asta. Id-ul intors e CONFIRMAT: vine dintr-un
 * jeton verificat de Supabase, nu dintr-un camp trimis de client, care s-ar putea scrie
 * cu mana. Orice ruta de cont trece pe aici inainte sa atinga tabelul.
 */
export async function utilizator(jwt: string) {
  if (!jwt) throw new Error('missing session token');
  const { data, error } = await client().auth.getUser(jwt);
  if (error || !data.user) throw new Error('invalid session');
  return { id: data.user.id, email: data.user.email || '' };
}

/** Numele, curatat si plafonat. Un nume gol ar face lista de necitit. */
const numeCurat = (n: unknown) =>
  String(n ?? '').trim().slice(0, NUME_MAX) || 'untitled';

/**
 * Salveaza o scena. Acelasi nume RESCRIE pânza de dinainte.
 *
 * „Salvează" apasat de zece ori pe acelasi desen trebuie sa dea o pânză, nu zece. Cine
 * vrea o copie ii da alt nume — si asta e singurul fel de a spune „salvează ca", ceea
 * ce e destul pentru cate butoane are panoul.
 *
 * Cautarea si scrierea sunt amandoua ingradite la `user_id`: doi oameni pot avea fiecare
 * o pânză „schita" fara sa se vada.
 */
export async function salveaza(userId: string, nume: unknown, continut: unknown) {
  const n = numeCurat(nume);
  if (!continut || typeof continut !== 'object') throw new Error('missing or invalid content');
  if (JSON.stringify(continut).length > CONTINUT_MAX) throw new Error('the canvas is too large');

  const c = client();
  const { data: gasit, error: eCautare } = await c
    .from(TABEL).select('id').eq('user_id', userId).eq('nume', n).limit(1);
  if (eCautare) throw new Error(eCautare.message);

  if (gasit && gasit.length) {
    const { data, error } = await c
      .from(TABEL).update({ continut_json: continut })
      .eq('id', gasit[0].id).eq('user_id', userId)
      .select('id, nume, created_at').single();
    if (error) throw new Error(error.message);
    return data as PanzaScurt;
  }

  const { data, error } = await c
    .from(TABEL).insert({ user_id: userId, nume: n, continut_json: continut })
    .select('id, nume, created_at').single();
  if (error) throw new Error(error.message);
  return data as PanzaScurt;
}

/** Panzele contului, cele mai noi intai. Fara continut: lista n-are ce face cu el. */
export async function lista(userId: string): Promise<PanzaScurt[]> {
  const { data, error } = await client()
    .from(TABEL).select('id, nume, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(LISTA_MAX);
  if (error) throw new Error(error.message);
  return (data || []) as PanzaScurt[];
}

/**
 * Continutul unei panze.
 *
 * `user_id` sta in filtru chiar daca `id` e deja unic: fara el, cine ghiceste un UUID
 * citeste desenul altcuiva. Un id nu e o parola.
 */
export async function adu(userId: string, id: string) {
  const { data, error } = await client()
    .from(TABEL).select('id, nume, created_at, continut_json')
    .eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    nume: data.nume as string,
    created_at: data.created_at as string,
    continut: data.continut_json as Record<string, unknown>,
  };
}

export async function sterge(userId: string, id: string) {
  const { error } = await client()
    .from(TABEL).delete().eq('user_id', userId).eq('id', id);
  if (error) throw new Error(error.message);
}
