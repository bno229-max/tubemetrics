/**
 * _store.js — Histórico diário de canais, no Cloud Firestore.
 *
 * ## Por que Firestore, e por que não precisa de Blaze
 *
 * O plano Blaze é exigido pelas **Cloud Functions**, não pelo Firestore. Como
 * as funções deste projeto rodam na Vercel, o Firestore entra só como banco —
 * e nessa condição o plano Spark (gratuito) atende com folga: 50 mil leituras
 * e 20 mil escritas por dia contra as poucas centenas que este motor usa.
 *
 * A vantagem sobre um Redis: os dados ficam visíveis no console do Firebase.
 * Depurar "por que o ranking está vazio" vira olhar uma coleção, não decifrar
 * chaves opacas.
 *
 * ## Estrutura
 *
 *   tracked/{channelId}
 *     { channelId, title, handle, addedAt }
 *
 *   snapshots/{channelId}_{YYYY-MM-DD}
 *     { channelId, day, subscribers, views, videos, title, handle, thumbnail, at, expiresAt }
 *
 * `snapshots` é uma coleção plana, com o id composto, em vez de subcoleção por
 * canal. O motivo é prático: assim toda leitura é `getAll()` por ID — sem
 * consulta, sem índice composto para criar, sem uma etapa a mais no setup.
 *
 * ## Configuração
 *
 * Três variáveis de ambiente, vindas do JSON da conta de serviço:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *
 * Sem elas, todas as funções abaixo devolvem vazio e o produto segue
 * funcionando sem os rankings de crescimento — degradação explícita, nunca
 * dado inventado.
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';

/**
 * A chave privada tem quebras de linha reais. Painéis de variáveis de ambiente
 * guardam tudo numa linha só, escapando com `\n` literal — se não desfizermos
 * isso, o SDK recusa a credencial com um erro de parsing pouco óbvio.
 */
const PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '')
  .replace(/\\n/g, '\n')
  .replace(/^["']|["']$/g, '');

export const storageReady = () => !!(PROJECT_ID && CLIENT_EMAIL && PRIVATE_KEY);

let db = null;

/** Reaproveita a app entre invocações quentes da mesma instância. */
function firestore() {
  if (!storageReady()) return null;
  if (db) return db;

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId: PROJECT_ID, clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY }) });

  db = getFirestore(app);
  // Campo `undefined` em qualquer documento derruba a escrita inteira; ignorar
  // é mais seguro que confiar que toda origem preencheu todos os campos.
  try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* já configurado */ }
  return db;
}

export const isoDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
export const dayBefore = (days) => isoDay(new Date(Date.now() - days * 86400000));

const snapId = (channelId, day) => `${channelId}_${day}`;

/* ------------------------------------------------------ canais monitorados */

/**
 * Registra um canal para entrar na coleta diária.
 *
 * Quem chega aqui: os canais da lista curada do Top 20 e qualquer canal que um
 * usuário analise. O histórico cresce junto com o uso, sem cadastro manual.
 */
export async function trackChannel(channelId, meta = {}) {
  const store = firestore();
  if (!store || !channelId) return;
  await store.collection('tracked').doc(channelId).set(
    { channelId, ...meta, addedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

export async function trackedChannels() {
  const store = firestore();
  if (!store) return [];
  const snap = await store.collection('tracked').select().get();
  return snap.docs.map((d) => d.id);
}

/* --------------------------------------------------------------- snapshots */

/** Retenção de 400 dias: cobre o ranking anual com folga. */
const TTL_DIAS = 400;

/**
 * Grava o retrato do dia. Usa escrita em lote — o Firestore aceita 500
 * operações por lote, e um `set()` por canal seria uma viagem de rede cada.
 */
export async function saveSnapshots(rows, day = isoDay()) {
  const store = firestore();
  if (!store || !rows.length) return 0;

  const expiresAt = new Date(Date.now() + TTL_DIAS * 86400000);
  let gravados = 0;

  for (let i = 0; i < rows.length; i += 450) {
    const lote = store.batch();
    for (const r of rows.slice(i, i + 450)) {
      lote.set(store.collection('snapshots').doc(snapId(r.channelId, day)), {
        channelId: r.channelId,
        day,
        subscribers: r.subscribers ?? 0,
        views: r.views ?? 0,
        videos: r.videos ?? 0,
        title: r.title || '',
        handle: r.handle || '',
        thumbnail: r.thumbnail || null,
        at: FieldValue.serverTimestamp(),
        expiresAt,
      });
      gravados++;
    }
    await lote.commit();
  }
  return gravados;
}

/** Lê os retratos de um dia para vários canais, em lotes de `getAll`. */
export async function readSnapshots(channelIds, day) {
  const store = firestore();
  if (!store || !channelIds.length) return {};

  const out = {};
  // `getAll` não tem limite documentado, mas lotes grandes estouram o tamanho
  // máximo de resposta em canais com muitos campos.
  for (let i = 0; i < channelIds.length; i += 300) {
    const refs = channelIds.slice(i, i + 300).map((id) => store.collection('snapshots').doc(snapId(id, day)));
    const docs = await store.getAll(...refs);
    for (const doc of docs) {
      if (doc.exists) out[doc.get('channelId')] = doc.data();
    }
  }
  return out;
}

/**
 * Procura o retrato mais próximo de N dias atrás.
 *
 * A coleta pode falhar num dia (API fora do ar, deploy no meio da execução), e
 * exigir a data exata deixaria o ranking vazio por causa de um único buraco.
 * Varremos alguns dias em volta e usamos o mais próximo que existir —
 * devolvendo quantos dias aquele retrato realmente tem, para o cálculo não
 * fingir precisão que não há.
 */
export async function readSnapshotsNear(channelIds, targetDays, tolerance = 3) {
  for (let delta = 0; delta <= tolerance; delta++) {
    for (const dir of delta === 0 ? [0] : [-1, 1]) {
      const days = targetDays + dir * delta;
      if (days < 1) continue;
      const day = dayBefore(days);
      const found = await readSnapshots(channelIds, day);
      if (Object.keys(found).length) return { snapshots: found, day, actualDays: days };
    }
  }
  return { snapshots: {}, day: null, actualDays: null };
}

/** Quanto histórico já existe — usado para explicar rankings ainda vazios. */
export async function historyDepth() {
  const store = firestore();
  if (!store) return { days: 0, since: null, tracked: 0 };

  const ids = await trackedChannels();
  if (!ids.length) return { days: 0, since: null, tracked: 0 };

  const amostra = ids[0];
  for (const d of [365, 180, 90, 30, 14, 7, 3, 1]) {
    const doc = await store.collection('snapshots').doc(snapId(amostra, dayBefore(d))).get();
    if (doc.exists) return { days: d, since: dayBefore(d), tracked: ids.length };
  }
  return { days: 0, since: null, tracked: ids.length };
}
