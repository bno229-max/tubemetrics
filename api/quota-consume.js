/**
 * POST /api/quota-consume — checa e gasta 1 análise da conta logada.
 *
 * Roda ANTES de `/api/channel`, que fica cacheado no CDN e é compartilhado
 * entre usuários — a cota não pode viver ali, porque uma resposta servida do
 * cache nem chega a executar a função (ver `CACHE_CHANNEL` em `_http.js`).
 *
 * É aqui que o plano Grátis efetivamente trava nas 3 análises: como a conta
 * mora no Firebase e a contagem no Firestore, limpar o navegador não devolve
 * nada — que era o furo do cadastro anterior, guardado em localStorage.
 */

import { verifyRequest, findUserByUid, consumeSearch, getQuota } from './_auth.js';
import { json, fail, NO_CACHE } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'notLoggedIn', 'Crie sua conta para analisar canais.');

  const channelId = String((req.body || {}).channelId || '').trim();
  if (!channelId) return fail(res, 400, 'missingChannelId', 'Canal não informado.');

  const user = await findUserByUid(account.uid);
  if (!user) return fail(res, 400, 'needsProfile', 'Complete seu cadastro para analisar canais.');

  const quota = await consumeSearch(user, channelId);
  if (!quota) {
    return fail(res, 403, 'quotaExceeded', 'Você usou todas as análises do seu plano.', {
      quota: getQuota(user),
    });
  }

  json(res, 200, { ok: true, quota }, NO_CACHE);
}
