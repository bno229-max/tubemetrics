/**
 * POST /api/auth/logout — encerra a sessão local.
 *
 * Isso apaga o registro no Firestore (o refresh token cifrado some) e o
 * cookie. Não revoga o consentimento no lado do Google — para isso o usuário
 * precisa ir em myaccount.google.com/permissions e remover o acesso do
 * TubeMetrics, que é o único lugar que efetivamente invalida o refresh token.
 */

import { parseCookies, clearCookie, deleteSession } from '../_session.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const cookies = parseCookies(req);
  if (cookies.tm_session) await deleteSession(cookies.tm_session);
  clearCookie(res, 'tm_session');

  json(res, 200, { ok: true }, NO_CACHE);
}
