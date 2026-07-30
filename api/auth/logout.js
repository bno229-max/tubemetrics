/**
 * POST /api/auth/logout — desconecta um canal do YouTube da conta.
 *
 * Recebe `{ channelId }`. Sem ele, desconecta todos — é o que faz sentido
 * para "remover meu acesso" de uma vez.
 *
 * Isto apaga o refresh token cifrado do Firestore, mas NÃO revoga o
 * consentimento no lado do Google. Para isso o usuário precisa ir em
 * myaccount.google.com/permissions e remover o acesso do TubeMetrics — é o
 * único lugar que invalida o refresh token de verdade.
 *
 * Nada a ver com sair da conta do TubeMetrics: isso é o Firebase Auth, no
 * próprio navegador (ver `signOut` em `views/auth.js`).
 */

import { listConnections, deleteConnection } from '../_session.js';
import { verifyRequest } from '../_auth.js';
import { json, fail, NO_CACHE } from '../_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'notLoggedIn', 'Faça login primeiro.');

  const channelId = String((req.body || {}).channelId || '').trim();

  if (channelId) {
    await deleteConnection(account.uid, channelId);
  } else {
    const todas = await listConnections(account.uid);
    await Promise.all(todas.map((c) => deleteConnection(account.uid, c.channelId)));
  }

  const restantes = await listConnections(account.uid);
  json(res, 200, { ok: true, connectedChannels: restantes }, NO_CACHE);
}
