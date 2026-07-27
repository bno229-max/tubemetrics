/** format.js — formatação pt-BR compartilhada. Sem estado, sem dependências. */

const nf = new Intl.NumberFormat('pt-BR');
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const int = (n) => nf.format(Math.round(Number(n) || 0));
/** `d` = casas decimais fixas: 0, 1 ou 2. */
export const dec = (n, d = 1) => (d === 0 ? nf0 : d === 2 ? nf2 : nf1).format(Number(n) || 0);
export const money = (n) => brl.format(Number(n) || 0);
export const money0 = (n) => brl0.format(Number(n) || 0);

/** 1.234.567 → "1,2 mi". Usado onde o espaço é curto (KPI, eixo, tabela). */
export function compact(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf1.format(v / 1e9)} bi`;
  if (a >= 1e6) return `${nf1.format(v / 1e6)} mi`;
  if (a >= 1e4) return `${nf.format(Math.round(v / 1e3))} mil`;
  if (a >= 1e3) return `${nf1.format(v / 1e3)} mil`;
  return nf.format(Math.round(v));
}

export function compactMoney(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${nf1.format(v / 1e6)} mi`;
  if (a >= 1e4) return `R$ ${nf.format(Math.round(v / 1e3))} mil`;
  if (a >= 1e3) return `R$ ${nf1.format(v / 1e3)} mil`;
  return brl0.format(v);
}

export const pct = (n, d = 1) => `${dec(n, d)}%`;

/** Variação assinada, para chips de comparação. */
export function delta(n, d = 1) {
  const v = Number(n) || 0;
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${dec(Math.abs(v), d)}%`;
}

export function duration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

/** Minutos → "1,2 mil h" (tempo de exibição sempre é lido em horas). */
export function watchHours(minutes) {
  return `${compact((Number(minutes) || 0) / 60)} h`;
}

const dtShort = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const dtLong = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const dtMonth = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' });

export const dateShort = (d) => dtShort.format(new Date(d)).replace('.', '');
export const dateLong = (d) => dtLong.format(new Date(d));
export const monthLabel = (d) => dtMonth.format(new Date(d)).replace('.', '');

export function relativeDays(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  if (days < 365) return `há ${Math.round(days / 30)} meses`;
  const y = Math.floor(days / 365);
  return `há ${y} ano${y > 1 ? 's' : ''}`;
}

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAYS_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const hourLabel = (h) => `${String(h).padStart(2, '0')}h`;

/** Lista legível: ["a","b","c"] → "a, b e c". */
export function listPt(arr) {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}`;
}

/** Escapa texto vindo de dados antes de entrar em template HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
