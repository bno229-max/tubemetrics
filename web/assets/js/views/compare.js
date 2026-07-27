/** compare.js — Comparação lado a lado de canais (recurso Pro). */

import { listChannels, getPublicReport } from '../api.js';
import { icon, avatar, sectionCard, gate, emptyState, toast } from '../ui.js';
import { lineChart, barChart, SERIES_COLORS } from '../charts.js';
import { esc, compact, int, dec, pct, monthLabel } from '../format.js';
import { can } from '../plans.js';
import * as store from '../store.js';

export default async function compare(root, _params, ctx) {
  const st = store.get();

  if (!can(st.plan, 'compare_channels')) {
    root.innerHTML = `<div class="page">
      <div class="page-head"><h1>Comparar canais</h1>
      <p>Coloque até quatro canais lado a lado e veja quem converte melhor, quem publica mais e quem retém mais.</p></div>
      ${gate(placeholderTable(), { plan: st.plan, feature: 'compare_channels', title: 'Comparação de canais é um recurso Pro', note: 'No plano Pro a comparação é ilimitada, inclusive contra concorrentes diretos.' })}
    </div>`;
    return;
  }

  const all = await listChannels();
  if (ctx.stale()) return; // o usuário já navegou para outra rota
  const selected = st.compare.filter((id) => all.some((c) => c.id === id));

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Comparar canais</h1>
            <p>Até quatro canais por vez. Todas as métricas vêm dos mesmos cruzamentos usados no relatório individual.</p>
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px">
        <div class="label" style="margin-bottom:10px">Canais na comparação (${selected.length}/4)</div>
        <div class="flex g8 wrap">
          ${all.map((c) => {
            const on = selected.includes(c.id);
            return `<button class="btn btn-sm" data-toggle="${esc(c.id)}" style="gap:8px;${on ? 'border-color:var(--yt-500);background:var(--yt-soft)' : ''}">
              ${avatar(c, 18)} ${esc(c.title)} ${on ? icon('close') : icon('plus')}
            </button>`;
          }).join('')}
        </div>
      </div>

      <div data-body style="margin-top:22px"></div>
    </div>`;

  root.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.toggle;
      if (!store.get().compare.includes(id) && store.get().compare.length >= 4) {
        return toast('Máximo de 4 canais por comparação', 'error');
      }
      store.toggleCompare(id);
      ctx.navigate('#/comparar');
    });
  });

  const body = root.querySelector('[data-body]');
  if (selected.length < 2) {
    body.innerHTML = emptyState({
      title: 'Escolha ao menos dois canais',
      note: 'Selecione os canais acima para montar o comparativo.',
      iconName: 'compare',
    });
    return;
  }

  body.innerHTML = `<div class="skel" style="height:300px;border-radius:14px"></div>`;
  const reports = await Promise.all(selected.map((id) => getPublicReport(id)));
  if (ctx.stale()) return;
  renderComparison(body, reports);
}

function renderComparison(host, reports) {
  const colors = SERIES_COLORS();
  const items = reports.map((r, i) => ({
    ch: r.channel,
    a: r.analysis,
    color: colors[i % colors.length],
  }));

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
    ['Inscritos por mil views', (x) => x.a.topics.channelSubsPer1k, (v) => dec(v), 'max'],
    ['Retenção média', (x) => x.a.duration.rows.reduce((s, r) => s + r.retention * r.videos, 0) / Math.max(1, x.a.videos.length), (v) => pct(v, 0), 'max'],
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
            ${vals.map((v) => `<td class="n${bestVal !== null && v === bestVal ? '' : ' muted'}">${bestVal !== null && v === bestVal ? `<b>${fmt(v)}</b> <span class="chip chip-pos" style="height:18px;font-size:10px">melhor</span>` : fmt(v)}</td>`).join('')}
          </tr>`;
        }).join('')}</tbody>
      </table></div>`,
    })}

    <div class="section grid g2">
      ${sectionCard({ title: 'Evolução mensal de views', sub: 'Views acumuladas pelos vídeos de cada mês', body: `<div class="chart" data-chart="views" style="min-height:250px"></div>` })}
      ${sectionCard({ title: 'Conversão em inscritos', sub: 'Inscritos por mil views — quem transforma audiência em base', body: `<div class="chart" data-chart="conv" style="min-height:250px"></div>` })}
    </div>

    <div class="section grid g2">
      ${sectionCard({ title: 'Nota geral por pilar', sub: 'Onde cada canal ganha e onde perde', body: `<div class="chart" data-chart="score" style="min-height:250px"></div>` })}
      ${sectionCard({ title: 'Mix de formatos', sub: 'Participação de Shorts nos envios', body: `<div class="chart" data-chart="mix" style="min-height:250px"></div>` })}
    </div>`;

  // Alinha os meses de todos os canais numa linha do tempo comum.
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
    series: [{ name: 'Inscritos / mil views', values: items.map((x) => Math.round(x.a.topics.channelSubsPer1k * 10) / 10), color: colors[0] }],
    height: 250,
    formatY: (v) => dec(v, 0),
    formatValue: (v) => dec(v),
  });

  const pillars = items[0].a.score.pillars.map((p) => p.label);
  barChart(host.querySelector('[data-chart="score"]'), {
    labels: pillars,
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
    <tbody>${['Inscritos', 'Views medianas', 'Envios por semana', 'Inscritos por mil views', 'Nota geral'].map((m) => `
      <tr><td>${m}</td><td class="n">•••</td><td class="n">•••</td><td class="n">•••</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
