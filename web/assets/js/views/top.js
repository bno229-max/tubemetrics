/** top.js — Ranking dos 20 maiores canais por inscritos. */

import { topChannels } from '../api.js';
import { avatar, icon, sectionCard, gate, emptyState, toast } from '../ui.js';
import { ensureLead } from './signup.js';
import { hBarChart, SERIES_COLORS } from '../charts.js';
import { esc, compact, int, dec } from '../format.js';
import { can, requiredPlan, PLAN_BY_ID } from '../plans.js';
import * as store from '../store.js';

export default async function top(root, _params, ctx) {
  const s = store.get();

  if (!can(s.plan, 'top_channels')) {
    const req = PLAN_BY_ID[requiredPlan('top_channels')];
    root.innerHTML = `<div class="page">
      <div class="page-head"><h1>Top 20 canais</h1>
      <p>Os maiores canais acompanhados pela plataforma, ordenados por inscritos reais.</p></div>
      ${gate(placeholder(), {
        plan: s.plan,
        feature: 'top_channels',
        title: `Ranking disponível no ${req.name}`,
        note: 'Use o ranking para achar referências do seu nicho e comparar seu canal com quem já chegou lá.',
      })}
    </div>`;
    return;
  }

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Top 20 canais por inscritos</h1>
            <p>Seleção de canais brasileiros de grande alcance. Os inscritos vêm da YouTube Data API;
               o recorte de quem entra na lista é editorial.</p>
          </div>
        </div>
      </div>
      <div data-body><div class="skel" style="height:420px;border-radius:14px"></div></div>
    </div>`;

  const body = root.querySelector('[data-body]');
  let canais = [];
  try {
    canais = await topChannels(20);
  } catch {
    canais = [];
  }
  if (ctx.stale()) return;

  if (!canais.length) {
    body.innerHTML = emptyState({
      title: 'Ranking indisponível',
      note: 'Não foi possível carregar os canais agora. Pode ser cota da API esgotada — tente mais tarde.',
      iconName: 'alert',
    });
    return;
  }

  const colors = SERIES_COLORS();
  const totalInscritos = canais.reduce((s2, c) => s2 + c.statistics.subscriberCount, 0);

  body.innerHTML = `
    <div class="grid g3" style="margin-bottom:18px">
      ${miniCard('Canais no ranking', int(canais.length), 'trophy')}
      ${miniCard('Inscritos somados', compact(totalInscritos), 'users')}
      ${miniCard('Maior do ranking', esc(canais[0].title), 'star')}
    </div>

    ${sectionCard({
      title: 'Ranking',
      sub: 'Clique em qualquer canal para abrir o relatório completo',
      pad: false,
      body: `<div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th style="width:52px">#</th><th>Canal</th>
          <th class="n">Inscritos</th><th class="n">Views totais</th>
          <th class="n">Vídeos</th><th class="n">Views por inscrito</th><th></th>
        </tr></thead>
        <tbody>${canais.map((c) => {
          const porInscrito = c.statistics.subscriberCount
            ? c.statistics.viewCount / c.statistics.subscriberCount
            : 0;
          return `<tr data-open="${esc(c.id)}" style="cursor:pointer">
            <td><span class="rank-badge${c.rank <= 3 ? ' top' : ''}">${c.rank}</span></td>
            <td>
              <div class="flex ac g12">
                ${avatar(c, 36)}
                <div style="min-width:0">
                  <div style="font-weight:580;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</div>
                  <div class="muted fs12">${esc(c.handle || c.country || '')}</div>
                </div>
              </div>
            </td>
            <td class="n"><b>${compact(c.statistics.subscriberCount)}</b></td>
            <td class="n">${compact(c.statistics.viewCount)}</td>
            <td class="n muted">${int(c.statistics.videoCount)}</td>
            <td class="n">${dec(porInscrito, 0)}</td>
            <td class="n muted">${icon('chevron')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`,
    })}

    <div class="section">
      ${sectionCard({
        title: 'Inscritos, lado a lado',
        sub: 'A distância entre o topo e o resto costuma ser maior do que parece na tabela',
        body: `<div class="chart" data-chart="bars"></div>`,
      })}
    </div>`;

  hBarChart(body.querySelector('[data-chart="bars"]'), {
    rows: canais.map((c, i) => ({
      label: c.title,
      value: c.statistics.subscriberCount,
      color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Views totais</span><b>${compact(c.statistics.viewCount)}</b></div>
            <div class="tr"><span class="l">Vídeos</span><b>${int(c.statistics.videoCount)}</b></div>`,
    })),
    formatValue: compact,
    labelWidth: 160,
    rowHeight: 30,
  });

  body.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-open]');
    if (!row) return;
    if (await ensureLead()) ctx.navigate(`#/canal/${row.dataset.open}`);
  });
}

function miniCard(label, value, iconName) {
  return `<div class="card" style="padding:15px 16px">
    <div class="flex ac g8" style="color:var(--text-3)">${icon(iconName)}<span class="fs12" style="font-weight:550">${esc(label)}</span></div>
    <div class="num" style="font-size:21px;font-weight:650;letter-spacing:-.025em;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${value}</div>
  </div>`;
}

function placeholder() {
  return `<div class="card"><div class="card-body tight"><table class="tbl">
    <thead><tr><th style="width:52px">#</th><th>Canal</th><th class="n">Inscritos</th><th class="n">Views</th></tr></thead>
    <tbody>${Array.from({ length: 6 }, (_, i) => `
      <tr><td><span class="rank-badge">${i + 1}</span></td><td>•••••••••</td><td class="n">•••</td><td class="n">•••</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
