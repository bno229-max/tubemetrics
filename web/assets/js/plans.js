/**
 * plans.js — Feature flags e limites por plano (§4).
 *
 * O bloqueio é declarado UMA vez aqui e consultado em toda a UI por `can()` e
 * `limitOf()`. Nenhuma tela decide sozinha o que mostrar — assim, mudar o
 * empacotamento comercial é editar esta tabela, não caçar `if` pelo código.
 *
 * Em produção, esta mesma tabela vive no servidor e é a única autoridade: o
 * front esconde, o back-end recusa. Flag de cliente é UX, não segurança.
 */

/** Catálogo de recursos. `tiers` lista os planos que liberam o recurso. */
export const FEATURES = {
  public_analysis:    { label: 'Análise pública de canais',             tiers: ['free', 'starter', 'pro', 'creator'] },
  channel_score:      { label: 'Nota geral do canal',                   tiers: ['free', 'starter', 'pro', 'creator'] },
  earnings_estimate:  { label: 'Estimativa de ganhos por faixa',        tiers: ['free', 'starter', 'pro', 'creator'] },
  favorites:          { label: 'Favoritar canais',                      tiers: ['starter', 'pro', 'creator'] },
  history_full:       { label: 'Histórico completo (sem corte)',        tiers: ['starter', 'pro', 'creator'] },
  advanced_insights:  { label: 'Consultor de dados completo',           tiers: ['starter', 'pro', 'creator'] },
  best_time:          { label: 'Melhor horário para publicar',          tiers: ['starter', 'pro', 'creator'] },
  ideal_frequency:    { label: 'Frequência ideal de postagem',          tiers: ['starter', 'pro', 'creator'] },
  compare_channels:   { label: 'Comparação de canais',                  tiers: ['starter', 'pro', 'creator'] },
  top_channels:       { label: 'Ranking Top 20 por inscritos',          tiers: ['starter', 'pro', 'creator'] },
  rankings:           { label: 'Rankings globais e por país',            tiers: ['starter', 'pro', 'creator'] },
  growth_alerts:      { label: 'Alertas de meta de crescimento',        tiers: ['starter', 'pro', 'creator'] },
  creator_dashboard:  { label: 'Dashboard do Criador (dados privados)', tiers: ['starter', 'pro', 'creator'] },
  revenue_per_video:  { label: 'Receita detalhada por vídeo',           tiers: ['starter', 'pro', 'creator'] },
  multi_channel:      { label: 'Múltiplos canais (gestão de rede)',     tiers: ['pro', 'creator'] },
  team_seats:         { label: 'Acesso para equipes',                   tiers: ['pro', 'creator'] },
  export_reports:     { label: 'Exportação PDF / Excel',                tiers: ['pro', 'creator'] },
};

/**
 * Limites numéricos. `Infinity` = sem teto.
 *
 * A cota de busca é MENSAL, não diária: analisar canal é decisão de
 * planejamento e acontece em ondas. Um teto diário puniria justamente a semana
 * em que o assinante mais precisa da ferramenta.
 */
export const LIMITS = {
  free:    { searchesPerMonth: 3,        favorites: 0,        comparisonSlots: 0,  connectedChannels: 0,  historyDays: 90,   seats: 1, topVideos: 10 },
  starter: { searchesPerMonth: 50,       favorites: 5,        comparisonSlots: 2,  connectedChannels: 1,  historyDays: 730,  seats: 1, topVideos: 100 },
  pro:     { searchesPerMonth: 150,      favorites: 15,       comparisonSlots: 5,  connectedChannels: 5,  historyDays: 1095, seats: 5, topVideos: Infinity },
  // Creator entrega os mesmos benefícios do Pro, mudando só a escala de canais.
  creator: { searchesPerMonth: Infinity, favorites: Infinity, comparisonSlots: 10, connectedChannels: 15, historyDays: 1095, seats: 5, topVideos: Infinity },
};

export const PLANS = [
  {
    id: 'free',
    name: 'Grátis',
    price: 0,
    tagline: 'Para investigar um canal antes de decidir.',
    highlights: [
      'Análise pública completa de canais',
      'Nota geral do canal (0–100)',
      'Estimativa de ganhos por faixa',
      '3 análises de canal por mês',
    ],
    missing: ['Favoritos', 'Comparação entre canais', 'Melhor horário e frequência ideal', 'Dados privados do seu canal'],
    cta: 'Começar grátis',
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 49.9,
    featured: true,
    tagline: 'Para quem publica toda semana e decide com dado.',
    highlights: [
      'Tudo do plano Grátis',
      '50 análises de canal por mês',
      '1 canal conectado',
      'Consultor de dados: melhor horário, duração e frequência',
      'Comparação de até 2 canais',
      'Até 5 canais favoritos',
      'Ranking Top 20 por inscritos',
      'Conecte seu canal: receita, CTR, retenção e RPM reais',
    ],
    missing: ['Múltiplos canais e equipe', 'Exportação PDF/Excel'],
    cta: 'Assinar Starter',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 147.9,
    tagline: 'Para redes de canais, agências e times.',
    highlights: [
      'Tudo do plano Starter',
      '150 análises de canal por mês',
      '5 canais conectados (gestão de rede)',
      'Comparação de até 5 canais',
      'Até 15 canais favoritos',
      '5 assentos para a equipe',
      'Exportação de relatórios em PDF e Excel',
    ],
    missing: [],
    cta: 'Assinar Pro',
  },
  {
    id: 'creator',
    name: 'Creator',
    price: 249.9,
    tagline: 'Para operações grandes, com muitos canais sob gestão.',
    highlights: [
      'Tudo do plano Pro',
      'Análises de canal ilimitadas',
      '15 canais conectados',
      'Comparação de até 10 canais',
      'Favoritos ilimitados',
      'Suporte prioritário',
    ],
    missing: [],
    cta: 'Assinar Creator',
  },
];

export const PLAN_BY_ID = PLANS.reduce((acc, p) => ((acc[p.id] = p), acc), {});
const ORDER = ['free', 'starter', 'pro', 'creator'];

/** O plano libera este recurso? */
export function can(planId, feature) {
  const f = FEATURES[feature];
  if (!f) return true; // recurso não catalogado = aberto
  return f.tiers.includes(planId);
}

export function limitOf(planId, key) {
  return LIMITS[planId]?.[key] ?? 0;
}

/** Menor plano que libera o recurso — usado no texto do paywall. */
export function requiredPlan(feature) {
  const f = FEATURES[feature];
  if (!f) return null;
  return ORDER.find((p) => f.tiers.includes(p)) || null;
}

/** Menor plano cujo limite numérico atende o valor pedido. */
export function planForLimit(key, needed) {
  return ORDER.find((p) => LIMITS[p][key] >= needed) || null;
}

export const planRank = (planId) => ORDER.indexOf(planId);
export const isValidPlan = (planId) => ORDER.includes(planId);
