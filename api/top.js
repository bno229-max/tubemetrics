/**
 * GET /api/top?limit=20 — ranking de canais por inscritos.
 *
 * A YouTube Data API **não** tem endpoint de "canais mais inscritos". O que
 * existe é `search.list`, que ordena por relevância textual e custa 100
 * unidades — inviável para montar um ranking.
 *
 * A solução honesta é uma lista curada de canais brasileiros conhecidos,
 * resolvida por handle (`channels.list?forHandle=`, 1 unidade cada) e ordenada
 * pelos inscritos REAIS que a API devolve. O recorte é editorial; os números
 * não são.
 *
 * Handles que não resolvem (canal renomeado, handle trocado) são simplesmente
 * ignorados — a lista encolhe, nada quebra.
 */

import { fetchChannelsByHandles, YouTubeError } from './_youtube.js';
import { json, fail, guard, handleYouTubeError } from './_http.js';

/**
 * Curadoria de canais brasileiros de grande alcance, variando nicho de
 * propósito: ciência, humor, games, culinária, música e entrevista.
 */
const SEED_HANDLES = [
  // Religião — o segmento que mais cresceu no Brasil nos últimos anos
  'bispobrunoleonardo', 'padremarcelorossi', 'CancaoNova', 'ipdatransformacao',

  // Infantil — categoria com os maiores números absolutos do país
  'galinhapintadinha', 'MariaClaraeJP', 'LuccasToon', 'totoykids', 'mundobita',
  'turmadamonica', 'BelParaMeninas', 'gatodegalochas', 'CleoPetitLIVE',

  // Entretenimento e humor
  'Whinderssonnunes', 'felipeneto', 'luccasneto', 'portadosfundos', 'vocesabia',
  'T3ddy', 'Enaldinho', 'cocielo', 'Casimito', 'Desimpedidos', 'gkay',

  // Games
  'rezendeevil', 'AuthenticGames', 'jovemnerd', 'robinhoodgamer', 'juliaminegirl',
  'Cellbit', 'coisadenerd',

  // Ciência, educação e curiosidades
  'manualdomundo', 'Nerdologia', 'CanalNostalgia',

  // Culinária
  'cheffotto', 'panelaterapia',

  // Música
  'kondzilla', 'anitta', 'luansantana', 'wesleysafadao', 'henriquejuliano',
  'jorgeemateus', 'gusttavolima', 'zenetoecristiano', 'marilia', 'brunoemarrone',
  'ivetesangalo', 'michelteloficial',

  // Entrevista e podcast
  'flowpodcast',
];

/**
 * Piso de inscritos.
 *
 * Handle errado costuma resolver para um canal homônimo minúsculo — a primeira
 * versão desta lista trouxe um canal de 56 inscritos entre os maiores do
 * Brasil. Um ranking "por inscritos" com um canal desses perde a credibilidade
 * inteira, então o piso descarta a resolução equivocada em silêncio.
 */
const MIN_SUBSCRIBERS = 500000;

/** 12 horas: inscritos de canal grande não mudam de forma relevante em um dia. */
const CACHE_TOP = 'public, s-maxage=43200, stale-while-revalidate=172800';

export default async function handler(req, res) {
  const apiKey = guard(req, res);
  if (!apiKey) return;

  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  try {
    const channels = await fetchChannelsByHandles(SEED_HANDLES, apiKey);

    if (!channels.length) {
      return fail(res, 502, 'noChannels', 'Nenhum canal da lista pôde ser resolvido.');
    }

    const ranked = channels
      .filter((c) => c.statistics.subscriberCount >= MIN_SUBSCRIBERS)
      .sort((a, b) => b.statistics.subscriberCount - a.statistics.subscriberCount)
      .slice(0, limit)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    return json(
      res,
      200,
      {
        channels: ranked,
        total: ranked.length,
        resolved: channels.length,
        requested: SEED_HANDLES.length,
        minSubscribers: MIN_SUBSCRIBERS,
        fetchedAt: new Date().toISOString(),
      },
      CACHE_TOP
    );
  } catch (err) {
    if (err instanceof YouTubeError) return handleYouTubeError(res, err);
    console.error('Erro inesperado no ranking:', err);
    return fail(res, 500, 'internal', 'Erro interno ao montar o ranking.');
  }
}
