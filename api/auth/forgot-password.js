/**
 * POST /api/auth/forgot-password — dispara o e-mail de redefinição.
 *
 * Sempre responde `ok:true`, exista ou não a conta — devolver um erro
 * diferente para "e-mail não cadastrado" deixaria qualquer pessoa descobrir
 * quais e-mails têm conta só tentando um por um.
 */

import { normalizeEmail, findUserByEmail, createPasswordReset } from '../_auth.js';
import { sessionStoreReady } from '../_session.js';
import { sendEmail, resetPasswordEmail } from '../_email.js';
import { json, fail, NO_CACHE } from '../_http.js';

/** Não depende de OAuth estar configurado — usa o host da própria requisição. */
const appOrigin = (req) => `https://${req.headers.host}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');
  if (!sessionStoreReady()) return fail(res, 503, 'authNotConfigured', 'Reset de senha ainda não configurado neste servidor.');

  const cleanEmail = normalizeEmail((req.body || {}).email);
  if (!cleanEmail) return fail(res, 400, 'missingEmail', 'Informe seu e-mail.');

  const user = await findUserByEmail(cleanEmail);
  if (user) {
    const token = await createPasswordReset(user.id);
    const link = `${appOrigin(req)}/#/redefinir-senha?token=${token}`;
    await sendEmail({ to: user.email, ...resetPasswordEmail(link) });
  }

  json(res, 200, { ok: true }, NO_CACHE);
}
