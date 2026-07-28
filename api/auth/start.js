/**
 * GET /api/auth/start — inicia o login OAuth com o Google.
 *
 * PKCE (Proof Key for Code Exchange): geramos um segredo (`verifier`) que só
 * este servidor conhece, mandamos ao Google só o hash dele (`challenge`), e no
 * callback provamos posse do segredo original. Isso impede que alguém que
 * intercepte o `code` de redirecionamento consiga trocá-lo por um token sem
 * também ter o `verifier` — que nunca trafegou em lugar visível.
 *
 * `verifier` e `state` (proteção contra CSRF) ficam em cookies `httpOnly` de
 * vida curta, porque não há "sessão" ainda neste ponto do fluxo — o servidor
 * é stateless entre esta chamada e o callback.
 */

import { randomToken, pkceChallenge, setCookie, googleClientId, oauthRedirectUri } from '../_session.js';
import { fail } from '../_http.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ');

/** 10 minutos é folgado para completar o consentimento no Google. */
const PKCE_MAX_AGE = 600;

export default function handler(req, res) {
  const clientId = googleClientId();
  const redirectUri = oauthRedirectUri();

  if (!clientId || !redirectUri) {
    return fail(res, 503, 'oauthNotConfigured', 'OAuth do Google ainda não configurado nesta implantação.');
  }

  const verifier = randomToken(32);
  const state = randomToken(16);

  setCookie(res, 'oauth_verifier', verifier, { maxAge: PKCE_MAX_AGE });
  setCookie(res, 'oauth_state', state, { maxAge: PKCE_MAX_AGE });

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

  res.writeHead(302, { Location: url.toString() });
  res.end();
}
