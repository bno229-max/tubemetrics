/** landing.js — Página pública de entrada: proposta de valor + busca. */

import { icon, avatar, toast, brandMark } from '../ui.js';
import { mountSearch } from './searchbox.js';
import { topChannels } from '../api.js';
import { ensureAuth } from './auth.js';
import { featureMatrix } from './feature-matrix.js';
import { PLANS } from '../plans.js';
import { esc, money } from '../format.js';
import * as store from '../store.js';

const FEATURES = [
  { icon: 'target', t: 'Qual tema traz mais inscritos', d: 'Agrupamos seus vídeos por tema e ordenamos pela conversão real: inscritos por mil views, com correção estatística para amostras pequenas.' },
  { icon: 'clock', t: 'Melhor horário para publicar', d: 'Comparamos o desempenho das primeiras 48 h de cada envio anterior, neutralizando o crescimento do canal. Sai um mapa de calor 7 × 24.' },
  { icon: 'ruler', t: 'A duração que funciona', d: 'Faixas de tempo ranqueadas por alcance, retenção e conversão.' },
  { icon: 'calendar', t: 'Frequência ideal', d: 'Cruzamos janelas de 28 dias entre ritmo de postagem e ganho líquido de inscritos para achar o ponto de equilíbrio.' },
  { icon: 'gauge', t: 'Nota de 0 a 100', d: 'Quatro pilares auditáveis: engajamento, consistência, crescimento e alcance.' },
  { icon: 'money', t: 'Estimativas de Ganhos', d: 'Conservador, médio e otimista baseados em RPM de nicho com valores ajustáveis.' },
];

const STEPS = [
  { n: '1', t: 'Busque qualquer canal', d: 'Amostra apenas dados públicos do YouTube Data API.' },
  { n: '2', t: 'Leia os cruzamentos', d: 'O motor calcula agrupamentos e devolve respostas prontas.' },
  { n: '3', t: 'Conecte seu canal', d: 'Com OAuth do Google, entram todas as métricas do seu canal — receita, RPM, CTR e outras — de forma organizada para análise.' },
];

export default async function landing(root, _params, ctx) {
  root.innerHTML = `
    <div class="landing">
      <nav class="lp-nav">
        <div class="brand"><span class="logo-mark"></span><strong>${brandMark()}</strong></div>
        <div class="grow"></div>
        <button class="btn btn-ghost btn-sm" data-scroll-planos>Planos</button>
        <button class="btn btn-ghost btn-sm btn-icon" data-theme-toggle aria-label="Alternar tema">${icon('sun')}</button>
        <button class="btn btn-sm" data-entrar>Entrar Conta</button>
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

      <section class="lp-section" style="padding-top:0" data-planos>
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
              <button class="btn ${p.featured ? 'btn-primary' : ''}" data-plano-cta>${esc(p.cta)}</button>
              ${p.id !== 'free' ? `
                <p class="muted fs12 cancel-note" style="margin-top:10px">
                  <span class="ico">${icon('checkSmall')}</span>
                  <span>Cancele quando quiser, sem burocracia</span>
                </p>` : ''}
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

  mountRotatingSuggestions(root.querySelector('[data-suggest]'), ctx);

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

  // "Planos" agora rola até a seção desta mesma página, em vez de jogar
  // alguém que ainda nem tem conta para dentro do painel.
  root.querySelector('[data-scroll-planos]').addEventListener('click', () => {
    rolarAte(root.querySelector('[data-planos]'));
  });

  // O painel exige conta: entrar e assinar passam pelo mesmo portão.
  root.querySelector('[data-entrar]').addEventListener('click', () => enterApp(ctx));
  root.querySelectorAll('[data-plano-cta]').forEach((b) =>
    b.addEventListener('click', () => enterApp(ctx, '#/planos'))
  );
}

/**
 * Rola até um trecho da página, com pouso suave onde der.
 *
 * Nem todo ambiente honra `behavior: 'smooth'` — alguns simplesmente ignoram
 * a chamada, e aí o botão não faz absolutamente nada, que é pior do que um
 * salto seco. Se a posição não mudou logo depois, terminamos o trabalho na
 * marra.
 */
function rolarAte(alvo) {
  if (!alvo) return;
  const destino = alvo.getBoundingClientRect().top + window.scrollY;
  const partida = window.scrollY;

  window.scrollTo({ top: destino, behavior: 'smooth' });
  setTimeout(() => {
    if (Math.abs(window.scrollY - partida) < 2) window.scrollTo(0, destino);
  }, 250);
}

/** Cadastro é exigido antes de abrir qualquer relatório. */
async function openChannel(ctx, id) {
  if (await ensureAuth()) ctx.navigate(`#/canal/${id}`);
}

/** Só entra no painel quem tem conta — o modal resolve login ou cadastro. */
async function enterApp(ctx, destino = '#/descobrir') {
  if (await ensureAuth()) ctx.navigate(destino);
}

/* ==========================================================================
   Atalhos de canais que se revezam
   ========================================================================== */

/** Quantos atalhos cabem de uma vez, e de quanto em quanto tempo trocam. */
const VISIVEIS = 5;
const INTERVALO_MS = 3200;

/**
 * Busca um lote de canais e mostra `VISIVEIS` por vez, rodando a janela pela
 * lista. Cada troca acontece num botão só, em cascata, para a linha inteira
 * não piscar junto — e o timer morre quando a landing sai da tela.
 */
async function mountRotatingSuggestions(host, ctx) {
  if (!host) return;

  let canais;
  try {
    canais = await topChannels(10);
  } catch {
    host.remove(); // sem backend, some em vez de mostrar um esqueleto vazio
    return;
  }
  if (ctx.stale() || !canais?.length) return;

  const botoes = [];
  for (let i = 0; i < Math.min(VISIVEIS, canais.length); i++) {
    const b = document.createElement('button');
    b.type = 'button';
    pintar(b, canais[i]);
    b.addEventListener('click', () => openChannel(ctx, b.dataset.channelId));
    host.appendChild(b);
    botoes.push(b);
  }

  // Nada a revezar se o lote não é maior que a janela.
  if (canais.length <= botoes.length) return;

  let proximo = botoes.length;
  let alvo = 0;

  const timer = setInterval(() => {
    // A landing foi desmontada (o roteador trocou de tela): para o timer.
    if (!host.isConnected) return clearInterval(timer);

    const b = botoes[alvo];
    const canal = canais[proximo % canais.length];

    b.classList.remove('swap');
    void b.offsetWidth; // reinicia a animação mesmo trocando o mesmo botão
    b.classList.add('swap');
    // Troca no meio da pulsação, quando o botão está invisível.
    setTimeout(() => pintar(b, canal), 220);

    proximo++;
    alvo = (alvo + 1) % botoes.length;
  }, INTERVALO_MS);
}

function pintar(botao, canal) {
  botao.dataset.channelId = canal.id;
  botao.innerHTML = `${avatar(canal, 18)} ${esc(canal.title)}`;
}
