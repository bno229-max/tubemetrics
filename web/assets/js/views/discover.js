/** discover.js — Busca, favoritos e histórico de pesquisa. */

import { avatar, icon, emptyState, toast, sectionCard } from '../ui.js';
import { mountSearch } from './searchbox.js';
import { ensureAuth } from './auth.js';
import { esc, compact, int, relativeDays } from '../format.js';
import { limitOf, can } from '../plans.js';
import * as store from '../store.js';

export default async function discover(root, _params, ctx) {
  const s = store.get();
  const quota = s.quota;
  const favLimit = limitOf(s.plan, 'favorites');

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Descobrir canais</h1>
          </div>
          <div class="actions">
            ${!quota ? '' : quota.limit === Infinity
              ? '<span class="chip chip-pos">Análises ilimitadas</span>'
              : `<span class="chip ${quota.remaining === 0 ? 'chip-neg' : quota.remaining <= 2 ? 'chip-warn' : ''}">
                   ${int(quota.remaining)} ${quota.remaining === 1 ? 'análise restante' : 'análises restantes'}${quota.lifetime ? '' : ' neste mês'}</span>`}
          </div>
        </div>
      </div>

      <div class="search-wrap" style="max-width:520px">
        ${icon('search')}
        <input class="input" type="search" placeholder="Nome do canal ou @handle…" aria-label="Buscar canal" autocomplete="off" data-search-input style="height:42px">
      </div>

      <div data-favorites></div>
      <div data-history></div>
    </div>`;

  mountSearch(root.querySelector('[data-search-input]'), async (c) => {
    if (await ensureAuth()) ctx.navigate(`#/canal/${c.id}`);
  });

  /* ------------------------------------------------------------ favoritos */
  const favHost = root.querySelector('[data-favorites]');
  if (s.favorites.length) {
    favHost.innerHTML = `
      <div class="section">
        <div class="section-head">
          <div>
            <h2>Favoritos</h2>
            <p>${int(s.favorites.length)}${favLimit === Infinity ? '' : ` de ${int(favLimit)}`} canais salvos</p>
          </div>
        </div>
        <div class="grid g3">${s.favorites.map((f) => channelTile(f, true)).join('')}</div>
      </div>`;
  } else if (can(s.plan, 'favorites')) {
    favHost.innerHTML = `
      <div class="section">
        <div class="section-head"><h2>Favoritos</h2></div>
        ${sectionCard({
          body: emptyState({
            title: 'Nenhum canal favoritado',
            note: `Abra um canal e use o botão de favoritar para acompanhá-lo daqui. Seu plano permite ${favLimit === Infinity ? 'favoritos ilimitados' : `${favLimit} favoritos`}.`,
            iconName: 'star',
          }),
        })}
      </div>`;
  }

  /* ------------------------------------------------------------ histórico */
  const histHost = root.querySelector('[data-history]');
  const history = s.history || [];

  histHost.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div>
          <h2>Histórico de pesquisa</h2>
          <p>${history.length
              ? `${int(history.length)} ${history.length === 1 ? 'canal já analisado' : 'canais já analisados'} · reabrir não consome nova análise`
              : 'Os canais que você analisar aparecem aqui'}</p>
        </div>
        ${history.length ? '<button class="btn btn-sm btn-ghost" data-clear>Limpar histórico</button>' : ''}
      </div>
      ${history.length
        ? `<div class="grid g3">${history.map((h) => channelTile(h, false)).join('')}</div>`
        : sectionCard({
            body: emptyState({
              title: 'Seu histórico está vazio',
              note: 'Busque um canal acima para começar. Cada canal analisado fica salvo aqui para consulta rápida.',
              iconName: 'clock',
            }),
          })}
    </div>`;

  histHost.querySelector('[data-clear]')?.addEventListener('click', () => {
    store.clearHistory();
    toast('Histórico limpo', 'success');
    ctx.navigate('#/descobrir');
  });

  root.addEventListener('click', async (e) => {
    const tile = e.target.closest('[data-open]');
    if (!tile) return;
    if (await ensureAuth()) ctx.navigate(`#/canal/${tile.dataset.open}`);
  });
}

/** Cartão compacto de canal, usado em favoritos e no histórico. */
function channelTile(c, isFavorite) {
  return `
    <button class="card" data-open="${esc(c.id)}" style="
      padding:14px;display:flex;align-items:center;gap:12px;text-align:left;
      cursor:pointer;width:100%;font:inherit;color:inherit;">
      ${avatar(c, 44)}
      <span class="grow" style="min-width:0">
        <span style="display:block;font-size:14px;font-weight:600;letter-spacing:-.012em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
        <span class="muted fs12" style="display:block;margin-top:2px">
          ${c.subscriberCount != null ? `${compact(c.subscriberCount)} inscritos` : esc(c.handle || '')}
          ${c.at ? ` · ${relativeDays(c.at)}` : ''}
        </span>
      </span>
      ${isFavorite ? `<span style="color:var(--yt-500)">${icon('star')}</span>` : ''}
      ${!isFavorite ? '<span class="chip chip-pos" style="height:19px;font-size:10px">já analisado</span>' : ''}
    </button>`;
}
