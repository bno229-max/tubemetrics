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
  // Grátis não conecta canal nem compara: são recursos dos planos pagos.
  free:    { searchesPerMonth: 3,        connectedChannels: 0,  comparisonSlots: 0 },
  starter: { searchesPerMonth: 50,       connectedChannels: 1,  comparisonSlots: 2 },
  pro:     { searchesPerMonth: 120,      connectedChannels: 3,  comparisonSlots: 5 },
  creator: { searchesPerMonth: Infinity, connectedChannels: 10, comparisonSlots: 10 },
};

export const PLAN_IDS = ['free', 'starter', 'pro', 'creator'];

export const isValidPlan = (plan) => PLAN_IDS.includes(plan);

export const searchLimit = (plan) => LIMITS[plan]?.searchesPerMonth ?? 0;

/** Quantos canais do YouTube a conta pode manter conectados ao mesmo tempo. */
export const channelLimit = (plan) => LIMITS[plan]?.connectedChannels ?? 0;

export const compareLimit = (plan) => LIMITS[plan]?.comparisonSlots ?? 0;
