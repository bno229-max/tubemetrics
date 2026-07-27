/**
 * store.js — Estado da sessão com persistência em localStorage.
 *
 * Guarda plano ativo, tema, cadastro, favoritos, histórico de pesquisa e a cota
 * mensal de análises. Publish/subscribe simples: nenhuma tela lê localStorage
 * direto.
 */

import { isValidPlan, limitOf } from './plans.js';

// v2: a cota virou mensal e entraram cadastro, favoritos e histórico. A chave
// nova evita ler um estado antigo com formato incompatível.
const KEY = 'tubemetrics.state.v2';

const DEFAULTS = {
  plan: 'free',
  theme: 'light',
  connected: false,
  connectedChannels: [],
  /** Cadastro do usuário (nome, telefone, e-mail). `null` = ainda não fez. */
  lead: null,
  /** Cota mensal: mês corrente e canais já analisados nele. */
  searchMonth: '',
  searchedIds: [],
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

/* ------------------------------------------------------------- cadastro */

export const hasLead = () => !!state.lead?.email;

export function saveLead({ name, phone, email }) {
  set({ lead: { name, phone, email, at: new Date().toISOString() } });
}

/* ------------------------------------------------------------ cota mensal */

const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Análises já usadas no mês. Zera sozinha na virada. */
export function searchesThisMonth() {
  return state.searchMonth === currentMonth() ? state.searchedIds.length : 0;
}

export function searchQuota() {
  const limit = limitOf(state.plan, 'searchesPerMonth');
  const used = searchesThisMonth();
  return { used, limit, remaining: limit === Infinity ? Infinity : Math.max(0, limit - used) };
}

/** Canal já analisado neste mês não consome cota de novo. */
export function alreadySearched(channelId) {
  return state.searchMonth === currentMonth() && state.searchedIds.includes(channelId);
}

export function consumeSearch(channelId) {
  const m = currentMonth();
  if (state.searchMonth !== m) set({ searchMonth: m, searchedIds: [] });
  if (state.searchedIds.includes(channelId)) return;
  set((s) => ({ searchedIds: [...s.searchedIds, channelId] }));
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
