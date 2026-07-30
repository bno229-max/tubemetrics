/**
 * GET /api/auth/me — hidrata o app com a conta logada, se houver.
 *
 * 401 é o sinal de "ninguém logado" (não é um erro) — o front trata igual a
 * `getCreatorReport()` já trata o 401 do dashboard do criador.
 */

import { parseCookies, readUserSession, clearCookie } from '../_session.js';
import { findUserById, publicUser, getQuota } from '../_auth.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'methodNotAllowed', 'Use GET.');

  const cookies = parseCookies(req);
  const session = cookies.tm_uid ? await readUserSession(cookies.tm_uid) : null;
  if (!session) return fail(res, 401, 'notLoggedIn', 'Nenhuma conta logada nesta sessão.');

  const user = await findUserById(session.uid);
  if (!user) {
    // Conta apagada, mas o cookie de sessão sobreviveu — limpa e trata como deslogado.
    clearCookie(res, 'tm_uid');
    return fail(res, 401, 'notLoggedIn', 'Conta não encontrada.');
  }

  json(res, 200, { user: publicUser(user), quota: getQuota(user) }, NO_CACHE);
}
