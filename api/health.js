/**
 * GET /api/health — diagnóstico de configuração.
 *
 * Responde sem chamar a YouTube API, para que checar a instalação não custe
 * cota. Serve para saber, em um clique, se a chave chegou ao ambiente.
 */

import { json, fail, NO_CACHE } from './_http.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'methodNotAllowed', 'Use GET.');

  const hasKey = !!process.env.YOUTUBE_API_KEY;

  json(
    res,
    hasKey ? 200 : 503,
    {
      ok: hasKey,
      mode: 'public',
      apiKeyConfigured: hasKey,
      message: hasKey
        ? 'Backend pronto. Buscas e relatórios usarão dados reais da YouTube Data API.'
        : 'Falta configurar YOUTUBE_API_KEY nas variáveis de ambiente da Vercel.',
      region: process.env.VERCEL_REGION || 'local',
      deployedAt: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    },
    NO_CACHE
  );
}
