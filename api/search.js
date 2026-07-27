/**
 * GET /api/search?q=termo — busca canais por nome.
 *
 * Custa 101 unidades de cota por termo NOVO (100 do search.list + 1 do
 * channels.list). Com 10.000 unidades por dia, são ~99 termos distintos.
 *
 * O que segura essa conta é o cache de borda: o mesmo termo, buscado por
 * qualquer usuário nas 24 h seguintes, é servido pelo CDN sem acordar a função.
 */

import { searchChannels, YouTubeError } from './_youtube.js';
import { json, fail, guard, handleYouTubeError, CACHE_SEARCH } from './_http.js';

export default async function handler(req, res) {
  const apiKey = guard(req, res);
  if (!apiKey) return;

  const q = String(req.query.q || '').trim();

  // Menos de 2 caracteres traz lixo e queima 100 unidades para nada.
  if (q.length < 2) return fail(res, 400, 'badQuery', 'Informe ao menos 2 caracteres.');
  if (q.length > 100) return fail(res, 400, 'badQuery', 'Termo de busca longo demais.');

  try {
    const channels = await searchChannels(q, apiKey);
    return json(res, 200, { channels, query: q }, CACHE_SEARCH);
  } catch (err) {
    if (err instanceof YouTubeError) return handleYouTubeError(res, err);
    console.error('Erro inesperado na busca:', err);
    return fail(res, 500, 'internal', 'Erro interno ao buscar canais.');
  }
}
