/**
 * rankings.js — Rankings globais, por país e por período.
 *
 * Três fontes distintas convivem aqui, e a tela deixa claro qual é qual:
 *
 *  1. ALTA DO MOMENTO (`chart=mostPopular`) — real e imediato, para qualquer
 *     país. O filtro de período recorta por DATA DE PUBLICAÇÃO dentro dessa
 *     lista, então "top da semana" significa "entre os que estão em alta, os
 *     publicados nos últimos 7 dias".
 *  2. ACUMULADO (views totais dos canais) — real, vem da lista curada.
 *  3. CRESCIMENTO (`/api/growth`) — depende do histórico que a coleta diária
 *     constrói. Antes de existir histórico, a tela diz isso em vez de inventar.
 */

import { trending, growth, topChannels } from '../api.js';
import { avatar, icon, sectionCard, gate, emptyState, segment, toast } from '../ui.js';
import { ensureLead } from './signup.js';
import { hBarChart, SERIES_COLORS } from '../charts.js';
import { esc, compact, int, dec, relativeDays, duration } from '../format.js';
import { can, requiredPlan, PLAN_BY_ID } from '../plans.js';
import * as store from '../store.js';

const PAISES = {
  BR: 'Brasil', PT: 'Portugal', US: 'Estados Unidos', MX: 'México', AR: 'Argentina',
  CO: 'Colômbia', CL: 'Chile', PE: 'Peru', ES: 'Espanha', FR: 'França',
  DE: 'Alemanha', IT: 'Itália', GB: 'Reino Unido', CA: 'Canadá', AU: 'Austrália',
  JP: 'Japão', KR: 'Coreia do Sul', IN: 'Índia', ID: 'Indonésia', PH: 'Filipinas',
  RU: 'Rússia', TR: 'Turquia', NG: 'Nigéria', ZA: 'África do Sul', AO: 'Angola',
  MZ: 'Moçambique',
};

const PERIODOS = [
  { value: '7', label: 'Semana' },
  { value: '30', label: 'Mês' },
  { value: '365', label: 'Ano' },
];

export default async function rankings(root, _params, ctx) {
  const s = store.get();

  if (!can(s.plan, 'rankings')) {
    const req = PLAN_BY_ID[requiredPlan('rankings')];
    root.innerHTML = `<div class="page">
      <div class="page-head"><h1>Rankings</h1>
      <p>Vídeos e canais em alta em qualquer país, com filtro de período.</p></div>
      ${gate(placeholder(), {
        plan: s.plan,
        feature: 'rankings',
        title: `Rankings disponíveis no ${req.name}`,
        note: 'Descubra o que está em alta no seu mercado e em outros 25 países, com dados ao vivo da YouTube Data API.',
      })}
    </div>`;
    return;
  }

  let region = s.region || 'BR';
  let periodo = '7';

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="top">
          <div>
            <h1>Rankings</h1>
            <p>O que está em alta agora, por país, e como os canais cresceram no período.</p>
          </div>
          <div class="actions">
            <label class="flex ac g8">
              <span class="label">País</span>
              <select class="input" data-region style="width:auto;min-width:170px">
                ${Object.entries(PAISES).map(([code, nome]) =>
                  `<option value="${code}" ${code === region ? 'selected' : ''}>${esc(nome)}</option>`).join('')}
              </select>
            </label>
            ${segment('periodo', PERIODOS, periodo)}
          </div>
        </div>
      </div>
      <div data-body><div class="skel" style="height:460px;border-radius:14px"></div></div>
    </div>`;

  const body = root.querySelector('[data-body]');

  const carregar = async () => {
    body.innerHTML = `<div class="skel" style="height:460px;border-radius:14px"></div>`;
    let dados = null;
    let erro = null;
    try {
      dados = await trending(region);
    } catch (e) {
      erro = e;
    }
    if (ctx.stale()) return;

    if (!dados) {
      body.innerHTML = emptyState({
        title: 'Não foi possível carregar o ranking',
        note: erro?.status === 429
          ? 'A cota diária da YouTube API acabou. Ela reinicia por volta das 5h da manhã.'
          : `Tente novamente em instantes. (${erro?.message || 'erro desconhecido'})`,
        iconName: 'alert',
      });
      return;
    }

    renderTrending(body, dados, Number(periodo), ctx);

    // Crescimento e acumulado são independentes: cada um chega quando chega.
    carregarCrescimento(body, Number(periodo), ctx);
    if (region === 'BR') carregarAcumulado(body, ctx);
  };

  root.querySelector('[data-region]').addEventListener('change', (e) => {
    region = e.target.value;
    store.set({ region });
    carregar();
  });

  root.querySelector('[data-segment="periodo"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    root.querySelectorAll('[data-segment="periodo"] button').forEach((x) => x.classList.toggle('on', x === b));
    periodo = b.dataset.value;
    carregar();
  });

  body.addEventListener('click', async (e) => {
    const abrir = e.target.closest('[data-open]');
    if (abrir && (await ensureLead())) ctx.navigate(`#/canal/${abrir.dataset.open}`);
  });

  await carregar();
}

