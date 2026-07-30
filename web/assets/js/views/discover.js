/**
 * discover.js — Busca de canais.
 *
 * Só a busca, de propósito. Não há histórico automático do que foi
 * pesquisado: o que o usuário quer guardar ele favorita, e os favoritos
 * aparecem como "Seus canais" na tela de comparação — um lugar só, onde
 * eles de fato servem para alguma coisa.
 */

import { icon } from '../ui.js';
import { mountSearch } from './searchbox.js';
import { ensureAuth } from './auth.js';
import { int } from '../format.js';
import * as store from '../store.js';

export default async function discover(root, _params, ctx) {
  const quota = store.get().quota;

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Descobrir canais</h1>
            <p>Busque qualquer canal do YouTube pelo nome ou @handle.</p>
          </div>
          <div class="actions">
            ${!quota ? '' : quota.limit == null
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

      <p class="muted fs13" style="margin-top:14px;max-width:520px;line-height:1.6">
        ${icon('star')} Favorite um canal para salvá-lo em
        <a href="#/comparar" style="text-decoration:underline">Seus canais</a>.
      </p>
    </div>`;

  mountSearch(root.querySelector('[data-search-input]'), async (c) => {
    if (await ensureAuth()) ctx.navigate(`#/canal/${c.id}`);
  });
}
