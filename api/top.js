/**
 * GET /api/top?limit=20 — ranking de canais por inscritos.
 *
 * A YouTube Data API **não** tem endpoint de "canais mais inscritos". O que
 * existe é `search.list`, que ordena por relevância textual e custa 100
 * unidades — inviável para montar um ranking.
 *
 * A solução honesta é uma lista curada de canais brasileiros conhecidos,
 * resolvida por handle (`channels.list?forHandle=`, 1 unidade cada) e ordenada
 * pelos inscritos REAIS que a API devolve. O recorte é editorial; os números
 * não são.
 *
 * Handles que não resolvem (canal renomeado, handle trocado) são simplesmente
 * ignorados — a lista encolhe, nada quebra.
 */

import { fetchChannelsByHandles, YouTubeError } from './_youtube.js';
import { trackChannel } from './_store.js';
import { json, fail, guard, handleYouTubeError } from './_http.js';

/**
 * Curadoria de canais brasileiros de grande alcance, variando nicho de
 * propósito: ciência, humor, games, culinária, música e entrevista.
 */
const SEED_HANDLES = [
  // Religião — o segmento que mais cresceu no Brasil nos últimos anos
  'bispobrunoleonardo', 'padremarcelorossi', 'CancaoNova', 'ipdatransformacao',

  // Infantil — categoria com os maiores números absolutos do país
  'galinhapintadinha', 'MariaClaraeJP', 'LuccasToon', 'totoykids', 'mundobita',
  'turmadamonica', 'BelParaMeninas', 'gatodegalochas', 'CleoPetitLIVE',

  // Entretenimento e humor
  'Whinderssonnunes', 'felipeneto', 'luccasneto', 'portadosfundos', 'vocesabia',
  'T3ddy', 'Enaldinho', 'cocielo', 'Casimito', 'Desimpedidos', 'gkay',

  // Games
  'rezendeevil', 'AuthenticGames', 'jovemnerd', 'robinhoodgamer', 'juliaminegirl',
  'Cellbit', 'coisadenerd',

  // Ciência, educação e curiosidades
  'manualdomundo', 'Nerdologia', 'CanalNostalgia',

  // Culinária
  'cheffotto', 'panelaterapia',

  // Música
  'kondzilla', 'anitta', 'luansantana', 'wesleysafadao', 'henriquejuliano',
  'jorgeemateus', 'gusttavolima', 'zenetoecristiano', 'marilia', 'brunoemarrone',
  'ivetesangalo', 'michelteloficial',

  // Entrevista e podcast
  'flowpodcast',
];

/**
 * Curadoria equivalente para os Estados Unidos. Mesmo critério da lista
 * brasileira: alcance grande e nichos variados, para o ranking não virar uma
 * lista só de música ou só de games.
 */
const SEED_HANDLES_US = [
  // Entretenimento e criadores de alcance massivo
  'MrBeast', 'mrbeast2', 'MrBeastGaming', 'sidemen', 'DudePerfect',
  'markiplier', 'jacksepticeye', 'RyanTrahan', 'AirrackVlogs', 'ZHC',

  // Infantil e família
  'CoComelon', 'LikeNastyaofficial', 'Vlad_and_Niki', 'diana_kids_show',
  'BLIPPI', 'RyansWorld',

  // Games
  'PewDiePie', 'DanTDM', 'Jacksfilms', 'Aphmau', 'preston', 'typicalgamer',

  // Música
  'justinbieber', 'EminemMusic', 'billieeilish', 'TaylorSwift', 'Maroon5',
  'katyperry', 'onedirection',

  // Ciência, educação e curiosidades
  'veritasium', 'MarkRober', 'SmarterEveryDay', 'vsauce', 'kurzgesagt',
  'TED', 'NatGeo', 'CrashCourse',

  // Tecnologia
  'mkbhd', 'LinusTechTips', 'UnboxTherapy',

  // Culinária e estilo de vida
  'BabishCulinaryUniverse', 'joshuaweissman', 'bonappetit',

  // Notícias, talk shows e esportes
  'NBA', 'WWE', 'jimmykimmellive', 'TheTonightShow', 'CNN',
];

/** As listas curadas por país. Cair fora daqui devolve 400, não uma lista vazia. */
const LISTAS = {
  BR: { handles: SEED_HANDLES, nome: 'Brasil' },
  US: { handles: SEED_HANDLES_US, nome: 'Estados Unidos' },
};

/**
 * Piso de inscritos.
 *
 * Handle errado costuma resolver para um canal homônimo minúsculo — a primeira
 * versão desta lista trouxe um canal de 56 inscritos entre os maiores do
 * Brasil. Um ranking "por inscritos" com um canal desses perde a credibilidade
 * inteira, então o piso descarta a resolução equivocada em silêncio.
 */
const MIN_SUBSCRIBERS = 500000;

/** 12 horas: inscritos de canal grande não mudam de forma relevante em um dia. */
const CACHE_TOP = 'public, s-maxage=43200, stale-while-revalidate=172800';

export default async function handler(req, res) {
  const apiKey = guard(req, res);
  if (!apiKey) return;

  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const region = String(req.query.region || 'BR').toUpperCase();
  const lista = LISTAS[region];
  if (!lista) {
    return fail(res, 400, 'badRegion', `Ranking não disponível para ${region}.`, { supported: Object.keys(LISTAS) });
  }

  try {
    const channels = await fetchChannelsByHandles(lista.handles, apiKey);

    if (!channels.length) {
      return fail(res, 502, 'noChannels', 'Nenhum canal da lista pôde ser resolvido.');
    }

    const ranked = channels
      .filter((c) => c.statistics.subscriberCount >= MIN_SUBSCRIBERS)
      .sort((a, b) => b.statistics.subscriberCount - a.statistics.subscriberCount)
      .slice(0, limit)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    // O Top 20 resolve dezenas de canais reais de uma vez — oportunidade
    // natural de semear o histórico de crescimento, sem depender de alguém
    // abrir cada canal individualmente. Fogo e esquece: falha aqui não pode
    // atrasar nem derrubar a resposta do ranking.
    Promise.allSettled(
      ranked.map((c) => trackChannel(c.id, { title: c.title, handle: c.handle, thumbnail: c.thumbnail }))
    ).catch(() => {});

    return json(
      res,
      200,
      {
        region,
        regionName: lista.nome,
        channels: ranked,
        total: ranked.length,
        resolved: channels.length,
        requested: lista.handles.length,
        minSubscribers: MIN_SUBSCRIBERS,
        fetchedAt: new Date().toISOString(),
      },
      CACHE_TOP
    );
  } catch (err) {
    if (err instanceof YouTubeError) return handleYouTubeError(res, err);
    console.error('Erro inesperado no ranking:', err);
    return fail(res, 500, 'internal', 'Erro interno ao montar o ranking.');
  }
}
