/**
 * POST /api/auth/reset-password — troca a senha a partir do link recebido por e-mail.
 */

import { consumePasswordReset, hashPassword, setUserPassword } from '../_auth.js';
import { sessionStoreReady } from '../_session.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');
  if (!sessionStoreReady()) return fail(res, 503, 'authNotConfigured', 'Reset de senha ainda não configurado neste servidor.');

  const { token, password } = req.body || {};
  if (!password || password.length < 6) return fail(res, 400, 'invalidPassword', 'A senha precisa ter pelo menos 6 caracteres.');

  const uid = await consumePasswordReset(token);
  if (!uid) return fail(res, 400, 'invalidToken', 'Este link expirou ou já foi usado. Peça um novo.');

  const passwordHash = await hashPassword(password);
  await setUserPassword(uid, passwordHash);

  json(res, 200, { ok: true }, NO_CACHE);
}
