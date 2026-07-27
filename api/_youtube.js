/**
 * _youtube.js — Cliente da YouTube Data API v3 e normalização.
 *
 * O prefixo `_` faz a Vercel ignorar este arquivo como rota: ele é biblioteca
 * compartilhada, não endpoint.
 *
 * Só o MODO PÚBLICO mora aqui: tudo que uma chave de API resolve, sem OAuth e
 * sem aprovação do Google.
 *
 * Devolve o mesmo formato que `mock-data.js` produz no front, para que o motor
 * de análise não saiba de onde veio o dado. Os campos que a API pública NÃO
 * expõe voltam como `null` — nunca inventados. O motor detecta a ausência e
 * degrada a análise de forma explícita.
 */

const API = 'https://www.googleapis.com/youtube/v3';

/** Custo em unidades de cota. A cota diária padrão é de 10.000. */
export const COST = { search: 100, list: 1 };

export class YouTubeError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

async function call(path, params, apiKey) {
  const qs = new URLSearchParams({ ...params, key: apiKey });
  const res = await fetch(`${API}/${path}?${qs}`);
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = body?.error?.errors?.[0] || {};
    throw new YouTubeError(
      body?.error?.message || `Falha em ${path}`,
      res.status,
      err.reason || 'unknown'
    );
  }
  return body;
}

/* ------------------------------------------------------------ utilitários */

/** ISO 8601 (PT1H2M3S) → segundos. */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((v) => (v == null ? 0 : Number(v)));
  return d * 86400 + h * 3600 + min * 60 + Math.round(s);
}

/** Cor determinística por canal — o front usa em avatar e miniaturas. */
function accentFor(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return [`hsl(${hue} 78% 52%)`, `hsl(${(hue + 28) % 360} 72% 26%)`];
}

const num = (v) => (v == null ? 0 : Number(v) || 0);

/* --------------------------------------------------------------- catálogo */

export async function fetchCategories(apiKey, regionCode = 'BR') {
  const body = await call('videoCategories', { part: 'snippet', regionCode, hl: 'pt_BR' }, apiKey);
  return (body.items || []).reduce((acc, it) => {
    acc[it.id] = it.snippet?.title || 'Outros';
    return acc;
  }, {});
}

/* ----------------------------------------------------------------- busca */

/**
 * Busca canais por nome.
 *
 * Pedimos 15 candidatos e devolvemos 6. Custa a mesma coisa: `search.list` cobra
 * 100 unidades independentemente do `maxResults`, e `channels.list` cobra 1
 * unidade para o lote inteiro. Candidatos extras saem de graça.
 *
 * A reordenação existe porque o `search.list` ranqueia por relevância textual e
 * ignora o tamanho do canal: buscar "Porta dos Fundos" traz clones de 1 inscrito
 * acima do canal verdadeiro. Numa ferramenta de métricas isso é inaceitável —
 * quem procura um canal quer o canal, não a imitação.
 */
export async function searchChannels(query, apiKey, { maxResults = 6, candidates = 15 } = {}) {
  const found = await call(
    'search',
    {
      part: 'snippet',
      type: 'channel',
      maxResults: String(candidates),
      q: query,
      regionCode: 'BR',
      relevanceLanguage: 'pt',
    },
    apiKey
  );

  const ids = (found.items || []).map((i) => i.id?.channelId).filter(Boolean);
  if (!ids.length) return [];

  const detail = await call('channels', { part: 'snippet,statistics,topicDetails', id: ids.join(',') }, apiKey);
  const cards = (detail.items || []).map(toChannelCard);

  const norm = (s) =>
    String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const alvo = norm(query);

  const rank = (c) => {
    const nome = norm(c.title);
    const handle = norm(c.handle);
    // Nome idêntico vence tudo; nome que contém o termo vem depois; o resto
    // se ordena por tamanho, que é o melhor desempate disponível.
    if (nome === alvo || handle === alvo) return 3;
    if (nome.startsWith(alvo)) return 2;
    if (nome.includes(alvo)) return 1;
    return 0;
  };

  return cards
    .sort((a, b) => rank(b) - rank(a) || b.statistics.subscriberCount - a.statistics.subscriberCount)
    .slice(0, maxResults);
}

