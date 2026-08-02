/** top.js — Ranking dos 20 maiores canais por inscritos. */

import { topChannels } from '../api.js';
import { avatar, icon, sectionCard, gate, emptyState, toast, flagOf } from '../ui.js';
import { ensureAuth } from './auth.js';
import { hBarChart, SERIES_COLORS } from '../charts.js';
import { esc, compact, int, dec, dateLong } from '../format.js';
import { can, requiredPlan, PLAN_BY_ID } from '../plans.js';
import * as store from '../store.js';

/**
 * A API devolve os tópicos como termos da Wikipédia em inglês
 * ("Music of Latin America"). Traduzimos os mais frequentes; o que não estiver
 * no mapa aparece como veio, em vez de sumir.
 */
const TOPICOS_PT = {
  Music: 'Música', 'Pop music': 'Música pop', 'Rock music': 'Rock', 'Hip hop music': 'Hip hop',
  'Electronic music': 'Música eletrônica', 'Music of Latin America': 'Música latina',
  'Independent music': 'Música independente', 'Christian music': 'Música cristã',
  'Country music': 'Sertanejo e country', 'Soul music': 'Soul',
  Entertainment: 'Entretenimento', 'Film': 'Cinema', 'Television program': 'TV',
  'Performing arts': 'Artes cênicas', Humor: 'Humor',
  'Video game culture': 'Cultura gamer', 'Action game': 'Games de ação',
  'Action-adventure game': 'Games de aventura', 'Role-playing video game': 'RPG',
  'Strategy video game': 'Games de estratégia', 'Sports game': 'Games de esporte',
  'Racing video game': 'Games de corrida', 'Casual game': 'Games casuais',
  'Puzzle video game': 'Games de puzzle', 'Simulation video game': 'Simuladores',
  Lifestyle: 'Estilo de vida', 'Food': 'Culinária', 'Health': 'Saúde',
  'Physical fitness': 'Fitness', Fashion: 'Moda', Beauty: 'Beleza',
  'Pet': 'Pets', 'Hobby': 'Hobbies', 'Vehicle': 'Veículos',
  Society: 'Sociedade', Politics: 'Política', Religion: 'Religião',
  Knowledge: 'Conhecimento', Technology: 'Tecnologia', Business: 'Negócios',
  Sport: 'Esportes', 'Association football': 'Futebol', 'Basketball': 'Basquete',
  'Motorsport': 'Automobilismo', 'Combat sport': 'Esportes de combate',
  Tourism: 'Turismo', 'Military': 'Militar',
};

/**
 * A API qualifica alguns termos entre parênteses ("Lifestyle (sociology)",
 * "Society (social science)") porque vêm de artigos desambiguados da Wikipédia.
 * O parêntese não diz nada ao usuário e quebraria a busca no mapa.
 */
