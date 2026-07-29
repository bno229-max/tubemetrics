/** landing.js — Página pública de entrada: proposta de valor + busca. */

import { icon, avatar, toast, brandMark } from '../ui.js';
import { mountSearch } from './searchbox.js';
import { topChannels } from '../api.js';
import { ensureLead } from './signup.js';
import { featureMatrix } from './feature-matrix.js';
import { PLANS } from '../plans.js';
import { esc, money } from '../format.js';
import * as store from '../store.js';

const FEATURES = [
  { icon: 'target', t: 'Qual tema traz mais inscritos', d: 'Agrupamos seus vídeos por tema e ordenamos pela conversão real: inscritos por mil views, com correção estatística para amostras pequenas.' },
  { icon: 'clock', t: 'Melhor horário para publicar', d: 'Comparamos o desempenho das primeiras 48 h de cada envio anterior, neutralizando o crescimento do canal. Sai um mapa de calor 7 × 24.' },
  { icon: 'ruler', t: 'A duração que funciona', d: 'Faixas de tempo ranqueadas por alcance, retenção e conversão — porque "melhor duração" depende do que você quer otimizar.' },
  { icon: 'calendar', t: 'Frequência ideal', d: 'Cruzamos janelas de 28 dias entre ritmo de postagem e ganho líquido de inscritos para achar o ponto de retorno decrescente.' },
  { icon: 'gauge', t: 'Nota de 0 a 100', d: 'Quatro pilares auditáveis: engajamento, consistência, crescimento e alcance. Cada ponto vem com a fórmula que o gerou.' },
  { icon: 'money', t: 'Ganhos em faixa, não em chute', d: 'Conservador, médio e otimista sobre um RPM que você controla. Shorts entram com o pool separado, como na vida real.' },
];

const STEPS = [
  { n: '1', t: 'Busque qualquer canal', d: 'Só dados públicos da YouTube Data API. Sem permissão do dono do canal.' },
  { n: '2', t: 'Leia os cruzamentos', d: 'O motor roda dezenas de agrupamentos e devolve resposta pronta — não um gráfico para você interpretar.' },
  { n: '3', t: 'Conecte seu canal', d: 'Com OAuth do Google, entram receita, RPM, CTR de miniatura, retenção e fontes de tráfego.' },
];

