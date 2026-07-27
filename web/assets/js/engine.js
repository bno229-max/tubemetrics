/**
 * engine.js — Motor de análise. ZERO IA.
 *
 * Regra de ouro do produto: nenhum insight vem de modelo de linguagem. Tudo
 * aqui é aritmética, estatística descritiva e agrupamento de arrays com
 * `.filter()`, `.reduce()` e `.sort()`. Cada função abaixo documenta a fórmula
 * que usa, para que qualquer número exibido na tela seja auditável.
 *
 * Funções puras: recebem arrays, devolvem objetos novos. Nada de estado global,
 * nada de I/O. Isso mantém o custo de servidor em zero — roda no cliente.
 */

/* ==========================================================================
   1. Toolkit estatístico
   ========================================================================== */

export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const mean = (arr, f = (x) => x) => (arr.length ? sum(arr, f) / arr.length : 0);

export function median(arr, f = (x) => x) {
  if (!arr.length) return 0;
  const v = arr.map(f).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function quantile(arr, q, f = (x) => x) {
  if (!arr.length) return 0;
  const v = arr.map(f).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function stdev(arr, f = (x) => x) {
  if (arr.length < 2) return 0;
  const m = mean(arr, f);
  return Math.sqrt(sum(arr, (x) => (Number(f(x)) - m) ** 2) / (arr.length - 1));
}

/** Coeficiente de variação: desvio padrão relativo. Mede irregularidade. */
export const cv = (arr, f = (x) => x) => {
  const m = mean(arr, f);
  return m === 0 ? 0 : stdev(arr, f) / m;
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Formatação pt-BR com casas fixas, usada nos textos de insight.
 * Fica aqui (e não em format.js) porque os templates de frase são parte da
 * saída do motor: o insight já nasce pronto para leitura.
 */
const NF = [0, 1, 2].map((d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const n = (v, d = 1) => NF[d].format(Number.isFinite(Number(v)) ? Number(v) : 0);

/** Variação percentual entre dois valores, protegida contra divisão por zero. */
export function pctChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Agrupa um array por chave e reduz cada grupo.
 * É a primitiva usada por praticamente todas as análises deste arquivo.
 */
export function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    (acc[k] ||= []).push(item);
    return acc;
  }, {});
}

/**
 * Encolhimento bayesiano (shrinkage). Puxa a taxa de um grupo pequeno na
 * direção da taxa global, proporcionalmente ao tamanho da amostra.
 *
 *   ajustada = (eventos_grupo + peso_prior × taxa_global) / (base_grupo + peso_prior)
 *
 * Sem isso, um tema com 2 vídeos e um viral apareceria como "o melhor tema" —
 * ruído virando recomendação. É o mesmo raciocínio da média bayesiana do IMDb.
 */
export function shrunkRate(groupEvents, groupBase, globalRate, priorWeight) {
  return (groupEvents + priorWeight * globalRate) / (groupBase + priorWeight);
}

const DAY = 86400000;
const days = (a, b) => (new Date(a) - new Date(b)) / DAY;

/**
 * Testa se o valor é um número de verdade.
 *
 * A checagem de `null`/`''` é essencial e não é preciosismo: `Number(null)` é
 * `0` e `Number('')` também, então `Number.isFinite(Number(x))` aceitaria campo
 * vazio como se fosse zero medido. Seria a diferença entre "não temos esse
 * dado" e "esse dado é zero" — exatamente o erro que este motor não pode cometer.
 */
const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));

/**
 * Quais análises o conjunto de dados sustenta.
 *
 * A YouTube Data API pública não expõe inscritos por vídeo, desempenho das
 * primeiras 48 h nem retenção — esses campos chegam como `null` do backend.
 * Em vez de inventar valores (que produziriam recomendações confiantes e
 * erradas), detectamos a ausência e degradamos a análise de forma explícita.
 */
export function dataCapabilities(videos) {
  const has = (field) => videos.some((v) => isNum(v[field]));
  return {
    subsPerVideo: has('subsGained'),
    early48h: has('views48h'),
    retention: has('avgViewPct'),
    ctr: has('ctr'),
    revenue: has('revenue'),
  };
}

/** Média que ignora valores ausentes, em vez de tratá-los como zero. */
const meanDefined = (arr, f) => {
  const vals = arr.map(f).filter(isNum).map(Number);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
};

/* ==========================================================================
   2. Fundamentos do canal (Modo Público — YouTube Data API)
   ========================================================================== */

/** Média matemática de views por vídeo + mediana (resistente a virais). */
export function viewsPerVideo(videos) {
  return {
    mean: mean(videos, (v) => v.views),
    median: median(videos, (v) => v.views),
    // p90/p10 mostra o quanto o canal depende de outliers.
    p90: quantile(videos, 0.9, (v) => v.views),
    p10: quantile(videos, 0.1, (v) => v.views),
  };
}

/**
 * Frequência de postagem: intervalo entre envios consecutivos.
 * Usa MEDIANA em vez de média — um hiato de 40 dias não deve distorcer o
 * retrato do ritmo normal do canal.
 */
export function cadence(videos) {
  const sorted = [...videos].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  const intervals = sorted
    .slice(1)
    .map((v, i) => days(v.publishedAt, sorted[i].publishedAt))
    .filter((d) => d >= 0);

  if (!intervals.length) {
    return { medianDays: 0, meanDays: 0, perWeek: 0, cv: 0, longestGapDays: 0, daysSinceLast: 0, regularity: 0, intervals: [] };
  }

  const med = median(intervals);
  const last = sorted[sorted.length - 1];
  const daysSinceLast = Math.max(0, days(Date.now(), last.publishedAt));

  return {
    medianDays: med,
    meanDays: mean(intervals),
    perWeek: med > 0 ? 7 / med : 0,
    cv: cv(intervals),
    longestGapDays: Math.max(...intervals),
    daysSinceLast,
    // Regularidade 0–1 por decaimento suave: 1 / (1 + coeficiente de variação).
    // Cai pela metade quando o desvio padrão iguala o intervalo médio e nunca
    // chega a zero cravado — um canal caótico não é "0% regular", é pouco regular.
    regularity: 1 / (1 + cv(intervals)),
    intervals,
  };
}

/** Proporção Shorts × vídeos longos, por quantidade e por views. */
export function shortsVsLong(videos) {
  const shorts = videos.filter((v) => v.isShort);
  const longs = videos.filter((v) => !v.isShort);
  const totalViews = sum(videos, (v) => v.views) || 1;
  const build = (arr) => ({
    count: arr.length,
    countShare: videos.length ? arr.length / videos.length : 0,
    views: sum(arr, (v) => v.views),
    viewShare: sum(arr, (v) => v.views) / totalViews,
    subs: sum(arr, (v) => v.subsGained),
    medianViews: median(arr, (v) => v.views),
    subsPer1k: sum(arr, (v) => v.views) ? (sum(arr, (v) => v.subsGained) / sum(arr, (v) => v.views)) * 1000 : 0,
  });
  return { shorts: build(shorts), longs: build(longs) };
}

