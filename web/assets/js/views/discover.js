/** discover.js — Busca e catálogo de canais dentro do painel. */

import { listChannels } from '../api.js';
import { avatar, icon, emptyState } from '../ui.js';
import { mountSearch } from './searchbox.js';
import { esc, compact, dateLong } from '../format.js';
import { limitOf } from '../plans.js';
import * as store from '../store.js';

export default async function discover(root, _params, ctx) {
  const s = store.get();
  const quota = limitOf(s.plan, 'searchesPerDay');
  const used = store.searchesToday();
  const remaining = quota === Infinity ? Infinity : Math.max(0, quota - used);

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Descobrir canais</h1>
            <p>Análise pública via YouTube Data API — sem login e sem permissão do dono do canal.
               Inscritos, views, cadência, mix de formatos e o consultor de dados completo.</p>
          </div>
          <div class="actions">
            ${quota === Infinity
              ? '<span class="chip chip-pos">Buscas ilimitadas</span>'
              : `<span class="chip ${remaining === 0 ? 'chip-neg' : remaining <= 1 ? 'chip-warn' : ''}">${remaining} de ${quota} buscas hoje</span>`}
          </div>
        </div>
      </div>

      <div class="search-wrap" style="max-width:520px">
        ${icon('search')}
        <input class="input" type="search" placeholder="Nome do canal, @handle ou nicho…" aria-label="Buscar canal" autocomplete="off" data-search-input style="height:42px">
      </div>

      ${s.recent.length ? `
      <div class="section">
        <div class="section-head"><h2>Consultados recentemente</h2></div>
        <div class="flex g8 wrap">
          ${s.recent.map((r) => `
            <button class="btn btn-sm" data-nav="#/canal/${esc(r.id)}" style="height:34px;gap:8px">
              ${avatar(r, 18)} ${esc(r.title)}
            </button>`).join('')}
        </div>
      </div>` : ''}

      <div class="section">
        <div class="section-head">
          <div>
            <h2>Catálogo de demonstração</h2>
            <p>Quatro canais sintéticos com nichos, ritmos e perfis de monetização diferentes.</p>
          </div>
        </div>
        <div class="grid g2" data-cards></div>
      </div>
    </div>`;

  mountSearch(root.querySelector('[data-search-input]'), (c) => ctx.navigate(`#/canal/${c.id}`));

  const channels = await listChannels();
  if (ctx.stale()) return; // o usuário já navegou para outra rota
  root.querySelector('[data-cards]').innerHTML = channels.map((c) => {
    const perVideo = c.statistics.viewCount / Math.max(1, c.statistics.videoCount);
    return `
    <div class="card" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="flex ac g12">
        ${avatar(c, 46)}
        <div class="grow">
          <div style="font-size:15.5px;font-weight:650;letter-spacing:-.018em">${esc(c.title)}</div>
          <div class="muted fs12" style="margin-top:2px">${esc(c.handle)} · desde ${dateLong(c.publishedAt)}</div>
        </div>
      </div>
      <p class="txt-2 fs13" style="line-height:1.5">${esc(c.description)}</p>
      <div class="grid g3" style="gap:10px">
        ${[
          ['Inscritos', compact(c.statistics.subscriberCount)],
          ['Views totais', compact(c.statistics.viewCount)],
          ['Média/vídeo', compact(perVideo)],
        ].map(([l, v]) => `
          <div style="padding:10px 11px;background:var(--surface-2);border-radius:var(--r-sm)">
            <div class="label" style="font-size:10px">${l}</div>
            <div class="num" style="font-size:16px;font-weight:640;letter-spacing:-.02em;margin-top:3px">${v}</div>
          </div>`).join('')}
      </div>
      <div class="flex g8 wrap">
        ${c.topicCategories.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
      </div>
      <button class="btn btn-primary" data-nav="#/canal/${esc(c.id)}" style="margin-top:auto">
        Analisar canal ${icon('arrow')}
      </button>
    </div>`;
  }).join('');

  if (!channels.length) {
    root.querySelector('[data-cards]').innerHTML = emptyState({ title: 'Nada por aqui', note: 'Nenhum canal disponível.' });
  }
}
