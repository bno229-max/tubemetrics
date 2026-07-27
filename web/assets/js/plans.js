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
  public_analysis:    { label: 'Análise pública de canais',            tiers: ['free', 'pro', 'creator'] },
  channel_score:      { label: 'Nota geral do canal',                  tiers: ['free', 'pro', 'creator'] },
  earnings_estimate:  { label: 'Estimativa de ganhos por faixa',       tiers: ['free', 'pro', 'creator'] },
  history_full:       { label: 'Histórico completo (sem corte)',       tiers: ['pro', 'creator'] },
  advanced_insights:  { label: 'Consultor de dados completo',          tiers: ['pro', 'creator'] },
  best_time:          { label: 'Melhor horário para publicar',         tiers: ['pro', 'creator'] },
  ideal_frequency:    { label: 'Frequência ideal de postagem',         tiers: ['pro', 'creator'] },
  compare_channels:   { label: 'Comparação de canais ilimitada',       tiers: ['pro', 'creator'] },
  growth_alerts:      { label: 'Alertas de meta de crescimento',       tiers: ['pro', 'creator'] },
  creator_dashboard:  { label: 'Dashboard do Criador (dados privados)', tiers: ['pro', 'creator'] },
  revenue_per_video:  { label: 'Receita detalhada por vídeo',          tiers: ['pro', 'creator'] },
  multi_channel:      { label: 'Múltiplos canais (gestão de rede)',    tiers: ['creator'] },
  team_seats:         { label: 'Acesso para equipes',                  tiers: ['creator'] },
  export_reports:     { label: 'Exportação PDF / Excel',               tiers: ['creator'] },
  api_access:         { label: 'API própria do SaaS',                  tiers: ['creator'] },
};

/** Limites numéricos. `Infinity` = sem teto. */
export const LIMITS = {
  free:    { searchesPerDay: 3,        connectedChannels: 0,  historyDays: 90,   comparisonSlots: 0,        seats: 1, topVideos: 10 },
  pro:     { searchesPerDay: 200,      connectedChannels: 1,  historyDays: 730,  comparisonSlots: Infinity, seats: 1, topVideos: 100 },
  creator: { searchesPerDay: Infinity, connectedChannels: 10, historyDays: 1095, comparisonSlots: Infinity, seats: 8, topVideos: Infinity },
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
      'Até 3 buscas por dia',
      'Histórico de 90 dias',
    ],
    missing: ['Melhor horário e frequência ideal', 'Comparação entre canais', 'Dados privados do seu canal'],
    cta: 'Começar grátis',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 49,
    featured: true,
    tagline: 'Para quem publica toda semana e decide com dado.',
    highlights: [
      'Tudo do Grátis, sem limite de busca prático',
      'Histórico completo e relatórios detalhados',
      'Consultor de dados: melhor horário, duração e frequência',
      'Comparação de canais ilimitada',
      'Conecte seu canal: receita, CTR, retenção e RPM reais',
      'Alertas de meta de crescimento',
    ],
    missing: ['Múltiplos canais e equipe', 'Exportação PDF/Excel', 'API'],
    cta: 'Assinar Pro',
  },
  {
    id: 'creator',
    name: 'Creator',
    price: 149,
    tagline: 'Para redes de canais, agências e times.',
    highlights: [
      'Tudo do Pro',
      'Até 10 canais conectados (gestão de rede)',
      '8 assentos para a equipe',
      'Exportação de relatórios em PDF e Excel',
      'Acesso à API do TubeMetrics',
      'Suporte prioritário',
    ],
    missing: [],
    cta: 'Falar com vendas',
  },
];

export const PLAN_BY_ID = PLANS.reduce((acc, p) => ((acc[p.id] = p), acc), {});
const ORDER = ['free', 'pro', 'creator'];

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

export const planRank = (planId) => ORDER.indexOf(planId);