/** Evolução mensal: uploads, views e inscritos ganhos por mês de publicação. */
export function monthlyEvolution(videos, monthsBack = 14) {
  const byMonth = groupBy(videos, (v) => v.publishedAt.slice(0, 7));
  const rows = Object.entries(byMonth)
    .map(([month, list]) => ({
      month,
      date: `${month}-01`,
      uploads: list.length,
      views: sum(list, (v) => v.views),
      subs: sum(list, (v) => v.subsGained),
      medianViews: median(list, (v) => v.views),
      shorts: list.filter((v) => v.isShort).length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return rows.slice(-monthsBack);
}

/** Ranking de vídeos por qualquer métrica numérica. */
export function rankVideos(videos, metric = 'views', limit = 10) {
  return [...videos]
    .filter((v) => Number.isFinite(Number(v[metric])))
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
}

/* ==========================================================================
   3. Consultor de dados — os cruzamentos que viram resposta pronta
   ========================================================================== */

/**
 * "QUAL TEMA GERA MAIS INSCRITOS?"
 * ---------------------------------------------------------------------------
 * Esta é a função de referência do produto (entregável 6.3).
 *
 * Método, em quatro passos, tudo com array nativo:
 *
 *   1. AGRUPAR  — `.reduce()` junta os vídeos por tema (ou por tag).
 *   2. SOMAR    — cada grupo vira {views, inscritos, nº de vídeos}.
 *   3. NORMALIZAR — a taxa é `inscritos ÷ views × 1000` (inscritos por mil
 *      views). Comparar inscritos absolutos premiaria só o tema mais publicado;
 *      a taxa mede eficiência de conversão, que é o que a pergunta pede.
 *   4. ESTABILIZAR — a taxa passa por encolhimento bayesiano em direção à taxa
 *      média do canal. Um tema com 900 views e 1 viral não sequestra o pódio.
 *
 * Depois é só `.sort()` decrescente pela taxa ajustada.
 */
export function topicSubscriberConversion(videos, { groupField = 'topic', minVideos = 3, metric = 'subsGained' } = {}) {
  // Sem inscritos por vídeo (modo público real), a mesma matemática roda sobre
  // interações — que são públicas. O rótulo muda junto, para que a tela nunca
  // diga "inscritos" quando o número medido foi outra coisa.
  const engagement = metric === 'engagement';
  const valueOf = engagement ? (v) => (v.likes || 0) + (v.comments || 0) : (v) => v.subsGained || 0;
  const noun = engagement ? 'interações' : 'inscritos';

  const totalViews = sum(videos, (v) => v.views);
  const totalSubs = sum(videos, valueOf);
  const channelRate = totalViews ? totalSubs / totalViews : 0; // eventos por view

  // 1. AGRUPAR
  const groups = groupBy(videos, (v) => v[groupField]);

  // Peso do prior = 8% das views do canal. Quanto menor o grupo, mais ele é
  // puxado para a média — o efeito some quando a amostra fica grande.
  const priorWeight = totalViews * 0.08;

  const rows = Object.entries(groups)
    // 2. SOMAR
    .map(([name, list]) => {
      const views = sum(list, (v) => v.views);
      const subs = sum(list, valueOf);
      // 3. NORMALIZAR + 4. ESTABILIZAR
      const rawRate = views ? (subs / views) * 1000 : 0;
      const adjRate = shrunkRate(subs, views, channelRate, priorWeight) * 1000;
      return {
        name,
        videos: list.length,
        uploadShare: list.length / videos.length,
        views,
        viewShare: totalViews ? views / totalViews : 0,
        subs,
        subsShare: totalSubs ? subs / totalSubs : 0,
        rawSubsPer1k: rawRate,
        subsPer1k: adjRate,
        medianViews: median(list, (v) => v.views),
        medianRetention: meanDefined(list, (v) => v.avgViewPct),
        // Quanto o tema rende acima (ou abaixo) da média do canal, em %.
        vsChannel: channelRate ? (adjRate / (channelRate * 1000) - 1) * 100 : 0,
        reliable: list.length >= minVideos,
        sampleNote: list.length < minVideos ? `amostra pequena (${list.length} vídeos)` : null,
      };
    })
    // 4. ORDENAR
    .sort((a, b) => b.subsPer1k - a.subsPer1k);

  // "Outros" é a ausência de tema, não um tema: aparece na tabela como contexto,
  // mas não pode ser eleito o melhor nem o pior assunto do canal.
  const elegivel = (r) => r.reliable && r.name !== 'Outros';

  return {
    rows,
    channelSubsPer1k: channelRate * 1000,
    best: rows.find(elegivel) || null,
    worst: [...rows].reverse().find(elegivel) || null,
    metric,
    noun,
    metricLabel: `${engagement ? 'Interações' : 'Inscritos'} / mil views`,
  };
}

/* ------------------------------------------------- temas a partir do título */

/**
 * Palavras que aparecem em qualquer título e não indicam assunto.
 * Sem acento porque a normalização remove diacríticos antes de comparar.
 */
const STOPWORDS = new Set(`a o e de da do das dos em no na nos nas um uma uns umas para por com sem sob sobre
entre ate apos antes depois quando onde quem qual quais que como porque entao tambem ainda agora hoje ontem
tras frente dentro fora cima baixo lado junto perto longe meio tipo jeito forma casa dentro assim
tras frente dentro fora cima baixo lado junto perto longe meio antes tipo jeito forma vezes
amanha isso esse essa este esta isto aquele aquela seu sua seus suas meu minha meus minhas dele dela deles delas
nosso nossa eu tu ele ela nos vos eles elas voce voces se sim nao mais menos muito muita muitos muitas todo toda
todos todas outro outra outros outras mesmo mesma ser sou foi era sao ter tem tinha vai vou fez faz feito fazer
pode posso podem deve deve estao esta estou aqui ali la tudo nada algo alguem coisa coisas gente ver vez vezes
dia dias ano anos hora horas minuto minutos primeiro primeira ultimo ultima novo nova novos novas melhor melhores
pior video videos canal parte partes serie episodio live shorts short vlog the and for with you your this that
what how why best new all from about`.split(/\s+/).filter(Boolean));

/** Remove acentos e pontuação, deixando só palavras comparáveis. */
const normalizeText = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');

/**
 * Deriva temas dos TÍTULOS quando os metadados não servem.
 *
 * O problema real: a YouTube Data API só devolve ~15 categorias amplas, e um
 * canal inteiro costuma cair numa só ("Ciência e tecnologia" para os 200 vídeos
 * do Manual do Mundo). As tags também não salvam — canais profissionais repetem
 * o mesmo bloco de tags em todo vídeo, e um termo presente em 100% dos vídeos
 * não separa nada.
 *
 * O sinal que sobra está no título. O método é frequência de documento, o mesmo
 * princípio do TF-IDF, sem nada de IA:
 *
 *   1. normaliza e tokeniza cada título, descartando palavras vazias;
 *   2. conta em quantos vídeos cada termo aparece (DF);
 *   3. mantém como candidato o termo que aparece em pelo menos `minDocs` vídeos
 *      e em no máximo `maxShare` do catálogo — raro demais não sustenta
 *      estatística, comum demais não diferencia;
 *   4. cada vídeo recebe o candidato mais frequente do seu título, formando
 *      grupos grandes o bastante para comparar.
 *
 * A categoria original é preservada em `category`.
 */
export function deriveTitleTopics(videos, { minDocs = 3, maxShare = 0.4, maxGroups = 9 } = {}) {
  // Rótulo bonito por chave normalizada: "#BoraVê" continua legível mesmo
  // depois de virar "boravê" → "borave" na comparação.
  const labels = new Map();
  const remember = (key, label) => {
    if (!labels.has(key)) labels.set(key, label);
  };

  const tokensOf = (v) => {
    const title = String(v.title || '');
    const out = [];

    // Hashtags primeiro: num canal elas marcam quadros e séries recorrentes,
    // que é exatamente o tipo de agrupamento que interessa.
    for (const tag of title.match(/#[\p{L}\p{N}_]{2,}/gu) || []) {
      const key = normalizeText(tag).trim().replace(/\s+/g, '');
      if (!key) continue;
      remember(key, tag);
      out.push(key);
    }

    // Percorre as palavras COM acento e grafia originais: a comparação usa a
    // forma normalizada, mas o rótulo exibido preserva "BoraVê" e "Água" em vez
    // de "Borave" e "Agua".
    for (const word of title.replace(/#[\p{L}\p{N}_]+/gu, ' ').split(/[^\p{L}\p{N}]+/u)) {
      const key = normalizeText(word).trim();
      if (key.length < 4 || STOPWORDS.has(key) || /^\d+$/.test(key)) continue;
      // Título em CAIXA ALTA é estilo do canal, não ênfase de assunto.
      const label = /^[\p{Lu}\p{N}]+$/u.test(word)
        ? word.charAt(0) + word.slice(1).toLowerCase()
        : word;
      remember(key, label.charAt(0).toUpperCase() + label.slice(1));
      out.push(key);
    }
    return [...new Set(out)];
  };

  const docs = videos.map(tokensOf);
  const df = docs.reduce((acc, terms) => {
    for (const t of terms) acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const ceiling = Math.max(minDocs, Math.floor(videos.length * maxShare));
  const isHashtag = (t) => labels.get(t)?.startsWith('#');
  const candidate = (t) => df[t] >= minDocs && df[t] <= ceiling;

  const labeled = videos.map((v, i) => {
    const picks = docs[i].filter(candidate).sort((a, b) => {
      // Hashtag vence palavra solta: ela foi escolhida pelo autor para marcar
      // a série, então descreve o assunto melhor que qualquer termo inferido.
      if (isHashtag(a) !== isHashtag(b)) return isHashtag(a) ? -1 : 1;
      return df[b] - df[a] || a.localeCompare(b);
    });
    const term = picks[0];
    return { ...v, category: v.topic, topic: term ? labels.get(term) : 'Outros' };
  });

  // Muitos grupos minúsculos poluem a tabela; concentramos a cauda em "Outros".
  const counts = labeled.reduce((acc, v) => ((acc[v.topic] = (acc[v.topic] || 0) + 1), acc), {});
  const keep = new Set(
    Object.entries(counts)
      .filter(([name]) => name !== 'Outros')
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxGroups)
      .map(([name]) => name)
  );

  return labeled.map((v) => (keep.has(v.topic) ? v : { ...v, topic: 'Outros' }));
}

/** Distribuição de temas publicados (o "categorias mais publicadas" do §1A). */
export function topicDistribution(videos) {
  const groups = groupBy(videos, (v) => v.topic);
  return Object.entries(groups)
    .map(([name, list]) => ({
      name,
      videos: list.length,
      share: list.length / videos.length,
      views: sum(list, (v) => v.views),
      medianViews: median(list, (v) => v.views),
    }))
    .sort((a, b) => b.videos - a.videos);
}

/** Tags mais usadas, com desempenho médio — base alternativa de agrupamento. */
export function tagPerformance(videos, minVideos = 4) {
  const map = videos.reduce((acc, v) => {
    for (const tag of v.tags || []) {
      const t = (acc[tag] ||= { name: tag, videos: 0, views: 0, subs: 0 });
      t.videos += 1;
      t.views += v.views;
      t.subs += isNum(v.subsGained) ? v.subsGained : (v.likes || 0) + (v.comments || 0);
    }
    return acc;
  }, {});
  // Tag presente em quase todo vídeo é boilerplate do canal, não assunto:
  // canais profissionais repetem o mesmo bloco de tags em tudo que publicam.
  // Mantê-las produziria um ranking de termos que não separam nada.
  const ceiling = videos.length * 0.6;

  return Object.values(map)
    .filter((t) => t.videos >= minVideos && t.videos <= ceiling)
    .map((t) => ({ ...t, subsPer1k: t.views ? (t.subs / t.views) * 1000 : 0, medianViews: t.views / t.videos }))
    .sort((a, b) => b.subsPer1k - a.subsPer1k);
}

/** Faixas de duração usadas no agrupamento de "melhor duração". */
export const DURATION_BUCKETS = [
  { key: 'short', label: 'Shorts (< 1 min)', min: 0, max: 60, isShort: true },
  { key: '1-4', label: '1 – 4 min', min: 60, max: 240 },
  { key: '4-8', label: '4 – 8 min', min: 240, max: 480 },
  { key: '8-12', label: '8 – 12 min', min: 480, max: 720 },
  { key: '12-20', label: '12 – 20 min', min: 720, max: 1200 },
  { key: '20-35', label: '20 – 35 min', min: 1200, max: 2100 },
  { key: '35+', label: '35 min ou mais', min: 2100, max: Infinity },
];

/**
 * "QUAL É A MELHOR DURAÇÃO?"
 * Agrupa por faixa de tempo e mede três coisas diferentes, porque "melhor"
 * depende do objetivo:
 *   - alcance      → mediana de views
 *   - retenção     → % média assistida
 *   - tempo de tela→ minutos assistidos por view (retenção × duração)
 *   - conversão    → inscritos por mil views
 * A UI escolhe o critério; o motor entrega todos, sem embutir peso arbitrário.
 */
export function durationAnalysis(videos, { minVideos = 3 } = {}) {
  const rows = DURATION_BUCKETS.map((b) => {
    const list = videos.filter((v) =>
      b.isShort ? v.isShort : !v.isShort && v.durationSec >= b.min && v.durationSec < b.max
    );
    const views = sum(list, (v) => v.views);
    // Sem inscritos por vídeo, a coluna de conversão passa a medir interações.
    const events = sum(list, (v) => (isNum(v.subsGained) ? v.subsGained : (v.likes || 0) + (v.comments || 0)));
    return {
      key: b.key,
      label: b.label,
      isShort: !!b.isShort,
      videos: list.length,
      views,
      medianViews: median(list, (v) => v.views),
      retention: meanDefined(list, (v) => v.avgViewPct),
      watchSecPerView: meanDefined(list, (v) => v.avgViewDurationSec),
      subsPer1k: views ? (events / views) * 1000 : 0,
      medianCtr: meanDefined(list, (v) => v.ctr),
      reliable: list.length >= minVideos,
    };
  }).filter((r) => r.videos > 0);

  // `null` significa "não medido" e nunca deve vencer uma comparação.
  const pickBest = (metric) =>
    [...rows]
      .filter((r) => r.reliable && isNum(r[metric]))
      .sort((a, b) => b[metric] - a[metric])[0] || null;

  return {
    rows,
    hasRetention: rows.some((r) => isNum(r.retention)),
    bestByViews: pickBest('medianViews'),
    bestByRetention: pickBest('retention'),
    bestByWatchTime: pickBest('watchSecPerView'),
    bestBySubs: pickBest('subsPer1k'),
  };
}

/**
 * "MELHOR HORÁRIO PARA PUBLICAR"
 * ---------------------------------------------------------------------------
 * Baseado no desempenho das PRIMEIRAS 48 HORAS de cada envio anterior.
 *
 * O problema: comparar `views48h` cru entre vídeos é enganoso — o canal cresceu,
 * temas rendem diferente, virais existem. Então normalizamos:
 *
 *   índice_do_vídeo = views48h ÷ (mediana de views48h dos 10 vizinhos temporais)
 *
 * Ao dividir pela mediana dos vídeos publicados por volta da mesma época,
 * eliminamos tendência de crescimento e sazonalidade. Um índice de 1,3 significa
 * "arrancou 30% mais forte que o normal do canal naquele período".
 *
 * Depois agrupamos por hora e por dia da semana, aplicando encolhimento em
 * direção a 1,0 (a média) para não coroar uma hora com 1 único vídeo.
 * O mapa de calor 7×24 usa o modelo multiplicativo `dia × hora`, que é o jeito
 * honesto de preencher 168 células com ~100 observações.
 */
export function bestPublishTime(videos, { neighborWindow = 10, priorCount = 3, field = 'views48h' } = {}) {
  const sorted = [...videos].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  // Sem o histórico diário, `views48h` não existe e caímos para views totais.
  // É um sinal mais fraco — mede desempenho geral, não arranque — e a interface
  // precisa dizer isso ao usuário em vez de fingir que mediu as 48 h.
  const value = (v) => Number(v[field]) || 0;

  const indexed = sorted.map((v, i) => {
    const from = Math.max(0, i - neighborWindow);
    const to = Math.min(sorted.length, i + neighborWindow + 1);
    const neighbors = sorted.slice(from, to).filter((_, j) => from + j !== i);
    const baseline = median(neighbors, value) || 1;
    const d = new Date(v.publishedAt);
    return {
      video: v,
      hour: d.getHours(),
      weekday: d.getDay(),
      index: clamp(value(v) / baseline, 0.05, 6),
    };
  });

  const scoreOf = (list) => shrunkRate(sum(list, (x) => x.index), list.length, 1, priorCount);

  const hours = Array.from({ length: 24 }, (_, h) => {
    const list = indexed.filter((x) => x.hour === h);
    return { hour: h, n: list.length, score: list.length ? scoreOf(list) : 1, raw: mean(list, (x) => x.index) };
  });

  const weekdays = Array.from({ length: 7 }, (_, d) => {
    const list = indexed.filter((x) => x.weekday === d);
    return { weekday: d, n: list.length, score: list.length ? scoreOf(list) : 1, raw: mean(list, (x) => x.index) };
  });

  // Mapa 7×24 pelo modelo multiplicativo dia × hora.
  const matrix = weekdays.map((d) =>
    hours.map((h) => ({
      weekday: d.weekday,
      hour: h.hour,
      score: d.score * h.score,
      n: indexed.filter((x) => x.weekday === d.weekday && x.hour === h.hour).length,
    }))
  );

  // Blocos de 3 horas: janela prática de publicação, com amostra somada.
  const blocks = Array.from({ length: 8 }, (_, b) => {
    const hs = [b * 3, b * 3 + 1, b * 3 + 2];
    const list = indexed.filter((x) => hs.includes(x.hour));
    return {
      start: hs[0],
      end: hs[2],
      label: `${String(hs[0]).padStart(2, '0')}h – ${String(hs[2] + 1).padStart(2, '0')}h`,
      n: list.length,
      score: list.length ? scoreOf(list) : 1,
    };
  }).sort((a, b) => b.score - a.score);

  const topHours = [...hours].filter((h) => h.n >= 2).sort((a, b) => b.score - a.score);
  const topDays = [...weekdays].filter((d) => d.n >= 3).sort((a, b) => b.score - a.score);

  return {
    hours,
    weekdays,
    matrix,
    blocks,
    bestBlock: blocks[0] || null,
    bestHours: topHours.slice(0, 3),
    worstHours: topHours.slice(-2).reverse(),
    bestDays: topDays.slice(0, 2),
    sample: indexed.length,
    basis: field, // 'views48h' = arranque medido · 'views' = desempenho total
    exact: field === 'views48h',
    // Ganho esperado ao migrar do horário atual mais usado para o melhor bloco.
    lift: blocks.length > 1 ? (blocks[0].score / (mean(blocks, (b) => b.score) || 1) - 1) * 100 : 0,
  };
}

/**
 * "FREQUÊNCIA IDEAL"
 * Fatia o histórico em janelas de 28 dias, conta quantos uploads houve em cada
 * uma e mede o ganho de inscritos daquela janela. Depois agrupa as janelas por
 * faixa de ritmo (uploads por semana) e ordena pelo ganho mediano.
 *
 * Mediana, não média: uma janela com um viral não deve eleger a frequência.
 */
export function idealFrequency(videos, dailyRows = null, { windowDays = 28 } = {}) {
  const sorted = [...videos].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  if (sorted.length < 8) return { buckets: [], best: null, current: 0, windows: [] };

  const start = new Date(sorted[0].publishedAt).getTime();
  const end = Date.now();
  const nWindows = Math.floor((end - start) / (windowDays * DAY));

  const netSubsIn = (from, to) => {
    if (dailyRows) {
      const rows = dailyRows.filter((r) => {
        const t = new Date(`${r.date}T12:00:00`).getTime();
        return t >= from && t < to;
      });
      return sum(rows, (r) => r.subscribersGained - r.subscribersLost);
    }
    // Modo público: inscritos por vídeo quando existem; senão, interações,
    // que são o melhor sinal de resposta de audiência disponível publicamente.
    const inWin = videos.filter((v) => {
      const t = new Date(v.publishedAt).getTime();
      return t >= from && t < to;
    });
    return sum(inWin, (v) => (isNum(v.subsGained) ? v.subsGained : (v.likes || 0) + (v.comments || 0)));
  };

  const windows = Array.from({ length: nWindows }, (_, i) => {
    const from = start + i * windowDays * DAY;
    const to = from + windowDays * DAY;
    const inWin = sorted.filter((v) => {
      const t = new Date(v.publishedAt).getTime();
      return t >= from && t < to;
    });
    return {
      from,
      to,
      uploads: inWin.length,
      perWeek: (inWin.length / windowDays) * 7,
      views: sum(inWin, (v) => v.views),
      netSubs: netSubsIn(from, to),
    };
  }).filter((w) => w.uploads > 0);

  // Faixas de ritmo em passos de 1 upload/semana.
  const bucketOf = (perWeek) => {
    if (perWeek < 1) return '< 1/semana';
    if (perWeek < 2) return '1 – 2/semana';
    if (perWeek < 3) return '2 – 3/semana';
    if (perWeek < 4) return '3 – 4/semana';
    if (perWeek < 6) return '4 – 6/semana';
    return '6+/semana';
  };

  const grouped = groupBy(windows, (w) => bucketOf(w.perWeek));
  const order = ['< 1/semana', '1 – 2/semana', '2 – 3/semana', '3 – 4/semana', '4 – 6/semana', '6+/semana'];

  const buckets = Object.entries(grouped)
    .map(([label, list]) => ({
      label,
      windows: list.length,
      medianNetSubs: median(list, (w) => w.netSubs),
      medianViews: median(list, (w) => w.views),
      // Retorno marginal: inscritos por upload. Cai quando se publica demais.
      subsPerUpload: median(list, (w) => (w.uploads ? w.netSubs / w.uploads : 0)),
      avgPerWeek: mean(list, (w) => w.perWeek),
      reliable: list.length >= 2,
    }))
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

  const ranked = [...buckets].filter((b) => b.reliable).sort((a, b) => b.medianNetSubs - a.medianNetSubs);
  const recent = windows.slice(-3);

  return {
    buckets,
    windows,
    best: ranked[0] || null,
    // Ritmo praticado hoje (média das 3 últimas janelas).
    current: mean(recent, (w) => w.perWeek),
    currentBucket: bucketOf(mean(recent, (w) => w.perWeek)),
  };
}

/* ==========================================================================
   4. Nota geral do canal (0–100)
   ========================================================================== */

/**
 * Algoritmo próprio, quatro pilares somando 100. Cada pilar é uma função
 * saturante de uma razão observável — nada de peso mágico escondido.
 *
 *   Engajamento  30  (curtidas + comentários) ÷ views
 *   Consistência 25  regularidade dos intervalos + atividade recente
 *   Crescimento  30  mediana de views dos últimos 90 d ÷ 90 d anteriores
 *   Alcance      15  views por inscrito + retenção média
 */
export function channelScore(channel) {
  const videos = channel.videos;
  const cad = cadence(videos);
  const now = Date.now();

  // --- Engajamento -----------------------------------------------------
  const recent = videos.slice(0, 30);
  const engViews = sum(recent, (v) => v.views) || 1;
  const engRate = (sum(recent, (v) => v.likes) + sum(recent, (v) => v.comments)) / engViews;
  const engagement = clamp(engRate / 0.045, 0, 1) * 30; // 4,5% satura a nota

  // --- Consistência ----------------------------------------------------
  const recencyOk = cad.medianDays ? clamp(1 - cad.daysSinceLast / (3 * cad.medianDays), 0, 1) : 0;
  const consistency = (0.65 * cad.regularity + 0.35 * recencyOk) * 25;

  // --- Crescimento -----------------------------------------------------
  const last90 = videos.filter((v) => now - new Date(v.publishedAt) <= 90 * DAY);
  const prev90 = videos.filter((v) => {
    const age = now - new Date(v.publishedAt);
    return age > 90 * DAY && age <= 180 * DAY;
  });
  const gRatio = median(prev90, (v) => v.views) ? median(last90, (v) => v.views) / median(prev90, (v) => v.views) : 1;
  const growth = clamp((gRatio - 0.7) / 0.8, 0, 1) * 30; // 0,7× → 0 ; 1,5× → cheio

  // --- Alcance & retenção ----------------------------------------------
  const subs = channel.statistics.subscriberCount || 1;
  const reachRatio = median(videos, (v) => v.views) / subs; // views por inscrito
  const retention = meanDefined(videos, (v) => v.avgViewPct);

  // Sem retenção medida, o pilar VALE MENOS em vez de ser preenchido por
  // alcance. Se a metade não observada continuasse valendo 15 pontos, um canal
  // ganharia nota ao ter MENOS dado disponível — o oposto do que o número deve
  // significar. Normalizamos o total pelo máximo efetivamente mensurável, de
  // modo que a escala 0–100 continue comparável entre os dois casos.
  const reachMax = retention === null ? 8 : 15;
  const reach = retention === null
    ? clamp(reachRatio / 0.35, 0, 1) * reachMax
    : (0.55 * clamp(reachRatio / 0.35, 0, 1) + 0.45 * clamp(retention / 62, 0, 1)) * 15;

  const maxTotal = 30 + 25 + 30 + reachMax;
  const total = Math.round(((engagement + consistency + growth + reach) / maxTotal) * 100);

  const grade =
    total >= 85 ? { label: 'Excelente', tone: 'pos' }
    : total >= 70 ? { label: 'Muito bom', tone: 'pos' }
    : total >= 55 ? { label: 'Bom', tone: 'info' }
    : total >= 40 ? { label: 'Regular', tone: 'warn' }
    : { label: 'Precisa de atenção', tone: 'neg' };

  return {
    total,
    grade,
    pillars: [
      {
        key: 'engagement',
        label: 'Engajamento',
        score: engagement,
        max: 30,
        detail: `${n((engRate * 100), 2)}% de interação nos 30 vídeos mais recentes`,
        hint: 'Curtidas + comentários dividido por views. Satura em 4,5%.',
      },
      {
        key: 'consistency',
        label: 'Consistência',
        score: consistency,
        max: 25,
        detail: `mediana de ${n(cad.medianDays, 1)} dias entre envios · último há ${Math.round(cad.daysSinceLast)} d`,
        hint: 'Regularidade dos intervalos (65%) + atividade recente (35%).',
      },
      {
        key: 'growth',
        label: 'Crescimento',
        score: growth,
        max: 30,
        detail: `${gRatio >= 1 ? '+' : '−'}${n(Math.abs((gRatio - 1) * 100), 0)}% na mediana de views (90 d vs 90 d anteriores)`,
        hint: 'Compara medianas para neutralizar virais isolados.',
      },
      {
        key: 'reach',
        label: retention === null ? 'Alcance' : 'Alcance & retenção',
        score: reach,
        max: reachMax,
        detail: retention === null
          ? `${n(reachRatio * 100, 1)} views por 100 inscritos · retenção não disponível`
          : `${n(reachRatio * 100, 1)} views por 100 inscritos · ${n(retention, 0)}% assistidos`,
        hint: 'Mede se o conteúdo escapa da base e prende quem chega.',
      },
    ],
    inputs: { engRate, gRatio, reachRatio, retention, cadence: cad },
  };
}

/* ==========================================================================
   5. Motor de estimativa de ganhos (§2)
   ========================================================================== */

/** RPM de referência por nicho (R$ por mil views monetizadas, Brasil). */
export const RPM_PRESETS = [
  { key: 'financas', label: 'Finanças e investimentos', rpm: 42 },
  { key: 'tech', label: 'Tecnologia e software', rpm: 28 },
  { key: 'negocios', label: 'Negócios e carreira', rpm: 31 },
  { key: 'educacao', label: 'Educação e cursos', rpm: 22 },
  { key: 'saude', label: 'Saúde e bem-estar', rpm: 19 },
  { key: 'games', label: 'Games', rpm: 13 },
  { key: 'culinaria', label: 'Culinária', rpm: 12 },
  { key: 'entretenimento', label: 'Entretenimento e vlog', rpm: 9 },
  { key: 'musica', label: 'Música', rpm: 7 },
];

/**
 * Faixas de ganho estimado. Exibir um número único seria falsa precisão: RPM
 * varia com sazonalidade, país da audiência e taxa de monetização. Então:
 *
 *   Conservador = RPM × 0,70      Médio = RPM      Otimista = RPM × 1,50
 *
 * Shorts entram por um pool separado, com RPM ~5,5% do longo — publicar Shorts
 * não rende como vídeo longo, e a estimativa precisa refletir isso.
 */
export function estimateEarnings({ longViews = 0, shortViews = 0, rpm = 20, monetizedShare = 0.62 }) {
  const shortRpm = rpm * 0.055;
  const at = (mult) => {
    const long = (longViews * monetizedShare / 1000) * rpm * mult;
    const short = (shortViews / 1000) * shortRpm * mult;
    return { total: long + short, long, short, rpm: rpm * mult };
  };
  return {
    conservative: at(0.7),
    medium: at(1),
    optimistic: at(1.5),
    assumptions: { rpm, monetizedShare, shortRpm, longViews, shortViews },
  };
}

/** Views dos últimos N dias separadas por formato — entrada da estimativa. */
export function recentViewsByFormat(videos, windowDays = 30) {
  const cutoff = Date.now() - windowDays * DAY;
  const inWindow = videos.filter((v) => new Date(v.publishedAt).getTime() >= cutoff);
  // Vídeos publicados na janela concentram, em média, ~55% das views do período;
  // o restante vem do catálogo antigo. Fator de catálogo aplicado sobre o total.
  const CATALOG_FACTOR = 1 / 0.55;
  return {
    longViews: sum(inWindow.filter((v) => !v.isShort), (v) => v.views) * CATALOG_FACTOR,
    shortViews: sum(inWindow.filter((v) => v.isShort), (v) => v.views) * CATALOG_FACTOR,
    uploads: inWindow.length,
    windowDays,
  };
}

/* ==========================================================================
   6. Séries e comparações (Modo Criador — YouTube Analytics API)
   ========================================================================== */

export function sliceDays(dailyRows, n) {
  return dailyRows.slice(-n);
}

/** Soma de uma métrica em uma janela e comparação com a janela anterior. */
export function windowCompare(dailyRows, key, n = 28) {
  const cur = dailyRows.slice(-n);
  const prev = dailyRows.slice(-2 * n, -n);
  const a = sum(cur, (r) => r[key]);
  const b = sum(prev, (r) => r[key]);
  return { current: a, previous: b, change: pctChange(a, b), days: n };
}

/** Comparação histórica mês atual (até hoje) × mesmo trecho do mês anterior. */
export function monthOverMonth(dailyRows) {
  const today = new Date();
  const dayOfMonth = today.getDate();
  const ym = (d) => d.toISOString().slice(0, 7);
  const thisMonth = ym(today);
  const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonth = ym(prevDate);

  const inMonth = (m) => dailyRows.filter((r) => r.date.slice(0, 7) === m && Number(r.date.slice(8, 10)) <= dayOfMonth);
  const cur = inMonth(thisMonth);
  const prev = inMonth(prevMonth);

  const agg = (rows) => ({
    views: sum(rows, (r) => r.views),
    watchMinutes: sum(rows, (r) => r.estimatedMinutesWatched),
    netSubs: sum(rows, (r) => r.subscribersGained - r.subscribersLost),
    subsGained: sum(rows, (r) => r.subscribersGained),
    subsLost: sum(rows, (r) => r.subscribersLost),
    revenue: sum(rows, (r) => r.estimatedRevenue),
    impressions: sum(rows, (r) => r.impressions),
    ctr: sum(rows, (r) => r.impressions) ? (sum(rows, (r) => r.views) / sum(rows, (r) => r.impressions)) * 100 : 0,
    rpm: sum(rows, (r) => r.views) ? (sum(rows, (r) => r.estimatedRevenue) / sum(rows, (r) => r.views)) * 1000 : 0,
    days: rows.length,
  });

  const c = agg(cur);
  const p = agg(prev);
  const metrics = Object.keys(c)
    .filter((k) => k !== 'days')
    .reduce((acc, k) => {
      acc[k] = { current: c[k], previous: p[k], change: pctChange(c[k], p[k]) };
      return acc;
    }, {});

  return { current: c, previous: p, metrics, dayOfMonth, thisMonth, prevMonth };
}

/** CPM implícito a partir de receita e views monetizadas estimadas. */
export function revenueMetrics(dailyRows, n = 28) {
  const rows = dailyRows.slice(-n);
  const views = sum(rows, (r) => r.views);
  const revenue = sum(rows, (r) => r.estimatedRevenue);
  const rpm = views ? (revenue / views) * 1000 : 0;
  return {
    revenue,
    views,
    rpm,
    // CPM = receita ÷ impressões de anúncio. Aproximamos as impressões
    // monetizadas em 62% das views (taxa típica de cobertura de anúncio).
    cpm: views ? (revenue / (views * 0.62)) * 1000 : 0,
    monetizedShare: 0.62,
  };
}

/* ==========================================================================
   7. Composição de insights — filtros lógicos encadeados
   ========================================================================== */

/**
 * Cada insight é um `if` sobre números já calculados. Nenhum texto é gerado por
 * modelo: as frases são templates preenchidos com as métricas, e todo insight
 * carrega a evidência (amostra e valor) que o sustenta.
 */
export function buildInsights(channel, a) {
  const out = [];
  const push = (o) => out.push(o);
  const videos = channel.videos;

  const noun = a.topics.noun; // 'inscritos' ou 'interações', conforme o dado

  // --- Tema campeão de conversão ---------------------------------------
  const best = a.topics.best;
  if (best && best.vsChannel > 12) {
    push({
      tone: 'pos',
      icon: 'target',
      title: `"${best.name}" é o seu tema que mais converte ${noun}`,
      body: `Vídeos desse tema trazem ${n(best.subsPer1k, 1)} ${noun} a cada mil views — ${Math.round(best.vsChannel)}% acima da média do canal. O tema ocupa ${n((best.uploadShare * 100), 0)}% dos seus envios.`,
      evidence: `${best.videos} vídeos · ${Math.round(best.views).toLocaleString('pt-BR')} views · ${best.subs.toLocaleString('pt-BR')} ${noun}`,
    });
  }

  const worst = a.topics.worst;
  if (worst && best && worst.name !== best.name && worst.vsChannel < -22 && worst.uploadShare > 0.12) {
    push({
      tone: 'warn',
      icon: 'alert',
      title: `"${worst.name}" consome ${n((worst.uploadShare * 100), 0)}% dos envios e converte pouco`,
      body: `Esse tema entrega ${n(worst.subsPer1k, 1)} ${noun} por mil views, ${Math.abs(Math.round(worst.vsChannel))}% abaixo da média. Realocar parte desses envios para "${best.name}" tende a render mais com o mesmo esforço.`,
      evidence: `${worst.videos} vídeos · ${worst.subs.toLocaleString('pt-BR')} ${noun} gerados`,
    });
  }

  // --- Tema que alcança muito e converte pouco ---------------------------
  // O caso mais útil e menos óbvio: assunto que traz multidão de fora mas não
  // transforma essa multidão em público. Ótimo para descoberta, fraco para base.
  const chMedian = a.viewsPerVideo.median;
  const temas = a.topics.rows.filter((r) => r.reliable && r.name !== 'Outros');
  const vitrine = temas.find((r) => chMedian > 0 && r.medianViews > chMedian * 2 && r.vsChannel < -25);
  if (vitrine) {
    push({
      tone: 'info',
      icon: 'split',
      title: `"${vitrine.name}" alcança muito, mas engaja pouco`,
      body: `Esses vídeos fazem ${n(vitrine.medianViews / chMedian, 1)}× as views do vídeo típico do canal, porém geram ${Math.abs(Math.round(vitrine.vsChannel))}% menos ${noun} por mil views. É um tema de vitrine: serve para ser descoberto, não para converter quem chega.`,
      evidence: `${vitrine.videos} vídeos · mediana de ${Math.round(vitrine.medianViews).toLocaleString('pt-BR')} views contra ${Math.round(chMedian).toLocaleString('pt-BR')} do canal`,
    });
  }

  // --- Melhor janela de publicação --------------------------------------
  const bt = a.publishTime;
  if (bt.bestBlock && bt.sample >= 15 && bt.lift > 8) {
    const dayNames = bt.bestDays.map((d) => ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][d.weekday]);
    const janela = bt.exact ? 'nas primeiras 48 h' : 'no total';
    push({
      tone: 'brand',
      icon: 'clock',
      title: `Publique entre ${bt.bestBlock.label}`,
      body: `Envios nessa faixa fizeram ${Math.round((bt.bestBlock.score - 1) * 100)}% mais views ${janela} que a média do canal${dayNames.length ? `. Os melhores dias são ${dayNames.join(' e ')}` : ''}.`,
      evidence: bt.exact
        ? `${bt.bestBlock.n} envios nessa faixa · ${bt.sample} vídeos analisados`
        : `${bt.bestBlock.n} envios nessa faixa · baseado em views totais, não no arranque de 48 h`,
    });
  }

  // --- Melhor duração ---------------------------------------------------
  const dur = a.duration;
  if (dur.bestByViews) {
    const b = dur.bestByViews;
    const extra = dur.bestByRetention && dur.bestByRetention.key !== b.key
      ? ` Já a faixa de ${dur.bestByRetention.label.toLowerCase()} lidera em retenção (${n(dur.bestByRetention.retention, 0)}%).`
      : '';
    push({
      tone: 'info',
      icon: 'ruler',
      title: `A faixa de ${b.label.toLowerCase()} é a que mais alcança`,
      body: isNum(b.retention)
        ? `Mediana de ${Math.round(b.medianViews).toLocaleString('pt-BR')} views e ${n(b.retention, 0)}% de retenção média.${extra}`
        : `Mediana de ${Math.round(b.medianViews).toLocaleString('pt-BR')} views. A retenção por faixa exige conectar o canal.`,
      evidence: `${b.videos} vídeos nessa faixa`,
    });
  }

  // --- Consistência de envio --------------------------------------------
  const cad = a.cadence;
  if (cad.cv > 0.85 && videos.length > 12) {
    push({
      tone: 'warn',
      icon: 'wave',
      title: 'Seu ritmo de publicação é irregular',
      body: `O intervalo entre envios varia ${Math.round(cad.cv * 100)}% em torno da mediana de ${n(cad.medianDays, 1)} dias. Cadência previsível ajuda o algoritmo a distribuir e o público a criar hábito.`,
      evidence: `maior hiato: ${Math.round(cad.longestGapDays)} dias`,
    });
  } else if (cad.cv < 0.5 && videos.length > 12) {
    push({
      tone: 'pos',
      icon: 'check',
      title: 'Cadência consistente',
      body: `Você publica a cada ${n(cad.medianDays, 1)} dias com pouca variação (${Math.round(cad.cv * 100)}%), o equivalente a ${n(cad.perWeek, 1)} envios por semana.`,
      evidence: `${cad.intervals.length} intervalos medidos`,
    });
  }

  if (cad.medianDays > 0 && cad.daysSinceLast > cad.medianDays * 2.5) {
    push({
      tone: 'neg',
      icon: 'alert',
      title: `Sem publicar há ${Math.round(cad.daysSinceLast)} dias`,
      body: `Isso é ${n((cad.daysSinceLast / cad.medianDays), 1)}× o intervalo normal do canal. Pausas longas costumam derrubar impressões nas semanas seguintes.`,
      evidence: `intervalo normal: ${n(cad.medianDays, 1)} dias`,
    });
  }

  // --- Frequência ideal --------------------------------------------------
  const freq = a.frequency;
  if (freq.best && freq.current > 0) {
    const diff = freq.best.avgPerWeek - freq.current;
    if (Math.abs(diff) >= 0.6) {
      push({
        tone: diff > 0 ? 'info' : 'warn',
        icon: 'calendar',
        title: diff > 0
          ? `Subir para ~${n(freq.best.avgPerWeek, 1)} envios/semana rendeu mais`
          : `Publicar menos rendeu mais: ~${n(freq.best.avgPerWeek, 1)}/semana`,
        body: `Nas janelas de 28 dias em que o canal publicou ${freq.best.label}, o ganho líquido mediano foi de ${Math.round(freq.best.medianNetSubs).toLocaleString('pt-BR')} ${noun}. Hoje o ritmo está em ${n(freq.current, 1)}/semana.`,
        evidence: `${freq.best.windows} janelas nessa faixa · ${freq.windows.length} janelas no total`,
      });
    }
  }

  // --- Formato: Shorts × longos ------------------------------------------
  const sl = a.format;
  // Este insight compara conversão em INSCRITOS entre formatos; com dados só
  // públicos a comparação não se sustenta e é melhor não dizer nada.
  if (a.capabilities.subsPerVideo && sl.shorts.count >= 5 && sl.longs.count >= 5) {
    const ratio = sl.longs.subsPer1k ? sl.shorts.subsPer1k / sl.longs.subsPer1k : 1;
    if (sl.shorts.countShare > 0.35 && ratio < 0.6) {
      push({
        tone: 'warn',
        icon: 'split',
        title: 'Shorts trazem views, mas poucos inscritos',
        body: `Shorts são ${n((sl.shorts.countShare * 100), 0)}% dos envios e ${n((sl.shorts.viewShare * 100), 0)}% das views, porém convertem ${n(sl.shorts.subsPer1k, 1)} inscritos/mil views contra ${n(sl.longs.subsPer1k, 1)} dos vídeos longos.`,
        evidence: `${sl.shorts.count} Shorts · ${sl.longs.count} vídeos longos`,
      });
    } else if (ratio >= 0.9) {
      push({
        tone: 'pos',
        icon: 'split',
        title: 'Seus Shorts convertem quase como vídeos longos',
        body: `${n(sl.shorts.subsPer1k, 1)} inscritos/mil views nos Shorts contra ${n(sl.longs.subsPer1k, 1)} nos longos — proporção incomum e um ativo real do canal.`,
        evidence: `${sl.shorts.count} Shorts analisados`,
      });
    }
  }

  // --- Dependência de virais ---------------------------------------------
  const vpv = a.viewsPerVideo;
  if (vpv.median > 0 && vpv.p90 / vpv.median > 5) {
    push({
      tone: 'info',
      icon: 'wave',
      title: 'O canal depende de poucos vídeos virais',
      body: `Seu vídeo típico faz ${Math.round(vpv.median).toLocaleString('pt-BR')} views, mas o topo (p90) faz ${Math.round(vpv.p90).toLocaleString('pt-BR')} — ${n((vpv.p90 / vpv.median), 1)}× mais. A média de ${Math.round(vpv.mean).toLocaleString('pt-BR')} views por vídeo esconde essa concentração.`,
      evidence: `p10 ${Math.round(vpv.p10).toLocaleString('pt-BR')} · mediana ${Math.round(vpv.median).toLocaleString('pt-BR')} · p90 ${Math.round(vpv.p90).toLocaleString('pt-BR')}`,
    });
  }

  // --- Insights que só existem com dados privados ------------------------
  if (a.mom) {
    const m = a.mom.metrics;
    if (Math.abs(m.ctr.change) > 6 && a.mom.current.impressions > 1000) {
      push({
        tone: m.ctr.change > 0 ? 'pos' : 'neg',
        icon: 'cursor',
        title: `CTR das miniaturas ${m.ctr.change > 0 ? 'subiu' : 'caiu'} ${n(Math.abs(m.ctr.change), 1)}% no mês`,
        body: `De ${n(m.ctr.previous, 1)}% para ${n(m.ctr.current, 1)}% de cliques por impressão. Com ${Math.round(a.mom.current.impressions).toLocaleString('pt-BR')} impressões, cada 0,1 ponto de CTR equivale a ~${Math.round(a.mom.current.impressions * 0.001).toLocaleString('pt-BR')} views.`,
        evidence: `mês atual até o dia ${a.mom.dayOfMonth}, contra o mesmo trecho do mês anterior`,
      });
    }
    if (a.mom.current.subsLost > a.mom.current.subsGained * 0.35) {
      push({
        tone: 'warn',
        icon: 'alert',
        title: 'Perda de inscritos acima do normal',
        body: `${Math.round(a.mom.current.subsLost).toLocaleString('pt-BR')} cancelamentos contra ${Math.round(a.mom.current.subsGained).toLocaleString('pt-BR')} novos inscritos no mês — ${n(((a.mom.current.subsLost / Math.max(1, a.mom.current.subsGained)) * 100), 0)}% de atrito.`,
        evidence: `saldo líquido: ${Math.round(a.mom.current.netSubs).toLocaleString('pt-BR')}`,
      });
    }
  }

  // Ordena por relevância: alertas primeiro, elogios por último.
  const rank = { neg: 0, warn: 1, brand: 2, info: 3, pos: 4 };
  return out.sort((x, y) => rank[x.tone] - rank[y.tone]);
}

/* ==========================================================================
   8. Fachada — uma chamada devolve a análise completa
   ========================================================================== */

/**
 * `analyze(channel, { withPrivate })` é o único ponto que a UI precisa chamar.
 * Com `withPrivate: false` roda apenas o que a Data API pública permite.
 */
export function analyze(channel, { withPrivate = false } = {}) {
  const raw = channel.videos;
  const daily = withPrivate ? channel.analytics?.daily ?? null : null;
  const caps = dataCapabilities(raw);

  // A categoria do YouTube costuma jogar o canal inteiro num único balde. Com
  // menos de três grupos não há o que comparar, e aí os temas saem dos títulos.
  const byCategory = topicDistribution(raw);
  const useTitles = byCategory.length < 3;
  const videos = useTitles ? deriveTitleTopics(raw) : raw;

  // Tema inferido de título é sinal mais frágil que categoria declarada, então
  // exige amostra maior para valer como recomendação.
  const topicMinVideos = useTitles ? 5 : 3;
  const grouped = videos.filter((v) => v.topic !== 'Outros').length;

  const a = {
    channel,
    videos,
    capabilities: caps,
    topicBasis: useTitles ? 'títulos' : 'categorias',
    topicCoverage: { grouped, total: videos.length },
    categories: byCategory,
    viewsPerVideo: viewsPerVideo(videos),
    cadence: cadence(videos),
    format: shortsVsLong(videos),
    topics: topicSubscriberConversion(videos, {
      metric: caps.subsPerVideo ? 'subsGained' : 'engagement',
      minVideos: topicMinVideos,
    }),
    topicMix: topicDistribution(videos),
    tags: tagPerformance(videos),
    duration: durationAnalysis(videos),
    publishTime: bestPublishTime(videos, { field: caps.early48h ? 'views48h' : 'views' }),
    frequency: idealFrequency(videos, daily),
    monthly: monthlyEvolution(videos),
    score: channelScore(channel),
    ageDays: Math.round(days(Date.now(), channel.publishedAt)),
  };

  if (withPrivate && daily) {
    a.daily = daily;
    a.mom = monthOverMonth(daily);
    a.revenue = revenueMetrics(daily);
    a.dimensions = channel.analytics.dimensions;
  }

  a.insights = buildInsights(channel, a);
  return a;
}
