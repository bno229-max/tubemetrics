/**
 * charts.js — Gráficos em SVG puro, sem biblioteca externa.
 *
 * Por quê à mão: a diretriz §5 pede código extremamente leve rodando no
 * cliente. Uma lib de gráficos custa 40–150 kB só para desenhar linha, barra e
 * rosca — aqui isso cabe em poucos kilobytes e ainda herda as variáveis CSS do
 * tema, então o modo escuro funciona sem configuração paralela.
 *
 * Todos os gráficos redesenham em `ResizeObserver`, então são responsivos de
 * verdade (nada de esticar um viewBox e borrar o texto).
 */

import { esc } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export const SERIES_COLORS = () => [
  cssVar('--s1', '#ff0033'), cssVar('--s2', '#6f4bd8'), cssVar('--s3', '#1a9e8f'),
  cssVar('--s4', '#e08b16'), cssVar('--s5', '#3a76d8'), cssVar('--s6', '#c2418e'),
];

/** Escala de ticks "redondos" (1, 2, 5 × 10^n). */
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

/**
 * Redesenha o gráfico sempre que o container mudar de largura.
 *
 * A primeira pintura é SÍNCRONA de propósito. Agendar tudo em
 * `requestAnimationFrame` parece elegante, mas o navegador não entrega frames
 * quando a aba está oculta ou não está compondo — e aí o gráfico simplesmente
 * nunca aparece. Redesenhos de resize continuam adiados, com `setTimeout`, que
 * dispara independentemente de pintura.
 */
function mount(container, draw) {
  container.innerHTML = '';
  const tip = document.createElement('div');
  tip.className = 'tip';
  container.appendChild(tip);

  let scheduled = 0;
  let lastWidth = -1;
  const paint = (force = true) => {
    scheduled = 0;
    const w = container.clientWidth;
    if (w < 40 || (!force && w === lastWidth)) return;
    lastWidth = w;
    [...container.children].forEach((c) => { if (c !== tip) c.remove(); });
    draw(w, tip);
  };
  // O ResizeObserver entrega uma notificação inicial ao observar; em vez de
  // "pular a primeira" (que às vezes engole um resize real), só repintamos
  // quando a largura de fato mudou.
  const render = () => {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => paint(false), 60);
  };

  paint();
  if (container._chartObs) container._chartObs.disconnect();
  const obs = new ResizeObserver(render);
  obs.observe(container);
  container._chartObs = obs;
  container._chartRedraw = paint;
  return paint;
}

/** Redesenha todos os gráficos montados (usado ao trocar o tema). */
export function redrawAll(root = document) {
  root.querySelectorAll('.chart').forEach((c) => c._chartRedraw && c._chartRedraw());
}

function positionTip(tip, container, x, y, html) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const cw = container.clientWidth;
  const tw = tip.offsetWidth;
  const left = Math.min(Math.max(x, tw / 2 + 4), cw - tw / 2 - 4);
  tip.style.left = `${left}px`;
  tip.style.top = `${y}px`;
}

/* ==========================================================================
   Linha / área
   ========================================================================== */

/**
 * @param {object} o
 * @param {{name,color?,values:number[],dashed?:boolean,area?:boolean}[]} o.series
 * @param {string[]} o.labels  rótulos do eixo X (mesmo comprimento das séries)
 */
