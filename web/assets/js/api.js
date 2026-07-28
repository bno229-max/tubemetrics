/**
 * api.js — Camada de acesso a dados.
 *
 * Resolve contra o backend real (`/api/**`, Cloud Functions) quando ele está
 * disponível e cai para `mock-data.js` quando não está. Nenhuma tela sabe qual
 * dos dois respondeu — quem precisa saber lê `currentMode()`.
 *
 * O mapeamento para os endpoints do Google está anotado em cada função.
 */

import { CHANNELS, searchChannels as mockSearch, getChannel as mockGet } from './mock-data.js';
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
export async function searchChannels(query, region = 'BR') {
  return withFallback(
    async () => (await request('/search', { q: query, region })).channels,
    async () => {
      await latency(260);
      return mockSearch(query).map(toChannelCard);
    }
  );
}

/**
 * GET /api/trending?region= — vídeos e canais em alta no país.
 * Sem equivalente no mock: é dado que só existe ao vivo.
 */
export async function trending(region = 'BR') {
  const body = await request('/trending', { region });
  setMode('live');
  return body;
}

/** GET /api/growth?period=7|30|365 — ranking de crescimento por histórico. */
export async function growth(period = 7, limit = 10) {
  try {
    const body = await request('/growth', { period, limit });
    return body;
  } catch (err) {
    // A rota devolve 200 com `ready:false` quando falta histórico; um erro aqui
    // é falha de rede ou de configuração, e a tela precisa saber a diferença.
    return { ready: false, reason: 'unavailable', message: err.message, porViews: [], porInscritos: [], period };
  }
}

/** Catálogo simulado — usado apenas quando o backend não responde. */
export async function listChannels() {
  await latency(120);
  return CHANNELS.map(toChannelCard);
}

/**
 * GET /api/top — ranking por inscritos de uma lista curada de canais reais.
 * Cai para o catálogo simulado quando o backend não está disponível.
 */
export async function topChannels(limit = 20) {
  return withFallback(
    async () => {
      const body = await request('/top', { limit });
      return body.channels;
    },
    async () => {
      await latency(200);
      return [...CHANNELS]
        .map(toChannelCard)
        .sort((a, b) => b.statistics.subscriberCount - a.statistics.subscriberCount)
        .slice(0, limit)
        .map((c, i) => ({ ...c, rank: i + 1 }));
    }
  );
}

function toChannelCard(c) {
  return {
    id: c.id,
    title: c.title,
    handle: c.handle,
    description: c.description,
    country: c.country,
    accent: c.accent,
    thumbnail: c.thumbnail || null,
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
 * GET /api/analytics — dados privados do canal conectado via OAuth real.
 *
 * Sem sessão, o backend devolve 401: aqui isso vira `null`, o mesmo sinal de
 * "ainda não conectou" que a tela já sabia tratar. Qualquer outro erro (500,
 * token revogado, etc.) sobe para a view decidir como mostrar — diferente do
 * modo público, aqui NÃO cai para o mock: exibir números fabricados como se
 * fossem a receita real do usuário seria o pior tipo de mentira que este
 * produto poderia contar.
 */
export async function getCreatorReport() {
  try {
    const body = await request('/analytics', {});
    return {
      channel: body.channel,
      analysis: analyze(body.channel, { withPrivate: true }),
      scope: 'private',
      source: 'live',
      fetchedAt: body.fetchedAt,
    };
  } catch (err) {
    if (err.status === 401) return null; // não conectado, ou sessão expirou/foi revogada
    throw err;
  }
}

/**
 * Início do OAuth real, com PKCE. Precisa ser uma navegação de página inteira
 * — não um fetch — porque o Google exige que o próprio navegador do usuário
 * visite a tela de consentimento.
 */
export function startGoogleConnect() {
  location.href = `${CONFIG.apiBase}/auth/start`;
}

/** Encerra a sessão no servidor: apaga o refresh token cifrado do Firestore. */
export async function disconnectGoogleAccount() {
  try {
    await fetch(`${CONFIG.apiBase}/auth/logout`, { method: 'POST' });
  } catch { /* best-effort — o cookie expira sozinho de qualquer forma */ }
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
