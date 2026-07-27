/** pricing.js — Planos, matriz de recursos e troca de plano (demo). */

import { PLANS, FEATURES, LIMITS, PLAN_BY_ID, can } from '../plans.js';
import { icon, toast, sectionCard } from '../ui.js';
import { esc, int, money0 } from '../format.js';
import * as store from '../store.js';

const LIMIT_LABELS = {
  searchesPerDay: 'Buscas de canal por dia',
  connectedChannels: 'Canais conectados',
  historyDays: 'Histórico disponível',
  comparisonSlots: 'Canais em comparação',
  seats: 'Assentos de equipe',
  topVideos: 'Vídeos por ranking',
};

const fmtLimit = (key, v) => {
  if (v === Infinity) return 'Ilimitado';
  if (key === 'historyDays') return v >= 365 ? `${Math.round(v / 365)} ano${v >= 730 ? 's' : ''}` : `${v} dias`;
  if (v === 0) return '—';
  return int(v);
};

export default async function pricing(root, _params, ctx) {
  const current = store.get().plan;

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Planos</h1>
            <p>O bloqueio de recursos é declarado em um único lugar no código (<code style="font-family:var(--mono);font-size:12.5px">plans.js</code>)
               e consultado por toda a interface. Troque de plano aqui para ver os cadeados abrirem e fecharem em tempo real.</p>
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
            <div class="amt"><b>${p.price === 0 ? 'R$ 0' : money0(p.price)}</b><span>/mês</span></div>
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
        ${sectionCard({
          title: 'Matriz de recursos',
          sub: 'Exatamente o que a tabela de feature flags declara',
          pad: false,
          body: `<div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Recurso</th>${PLANS.map((p) => `<th class="n">${esc(p.name)}</th>`).join('')}</tr></thead>
            <tbody>
              ${Object.entries(FEATURES).map(([key, f]) => `
                <tr><td><b style="font-weight:550">${esc(f.label)}</b>
                  <div class="muted" style="font-family:var(--mono);font-size:11px;margin-top:2px">${esc(key)}</div></td>
                  ${PLANS.map((p) => `<td class="n">${can(p.id, key)
                    ? `<span style="color:var(--pos);display:inline-block;width:16px">${icon('checkSmall')}</span>`
                    : `<span class="muted" style="display:inline-block;width:16px">${icon('close')}</span>`}</td>`).join('')}
                </tr>`).join('')}
              <tr><td colspan="4" style="background:var(--surface-2)"><span class="label">Limites numéricos</span></td></tr>
              ${Object.keys(LIMIT_LABELS).map((key) => `
                <tr><td><b style="font-weight:550">${esc(LIMIT_LABELS[key])}</b>
                  <div class="muted" style="font-family:var(--mono);font-size:11px;margin-top:2px">${esc(key)}</div></td>
                  ${PLANS.map((p) => `<td class="n">${fmtLimit(key, LIMITS[p.id][key])}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table></div>`,
        })}
      </div>

      <div class="section">
        <div class="insight info">
          <div class="ico">${icon('shield')}</div>
          <div class="grow">
            <h4>Flag de cliente é experiência, não segurança</h4>
            <p>Nesta demonstração o bloqueio acontece no navegador. Em produção, a mesma tabela vive no servidor:
               a rota recusa o dado antes de montar a resposta, e o front apenas reflete o que já foi negado.
               Esconder no cliente sem barrar no servidor é convite a inspecionar a rede.</p>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelectorAll('[data-plan]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.plan;
      store.set({ plan: id });
      toast(`Plano alterado para ${PLAN_BY_ID[id].name}`, 'success');
      ctx.navigate('#/planos');
    });
  });
}