/* ------------------------------------------------- alta do momento (país) */

function renderTrending(host, dados, dias, ctx) {
  const colors = SERIES_COLORS();
  const corte = Date.now() - dias * 86400000;

  const doPeriodo = dados.videos.filter((v) => new Date(v.publishedAt).getTime() >= corte);
  const topVideos = (doPeriodo.length >= 3 ? doPeriodo : dados.videos)
    .slice()
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const usouFallback = doPeriodo.length < 3;
  const rotuloPeriodo = { 7: 'últimos 7 dias', 30: 'últimos 30 dias', 365: 'último ano' }[dias];

  host.innerHTML = `
    <div class="grid g3" style="margin-bottom:16px">
      ${cardResumo('Vídeos em alta', int(dados.videos.length), 'video', esc(dados.regionName))}
      ${cardResumo('Canais distintos', int(dados.channels.length), 'users', 'na lista de alta')}
      ${cardResumo('Views somadas', compact(dados.videos.reduce((s, v) => s + v.views, 0)), 'eye', 'dos vídeos em alta')}
    </div>

    ${sectionCard({
      title: `Top 10 vídeos — ${rotuloPeriodo}`,
      sub: usouFallback
        ? `Nenhum vídeo em alta foi publicado ${rotuloPeriodo}; mostrando a lista completa de alta`
        : `Publicados ${rotuloPeriodo}, ordenados por visualizações`,
      pad: false,
      body: tabelaVideos(topVideos),
    })}

    <div class="section grid g2">
      ${sectionCard({
        title: 'Views dos vídeos em alta',
        sub: 'A escala entre o primeiro e o décimo costuma ser brutal',
        body: `<div class="chart" data-chart="videos"></div>`,
      })}
      ${sectionCard({
        title: 'Canais em alta',
        sub: 'Soma das views dos vídeos que cada canal colocou na lista',
        body: `<div class="chart" data-chart="canais"></div>`,
      })}
    </div>

    <div class="section" data-acumulado></div>
    <div class="section" data-crescimento>
      <div class="skel" style="height:220px;border-radius:14px"></div>
    </div>

    <div class="insight info" style="margin-top:18px">
      <div class="ico">${icon('info')}</div>
      <div class="grow">
        <h4>De onde vem cada ranking</h4>
        <p>Os vídeos e canais acima vêm de <code style="font-family:var(--mono);font-size:12px">chart=mostPopular</code>,
           a lista de alta que o YouTube publica por país — dado ao vivo, atualizado várias vezes ao dia.
           O filtro de período recorta essa lista pela data de publicação. Já o ranking de crescimento
           usa histórico coletado por nós todo dia, porque a API não guarda série temporal nenhuma.</p>
      </div>
    </div>`;

  hBarChart(host.querySelector('[data-chart="videos"]'), {
    rows: topVideos.map((v, i) => ({
      label: v.title,
      value: v.views,
      color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Canal</span><b>${esc(v.channelTitle)}</b></div>
            <div class="tr"><span class="l">Publicado</span><b>${relativeDays(v.publishedAt)}</b></div>`,
    })),
    formatValue: compact,
    labelWidth: 170,
    rowHeight: 28,
  });

  hBarChart(host.querySelector('[data-chart="canais"]'), {
    rows: dados.channels.slice(0, 10).map((c, i) => ({
      label: c.title,
      value: c.views,
      color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Vídeos na lista</span><b>${int(c.videos)}</b></div>`,
    })),
    formatValue: compact,
    labelWidth: 170,
    rowHeight: 28,
  });
}

