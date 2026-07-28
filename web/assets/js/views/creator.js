/** creator.js — Dashboard do Criador (Modo B): dados privados via OAuth. */

import { getCreatorReport, startGoogleConnect, disconnectGoogleAccount } from '../api.js';
import { icon, avatar, kpi, insightCard, sectionCard, segment, videoCell, gate, toast, modal, emptyState } from '../ui.js';
import { lineChart, barChart, hBarChart, donutChart, SERIES_COLORS } from '../charts.js';
import {
  esc, compact, int, dec, pct, money, money0, compactMoney, duration, dateShort, watchHours,
} from '../format.js';
import { sum, mean, pctChange } from '../engine.js';
import { can, limitOf, PLAN_BY_ID } from '../plans.js';
import * as store from '../store.js';

const RANGES = [
  { value: '7', label: '7 dias' },
  { value: '28', label: '28 dias' },
  { value: '90', label: '90 dias' },
  { value: '365', label: '12 meses' },
];

export default async function creator(root, params, ctx) {
  const st = store.get();

  // O paywall vem ANTES da conexão de propósito: seria desrespeitoso levar
  // alguém pelo consentimento OAuth do Google para depois barrar o resultado.
  if (!can(st.plan, 'creator_dashboard')) {
    root.innerHTML = `<div class="page">
      <div class="page-head"><h1>Dashboard do Criador</h1>
      <p>Dados privados do seu canal: receita, RPM, CTR de miniatura, retenção e fontes de tráfego.</p></div>
      ${gate(previewCards(), { plan: st.plan, feature: 'creator_dashboard', title: 'Conecte seu canal no plano Pro', note: 'A YouTube Analytics API só devolve estes números para o dono do canal autenticado.' })}
    </div>`;
    return;
  }

  // O callback do OAuth volta para cá anexando o resultado como query no hash
  // (`#/criador?conectado=1` ou `#/criador?erro=codigo`). Lemos, avisamos com
  // um toast e limpamos a URL sem disparar uma navegação nova.
  const feedback = new URLSearchParams(location.hash.split('?')[1] || '');
  if (feedback.has('conectado') || feedback.has('erro')) {
    history.replaceState(null, '', location.pathname + location.search + '#/criador');
  }
  if (feedback.get('conectado') === '1') toast('Canal conectado com sucesso', 'success');
  if (feedback.has('erro')) toast(oauthErrorMessage(feedback.get('erro')), 'error');

  root.innerHTML = `<div class="page"><div class="skel" style="height:420px;border-radius:14px"></div></div>`;

  let report;
  try {
    report = await getCreatorReport();
  } catch (err) {
    if (ctx.stale()) return;
    root.innerHTML = `<div class="page">${connectionErrorState(err)}</div>`;
    root.querySelector('[data-retry-analytics]')?.addEventListener('click', () => ctx.navigate('#/criador'));
    return;
  }
  if (ctx.stale()) return; // o usuário já navegou para outra rota
  if (!report) return renderConnect(root, ctx);

  const { channel: ch, analysis: a } = report;
  let range = Number(params.range || 28);

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div class="ch-head" style="gap:14px">
            ${avatar(ch, 52)}
            <div class="meta">
              <h1>${esc(ch.title)} <span class="chip chip-pos">${icon('check')} Conectado</span></h1>
              <div class="handle">${esc(ch.handle)} · YouTube Analytics API · ${compact(ch.statistics.subscriberCount)} inscritos</div>
            </div>
          </div>
          <div class="actions">
            ${segment('range', RANGES, String(range))}
            <button class="btn btn-sm" data-export>${icon('download')} Exportar</button>
            <button class="btn btn-sm" data-disconnect>${icon('logout')} Desconectar</button>
          </div>
        </div>
      </div>
      <div data-dash></div>
    </div>`;

  const dash = root.querySelector('[data-dash]');
  const paint = () => renderDashboard(dash, ch, a, range, ctx);
  paint();

  root.querySelector('[data-segment="range"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    root.querySelectorAll('[data-segment="range"] button').forEach((x) => x.classList.toggle('on', x === b));
    range = Number(b.dataset.value);
    paint();
  });

  root.querySelector('[data-disconnect]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    await disconnectGoogleAccount();
    toast('Canal desconectado', 'success');
    ctx.navigate('#/criador');
  });

  root.querySelector('[data-export]').addEventListener('click', () => {
    const plan = store.get().plan;
    if (!can(plan, 'export_reports')) {
      modal({
        title: 'Exportação é um recurso do plano Creator',
        subtitle: 'Relatórios em PDF e Excel, além da API do TubeMetrics, entram no plano Creator.',
        body: `<p class="txt-2 fs13">Seu plano atual é <b>${esc(PLAN_BY_ID[plan].name)}</b>. No Creator você também conecta até ${limitOf('creator', 'connectedChannels')} canais e libera ${limitOf('creator', 'seats')} assentos para a equipe.</p>`,
        actions: [{ label: 'Agora não' }, { label: 'Ver planos', primary: true, onClick: () => ctx.navigate('#/planos') }],
      });
      return;
    }
    exportCsv(ch, a, range);
  });
}

/* ==========================================================================
   Tela de conexão (OAuth real com o Google)
   ========================================================================== */

/** Mensagens amigáveis para os códigos que `/api/auth/callback` devolve. */
function oauthErrorMessage(code) {
  const mapa = {
    cancelado: 'Você cancelou a autorização no Google.',
    fluxo_invalido: 'A sessão de login expirou antes de terminar. Tente conectar de novo.',
    token: 'O Google recusou a troca de tokens. Tente novamente.',
    sem_refresh_token: 'O Google não devolveu permissão permanente. Revogue o acesso em myaccount.google.com/permissions e tente de novo.',
    canal_nao_encontrado: 'Essa conta do Google não tem um canal do YouTube associado.',
    oauth_nao_configurado: 'O login com Google ainda não foi configurado neste servidor.',
    sessao_nao_configurada: 'O armazenamento de sessão ainda não foi configurado neste servidor.',
    interno: 'Erro interno ao conectar. Tente novamente em instantes.',
  };
  return mapa[code] || 'Não foi possível conectar sua conta do Google.';
}

/** Erro ao consultar `/api/analytics` que NÃO é "ainda não conectou". */
function connectionErrorState(err) {
  const acessoRevogado = err?.code === 'accessRevoked';
  return emptyState({
    title: acessoRevogado ? 'O acesso a este canal foi revogado' : 'Não foi possível carregar seus dados',
    note: acessoRevogado
      ? 'Você (ou o Google) revogou a permissão. Conecte novamente para continuar.'
      : (err?.message || 'Tente novamente em instantes.'),
    iconName: 'alert',
    action: `<button class="btn btn-primary" data-retry-analytics>Tentar de novo</button>`,
  });
}

function renderConnect(root, ctx) {
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1>Dashboard do Criador</h1>
        <p>Conecte sua conta do Google para trazer os dados que a API pública não expõe:
           receita real, RPM, CPM, CTR das miniaturas, retenção de audiência e fontes de tráfego.</p>
      </div>

      <div class="grid g-2-1" style="align-items:start">
        <div class="card" style="padding:32px;text-align:center">
          <div style="width:52px;height:52px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);display:grid;place-items:center;margin:0 auto 18px">${icon('google')}</div>
          <h2 style="font-size:19px;font-weight:660;letter-spacing:-.022em">Conectar com o Google</h2>
          <p class="txt-2 fs13" style="max-width:44ch;margin:9px auto 0;line-height:1.55">
            Autorização somente de leitura. O TubeMetrics nunca publica, edita ou apaga nada no seu canal.
          </p>
          <button class="btn btn-primary btn-lg" style="margin-top:22px" data-connect>${icon('google')} Continuar com o Google</button>
          <p class="muted fs12" style="margin-top:14px">Você verá a tela oficial de consentimento do Google antes de qualquer acesso.</p>
        </div>

        <div class="card" style="padding:20px">
          <div class="label" style="margin-bottom:12px">Escopos solicitados</div>
          ${[
            ['youtube.readonly', 'Ler metadados do canal e da lista de uploads.'],
            ['yt-analytics.readonly', 'Ler views, tempo de exibição, retenção, CTR e inscritos.'],
            ['yt-analytics-monetary.readonly', 'Ler receita estimada, RPM e CPM.'],
          ].map(([s, d]) => `
            <div style="display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--pos);flex-shrink:0">${icon('shield')}</span>
              <div><code style="font-size:12px;font-family:var(--mono);color:var(--text)">${esc(s)}</code>
              <div class="muted fs12" style="margin-top:3px">${esc(d)}</div></div>
            </div>`).join('')}
          <p class="muted fs12" style="margin-top:14px">
            O <i>refresh token</i> fica cifrado no servidor e nunca é enviado ao navegador.
            O <i>access token</i> vive 1 hora e é renovado sob demanda.
          </p>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>O que você passa a ver</h2></div>
        ${previewCards()}
      </div>
    </div>`;

  root.querySelector('[data-connect]').addEventListener('click', (e) => {
    // Navegação de página inteira — o Google exige que seja o navegador
    // visitando a URL, não uma chamada em segundo plano.
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = 'Redirecionando…';
    startGoogleConnect();
  });
}

