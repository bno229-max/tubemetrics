/**
 * store.js — Estado da sessão com persistência em localStorage.
 *
 * Guarda plano ativo, tema, canais consultados e a cota diária de buscas do
 * plano Grátis. Publish/subscribe simples: nenhuma tela lê localStorage direto.
 */

const KEY = 'tubemetrics.state.v1';

const DEFAULTS = {
  plan: 'free',
  theme: 'light',
  connected: false,
  connectedChannels: [],
  searchDate: '',
  searchCount: 0,
  searchedIds: [],
  recent: [],
  compare: [],
  rpmPreset: 'tech',
  customRpm: null,
  goal: { subscribers: null, deadline: null },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
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

/* ------------------------------------------------------------ cota diária */

const today = () => new Date().toISOString().slice(0, 10);

/** Buscas já usadas hoje. Zera automaticamente na virada do dia. */
export function searchesToday() {
  if (state.searchDate !== today()) return 0;
  return state.searchCount;
}

/** Canais já analisados hoje não consomem cota de novo. */
export function consumeSearch(channelId) {
  const d = today();
  if (state.searchDate !== d) {
    set({ searchDate: d, searchCount: 0, searchedIds: [] });
  }
  if (state.searchedIds.includes(channelId)) return;
  set((s) => ({ searchCount: s.searchCount + 1, searchedIds: [...s.searchedIds, channelId] }));
}

export function alreadySearched(channelId) {
  return state.searchDate === today() && state.searchedIds.includes(channelId);
}

/* ---------------------------------------------------------------- recentes */

export function pushRecent(channel) {
  set((s) => ({
    recent: [
      { id: channel.id, title: channel.title, handle: channel.handle, accent: channel.accent },
      ...s.recent.filter((r) => r.id !== channel.id),
    ].slice(0, 6),
  }));
}

/* ---------------------------------------------------------------- compare */

export function toggleCompare(id) {
  set((s) => ({
    compare: s.compare.includes(id) ? s.compare.filter((x) => x !== id) : [...s.compare, id].slice(-4),
  }));
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
