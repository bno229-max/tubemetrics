/**
 * _auth.js — Conta de usuário: senha, unicidade e CRUD no Firestore.
 *
 * Isto é a identidade de QUEM está usando o produto (nome, telefone, e-mail,
 * senha, plano, cota). É um conceito diferente da sessão OAuth em
 * `_session.js` (que guarda o canal do YouTube conectado) — uma conta pode
 * existir sem nunca conectar um canal, e vice-versa não faz sentido.
 *
 * ## Por que e-mail é o ID do documento
 *
 * `users/{emailNormalizado}` em vez de um UID gerado + índice por e-mail: a
 * unicidade fica de graça (um `.create()` que já existe simplesmente falha
 * com `ALREADY_EXISTS`), sem precisar de transação nem de índice composto —
 * mesma lógica que `_store.js` já usa pra evitar índice em `snapshots`.
 *
 * ## Por que scrypt em vez de bcrypt
 *
 * `node:crypto` já traz `scrypt` nativamente — nenhuma dependência nova, e
 * este projeto já usa o mesmo módulo (`createHash`/`createCipheriv`) em
 * `_session.js`. bcrypt exigiria um binário nativo compilado, mais um ponto
 * de falha numa function serverless.
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from './_firebase.js';
import { limitOf } from '../web/assets/js/plans.js';
import { randomToken } from './_session.js';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export const normalizeEmail = (email) => (email || '').trim().toLowerCase();

/** Mantém só dígitos — telefones brasileiros com/sem máscara viram a mesma chave. */
export const normalizePhone = (phone) => (phone || '').replace(/\D/g, '');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const derived = await scryptAsync(password, salt, KEY_LEN);
  const stored_ = Buffer.from(hashHex, 'hex');
  // Tamanhos diferentes quebrariam `timingSafeEqual` — trata como "não bate".
  if (derived.length !== stored_.length) return false;
  return timingSafeEqual(derived, stored_);
}

/* ------------------------------------------------------------- usuários -- */

const usersCol = () => firestore()?.collection('users');

