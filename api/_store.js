/**
 * _store.js — Histórico diário de canais.
 *
 * ## Por que não é Firestore
 *
 * O pedido original descrevia Firestore + Cloud Functions, desenho correto para
 * um projeto Firebase. Só que este projeto roda na **Vercel**: não há Cloud
 * Functions nem Admin SDK aqui, e falar com o Firestore exigiria assinar um JWT
 * de service account a cada requisição — mais peça móvel, mais segredo para
 * guardar, mais coisa para quebrar.
 *
 * A estrutura de dados é a mesma que o Firestore teria:
 *
 *   snapshots/{channelId}_{YYYY-MM-DD}  →  { subscribers, views, videos, at }
 *   tracked/{channelId}                 →  canal monitorado pelo CRON
 *
 * Trocar para Firestore depois é reescrever só este arquivo — nenhuma rota
 * conhece o mecanismo de armazenamento.
 *
 * ## Configuração
 *
 * Painel da Vercel → Storage → Upstash Redis. A integração injeta
 * `KV_REST_API_URL` e `KV_REST_API_TOKEN` sozinha. Sem elas, todas as funções
 * abaixo devolvem vazio e o produto segue funcionando sem os rankings de
 * crescimento — degradação explícita, nunca dado inventado.
 */

const URL_BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const storageReady = () => !!(URL_BASE && TOKEN);

/** Executa um comando Redis pela API REST do Upstash. */
async function cmd(...args) {
  if (!storageReady()) return null;
  const res = await fetch(URL_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Storage respondeu ${res.status}`);
  const body = await res.json();
  return body?.result ?? null;
}

/** Vários comandos numa única viagem de rede. */
async function pipeline(commands) {
  if (!storageReady() || !commands.length) return [];
  const res = await fetch(`${URL_BASE}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Storage respondeu ${res.status}`);
  const body = await res.json();
  return (Array.isArray(body) ? body : []).map((r) => r?.result ?? null);
}

export const isoDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

/** Data de N dias atrás, no mesmo formato das chaves. */
export const dayBefore = (days) => isoDay(new Date(Date.now() - days * 86400000));

/* ------------------------------------------------------ canais monitorados */

const TRACKED = 'tracked:channels';

/**
 * Registra um canal para entrar na coleta diária.
 *
 * Quem chega aqui: os canais da lista curada do Top 20 e qualquer canal que um
 * usuário analise. Assim o histórico cresce junto com o uso do produto, sem
 * ninguém precisar cadastrar nada à mão.
 */
export async function trackChannel(channelId) {
  if (!storageReady() || !channelId) return;
  await cmd('SADD', TRACKED, channelId);
}

export async function trackedChannels() {
  const ids = await cmd('SMEMBERS', TRACKED);
  return Array.isArray(ids) ? ids : [];
}

/* --------------------------------------------------------------- snapshots */

const snapKey = (channelId, day) => `snap:${channelId}:${day}`;

/**
 * Grava o retrato de um dia. TTL de 400 dias cobre o ranking anual com folga e
 * evita crescimento infinito — histórico velho não serve a nenhuma das janelas.
 */
export async function saveSnapshots(rows, day = isoDay()) {
  if (!storageReady() || !rows.length) return 0;
  const commands = rows.flatMap((r) => [
    ['SET', snapKey(r.channelId, day), JSON.stringify({
      subscribers: r.subscribers,
      views: r.views,
      videos: r.videos,
      title: r.title,
      handle: r.handle,
      thumbnail: r.thumbnail,
      at: new Date().toISOString(),
    }), 'EX', String(400 * 86400)],
  ]);
  await pipeline(commands);
  return rows.length;
}

/** Lê os retratos de um dia para vários canais, numa viagem só. */
export async function readSnapshots(channelIds, day) {
  if (!storageReady() || !channelIds.length) return {};
  const results = await pipeline(channelIds.map((id) => ['GET', snapKey(id, day)]));
  return channelIds.reduce((acc, id, i) => {
    const raw = results[i];
    if (!raw) return acc;
    try { acc[id] = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { /* registro corrompido */ }
    return acc;
  }, {});
}

/**
 * Procura o retrato mais próximo de N dias atrás.
 *
 * A coleta pode falhar num dia (API fora do ar, deploy no meio da execução), e
 * exigir a data exata deixaria o ranking vazio por causa de um único buraco.
 * Então varremos alguns dias em volta e usamos o mais próximo que existir —
 * devolvendo junto quantos dias aquele retrato realmente tem, para o cálculo
 * não fingir precisão que não há.
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

/** Datas com coleta registrada — usado para dizer desde quando há histórico. */
export async function historyDepth() {
  const ids = await trackedChannels();
  if (!ids.length) return { days: 0, since: null, tracked: 0 };

  const amostra = ids[0];
  for (const d of [365, 180, 90, 30, 14, 7, 3, 1]) {
    const found = await readSnapshots([amostra], dayBefore(d));
    if (Object.keys(found).length) return { days: d, since: dayBefore(d), tracked: ids.length };
  }
  return { days: 0, since: null, tracked: ids.length };
}
