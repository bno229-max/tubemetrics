/** compare.js — Comparação lado a lado de canais reais. */

import { getPublicReport, consumeQuota } from '../api.js';
import { icon, avatar, sectionCard, gate, emptyState, toast } from '../ui.js';
import { mountSearch } from './searchbox.js';
import { ensureAuth } from './auth.js';
import { lineChart, barChart, SERIES_COLORS } from '../charts.js';
import { esc, compact, int, dec, pct, monthLabel } from '../format.js';
import { can, limitOf, requiredPlan, PLAN_BY_ID } from '../plans.js';
import * as store from '../store.js';

export default async function compare(root, _params, ctx) {
  const s = store.get();
  const slots = limitOf(s.plan, 'comparisonSlots');

  if (!can(s.plan, 'compare_channels')) {
    const req = PLAN_BY_ID[requiredPlan('compare_channels')];
    root.innerHTML = `<div class="page">
      <div class="page-head"><h1>Comparar canais</h1>
      <p>Coloque canais lado a lado e veja quem converte melhor, quem publica mais e quem retém mais.</p></div>
      ${gate(placeholderTable(), {
        plan: s.plan,
        feature: 'compare_channels',
        title: `Comparação de canais começa no ${req.name}`,
        note: `No ${req.name} você compara até ${limitOf(req.id, 'comparisonSlots')} canais. O Creator permite ${limitOf('creator', 'comparisonSlots')}.`,
      })}
    </div>`;
    return;
  }

  // Só canais já conhecidos entram na adição rápida — evita gastar uma análise
  // com um canal que a pessoa nem chegou a abrir.
  const conhecidos = dedupe([...(s.favorites || []), ...(s.history || [])]);
  const selected = s.compare;

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Comparar canais</h1>
            <p>Até ${int(slots)} canais no seu plano. Todas as métricas vêm dos mesmos cruzamentos do relatório individual.</p>
          </div>
          <div class="actions">
            <span class="chip ${selected.length >= slots ? 'chip-warn' : ''}">${selected.length}/${int(slots)} selecionados</span>
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px">
        <div class="label" style="margin-bottom:9px">Adicionar canal</div>
        <div class="search-wrap" style="max-width:460px">
          ${icon('search')}
          <input class="input" type="search" placeholder="Buscar canal para comparar…" aria-label="Buscar canal" autocomplete="off" data-search-input>
        </div>

        ${conhecidos.length ? `
          <div class="label" style="margin:16px 0 9px">Seus canais</div>
          <div class="flex g8 wrap">
            ${conhecidos.slice(0, 12).map((c) => {
              const on = selected.includes(c.id);
              return `<button class="btn btn-sm" data-toggle="${esc(c.id)}" style="gap:8px;${on ? 'border-color:var(--yt-500);background:var(--yt-soft)' : ''}">
                ${avatar(c, 18)} ${esc(c.title)} ${on ? icon('close') : icon('plus')}
              </button>`;
            }).join('')}
          </div>` : ''}
      </div>

      <div data-body style="margin-top:22px"></div>
    </div>`;

  const add = (id, nome) => {
    const r = store.toggleCompare(id);
    if (!r.ok) {
      toast(`Seu plano compara até ${r.limit} canais. Remova um para adicionar outro.`, 'error');
      return;
    }
    toast(r.added ? `${nome} adicionado` : `${nome} removido`, 'success');
    ctx.navigate('#/comparar');
  };

  mountSearch(root.querySelector('[data-search-input]'), async (c) => {
    if (!(await ensureAuth())) return;
    add(c.id, c.title);
  });

  root.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = conhecidos.find((x) => x.id === b.dataset.toggle);
      add(b.dataset.toggle, c?.title || 'Canal');
    });
  });

  const body = root.querySelector('[data-body]');
  if (selected.length < 2) {
    body.innerHTML = emptyState({
      title: 'Escolha ao menos dois canais',
      note: 'Busque acima ou use um canal do seu histórico para montar o comparativo.',
      iconName: 'compare',
    });
    return;
  }

  body.innerHTML = `<div class="skel" style="height:300px;border-radius:14px"></div>`;

  const reports = await Promise.all(selected.map((id) => getPublicReport(id).catch(() => null)));
  if (ctx.stale()) return;

  const validos = reports.filter(Boolean);
  if (validos.length < 2) {
    body.innerHTML = emptyState({
      title: 'Não foi possível carregar os canais',
      note: 'Um ou mais canais falharam. Pode ser cota da API esgotada — tente novamente mais tarde.',
      iconName: 'alert',
    });
    return;
  }

  // Comparar é analisar: cada canal entra na cota da conta, como qualquer
  // relatório — o servidor já ignora quem foi analisado antes (não gasta de novo).
  for (const r of validos) {
    try {
      const res = await consumeQuota(r.channel.id);
      if (ctx.stale()) return;
      store.set({ quota: res.quota });
    } catch (err) {
      if (ctx.stale()) return;
      if (err.code === 'quotaExceeded') {
        body.innerHTML = emptyState({
          title: 'Sua cota de análises acabou',
          note: 'Assine um plano para continuar comparando novos canais.',
          iconName: 'lock',
          action: '<button class="btn btn-primary" data-nav="#/planos">Ver planos</button>',
        });
        return;
      }
      toast(err.message, 'error');
      return;
    }
    store.pushHistory(r.channel);
  }

  renderComparison(body, validos);
}

const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
};

function renderComparison(host, reports) {
  const colors = SERIES_COLORS();
  const items = reports.map((r, i) => ({ ch: r.channel, a: r.analysis, color: colors[i % colors.length] }));

  const metrics = [
    ['Inscritos', (x) => x.ch.statistics.subscriberCount, compact, 'max'],
    ['Views totais', (x) => x.ch.statistics.viewCount, compact, 'max'],
    ['Vídeos publicados', (x) => x.ch.statistics.videoCount, int, 'max'],
    ['Views medianas por vídeo', (x) => x.a.viewsPerVideo.median, compact, 'max'],
    ['Views médias por vídeo', (x) => x.a.viewsPerVideo.mean, compact, 'max'],
    ['Envios por semana', (x) => x.a.cadence.perWeek, (v) => dec(v), 'max'],
    ['Intervalo mediano (dias)', (x) => x.a.cadence.medianDays, (v) => dec(v), 'min'],
    ['Regularidade', (x) => x.a.cadence.regularity * 100, (v) => pct(v, 0), 'max'],
    ['Shorts (% dos envios)', (x) => x.a.format.shorts.countShare * 100, (v) => pct(v, 0), null],
    ['Conversão por mil views', (x) => x.a.topics.channelSubsPer1k, (v) => dec(v), 'max'],
    ['Nota geral', (x) => x.a.score.total, (v) => int(v), 'max'],
  ];

  host.innerHTML = `
    ${sectionCard({
      title: 'Quadro comparativo',
      sub: 'Melhor valor de cada linha destacado',
      pad: false,
      body: `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Métrica</th>${items.map((x) => `<th class="n">${esc(x.ch.title)}</th>`).join('')}</tr></thead>
        <tbody>${metrics.map(([label, get, fmt, dir]) => {
          const vals = items.map(get);
          const bestVal = dir === 'max' ? Math.max(...vals) : dir === 'min' ? Math.min(...vals) : null;
          return `<tr><td><b style="font-weight:560">${esc(label)}</b></td>
            ${vals.map((v) => `<td class="n${bestVal !== null && v === bestVal ? '' : ' muted'}">${
              bestVal !== null && v === bestVal
                ? `<b>${fmt(v)}</b> <span class="chip chip-pos" style="height:18px;font-size:10px">melhor</span>`
                : fmt(v)}</td>`).join('')}
          </tr>`;
        }).join('')}</tbody>
      </table></div>`,
    })}

    <div class="section grid g2">
      ${sectionCard({ title: 'Evolução mensal de views', sub: 'Views acumuladas pelos vídeos de cada mês', body: `<div class="chart" data-chart="views" style="min-height:250px"></div>` })}
      ${sectionCard({ title: 'Conversão de audiência', sub: 'Por mil views — quem transforma alcance em resposta', body: `<div class="chart" data-chart="conv" style="min-height:250px"></div>` })}
    </div>

    <div class="section grid g2">
      ${sectionCard({ title: 'Nota geral por pilar', sub: 'Onde cada canal ganha e onde perde', body: `<div class="chart" data-chart="score" style="min-height:250px"></div>` })}
      ${sectionCard({ title: 'Mix de formatos', sub: 'Participação de Shorts nos envios', body: `<div class="chart" data-chart="mix" style="min-height:250px"></div>` })}
    </div>`;

  const months = [...new Set(items.flatMap((x) => x.a.monthly.map((m) => m.month)))].sort().slice(-12);
  lineChart(host.querySelector('[data-chart="views"]'), {
    labels: months.map((m) => monthLabel(`${m}-01`)),
    series: items.map((x) => ({
      name: x.ch.title,
      color: x.color,
      area: false,
      values: months.map((m) => x.a.monthly.find((r) => r.month === m)?.views ?? 0),
    })),
    height: 250,
    formatY: compact,
    formatValue: (v) => int(v),
  });

  barChart(host.querySelector('[data-chart="conv"]'), {
    labels: items.map((x) => x.ch.title),
    series: [{ name: 'Por mil views', values: items.map((x) => Math.round(x.a.topics.channelSubsPer1k * 10) / 10), color: colors[0] }],
    height: 250,
    formatY: (v) => dec(v, 0),
    formatValue: (v) => dec(v),
  });

  barChart(host.querySelector('[data-chart="score"]'), {
    labels: items[0].a.score.pillars.map((p) => p.label),
    series: items.map((x) => ({
      name: x.ch.title,
      color: x.color,
      values: x.a.score.pillars.map((p) => Math.round((p.score / p.max) * 100)),
    })),
    height: 250,
    formatY: (v) => `${v}%`,
    formatValue: (v) => `${v}% do pilar`,
  });

  barChart(host.querySelector('[data-chart="mix"]'), {
    labels: items.map((x) => x.ch.title),
    series: [
      { name: 'Shorts', values: items.map((x) => Math.round(x.a.format.shorts.countShare * 100)), color: colors[0] },
      { name: 'Vídeos longos', values: items.map((x) => Math.round(x.a.format.longs.countShare * 100)), color: colors[1] },
    ],
    height: 250,
    formatY: (v) => `${v}%`,
    formatValue: (v) => `${v}% dos envios`,
  });
}

function placeholderTable() {
  return `<div class="card"><div class="card-body tight"><table class="tbl">
    <thead><tr><th>Métrica</th><th class="n">Canal A</th><th class="n">Canal B</th><th class="n">Canal C</th></tr></thead>
    <tbody>${['Inscritos', 'Views medianas', 'Envios por semana', 'Conversão por mil views', 'Nota geral'].map((m) => `
      <tr><td>${m}</td><td class="n">•••</td><td class="n">•••</td><td class="n">•••</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
