/**
 * _plans.js — Limites de plano, do lado do servidor.
 *
 * ## Por que esta tabela existe duas vezes
 *
 * `web/assets/js/plans.js` tem a mesma informação para a interface. Importar
 * aquele arquivo aqui parece o certo — e foi exatamente o que quebrou o build
 * na Vercel: um `import '../web/...'` sai da pasta `api/`, e o bundler das
 * funções não resolve caminho para fora dela.
 *
 * Duplicar é a escolha consciente: o front usa a tabela dele para ESCONDER, e
 * este arquivo é a autoridade que RECUSA. Mesmo que um dia divirjam, a decisão
 * que vale é a daqui — flag de cliente é UX, não segurança.
 *
 * Ao mexer nos números de um lado, mexa no outro.
 */

export const LIMITS = {
  free:    { searchesPerMonth: 3 },
  starter: { searchesPerMonth: 50 },
  pro:     { searchesPerMonth: 120 },
  creator: { searchesPerMonth: Infinity },
};

export const PLAN_IDS = ['free', 'starter', 'pro', 'creator'];

export const isValidPlan = (plan) => PLAN_IDS.includes(plan);

export const searchLimit = (plan) => LIMITS[plan]?.searchesPerMonth ?? 0;
