/**
 * POST /api/auth/register — cria a conta ("Primeiro acesso").
 *
 * E-mail e telefone precisam ser únicos entre contas — é a trava contra
 * "criar cadastro novo pra sempre ter 3 análises de novo" (ver `_auth.js` e
 * o plano desta mudança). Um limite de 5 cadastros por IP/dia complementa
 * isso contra um script simples, sem exigir nenhum serviço pago novo.
 */

import {
  normalizeEmail, normalizePhone, hashPassword, createUser,
  findUserByPhone, checkSignupRate, clientIp, publicUser, getQuota,
} from '../_auth.js';
import { createUserSession, setCookie, sessionStoreReady } from '../_session.js';
import { json, fail, NO_CACHE } from '../_http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\d{10,11}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');
  if (!sessionStoreReady()) return fail(res, 503, 'authNotConfigured', 'Cadastro ainda não configurado neste servidor.');

  const { name, phone, email, password } = req.body || {};
  const cleanName = (name || '').trim();
  const cleanPhone = normalizePhone(phone);
  const cleanEmail = normalizeEmail(email);

  if (cleanName.length < 2) return fail(res, 400, 'invalidName', 'Informe seu nome.');
  if (!PHONE_RE.test(cleanPhone)) return fail(res, 400, 'invalidPhone', 'Telefone inválido. Use DDD + número.');
  if (!EMAIL_RE.test(cleanEmail)) return fail(res, 400, 'invalidEmail', 'E-mail inválido.');
  if (!password || password.length < 6) return fail(res, 400, 'invalidPassword', 'A senha precisa ter pelo menos 6 caracteres.');

  const ip = clientIp(req);
  const withinRate = await checkSignupRate(ip);
  if (!withinRate) {
    return fail(res, 429, 'tooManySignups', 'Muitos cadastros a partir deste endereço hoje. Tente de novo amanhã.');
  }

  const phoneOwner = await findUserByPhone(cleanPhone);
  if (phoneOwner) {
    return fail(res, 409, 'phoneTaken', 'Este telefone já está em uso por outra conta.');
  }

  const passwordHash = await hashPassword(password);
  const result = await createUser({ name: cleanName, email: cleanEmail, phone: cleanPhone, passwordHash, ip });
  if (result === 'emailTaken') {
    return fail(res, 409, 'emailTaken', 'Este e-mail já tem uma conta. Faça login.');
  }

  const user = { id: cleanEmail, email: cleanEmail, name: cleanName, plan: 'free', searchesUsedLifetime: 0, searchedChannelIds: [] };
  const sessionId = await createUserSession(cleanEmail);
  setCookie(res, 'tm_uid', sessionId, { maxAge: 60 * 60 * 24 * 30 });

  json(res, 201, { user: publicUser(user), quota: getQuota(user) }, NO_CACHE);
}
