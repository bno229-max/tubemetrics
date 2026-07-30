/**
 * GET /api/firebase-config — configuração pública do Firebase para o navegador.
 *
 * Estes valores NÃO são segredo: a `apiKey` do Firebase Web identifica o
 * projeto, não autoriza nada sozinha (quem autoriza são as regras do
 * Firestore e a lista de domínios liberados no console). Ainda assim vêm de
 * variável de ambiente em vez de ficarem escritos no código, para o mesmo
 * arquivo servir qualquer projeto sem edição.
 *
 * `authDomain` é derivado do id do projeto — é sempre `<projeto>.firebaseapp.com`
 * a menos que alguém configure domínio próprio, e aí basta definir a variável.
 */

import { json, fail } from './_http.js';

const clean = (v) => (v || '').trim();

/** Config muda junto com o deploy: 1 h de borda é seguro e evita ida à função. */
const CACHE_CONFIG = 'public, s-maxage=3600, stale-while-revalidate=86400';

export default function handler(req, res) {
  const apiKey = clean(process.env.FIREBASE_WEB_API_KEY);
  const projectId = clean(process.env.FIREBASE_PROJECT_ID);

  if (!apiKey || !projectId) {
    return fail(
      res,
      503,
      'firebaseAuthNotConfigured',
      'Falta a variável FIREBASE_WEB_API_KEY (Console do Firebase → Configurações do projeto → Seus apps → Web).'
    );
  }

  json(
    res,
    200,
    {
      apiKey,
      projectId,
      authDomain: clean(process.env.FIREBASE_AUTH_DOMAIN) || `${projectId}.firebaseapp.com`,
    },
    CACHE_CONFIG
  );
}
