/**
 * GET /api/health — diagnóstico de configuração.
 *
 * Responde sem chamar a YouTube API, para que checar a instalação não custe
 * cota. Serve para saber, em um clique, se a chave chegou ao ambiente.
 */

import { json, fail, NO_CACHE } from './_http.js';
import { storageReady } from './_store.js';
import { sessionStoreReady, googleClientId, googleClientSecret, oauthRedirectUri } from './_session.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'methodNotAllowed', 'Use GET.');

  const hasKey = !!process.env.YOUTUBE_API_KEY;
  // Firestore e OAuth são opcionais: sem eles o modo público funciona
  // integralmente, só não entram os rankings de crescimento nem o Dashboard
  // do Criador. Por isso nenhum dos dois entra no `ok` geral.
  const firestore = storageReady();
  const oauthConfigured = !!(googleClientId() && googleClientSecret() && oauthRedirectUri());
  const sessionReady = sessionStoreReady();
  // Contas de usuário exigem as duas pontas: a chave Web (navegador fala com o
  // Firebase Auth) e o Admin SDK (servidor confere o token que voltou).
  const authConfigured = !!process.env.FIREBASE_WEB_API_KEY && firestore;

  json(
    res,
    hasKey ? 200 : 503,
    {
      ok: hasKey,
      mode: 'public',
      apiKeyConfigured: hasKey,
      firestoreConfigured: firestore,
      cronSecretConfigured: !!process.env.CRON_SECRET,
      oauthConfigured,
      sessionSecretConfigured: sessionReady,
      creatorDashboardReady: oauthConfigured && sessionReady,
      authConfigured,
      message: !hasKey
        ? 'Falta configurar YOUTUBE_API_KEY nas variáveis de ambiente da Vercel.'
        : !authConfigured
          ? 'Backend pronto, mas contas de usuário aguardam FIREBASE_WEB_API_KEY.'
          : firestore
            ? 'Backend pronto, com contas e histórico de crescimento ativos.'
            : 'Backend pronto. Rankings de crescimento aguardam a configuração do Firestore.',
      region: process.env.VERCEL_REGION || 'local',
      deployedAt: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    },
    NO_CACHE
  );
}
