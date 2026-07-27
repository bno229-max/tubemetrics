/** public-report.js — Relatório de análise pública de um canal (Modo A). */

import { getPublicReport } from '../api.js';
import {
  icon, avatar, kpi, insightCard, sectionCard, segment, videoCell, barCell, gate, toast, emptyState,
} from '../ui.js';
import { lineChart, barChart, hBarChart, donutChart, scoreDial, SERIES_COLORS } from '../charts.js';
import {
  esc, compact, int, dec, pct, money, money0, compactMoney, duration, dateLong,
  monthLabel, relativeDays, WEEKDAYS, hourLabel, listPt,
} from '../format.js';
import { estimateEarnings, recentViewsByFormat, RPM_PRESETS } from '../engine.js';
import { can, limitOf, PLAN_BY_ID } from '../plans.js';
import * as store from '../store.js';

const TABS = [
  { id: 'visao', label: 'Visão geral' },
  { id: 'conteudo', label: 'Conteúdo' },
  { id: 'consultor', label: 'Consultor de dados' },
  { id: 'ganhos', label: 'Estimativa de ganhos' },
];

export default async function publicReport(root, params, ctx) {
  const { id, tab = 'visao' } = params;
  const s = store.get();

  /* --- cota do plano Grátis ------------------------------------------- */
  const quota = limitOf(s.plan, 'searchesPerDay');
  const isNew = !store.alreadySearched(id);
  if (quota !== Infinity && isNew && store.searchesToday() >= quota) {
    root.innerHTML = quotaWall(quota);
    return;
  }

  root.innerHTML = `<div class="page">${loadingSkeleton()}</div>`;

  const report = await getPublicReport(id);
  if (ctx.stale()) return; // o usuário já navegou para outra rota
  if (!report) {
    root.innerHTML = `<div class="page">${emptyState({ title: 'Canal não encontrado', note: 'Verifique o identificador e tente de novo.', action: '<button class="btn btn-primary" data-nav="#/descobrir">Voltar à busca</button>' })}</div>`;
    return;
  }

  store.consumeSearch(id);
  store.pushRecent(report.channel);

  const { channel: ch, analysis: a } = report;
  const inCompare = store.get().compare.includes(id);

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="ch-head">
          ${avatar(ch, 62)}
          <div class="meta">
            <h1>${esc(ch.title)} <span class="chip chip-brand">${icon('shield')} Dados públicos</span></h1>
            <div class="handle">${esc(ch.handle)} · ${esc(ch.description)}</div>
            <div class="facts">
              <span class="chip">${icon('users')} ${compact(ch.statistics.subscriberCount)} inscritos</span>
              <span class="chip">${icon('eye')} ${compact(ch.statistics.viewCount)} views</span>
              <span class="chip">${icon('video')} ${int(ch.statistics.videoCount)} vídeos</span>
              <span class="chip">${icon('calendar')} desde ${dateLong(ch.publishedAt)}</span>
              <span class="chip">${icon('globe')} ${esc(ch.country)}</span>
            </div>
          </div>
          <div class="actions" style="align-self:flex-start">
            <button class="btn btn-sm" data-compare>${icon('compare')} ${inCompare ? 'Na comparação' : 'Comparar'}</button>
            <button class="btn btn-primary btn-sm" data-nav="#/criador">${icon('google')} Conectar meu canal</button>
          </div>
        </div>
      </div>

      ${sourceBanner(report, a)}
      <div style="margin-bottom:20px">${segment('tab', TABS.map((t) => ({ value: t.id, label: t.label })), tab)}</div>
      <div data-tab-body></div>
    </div>`;

  const body = root.querySelector('[data-tab-body]');
  const renderers = { visao: tabOverview, conteudo: tabContent, consultor: tabAdvisor, ganhos: tabEarnings };
  (renderers[tab] || tabOverview)(body, ch, a, ctx);

  root.querySelector('[data-segment="tab"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (b) ctx.navigate(`#/canal/${id}/${b.dataset.value}`);
  });

  root.querySelector('[data-compare]').addEventListener('click', () => {
    if (!can(store.get().plan, 'compare_channels')) {
      toast('Comparação de canais é um recurso do plano Pro', 'error');
      return ctx.navigate('#/planos');
    }
    store.toggleCompare(id);
    const now = store.get().compare.includes(id);
    toast(now ? `${ch.title} adicionado à comparação` : `${ch.title} removido da comparação`, 'success');
    ctx.navigate(`#/canal/${id}/${tab}`);
  });
}

/**
 * Faixa de procedência dos dados.
 *
 * Existe porque o mesmo relatório pode vir de três origens muito diferentes —
 * API real, cache, ou dados de demonstração — e confundir as três é o jeito
 * mais rápido de alguém tomar uma decisão de conteúdo baseada em ficção.
 */
