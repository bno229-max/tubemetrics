/**
 * POST /api/auth/set-plan — troca de plano de demonstração.
 *
 * Sem cobrança real (Stripe ainda não existe neste projeto) — é o mesmo botão
 * "Mudar para X" que a página de Planos já tinha, só que agora grava no
 * Firestore em vez de só no navegador. Sem isso, a cota ficaria travada no
 * plano errado no servidor assim que a conta virou autoritativa.
 */

import { parseCookies, readUserSession } from '../_session.js';
import { findUserById, setUserPlan, publicUser, getQuota } from '../_auth.js';
import { isValidPlan } from '../../web/assets/js/plans.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const cookies = parseCookies(req);
  const session = cookies.tm_uid ? await readUserSession(cookies.tm_uid) : null;
  if (!session) return fail(res, 401, 'notLoggedIn', 'Faça login para trocar de plano.');

  const { plan } = req.body || {};
  if (!isValidPlan(plan)) return fail(res, 400, 'invalidPlan', 'Plano inválido.');

  const user = await findUserById(session.uid);
  if (!user) return fail(res, 401, 'notLoggedIn', 'Conta não encontrada.');

  await setUserPlan(user.id, plan);
  const updated = { ...user, plan };
  json(res, 200, { user: publicUser(updated), quota: getQuota(updated) }, NO_CACHE);
}
