/**
 * app.js — Shell da aplicação, roteador por hash e ligação global de eventos.
 *
 * Roteador por hash de propósito: o app é 100% estático e precisa abrir de
 * qualquer lugar (file://, GitHub Pages, um bucket) sem servidor reescrevendo
 * rotas. Cada view é carregada sob demanda com `import()` dinâmico, então a
 * primeira pintura não paga o custo das telas que o usuário talvez nem abra.
 */

import * as store from './store.js';
import { icon, qs, brandMark, flagBR } from './ui.js';
import { redrawAll } from './charts.js';
import { mountSearch } from './views/searchbox.js';
import { can, PLAN_BY_ID } from './plans.js';
import { int } from './format.js';

/* ------------------------------------------------------------------ rotas */

const ROUTES = [
  { path: /^#?\/?$/, shell: false, load: () => import('./views/landing.js'), title: 'Análise de canais do YouTube' },
  { path: /^#\/descobrir\/?$/, load: () => import('./views/discover.js'), nav: 'descobrir', title: 'Descobrir canais' },
  { path: /^#\/canal\/([^/]+)(?:\/([^/]+))?\/?$/, load: () => import('./views/public-report.js'), nav: 'descobrir', title: 'Relatório do canal', params: (m) => ({ id: m[1], tab: m[2] }) },
  { path: /^#\/top\/?$/, load: () => import('./views/top.js'), nav: 'top', title: 'Top 20 canais brasileiros' },
  { path: /^#\/rankings\/?$/, load: () => import('./views/rankings.js'), nav: 'rankings', title: 'Rankings' },
  { path: /^#\/comparar\/?$/, load: () => import('./views/compare.js'), nav: 'comparar', title: 'Comparar canais' },
  // Tolerante a `?conectado=1` / `?erro=...`: o callback do OAuth do Google
  // volta para cá anexando o resultado do login como query no próprio hash.
  { path: /^#\/criador\/?(?:\?.*)?$/, load: () => import('./views/creator.js'), nav: 'criador', title: 'Dashboard do Criador' },
  { path: /^#\/planos\/?$/, load: () => import('./views/pricing.js'), nav: 'planos', title: 'Planos' },
];

const NAV = [
  {
    group: 'Análise',
    items: [
      { id: 'descobrir', label: 'Descobrir canais', icon: 'search', href: '#/descobrir' },
      { id: 'top', label: 'Top 20', icon: 'trophy', href: '#/top', feature: 'top_channels', flag: true },
      { id: 'rankings', label: 'Rankings', icon: 'chart', href: '#/rankings', feature: 'rankings' },
      { id: 'comparar', label: 'Comparar canais', icon: 'compare', href: '#/comparar', feature: 'compare_channels' },
    ],
  },
  {
    group: 'Meu canal',
    items: [
      { id: 'criador', label: 'Dashboard do Criador', icon: 'gauge', href: '#/criador', feature: 'creator_dashboard' },
    ],
  },
  {
    group: 'Conta',
    items: [
      { id: 'planos', label: 'Planos e limites', icon: 'layers', href: '#/planos' },
    ],
  },
];

/* ------------------------------------------------------------------ shell */

const app = qs('#app');
let shellMounted = false;

function shellHtml() {
  return `
    <div class="app">
      <div class="nav-backdrop" data-nav-close></div>
      <aside class="nav" aria-label="Navegação principal">
        <div class="nav-brand">
          <a href="#/" class="flex ac g8" style="gap:9px"><span class="logo-mark"></span><strong>${brandMark()}</strong></a>
        </div>
        <div class="nav-scroll" data-nav-links></div>
        <div class="nav-foot">
          <div class="plan-box" data-plan-box></div>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon btn-sm nav-toggle" data-nav-open aria-label="Abrir menu">${icon('menu')}</button>
          <button class="btn btn-ghost btn-icon btn-sm nav-collapse-btn" data-nav-collapse
            aria-label="Esconder ou revelar a barra lateral" title="Esconder ou revelar a barra lateral">${icon('sidebar')}</button>
          <div class="crumbs"><span>${brandMark()}</span>${icon('chevron')}<b data-crumb>—</b></div>
          <div class="spacer"></div>
          <div class="search-wrap">
            ${icon('search')}
            <input class="input" type="search" placeholder="Buscar canal…" aria-label="Buscar canal" autocomplete="off" data-top-search>
          </div>
          <button class="btn btn-ghost btn-icon btn-sm" data-theme-toggle aria-label="Alternar tema">${icon('moon')}</button>
        </header>
        <main data-view></main>
      </div>
    </div>`;
}

function paintNav(activeId) {
  const s = store.get();

  qs('[data-nav-links]').innerHTML = NAV.map((g) => `
    <div class="nav-group">
      <span class="label">${g.group}</span>
      ${g.items.map((it) => {
        const locked = it.feature && !can(s.plan, it.feature);
        return `<a class="nav-link${it.id === activeId ? ' active' : ''}${locked ? ' locked' : ''}" href="${it.href}">
          ${icon(it.icon)}<span>${it.label}${it.flag ? ` ${flagBR(13)}` : ''}</span>${locked ? icon('lock', 'lock') : ''}
        </a>`;
      }).join('')}
    </div>`).join('');

  const { used, limit } = store.searchQuota();
  const planName = PLAN_BY_ID[s.plan].name;

  qs('[data-plan-box]').innerHTML = `
    <div class="row">
      <span class="name">Plano ${planName}</span>
      ${s.plan === 'creator' ? '<span class="chip chip-pos">Ativo</span>' : '<a href="#/planos" class="chip chip-brand">Fazer upgrade</a>'}
    </div>
    ${limit === Infinity
      ? '<div class="hint" style="margin-top:8px">Análises ilimitadas</div>'
      : `<div class="meter"><i style="width:${Math.min(100, (used / limit) * 100)}%"></i></div>
         <div class="hint">${int(Math.min(used, limit))} de ${int(limit)} análises usadas</div>`}`;

  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    b.innerHTML = icon(s.theme === 'dark' ? 'moon' : 'sun');
  });
}

/* ---------------------------------------------------------------- router */

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

let renderToken = 0;

/**
 * Contexto por renderização. `stale()` existe porque o guard de token do
 * roteador só protege até a view ser invocada: depois disso a própria view
 * ainda faz `await` de rede e, ao voltar, poderia escrever em cima de uma rota
 * mais nova. Toda view assíncrona checa `ctx.stale()` depois de cada await.
 */
const makeCtx = (token) => ({ navigate, stale: () => token !== renderToken });

async function render() {
  const hash = location.hash || '#/';
  const route = ROUTES.find((r) => r.path.test(hash)) || ROUTES[0];
  const match = hash.match(route.path);
  const params = route.params ? route.params(match) : {};
  const token = ++renderToken;

  document.title = `${route.title} · TubeMetrics`;
  document.body.classList.remove('nav-open');

  const ctx = makeCtx(token);

  if (route.shell === false) {
    shellMounted = false;
    const mod = await route.load();
    if (token !== renderToken) return;
    app.innerHTML = '';
    await mod.default(app, params, ctx);
    window.scrollTo(0, 0);
    return;
  }

  if (!shellMounted) {
    app.innerHTML = shellHtml();
    shellMounted = true;
    wireShell();
    applyNavCollapsed();
  }
  paintNav(route.nav);
  qs('[data-crumb]').textContent = route.title;

  const view = qs('[data-view]');
  const mod = await route.load();
  if (token !== renderToken) return;
  await mod.default(view, params, ctx);
  window.scrollTo(0, 0);
}

function wireShell() {
  mountSearch(qs('[data-top-search]'), async (c) => {
    const { ensureLead } = await import('./views/signup.js');
    if (await ensureLead()) navigate(`#/canal/${c.id}`);
  });
  qs('[data-nav-open]').addEventListener('click', () => document.body.classList.add('nav-open'));
  qs('[data-nav-close]').addEventListener('click', () => document.body.classList.remove('nav-open'));

  qs('[data-nav-collapse]').addEventListener('click', () => {
    const collapsed = !store.get().navCollapsed;
    store.set({ navCollapsed: collapsed });
    document.body.classList.toggle('nav-collapsed', collapsed);
    // A largura da barra mudou: os gráficos precisam recalcular o próprio espaço.
    setTimeout(() => redrawAll(), 260);
  });
}

/** Preferência de barra recolhida, aplicada ao montar a casca. */
function applyNavCollapsed() {
  document.body.classList.toggle('nav-collapsed', !!store.get().navCollapsed);
}

/* ------------------------------------------------------- eventos globais */

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    e.preventDefault();
    navigate(navBtn.dataset.nav);
    return;
  }

  const themeBtn = e.target.closest('[data-theme-toggle]');
  if (themeBtn) {
    store.toggleTheme();
    if (shellMounted) paintNav(ROUTES.find((r) => r.path.test(location.hash || '#/'))?.nav);
    // Os gráficos leem as variáveis CSS na hora de desenhar, então precisam
    // ser repintados depois que o novo tema entra em vigor.
    setTimeout(() => redrawAll(), 20);
    return;
  }

  const goalClear = e.target.closest('[data-goal-clear]');
  if (goalClear) {
    store.set({ goal: { subscribers: null, deadline: null } });
    render();
  }
});

// Atalho: "/" foca a busca, como em ferramentas de dashboard.
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    const input = qs('[data-top-search]') || qs('[data-search-input]');
    if (input) { e.preventDefault(); input.focus(); }
  }
});

window.addEventListener('hashchange', render);

/* -------------------------------------------------------------- bootstrap */

store.applyTheme(store.get().theme);
render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