export function lineChart(container, o) {
  const { series, labels, height = 240, formatY = String, formatValue = String, yZero = true } = o;
  container.classList.add('chart');

  return mount(container, (w, tip) => {
    const pad = { l: 48, r: 14, t: 14, b: 26 };
    const iw = Math.max(10, w - pad.l - pad.r);
    const ih = height - pad.t - pad.b;
    const colors = SERIES_COLORS();
    const n = labels.length;

    const allVals = series.flatMap((s) => s.values).filter(Number.isFinite);
    const rawMax = Math.max(...allVals, 0);
    const rawMin = yZero ? 0 : Math.min(...allVals, 0);
    const ticks = niceTicks(rawMax || 1, 4);
    const yMax = Math.max(ticks[ticks.length - 1], rawMax || 1);
    const yMin = rawMin;

    const X = (i) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

    const svg = el('svg', { viewBox: `0 0 ${w} ${height}`, width: w, height, role: 'img' });

    // grade + eixo Y
    ticks.forEach((t) => {
      svg.appendChild(el('line', { class: 'grid-line', x1: pad.l, x2: w - pad.r, y1: Y(t), y2: Y(t) }));
      const lbl = el('text', { class: 'axis-txt', x: pad.l - 8, y: Y(t) + 3.5, 'text-anchor': 'end' });
      lbl.textContent = formatY(t);
      svg.appendChild(lbl);
    });

    // eixo X — no máximo 7 rótulos, sempre incluindo o último
    const step = Math.max(1, Math.ceil(n / 7));
    labels.forEach((l, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const t = el('text', { class: 'axis-txt', x: X(i), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' });
      t.textContent = l;
      svg.appendChild(t);
    });

    series.forEach((s, si) => {
      const color = s.color || colors[si % colors.length];
      const pts = s.values.map((v, i) => [X(i), Y(v)]);
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

      if (s.area !== false && si === 0 && n > 1) {
        const gid = `grad-${Math.random().toString(36).slice(2, 8)}`;
        const defs = el('defs');
        const g = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        g.appendChild(el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.22 }));
        g.appendChild(el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
        defs.appendChild(g);
        svg.appendChild(defs);
        svg.appendChild(el('path', { d: `${d} L${X(n - 1)} ${Y(yMin)} L${X(0)} ${Y(yMin)} Z`, fill: `url(#${gid})` }));
      }

      svg.appendChild(el('path', {
        d, fill: 'none', stroke: color, 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': s.dashed ? '5 4' : null,
        opacity: s.dashed ? 0.75 : 1,
      }));
    });

    // camada de interação
    const hoverLine = el('line', { class: 'hover-line', y1: pad.t, y2: pad.t + ih, opacity: 0 });
    svg.appendChild(hoverLine);
    const dots = series.map((s, si) =>
      el('circle', { r: 4, fill: cssVar('--surface', '#fff'), stroke: s.color || colors[si % colors.length], 'stroke-width': 2.5, opacity: 0 })
    );
    dots.forEach((d) => svg.appendChild(d));

    const cap = el('rect', { x: pad.l, y: pad.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' });
    svg.appendChild(cap);

    const onMove = (ev) => {
      const box = svg.getBoundingClientRect();
      const rel = ((ev.clientX - box.left) * (w / box.width) - pad.l) / (iw || 1);
      const i = Math.round(Math.min(1, Math.max(0, rel)) * (n - 1));
      hoverLine.setAttribute('x1', X(i));
      hoverLine.setAttribute('x2', X(i));
      hoverLine.setAttribute('opacity', 1);
      dots.forEach((dot, si) => {
        dot.setAttribute('cx', X(i));
        dot.setAttribute('cy', Y(series[si].values[i]));
        dot.setAttribute('opacity', 1);
      });
      const rows = series
        .map((s, si) => `<div class="tr"><span class="l"><i style="background:${s.color || colors[si % colors.length]}"></i>${esc(s.name)}</span><b>${formatValue(s.values[i], s)}</b></div>`)
        .join('');
      positionTip(tip, container, X(i) * (box.width / w), Y(series[0].values[i]) * (box.height / height) - 8, `<div class="th">${labels[i]}</div>${rows}`);
    };
    const onLeave = () => {
      tip.classList.remove('on');
      hoverLine.setAttribute('opacity', 0);
      dots.forEach((d) => d.setAttribute('opacity', 0));
    };
    cap.addEventListener('pointermove', onMove);
    cap.addEventListener('pointerleave', onLeave);

    container.appendChild(svg);
  });
}

/* ==========================================================================
   Barras verticais (simples ou agrupadas)
   ========================================================================== */

export function barChart(container, o) {
  const { labels, series, height = 240, formatY = String, formatValue = String, highlightIndex = -1 } = o;
  container.classList.add('chart');

  return mount(container, (w, tip) => {
    const pad = { l: 48, r: 14, t: 14, b: 28 };
    const iw = Math.max(10, w - pad.l - pad.r);
    const ih = height - pad.t - pad.b;
    const colors = SERIES_COLORS();
    const n = labels.length;

    const rawMax = Math.max(...series.flatMap((s) => s.values), 0);
    const ticks = niceTicks(rawMax || 1, 4);
    const yMax = Math.max(ticks[ticks.length - 1], rawMax || 1);
    const Y = (v) => pad.t + ih - (v / yMax) * ih;

    const groupW = iw / n;
    const inner = Math.min(groupW * 0.68, 46);
    const barW = Math.max(3, inner / series.length);

    const svg = el('svg', { viewBox: `0 0 ${w} ${height}`, width: w, height });

    ticks.forEach((t) => {
      svg.appendChild(el('line', { class: 'grid-line', x1: pad.l, x2: w - pad.r, y1: Y(t), y2: Y(t) }));
      const lbl = el('text', { class: 'axis-txt', x: pad.l - 8, y: Y(t) + 3.5, 'text-anchor': 'end' });
      lbl.textContent = formatY(t);
      svg.appendChild(lbl);
    });

    const step = Math.max(1, Math.ceil(n / 9));
    labels.forEach((l, i) => {
      if (i % step !== 0 && i !== n - 1) return;
      const t = el('text', { class: 'axis-txt', x: pad.l + groupW * (i + 0.5), y: height - 8, 'text-anchor': 'middle' });
      t.textContent = l;
      svg.appendChild(t);
    });

    labels.forEach((_, i) => {
      const gx = pad.l + groupW * (i + 0.5) - inner / 2;
      series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const h = Math.max(1, ih - (Y(v) - pad.t));
        const color = s.color || colors[si % colors.length];
        const rect = el('rect', {
          x: gx + si * barW, y: Y(v), width: Math.max(2, barW - (series.length > 1 ? 1.5 : 0)), height: h,
          rx: Math.min(3, barW / 2), fill: color,
          opacity: highlightIndex >= 0 && i !== highlightIndex ? 0.35 : 0.92,
          style: 'transition:opacity .12s',
        });
        rect.addEventListener('pointerenter', () => {
          rect.setAttribute('opacity', 1);
          const box = svg.getBoundingClientRect();
          const rows = series.map((ss, sj) =>
            `<div class="tr"><span class="l"><i style="background:${ss.color || colors[sj % colors.length]}"></i>${esc(ss.name)}</span><b>${formatValue(ss.values[i], ss)}</b></div>`
          ).join('');
          positionTip(tip, container, (gx + inner / 2) * (box.width / w), Y(Math.max(...series.map((ss) => ss.values[i]))) * (box.height / height) - 8, `<div class="th">${labels[i]}</div>${rows}`);
        });
        rect.addEventListener('pointerleave', () => {
          rect.setAttribute('opacity', highlightIndex >= 0 && i !== highlightIndex ? 0.35 : 0.92);
          tip.classList.remove('on');
        });
        svg.appendChild(rect);
      });
    });

    container.appendChild(svg);
  });
}

/* ==========================================================================
   Barras horizontais (rankings, distribuições)
   ========================================================================== */

export function hBarChart(container, o) {
  const { rows, formatValue = String, rowHeight = 32, labelWidth = 132, colorFor } = o;
  container.classList.add('chart');

  return mount(container, (w, tip) => {
    const lw = Math.min(labelWidth, Math.max(80, w * 0.36));
    const pad = { l: lw, r: 58, t: 4, b: 4 };
    const iw = Math.max(20, w - pad.l - pad.r);
    const height = rows.length * rowHeight + pad.t + pad.b;
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;
    const colors = SERIES_COLORS();

    const svg = el('svg', { viewBox: `0 0 ${w} ${height}`, width: w, height });

    rows.forEach((r, i) => {
      const y = pad.t + i * rowHeight;
      const bh = Math.min(16, rowHeight - 12);
      const bw = Math.max(2, (r.value / max) * iw);
      const color = r.color || (colorFor ? colorFor(r, i) : colors[i % colors.length]);

      const lbl = el('text', { class: 'axis-txt', x: lw - 10, y: y + rowHeight / 2 + 3.5, 'text-anchor': 'end', style: 'font-size:12px' });
      lbl.setAttribute('fill', cssVar('--text-2', '#4d5563'));
      lbl.textContent = r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label;
      svg.appendChild(lbl);

      svg.appendChild(el('rect', { x: pad.l, y: y + (rowHeight - bh) / 2, width: iw, height: bh, rx: bh / 2, fill: cssVar('--surface-3', '#eceef1') }));
      const bar = el('rect', { x: pad.l, y: y + (rowHeight - bh) / 2, width: bw, height: bh, rx: bh / 2, fill: color, style: 'transition:opacity .12s' });
      svg.appendChild(bar);

      const val = el('text', { class: 'axis-txt', x: w - 8, y: y + rowHeight / 2 + 3.5, 'text-anchor': 'end', style: 'font-size:12px;font-variant-numeric:tabular-nums' });
      val.setAttribute('fill', cssVar('--text', '#10131a'));
      val.textContent = formatValue(r.value, r);
      svg.appendChild(val);

      const hit = el('rect', { x: 0, y, width: w, height: rowHeight, fill: 'transparent' });
      hit.addEventListener('pointerenter', () => {
        bar.setAttribute('opacity', 0.75);
        if (!r.tip) return;
        const box = svg.getBoundingClientRect();
        positionTip(tip, container, (pad.l + bw) * (box.width / w), (y + 2) * (box.height / height), `<div class="th">${esc(r.label)}</div>${r.tip}`);
      });
      hit.addEventListener('pointerleave', () => { bar.setAttribute('opacity', 1); tip.classList.remove('on'); });
      svg.appendChild(hit);
    });

    container.appendChild(svg);
  });
}

/* ==========================================================================
   Rosca
   ========================================================================== */

export function donutChart(container, o) {
  const { data, size = 168, thickness = 22, centerTop = '', centerSub = '' } = o;
  container.classList.add('chart');

  return mount(container, (w, tip) => {
    const s = Math.min(size, w);
    const r = s / 2 - thickness / 2 - 2;
    const c = s / 2;
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    const colors = SERIES_COLORS();

    const svg = el('svg', { viewBox: `0 0 ${s} ${s}`, width: s, height: s });
    svg.style.margin = '0 auto';

    let angle = -Math.PI / 2;
    data.forEach((d, i) => {
      const frac = d.value / total;
      const sweep = frac * Math.PI * 2;
      const a0 = angle;
      const a1 = angle + sweep - Math.min(0.035, sweep * 0.18); // respiro entre fatias
      angle += sweep;
      const p = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
      const [x0, y0] = p(a0);
      const [x1, y1] = p(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const path = el('path', {
        d: `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
        fill: 'none', stroke: d.color || colors[i % colors.length],
        'stroke-width': thickness, 'stroke-linecap': 'round',
        style: 'transition:opacity .12s',
      });
      path.addEventListener('pointerenter', () => {
        path.setAttribute('opacity', 0.72);
        const box = svg.getBoundingClientRect();
        const [mx, my] = p((a0 + a1) / 2);
        positionTip(tip, container, mx * (box.width / s) + (box.left - container.getBoundingClientRect().left), my * (box.height / s) - 6,
          `<div class="th">${esc(d.label)}</div><div class="tr"><span class="l">Participação</span><b>${(frac * 100).toFixed(1)}%</b></div>`);
      });
      path.addEventListener('pointerleave', () => { path.setAttribute('opacity', 1); tip.classList.remove('on'); });
      svg.appendChild(path);
    });

    if (centerTop) {
      const t1 = el('text', { x: c, y: c - 2, 'text-anchor': 'middle', style: 'font-size:20px;font-weight:660;letter-spacing:-.03em;font-variant-numeric:tabular-nums' });
      t1.setAttribute('fill', cssVar('--text', '#10131a'));
      t1.textContent = centerTop;
      svg.appendChild(t1);
      const t2 = el('text', { x: c, y: c + 15, 'text-anchor': 'middle', style: 'font-size:11px;font-weight:600;letter-spacing:.04em' });
      t2.setAttribute('fill', cssVar('--text-3', '#79808f'));
      t2.textContent = centerSub;
      svg.appendChild(t2);
    }

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.justifyContent = 'center';
    wrap.appendChild(svg);
    container.appendChild(wrap);
  });
}

/* ==========================================================================
   Radar (score de performance de um vídeo)
   ========================================================================== */

/**
 * @param {object} o
 * @param {{label:string, value:number}[][]} o.series  cada item é um conjunto
 *   de eixos (mesma ordem/rótulos) — um vídeo por série, para permitir
 *   sobrepor "este vídeo" contra "média do canal", por exemplo.
 * @param {string[]} [o.names]  nome de cada série, para a legenda/tooltip.
 */
export function radarChart(container, o) {
  const { series, names = [], size = 260, max = 100, rings = 4 } = o;
  container.classList.add('chart');

  return mount(container, (w, tip) => {
    const s = Math.min(size, w);
    const pad = 34; // espaço para os rótulos dos eixos
    const r = s / 2 - pad;
    const cx = w / 2;
    const cy = s / 2;
    const axes = series[0] || [];
    const n = axes.length;
    const colors = SERIES_COLORS();

    // Ângulo do eixo i: começa no topo (-90°) e distribui em sentido horário.
    const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
    const point = (i, value) => {
      const a = angle(i);
      const dist = (clampRadar(value, 0, max) / max) * r;
      return [cx + dist * Math.cos(a), cy + dist * Math.sin(a)];
    };

    const svg = el('svg', { viewBox: `0 0 ${w} ${s}`, width: w, height: s });

    // Anéis de referência + eixos, do centro até a borda.
    for (let ring = 1; ring <= rings; ring++) {
      const frac = ring / rings;
      const pts = axes.map((_, i) => {
        const a = angle(i);
        return `${cx + r * frac * Math.cos(a)},${cy + r * frac * Math.sin(a)}`;
      });
      svg.appendChild(el('polygon', { points: pts.join(' '), fill: 'none', stroke: cssVar('--border', '#e4e6ea'), 'stroke-width': 1 }));
    }
    axes.forEach((axis, i) => {
      const [x, y] = point(i, max);
      svg.appendChild(el('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: cssVar('--border', '#e4e6ea'), 'stroke-width': 1 }));

      // Rótulo do eixo, ancorado para fora do círculo.
      const a = angle(i);
      const lx = cx + (r + 20) * Math.cos(a);
      const ly = cy + (r + 20) * Math.sin(a);
      const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
      const label = el('text', { class: 'axis-txt', x: lx, y: ly + 4, 'text-anchor': anchor, style: 'font-size:11.5px;font-weight:560' });
      label.setAttribute('fill', cssVar('--text-2', '#4d5563'));
      label.textContent = axis.label;
      svg.appendChild(label);
    });

    // Um polígono por série, com a mesma camada de hover das outras cartas.
    const dotsAll = [];
    series.forEach((axesSet, si) => {
      const color = names.length > 1 ? colors[si % colors.length] : cssVar('--s1', '#ff0033');
      const pts = axesSet.map((axis, i) => point(i, axis.value));
      svg.appendChild(el('polygon', {
        points: pts.map(([x, y]) => `${x},${y}`).join(' '),
        fill: color, 'fill-opacity': names.length > 1 ? 0.14 : 0.16,
        stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round',
      }));
      pts.forEach(([x, y], i) => {
        const dot = el('circle', { cx: x, cy: y, r: 3.5, fill: color, stroke: cssVar('--surface', '#fff'), 'stroke-width': 1.5, style: 'cursor:pointer' });
        dot.addEventListener('pointerenter', () => {
          const box = svg.getBoundingClientRect();
          const rows = series.map((set, sj) => `
            <div class="tr"><span class="l">${names[sj] ? `<i style="background:${names.length > 1 ? colors[sj % colors.length] : cssVar('--s1', '#ff0033')}"></i>${esc(names[sj])}` : ''}</span>
            <b>${set[i].raw != null ? formatAxisValue(set[i].raw) : `${set[i].value}/100`}</b></div>`).join('');
          positionTip(tip, container, x * (box.width / w), y * (box.height / s) - 8, `<div class="th">${axesSet[i].label}</div>${rows}`);
        });
        dot.addEventListener('pointerleave', () => tip.classList.remove('on'));
        dotsAll.push(dot);
      });
    });
    dotsAll.forEach((d) => svg.appendChild(d));

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.justifyContent = 'center';
    wrap.appendChild(svg);
    container.appendChild(wrap);
  });
}

const clampRadar = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Uma razão pequena vira "%", uma razão perto de 1 vira "×" — o que for mais legível. */
function formatAxisValue(raw) {
  if (raw <= 1.5) return `${(raw * 100).toFixed(1)}%`;
  return `${raw.toFixed(2)}×`;
}

/* ==========================================================================
   Arco de pontuação (nota do canal)
   ========================================================================== */

export function scoreDial(container, { value, max = 100, size = 148 }) {
  container.innerHTML = '';
  const s = size;
  const r = s / 2 - 12;
  const c = s / 2;
  const START = Math.PI * 0.75;
  const SWEEP = Math.PI * 1.5;
  const frac = Math.max(0, Math.min(1, value / max));

  const arc = (a0, a1) => {
    const p = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };

  const svg = el('svg', { viewBox: `0 0 ${s} ${s}`, width: s, height: s });
  svg.appendChild(el('path', { d: arc(START, START + SWEEP), fill: 'none', stroke: cssVar('--surface-3', '#eceef1'), 'stroke-width': 12, 'stroke-linecap': 'round' }));

  const color = value >= 70 ? cssVar('--pos', '#16875a') : value >= 55 ? cssVar('--info', '#3a5ccc') : value >= 40 ? cssVar('--warn', '#a8690b') : cssVar('--neg', '#c02a37');
  const fg = el('path', {
    d: arc(START, START + SWEEP * Math.max(frac, 0.001)),
    fill: 'none', stroke: color, 'stroke-width': 12, 'stroke-linecap': 'round',
  });
  const len = SWEEP * r * frac;
  fg.style.strokeDasharray = `${len} ${len}`;
  fg.style.strokeDashoffset = len;
  svg.appendChild(fg);
  container.appendChild(svg);
  // `setTimeout` e não `requestAnimationFrame`: se a aba não estiver compondo
  // frames, o arco ficaria permanentemente invisível (dashoffset cheio).
  setTimeout(() => {
    fg.style.transition = 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)';
    fg.style.strokeDashoffset = 0;
  }, 30);
  return color;
}

/* ==========================================================================
   Sparkline (string SVG, para embutir em KPI)
   ========================================================================== */

export function sparkline(values, { width = 120, height = 46, color } = {}) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const X = (i) => (i / (v.length - 1)) * width;
  const Y = (n) => height - 4 - ((n - min) / span) * (height - 10);
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(n).toFixed(1)}`).join(' ');
  const stroke = color || cssVar('--s1', '#ff0033');
  const id = `sp${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${stroke}" stop-opacity=".3"/><stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${d} L${width} ${height} L0 ${height} Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
