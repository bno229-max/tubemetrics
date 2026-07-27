/** ui.js — Primitivas de interface: ícones, cartões, toasts, modais, paywall. */

import { esc, compact, int, duration, relativeDays } from './format.js';
import { can, requiredPlan, PLAN_BY_ID } from './plans.js';
import { sparkline } from './charts.js';

/* --------------------------------------------------------------- ícones */

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="12.5" y="7" width="3" height="10" rx="1"/><rect x="18" y="13" width="3" height="4" rx="1"/>',
  gauge: '<path d="M12 20a8 8 0 1 1 8-8"/><path d="m12 14 4-4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 8.2A3 3 0 0 1 16 14"/><path d="M18 20c0-2.3-.9-4-2.3-5"/>',
  money: '<path d="M12 3v18"/><path d="M16.5 7.5c0-1.7-2-2.5-4.5-2.5S7.5 5.9 7.5 7.9s2 2.6 4.5 3.1 4.5 1.1 4.5 3.1-2 2.9-4.5 2.9-4.5-.8-4.5-2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="2"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  alert: '<path d="M12 4.5 2.8 20h18.4z"/><path d="M12 10v4"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.8 2.8L16 9.5"/>',
  checkSmall: '<path d="m5 12 4.5 4.5L19 7"/>',
  split: '<path d="M4 6h4l4 6 4 6h4"/><path d="M4 18h4l4-6"/><path d="m17 3 3 3-3 3"/><path d="m17 15 3 3-3 3"/>',
  wave: '<path d="M2 12c2.5 0 2.5-6 5-6s2.5 12 5 12 2.5-9 5-9 2.5 3 5 3"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  play: '<path d="M8 5.5 19 12 8 18.5z"/>',
  up: '<path d="m4 16 6-6 4 4 6-7"/><path d="M15 7h5v5"/>',
  down: '<path d="m4 8 6 6 4-4 6 7"/><path d="M15 17h5v-5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  eye: '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  like: '<path d="M7 21V10l4.5-7c1.4 0 2.5 1.1 2.5 2.5V9h4.5c1.4 0 2.4 1.3 2 2.6l-2 7A2.5 2.5 0 0 1 16 20.5H7z"/><path d="M7 10H3v11h4"/>',
  comment: '<path d="M21 12a8.5 8.5 0 0 1-11.9 7.8L3 21l1.3-5.5A8.5 8.5 0 1 1 21 12"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3"/>',
  device: '<rect x="2.5" y="5" width="14" height="10.5" rx="2"/><path d="M6 20h7"/><rect x="18" y="9" width="4" height="11" rx="1.5"/>',
  download: '<path d="M12 3v12"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3.5 12.5 8.5 4.7 8.5-4.7"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.1 7.9 7.5 9 4.4-1.1 7.5-4.5 7.5-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cursor: '<path d="m5 3 6 17 2.5-6.5L20 11z"/>',
  file: '<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 2 2-2 2-2-2-2 2z"/>',
  google: '<path d="M21 12.2c0-.7-.06-1.2-.2-1.8H12v3.4h5.1a4.4 4.4 0 0 1-1.9 2.9v2.4h3.1c1.8-1.7 2.7-4.1 2.7-6.9"/><path d="M12 21.5c2.5 0 4.6-.8 6.2-2.3l-3.1-2.4c-.8.6-2 .9-3.1.9-2.4 0-4.5-1.6-5.2-3.8H3.6v2.5A9.3 9.3 0 0 0 12 21.5"/><path d="M6.8 13.9a5.6 5.6 0 0 1 0-3.6V7.8H3.6a9.3 9.3 0 0 0 0 8.4z"/><path d="M12 6.4c1.4 0 2.6.5 3.6 1.4l2.7-2.7A9 9 0 0 0 12 2.5a9.3 9.3 0 0 0-8.4 5.3l3.2 2.5C7.5 8.1 9.6 6.4 12 6.4"/>',
  compare: '<path d="M12 3v18"/><path d="M5 8H3l3-4 3 4H7v8h2l-3 4-3-4h2z" opacity=".9"/><rect x="14" y="6" width="7" height="12" rx="2"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9"/><path d="M10.5 19.5a2 2 0 0 0 3 0"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 8l4 4-4 4"/><path d="M20 12H10"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".7" fill="currentColor"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 11 6-3v8l-6-3z"/>',
  star: '<path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  starFilled: '<path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11"/><path d="M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11"/><path d="M12 14v3"/><path d="M8.5 20h7"/><path d="M10 17h4l.7 3h-5.4z"/>',
};

/**
 * Ícone inline. Os atributos `width`/`height` são a rede de segurança: um SVG
 * sem dimensão assume 300×150 do CSS default, o que estoura qualquer layout.
 * Regras de CSS mais específicas continuam sobrescrevendo o padrão de 16 px.
 */
export function icon(name, cls = '') {
  const p = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ico-svg${cls ? ` ${cls}` : ''}" aria-hidden="true">${p}</svg>`;
}

/* --------------------------------------------------------------- helpers */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}

/* ---------------------------------------------------------------- toasts */

let toastHost;
export function toast(message, kind = 'info') {
  toastHost ||= (() => {
    const d = document.createElement('div');
    d.className = 'toasts';
    document.body.appendChild(d);
    return d;
  })();
  const t = document.createElement('div');
  t.className = 'toast';
  const color = kind === 'error' ? 'var(--neg)' : kind === 'success' ? 'var(--pos)' : 'var(--info)';
  t.innerHTML = `<span style="color:${color}">${icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info')}</span><span>${esc(message)}</span>`;
  toastHost.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .2s, transform .2s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 220);
  }, 3600);
}

/* ---------------------------------------------------------------- modais */

