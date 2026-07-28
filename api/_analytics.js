/**
 * _analytics.js — Cliente da YouTube Analytics API v2, para dados privados.
 *
 * Diferente de `_youtube.js` (dados públicos, chave de API), tudo aqui exige
 * um `access_token` de OAuth do dono do canal.
 *
 * ## Limitação assumida: `views48h` continua indisponível
 *
 * O relatório público já deixa isso marcado como estimativa (ver
 * `dataCapabilities()` em engine.js). Com OAuth real, dá para reduzir essa
 * lacuna, mas não eliminá-la de graça: a Analytics API só devolve views nas
 * primeiras 48 h de um vídeo com uma consulta de INTERVALO DE DATA PRÓPRIO
 * para aquele vídeo (`startDate`/`endDate` = data de publicação + 2 dias).
 * Isso significa uma requisição por vídeo — 200 vídeos = 200 chamadas só para
 * essa métrica, o que estouraria o tempo de execução de uma função serverless
 * numa carga de página. Por isso `views48h` segue `null` mesmo no modo
 * conectado; o motor de análise já sabe degradar sozinho quando falta.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';

export class OAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Troca o `refresh_token` por um `access_token` novo. Válido por ~1 hora. */
export async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    // invalid_grant é o sinal de "usuário revogou o acesso" — a sessão morreu
    // do lado do Google, não adianta tentar de novo com o mesmo refresh token.
    throw new OAuthError(body.error_description || body.error || 'Falha ao renovar token', res.status);
  }
  return body.access_token;
}

async function query(accessToken, params) {
  const url = new URL(ANALYTICS_URL);
  url.searchParams.set('ids', 'channel==MINE');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  if (!res.ok) throw new OAuthError(body.error?.message || 'Falha na Analytics API', res.status);
  return body;
}

/** A API devolve colunas e linhas separadas; isso zipa em objetos por nome de coluna. */
function rowsToObjects(report) {
  const cols = (report.columnHeaders || []).map((h) => h.name);
  return (report.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

const num = (v) => (v == null ? 0 : Number(v) || 0);

/* --------------------------------------------------------- série diária -- */

const DAILY_METRICS = [
  'views', 'estimatedMinutesWatched', 'averageViewDuration',
  'subscribersGained', 'subscribersLost', 'estimatedRevenue',
  'impressions', 'impressionClickThroughRate',
].join(',');

export async function fetchDailySeries(accessToken, { startDate, endDate }) {
  const report = await query(accessToken, { startDate, endDate, dimensions: 'day', metrics: DAILY_METRICS, sort: 'day' });
  return rowsToObjects(report).map((r) => ({
    date: r.day,
    views: num(r.views),
    estimatedMinutesWatched: num(r.estimatedMinutesWatched),
    averageViewDuration: Math.round(num(r.averageViewDuration)),
    subscribersGained: num(r.subscribersGained),
    subscribersLost: num(r.subscribersLost),
    estimatedRevenue: Math.round(num(r.estimatedRevenue) * 100) / 100,
    impressions: num(r.impressions),
    impressionClickThroughRate: num(r.impressionClickThroughRate),
  }));
}

/* --------------------------------------------------------- por vídeo ----- */

const VIDEO_METRICS = [
  'views', 'subscribersGained', 'estimatedRevenue',
  'averageViewDuration', 'averageViewPercentage', 'impressionClickThroughRate',
].join(',');

/** Métricas reais por vídeo — o que substitui os `null` do modo público. */
export async function fetchVideoStats(accessToken, { startDate, endDate }) {
  const report = await query(accessToken, {
    startDate, endDate, dimensions: 'video', metrics: VIDEO_METRICS, maxResults: '200', sort: '-views',
  });
  return rowsToObjects(report).reduce((acc, r) => {
    acc[r.video] = {
      subsGained: num(r.subscribersGained),
      avgViewPct: Math.round(num(r.averageViewPercentage) * 10) / 10,
      avgViewDurationSec: Math.round(num(r.averageViewDuration)),
      ctr: Math.round(num(r.impressionClickThroughRate) * 10) / 10,
      revenue: Math.round(num(r.estimatedRevenue) * 100) / 100,
    };
    return acc;
  }, {});
}

/* --------------------------------------------------------- dimensões ----- */

/** Rótulos legíveis para os códigos que a API devolve — resto cai como veio. */
const TRAFFIC_LABELS = {
  SUBSCRIBER: 'Canal / Inscrições', YT_SEARCH: 'Busca do YouTube', RELATED_VIDEO: 'Sugestões do YouTube',
  PLAYLIST: 'Playlists', NOTIFICATION: 'Notificações', SHORTS: 'Shorts feed',
  EXT_URL: 'Externo (sites e apps)', YT_CHANNEL: 'Página do canal', NO_LINK_OTHER: 'Direto ou desconhecido',
  YT_OTHER_PAGE: 'Outras páginas do YouTube', ADVERTISING: 'Anúncios', END_SCREEN: 'Telas finais',
  CAMPAIGN_CARD: 'Cards de campanha', PROMOTED: 'Conteúdo promovido',
};
const DEVICE_LABELS = { MOBILE: 'Celular', DESKTOP: 'Computador', TABLET: 'Tablet', TV: 'TV', GAME_CONSOLE: 'Console' };

async function fetchBreakdown(accessToken, range, dimension, labels = {}) {
  try {
    const report = await query(accessToken, { ...range, dimensions: dimension, metrics: 'views', sort: '-views', maxResults: '12' });
    return rowsToObjects(report).map((r) => ({
      name: labels[r[dimension]] || r[dimension] || 'Outros',
      views: num(r.views),
    }));
  } catch {
    // Canal novo ou com pouquíssimas views no período pode não ter dado
    // suficiente para uma dimensão específica. Uma falha aqui não pode derrubar
    // o dashboard inteiro — a tela sabe lidar com uma lista vazia.
    return [];
  }
}

export async function fetchDimensions(accessToken, range) {
  const [trafficSources, countries, devices] = await Promise.all([
    fetchBreakdown(accessToken, range, 'insightTrafficSourceType', TRAFFIC_LABELS),
    fetchBreakdown(accessToken, range, 'country'),
    fetchBreakdown(accessToken, range, 'deviceType', DEVICE_LABELS),
  ]);

  let ageGender = [];
  try {
    const report = await query(accessToken, { ...range, dimensions: 'ageGroup,gender', metrics: 'views' });
    const byGroup = rowsToObjects(report).reduce((acc, r) => {
      const bucket = String(r.ageGroup || '').replace(/^age/, '').replace(/-/g, '–');
      (acc[bucket] ||= { bucket, m: 0, f: 0 });
      if (r.gender === 'male') acc[bucket].m += num(r.views);
      else if (r.gender === 'female') acc[bucket].f += num(r.views);
      return acc;
    }, {});
    ageGender = Object.values(byGroup);
  } catch {
    ageGender = []; // dimensão opcional; canal pequeno às vezes não tem dado suficiente
  }

  return { trafficSources, countries, devices, ageGender };
}

/** Identifica o canal autenticado a partir de um access_token válido. */
export async function fetchOwnChannel(accessToken) {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json();
  if (!res.ok) throw new OAuthError(body.error?.message || 'Falha ao identificar o canal', res.status);
  return body.items?.[0] || null;
}