export async function findUserByEmail(email) {
  const col = usersCol();
  if (!col) return null;
  const doc = await col.doc(normalizeEmail(email)).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function findUserByPhone(phone) {
  const col = usersCol();
  if (!col) return null;
  const norm = normalizePhone(phone);
  if (!norm) return null;
  const snap = await col.where('phone', '==', norm).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function findUserById(id) {
  const col = usersCol();
  if (!col || !id) return null;
  const doc = await col.doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

/**
 * Cria a conta. Usa `.create()` (não `.set()`) de propósito: `create` falha
 * se o documento já existe, então a unicidade do e-mail vem do próprio
 * Firestore em vez de uma checagem "leia depois escreva" com corrida possível.
 * @returns {Promise<'ok'|'emailTaken'>}
 */
export async function createUser({ name, email, phone, passwordHash, ip }) {
  const col = usersCol();
  if (!col) throw new Error('Firestore não configurado.');

  const id = normalizeEmail(email);
  try {
    await col.doc(id).create({
      name,
      email: id,
      phone: normalizePhone(phone),
      passwordHash,
      plan: 'free',
      searchesUsedLifetime: 0,
      searchedChannelIds: [],
      searchMonth: '',
      searchedIdsThisMonth: [],
      createdAt: FieldValue.serverTimestamp(),
      createdIp: ip || null,
    });
    return 'ok';
  } catch (err) {
    if (err?.code === 6 /* ALREADY_EXISTS */) return 'emailTaken';
    throw err;
  }
}

export async function setUserPlan(id, plan) {
  const col = usersCol();
  if (!col) return;
  await col.doc(id).update({ plan });
}

export async function setUserPassword(id, passwordHash) {
  const col = usersCol();
  if (!col) return;
  await col.doc(id).update({ passwordHash });
}

/** Dados públicos da conta — nunca devolver `passwordHash` ao front. */
export function publicUser(user) {
  return { name: user.name, email: user.email, plan: user.plan };
}

/* -------------------------------------------------------- limite de IP -- */

/**
 * No máximo 5 cadastros por IP por dia. Não impede uma pessoa determinada
 * (proxy, IP dinâmico), mas segura um script simples sem incomodar ninguém
 * fazendo um cadastro legítimo.
 */
export async function checkSignupRate(ip) {
  const db = firestore();
  if (!db || !ip) return true;

  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection('signupRate').doc(`${ip}_${day}`);
  const doc = await ref.get();
  const count = doc.exists ? doc.data().count : 0;
  if (count >= 5) return false;

  await ref.set({ count: count + 1 }, { merge: true });
  return true;
}

export const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';

/* --------------------------------------------------- reset de senha -- */

const RESET_MAX_AGE_MS = 60 * 60 * 1000; // 1 hora

export async function createPasswordReset(uid) {
  const db = firestore();
  if (!db) return null;
  const token = randomToken(24);
  await db.collection('passwordResets').doc(token).set({
    uid,
    expiresAt: Date.now() + RESET_MAX_AGE_MS,
  });
  return token;
}

/** Devolve o `uid` dono do token e já apaga o token (uso único), ou `null` se inválido/expirado. */
export async function consumePasswordReset(token) {
  const db = firestore();
  if (!db || !token) return null;
  const ref = db.collection('passwordResets').doc(token);
  const doc = await ref.get();
  if (!doc.exists) return null;

  const { uid, expiresAt } = doc.data();
  await ref.delete().catch(() => {});
  if (!expiresAt || Date.now() > expiresAt) return null;
  return uid;
}

/* --------------------------------------------------------------- cota -- */

/**
 * Grátis: 3 análises PARA SEMPRE por conta (não reseta) — é o teto que
 * motivou a conta ter identidade real, então aqui ele é tratado à parte do
 * mecanismo mensal que os planos pagos usam. Planos pagos: mesmo cálculo
 * mensal que `store.js` fazia no navegador, só que agora autoritativo aqui.
 */
const currentMonth = () => new Date().toISOString().slice(0, 7);

export function getQuota(user) {
  const limit = limitOf(user.plan, 'searchesPerMonth');
  if (user.plan === 'free') {
    const used = user.searchesUsedLifetime || 0;
    return { used, limit, remaining: limit === Infinity ? Infinity : Math.max(0, limit - used), lifetime: true };
  }
  const used = user.searchMonth === currentMonth() ? (user.searchedIdsThisMonth || []).length : 0;
  return { used, limit, remaining: limit === Infinity ? Infinity : Math.max(0, limit - used), lifetime: false };
}

/**
 * Consome 1 análise se o canal for novo pra esta conta. Devolve a cota
 * atualizada (canal já visto antes não gasta de novo), ou `null` se a cota
 * acabou e o canal é novo — quem chama decide como comunicar isso (403).
 */
export async function consumeSearch(user, channelId) {
  const col = usersCol();
  if (!col) return null;
  const limit = limitOf(user.plan, 'searchesPerMonth');

  if (user.plan === 'free') {
    const seen = user.searchedChannelIds || [];
    if (seen.includes(channelId)) return getQuota(user);
    if (limit !== Infinity && seen.length >= limit) return null;
    const updated = [...seen, channelId];
    await col.doc(user.id).update({ searchesUsedLifetime: updated.length, searchedChannelIds: updated });
    return getQuota({ ...user, searchesUsedLifetime: updated.length });
  }

  const month = currentMonth();
  const seenThisMonth = user.searchMonth === month ? (user.searchedIdsThisMonth || []) : [];
  if (seenThisMonth.includes(channelId)) return getQuota({ ...user, searchMonth: month, searchedIdsThisMonth: seenThisMonth });
  if (limit !== Infinity && seenThisMonth.length >= limit) return null;
  const updated = [...seenThisMonth, channelId];
  await col.doc(user.id).update({ searchMonth: month, searchedIdsThisMonth: updated });
  return getQuota({ ...user, searchMonth: month, searchedIdsThisMonth: updated });
}