function previewCards() {
  const items = [
    ['money', 'Receita, RPM e CPM', 'Valores medidos pelo YouTube, não estimados por RPM médio.'],
    ['cursor', 'CTR das miniaturas', 'Impressões, cliques e a taxa por vídeo — onde a miniatura ganha ou perde.'],
    ['clock', 'Retenção de audiência', 'Percentual médio assistido e duração média por visualização.'],
    ['globe', 'Fontes de tráfego e países', 'De onde vem cada view: Shorts feed, busca, sugestões, externo.'],
    ['users', 'Inscritos ganhos × perdidos', 'O saldo líquido diário, não só o número que aparece no canal.'],
    ['chart', 'Comparação mês a mês', 'Mês corrente contra o mesmo trecho do mês anterior.'],
  ];
  return `<div class="grid g3">${items.map(([ic, t, d]) => `
    <div class="card" style="padding:18px">
      <div style="width:30px;height:30px;border-radius:8px;background:var(--yt-soft);color:var(--yt-500);display:grid;place-items:center">${icon(ic)}</div>
      <h3 style="font-size:14px;font-weight:630;margin-top:12px;letter-spacing:-.014em">${esc(t)}</h3>
      <p class="txt-2 fs13" style="margin-top:5px;line-height:1.5">${esc(d)}</p>
    </div>`).join('')}</div>`;
}

