/**
 * GET /api/channel?id=UC... — relatório público completo de um canal.
 *
 * Custo: ~10 unidades para um canal de 200 vídeos. Barato perto da busca.
 * O cache de borda guarda por 6 h, então revisitar um canal não gasta nada.
 */

import { fetchChannelReport, YouTubeError } from './_youtube.js';
import { json, fail, guard, handleYouTubeError, CACHE_CHANNEL } from './_http.js';

/**
 * Teto de vídeos lidos por canal. Além de segurar a cota, evita que um canal
 * com 5.000 vídeos estoure o tempo máximo de execução da função.
 */
const MAX_VIDEOS = 200;

export default async function handler(req, res) {
  const apiKey = guard(req, res);
  if (!apiKey) return;

  const id = String(req.query.id || '').trim();
  if (!/^UC[\w-]{20,24}$/.test(id)) {
    return fail(res, 400, 'badChannelId', 'Identificador de canal inválido. Ele começa com "UC".');
  }

  try {
    const report = await fetchChannelReport(id, apiKey, { maxVideos: MAX_VIDEOS });

    if (!report.channel.videos.length) {
      return fail(res, 404, 'noVideos', 'Este canal não tem vídeos públicos para analisar.');
    }

    return json(
      res,
      200,
      {
        channel: report.channel,
        scope: 'public',
        fetchedAt: report.fetchedAt,
        // O front usa isto para avisar quais análises ainda não têm base de dado.
        capabilities: { subsPerVideo: false, early48h: false, retention: false, ctr: false, revenue: false },
      },
      CACHE_CHANNEL
    );
  } catch (err) {
    if (err instanceof YouTubeError) return handleYouTubeError(res, err);
    console.error('Erro inesperado no relatório:', err);
    return fail(res, 500, 'internal', 'Erro interno ao montar o relatório.');
  }
}
