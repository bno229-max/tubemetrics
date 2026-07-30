/**
 * sw.js — Service worker do TubeMetrics.
 *
 * Estratégia:
 *   - HTML  → network-first, com o cache como rede de segurança offline.
 *   - Ativos → stale-while-revalidate: responde do cache na hora (rápido e
 *     offline) e busca a versão nova em segundo plano para o próximo load.
 *
 * Cache-first puro seria mais simples, mas prende o usuário na versão antiga
 * até alguém lembrar de bumpar o `CACHE` — o clássico "publiquei e não mudou
 * nada". Como os arquivos não têm hash no nome, revalidar é o comportamento
 * correto: no máximo uma visita fica desatualizada.
 */

// v6: conta de verdade (login/cadastro/senha) substitui o cadastro de
// localStorage — `signup.js` saiu do SHELL, `auth.js` entrou.
const CACHE = 'tubemetrics-v6';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './assets/css/app.css',
  './assets/js/app.js',
  './assets/js/api.js',
  './assets/js/config.js',
  './assets/js/charts.js',
  './assets/js/engine.js',
  './assets/js/format.js',
  './assets/js/mock-data.js',
  './assets/js/plans.js',
  './assets/js/store.js',
  './assets/js/ui.js',
  './assets/js/views/auth.js',
  './assets/js/views/compare.js',
  './assets/js/views/feature-matrix.js',
  './assets/js/views/top.js',
  './assets/js/views/creator.js',
  './assets/js/views/discover.js',
  './assets/js/views/landing.js',
  './assets/js/views/pricing.js',
  './assets/js/views/rankings.js',
  './assets/js/views/public-report.js',
  './assets/js/views/searchbox.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((url) => c.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  /**
   * `/api/**` nunca passa pelo cache do Service Worker.
   *
   * Cada rota de API já define sua própria política via `Cache-Control`
   * (`no-store` para sessão/autenticação, `s-maxage` para dados públicos) — o
   * SW interceptando por cima disso serve uma resposta velha ignorando essa
   * política. Foi exatamente isso que quebrou o logout do Dashboard do
   * Criador: depois de desconectar, `/api/analytics` continuava respondendo
   * do cache com os dados da sessão antiga, e a tela nunca via o 401 que
   * deveria trocá-la para "Conectar com o Google".
   */
  if (url.pathname.startsWith('/api/')) return;

  const store = (req, res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };

  // Navegação: rede primeiro, cache só se estiver offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => store(request, res))
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Ativos: responde do cache e revalida em segundo plano.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request)
        .then((res) => store(request, res))
        .catch(() => hit);
      return hit || fresh;
    })
  );
});