function sourceBanner(report, a) {
  const caps = a.capabilities;
  const faltando = [
    !caps.subsPerVideo && 'inscritos por vídeo',
    !caps.early48h && 'desempenho das primeiras 48 h',
    !caps.retention && 'retenção de audiência',
  ].filter(Boolean);

  if (report.source === 'mock') {
    return `<div class="insight info" style="margin-bottom:18px">
      <div class="ico">${icon('info')}</div>
      <div class="grow">
        <h4>Dados de demonstração</h4>
        <p>Este canal é sintético e serve para exercitar a interface. Configure a chave da YouTube Data API
           no backend para analisar canais reais — o passo a passo está no <code style="font-family:var(--mono);font-size:12px">SETUP.md</code>.</p>
      </div>
    </div>`;
  }

  const quando = report.fetchedAt ? ` · coletado ${relativeDays(report.fetchedAt)}` : '';
  return `<div class="insight ${report.stale ? 'warn' : 'pos'}" style="margin-bottom:18px">
    <div class="ico">${icon(report.stale ? 'alert' : 'check')}</div>
    <div class="grow">
      <h4>Dados reais da YouTube Data API${report.cached ? ' (em cache)' : ''}</h4>
      <p>${report.stale
          ? 'A cota do dia acabou, então estamos mostrando a última coleta bem-sucedida.'
          : `Métricas públicas do canal${quando}.`}
        ${faltando.length
          ? `A API pública não expõe ${listPt(faltando)} — essas análises ficam disponíveis quando o dono conecta o canal, ou depois que o histórico diário for coletado.`
          : ''}</p>
    </div>
  </div>`;
}

/* ==========================================================================
   Aba 1 — Visão geral
   ========================================================================== */

