/**
 * api.js — Camada de acesso a dados.
 *
 * Resolve contra o backend real (`/api/**`, Cloud Functions) quando ele está
 * disponível e cai para `mock-data.js` quando não está. Nenhuma tela sabe qual
 * dos dois respondeu — quem precisa saber lê `currentMode()`.
 *
 * O mapeamento para os endpoints do Google está anotado em cada função.
 */

import { CHANNELS, OWNED_CHANNEL_ID, searchChannels as mockSearch, getChannel as mockGet } from './mock-data.js';
import { analyze } from './engine.js';
import { CONFIG } from './config.js';

/** Latência simulada — só no modo mock, para exercitar os estados de carga. */
const latency = (ms = 380) => new Promise((r) => setTimeout(r, ms + Math.random() * 220));

/* --------------------------------------------------------- modo de dados */

let mode = CONFIG.dataSource === 'mock' ? 'mock' : 'unknown';
let lastError = null;
const listeners = new Set();

export const currentMode = () => mode;
export const lastDataError = () => lastError;
export const onModeChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function setMode(next, error = null) {
  if (mode === next && lastError === error) return;
  mode = next;
  lastError = error;
  listeners.forEach((fn) => fn(mode, error));
}

async function request(path, params) {
  const url = new URL(`${CONFIG.apiBase}${path}`, location.origin);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error?.message || `Backend respondeu ${res.status}`);
      err.code = body?.error?.code || String(res.status);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa contra o backend e, em 'auto', cai para o mock quando ele falha.
 *
 * Cota esgotada (429) NÃO cai para o mock: seria pior mostrar dados fictícios
 * de um canal real do que dizer com franqueza que o limite do dia acabou.
 */
async function withFallback(liveFn, mockFn) {
  if (CONFIG.dataSource === 'mock') return mockFn();

  try {
    const out = await liveFn();
    setMode('live');
    return out;
  } catch (err) {
    if (CONFIG.dataSource === 'live' || err.status === 429) {
      setMode('live', err);
      throw err;
    }
    setMode('mock', err);
    return mockFn();
  }
}

/* ----------------------------------------------------------------- busca */

/**
 * GET /api/search?q=  →  no backend: search.list + channels.list.
 * Custo real: 101 unidades por termo novo; o backend cacheia por 24 h.
 */
export async function searchChannels(query) {
  return withFallback(
    async () => (await request('/search', { q: query })).channels,
    async () => {
      await latency(260);
      return mockSearch(query).map(toChannelCard);
    }
  );
}

/** Catálogo da vitrine — existe só no mock, é a demonstração da landing. */
export async function listChannels() {
  await latency(120);
  return CHANNELS.map(toChannelCard);
}

function toChannelCard(c) {
  return {
    id: c.id,
    title: c.title,
    handle: c.handle,
    description: c.description,
    country: c.country,
    accent: c.accent,
    publishedAt: c.publishedAt,
    statistics: c.statistics,
    topicCategories: c.topicCategories,
  };
}

/* ------------------------------------------------------ relatório público */

/**
 * GET /api/channel?id=  →  no backend:
 *   channels.list → playlistItems.list (uploads, paginado) → videos.list (lotes de 50)
 *
 * Campos ausentes na API pública (inscritos por vídeo, views de 48 h, retenção)
 * voltam `null`. O motor detecta e desliga as análises correspondentes — ver
 * `dataCapabilities()` em engine.js.
 */
export async function getPublicReport(channelId) {
  return withFallback(
    async () => {
      const body = await request('/channel', { id: channelId });
      return {
        channel: body.channel,
        analysis: analyze(body.channel, { withPrivate: false }),
        scope: 'public',
        source: 'live',
        fetchedAt: body.fetchedAt,
        cached: !!body.cached,
        stale: !!body.stale,
      };
    },
    async () => {
      await latency();
      const raw = mockGet(channelId);
      if (!raw) return null;
      const channel = CONFIG.simulatePublicOnly ? stripPrivateFields(raw) : raw;
      return {
        channel,
        analysis: analyze(channel, { withPrivate: false }),
        scope: 'public',
        source: 'mock',
      };
    }
  );
}

/** Deixa o canal simulado com exatamente os campos da API pública. */
function stripPrivateFields(channel) {
  return {
    ...channel,
    analytics: undefined,
    videos: channel.videos.map((v) => ({
      ...v,
      subsGained: null,
      views48h: null,
      avgViewPct: null,
      avgViewDurationSec: null,
      ctr: null,
      revenue: null,
    })),
  };
}

/* -------------------------------------------------- dashboard do criador */

/**
 * Ainda simulado: depende de OAuth e da verificação do Google.
 *
 *   GET /youtube/analytics/v2/reports?ids=channel==MINE&metrics=...&dimensions=day
 *
 * Escopos: youtube.readonly, yt-analytics.readonly e yt-analytics-monetary.readonly.
 */
export async function getCreatorReport(channelId) {
  await latency(520);
  const channel = mockGet(channelId);
  if (!channel) return null;
  return { channel, analysis: analyze(channel, { withPrivate: true }), scope: 'private', source: 'mock' };
}

export function ownedChannelId() {
  return OWNED_CHANNEL_ID;
}

/**
 * Simula o fluxo OAuth 2.0. Em produção: redirect com PKCE → troca do code no
 * servidor → refresh token cifrado, que nunca chega ao navegador.
 */
export async function connectGoogleAccount() {
  await latency(900);
  const channel = mockGet(OWNED_CHANNEL_ID);
  return {
    ok: true,
    account: { name: 'Você', email: 'criador@exemplo.com' },
    channels: [toChannelCard(channel)],
    scopes: ['youtube.readonly', 'yt-analytics.readonly', 'yt-analytics-monetary.readonly'],
  };
}

/** Estado do backend — a interface usa para mostrar a origem dos dados. */
export async function backendHealth() {
  try {
    const body = await request('/health', {});
    setMode('live');
    return body;
  } catch (err) {
    setMode(CONFIG.dataSource === 'live' ? 'live' : 'mock', err);
    return null;
  }
}