export default async function landing(root, _params, ctx) {
  root.innerHTML = `
    <div class="landing">
      <nav class="lp-nav">
        <div class="brand"><span class="logo-mark"></span><strong>${brandMark()}</strong></div>
        <div class="grow"></div>
        <button class="btn btn-ghost btn-sm" data-nav="#/planos">Planos</button>
        <button class="btn btn-ghost btn-sm btn-icon" data-theme-toggle aria-label="Alternar tema">${icon('sun')}</button>
        <button class="btn btn-sm" data-nav="#/descobrir">Entrar no painel</button>
      </nav>

      <header class="hero">
        <div class="hero-inner">
          <span class="hero-badge">YouTube Analytics</span>
          <h1>Análise avançada para quem quer crescer no <em>YouTube</em>.</h1>
          <p>Explore qualquer canal do YouTube em segundos. Ao conectar o seu, tenha acesso completo
             as suas métricas de forma organizadas.</p>

          <form class="hero-search" data-search-form>
            <div class="search-wrap">
              ${icon('search')}
              <input class="input" type="search" placeholder="Busque um canal pelo nome ou @handle" aria-label="Buscar canal" autocomplete="off" data-search-input>
            </div>
            <button class="btn btn-primary btn-lg" type="submit">Analisar ${icon('arrow')}</button>
          </form>

          <div class="suggest" data-suggest>
            <span style="font-size:12.5px;color:var(--text-3);align-self:center;margin-right:2px">Acesse:</span>
          </div>
        </div>
      </header>

      <section class="lp-section">
        <h2>Métricas Oficiais para Criadores</h2>
        <div class="feat-grid">
          ${FEATURES.map((f) => `
            <div class="card feat-card">
              <div class="ico">${icon(f.icon)}</div>
              <h3>${esc(f.t)}</h3>
              <p>${esc(f.d)}</p>
            </div>`).join('')}
        </div>
      </section>

      <section class="lp-section" style="padding-top:0">
        <div class="grid g3">
          ${STEPS.map((s) => `
            <div class="card" style="padding:22px">
              <div style="width:28px;height:28px;border-radius:8px;background:var(--yt-500);color:#fff;display:grid;place-items:center;font-weight:680;font-size:13px">${s.n}</div>
              <h3 style="font-size:14.5px;font-weight:640;margin-top:13px;letter-spacing:-.015em">${esc(s.t)}</h3>
              <p style="font-size:13px;color:var(--text-2);margin-top:6px;line-height:1.55">${esc(s.d)}</p>
            </div>`).join('')}
        </div>
      </section>

      <section class="lp-section" style="padding-top:0">
        <h2>Planos</h2>
        <p class="lead">Comece de graça. Suba quando fazer sentido pra você.</p>
        <div class="price-grid" style="margin-top:30px">
          ${PLANS.map((p) => `
            <div class="card price-card${p.featured ? ' feat' : ''}">
              ${p.featured ? '<span class="tag">Mais popular</span>' : ''}
              <h3>${esc(p.name)}</h3>
              <div class="desc">${esc(p.tagline)}</div>
              <div class="amt"><b>${p.price === 0 ? 'R$ 0' : money(p.price)}</b><span>/mês</span></div>
              <ul>
                ${p.highlights.slice(0, 5).map((h) => `<li>${icon('checkSmall')}<span>${esc(h)}</span></li>`).join('')}
              </ul>
              <button class="btn ${p.featured ? 'btn-primary' : ''}" data-nav="#/planos">${esc(p.cta)}</button>
            </div>`).join('')}
        </div>

        <div style="margin-top:26px">
          ${featureMatrix({ title: 'Matriz de recursos', sub: 'O que cada plano libera, sem letra miúda' })}
        </div>
      </section>

      <footer class="lp-foot">
        ${brandMark()} · Criado por NCodexx
        <span style="margin:0 8px;opacity:.4">·</span>
        <a href="./privacidade.html" style="text-decoration:underline">Privacidade</a>
        <span style="margin:0 8px;opacity:.4">·</span>
        <a href="./termos.html" style="text-decoration:underline">Termos de Uso</a>
      </footer>
    </div>`;

  // Sugestões: canais reais de grande alcance, do mesmo ranking do Top 20.
  const sug = root.querySelector('[data-suggest]');
  try {
    const canais = await topChannels(5);
    if (ctx.stale()) return;
    for (const c of canais.slice(0, 5)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${avatar(c, 18)} ${esc(c.title)}`;
      b.addEventListener('click', () => openChannel(ctx, c.id));
      sug.appendChild(b);
    }
  } catch {
    sug.remove();
  }

  const input = root.querySelector('[data-search-input]');
  mountSearch(input, (c) => openChannel(ctx, c.id));

  root.querySelector('[data-search-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) return ctx.navigate('#/descobrir');
    // A busca resolve por sugestão: escolher da lista evita gastar uma análise
    // com um canal homônimo que não era o que a pessoa queria.
    toast('Escolha um canal na lista de sugestões', 'info');
    input.focus();
  });

  root.querySelector('[data-theme-toggle]').addEventListener('click', (e) => {
    const t = store.toggleTheme();
    e.currentTarget.innerHTML = icon(t === 'dark' ? 'moon' : 'sun');
  });
}

/** Cadastro é exigido antes de abrir qualquer relatório. */
async function openChannel(ctx, id) {
  if (await ensureLead()) ctx.navigate(`#/canal/${id}`);
}
