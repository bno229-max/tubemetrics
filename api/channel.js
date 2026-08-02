/**
 * GET /api/channel?id=UC... — relatório público completo de um canal.
 *
 * Custo: ~10 unidades para um canal de 200 vídeos. Barato perto da busca.
 * O cache de borda guarda por 6 h, então revisitar um canal não gasta nada.
 */

import { fetchChannelReport, YouTubeError } from './_youtube.js';
import { trackChannel } from './_store.js';
import { verifyRequest, findUserByUid, getQuota } from './_auth.js';
import { json, fail, guard, handleYouTubeError, CACHE_CHANNEL } from './_http.js';

/**
 * Teto de vídeos lidos por canal. Além de segurar a cota, evita que um canal
 * com 5.000 vídeos estoure o tempo máximo de execução da função.
 */
const MAX_VIDEOS = 200;

export default async function handler(req, res) {
  const apiKey = guard(req, res);
  if (!apiKey) return;

  // Numa resposta servida do cache de borda esta função nem chega a rodar, mas
  // numa "cache miss" (que é onde o custo real de cota do YouTube acontece) só
  // deixamos passar quem tem conta e ainda tem análise disponível — sem isso,
  // um script sem login conseguia gastar cota do YouTube indefinidamente.
  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'authRequired', 'Entre na sua conta para analisar um canal.');

  const id = String(req.query.id || '').trim();
  if (!/^UC[\w-]{20,24}$/.test(id)) {
    return fail(res, 400, 'badChannelId', 'Identificador de canal inválido. Ele começa com "UC".');
  }

  const user = await findUserByUid(account.uid);
  if (!user) return fail(res, 400, 'needsProfile', 'Complete seu cadastro para analisar canais.');

  const quota = getQuota(user);
  const alreadyCounted = (user.searchedChannelIds || []).includes(id) || (user.searchedIdsThisMonth || []).includes(id);
  if (quota.remaining === 0 && !alreadyCounted) {
    return fail(res, 403, 'quotaExceeded', 'Você usou todas as análises do seu plano.', { quota });
  }

  try {
    const report = await fetchChannelReport(id, apiKey, { maxVideos: MAX_VIDEOS });

    if (!report.channel.videos.length) {
      return fail(res, 404, 'noVideos', 'Este canal não tem vídeos públicos para analisar.');
    }

    // Canal analisado entra na coleta diaria: o historico cresce com o uso,
    // sem ninguem precisar cadastrar nada. Falha aqui nao pode derrubar o
    // relatorio, que e o que o usuario pediu.
    trackChannel(id).catch(() => {});

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
