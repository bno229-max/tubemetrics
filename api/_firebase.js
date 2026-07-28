/**
 * _firebase.js — Inicialização compartilhada do Firebase Admin SDK.
 *
 * Extraído de `_store.js` porque a partir de agora duas coisas usam Firestore:
 * o histórico de crescimento (`_store.js`) e as sessões de OAuth (`_session.js`).
 * Cada uma inicializando a própria app duplicaria a credencial e arriscaria dois
 * singletons divergentes — este módulo garante que existe só uma app e uma
 * instância de Firestore por instância quente da função.
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

export const firestoreReady = () => !!(PROJECT_ID && CLIENT_EMAIL && PRIVATE_KEY);

let db = null;

/** Reaproveita a app e o Firestore entre invocações quentes da mesma instância. */
export function firestore() {
  if (!firestoreReady()) return null;
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