const semQualificador = (t) => String(t || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
const traduzTopico = (t) => {
  const base = semQualificador(t);
  return TOPICOS_PT[base] || base || '—';
};

/** Tópico mais específico do canal: os genéricos aparecem em quase todo mundo. */
const GENERICOS = new Set(['Music', 'Entertainment', 'Lifestyle', 'Society', 'Knowledge', 'Sport', 'Hobby', 'Film']);
function nichoPrincipal(c) {
  const t = (c.topicCategories || []).map(semQualificador);
  return traduzTopico(t.find((x) => !GENERICOS.has(x)) || t[0] || '—');
}
/** Países com lista curada em `api/rankings.js`. */
const PAISES = { BR: 'Brasil', US: 'Estados Unidos' };

export default async function top(root, params, ctx) {
  const s = store.get();
  const regiao = PAISES[params?.regiao] ? params.regiao : 'BR';
  const gentilico = regiao === 'BR' ? 'brasileiros' : 'norte-americanos';

  if (!can(s.plan, 'top_channels')) {
    const req = PLAN_BY_ID[requiredPlan('top_channels')];
    root.innerHTML = `<div class="page">
      <div class="page-head"><h1 class="flex ac g8">Top 20 canais ${flagOf(regiao, 20)}</h1>
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
            <h1 class="flex ac g8" style="flex-wrap:wrap">Top 20 canais por inscritos ${flagOf(regiao, 22)}</h1>
            <p>Canais ${gentilico} de grande alcance, ordenados pelos inscritos que a YouTube Data API
               devolve agora. A API não tem ranking global — a lista de candidatos é curada por nós e
               revisada conforme o cenário muda.</p>
          </div>
        </div>
      </div>
      <div data-body><div class="skel" style="height:420px;border-radius:14px"></div></div>
    </div>`;

  const body = root.querySelector('[data-body]');
  let canais = [];
  try {
    canais = await topChannels(20, regiao);
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
  const ANO = 365.25 * 86400000;

  // Métricas derivadas do que a API já entregou — nenhuma chamada extra.
  const enriquecidos = canais.map((c) => {
    const st = c.statistics;
    const idadeAnos = (Date.now() - new Date(c.publishedAt)) / ANO;
    return {
      ...c,
      idadeAnos,
      nicho: nichoPrincipal(c),
      viewsPorVideo: st.videoCount ? st.viewCount / st.videoCount : 0,
      viewsPorInscrito: st.subscriberCount ? st.viewCount / st.subscriberCount : 0,
      videosPorAno: idadeAnos > 0 ? st.videoCount / idadeAnos : 0,
      inscritosPorAno: idadeAnos > 0 ? st.subscriberCount / idadeAnos : 0,
    };
  });

  const totalInscritos = enriquecidos.reduce((s2, c) => s2 + c.statistics.subscriberCount, 0);
  const totalViews = enriquecidos.reduce((s2, c) => s2 + c.statistics.viewCount, 0);
  const maisEficiente = [...enriquecidos].sort((a, b) => b.viewsPorVideo - a.viewsPorVideo)[0];
  const maisProlifico = [...enriquecidos].sort((a, b) => b.videosPorAno - a.videosPorAno)[0];
  const maisRapido = [...enriquecidos].sort((a, b) => b.inscritosPorAno - a.inscritosPorAno)[0];

  const nichos = enriquecidos.reduce((acc, c) => ((acc[c.nicho] = (acc[c.nicho] || 0) + 1), acc), {});
  const nichoTop = Object.entries(nichos).sort((a, b) => b[1] - a[1])[0];

  body.innerHTML = `
    <div class="grid g4" style="margin-bottom:14px">
      ${miniCard('Inscritos somados', compact(totalInscritos), 'users', `${int(enriquecidos.length)} canais`)}
      ${miniCard('Views somadas', compact(totalViews), 'eye', 'desde a criação dos canais')}
      ${miniCard('Nicho mais comum', esc(nichoTop?.[0] || '—'), 'target', `${nichoTop?.[1] || 0} canais do ranking`)}
      ${miniCard('Cresce mais rápido', esc(maisRapido.title), 'up', `${compact(maisRapido.inscritosPorAno)} inscritos/ano`)}
    </div>

    <div class="grid g2" style="margin-bottom:18px">
      ${miniCard('Maior alcance por vídeo', esc(maisEficiente.title), 'zap', `${compact(maisEficiente.viewsPorVideo)} views por vídeo`)}
      ${miniCard('Publica mais', esc(maisProlifico.title), 'calendar', `${int(maisProlifico.videosPorAno)} vídeos por ano`)}
    </div>

    ${sectionCard({
      title: 'Ranking',
      sub: 'Clique em qualquer canal para abrir o relatório completo',
      pad: false,
      body: `<div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th style="width:52px">#</th><th>Canal</th><th>Nicho</th>
          <th class="n">Inscritos</th><th class="n">Views totais</th>
          <th class="n">Vídeos</th><th class="n">Views/vídeo</th>
          <th class="n">Views/inscrito</th><th class="n">Vídeos/ano</th>
          <th class="n">No ar desde</th><th></th>
        </tr></thead>
        <tbody>${enriquecidos.map((c) => `
          <tr data-open="${esc(c.id)}" style="cursor:pointer">
            <td><span class="rank-badge${c.rank <= 3 ? ' top' : ''}">${c.rank}</span></td>
            <td>
              <div class="flex ac g12">
                ${avatar(c, 36)}
                <div style="min-width:0">
                  <div style="font-weight:580;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</div>
                  <div class="muted fs12">${esc(c.handle || '')}</div>
                </div>
              </div>
            </td>
            <td><span class="chip">${esc(c.nicho)}</span></td>
            <td class="n"><b>${compact(c.statistics.subscriberCount)}</b></td>
            <td class="n">${compact(c.statistics.viewCount)}</td>
            <td class="n muted">${int(c.statistics.videoCount)}</td>
            <td class="n">${compact(c.viewsPorVideo)}</td>
            <td class="n">${dec(c.viewsPorInscrito, 0)}</td>
            <td class="n muted">${int(c.videosPorAno)}</td>
            <td class="n muted">${dateLong(c.publishedAt).replace(/^\d+ de /, '')}</td>
            <td class="n muted">${icon('chevron')}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div style="padding:12px 16px;border-top:1px solid var(--border)" class="muted fs12">
        <b>Views por inscrito</b> mede quanto o catálogo roda além da base — número alto indica conteúdo que
        circula fora dos inscritos. <b>Views por vídeo</b> mede eficiência: canal com poucos vídeos e muitas
        views acerta mais por publicação do que quem compensa no volume.
      </div>`,
    })}

    <div class="section grid g2">
      ${sectionCard({
        title: 'Inscritos, lado a lado',
        sub: 'A distância entre o topo e o resto costuma ser maior do que parece na tabela',
        body: `<div class="chart" data-chart="bars"></div>`,
      })}
      ${sectionCard({
        title: 'Alcance por vídeo',
        sub: 'Views medianas por publicação — quem rende mais por peça produzida',
        body: `<div class="chart" data-chart="eficiencia"></div>`,
      })}
    </div>`;

  hBarChart(body.querySelector('[data-chart="bars"]'), {
    rows: enriquecidos.map((c, i) => ({
      label: c.title,
      value: c.statistics.subscriberCount,
      color: colors[i % colors.length],
      tip: `<div class="tr"><span class="l">Views totais</span><b>${compact(c.statistics.viewCount)}</b></div>
            <div class="tr"><span class="l">Vídeos</span><b>${int(c.statistics.videoCount)}</b></div>
            <div class="tr"><span class="l">Nicho</span><b>${esc(c.nicho)}</b></div>`,
    })),
    formatValue: compact,
    labelWidth: 150,
    rowHeight: 28,
  });

  hBarChart(body.querySelector('[data-chart="eficiencia"]'), {
    rows: [...enriquecidos]
      .sort((a, b) => b.viewsPorVideo - a.viewsPorVideo)
      .map((c, i) => ({
        label: c.title,
        value: Math.round(c.viewsPorVideo),
        color: colors[i % colors.length],
        tip: `<div class="tr"><span class="l">Vídeos publicados</span><b>${int(c.statistics.videoCount)}</b></div>
              <div class="tr"><span class="l">Inscritos</span><b>${compact(c.statistics.subscriberCount)}</b></div>`,
      })),
    formatValue: compact,
    labelWidth: 150,
    rowHeight: 28,
  });

  body.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-open]');
    if (!row) return;
    if (await ensureAuth()) ctx.navigate(`#/canal/${row.dataset.open}`);
  });
}

function miniCard(label, value, iconName, sub = '') {
  return `<div class="card" style="padding:15px 16px">
    <div class="flex ac g8" style="color:var(--text-3)">${icon(iconName)}<span class="fs12" style="font-weight:550">${esc(label)}</span></div>
    <div class="num" style="font-size:20px;font-weight:650;letter-spacing:-.025em;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${value}</div>
    ${sub ? `<div class="muted fs12" style="margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub}</div>` : ''}
  </div>`;
}

function placeholder() {
  return `<div class="card"><div class="card-body tight"><table class="tbl">
    <thead><tr><th style="width:52px">#</th><th>Canal</th><th class="n">Inscritos</th><th class="n">Views</th></tr></thead>
    <tbody>${Array.from({ length: 6 }, (_, i) => `
      <tr><td><span class="rank-badge">${i + 1}</span></td><td>•••••••••</td><td class="n">•••</td><td class="n">•••</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
