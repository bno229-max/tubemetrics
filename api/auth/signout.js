/**
 * POST /api/auth/signout — encerra a sessão da CONTA.
 *
 * Homônimo de propósito com `logout.js`, que desconecta o canal do YouTube
 * via OAuth — são coisas diferentes (conta vs. canal conectado) e não devem
 * compartilhar endpoint nem cookie.
 */

import { parseCookies, clearCookie } from '../_session.js';
import { deleteUserSession } from '../_session.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const cookies = parseCookies(req);
  if (cookies.tm_uid) await deleteUserSession(cookies.tm_uid);
  clearCookie(res, 'tm_uid');

  json(res, 200, { ok: true }, NO_CACHE);
}
