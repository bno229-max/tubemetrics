/**
 * GET /api/cron-snapshot — coleta diária do histórico de canais.
 *
 * A Data API só devolve o retrato de AGORA: inscritos e views acumulados, sem
 * nenhuma série temporal. Ranking de crescimento ("quem mais cresceu na semana")
 * só existe se alguém guardar esses retratos dia após dia. É o que esta rotina
 * faz.
 *
 * Disparada pelo Vercel Cron (ver `vercel.json`). Também aceita chamada manual
 * com o mesmo segredo, útil para testar sem esperar a madrugada.
 *
 * Custo: 1 unidade por lote de 50 canais. Mil canais monitorados custam 20
 * unidades por dia — 0,2% da cota diária.
 */

import { fetchChannelStats, YouTubeError } from './_youtube.js';
import { trackedChannels, saveSnapshots, storageReady, isoDay } from './_store.js';
import { json, fail, handleYouTubeError, NO_CACHE } from './_http.js';

export default async function handler(req, res) {
  // O Vercel Cron manda `Authorization: Bearer $CRON_SECRET`. Sem a checagem,
  // qualquer pessoa dispararia a coleta e queimaria a cota do dia.
  const secret = process.env.CRON_SECRET;
  const enviado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (secret && enviado !== secret) {
    return fail(res, 401, 'unauthorized', 'Segredo do cron inválido.');
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return fail(res, 503, 'missingApiKey', 'YOUTUBE_API_KEY não configurada.');

  if (!storageReady()) {
    return fail(
      res,
      503,
      'storageNotConfigured',
      'Armazenamento não configurado. Crie um Upstash Redis em Storage, no painel da Vercel.'
    );
  }

  try {
    const ids = await trackedChannels();
    if (!ids.length) {
      return json(res, 200, { ok: true, day: isoDay(), saved: 0, note: 'Nenhum canal monitorado ainda.' }, NO_CACHE);
    }

    const stats = await fetchChannelStats(ids, apiKey);
    const saved = await saveSnapshots(stats);

    return json(
      res,
      200,
      {
        ok: true,
        day: isoDay(),
        tracked: ids.length,
        // Canal apagado ou suspenso some da resposta da API: registrar a
        // diferença evita achar que a coleta falhou quando ela só encolheu.
        resolved: stats.length,
        saved,
        units: Math.ceil(ids.length / 50),
      },
      NO_CACHE
    );
  } catch (err) {
    if (err instanceof YouTubeError) return handleYouTubeError(res, err);
    console.error('Erro na coleta diária:', err);
    return fail(res, 500, 'internal', 'Erro interno na coleta.');
  }
}
