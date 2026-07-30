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

/* ----------------------------------------------------------- conexões -- */

/**
 * Canais do YouTube conectados por uma conta.
 *
 *   connections/{uid}__{channelId}
 *     { uid, channelId, channelTitle, channelHandle, refreshTokenEnc, createdAt }
 *
 * O id composto faz o trabalho pesado sozinho: reconectar o mesmo canal
 * sobrescreve em vez de criar uma duplicata, e cada conta enxerga só os seus
 * (`where('uid','==',uid)`, igualdade em campo simples, sem índice manual).
 *
 * Antes existia uma "sessão" por canal, apontada por um cookie — o que
 * limitava a um canal por navegador. Agora que existe conta de verdade, a
 * dona da conexão é ela, e os planos pagos podem ligar vários canais ao
 * mesmo tempo (`connectedChannels` em `_plans.js`).
 *
 * Quem autentica o USUÁRIO é o Firebase Auth (ver `verifyRequest` em
 * `_auth.js`); o refresh token guardado aqui é do Google e continua cifrado,
 * porque dá acesso permanente à Analytics do canal.
 */

export const sessionStoreReady = () => firestoreReady() && sessionSecretReady();

const connId = (uid, channelId) => `${uid}__${channelId}`;

export async function saveConnection({ uid, channelId, channelTitle, channelHandle, refreshToken }) {
  const db = firestore();
  if (!db) throw new Error('Firestore não configurado.');

  await db.collection('connections').doc(connId(uid, channelId)).set({
    uid,
    channelId,
    channelTitle: channelTitle || '',
    channelHandle: channelHandle || '',
    refreshTokenEnc: encrypt(refreshToken),
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Metadados dos canais conectados — sem tokens, é o que a interface lista. */
export async function listConnections(uid) {
  const db = firestore();
  if (!db || !uid) return [];

  const snap = await db.collection('connections').where('uid', '==', uid).get();
  return snap.docs
    .map((d) => d.data())
    .map(({ channelId, channelTitle, channelHandle }) => ({ channelId, channelTitle, channelHandle }))
    .sort((a, b) => (a.channelTitle || '').localeCompare(b.channelTitle || ''));
}

/** Uma conexão com o refresh token já decifrado, ou `null`. */
export async function readConnection(uid, channelId) {
  const db = firestore();
  if (!db || !uid || !channelId) return null;

  const doc = await db.collection('connections').doc(connId(uid, channelId)).get();
  if (!doc.exists) return null;

  const data = doc.data();
  try {
    return { ...data, refreshToken: decrypt(data.refreshTokenEnc) };
  } catch {
    // SESSION_SECRET mudou desde a gravação — trata como conexão morta.
    return null;
  }
}

export async function deleteConnection(uid, channelId) {
  const db = firestore();
  if (!db || !uid || !channelId) return;
  await db.collection('connections').doc(connId(uid, channelId)).delete().catch(() => {});
}
