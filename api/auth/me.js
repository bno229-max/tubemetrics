/**
 * GET  /api/auth/me — conta logada + cota atual.
 * POST /api/auth/me — completa o perfil no 1º acesso (nome e telefone).
 *
 * 401 aqui significa "ninguém logado" — não é erro, é o estado normal de quem
 * ainda não entrou. O front trata como `null`.
 *
 * O POST é o passo que o Firebase Auth não cobre: ele só sabe e-mail e senha,
 * então nome e telefone chegam aqui logo depois do cadastro.
 */

import { verifyRequest, findUserByUid, createProfile, phoneTakenBy, normalizePhone, publicUser, getQuota } from '../_auth.js';
import { firestoreReady } from '../_firebase.js';
import { json, fail, NO_CACHE } from '../_http.js';

const PHONE_RE = /^\d{10,11}$/;

export default async function handler(req, res) {
  if (!firestoreReady()) {
    return fail(res, 503, 'authNotConfigured', 'Autenticação ainda não configurada neste servidor.');
  }

  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'notLoggedIn', 'Nenhuma conta logada.');

  if (req.method === 'GET') {
    const user = await findUserByUid(account.uid);
    // Sem perfil ainda: a conta existe no Firebase Auth mas nunca completou o
    // 1º acesso. O front usa isso para pedir nome e telefone.
    if (!user) return json(res, 200, { user: null, quota: null, needsProfile: true }, NO_CACHE);
    return json(res, 200, { user: publicUser(user), quota: getQuota(user), needsProfile: false }, NO_CACHE);
  }

  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use GET ou POST.');

  const { name, phone } = req.body || {};
  const cleanName = (name || '').trim();
  const cleanPhone = normalizePhone(phone);

  if (cleanName.length < 2) return fail(res, 400, 'invalidName', 'Informe seu nome.');
  if (!PHONE_RE.test(cleanPhone)) return fail(res, 400, 'invalidPhone', 'Telefone inválido. Use DDD + número.');

  // Telefone único entre contas: é a trava contra criar cadastro atrás de
  // cadastro só para renovar as 3 análises gratuitas.
  const taken = await phoneTakenBy(cleanPhone, account.uid);
  if (taken) return fail(res, 409, 'phoneTaken', 'Este telefone já está em uso por outra conta.');

  const existing = await findUserByUid(account.uid);
  const user = existing || (await createProfile(account.uid, { name: cleanName, email: account.email, phone: cleanPhone }));

  return json(res, 200, { user: publicUser(user), quota: getQuota(user), needsProfile: false }, NO_CACHE);
}
