/**
 * POST /api/auth/start — prepara a conexão de um canal do YouTube.
 *
 * ## Por que POST, e não um link direto
 *
 * Antes isto era uma navegação simples: o botão apontava para cá e o servidor
 * redirecionava ao Google. Só que agora a conexão pertence a uma CONTA, e uma
 * navegação de página inteira não carrega o `Authorization: Bearer` do
 * Firebase — o servidor não teria como saber de quem é o canal.
 *
 * Então o front chama esta rota autenticado, recebe a URL de consentimento e
 * navega para ela. O `uid` fica guardado num cookie `httpOnly` de vida curta,
 * junto do PKCE, e o callback o lê de volta.
 *
 * PKCE (Proof Key for Code Exchange): geramos um segredo (`verifier`), o
 * Google recebe só o hash dele (`challenge`), e no callback provamos posse do
 * original. Quem interceptar o `code` do redirecionamento não consegue
 * trocá-lo por token sem o `verifier`, que nunca trafegou à vista.
 */

import {
  randomToken, pkceChallenge, setCookie, listConnections,
  googleClientId, oauthRedirectUri, sessionStoreReady,
} from '../_session.js';
import { verifyRequest, findUserByUid } from '../_auth.js';
import { channelLimit } from '../_plans.js';
import { json, fail, NO_CACHE } from '../_http.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ');

/** 10 minutos é folgado para completar o consentimento no Google. */
const PKCE_MAX_AGE = 600;

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'methodNotAllowed', 'Use POST.');

  const clientId = googleClientId();
  const redirectUri = oauthRedirectUri();
  if (!clientId || !redirectUri) {
    return fail(res, 503, 'oauthNotConfigured', 'OAuth do Google ainda não configurado nesta implantação.');
  }
  if (!sessionStoreReady()) {
    return fail(res, 503, 'sessionNotConfigured', 'Armazenamento de conexões não configurado.');
  }

  const account = await verifyRequest(req);
  if (!account) return fail(res, 401, 'notLoggedIn', 'Faça login para conectar um canal.');

  const user = await findUserByUid(account.uid);
  if (!user) return fail(res, 400, 'needsProfile', 'Complete seu cadastro antes de conectar um canal.');

  // Checagem de teto ANTES de mandar alguém para o consentimento do Google:
  // seria desrespeitoso levar a pessoa por toda a tela de permissões para
  // recusar no retorno. O callback confere de novo, porque é lá que a
  // gravação acontece e o plano pode ter mudado no meio do caminho.
  const limite = channelLimit(user.plan);
  const conectados = await listConnections(account.uid);
  if (conectados.length >= limite) {
    return fail(res, 403, 'channelLimitReached', `Seu plano permite ${limite} ${limite === 1 ? 'canal conectado' : 'canais conectados'}.`, {
      limit: limite,
      connected: conectados.length,
    });
  }

  const verifier = randomToken(32);
  const state = randomToken(16);

  setCookie(res, 'oauth_verifier', verifier, { maxAge: PKCE_MAX_AGE });
  setCookie(res, 'oauth_state', state, { maxAge: PKCE_MAX_AGE });
  setCookie(res, 'oauth_uid', account.uid, { maxAge: PKCE_MAX_AGE });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  // access_type=offline pede o refresh_token; prompt=consent garante que ele
  // venha MESMO que o usuário já tenha autorizado este app antes — sem isso,
  // uma segunda autorização às vezes devolve tudo menos o refresh_token.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  json(res, 200, { url: url.toString() }, NO_CACHE);
}