function tabelaVideos(videos) {
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>
      <th style="width:52px">#</th><th>Vídeo</th><th>Canal</th>
      <th class="n">Views</th><th class="n">Curtidas</th><th class="n">Publicado</th><th></th>
    </tr></thead>
    <tbody>${videos.map((v, i) => `
      <tr>
        <td><span class="rank-badge${i < 3 ? ' top' : ''}">${i + 1}</span></td>
        <td>
          <div class="vid-cell">
            ${v.thumbnail
              ? `<span class="thumb${v.isShort ? ' short' : ''}" style="background:var(--surface-3)">
                   <img src="${esc(v.thumbnail)}" alt="" decoding="async" referrerpolicy="no-referrer"
                        style="width:100%;height:100%;object-fit:cover" onerror="this.remove()">
                   <span class="dur">${v.isShort ? 'Short' : duration(v.durationSec)}</span>
                 </span>`
              : ''}
            <span class="grow"><span class="t">${esc(v.title)}</span>
              <span class="m">${esc(v.topic)}</span></span>
          </div>
        </td>
        <td class="muted">${esc(v.channelTitle)}</td>
        <td class="n"><b>${compact(v.views)}</b></td>
        <td class="n muted">${compact(v.likes)}</td>
        <td class="n muted">${relativeDays(v.publishedAt)}</td>
        <td class="n"><a class="btn btn-sm btn-ghost" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"
          title="Assistir no YouTube">${icon('play')}</a></td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ------------------------------------------- acumulado (views de sempre) */

async function carregarAcumulado(host, ctx) {
  const alvo = host.querySelector('[data-acumulado]');
  if (!alvo) return;

  let canais = [];
  try {
    canais = await topChannels(20);
  } catch {
    alvo.remove();
    return;
  }
  if (ctx.stale() || !alvo.isConnected) return;

  const colors = SERIES_COLORS();
  const porViews = [...canais].sort((a, b) => b.statistics.viewCount - a.statistics.viewCount).slice(0, 10);

  alvo.innerHTML = sectionCard({
    title: 'Top 10 canais por views acumuladas',
    sub: 'Todo o histórico do canal, não apenas o período selecionado',
    body: `<div class="chart" data-chart="acumulado"></div>`,
  });

  hBarChart(alvo.querySelector('[data-chart="acumulado"]'), {
    rows: porViews.map((c, i) => ({
      label: c.title,
      value: c.statistics.viewCount,
      color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Inscritos</span><b>${compact(c.statistics.subscriberCount)}</b></div>
            <div class="tr"><span class="l">Vídeos</span><b>${int(c.statistics.videoCount)}</b></div>`,
    })),
    formatValue: compact,
    labelWidth: 170,
    rowHeight: 28,
  });
}

/* --------------------------------------------------- crescimento por período */

