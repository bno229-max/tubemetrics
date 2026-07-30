/**
 * _email.js — Envio transacional via Resend (API HTTP simples, sem SDK).
 *
 * Só usado para reset de senha por enquanto. Segue o mesmo princípio de
 * degradação explícita do resto do backend (`firestoreReady()`,
 * `sessionSecretReady()`): sem `RESEND_API_KEY` configurada, `sendEmail`
 * devolve `{ sent: false }` em vez de lançar — o endpoint que chama isto
 * decide o que fazer (aqui: seguir respondendo `ok:true` mesmo assim, porque
 * "e-mail não configurado" não pode travar o fluxo do usuário nem revelar
 * se a conta existe).
 */

const clean = (v) => (v || '').trim();

const RESEND_API_KEY = clean(process.env.RESEND_API_KEY);
const RESEND_FROM = clean(process.env.RESEND_FROM) || 'TubeMetrics <onboarding@resend.dev>';

export const emailReady = () => !!RESEND_API_KEY;

export async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) return { sent: false, reason: 'notConfigured' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Falha ao enviar e-mail via Resend:', res.status, body);
    return { sent: false, reason: 'providerError' };
  }
  return { sent: true };
}

export function resetPasswordEmail(link) {
  return {
    subject: 'Redefinir sua senha — TubeMetrics',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="margin-bottom:8px">Redefinir sua senha</h2>
        <p style="color:#444;line-height:1.6">
          Alguém (esperamos que você) pediu para redefinir a senha da sua conta no
          TubeMetrics. Clique no botão abaixo para escolher uma nova senha. Este link
          expira em 1 hora.
        </p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#e11d48;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Redefinir senha
          </a>
        </p>
        <p style="color:#888;font-size:13px">Se você não pediu isso, pode ignorar este e-mail.</p>
      </div>`,
  };
}
