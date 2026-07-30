/**
 * GET /api/analytics — dados privados do canal conectado.
 *
 * Sem sessão válida, devolve 401 — é assim que o front-end distingue
 * "ainda não conectou" de "erro do servidor" e decide se mostra a tela de
 * conectar ou uma mensagem de falha.
 *
 * A resposta tem o mesmo formato de `getPublicReport`: `{ channel, scope,
 * fetchedAt }`, só que `channel.analytics` vem preenchido de verdade e os
 * vídeos trazem `subsGained`/`avgViewPct`/`ctr`/`revenue` reais em vez de
 * `null`. O front-end (`analyze()` em engine.js) já sabe ler os dois formatos.
 */

import { listConnections, readConnection, deleteConnection, sessionStoreReady } from './_session.js';
import { verifyRequest } from './_auth.js';
import { refreshAccessToken, fetchDailySeries, fetchVideoStats, fetchDimensions, OAuthError } from './_analytics.js';
import { fetchChannelReport, YouTubeError } from './_youtube.js';
import { json, fail, NO_CACHE } from './_http.js';

/** 3 anos: cobre o teto de histórico do maior plano (Creator, 1095 dias). */
const LOOKBACK_DAYS = 1095;

const isoDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'methodNotAllowed', 'Use GET.');

  if (!sessionStoreReady()) {
    return fail(res, 503, 'sessionNotConfigured', 'Sessão de OAuth ainda não configurada neste servidor.');
  }

  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'notLoggedIn', 'Faça login para ver seus canais.');

  // Uma conta pode ter vários canais ligados (quantos, depende do plano). Sem
  // `channelId` na query, abrimos o primeiro — e a lista completa vai junto na
  // resposta para a interface montar o seletor sem uma segunda requisição.
  const conexoes = await listConnections(account.uid);
  if (!conexoes.length) {
    return fail(res, 401, 'notConnected', 'Nenhum canal conectado nesta conta.');
  }

  const pedido = String(req.query.channelId || '').trim();
  const escolhido = pedido
    ? conexoes.find((c) => c.channelId === pedido)
    : conexoes[0];

  if (!escolhido) {
    return fail(res, 404, 'channelNotConnected', 'Este canal não está conectado nesta conta.');
  }

  const session = await readConnection(account.uid, escolhido.channelId);
  if (!session) {
    return fail(res, 401, 'notConnected', 'A conexão com este canal expirou. Conecte novamente.');
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return fail(res, 503, 'missingApiKey', 'YOUTUBE_API_KEY não configurada.');

  let accessToken;
  try {
    accessToken = await refreshAccessToken(session.refreshToken);
  } catch (err) {
    if (err instanceof OAuthError && err.status === 400) {
      // invalid_grant: o usuário revogou o acesso no myaccount.google.com.
      // A conexão está morta para sempre — apagar evita repetir essa falha.
      await deleteConnection(account.uid, escolhido.channelId);
      return fail(res, 401, 'accessRevoked', 'O acesso a este canal foi revogado. Conecte novamente.');
    }
    console.error('Erro ao renovar o access token:', err);
    return fail(res, 502, 'tokenRefreshFailed', 'Não foi possível renovar o acesso ao Google.');
  }

  const endDate = isoDay();
  const startDate = isoDay(new Date(Date.now() - LOOKBACK_DAYS * 86400000));
  const recentStart = isoDay(new Date(Date.now() - 90 * 86400000));

  try {
    // O catálogo público (títulos, tags, duração) e as métricas privadas não
    // dependem uma da outra — buscamos em paralelo para não somar as latências.
    const [publicReport, daily, videoStats, dimensions] = await Promise.all([
      fetchChannelReport(session.channelId, apiKey, { maxVideos: 200 }),
      fetchDailySeries(accessToken, { startDate, endDate }),
      fetchVideoStats(accessToken, { startDate, endDate }),
      fetchDimensions(accessToken, { startDate: recentStart, endDate }),
    ]);

    const videos = publicReport.channel.videos.map((v) => {
      const real = videoStats[v.id];
      if (!real) return v; // vídeo sem dado de Analytics (raro: removido, privado)
      return {
        ...v,
        subsGained: real.subsGained,
        avgViewPct: real.avgViewPct,
        avgViewDurationSec: real.avgViewDurationSec,
        ctr: real.ctr, // sempre null por ora — ver limitação em _analytics.js
        revenue: real.revenue,
      };
    });

    const channel = {
      ...publicReport.channel,
      videos,
      analytics: { daily: daily.rows, dimensions },
    };

    return json(
      res,
      200,
      {
        channel,
        scope: 'private',
        fetchedAt: new Date().toISOString(),
        // A lista completa vai junto para o seletor de canais ser montado sem
        // uma segunda requisição, e `activeChannelId` diz qual está aberto.
        connectedChannels: conexoes,
        activeChannelId: escolhido.channelId,
        // Reflete o que de fato foi obtido: receita cai para false num canal
        // fora do Programa de Parcerias; CTR nunca é `true` (ver _analytics.js).
        capabilities: { subsPerVideo: true, early48h: false, retention: true, ctr: false, revenue: daily.monetized },
      },
      NO_CACHE
    );
  } catch (err) {
    if (err instanceof OAuthError) {
      return fail(res, err.status >= 400 && err.status < 500 ? 403 : 502, 'analyticsError', err.message);
    }
    if (err instanceof YouTubeError) {
      return fail(res, err.status || 502, err.reason || 'upstream', err.message);
    }
    console.error('Erro inesperado em /api/analytics:', err);
    return fail(res, 500, 'internal', 'Erro interno ao montar o dashboard.');
  }
}
