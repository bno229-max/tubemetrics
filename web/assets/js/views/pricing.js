/** pricing.js — Planos, matriz de recursos e troca de plano (demo). */

import { PLANS, PLAN_BY_ID } from '../plans.js';
import { icon, toast } from '../ui.js';
import { featureMatrix } from './feature-matrix.js';
import { esc, money } from '../format.js';
import { setAccountPlan } from '../api.js';
import { ensureAuth } from './auth.js';
import * as store from '../store.js';

export default async function pricing(root, _params, ctx) {
  const current = store.get().plan;

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Planos</h1>
          </div>
          <div class="actions"><span class="chip chip-brand">Plano atual: ${esc(PLAN_BY_ID[current].name)}</span></div>
        </div>
      </div>

      <div class="price-grid">
        ${PLANS.map((p) => `
          <div class="card price-card${p.featured ? ' feat' : ''}">
            ${p.featured ? '<span class="tag">Mais popular</span>' : ''}
            <h3>${esc(p.name)}</h3>
            <div class="desc">${esc(p.tagline)}</div>
            <div class="amt"><b>${p.price === 0 ? 'R$ 0' : money(p.price)}</b><span>/mês</span></div>
            <ul>
              ${p.highlights.map((h) => `<li>${icon('checkSmall')}<span>${esc(h)}</span></li>`).join('')}
              ${p.missing.map((h) => `<li class="off">${icon('close')}<span>${esc(h)}</span></li>`).join('')}
            </ul>
            <button class="btn ${p.id === current ? '' : p.featured ? 'btn-primary' : ''}" data-plan="${p.id}" ${p.id === current ? 'disabled' : ''}>
              ${p.id === current ? 'Plano atual' : `Mudar para ${esc(p.name)}`}
            </button>
          </div>`).join('')}
      </div>

      <div class="section">
        ${featureMatrix({ showKeys: true, sub: 'Exatamente o que a tabela de feature flags declara' })}
      </div>

    </div>`;

  root.querySelectorAll('[data-plan]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.dataset.plan;
      if (!(await ensureAuth())) return;
      try {
        const body = await setAccountPlan(id);
        store.setUser(body.user, body.quota);
        toast(`Plano alterado para ${PLAN_BY_ID[id].name}`, 'success');
        ctx.navigate('#/planos');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