export function modal({ title, subtitle = '', body, actions = [], width = 520 }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:${width}px" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        ${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}
      </div>
    </div>`;

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  overlay.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = actions[Number(btn.dataset.act)];
      if (!a.onClick || a.onClick() !== false) close();
    });
  });

  document.body.appendChild(overlay);
  overlay.querySelector('.btn')?.focus();
  return { close, root: overlay };
}

/* --------------------------------------------------------------- paywall */

/**
 * Envolve um bloco em véu de bloqueio quando o plano não libera o recurso.
 * O conteúdo real continua no DOM, borrado — o usuário vê que existe algo,
 * que é o que converte. Em produção o servidor não devolveria os dados.
 */
export function gate(html, { plan, feature, title, note }) {
  if (can(plan, feature)) return html;
  const req = requiredPlan(feature);
  const reqName = PLAN_BY_ID[req]?.name || 'Pro';
  return `
    <div class="locked-box">
      <div class="blurred" aria-hidden="true">${html}</div>
      <div class="veil">
        <span class="chip chip-brand">${icon('lock')} Plano ${esc(reqName)}</span>
        <h4>${esc(title || 'Recurso do plano ' + reqName)}</h4>
        ${note ? `<p>${esc(note)}</p>` : ''}
        <button class="btn btn-primary btn-sm" data-nav="#/planos">Ver planos ${icon('arrow')}</button>
      </div>
    </div>`;
}

/* ----------------------------------------------------------------- cards */

export function kpi({ label, value, iconName = 'chart', delta = null, sub = '', spark = null, sparkColor }) {
  const tone = delta == null ? '' : delta > 0.05 ? 'chip-pos' : delta < -0.05 ? 'chip-neg' : '';
  const arrow = delta == null ? '' : delta > 0 ? icon('up') : delta < 0 ? icon('down') : '';
  const deltaTxt = delta == null ? '' :
    `<span class="chip ${tone}" style="gap:3px">${arrow}${Math.abs(delta).toFixed(1).replace('.', ',')}%</span>`;
  return `
    <div class="card kpi">
      ${spark ? sparkline(spark, { color: sparkColor }) : ''}
      <div class="head">${icon(iconName)}<span>${esc(label)}</span></div>
      <div class="metric-value">${value}</div>
      <div class="foot">${deltaTxt}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    </div>`;
}

export function insightCard(ins) {
  return `
    <div class="insight ${esc(ins.tone)}">
      <div class="ico">${icon(ins.icon)}</div>
      <div class="grow">
        <h4>${esc(ins.title)}</h4>
        <p>${esc(ins.body)}</p>
        ${ins.evidence ? `<div class="ev">${icon('info', 'ev-i')} ${esc(ins.evidence)}</div>` : ''}
      </div>
    </div>`;
}

export function sectionCard({ title, sub, actions = '', body, pad = true }) {
  return `
    <div class="card">
      ${title ? `<div class="card-head">
        <div><div class="card-title">${esc(title)}</div>${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}</div>
        ${actions ? `<div class="flex ac g8">${actions}</div>` : ''}
      </div>` : ''}
      <div class="card-body${pad ? '' : ' tight'}">${body}</div>
    </div>`;
}

export function emptyState({ title, note, iconName = 'search', action = '' }) {
  return `<div class="empty"><div class="ico">${icon(iconName)}</div><h3>${esc(title)}</h3><p>${esc(note)}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
}

/* ------------------------------------------------------------- avatares */

/**
 * Avatar do canal: foto real quando a API fornece, iniciais como alternativa.
 *
 * O gradiente fica embaixo da imagem de propósito — se a foto não carregar
 * (perfil removido, hotlink bloqueado), o `onerror` some com o `<img>` e as
 * iniciais aparecem no lugar, sem buraco no layout.
 */
export function avatar(channel, size = 44) {
  const [a, b] = channel.accent || ['#ff0033', '#7a0d3f'];
  const initials = String(channel.title || '?')
    .split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const photo = channel.thumbnail
    ? `<img src="${esc(channel.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer"
         style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
         onerror="this.remove()">`
    : '';
  return `<div class="avatar" style="position:relative;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:linear-gradient(140deg,${a},${b})">${esc(initials)}${photo}</div>`;
}

/** Miniatura sintética — sem imagem externa, o app funciona offline. */
export function thumb(video) {
  const [a, b] = video.accent || ['#ff0033', '#7a0d3f'];
  const seed = video.id.charCodeAt(video.id.length - 1) % 4;
  const angles = [135, 45, 200, 320];
  return `<div class="thumb${video.isShort ? ' short' : ''}" style="background:linear-gradient(${angles[seed]}deg,${a},${b})">
    <span class="dur">${video.isShort ? 'Short' : duration(video.durationSec)}</span>
  </div>`;
}

export function videoCell(video, rank = null) {
  return `<div class="vid-cell">
    ${rank != null ? `<span class="rank-badge${rank === 1 ? ' top' : ''}">${rank}</span>` : ''}
    ${thumb(video)}
    <div class="grow">
      <div class="t">${esc(video.title)}</div>
      <div class="m">${esc(video.topic)} · ${relativeDays(video.publishedAt)}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------- segmentos */

export function segment(name, options, active) {
  return `<div class="segment" data-segment="${esc(name)}" role="tablist">
    ${options.map((o) => `<button role="tab" aria-selected="${o.value === active}" class="${o.value === active ? 'on' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
  </div>`;
}

/* ---------------------------------------------------------------- barras */

export function barCell(value, max, format = compact, color = 'var(--s1)') {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return `<div class="bar-cell"><span>${format(value)}</span><span class="track"><i style="width:${w}%;background:${color}"></i></span></div>`;
}

export const fmtInt = int;
