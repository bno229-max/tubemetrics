/**
 * mock-data.js — Camada de dados simulada.
 *
 * Reproduz o SHAPE exato das respostas que virão da YouTube Data API v3 e da
 * YouTube Analytics API v2. Nenhum componente da UI conhece este arquivo:
 * todos consomem `api.js`, que hoje lê daqui e amanhã lerá da rede.
 *
 * Os dados são gerados por um PRNG semeado (mulberry32) — a mesma seed produz
 * sempre o mesmo canal, então a UI é testável e os números não "dançam" a cada
 * reload. O gerador PLANTA sinais reais (janelas de horário boas, temas que
 * convertem melhor, faixas de duração com retenção maior) para que o motor de
 * análise em `engine.js` tenha algo verdadeiro para descobrir.
 */

/* ------------------------------------------------------------------ PRNG */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Amostra de distribuição log-normal — modela a cauda longa de views. */
function logNormal(rnd, sigma = 0.62) {
  const u1 = Math.max(rnd(), 1e-9);
  const u2 = rnd();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(z * sigma - (sigma * sigma) / 2);
}

const pickWeighted = (rnd, items, weightOf) => {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let r = rnd() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DAY = 86400000;

/* ------------------------------------------------------- perfis de canal */

/**
 * Cada perfil descreve um nicho. `bestHours`/`bestDays` são o sinal plantado
 * que o motor de "melhor horário para publicar" precisa reencontrar.
 */
const PROFILES = [
  {
    id: 'UC_devrocket_0001',
    handle: '@devrocket',
    title: 'DevRocket',
    country: 'BR',
    tagline: 'Programação, carreira em tech e projetos práticos toda semana.',
    createdDaysAgo: 1580,
    accent: ['#ff0033', '#7a0d3f'],
    videoCount: 96,
    cadenceDays: 3.4,
    cadenceJitter: 1.5,
    shortsShare: 0.36,
    baseViews: 42000,
    growthPerYear: 1.55,
    subsPerK: 7.4,
    baseCtr: 6.2,
    bestHours: [18, 19, 20],
    bestDays: [2, 4],
    topics: [
      { name: 'Carreira em Tech', w: 22, viewM: 1.42, subM: 1.85, retM: 1.1, rpm: 34, tags: ['carreira', 'primeiro emprego', 'entrevista', 'salário dev'] },
      { name: 'Tutorial JavaScript', w: 24, viewM: 1.0, subM: 0.95, retM: 0.92, rpm: 26, tags: ['javascript', 'tutorial', 'front-end', 'react'] },
      { name: 'Notícias & Ferramentas', w: 18, viewM: 0.88, subM: 0.72, retM: 0.8, rpm: 21, tags: ['notícias', 'ferramentas', 'lançamento'] },
      { name: 'Projetos do Zero', w: 20, viewM: 1.18, subM: 1.34, retM: 1.16, rpm: 31, tags: ['projeto', 'passo a passo', 'do zero', 'portfólio'] },
      { name: 'Bastidores & Vlog', w: 16, viewM: 0.62, subM: 0.5, retM: 0.72, rpm: 17, tags: ['vlog', 'bastidores', 'rotina'] },
    ],
    titles: {
      'Carreira em Tech': ['Como consegui meu primeiro emprego dev em {n} meses', 'O que ninguém te conta sobre ser dev júnior', 'Quanto ganha um dev {lvl} em {yr}', '{n} erros que travam sua carreira em tech', 'Entrevista técnica: o que eles realmente avaliam'],
      'Tutorial JavaScript': ['JavaScript moderno em {n} minutos', 'Pare de usar {x} — faça assim', 'React do jeito certo: {n} padrões essenciais', 'Async/await explicado de uma vez por todas', '{n} truques de JS que você não conhecia'],
      'Notícias & Ferramentas': ['O que mudou no {x} desta semana', '{n} ferramentas novas que valem seu tempo', 'Testei o {x} por 30 dias — veredito', 'A atualização que quebrou tudo'],
      'Projetos do Zero': ['Construindo um {x} completo do zero', 'Clone do {x}: parte {n}', 'Meu projeto de portfólio favorito — passo a passo', 'De ideia a deploy em uma tarde'],
      'Bastidores & Vlog': ['Um dia na vida de um dev remoto', 'Meu setup de {yr}', 'Como eu organizo minha semana', 'Respondendo as perguntas de vocês'],
    },
  },
  {
    id: 'UC_cozinhadoze_002',
    handle: '@cozinhadoze',
    title: 'Cozinha do Zé',
    country: 'BR',
    tagline: 'Receitas simples, ingredientes baratos e nada de frescura.',
    createdDaysAgo: 2240,
    accent: ['#e08b16', '#8a3a10'],
    videoCount: 128,
    cadenceDays: 2.6,
    cadenceJitter: 1.1,
    shortsShare: 0.52,
    baseViews: 88000,
    growthPerYear: 1.28,
    subsPerK: 4.1,
    baseCtr: 7.8,
    bestHours: [11, 12, 17],
    bestDays: [5, 6],
    topics: [
      { name: 'Receitas Rápidas', w: 30, viewM: 1.25, subM: 1.05, retM: 1.05, rpm: 12, tags: ['receita rápida', '15 minutos', 'fácil', 'jantar'] },
      { name: 'Doces & Sobremesas', w: 20, viewM: 1.55, subM: 1.62, retM: 1.12, rpm: 15, tags: ['sobremesa', 'bolo', 'doce', 'confeitaria'] },
      { name: 'Comida Econômica', w: 22, viewM: 1.1, subM: 1.28, retM: 1.08, rpm: 11, tags: ['barato', 'econômico', 'fim do mês', 'marmita'] },
      { name: 'Churrasco & Carnes', w: 14, viewM: 1.3, subM: 1.15, retM: 1.18, rpm: 18, tags: ['churrasco', 'carne', 'boteco'] },
      { name: 'Dicas de Cozinha', w: 14, viewM: 0.72, subM: 0.66, retM: 0.85, rpm: 10, tags: ['dica', 'truque', 'organização'] },
    ],
    titles: {
      'Receitas Rápidas': ['Jantar pronto em {n} minutos', 'A receita mais fácil que já fiz', '{n} receitas com o que tem na geladeira', 'Almoço completo numa panela só'],
      'Doces & Sobremesas': ['Bolo de {x} que não desanda', 'Sobremesa de {n} ingredientes', 'O brigadeiro perfeito — segredo revelado', 'Torta gelada para o calor'],
      'Comida Econômica': ['Comi por R$ {n} o dia inteiro', 'Marmita da semana por menos de R$ {n}', 'Fim do mês salvo com {x}', 'A proteína mais barata do mercado'],
      'Churrasco & Carnes': ['Picanha na frigideira: sim, dá certo', 'Churrasco sem churrasqueira', 'O ponto perfeito da carne', 'Costela de {n} horas'],
      'Dicas de Cozinha': ['{n} erros que estragam sua comida', 'Como afiar faca em casa', 'Organizando a despensa', 'O que eu sempre tenho em casa'],
    },
  },
  {
    id: 'UC_granaemordem03',
    handle: '@granaemordem',
    title: 'Grana em Ordem',
    country: 'BR',
    tagline: 'Finanças pessoais sem promessa milagrosa. Planilha e disciplina.',
    createdDaysAgo: 1120,
    accent: ['#1a9e8f', '#0d4f4a'],
    videoCount: 74,
    cadenceDays: 4.8,
    cadenceJitter: 2.4,
    shortsShare: 0.24,
    baseViews: 26000,
    growthPerYear: 2.05,
    subsPerK: 9.2,
    baseCtr: 5.4,
    bestHours: [7, 8, 20],
    bestDays: [1, 3],
    topics: [
      { name: 'Investimentos', w: 26, viewM: 1.35, subM: 1.55, retM: 1.14, rpm: 62, tags: ['investimento', 'renda fixa', 'tesouro', 'cdb'] },
      { name: 'Sair das Dívidas', w: 20, viewM: 1.48, subM: 1.92, retM: 1.22, rpm: 48, tags: ['dívida', 'negociação', 'nome limpo'] },
      { name: 'Planilhas & Orçamento', w: 22, viewM: 0.94, subM: 1.18, retM: 1.05, rpm: 41, tags: ['planilha', 'orçamento', 'controle', 'método'] },
      { name: 'Impostos & Burocracia', w: 16, viewM: 0.78, subM: 0.7, retM: 0.88, rpm: 55, tags: ['imposto de renda', 'mei', 'declaração'] },
      { name: 'Notícias de Mercado', w: 16, viewM: 0.7, subM: 0.55, retM: 0.68, rpm: 39, tags: ['mercado', 'selic', 'economia'] },
    ],
    titles: {
      'Investimentos': ['Onde investir com Selic a {n}%', 'Renda fixa x renda variável em {yr}', 'R$ {n} por mês: quanto vira em 10 anos', 'O investimento que eu evitaria hoje'],
      'Sair das Dívidas': ['Como saí de R$ {n} mil em dívidas', 'Negociando com o banco: o roteiro', 'A ordem certa para pagar suas dívidas', 'Cartão de crédito: o buraco real'],
      'Planilhas & Orçamento': ['Minha planilha de orçamento — download grátis', 'Método {n} envelopes adaptado ao Brasil', 'Onde seu dinheiro some todo mês', 'Orçamento em 20 minutos por mês'],
      'Impostos & Burocracia': ['Declaração do IR passo a passo', 'MEI: o que muda em {yr}', 'Erros que caem na malha fina', 'Como abrir conta PJ sem dor'],
      'Notícias de Mercado': ['O que a Selic de {n}% muda pra você', 'Resumo da semana em 8 minutos', 'Inflação: leitura sem pânico'],
    },
  },
  {
    id: 'UC_pixelstorm_004',
    handle: '@pixelstorm',
    title: 'PixelStorm',
    country: 'BR',
    tagline: 'Análises de jogos, retrô e speedruns comentados.',
    createdDaysAgo: 2960,
    accent: ['#6f4bd8', '#2b1461'],
    videoCount: 142,
    cadenceDays: 2.1,
    cadenceJitter: 0.9,
    shortsShare: 0.44,
    baseViews: 154000,
    growthPerYear: 1.12,
    subsPerK: 3.2,
    baseCtr: 8.6,
    bestHours: [21, 22, 15],
    bestDays: [5, 0],
    topics: [
      { name: 'Análises & Reviews', w: 24, viewM: 1.22, subM: 1.24, retM: 1.06, rpm: 22, tags: ['review', 'análise', 'vale a pena'] },
      { name: 'Retrô & Nostalgia', w: 20, viewM: 1.62, subM: 1.7, retM: 1.28, rpm: 19, tags: ['retrô', 'nostalgia', 'clássico', 'snes'] },
      { name: 'Gameplay Comentado', w: 26, viewM: 0.9, subM: 0.72, retM: 0.9, rpm: 15, tags: ['gameplay', 'comentado', 'jogando'] },
      { name: 'Speedrun', w: 14, viewM: 1.05, subM: 1.16, retM: 1.34, rpm: 17, tags: ['speedrun', 'recorde', 'any%'] },
      { name: 'Notícias Gamer', w: 16, viewM: 0.75, subM: 0.6, retM: 0.66, rpm: 14, tags: ['notícia', 'lançamento', 'trailer'] },
    ],
    titles: {
      'Análises & Reviews': ['{x} vale a pena em {yr}?', 'Joguei {n} horas de {x} — análise honesta', 'O jogo que dividiu a internet', 'Review sem spoilers: {x}'],
      'Retrô & Nostalgia': ['Voltei a jogar {x} depois de {n} anos', 'Os {n} melhores jogos de SNES', 'Por que {x} envelheceu tão bem', 'A era de ouro dos arcades'],
      'Gameplay Comentado': ['Zerando {x} pela primeira vez', '{x} no modo mais difícil — parte {n}', 'Jogando {x} sem tomar dano', 'A run que quase deu certo'],
      'Speedrun': ['Recorde mundial de {x} explicado', 'Speedrun any% em {n} minutos', 'Os glitches que quebram {x}', 'Tentando bater meu próprio tempo'],
      'Notícias Gamer': ['Tudo o que rolou nesta semana', 'O trailer que ninguém esperava', 'Lançamentos de {yr} que importam'],
    },
  },
];

/** Vocabulário por nicho — evita "frango" aparecer num canal de programação. */
const FILLS = {
  UC_devrocket_0001: ['Vite', 'TypeScript', 'Docker', 'Next.js', 'Tailwind', 'React', 'Node', 'Git', 'Rust'],
  UC_cozinhadoze_002: ['chocolate', 'cenoura', 'limão', 'frango', 'banana', 'milho', 'queijo', 'fubá'],
  UC_granaemordem03: ['Tesouro Direto', 'CDB', 'FGTS', 'fundo imobiliário', 'IPCA+', 'conta digital'],
  UC_pixelstorm_004: ['Zelda', 'Chrono Trigger', 'Hollow Knight', 'Elden Ring', 'Mario Kart', 'Silent Hill', 'Doom'],
};

/** Variantes aplicadas quando um título repetiria — canais reais reeditam temas. */
const DEDUPE_SUFFIXES = [' — o guia completo', ' — versão atualizada', ': o que mudou', ' — parte 2', ' (revisitado)'];

/**
 * Gera um título e garante unicidade dentro do canal. Templates sem
 * placeholder (`{n}`, `{x}`) colidiriam com frequência; nesses casos aplicamos
 * uma variante de sufixo em vez de repetir o mesmo título.
 */
function buildTitle(rnd, profile, topic, used) {
  const pool = profile.titles[topic.name];
  const fills = FILLS[profile.id] || FILLS.UC_devrocket_0001;
  const render = () =>
    pool[Math.floor(rnd() * pool.length)]
      .replace(/\{n\}/g, () => String(3 + Math.floor(rnd() * 27)))
      .replace(/\{x\}/g, () => fills[Math.floor(rnd() * fills.length)])
      .replace(/\{yr\}/g, () => String(new Date().getFullYear()))
      .replace(/\{lvl\}/g, () => ['júnior', 'pleno', 'sênior'][Math.floor(rnd() * 3)]);

  let title = render();
  for (let i = 0; i < 8 && used.has(title); i++) title = render();
  for (let i = 0; used.has(title) && i < DEDUPE_SUFFIXES.length; i++) {
    title = `${render()}${DEDUPE_SUFFIXES[i]}`;
  }
  used.add(title);
  return title;
}

/* ------------------------------------------------------ geração de vídeo */

function buildVideos(profile) {
  const rnd = mulberry32(hashStr(profile.id));
  const now = Date.now();
  const videos = [];
  const usedTitles = new Set();

  // Caminha do vídeo mais recente para trás, sorteando o intervalo de upload.
  let cursor = now - Math.floor(rnd() * 3 * DAY);

  for (let i = 0; i < profile.videoCount; i++) {
    const topic = pickWeighted(rnd, profile.topics, (t) => t.w);
    const isShort = rnd() < profile.shortsShare;

    // Ajusta o timestamp para uma hora de publicação plausível: o canal tende
    // às suas "bestHours", mas publica fora delas com frequência suficiente
    // para que a comparação estatística tenha amostra dos dois lados.
    const d = new Date(cursor);
    const inWindow = rnd() < 0.46;
    const hour = inWindow
      ? profile.bestHours[Math.floor(rnd() * profile.bestHours.length)]
      : Math.floor(rnd() * 24);
    d.setHours(hour, Math.floor(rnd() * 60), 0, 0);
    const publishedAt = d.getTime();
    const ageDays = Math.max(0.5, (now - publishedAt) / DAY);

    const durationSec = isShort
      ? 14 + Math.floor(rnd() * 46)
      : Math.floor((240 + rnd() * 1500) * (topic.retM > 1.1 ? 1.25 : 1));

    // Views: base do canal × tema × maturidade (curva de saturação) ×
    // tendência de crescimento × ruído log-normal (viralização é cauda longa).
    const maturity = 1 - Math.exp(-ageDays / 21);
    const yearsAgo = ageDays / 365;
    const trend = Math.pow(profile.growthPerYear, -yearsAgo);
    const shortBoost = isShort ? 2.35 : 1;
    const views = Math.round(
      profile.baseViews * topic.viewM * shortBoost * maturity * trend * logNormal(rnd, isShort ? 0.95 : 0.6)
    );

    // Retenção: cai com a duração (vídeo longo segura % menor), sobe com temas
    // de alto interesse. Shorts vivem numa faixa própria.
    const lenPenalty = isShort ? 1 : clamp(1.18 - durationSec / 4200, 0.42, 1.05);
    const avgViewPct = clamp(
      (isShort ? 66 : 41) * topic.retM * lenPenalty * (0.86 + rnd() * 0.3),
      12,
      isShort ? 96 : 78
    );

    // CTR só existe para vídeos longos (Shorts não têm miniatura clicável).
    const ctr = isShort ? null : clamp(profile.baseCtr * (0.7 + rnd() * 0.72) * topic.viewM ** 0.4, 1.4, 19);

    // Inscritos ganhos: proporcional às views, modulado pelo poder de
    // conversão do tema. Shorts convertem bem menos por view.
    const subsGained = Math.max(
      0,
      Math.round((views / 1000) * profile.subsPerK * topic.subM * (isShort ? 0.34 : 1) * (0.72 + rnd() * 0.62))
    );

    // Primeiras 48h: fração das views totais. Vídeo publicado na janela boa do
    // canal arranca mais forte — este é o sinal que o motor vai recuperar.
    const windowBonus = profile.bestHours.includes(hour) ? 1.42 : 1;
    const dayBonus = profile.bestDays.includes(d.getDay()) ? 1.16 : 1;
    const share48 = clamp(
      (isShort ? 0.22 : 0.3) * windowBonus * dayBonus * (0.78 + rnd() * 0.42) * clamp(30 / ageDays, 0.35, 1.6),
      0.03,
      0.94
    );
    const views48h = Math.round(views * share48);

    const engagementRate = (isShort ? 0.052 : 0.038) * topic.retM * (0.7 + rnd() * 0.75);
    const likes = Math.round(views * engagementRate);
    const comments = Math.round(likes * (0.05 + rnd() * 0.1));

    // Receita: Shorts remuneram por um pool separado, muito menor por mil views.
    const rpmEff = isShort ? topic.rpm * 0.055 : topic.rpm * (0.78 + rnd() * 0.5);
    const revenue = Math.round(((views / 1000) * rpmEff) * 100) / 100;

    const extraTags = ['2025', '2026', 'passo a passo', 'iniciante', 'completo'];
    const tags = [
      ...topic.tags.filter(() => rnd() < 0.75),
      extraTags[Math.floor(rnd() * extraTags.length)],
      profile.title.toLowerCase(),
    ];

    videos.push({
      id: `${profile.id.slice(-4)}_v${String(i).padStart(3, '0')}`,
      title: buildTitle(rnd, profile, topic, usedTitles) + (isShort ? ' #shorts' : ''),
      publishedAt: new Date(publishedAt).toISOString(),
      durationSec,
      isShort,
      topic: topic.name,
      tags: tags.length ? tags : topic.tags.slice(0, 2),
      views,
      likes,
      comments,
      subsGained,
      views48h,
      ctr: ctr === null ? null : Math.round(ctr * 10) / 10,
      avgViewPct: Math.round(avgViewPct * 10) / 10,
      avgViewDurationSec: Math.round((durationSec * avgViewPct) / 100),
      revenue,
      accent: profile.accent,
    });

    cursor -= Math.max(0.35, profile.cadenceDays + (rnd() - 0.5) * 2 * profile.cadenceJitter) * DAY;
    // Hiatos ocasionais — canais reais têm férias, doença, bloqueio criativo.
    if (rnd() < 0.05) cursor -= (5 + rnd() * 22) * DAY;
  }

  return videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

/* -------------------------------------------- séries diárias (Analytics) */

/**
 * Constrói 540 dias de métricas diárias. As views diárias são a soma do
 * "long tail" de cada vídeo (decaimento exponencial a partir da publicação)
 * mais um piso de catálogo — do mesmo jeito que um canal real se comporta.
 */
function buildDailySeries(profile, videos) {
  const rnd = mulberry32(hashStr(profile.id + ':daily'));
  const days = 540;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = [];

  const pubs = videos.map((v) => ({
    t: new Date(v.publishedAt).setHours(0, 0, 0, 0),
    views: v.views,
    subs: v.subsGained,
    rev: v.revenue,
    isShort: v.isShort,
    pct: v.avgViewPct,
    dur: v.durationSec,
    ctr: v.ctr,
  }));

  for (let i = days - 1; i >= 0; i--) {
    const t = today.getTime() - i * DAY;
    const d = new Date(t);

    let views = 0, subsG = 0, revenue = 0, watchMin = 0;
    for (const p of pubs) {
      const age = (t - p.t) / DAY;
      if (age < 0 || age > 400) continue;
      // Decaimento: pico no dia 0-1, meia-vida curta, cauda longa persistente.
      const decay = 0.16 * Math.exp(-age / 4.5) + 0.011 * Math.exp(-age / 60) + 0.0012;
      const dv = p.views * decay;
      views += dv;
      subsG += (p.subs / Math.max(1, p.views)) * dv;
      revenue += (p.rev / Math.max(1, p.views)) * dv;
      watchMin += (dv * p.dur * (p.pct / 100)) / 60;
    }

    // Sazonalidade semanal + ruído diário.
    const dow = d.getDay();
    const weekly = [0.94, 0.99, 1.02, 1.02, 1.04, 1.08, 1.0][dow];
    const noise = 0.9 + rnd() * 0.2;
    views = Math.round(views * weekly * noise);
    watchMin = Math.round(watchMin * weekly * noise);
    revenue = Math.round(revenue * weekly * noise * 100) / 100;

    const gained = Math.round(subsG * weekly * noise);
    // Perdas de inscritos correlacionam fracamente com volume de publicação.
    const lost = Math.round(gained * (0.14 + rnd() * 0.2) + views * 0.00012);

    // Impressões por view calibradas para CTR na faixa real do YouTube (4–10%).
    const impressions = Math.round(views * (10.5 + rnd() * 13));
    rows.push({
      date: d.toISOString().slice(0, 10),
      views,
      estimatedMinutesWatched: watchMin,
      subscribersGained: gained,
      subscribersLost: lost,
      estimatedRevenue: revenue,
      impressions,
      impressionClickThroughRate: Math.round((views / Math.max(1, impressions)) * 1000) / 10,
      averageViewDuration: Math.round((watchMin * 60) / Math.max(1, views)),
    });
  }
  return rows;
}

/* ----------------------------------------------- dimensões (Analytics) */

function buildDimensions(profile, videos) {
  const rnd = mulberry32(hashStr(profile.id + ':dim'));
  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  const shortsShare = videos.filter((v) => v.isShort).reduce((s, v) => s + v.views, 0) / totalViews;

  const dist = (entries) => {
    const withNoise = entries.map(([k, w]) => [k, w * (0.82 + rnd() * 0.36)]);
    const sum = withNoise.reduce((s, [, w]) => s + w, 0);
    return withNoise
      .map(([k, w]) => ({ name: k, views: Math.round(totalViews * (w / sum)), share: w / sum }))
      .sort((a, b) => b.views - a.views);
  };

  return {
    trafficSources: dist([
      ['Shorts feed', 8 + shortsShare * 60],
      ['Sugestões do YouTube', 26],
      ['Busca do YouTube', 19],
      ['Página inicial', 15],
      ['Playlists', 5],
      ['Externo (sites e apps)', 6],
      ['Notificações', 4],
      ['Canal / Inscrições', 7],
    ]),
    countries: dist([
      ['Brasil', 72],
      ['Portugal', 8],
      ['Estados Unidos', 5],
      ['Angola', 3.4],
      ['Moçambique', 2.1],
      ['Japão', 1.6],
      ['Outros', 8],
    ]),
    devices: dist([
      ['Celular', 62],
      ['Computador', 21],
      ['TV', 11],
      ['Tablet', 4],
      ['Console', 2],
    ]),
    ageGender: [
      { bucket: '13-17', m: 5.1, f: 2.4 },
      { bucket: '18-24', m: 18.9, f: 9.2 },
      { bucket: '25-34', m: 24.6, f: 11.8 },
      { bucket: '35-44', m: 13.2, f: 6.4 },
      { bucket: '45-54', m: 4.8, f: 2.2 },
      { bucket: '55+', m: 1.1, f: 0.3 },
    ],
  };
}

/* ------------------------------------------------------ montagem final */

function buildChannel(profile) {
  const videos = buildVideos(profile);
  const daily = buildDailySeries(profile, videos);
  const dimensions = buildDimensions(profile, videos);

  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  // O catálogo publicado não é 100% do histórico do canal — há vídeos antigos
  // fora da janela amostrada. Aplicamos um fator de catálogo.
  const lifetimeViews = Math.round(totalViews * 1.34);
  const subscriberCount = Math.round((lifetimeViews / 1000) * profile.subsPerK * 0.82);

  return {
    id: profile.id,
    handle: profile.handle,
    title: profile.title,
    description: profile.tagline,
    country: profile.country,
    accent: profile.accent,
    publishedAt: new Date(Date.now() - profile.createdDaysAgo * DAY).toISOString(),
    statistics: {
      subscriberCount,
      viewCount: lifetimeViews,
      videoCount: profile.videoCount + Math.round(profile.videoCount * 0.34),
    },
    // Nicho declarado pelo canal (equivalente a topicDetails.topicCategories).
    topicCategories: profile.topics.map((t) => t.name),
    videos,
    analytics: { daily, dimensions },
  };
}

export const CHANNELS = PROFILES.map(buildChannel);

/** Canal "conectado" no dashboard do criador (simula o OAuth já concluído). */
export const OWNED_CHANNEL_ID = PROFILES[0].id;

export function searchChannels(query) {
  const q = String(query || '').trim().toLowerCase().replace(/^@/, '');
  if (!q) return [];
  return CHANNELS.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.handle.toLowerCase().replace('@', '').includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.topicCategories.some((t) => t.toLowerCase().includes(q))
  );
}

export function getChannel(id) {
  return CHANNELS.find((c) => c.id === id) || null;
}