function tabOverview(host, ch, a, ctx) {
  const vpv = a.viewsPerVideo;
  const monthly = a.monthly;
  const fmt = a.format;
  const plan = store.get().plan;

  host.innerHTML = `
    <div class="grid g4">
      ${kpi({ label: 'Inscritos', value: compact(ch.statistics.subscriberCount), iconName: 'users', sub: `${int(ch.statistics.subscriberCount)} no total` })}
      ${kpi({ label: 'Views totais', value: compact(ch.statistics.viewCount), iconName: 'eye', sub: `${compact(ch.statistics.viewCount / Math.max(1, a.ageDays / 365))} por ano em média` })}
      ${kpi({ label: 'Média de views por vídeo', value: compact(vpv.mean), iconName: 'chart', sub: `mediana: ${compact(vpv.median)}`, spark: monthly.map((m) => m.medianViews) })}
      ${kpi({ label: 'Ritmo de publicação', value: `${dec(a.cadence.perWeek)}/sem`, iconName: 'calendar', sub: `1 vídeo a cada ${dec(a.cadence.medianDays)} dias` })}
    </div>

    <div class="section grid g-2-1">
      ${sectionCard({
        title: 'Evolução mensal',
        sub: 'Views acumuladas pelos vídeos publicados em cada mês e volume de envios',
        actions: `<span class="chip"><i style="width:8px;height:8px;border-radius:2px;background:var(--s1);display:inline-block"></i> Views</span>
                  <span class="chip"><i style="width:8px;height:8px;border-radius:2px;background:var(--s2);display:inline-block"></i> Envios</span>`,
        body: `<div class="chart" data-chart="monthly" style="min-height:240px"></div>
               <div class="chart" data-chart="uploads" style="min-height:120px;margin-top:6px"></div>`,
      })}
      ${sectionCard({
        title: 'Nota geral do canal',
        sub: 'Quatro pilares, 100 pontos, fórmula aberta',
        body: `<div class="score-wrap" style="flex-direction:column;align-items:stretch;gap:18px">
          <div style="display:flex;justify-content:center"><div class="score-dial" data-dial>
            <div class="val"><b>${a.score.total}</b><span>${esc(a.score.grade.label)}</span></div>
          </div></div>
          <div class="score-bars">
            ${a.score.pillars.map((p) => `
              <div class="row" title="${esc(p.hint)}">
                <div class="top"><span>${esc(p.label)}</span><b>${Math.round(p.score)}<span class="muted" style="font-weight:500">/${p.max}</span></b></div>
                <div class="track"><i style="width:${(p.score / p.max) * 100}%;background:${pillarColor(p.score / p.max)}"></i></div>
                <div class="muted" style="font-size:11.5px;margin-top:4px">${esc(p.detail)}</div>
              </div>`).join('')}
          </div>
        </div>`,
      })}
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <h2>Leitura automática dos dados</h2>
          <p>Cada card abaixo é o resultado de um cruzamento aritmético — a evidência que o sustenta vem junto.</p>
        </div>
        <span class="chip chip-brand">${icon('shield')} sem IA</span>
      </div>
      <div class="grid g2">
        ${a.insights.slice(0, 4).map(insightCard).join('') || emptyState({ title: 'Sem sinais fortes', note: 'O canal não apresentou desvios relevantes nos cruzamentos.' })}
      </div>
      ${a.insights.length > 4 ? `<div style="margin-top:12px"><button class="btn btn-sm" data-nav="#/canal/${esc(ch.id)}/consultor">Ver os ${a.insights.length} achados ${icon('arrow')}</button></div>` : ''}
    </div>

    <div class="section grid g2">
      ${sectionCard({
        title: 'Shorts × vídeos longos',
        sub: 'Proporção de envios e o que cada formato entrega',
        body: `<div class="grid g2" style="gap:18px;align-items:center">
          <div class="chart" data-chart="format"></div>
          <div>
            <div class="legend" style="margin-bottom:16px">
              <div class="item"><span class="dot" style="background:var(--s1)"></span><span class="nm">Shorts</span><span class="vl">${int(fmt.shorts.count)}</span><span class="pc">${pct(fmt.shorts.countShare * 100, 0)}</span></div>
              <div class="item"><span class="dot" style="background:var(--s2)"></span><span class="nm">Vídeos longos</span><span class="vl">${int(fmt.longs.count)}</span><span class="pc">${pct(fmt.longs.countShare * 100, 0)}</span></div>
            </div>
            <table class="tbl" style="font-size:12.5px">
              <tbody>
                <tr><td class="muted">Views (participação)</td><td class="n">${pct(fmt.shorts.viewShare * 100, 0)} · ${pct(fmt.longs.viewShare * 100, 0)}</td></tr>
                <tr><td class="muted">Mediana de views</td><td class="n">${compact(fmt.shorts.medianViews)} · ${compact(fmt.longs.medianViews)}</td></tr>
                ${a.capabilities.subsPerVideo
                  ? `<tr><td class="muted">Inscritos / mil views</td><td class="n">${dec(fmt.shorts.subsPer1k)} · ${dec(fmt.longs.subsPer1k)}</td></tr>`
                  : ''}
              </tbody>
            </table>
            <p class="muted fs12" style="margin-top:10px">Valores no formato <b>Shorts · Longos</b>.${
              a.capabilities.subsPerVideo
                ? ' Inscritos por mil views é a métrica de conversão — não o total absoluto.'
                : ' Shorts são identificados por duração de até 60 s, a única pista que a API pública oferece.'
            }</p>
          </div>
        </div>`,
      })}
      ${sectionCard({
        title: 'Frequência de postagem',
        sub: 'Distribuição dos intervalos entre envios consecutivos',
        body: `<div class="grid g2" style="gap:12px;margin-bottom:16px">
            ${miniStat('Intervalo mediano', `${dec(a.cadence.medianDays)} dias`)}
            ${miniStat('Envios por semana', dec(a.cadence.perWeek))}
            ${miniStat('Regularidade', pct(a.cadence.regularity * 100, 0), a.cadence.regularity > 0.6 ? 'pos' : a.cadence.regularity > 0.35 ? 'warn' : 'neg')}
            ${miniStat('Maior hiato', `${Math.round(a.cadence.longestGapDays)} dias`)}
          </div>
          <div class="chart" data-chart="intervals" style="min-height:150px"></div>`,
      })}
    </div>`;

  /* --- gráficos ------------------------------------------------------- */
  const colors = SERIES_COLORS();
  const labels = monthly.map((m) => monthLabel(m.date));

  lineChart(host.querySelector('[data-chart="monthly"]'), {
    labels,
    series: [{ name: 'Views', values: monthly.map((m) => m.views) }],
    height: 210,
    formatY: compact,
    formatValue: (v) => int(v),
  });

  barChart(host.querySelector('[data-chart="uploads"]'), {
    labels,
    series: [{ name: 'Envios', values: monthly.map((m) => m.uploads), color: colors[1] }],
    height: 110,
    formatY: (v) => int(v),
    formatValue: (v) => `${int(v)} vídeos`,
  });

  scoreDial(host.querySelector('[data-dial]'), { value: a.score.total });

  donutChart(host.querySelector('[data-chart="format"]'), {
    data: [
      { label: 'Shorts', value: fmt.shorts.count, color: colors[0] },
      { label: 'Vídeos longos', value: fmt.longs.count, color: colors[1] },
    ],
    size: 160,
    centerTop: pct(fmt.shorts.countShare * 100, 0),
    centerSub: 'SHORTS',
  });

  // Histograma de intervalos em faixas de dias.
  const buckets = [
    { label: '≤ 1 d', test: (d) => d <= 1 },
    { label: '1–2 d', test: (d) => d > 1 && d <= 2 },
    { label: '2–4 d', test: (d) => d > 2 && d <= 4 },
    { label: '4–7 d', test: (d) => d > 4 && d <= 7 },
    { label: '7–14 d', test: (d) => d > 7 && d <= 14 },
    { label: '> 14 d', test: (d) => d > 14 },
  ];
  barChart(host.querySelector('[data-chart="intervals"]'), {
    labels: buckets.map((b) => b.label),
    series: [{ name: 'Envios', values: buckets.map((b) => a.cadence.intervals.filter(b.test).length), color: colors[2] }],
    height: 150,
    formatY: (v) => int(v),
    formatValue: (v) => `${int(v)} envios`,
  });
}

const pillarColor = (frac) =>
  frac >= 0.75 ? 'var(--pos)' : frac >= 0.5 ? 'var(--info)' : frac >= 0.3 ? 'var(--warn)' : 'var(--neg)';

function miniStat(label, value, tone = '') {
  const color = tone === 'pos' ? 'var(--pos)' : tone === 'warn' ? 'var(--warn)' : tone === 'neg' ? 'var(--neg)' : 'var(--text)';
  return `<div style="padding:11px 12px;background:var(--surface-2);border-radius:var(--r-sm)">
    <div class="label" style="font-size:10px">${esc(label)}</div>
    <div class="num" style="font-size:17px;font-weight:640;letter-spacing:-.022em;margin-top:3px;color:${color}">${value}</div>
  </div>`;
}

/* ==========================================================================
   Aba 2 — Conteúdo
   ========================================================================== */