async function carregarCrescimento(host, dias, ctx) {
  const alvo = host.querySelector('[data-crescimento]');
  if (!alvo) return;

  const dados = await growth(dias, 10);
  if (ctx.stale() || !alvo.isConnected) return;

  if (!dados.ready) {
    alvo.innerHTML = sectionCard({
      title: `Crescimento — ${rotulo(dias)}`,
      sub: 'Quem mais ganhou views e inscritos no período',
      body: `<div class="insight warn">
        <div class="ico">${icon('clock')}</div>
        <div class="grow">
          <h4>O histórico ainda está sendo construído</h4>
          <p>${esc(dados.message || 'Sem histórico suficiente para este período.')}</p>
          <div class="ev">
            A YouTube Data API devolve apenas o retrato de agora — inscritos e views acumulados, sem série
            temporal. Comparar períodos exige guardar esses retratos dia após dia, então o ranking de
            ${rotulo(dias)} só fica completo depois de ${dias} ${dias === 1 ? 'dia' : 'dias'} de coleta.
            ${dados.history?.tracked ? ` Já monitorando ${int(dados.history.tracked)} canais.` : ''}
          </div>
        </div>
      </div>`,
    });
    return;
  }

  const colors = SERIES_COLORS();
  alvo.innerHTML = sectionCard({
    title: `Crescimento — ${rotulo(dias)}`,
    sub: dados.exact
      ? `Comparando com o retrato de ${dias} dias atrás · ${int(dados.compared)} canais`
      : `Retrato mais próximo disponível: ${dados.actualDays} dias atrás · ${int(dados.compared)} canais`,
    pad: false,
    body: `<div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th style="width:52px">#</th><th>Canal</th>
          <th class="n">Views ganhas</th><th class="n">Inscritos ganhos</th>
          <th class="n">Novos vídeos</th><th class="n">Crescimento</th>
        </tr></thead>
        <tbody>${dados.porViews.map((c, i) => `
          <tr data-open="${esc(c.channelId)}" style="cursor:pointer">
            <td><span class="rank-badge${i < 3 ? ' top' : ''}">${i + 1}</span></td>
            <td><div class="flex ac g12">${avatar(c, 32)}
              <div style="min-width:0"><div style="font-weight:580">${esc(c.title)}</div>
              <div class="muted fs12">${esc(c.handle || '')}</div></div></div></td>
            <td class="n"><b>${c.ganhoViews >= 0 ? '+' : ''}${compact(c.ganhoViews)}</b></td>
            <td class="n">${c.ganhoInscritos >= 0 ? '+' : ''}${compact(c.ganhoInscritos)}</td>
            <td class="n muted">${int(c.novosVideos)}</td>
            <td class="n"><span class="chip ${c.pctViews > 0 ? 'chip-pos' : c.pctViews < 0 ? 'chip-neg' : ''}">
              ${c.pctViews >= 0 ? '+' : ''}${dec(c.pctViews, 2)}%</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`,
  });
}

const rotulo = (d) => ({ 7: 'semana', 30: 'mês', 365: 'ano' }[d] || `${d} dias`);

/* ------------------------------------------------------------- auxiliares */

function cardResumo(label, valor, iconName, sub) {
  return `<div class="card" style="padding:15px 16px">
    <div class="flex ac g8" style="color:var(--text-3)">${icon(iconName)}<span class="fs12" style="font-weight:550">${esc(label)}</span></div>
    <div class="num" style="font-size:21px;font-weight:650;letter-spacing:-.025em;margin-top:8px">${valor}</div>
    <div class="muted fs12" style="margin-top:3px">${sub}</div>
  </div>`;
}

function placeholder() {
  return `<div class="card"><div class="card-body tight"><table class="tbl">
    <thead><tr><th style="width:52px">#</th><th>Vídeo</th><th class="n">Views</th><th class="n">Publicado</th></tr></thead>
    <tbody>${Array.from({ length: 6 }, (_, i) => `
      <tr><td><span class="rank-badge">${i + 1}</span></td><td>•••••••••••</td><td class="n">•••</td><td class="n">•••</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
