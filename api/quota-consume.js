/**
 * POST /api/quota-consume — checa e gasta 1 análise da conta logada.
 *
 * Roda ANTES de `/api/channel`, que fica cacheado no CDN e é compartilhado
 * entre usuários — a cota não pode viver ali, porque uma resposta servida do
 * cache nem chega a executar a function (ver `_http.js`/`CACHE_CHANNEL`).
 *
 * Canal já analisado antes pela mesma conta não gasta cota de novo (mesma
 * regra que já existia em `store.js`, agora no servidor).
 */

import { parseCookies, readUserSession } from './_session.js';
import { findUserById, consumeSearch } from './_auth.js';
import { json, fail, NO_CACHE } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const cookies = parseCookies(req);
  const session = cookies.tm_uid ? await readUserSession(cookies.tm_uid) : null;
  if (!session) return fail(res, 401, 'notLoggedIn', 'Faça login para analisar um canal.');

  const channelId = String((req.body || {}).channelId || '').trim();
  if (!channelId) return fail(res, 400, 'missingChannelId', 'Canal não informado.');

  const user = await findUserById(session.uid);
  if (!user) return fail(res, 401, 'notLoggedIn', 'Conta não encontrada.');

  const quota = await consumeSearch(user, channelId);
  if (!quota) {
    return fail(res, 403, 'quotaExceeded', 'Você usou todas as análises do seu plano.', {
      lifetime: user.plan === 'free',
    });
  }

  json(res, 200, { ok: true, quota }, NO_CACHE);
}