/* ==========================================================================
   Dashboard
   ========================================================================== */

function renderDashboard(host, ch, a, range, ctx) {
  const daily = a.daily;
  const rows = daily.slice(-range);
  const prev = daily.slice(-2 * range, -range);
  const colors = SERIES_COLORS();
  const plan = store.get().plan;

  const agg = (list) => ({
    views: sum(list, (r) => r.views),
    watch: sum(list, (r) => r.estimatedMinutesWatched),
    net: sum(list, (r) => r.subscribersGained - r.subscribersLost),
    gained: sum(list, (r) => r.subscribersGained),
    lost: sum(list, (r) => r.subscribersLost),
    revenue: sum(list, (r) => r.estimatedRevenue),
    impressions: sum(list, (r) => r.impressions),
  });
  const cur = agg(rows);
  const old = agg(prev);
  // A Analytics API não expõe impressões/CTR de miniatura para contas comuns
  // (ver _analytics.js) — os campos vêm sempre zerados. Sem essa checagem,
  // "views ÷ impressões" viraria "views ÷ 1" por causa do Math.max de proteção
  // contra divisão por zero, exibindo um número grande e sem sentido em vez de
  // admitir que o dado não existe.
  const hasImpressions = cur.impressions > 0;
  const ctr = hasImpressions ? (cur.views / cur.impressions) * 100 : 0;
  const ctrPrev = old.impressions ? (old.views / old.impressions) * 100 : 0;
  const rpm = cur.views ? (cur.revenue / cur.views) * 1000 : 0;
  const cpm = cur.views ? (cur.revenue / (cur.views * 0.62)) * 1000 : 0;
  const avgDur = cur.views ? (cur.watch * 60) / cur.views : 0;

  const labels = rows.map((r) => dateShort(r.date));
  const mom = a.mom;

  host.innerHTML = `
    <div class="grid g4">
      ${kpi({ label: 'Views', value: compact(cur.views), iconName: 'eye', delta: pctChange(cur.views, old.views), sub: `${range} dias`, spark: rows.map((r) => r.views) })}
      ${kpi({ label: 'Tempo de exibição', value: watchHours(cur.watch), iconName: 'clock', delta: pctChange(cur.watch, old.watch), sub: `média de ${duration(avgDur)} por view`, spark: rows.map((r) => r.estimatedMinutesWatched), sparkColor: colors[2] })}
      ${kpi({ label: 'Inscritos (líquido)', value: `${cur.net >= 0 ? '+' : ''}${compact(cur.net)}`, iconName: 'users', delta: pctChange(cur.net, old.net), sub: `${compact(cur.gained)} ganhos · ${compact(cur.lost)} perdidos`, spark: rows.map((r) => r.subscribersGained - r.subscribersLost), sparkColor: colors[1] })}
      ${kpi({ label: 'Receita estimada', value: money0(cur.revenue), iconName: 'money', delta: pctChange(cur.revenue, old.revenue), sub: `RPM ${money(rpm)} · CPM ${money(cpm)}`, spark: rows.map((r) => r.estimatedRevenue), sparkColor: colors[3] })}
    </div>

    <div class="section grid g-2-1" style="align-items:start">
      ${sectionCard({
        title: 'Views por dia',
        sub: `Período atual contra os ${range} dias anteriores`,
        actions: `<span class="chip"><i style="width:8px;height:8px;border-radius:2px;background:var(--s1);display:inline-block"></i> Atual</span>
                  <span class="chip"><i style="width:8px;height:8px;border-radius:2px;background:var(--text-3);display:inline-block"></i> Anterior</span>`,
        body: `<div class="chart" data-chart="views" style="min-height:250px"></div>`,
      })}
      ${sectionCard({
        title: 'Retenção e CTR',
        sub: 'Os dois gargalos do funil',
        body: `
          <div class="grid" style="gap:12px">
            ${hasImpressions
              ? bigStat('CTR de impressões', pct(ctr), pctChange(ctr, ctrPrev), `${compact(cur.impressions)} impressões`)
              : bigStat('CTR de impressões', 'Indisponível', null, 'a Analytics API não expõe isso para esta conta')}
            ${bigStat('Duração média assistida', duration(avgDur), null, `${pct(mean(a.videos, (v) => v.avgViewPct), 0)} do vídeo, em média`)}
            ${hasImpressions
              ? bigStat('Views por impressão', dec(cur.views / cur.impressions, 2), null, 'cliques por miniatura exibida')
              : bigStat('Views por impressão', 'Indisponível', null, 'depende do dado de impressões acima')}
          </div>
          ${hasImpressions
            ? `<div class="chart" data-chart="ctr" style="min-height:130px;margin-top:14px"></div>`
            : `<p class="muted fs12" style="margin-top:14px;padding:12px;background:var(--surface-2);border-radius:var(--r-sm)">
                 O CTR de miniaturas que aparece no YouTube Studio não é exposto pela Analytics API pública para contas comuns.
               </p>`}`,
      })}
    </div>

    <div class="section grid g2">
      ${sectionCard({
        title: 'Inscritos ganhos × perdidos',
        sub: 'Saldo diário do período',
        body: `<div class="chart" data-chart="subs" style="min-height:230px"></div>`,
      })}
      ${sectionCard({
        title: 'Receita por dia',
        sub: `${money(cur.revenue)} no período · RPM médio ${money(rpm)}`,
        body: `<div class="chart" data-chart="rev" style="min-height:230px"></div>`,
      })}
    </div>

    <div class="section grid g3">
      ${sectionCard({ title: 'Fontes de tráfego', sub: 'De onde vem cada view', body: `<div class="chart" data-chart="traffic"></div>` })}
      ${sectionCard({ title: 'Países', sub: 'Distribuição da audiência', body: `<div class="chart" data-chart="geo"></div>` })}
      ${sectionCard({
        title: 'Dispositivos',
        sub: 'Onde o público assiste',
        body: `<div class="chart" data-chart="dev"></div>
               <div class="legend" style="margin-top:16px" data-dev-legend></div>`,
      })}
    </div>

    <div class="section">
      ${sectionCard({
        title: 'Comparação histórica',
        sub: `Mês atual até o dia ${mom.dayOfMonth} contra o mesmo trecho do mês anterior`,
        pad: false,
        body: momTable(mom),
      })}
    </div>

    <div class="section">
      ${sectionCard({
        title: 'Receita detalhada por vídeo',
        sub: 'Valores da YouTube Analytics API, não estimativa por RPM médio',
        pad: false,
        body: revenueTable(a.videos, plan),
      })}
    </div>

    <div class="section grid g2">
      ${gate(goalCard(ch, a, cur, range), { plan, feature: 'growth_alerts', title: 'Alertas de meta de crescimento', note: 'Defina metas de inscritos e receba aviso quando o ritmo sair da rota. Plano Pro.' })}
      ${sectionCard({
        title: 'Leitura dos dados privados',
        sub: 'Os mesmos cruzamentos, agora com receita, CTR e retenção reais',
        body: `<div class="grid" style="gap:12px">${a.insights.slice(0, 3).map(insightCard).join('')}</div>`,
      })}
    </div>`;

  /* --------------------------------------------------------- gráficos -- */

  lineChart(host.querySelector('[data-chart="views"]'), {
    labels,
    series: [
      { name: 'Atual', values: rows.map((r) => r.views) },
      { name: 'Período anterior', values: padTo(prev.map((r) => r.views), rows.length), color: 'var(--text-3)', dashed: true, area: false },
    ],
    height: 250,
    formatY: compact,
    formatValue: (v) => int(v),
  });

  // Sem impressões, o bloco correspondente nem entra no HTML (ver acima) —
  // o container não existe no DOM, então só desenhamos se ele estiver lá.
  const ctrChartEl = host.querySelector('[data-chart="ctr"]');
  if (ctrChartEl) {
    lineChart(ctrChartEl, {
      labels,
      series: [{ name: 'CTR', values: rows.map((r) => r.impressionClickThroughRate), color: colors[5] }],
      height: 130,
      formatY: (v) => `${dec(v, 0)}%`,
      formatValue: (v) => pct(v),
    });
  }

  barChart(host.querySelector('[data-chart="subs"]'), {
    labels,
    series: [
      { name: 'Ganhos', values: rows.map((r) => r.subscribersGained), color: colors[2] },
      { name: 'Perdidos', values: rows.map((r) => r.subscribersLost), color: colors[0] },
    ],
    height: 230,
    formatY: compact,
    formatValue: (v) => int(v),
  });

  lineChart(host.querySelector('[data-chart="rev"]'), {
    labels,
    series: [{ name: 'Receita', values: rows.map((r) => r.estimatedRevenue), color: colors[3] }],
    height: 230,
    formatY: compactMoney,
    formatValue: (v) => money(v),
  });

  const dims = a.dimensions;
  const scale = (list) => {
    const total = sum(list, (d) => d.views) || 1;
    return list.map((d) => ({ ...d, share: d.views / total }));
  };

  hBarChart(host.querySelector('[data-chart="traffic"]'), {
    rows: scale(dims.trafficSources).map((d, i) => ({
      label: d.name, value: Math.round(d.share * 1000) / 10, color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Views</span><b>${compact(d.views)}</b></div>`,
    })),
    formatValue: (v) => `${dec(v)}%`,
    labelWidth: 150,
    rowHeight: 29,
  });

  hBarChart(host.querySelector('[data-chart="geo"]'), {
    rows: scale(dims.countries).map((d, i) => ({
      label: d.name, value: Math.round(d.share * 1000) / 10, color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Views</span><b>${compact(d.views)}</b></div>`,
    })),
    formatValue: (v) => `${dec(v)}%`,
    labelWidth: 130,
    rowHeight: 29,
  });

  // Canal recém-conectado ou com poucas views no período pode não ter dado
  // suficiente para uma quebra por dispositivo — a API devolve lista vazia
  // nesse caso, não um erro. `devs[0]` sem essa checagem derrubaria a tela.
  const devs = scale(dims.devices);
  if (devs.length) {
    donutChart(host.querySelector('[data-chart="dev"]'), {
      data: devs.map((d, i) => ({ label: d.name, value: d.views, color: colors[i % colors.length] })),
      size: 150,
      centerTop: pct(devs[0].share * 100, 0),
      centerSub: devs[0].name.toUpperCase(),
    });
    host.querySelector('[data-dev-legend]').innerHTML = devs.map((d, i) => `
      <div class="item"><span class="dot" style="background:${colors[i % colors.length]}"></span>
      <span class="nm">${esc(d.name)}</span><span class="vl">${compact(d.views)}</span><span class="pc">${pct(d.share * 100, 0)}</span></div>`).join('');
  } else {
    host.querySelector('[data-chart="dev"]').innerHTML = `<p class="muted fs12" style="padding:20px 0;text-align:center">Sem dado suficiente no período.</p>`;
  }

  /* Meta de crescimento */
  const goalForm = host.querySelector('[data-goal-form]');
  if (goalForm) {
    goalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const target = Number(new FormData(goalForm).get('target'));
      const current = ch.statistics.subscriberCount;
      if (!Number.isFinite(target) || target <= current) {
        return toast(`A meta precisa ser maior que os ${int(current)} inscritos atuais`, 'error');
      }
      store.set({ goal: { subscribers: target, deadline: null } });
      toast('Meta salva. O painel passa a acompanhar o ritmo.', 'success');
      renderDashboard(host, ch, a, range, ctx);
    });
  }
}

