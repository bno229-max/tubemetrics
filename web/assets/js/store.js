/**
 * store.js — Estado da sessão com persistência em localStorage.
 *
 * Guarda tema, favoritos, histórico de pesquisa e um espelho local da conta
 * logada (`user`/`quota`). A AUTORIDADE de conta/plano/cota é o servidor
 * (`api/auth/*`, `api/quota-consume.js`) — o que fica aqui é só cache para a
 * UI não esperar uma rede a cada repintura. `setUser`/`clearUser` são os
 * únicos pontos que escrevem `user`/`quota`/`plan`, sempre os três juntos,
 * pra nunca ficar com plano e conta dessincronizados.
 */

import { isValidPlan, limitOf } from './plans.js';

// v2: a cota virou mensal e entraram cadastro, favoritos e histórico. A chave
// nova evita ler um estado antigo com formato incompatível.
const KEY = 'tubemetrics.state.v2';

const DEFAULTS = {
  plan: 'free',
  theme: 'light',
  /** Barra lateral recolhida (só ícones), preferência do usuário. */
  navCollapsed: false,
  /** Filtro global de país (ISO 3166-1 alpha-2) usado em busca e rankings. */
  region: 'BR',
  connected: false,
  connectedChannels: [],
  /** Conta logada (nome, e-mail, plano). `null` = ninguém logado ainda. */
  user: null,
  /** Cota vinda do servidor: `{ used, limit, remaining, lifetime }`. */
  quota: null,
  /** Canais analisados, com dados de exibição para o histórico. */
  history: [],
  favorites: [],
  compare: [],
  rpmPreset: 'tech',
  customRpm: null,
  goal: { subscribers: null, deadline: null },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const merged = { ...DEFAULTS, ...saved };
    // Plano gravado por uma versão antiga do empacotamento não existe mais.
    if (!isValidPlan(merged.plan)) merged.plan = 'free';
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();
const listeners = new Set();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* modo privado */ }
}

export const get = () => state;

export function set(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  persist();
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reset() {
  state = { ...DEFAULTS, theme: state.theme };
  persist();
  listeners.forEach((fn) => fn(state));
}

/* ----------------------------------------------------------------- conta */

export const isLoggedIn = () => !!state.user;

/** Único ponto que grava conta: sempre `user` + `quota` + `plan` juntos. */
export function setUser(user, quota) {
  set({ user, quota: quota || null, plan: user.plan });
}

export function clearUser() {
  set({ user: null, quota: null, plan: 'free' });
}

/* --------------------------------------------------- histórico de pesquisa */

/**
 * Guarda o canal analisado. Mantém os dados de exibição (nome, foto, inscritos)
 * para que o histórico carregue sem gastar uma nova chamada de API.
 */
export function pushHistory(channel) {
  const entry = {
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    accent: channel.accent,
    thumbnail: channel.thumbnail || null,
    subscriberCount: channel.statistics?.subscriberCount ?? null,
    videoCount: channel.statistics?.videoCount ?? null,
    viewCount: channel.statistics?.viewCount ?? null,
    at: new Date().toISOString(),
  };
  set((s) => ({ history: [entry, ...s.history.filter((h) => h.id !== channel.id)].slice(0, 24) }));
}

export function clearHistory() {
  set({ history: [] });
}

/* ------------------------------------------------------------- favoritos */

export const isFavorite = (id) => state.favorites.some((f) => f.id === id);

/**
 * Alterna favorito respeitando o teto do plano.
 * Devolve `{ ok, reason }` para a tela explicar a recusa em vez de só ignorar.
 */
export function toggleFavorite(channel) {
  const limit = limitOf(state.plan, 'favorites');
  if (isFavorite(channel.id)) {
    set((s) => ({ favorites: s.favorites.filter((f) => f.id !== channel.id) }));
    return { ok: true, added: false };
  }
  if (limit === 0) return { ok: false, reason: 'plan' };
  if (state.favorites.length >= limit) return { ok: false, reason: 'limit', limit };

  set((s) => ({
    favorites: [
      ...s.favorites,
      {
        id: channel.id,
        title: channel.title,
        handle: channel.handle,
        accent: channel.accent,
        thumbnail: channel.thumbnail || null,
        subscriberCount: channel.statistics?.subscriberCount ?? null,
      },
    ],
  }));
  return { ok: true, added: true };
}

/* ---------------------------------------------------------------- compare */

/** Mesmo contrato do favorito: o teto de slots varia por plano. */
export function toggleCompare(id) {
  const limit = limitOf(state.plan, 'comparisonSlots');
  if (state.compare.includes(id)) {
    set((s) => ({ compare: s.compare.filter((x) => x !== id) }));
    return { ok: true, added: false };
  }
  if (limit === 0) return { ok: false, reason: 'plan' };
  if (state.compare.length >= limit) return { ok: false, reason: 'limit', limit };
  set((s) => ({ compare: [...s.compare, id] }));
  return { ok: true, added: true };
}

/* ------------------------------------------------------------------- tema */

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0c10' : '#ffffff');
}

export function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  set({ theme: next });
  applyTheme(next);
  return next;
}
