/**
 * POST /api/auth/login — autentica com e-mail e senha.
 *
 * A mensagem de erro é a mesma para "e-mail não existe" e "senha errada" —
 * distinguir os dois casos ajudaria alguém testando e-mails para descobrir
 * quais têm conta.
 */

import { normalizeEmail, findUserByEmail, verifyPassword, publicUser, getQuota } from '../_auth.js';
import { createUserSession, setCookie, sessionStoreReady } from '../_session.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');
  if (!sessionStoreReady()) return fail(res, 503, 'authNotConfigured', 'Login ainda não configurado neste servidor.');

  const { email, password } = req.body || {};
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !password) return fail(res, 400, 'missingFields', 'Informe e-mail e senha.');

  const user = await findUserByEmail(cleanEmail);
  const ok = user && (await verifyPassword(password, user.passwordHash));
  if (!ok) return fail(res, 401, 'invalidCredentials', 'E-mail ou senha incorretos.');

  const sessionId = await createUserSession(user.id);
  setCookie(res, 'tm_uid', sessionId, { maxAge: 60 * 60 * 24 * 30 });

  json(res, 200, { user: publicUser(user), quota: getQuota(user) }, NO_CACHE);
}