const padTo = (arr, n) => (arr.length >= n ? arr.slice(-n) : [...Array(n - arr.length).fill(null), ...arr]);

function bigStat(label, value, delta, sub) {
  const chip = delta == null ? '' :
    `<span class="chip ${delta > 0 ? 'chip-pos' : delta < 0 ? 'chip-neg' : ''}">${delta > 0 ? '+' : ''}${dec(delta, 1)}%</span>`;
  return `<div style="padding:13px 14px;background:var(--surface-2);border-radius:var(--r)">
    <div class="flex jb ac"><span class="label">${esc(label)}</span>${chip}</div>
    <div class="num" style="font-size:22px;font-weight:650;letter-spacing:-.028em;margin-top:5px">${value}</div>
    <div class="muted fs12" style="margin-top:2px">${esc(sub)}</div>
  </div>`;
}

function momTable(mom) {
  const rows = [
    ['Views', 'views', compact],
    ['Tempo de exibição', 'watchMinutes', (v) => watchHours(v)],
    ['Inscritos ganhos', 'subsGained', compact],
    ['Inscritos perdidos', 'subsLost', compact],
    ['Saldo de inscritos', 'netSubs', (v) => `${v >= 0 ? '+' : ''}${compact(v)}`],
    ['Receita estimada', 'revenue', money],
    ['Impressões', 'impressions', compact],
    ['CTR', 'ctr', (v) => pct(v)],
    ['RPM', 'rpm', money],
  ];
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Métrica</th><th class="n">Mês atual</th><th class="n">Mês anterior</th><th class="n">Variação</th></tr></thead>
    <tbody>${rows.map(([label, key, fmt]) => {
      const m = mom.metrics[key];
      const good = key === 'subsLost' ? m.change < 0 : m.change > 0;
      return `<tr>
        <td><b style="font-weight:560">${esc(label)}</b></td>
        <td class="n">${fmt(m.current)}</td>
        <td class="n muted">${fmt(m.previous)}</td>
        <td class="n"><span class="chip ${Math.abs(m.change) < 1 ? '' : good ? 'chip-pos' : 'chip-neg'}">${m.change > 0 ? '+' : ''}${dec(m.change, 1)}%</span></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function revenueTable(videos, plan) {
  const cap = limitOf(plan, 'topVideos');
  const rows = [...videos].sort((a, b) => b.revenue - a.revenue).slice(0, cap === Infinity ? 25 : Math.min(cap, 25));
  const total = sum(videos, (v) => v.revenue);
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Vídeo</th><th class="n">Views</th><th class="n">Retenção</th><th class="n">CTR</th>
      <th class="n">RPM</th><th class="n">Receita</th><th class="n">% do total</th></tr></thead>
    <tbody>${rows.map((v, i) => `
      <tr>
        <td>${videoCell(v, i + 1)}</td>
        <td class="n">${compact(v.views)}</td>
        <td class="n">${pct(v.avgViewPct, 0)}</td>
        <td class="n">${v.ctr == null ? '<span class="muted">—</span>' : pct(v.ctr)}</td>
        <td class="n muted">${money((v.revenue / Math.max(1, v.views)) * 1000)}</td>
        <td class="n"><b>${money(v.revenue)}</b></td>
        <td class="n muted">${pct((v.revenue / (total || 1)) * 100)}</td>
      </tr>`).join('')}</tbody>
  </table></div>
  <div style="padding:12px 16px;border-top:1px solid var(--border)" class="muted fs12">
    Shorts não têm CTR de miniatura — a coluna aparece vazia por definição da API, não por falta de dado.
  </div>`;
}

function goalCard(ch, a, cur, range) {
  const goal = store.get().goal;
  const subs = ch.statistics.subscriberCount;
  const perDay = cur.net / range;

  if (!goal?.subscribers) {
    return sectionCard({
      title: 'Alerta de meta de crescimento',
      sub: 'Defina um alvo e acompanhe se o ritmo atual chega lá',
      body: `<form data-goal-form>
        <div class="label" style="margin-bottom:6px">Meta de inscritos</div>
        <div class="flex g8">
          <!-- step="1" de propósito: com step="1000" e um min não alinhado à
               grade, o navegador invalida o campo e engole o submit sem aviso. -->
          <input class="input" type="number" name="target" min="${subs + 1}" step="1" value="${Math.ceil((subs * 1.25) / 1000) * 1000}">
          <button class="btn btn-primary" type="submit">Salvar</button>
        </div>
        <p class="muted fs12" style="margin-top:10px">
          Você tem ${int(subs)} inscritos e o ritmo dos últimos ${range} dias é de ${dec(perDay)} por dia.
        </p>
      </form>`,
    });
  }

  const missing = goal.subscribers - subs;
  const daysNeeded = perDay > 0 ? missing / perDay : Infinity;
  const eta = Number.isFinite(daysNeeded) ? new Date(Date.now() + daysNeeded * 86400000) : null;
  const progress = Math.min(100, (subs / goal.subscribers) * 100);

  return sectionCard({
    title: 'Meta de crescimento',
    sub: `Alvo: ${int(goal.subscribers)} inscritos`,
    actions: '<button class="btn btn-sm btn-ghost" data-goal-clear>Alterar</button>',
    body: `
      <div class="flex jb ac" style="margin-bottom:8px">
        <span class="num" style="font-size:24px;font-weight:660;letter-spacing:-.03em">${int(subs)}</span>
        <span class="muted fs13">${pct(progress, 0)} da meta</span>
      </div>
      <div style="height:8px;background:var(--surface-3);border-radius:99px;overflow:hidden">
        <i style="display:block;height:100%;width:${progress}%;background:var(--yt-500);border-radius:99px"></i>
      </div>
      <div class="grid g2" style="gap:12px;margin-top:16px">
        ${bigStat('Faltam', compact(Math.max(0, missing)), null, 'inscritos para a meta')}
        ${bigStat('Previsão', eta && Number.isFinite(daysNeeded) ? `${Math.ceil(daysNeeded)} dias` : 'sem ritmo', null,
          eta && Number.isFinite(daysNeeded) ? `chegada em ${eta.toLocaleDateString('pt-BR')}` : 'o saldo atual não avança para a meta')}
      </div>
      ${perDay <= 0 ? `<div class="insight neg" style="margin-top:14px"><div class="ico">${icon('alert')}</div>
        <div class="grow"><h4>Ritmo negativo no período</h4>
        <p>O saldo dos últimos ${range} dias é de ${dec(cur.net, 0)} inscritos. Nesse ritmo a meta não é alcançada.</p></div></div>` : ''}`,
  });
}

/* ------------------------------------------------------------- exportação */

function exportCsv(ch, a, range) {
  const rows = a.daily.slice(-range);
  const header = ['data', 'views', 'minutos_assistidos', 'inscritos_ganhos', 'inscritos_perdidos', 'receita_estimada', 'impressoes', 'ctr'];
  const body = rows.map((r) => [
    r.date, r.views, r.estimatedMinutesWatched, r.subscribersGained, r.subscribersLost,
    r.estimatedRevenue, r.impressions, r.impressionClickThroughRate,
  ].join(';'));
  const csv = `﻿${[header.join(';'), ...body].join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `tubemetrics-${ch.handle.replace('@', '')}-${range}d.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado', 'success');
}
