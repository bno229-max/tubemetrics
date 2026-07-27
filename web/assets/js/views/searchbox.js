/** searchbox.js — Busca de canais com sugestões, reutilizada em várias telas. */

import { searchChannels, topChannels } from '../api.js';
import { avatar, icon } from '../ui.js';
import { esc, compact } from '../format.js';

const PANEL_CSS = `
  position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:60;
  background:var(--bg-elevated);border:1px solid var(--border-strong);
  border-radius:var(--r);box-shadow:var(--sh-3);overflow:hidden;padding:5px;
`;

/**
 * @param {HTMLInputElement} input
 * @param {(channel) => void} onPick
 */
export function mountSearch(input, onPick) {
  const wrap = input.closest('.search-wrap') || input.parentElement;
  wrap.style.position = 'relative';

  const panel = document.createElement('div');
  panel.setAttribute('style', PANEL_CSS);
  panel.hidden = true;
  panel.setAttribute('role', 'listbox');
  wrap.appendChild(panel);

  let items = [];
  let cursor = -1;
  let token = 0;

  const close = () => { panel.hidden = true; cursor = -1; };

  const paint = () => {
    if (!items.length) {
      panel.innerHTML = `<div style="padding:14px;color:var(--text-3);font-size:13px;text-align:center">Nenhum canal encontrado</div>`;
      return;
    }
    panel.innerHTML = items.map((c, i) => `
      <button role="option" aria-selected="${i === cursor}" data-i="${i}" style="
        display:flex;align-items:center;gap:10px;width:100%;text-align:left;
        padding:8px 9px;border:0;border-radius:8px;cursor:pointer;
        background:${i === cursor ? 'var(--surface-2)' : 'transparent'};">
        ${avatar(c, 30)}
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:13.5px;font-weight:580;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
          <span style="display:block;font-size:11.5px;color:var(--text-3)">${esc(c.handle)} · ${compact(c.statistics.subscriberCount)} inscritos</span>
        </span>
        <span style="color:var(--text-3);width:14px">${icon('chevron')}</span>
      </button>`).join('');
  };

  const run = async (q) => {
    const mine = ++token;
    // Campo vazio mostra canais grandes de verdade, não o catálogo simulado:
    // sugestão que não leva a lugar nenhum é pior que nenhuma sugestão.
    const res = q.trim() ? await searchChannels(q) : await topChannels(6);
    if (mine !== token) return;
    items = res.slice(0, 6);
    cursor = -1;
    panel.hidden = false;
    paint();
  };

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => run(input.value), 160);
  });
  input.addEventListener('focus', () => run(input.value));

  input.addEventListener('keydown', (e) => {
    if (panel.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = items[cursor >= 0 ? cursor : 0];
      if (c) { close(); onPick(c); }
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  panel.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    e.preventDefault();
    close();
    onPick(items[Number(btn.dataset.i)]);
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  return { close };
}
