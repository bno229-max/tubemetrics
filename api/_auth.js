/**
 * _auth.js — Conta do usuário: identidade no Firebase Auth, dados no Firestore.
 *
 * ## Divisão de responsabilidades
 *
 * O **Firebase Authentication** cuida de tudo que envolve credencial: criar a
 * conta, guardar a senha (que nunca passa por aqui), garantir e-mail único,
 * enviar o e-mail de redefinição de senha e o de verificação. Nada disso é
 * código nosso — é o ecossistema do Google fazendo o que já faz bem.
 *
 * O **Firestore** guarda o que é do produto e o Firebase Auth não tem onde
 * pôr: nome, telefone, plano e cota de análises.
 *
 *   users/{uid}   ← uid é o do Firebase Auth, não um id nosso
 *     { name, email, phone, plan, searchesUsedLifetime, searchedChannelIds,
 *       searchMonth, searchedIdsThisMonth, createdAt }
 *
 * ## Como o servidor sabe quem está falando
 *
 * O navegador manda `Authorization: Bearer <idToken>` em cada requisição, e
 * `verifyIdToken()` confere a assinatura do Google. Não há sessão nossa, nem
 * cookie nosso, nem token nosso para vazar — o SDK do Firebase renova o token
 * sozinho no cliente a cada hora.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { firestore, auth } from './_firebase.js';
import { searchLimit } from './_plans.js';

/** Mantém só dígitos — telefone com ou sem máscara vira a mesma chave. */
export const normalizePhone = (phone) => (phone || '').replace(/\D/g, '');

const usersCol = () => firestore()?.collection('users');

/**
 * Confere o ID token do cabeçalho e devolve `{ uid, email }`, ou `null`.
 * Um token inválido/expirado é indistinguível de "ninguém logado" para quem
 * chama — em ambos os casos a resposta certa é 401.
 */
export async function verifyRequest(req) {
  const a = auth();
  if (!a) return null;

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  try {
    const decoded = await a.verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email || '' };
  } catch {
    return null;
  }
}

export async function findUserByUid(uid) {
  const col = usersCol();
  if (!col || !uid) return null;
  const doc = await col.doc(uid).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

/** Existe outra conta usando este telefone? (trava contra recadastro em série) */
export async function phoneTakenBy(phone, exceptUid) {
  const col = usersCol();
  const norm = normalizePhone(phone);
  if (!col || !norm) return null;

  const snap = await col.where('phone', '==', norm).limit(2).get();
  const other = snap.docs.find((d) => d.id !== exceptUid);
  return other ? other.id : null;
}

/**
 * Cria o documento de perfil da conta recém-criada no Firebase Auth.
 * `create()` (e não `set()`) para que uma segunda chamada com o mesmo uid
 * falhe em vez de zerar silenciosamente a cota já usada.
 */
export async function createProfile(uid, { name, email, phone }) {
  const col = usersCol();
  if (!col) throw new Error('Firestore não configurado.');

  const profile = {
    name: (name || '').trim(),
    email: (email || '').trim().toLowerCase(),
    phone: normalizePhone(phone),
    plan: 'free',
    searchesUsedLifetime: 0,
    searchedChannelIds: [],
    searchMonth: '',
    searchedIdsThisMonth: [],
    createdAt: FieldValue.serverTimestamp(),
  };

  try {
    await col.doc(uid).create(profile);
  } catch (err) {
    if (err?.code !== 6 /* ALREADY_EXISTS */) throw err;
  }
  return { id: uid, ...profile };
}

export async function setUserPlan(uid, plan) {
  const col = usersCol();
  if (col) await col.doc(uid).update({ plan });
}

/** O que pode ir para o navegador. */
export const publicUser = (user) => ({
  name: user.name,
  email: user.email,
  phone: user.phone,
  plan: user.plan,
});

/* --------------------------------------------------------------- cota -- */

/**
 * Grátis: 3 análises PARA SEMPRE por conta — não reseta. É o teto que faz o
 * cadastro precisar de identidade real. Planos pagos: cota mensal.
 */
const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * `limit: null` significa ILIMITADO — e não é escolha estética.
 *
 * `Infinity` não sobrevive a `JSON.stringify`: vira `null` no caminho de volta
 * de qualquer forma. Se devolvêssemos `Infinity` daqui, o navegador receberia
 * `null` e a comparação `limit === Infinity` do outro lado nunca daria certo,
 * deixando o plano Creator com uma barra de progresso dividindo por `null`.
 * Melhor ser explícito na origem do que depender de um acidente do formato.
 */
export function getQuota(user) {
  const raw = searchLimit(user.plan);
  const unlimited = raw === Infinity;
  const lifetime = user.plan === 'free';
  const used = lifetime
    ? user.searchesUsedLifetime || 0
    : user.searchMonth === currentMonth() ? (user.searchedIdsThisMonth || []).length : 0;

  return {
    used,
    limit: unlimited ? null : raw,
    remaining: unlimited ? null : Math.max(0, raw - used),
    lifetime,
  };
}

/**
 * Gasta 1 análise se o canal for novo para esta conta. Canal já analisado
 * antes não consome de novo. Devolve a cota atualizada, ou `null` quando o
 * teto acabou — quem chama transforma isso num 403.
 */
export async function consumeSearch(user, channelId) {
  const col = usersCol();
  if (!col) return null;
  const limit = searchLimit(user.plan);

  if (user.plan === 'free') {
    const seen = user.searchedChannelIds || [];
    if (seen.includes(channelId)) return getQuota(user);
    if (limit !== Infinity && seen.length >= limit) return null;

    const updated = [...seen, channelId];
    await col.doc(user.id).update({
      searchesUsedLifetime: updated.length,
      searchedChannelIds: updated,
    });
    return getQuota({ ...user, searchesUsedLifetime: updated.length });
  }

  const month = currentMonth();
  const seen = user.searchMonth === month ? user.searchedIdsThisMonth || [] : [];
  if (seen.includes(channelId)) return getQuota({ ...user, searchMonth: month, searchedIdsThisMonth: seen });
  if (limit !== Infinity && seen.length >= limit) return null;

  const updated = [...seen, channelId];
  await col.doc(user.id).update({ searchMonth: month, searchedIdsThisMonth: updated });
  return getQuota({ ...user, searchMonth: month, searchedIdsThisMonth: updated });
}
