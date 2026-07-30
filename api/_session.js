/**
 * _session.js — Cookies, criptografia e sessão de OAuth no Firestore.
 *
 * ## O que este arquivo protege
 *
 * O *refresh token* que o Google devolve é a chave permanente de acesso ao
 * canal — quem tiver esse valor em texto puro consegue ler a Analytics do
 * canal para sempre, até o dono revogar manualmente em myaccount.google.com.
 * Por isso ele:
 *
 *   1. nunca chega ao navegador (fica só no Firestore);
 *   2. é cifrado com AES-256-GCM antes de gravar, usando `SESSION_SECRET`
 *      como chave — quem lesse o banco diretamente não leria o token;
 *   3. é referenciado no navegador por um `sessionId` aleatório, num cookie
 *      `httpOnly` — o cookie não guarda o token, só um ponteiro para ele.
 *
 * Estrutura no Firestore:
 *
 *   sessions/{sessionId}
 *     { channelId, channelTitle, channelHandle, refreshTokenEnc, createdAt }
 *
 * ## Por que cookie, e não localStorage
 *
 * `httpOnly` impede que JavaScript no navegador leia o cookie — mesmo um XSS
 * não consegue exfiltrar a sessão. localStorage não tem essa proteção.
 */

import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore, firestoreReady } from './_firebase.js';

/**
 * Painéis de variável de ambiente colam com frequência um espaço ou quebra de
 * linha extra ao redor do valor — o Client ID já chegou aqui com um `\n` no
 * final, o que faz o Google recusar o login porque o texto comparado deixa de
 * bater byte a byte. `trim()` nas quatro variáveis de OAuth evita essa classe
 * inteira de erro sem depender de colar com perfeição.
 */
const clean = (v) => (v || '').trim();

export const googleClientId = () => clean(process.env.GOOGLE_CLIENT_ID);
export const googleClientSecret = () => clean(process.env.GOOGLE_CLIENT_SECRET);
export const oauthRedirectUri = () => clean(process.env.OAUTH_REDIRECT_URI);

const SESSION_SECRET = clean(process.env.SESSION_SECRET);

export const sessionSecretReady = () => !!SESSION_SECRET;

/* -------------------------------------------------------------- cookies -- */

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const i = part.indexOf('=');
    if (i === -1) return acc;
    const k = part.slice(0, i).trim();
    if (k) acc[k] = decodeURIComponent(part.slice(i + 1).trim());
    return acc;
  }, {});
}

/**
 * Acrescenta um `Set-Cookie` à resposta sem apagar os que já foram definidos
 * antes na mesma requisição — `res.setHeader` sobrescreveria.
 */
export function setCookie(res, name, value, { maxAge, sameSite = 'Lax' } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    `SameSite=${sameSite}`,
  ];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);

  const existing = res.getHeader('Set-Cookie');
  const cookies = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  cookies.push(parts.join('; '));
  res.setHeader('Set-Cookie', cookies);
}

export const clearCookie = (res, name) => setCookie(res, name, '', { maxAge: 0 });

/* ---------------------------------------------------------- criptografia -- */

const ALGO = 'aes-256-gcm';
const keyFromSecret = () => createHash('sha256').update(SESSION_SECRET).digest(); // 32 bytes

function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFromSecret(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, keyFromSecret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/* -------------------------------------------------- PKCE (base64url) ---- */

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomToken = (bytes = 32) => base64url(randomBytes(bytes));
export const pkceChallenge = (verifier) => base64url(createHash('sha256').update(verifier).digest());

/* --------------------------------------------------------------- sessão -- */

export const sessionStoreReady = () => firestoreReady() && sessionSecretReady();

export async function createSession({ channelId, channelTitle, channelHandle, refreshToken }) {
  const db = firestore();
  if (!db) throw new Error('Firestore não configurado.');

  const sessionId = randomToken(24);
  await db.collection('sessions').doc(sessionId).set({
    channelId,
    channelTitle: channelTitle || '',
    channelHandle: channelHandle || '',
    refreshTokenEnc: encrypt(refreshToken),
    createdAt: FieldValue.serverTimestamp(),
  });
  return sessionId;
}

/** Devolve a sessão com o refresh token já decifrado, ou `null`. */
export async function readSession(sessionId) {
  const db = firestore();
  if (!db || !sessionId) return null;

  const doc = await db.collection('sessions').doc(sessionId).get();
  if (!doc.exists) return null;

  const data = doc.data();
  try {
    return { ...data, refreshToken: decrypt(data.refreshTokenEnc) };
  } catch {
    // SESSION_SECRET mudou desde que a sessão foi criada — trata como sessão morta.
    return null;
  }
}

export async function deleteSession(sessionId) {
  const db = firestore();
  if (!db || !sessionId) return;
  await db.collection('sessions').doc(sessionId).delete().catch(() => {});
}

/* ---------------------------------------------------- sessão de conta -- */

/**
 * Sessão da CONTA (login com senha), separada da sessão OAuth acima — uma
 * pessoa pode estar logada na conta sem nunca ter conectado um canal do
 * YouTube. Mesmo padrão de ponteiro aleatório em cookie `httpOnly`, mas sem
 * criptografia: aqui não há refresh token para proteger, só o `uid` (que já
 * é o e-mail normalizado, não um segredo).
 */
export async function createUserSession(uid) {
  const db = firestore();
  if (!db) throw new Error('Firestore não configurado.');

  const sessionId = randomToken(24);
  await db.collection('userSessions').doc(sessionId).set({
    uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return sessionId;
}

export async function readUserSession(sessionId) {
  const db = firestore();
  if (!db || !sessionId) return null;
  const doc = await db.collection('userSessions').doc(sessionId).get();
  return doc.exists ? doc.data() : null;
}

export async function deleteUserSession(sessionId) {
  const db = firestore();
  if (!db || !sessionId) return;
  await db.collection('userSessions').doc(sessionId).delete().catch(() => {});
}
