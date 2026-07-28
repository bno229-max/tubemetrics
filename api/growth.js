/**
 * GET /api/growth?period=7|30|365 — ranking de crescimento.
 *
 * Cruza o retrato de hoje com o de X dias atrás e ordena pela diferença. É a
 * única forma de responder "quem mais cresceu na semana" com a Data API, que
 * não guarda série histórica nenhuma.
 *
 * Consequência incontornável: **o ranking de 7 dias só existe depois de 7 dias
 * de coleta**, e o anual depois de um ano. A rota diz exatamente quanto
 * histórico existe, para a interface nunca exibir um ranking pela metade como
 * se estivesse completo.
 */

import { trackedChannels, readSnapshots, readSnapshotsNear, historyDepth, storageReady, isoDay } from './_store.js';
import { json, fail, NO_CACHE } from './_http.js';

const PERIODOS = { 7: 'semana', 30: 'mês', 365: 'ano' };

/** 30 min: o dado só muda quando o cron roda, mas o cache protege de rajadas. */
const CACHE_GROWTH = 'public, s-maxage=1800, stale-while-revalidate=7200';

export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'methodNotAllowed', 'Use GET.');

  const period = Number(req.query.period) || 7;
  if (!PERIODOS[period]) {
    return fail(res, 400, 'badPeriod', 'Período inválido. Use 7, 30 ou 365.');
  }
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));

  if (!storageReady()) {
    return json(res, 200, vazio(period, 'storageNotConfigured',
      'O histórico ainda não está ligado. Configure o armazenamento para começar a coletar.'), NO_CACHE);
  }

  try {
    const ids = await trackedChannels();
    if (!ids.length) {
      return json(res, 200, vazio(period, 'noChannels',
        'Nenhum canal monitorado ainda. Analise canais para que entrem na coleta.'), NO_CACHE);
    }

    const hoje = await readSnapshots(ids, isoDay());
    const ontem = Object.keys(hoje).length ? null : await readSnapshots(ids, isoDay(new Date(Date.now() - 86400000)));
    // A coleta roda de madrugada; antes disso o "hoje" ainda não existe e o
    // retrato mais recente é o de ontem.
    const atual = Object.keys(hoje).length ? hoje : ontem || {};

    if (!Object.keys(atual).length) {
      const depth = await historyDepth();
      return json(res, 200, vazio(period, 'noSnapshots',
        'A coleta diária ainda não gravou nenhum retrato.', depth), NO_CACHE);
    }

    const { snapshots: anterior, actualDays } = await readSnapshotsNear(Object.keys(atual), period);

    if (!Object.keys(anterior).length) {
      const depth = await historyDepth();
      return json(res, 200, vazio(period, 'notEnoughHistory',
        `Ainda não há ${period} dias de histórico. O ranking de ${PERIODOS[period]} fica pronto conforme a coleta avança.`,
        depth), NO_CACHE);
    }

    const linhas = Object.entries(atual)
      .map(([id, agora]) => {
        const antes = anterior[id];
        if (!antes) return null;

        const ganhoInscritos = agora.subscribers - antes.subscribers;
        const ganhoViews = agora.views - antes.views;

        return {
          channelId: id,
          title: agora.title || antes.title || 'Canal',
          handle: agora.handle || antes.handle || '',
          thumbnail: agora.thumbnail || antes.thumbnail || null,
          url: `https://www.youtube.com/channel/${id}`,
          subscribers: agora.subscribers,
          views: agora.views,
          videos: agora.videos,
          ganhoInscritos,
          ganhoViews,
          novosVideos: Math.max(0, (agora.videos || 0) - (antes.videos || 0)),
          // Percentual sobre a base anterior: canal grande cresce mais em
          // números absolutos, canal pequeno cresce mais em proporção. Os dois
          // ângulos importam, então devolvemos ambos.
          pctInscritos: antes.subscribers ? (ganhoInscritos / antes.subscribers) * 100 : 0,
          pctViews: antes.views ? (ganhoViews / antes.views) * 100 : 0,
        };
      })
      .filter(Boolean)
      // Queda acontece (limpeza de bots, canal punido) e é informação legítima,
      // mas um ranking de crescimento não deve ser liderado por ela.
      .sort((a, b) => b.ganhoViews - a.ganhoViews);

    return json(
      res,
      200,
      {
        period,
        periodLabel: PERIODOS[period],
        // Quando falta o retrato exato, usamos o mais próximo — e dizemos qual.
        actualDays,
        exact: actualDays === period,
        porViews: linhas.slice(0, limit),
        porInscritos: [...linhas].sort((a, b) => b.ganhoInscritos - a.ganhoInscritos).slice(0, limit),
        tracked: Object.keys(atual).length,
        compared: linhas.length,
        fetchedAt: new Date().toISOString(),
        ready: true,
      },
      CACHE_GROWTH
    );
  } catch (err) {
    console.error('Erro no ranking de crescimento:', err);
    return fail(res, 500, 'internal', 'Erro interno ao montar o ranking.');
  }
}

/** Resposta honesta de "ainda não dá": 200 com `ready:false` e o motivo. */
function vazio(period, reason, message, depth = null) {
  return {
    period,
    periodLabel: PERIODOS[period],
    ready: false,
    reason,
    message,
    porViews: [],
    porInscritos: [],
    history: depth,
  };
}
