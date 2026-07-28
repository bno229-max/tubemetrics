/**
 * feature-matrix.js — Tabela comparativa de recursos e limites.
 *
 * Vive num módulo próprio porque aparece em dois lugares: na página de vendas
 * e na tela de planos. Duplicar o markup garantiria que uma das duas ficasse
 * desatualizada no primeiro ajuste de empacotamento.
 */

import { PLANS, FEATURES, LIMITS, can } from '../plans.js';
import { icon, sectionCard } from '../ui.js';
import { esc, int } from '../format.js';

const LIMIT_LABELS = {
  searchesPerMonth: 'Análises de canal por mês',
  favorites: 'Canais favoritos',
  comparisonSlots: 'Canais em comparação',
  connectedChannels: 'Canais conectados',
  historyDays: 'Histórico disponível',
  topVideos: 'Vídeos por ranking',
};

const fmtLimit = (key, v) => {
  if (v === Infinity) return 'Ilimitado';
  if (key === 'historyDays') return v >= 365 ? `${Math.round(v / 365)} ano${v >= 730 ? 's' : ''}` : `${v} dias`;
  if (v === 0) return '—';
  return int(v);
};

/**
 * @param {object} o
 * @param {boolean} [o.showKeys] mostra o nome técnico da flag (útil no painel,
 *   ruído na página de vendas).
 */
export function featureMatrix({ showKeys = false, title = 'Matriz de recursos', sub = '' } = {}) {
  const sim = `<span style="color:var(--pos);display:inline-block;width:16px">${icon('checkSmall')}</span>`;
  const nao = `<span class="muted" style="display:inline-block;width:16px">${icon('close')}</span>`;

  return sectionCard({
    title,
    sub,
    pad: false,
    body: `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Recurso</th>${PLANS.map((p) => `<th class="n">${esc(p.name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${Object.entries(FEATURES).map(([key, f]) => `
          <tr>
            <td><b style="font-weight:550">${esc(f.label)}</b>
              ${showKeys ? `<div class="muted" style="font-family:var(--mono);font-size:11px;margin-top:2px">${esc(key)}</div>` : ''}</td>
            ${PLANS.map((p) => `<td class="n">${can(p.id, key) ? sim : nao}</td>`).join('')}
          </tr>`).join('')}

        <tr><td colspan="${PLANS.length + 1}" style="background:var(--surface-2)"><span class="label">Limites numéricos</span></td></tr>

        ${Object.keys(LIMIT_LABELS).map((key) => `
          <tr>
            <td><b style="font-weight:550">${esc(LIMIT_LABELS[key])}</b>
              ${showKeys ? `<div class="muted" style="font-family:var(--mono);font-size:11px;margin-top:2px">${esc(key)}</div>` : ''}</td>
            ${PLANS.map((p) => `<td class="n">${fmtLimit(key, LIMITS[p.id][key])}</td>`).join('')}
          </tr>`).join('')}
      </tbody>
    </table></div>`,
  });
}
