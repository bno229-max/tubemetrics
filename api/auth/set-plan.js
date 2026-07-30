/**
 * POST /api/auth/set-plan — troca de plano de demonstração.
 *
 * Sem cobrança real ainda (não há Stripe neste projeto) — é o mesmo botão
 * "Mudar para X" da página de Planos, só que agora grava na conta em vez de
 * só no navegador. Sem isso, a cota ficaria presa no plano errado no servidor.
 */

import { verifyRequest, findUserByUid, setUserPlan, publicUser, getQuota } from '../_auth.js';
import { isValidPlan } from '../_plans.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'notLoggedIn', 'Faça login para trocar de plano.');

  const { plan } = req.body || {};
  if (!isValidPlan(plan)) return fail(res, 400, 'invalidPlan', 'Plano inválido.');

  const user = await findUserByUid(account.uid);
  if (!user) return fail(res, 400, 'needsProfile', 'Complete seu cadastro antes de escolher um plano.');

  await setUserPlan(account.uid, plan);
  const updated = { ...user, plan };

  json(res, 200, { user: publicUser(updated), quota: getQuota(updated) }, NO_CACHE);
}