function toChannelCard(c) {
  return {
    id: c.id,
    title: c.snippet?.title || 'Canal',
    handle: c.snippet?.customUrl ? `@${c.snippet.customUrl.replace(/^@/, '')}` : '',
    // Canal sem descrição é comum e não pode virar string vazia na interface.
    description: (c.snippet?.description || '').trim().slice(0, 160) || 'Sem descrição.',
    country: c.snippet?.country || '—',
    accent: accentFor(c.id),
    publishedAt: c.snippet?.publishedAt || new Date().toISOString(),
    statistics: {
      subscriberCount: num(c.statistics?.subscriberCount),
      viewCount: num(c.statistics?.viewCount),
      videoCount: num(c.statistics?.videoCount),
    },
    // Acontece de verdade: o canal escondeu o número de inscritos.
    subscribersHidden: !!c.statistics?.hiddenSubscriberCount,
    topicCategories: (c.topicDetails?.topicCategories || [])
      .map((u) => decodeURIComponent(String(u).split('/').pop() || '').replace(/_/g, ' '))
      .slice(0, 4),
  };
}

/* -------------------------------------------------- relatório de um canal */

/**
 * channels.list → playlistItems.list (uploads, paginado) → videos.list (lotes de 50)
 *
 * Custo: 1 + N/50 + N/50 + 1. Um canal de 200 vídeos sai por ~10 unidades.
 * O caro é a busca por nome (100), não a leitura do canal.
 */
export async function fetchChannelReport(channelId, apiKey, { maxVideos = 200, categories = null } = {}) {
  const chRes = await call('channels', { part: 'snippet,statistics,contentDetails,topicDetails', id: channelId }, apiKey);

  const raw = chRes.items?.[0];
  if (!raw) throw new YouTubeError('Canal não encontrado', 404, 'channelNotFound');

  const uploads = raw.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new YouTubeError('Canal sem playlist de uploads', 404, 'noUploads');

  const card = toChannelCard(raw);

  const videoIds = [];
  let pageToken = '';
  while (videoIds.length < maxVideos) {
    const page = await call(
      'playlistItems',
      { part: 'contentDetails', playlistId: uploads, maxResults: '50', ...(pageToken ? { pageToken } : {}) },
      apiKey
    );
    for (const it of page.items || []) {
      const id = it.contentDetails?.videoId;
      if (id) videoIds.push(id);
    }
    pageToken = page.nextPageToken || '';
    if (!pageToken) break;
  }

  const catMap = categories || (await fetchCategories(apiKey));
  const videos = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const res = await call(
      'videos',
      { part: 'snippet,statistics,contentDetails', id: videoIds.slice(i, i + 50).join(',') },
      apiKey
    );
    // videos.list omite silenciosamente vídeos privados ou removidos que ainda
    // constam na playlist de uploads — por isso iteramos sobre o retorno, e não
    // sobre os ids pedidos.
    for (const v of res.items || []) videos.push(toVideo(v, card, catMap));
  }

  return { channel: { ...card, videos }, fetchedAt: new Date().toISOString() };
}

function toVideo(v, card, catMap) {
  const durationSec = parseDuration(v.contentDetails?.duration);
  return {
    id: v.id,
    title: v.snippet?.title || 'Sem título',
    publishedAt: v.snippet?.publishedAt,
    durationSec,
    // A API não marca Shorts. Duração ≤ 60 s acerta a maioria, mas classifica
    // errado um vídeo curto comum publicado na horizontal.
    isShort: durationSec > 0 && durationSec <= 60,
    topic: catMap[v.snippet?.categoryId] || 'Outros',
    tags: (v.snippet?.tags || []).slice(0, 12),
    views: num(v.statistics?.viewCount),
    // likeCount some quando o canal oculta as curtidas.
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
    accent: card.accent,

    // Campos que a API pública NÃO fornece. Ficam nulos de propósito: o motor
    // detecta a ausência e desliga as análises que dependeriam deles, em vez de
    // exibir um número inventado com cara de precisão.
    subsGained: null,
    views48h: null,
    avgViewPct: null,
    avgViewDurationSec: null,
    ctr: null,
    revenue: null,
  };
}