const RANK_METRICS = [
  { value: 'views', label: 'Views' },
  { value: 'subsGained', label: 'Inscritos' },
  { value: 'likes', label: 'Curtidas' },
  { value: 'avgViewPct', label: 'Retenção' },
];

function tabContent(host, ch, a, ctx) {
  const plan = store.get().plan;
  const cap = limitOf(plan, 'topVideos');
  const colors = SERIES_COLORS();

  host.innerHTML = `
    <div class="section" style="margin-top:0">
      ${sectionCard({
        title: 'Ranking de vídeos',
        sub: `${int(a.videos.length)} vídeos analisados · ordenação por métrica`,
        actions: segment('rank', RANK_METRICS, 'views'),
        pad: false,
        body: `<div class="tbl-wrap" data-rank-table></div>`,
      })}
    </div>

    <div class="section grid g2">
      ${sectionCard({
        title: 'Categorias mais publicadas',
        sub: 'Agrupamento por tema declarado nos metadados',
        body: `<div class="chart" data-chart="topics"></div>`,
      })}
      ${sectionCard({
        title: 'Views medianas por tema',
        sub: 'Mediana neutraliza o efeito de um único viral',
        body: `<div class="chart" data-chart="topic-views"></div>`,
      })}
    </div>

    <div class="section">
      ${sectionCard({
        title: 'Desempenho por faixa de duração',
        sub: 'A mesma tabela responde "qual a melhor duração" para cada objetivo',
        pad: false,
        body: durationTable(a.duration),
      })}
    </div>

    <div class="section">
      ${sectionCard({
        title: 'Tags com melhor conversão',
        sub: 'Tags presentes em pelo menos 4 vídeos, ordenadas por inscritos por mil views',
        body: a.tags.length ? `<div class="chart" data-chart="tags"></div>` : emptyState({ title: 'Poucas tags repetidas', note: 'Não há tags com amostra suficiente para ranquear.' }),
      })}
    </div>`;

  /* Ranking com troca de métrica sem recarregar a página. */
  const tableHost = host.querySelector('[data-rank-table]');
  const paintRank = (metric) => {
    const limit = cap === Infinity ? a.videos.length : cap;
    const rows = [...a.videos].sort((x, y) => (y[metric] ?? 0) - (x[metric] ?? 0)).slice(0, limit);
    const max = Math.max(...rows.map((v) => v[metric] ?? 0), 1);
    const fmtCell = metric === 'avgViewPct' ? (v) => pct(v) : compact;
    tableHost.innerHTML = `
      <table class="tbl">
        <thead><tr>
          <th>Vídeo</th><th class="n">Publicado</th><th class="n">Duração</th>
          <th class="n">Views</th><th class="n">Inscritos</th><th class="n">Retenção</th><th class="n">${esc(RANK_METRICS.find((m) => m.value === metric).label)}</th>
        </tr></thead>
        <tbody>${rows.map((v, i) => `
          <tr>
            <td>${videoCell(v, i + 1)}</td>
            <td class="n muted">${relativeDays(v.publishedAt)}</td>
            <td class="n muted">${v.isShort ? 'Short' : duration(v.durationSec)}</td>
            <td class="n">${compact(v.views)}</td>
            <td class="n">${compact(v.subsGained)}</td>
            <td class="n">${pct(v.avgViewPct, 0)}</td>
            <td class="n">${barCell(v[metric] ?? 0, max, fmtCell)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${cap !== Infinity && a.videos.length > cap ? `
        <div style="padding:12px 14px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <span class="muted fs13">${icon('lock')} Mostrando ${cap} de ${int(a.videos.length)} vídeos no plano ${esc(PLAN_BY_ID[plan].name)}.</span>
          <button class="btn btn-sm btn-primary" data-nav="#/planos">Liberar catálogo completo</button>
        </div>` : ''}`;
  };
  paintRank('views');

  host.querySelector('[data-segment="rank"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    host.querySelectorAll('[data-segment="rank"] button').forEach((x) => x.classList.toggle('on', x === b));
    paintRank(b.dataset.value);
  });

  /* Gráficos */
  hBarChart(host.querySelector('[data-chart="topics"]'), {
    rows: a.topicMix.map((t, i) => ({
      label: t.name, value: t.videos, color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Participação</span><b>${pct(t.share * 100)}</b></div>
            <div class="tr"><span class="l">Views do tema</span><b>${compact(t.views)}</b></div>`,
    })),
    formatValue: (v) => `${int(v)}`,
  });

  hBarChart(host.querySelector('[data-chart="topic-views"]'), {
    rows: [...a.topicMix].sort((x, y) => y.medianViews - x.medianViews).map((t, i) => ({
      label: t.name, value: Math.round(t.medianViews), color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Vídeos</span><b>${int(t.videos)}</b></div>`,
    })),
    formatValue: compact,
  });

  if (a.tags.length) {
    hBarChart(host.querySelector('[data-chart="tags"]'), {
      rows: a.tags.slice(0, 10).map((t, i) => ({
        label: t.name, value: Math.round(t.subsPer1k * 10) / 10, color: colors[i % colors.length],
        tip: `<div class="tr"><span class="l">Vídeos com a tag</span><b>${int(t.videos)}</b></div>
              <div class="tr"><span class="l">Views somadas</span><b>${compact(t.views)}</b></div>`,
      })),
      formatValue: (v) => dec(v),
      labelWidth: 150,
    });
  }
}

function durationTable(dur) {
  const best = {
    medianViews: dur.bestByViews?.key,
    retention: dur.bestByRetention?.key,
    watchSecPerView: dur.bestByWatchTime?.key,
    subsPer1k: dur.bestBySubs?.key,
  };
  const flag = (row, metric) =>
    best[metric] === row.key ? ` <span class="chip chip-pos" style="height:18px;font-size:10px">melhor</span>` : '';

  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>
      <th>Faixa de duração</th><th class="n">Vídeos</th>
      <th class="n">Mediana de views</th><th class="n">Retenção média</th>
      <th class="n">Tempo assistido / view</th><th class="n">Inscritos / mil views</th>
    </tr></thead>
    <tbody>${dur.rows.map((r) => `
      <tr${r.reliable ? '' : ' style="opacity:.6"'}>
        <td><b style="font-weight:580">${esc(r.label)}</b>${r.reliable ? '' : ' <span class="chip chip-warn" style="height:18px;font-size:10px">amostra baixa</span>'}</td>
        <td class="n muted">${int(r.videos)}</td>
        <td class="n">${compact(r.medianViews)}${flag(r, 'medianViews')}</td>
        <td class="n">${r.retention == null ? '<span class="muted">—</span>' : pct(r.retention, 0) + flag(r, 'retention')}</td>
        <td class="n">${r.watchSecPerView == null ? '<span class="muted">—</span>' : duration(r.watchSecPerView) + flag(r, 'watchSecPerView')}</td>
        <td class="n">${dec(r.subsPer1k)}${flag(r, 'subsPer1k')}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>
  <div style="padding:12px 16px;border-top:1px solid var(--border)" class="muted fs12">
    Faixas com menos de 3 vídeos aparecem esmaecidas e ficam fora da eleição de "melhor" — amostra pequena não sustenta recomendação.
    ${dur.hasRetention ? '' : ' Retenção e tempo assistido aparecem como “—” porque só existem para o dono do canal autenticado.'}
  </div>`;
}

/* ==========================================================================
   Aba 3 — Consultor de dados
   ========================================================================== */

function tabAdvisor(host, ch, a, ctx) {
  const plan = store.get().plan;
  const colors = SERIES_COLORS();
  const bt = a.publishTime;
  const topics = a.topics;

  host.innerHTML = `
    <div class="section" style="margin-top:0">
      <div class="section-head">
        <div><h2>Todos os achados</h2><p>${a.insights.length} cruzamentos com desvio relevante, ordenados por urgência.</p></div>
      </div>
      <div class="grid g2">${a.insights.map(insightCard).join('')}</div>
    </div>

    <div class="section">
      ${gate(sectionCard({
        title: 'Melhor horário para publicar',
        sub: bt.exact
          ? 'Índice de arranque nas primeiras 48 h, normalizado contra os vídeos vizinhos no tempo'
          : 'Índice de views totais, normalizado contra os vídeos vizinhos no tempo',
        body: `
          <div class="grid g-2-1" style="gap:20px;align-items:start">
            <div>
              ${heatmapHtml(bt)}
            </div>
            <div>
              ${bt.bestBlock ? `
                <div style="padding:14px;border-radius:var(--r);background:var(--yt-soft);border:1px solid var(--yt-500)">
                  <div class="label">Janela recomendada</div>
                  <div style="font-size:22px;font-weight:670;letter-spacing:-.03em;margin-top:5px">${esc(bt.bestBlock.label)}</div>
                  <div class="fs12 txt-2" style="margin-top:5px">
                    ${bt.bestDays.length ? `Melhores dias: ${esc(listPt(bt.bestDays.map((d) => WEEKDAYS[d.weekday])))}. ` : ''}
                    Índice ${dec(bt.bestBlock.score, 2)}× a média do canal, com ${int(bt.bestBlock.n)} envios nessa faixa.
                  </div>
                </div>` : ''}
              <div style="margin-top:14px">
                <div class="label" style="margin-bottom:8px">Ranking de faixas de 3 horas</div>
                <div class="chart" data-chart="blocks"></div>
              </div>
            </div>
          </div>
          <div class="muted fs12" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
            <b>Como é calculado:</b> para cada vídeo, dividimos ${bt.exact ? 'as views das primeiras 48 h' : 'as views totais'}
            pela mediana dos 20 vídeos publicados por volta da mesma época.
            Isso remove crescimento do canal e sazonalidade. As médias por hora e por dia passam por encolhimento em direção a 1,00 para que
            horários com um ou dois envios não dominem o ranking. Amostra total: ${int(bt.sample)} vídeos.
            ${bt.exact ? '' : '<br><b>Limitação:</b> sem o histórico diário, medimos desempenho total em vez de arranque. O horário influencia mais as primeiras horas, então este resultado é uma aproximação — melhora quando a coleta diária estiver ativa.'}
          </div>`,
      }), { plan, feature: 'best_time', title: 'Melhor horário para publicar', note: 'Disponível no plano Pro. O cálculo usa o histórico completo de envios do canal.' })}
    </div>

    <div class="section grid g2">
      ${sectionCard({
        title: `Qual tema gera mais ${topics.noun}`,
        sub: `${topics.metricLabel}, com correção para amostras pequenas`,
        pad: false,
        body: topicTable(topics),
      })}
      ${gate(sectionCard({
        title: 'Frequência ideal de postagem',
        sub: 'Janelas de 28 dias agrupadas por ritmo × ganho líquido de inscritos',
        body: a.frequency.buckets.length ? `
          <div class="chart" data-chart="freq" style="min-height:220px"></div>
          <div class="grid g2" style="gap:12px;margin-top:16px">
            ${miniStat('Ritmo atual', `${dec(a.frequency.current)}/sem`)}
            ${miniStat('Faixa com melhor retorno', a.frequency.best ? a.frequency.best.label : '—', 'pos')}
          </div>
          <p class="muted fs12" style="margin-top:12px">
            Cada barra é a mediana de inscritos líquidos nas janelas em que o canal manteve aquele ritmo.
            Faixas com uma única janela não são elegíveis a recomendação.
          </p>`
          : emptyState({ title: 'Histórico curto demais', note: 'São necessárias ao menos 8 publicações para fatiar o histórico em janelas.' }),
      }), { plan, feature: 'ideal_frequency', title: 'Frequência ideal', note: 'Disponível no plano Pro.' })}
    </div>

    <div class="section">
      ${sectionCard({
        title: 'Melhor duração por objetivo',
        sub: 'O mesmo agrupamento, quatro leituras diferentes',
        pad: false,
        body: durationTable(a.duration),
      })}
    </div>`;

  /* Gráficos das seções liberadas */
  const blocksEl = host.querySelector('[data-chart="blocks"]');
  if (blocksEl) {
    hBarChart(blocksEl, {
      rows: bt.blocks.map((b) => ({
        label: b.label,
        value: Math.round(b.score * 100) / 100,
        color: b.score >= 1.1 ? colors[0] : b.score >= 0.95 ? colors[4] : 'var(--border-strong)',
        tip: `<div class="tr"><span class="l">Envios na faixa</span><b>${int(b.n)}</b></div>`,
      })),
      formatValue: (v) => `${dec(v, 2)}×`,
      labelWidth: 96,
      rowHeight: 28,
    });
  }

  const freqEl = host.querySelector('[data-chart="freq"]');
  if (freqEl && a.frequency.buckets.length) {
    const best = a.frequency.best?.label;
    barChart(freqEl, {
      labels: a.frequency.buckets.map((b) => b.label),
      series: [{ name: 'Inscritos líquidos (mediana)', values: a.frequency.buckets.map((b) => Math.round(b.medianNetSubs)), color: colors[0] }],
      height: 220,
      formatY: compact,
      formatValue: (v) => int(v),
      highlightIndex: a.frequency.buckets.findIndex((b) => b.label === best),
    });
  }
}

function topicTable(topics) {
  const max = Math.max(...topics.rows.map((r) => r.subsPer1k), 1);
  const Noun = topics.noun.charAt(0).toUpperCase() + topics.noun.slice(1);
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>
      <th>Tema</th><th class="n">Vídeos</th><th class="n">Views</th>
      <th class="n">${esc(Noun)}</th><th class="n">${esc(topics.metricLabel)}</th><th class="n">vs. canal</th>
    </tr></thead>
    <tbody>${topics.rows.map((r, i) => `
      <tr${r.reliable ? '' : ' style="opacity:.6"'}>
        <td><div class="flex ac g8"><span class="rank-badge${i === 0 && r.reliable ? ' top' : ''}">${i + 1}</span>
          <span><b style="font-weight:580">${esc(r.name)}</b>${r.sampleNote ? `<span class="muted fs12"> · ${esc(r.sampleNote)}</span>` : ''}</span></div></td>
        <td class="n muted">${int(r.videos)}</td>
        <td class="n">${compact(r.views)}</td>
        <td class="n">${compact(r.subs)}</td>
        <td class="n">${barCell(Math.round(r.subsPer1k * 10) / 10, max, (v) => dec(v))}</td>
        <td class="n"><span class="chip ${r.vsChannel > 5 ? 'chip-pos' : r.vsChannel < -5 ? 'chip-neg' : ''}">${r.vsChannel > 0 ? '+' : ''}${dec(r.vsChannel, 0)}%</span></td>
      </tr>`).join('')}
    </tbody>
  </table></div>
  <div style="padding:12px 16px;border-top:1px solid var(--border)" class="muted fs12">
    ${topics.metric === 'engagement'
      ? 'A API pública não informa inscritos por vídeo, então a conversão é medida em <b>interações</b> (curtidas + comentários). Conecte o canal para trocar por inscritos reais.<br>'
      : ''}
    Taxa do canal: <b>${dec(topics.channelSubsPer1k)}</b> ${esc(topics.noun)} por mil views.
    As taxas por tema passam por encolhimento bayesiano com prior equivalente a 8% das views do canal — sem isso, um tema com poucos vídeos e um viral lideraria a tabela.
  </div>`;
}

/* --------------------------------------------------------------- heatmap */

function heatmapHtml(bt) {
  const flat = bt.matrix.flat();
  const min = Math.min(...flat.map((c) => c.score));
  const max = Math.max(...flat.map((c) => c.score));
  const span = max - min || 1;
  const bestCell = flat.reduce((a, b) => (b.score > a.score ? b : a), flat[0]);

  const cell = (c) => {
    const alpha = 0.06 + ((c.score - min) / span) * 0.94;
    const isBest = c.weekday === bestCell.weekday && c.hour === bestCell.hour;
    return `<div class="heat-cell${isBest ? ' best' : ''}"
      style="background:rgba(255,0,51,${alpha.toFixed(3)})"
      title="${WEEKDAYS[c.weekday]} ${hourLabel(c.hour)} — índice ${c.score.toFixed(2)}× (${c.n} envio${c.n === 1 ? '' : 's'})"></div>`;
  };

  return `
    <div class="heat">
      <div class="heat-row" style="margin-bottom:2px">
        <span></span>
        ${Array.from({ length: 24 }, (_, h) => `<span class="axis-hour" style="font-size:9.5px;color:var(--text-3);text-align:center">${h % 3 === 0 ? h : ''}</span>`).join('')}
      </div>
      ${bt.matrix.map((row, d) => `
        <div class="heat-row">
          <span class="rl">${WEEKDAYS[d]}</span>
          ${row.map(cell).join('')}
        </div>`).join('')}
    </div>
    <div class="heat-scale">
      <span>${bt.exact ? 'menos views em 48 h' : 'menos views no total'}</span>
      <span class="sw">${[0.08, 0.28, 0.5, 0.72, 0.95].map((a) => `<i style="background:rgba(255,0,51,${a})"></i>`).join('')}</span>
      <span>mais</span>
    </div>`;
}

/* ==========================================================================
   Aba 4 — Estimativa de ganhos
   ========================================================================== */

function tabEarnings(host, ch, a, ctx) {
  const st = store.get();
  const recent = recentViewsByFormat(a.videos, 30);
  const preset = RPM_PRESETS.find((p) => p.key === st.rpmPreset) || RPM_PRESETS[1];
  let rpm = st.customRpm ?? preset.rpm;

  host.innerHTML = `
    <div class="grid g-2-1" style="align-items:start">
      ${sectionCard({
        title: 'Calculadora de ganhos estimados',
        sub: 'Sem conexão com a conta, a receita só pode ser estimada. Exibimos faixas — não um número exato.',
        body: `
          <div class="grid g2" style="gap:14px">
            <label>
              <div class="label" style="margin-bottom:6px">Nicho (RPM de referência)</div>
              <select class="input" data-preset>
                ${RPM_PRESETS.map((p) => `<option value="${p.key}" ${p.key === preset.key ? 'selected' : ''}>${esc(p.label)} — ${money0(p.rpm)}</option>`).join('')}
              </select>
            </label>
            <label>
              <div class="label" style="margin-bottom:6px">RPM base (R$ por mil views)</div>
              <input class="input" type="number" min="1" max="200" step="0.5" value="${rpm}" data-rpm>
            </label>
          </div>
          <div style="margin-top:16px">
            <input type="range" min="1" max="120" step="0.5" value="${rpm}" data-rpm-range style="width:100%;accent-color:var(--yt-500)">
            <div class="flex jb muted fs12"><span>R$ 1</span><span>R$ 120</span></div>
          </div>

          <div class="range-grid" style="margin-top:22px" data-ranges></div>

          <div class="muted fs12" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
            <b>Base do cálculo:</b> views dos últimos 30 dias, separadas por formato e corrigidas pelo peso do catálogo antigo.
            Vídeos longos rendem sobre ${pct(62, 0)} de views monetizadas; Shorts entram pelo pool próprio, com RPM equivalente a 5,5% do longo.
            As faixas são RPM × 0,70 (conservador), × 1,00 (médio) e × 1,50 (otimista).
          </div>`,
      })}
      ${sectionCard({
        title: 'Base de views (30 dias)',
        sub: 'O que entra na conta',
        body: `
          <div class="grid" style="gap:12px">
            ${miniStat('Views de vídeos longos', compact(recent.longViews))}
            ${miniStat('Views de Shorts', compact(recent.shortViews))}
            ${miniStat('Envios no período', int(recent.uploads))}
          </div>
          <div class="chart" data-chart="mix" style="margin-top:18px"></div>
          <div style="margin-top:18px;padding:13px;border-radius:var(--r);background:var(--info-soft);border:1px solid var(--border)">
            <div class="flex g8" style="align-items:flex-start">
              <span style="color:var(--info)">${icon('info')}</span>
              <p class="fs12" style="color:var(--text-2);line-height:1.5">
                Receita real depende de país da audiência, sazonalidade de anunciante e taxa de monetização do canal.
                Conecte a conta para ver RPM, CPM e receita medidos pelo YouTube.
              </p>
            </div>
            <button class="btn btn-sm btn-primary" style="margin-top:11px;width:100%" data-nav="#/criador">${icon('google')} Conectar canal</button>
          </div>`,
      })}
    </div>

    <div class="section">
      ${sectionCard({
        title: 'Projeção anual por faixa',
        sub: 'Extrapolação linear do ritmo dos últimos 30 dias — não considera crescimento nem sazonalidade',
        body: `<div class="chart" data-chart="proj" style="min-height:220px"></div>`,
      })}
    </div>

    <div class="section">
      ${sectionCard({
        title: 'Estimativa por vídeo',
        sub: 'Ganho estimado de cada vídeo com o RPM configurado acima',
        pad: false,
        body: `<div class="tbl-wrap" data-vid-earn></div>`,
      })}
    </div>`;

  const colors = SERIES_COLORS();

  donutChart(host.querySelector('[data-chart="mix"]'), {
    data: [
      { label: 'Vídeos longos', value: recent.longViews, color: colors[1] },
      { label: 'Shorts', value: recent.shortViews, color: colors[0] },
    ],
    size: 150,
    centerTop: compact(recent.longViews + recent.shortViews),
    centerSub: 'VIEWS / 30 D',
  });

  const paint = () => {
    const est = estimateEarnings({ longViews: recent.longViews, shortViews: recent.shortViews, rpm });
    host.querySelector('[data-ranges]').innerHTML = `
      ${rangeCard('Conservador', est.conservative, false)}
      ${rangeCard('Médio', est.medium, true)}
      ${rangeCard('Otimista', est.optimistic, false)}`;

    barChart(host.querySelector('[data-chart="proj"]'), {
      labels: ['Conservador', 'Médio', 'Otimista'],
      series: [
        { name: 'Vídeos longos (ano)', values: [est.conservative.long, est.medium.long, est.optimistic.long].map((v) => v * 12), color: colors[1] },
        { name: 'Shorts (ano)', values: [est.conservative.short, est.medium.short, est.optimistic.short].map((v) => v * 12), color: colors[0] },
      ],
      height: 220,
      formatY: compactMoney,
      formatValue: (v) => money(v),
      highlightIndex: 1,
    });

    const rows = [...a.videos].sort((x, y) => y.views - x.views).slice(0, 15);
    const shortRpm = rpm * 0.055;
    host.querySelector('[data-vid-earn]').innerHTML = `
      <table class="tbl">
        <thead><tr><th>Vídeo</th><th class="n">Views</th><th class="n">RPM aplicado</th>
          <th class="n">Conservador</th><th class="n">Médio</th><th class="n">Otimista</th></tr></thead>
        <tbody>${rows.map((v, i) => {
          const base = v.isShort ? (v.views / 1000) * shortRpm : (v.views * 0.62 / 1000) * rpm;
          return `<tr>
            <td>${videoCell(v, i + 1)}</td>
            <td class="n">${compact(v.views)}</td>
            <td class="n muted">${money(v.isShort ? shortRpm : rpm)}</td>
            <td class="n muted">${money(base * 0.7)}</td>
            <td class="n"><b>${money(base)}</b></td>
            <td class="n muted">${money(base * 1.5)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  };
  paint();

  const rpmInput = host.querySelector('[data-rpm]');
  const rpmRange = host.querySelector('[data-rpm-range]');
  const sync = (v) => {
    rpm = Math.max(1, Number(v) || 1);
    rpmInput.value = rpm;
    rpmRange.value = Math.min(120, rpm);
    store.set({ customRpm: rpm });
    paint();
  };
  rpmInput.addEventListener('input', (e) => sync(e.target.value));
  rpmRange.addEventListener('input', (e) => sync(e.target.value));
  host.querySelector('[data-preset]').addEventListener('change', (e) => {
    const p = RPM_PRESETS.find((x) => x.key === e.target.value);
    store.set({ rpmPreset: p.key, customRpm: null });
    sync(p.rpm);
  });
}

function rangeCard(label, band, featured) {
  return `<div class="range-card${featured ? ' mid' : ''}">
    <div class="lbl">${esc(label)}</div>
    <div class="v">${money0(band.total)}</div>
    <div class="rpm">/ mês · RPM ${money(band.rpm)}</div>
  </div>`;
}

/* ------------------------------------------------------------- auxiliares */

function loadingSkeleton() {
  return `
    <div class="flex ac g12" style="margin-bottom:24px">
      <div class="skel" style="width:62px;height:62px;border-radius:50%"></div>
      <div class="grow"><div class="skel" style="height:22px;width:220px"></div><div class="skel" style="height:14px;width:320px;margin-top:9px"></div></div>
    </div>
    <div class="grid g4">${Array.from({ length: 4 }, () => '<div class="skel" style="height:104px;border-radius:14px"></div>').join('')}</div>
    <div class="grid g-2-1" style="margin-top:14px">
      <div class="skel" style="height:320px;border-radius:14px"></div>
      <div class="skel" style="height:320px;border-radius:14px"></div>
    </div>`;
}

function quotaWall(quota) {
  return `<div class="page"><div class="card" style="padding:40px;text-align:center;max-width:520px;margin:40px auto">
    <div style="width:44px;height:44px;border-radius:12px;background:var(--yt-soft);color:var(--yt-500);display:grid;place-items:center;margin:0 auto 16px">${icon('lock')}</div>
    <h2 style="font-size:19px;font-weight:660;letter-spacing:-.02em">Você usou suas ${quota} buscas de hoje</h2>
    <p class="txt-2 fs13" style="margin-top:8px;line-height:1.55">
      O plano Grátis analisa ${quota} canais por dia. Canais já consultados hoje continuam abertos sem consumir cota.
      No Pro o limite deixa de existir na prática.
    </p>
    <div class="flex g8" style="justify-content:center;margin-top:20px">
      <button class="btn" data-nav="#/descobrir">Voltar</button>
      <button class="btn btn-primary" data-nav="#/planos">Ver planos ${icon('arrow')}</button>
    </div>
  </div></div>`;
}
