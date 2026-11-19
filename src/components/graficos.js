// Gráficos em SVG puro: Curva S do BM, fornos por BM e produção diária por
// etapa. Linhas finas, um eixo só, legenda e dica ao passar o mouse.
import { el, svg } from '../base/dom.js';
import { ETAPAS } from '../data/obra.js';
import { curta } from '../lib/datas.js';

/**
 * O gráfico é redesenhado na largura real do cartão (o texto fica sempre do
 * mesmo tamanho, em vez de encolher junto com o SVG).
 */
export function responsivo(construir, rotulo, { largMin = 320 } = {}) {
  const caixa = el('div', { class: 'grafico', role: 'img', 'aria-label': rotulo });
  let ultimo = 0;
  const ro = new ResizeObserver((entradas) => {
    if (!caixa.isConnected) return ro.disconnect();
    const w = Math.round(entradas[0].contentRect.width);
    if (!w || Math.abs(w - ultimo) < 4) return;
    ultimo = w;
    caixa.replaceChildren(construir(Math.max(largMin, w)));
  });
  ro.observe(caixa);
  return caixa;
}
const pct = (v) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

let dica;
export function mostrarDica(evt, titulo, linhas) {
  if (!dica) {
    dica = el('div', { class: 'dica-grafico', role: 'tooltip' });
    document.body.appendChild(dica);
  }
  dica.replaceChildren(
    el('strong', {}, titulo),
    ...linhas.map(([rot, val, cor]) => el('div', {}, [el('span', {}, [cor ? el('i', { style: { background: cor } }) : null, rot]), el('b', {}, val)]))
  );
  const x = Math.min(evt.clientX + 14, innerWidth - dica.offsetWidth - 10);
  const y = Math.max(10, evt.clientY - dica.offsetHeight - 12);
  dica.style.left = `${x}px`;
  dica.style.top = `${y}px`;
  dica.style.opacity = '1';
}
export const esconderDica = () => dica && (dica.style.opacity = '0');

function eixoY(W, h, m, maxV, passos, fmt) {
  const nos = [];
  for (let i = 0; i <= passos; i++) {
    const v = (maxV / passos) * i;
    const y = h - m.b - ((h - m.t - m.b) * v) / maxV;
    nos.push(svg('line', { class: 'grade', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    nos.push(svg('text', { class: 'eixo', x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, fmt(v)));
  }
  return nos;
}

/** Fornos revestidos por BM contra o previsto do BM (planilha da Curva S). */
export function graficoBms(lista, { altura = 220 } = {}) {
  return el('div', { class: 'pilha' }, [
    el('div', { class: 'legenda-grafico' }, [
      el('span', {}, [el('i', { style: { background: 'var(--bg-4)', outline: '1px solid var(--border-strong)', height: '10px', width: '12px' } }), 'Previsto do BM']),
      el('span', {}, [el('i', { style: { background: 'var(--accent-500)', height: '10px', width: '12px' } }), 'Revestidos'])
    ]),
    responsivo((W) => svgBms(lista, W, altura), 'Fornos revestidos por BM')
  ]);
}

function svgBms(lista, W, altura) {
  const h = altura;
  const m = { t: 18, r: 12, b: 30, l: 34 };
  const topo = Math.max(6, Math.ceil(Math.max(...lista.map((b) => Math.max(b.meta, b.realizado))) / 6) * 6);
  const larg = (W - m.l - m.r) / Math.max(1, lista.length);
  const barra = Math.min(26, (larg - 12) / 2);
  const y = (v) => h - m.b - ((h - m.t - m.b) * v) / topo;
  const nos = [...eixoY(W, h, m, topo, 6, (v) => String(Math.round(v)))];
  const r = 4;
  const bar = (v, x0, cor, contorno) => {
    if (!v) return null;
    const yy = y(v);
    const d = `M${x0},${h - m.b}V${yy + r}Q${x0},${yy} ${x0 + r},${yy}H${x0 + barra - r}Q${x0 + barra},${yy} ${x0 + barra},${yy + r}V${h - m.b}Z`;
    return svg('path', { d, fill: cor, stroke: contorno || 'none', 'stroke-width': contorno ? 1.2 : 0 });
  };
  lista.forEach((b, i) => {
    const c = m.l + larg * i + larg / 2;
    nos.push(bar(b.meta, c - barra - 1, 'var(--bg-4)', 'var(--border-strong)'));
    nos.push(bar(b.realizado, c + 1, b.realizado >= b.meta ? 'var(--e-massa1200)' : 'var(--accent-500)'));
    nos.push(svg('text', { class: 'rotulo', x: c + 1 + barra / 2, y: y(b.realizado) - 5, 'text-anchor': 'middle' }, String(b.realizado)));
    nos.push(svg('text', { class: `eixo${b.atual ? ' forte' : ''}`, x: c, y: h - 9, 'text-anchor': 'middle' }, b.rotulo));
    nos.push(svg('rect', {
      class: 'alvo', x: c - larg / 2, y: m.t, width: larg, height: h - m.t - m.b,
      onmousemove: (e) => mostrarDica(e, `BM ${b.rotulo} · ${curta(b.inicio)} a ${curta(b.fim)}`, [
        ['Previsto', `${b.meta} fornos`, 'var(--bg-4)'],
        ['Revestidos', `${b.realizado} fornos`, 'var(--accent-500)'],
        ['Aderência', b.meta ? pct(b.realizado / b.meta) : '-']
      ]),
      onmouseleave: esconderDica
    }));
  });
  return svg('svg', { viewBox: `0 0 ${W} ${h}`, width: W, height: h }, nos);
}

/** Etapas concluídas por dia (primárias), empilhadas na ordem do serviço. */
export function graficoProducao(dados, { altura = 220 } = {}) {
  return responsivo((W) => svgProducao(dados, W, altura), 'Primárias por etapa, por dia');
}

function svgProducao({ dias, serie }, W, altura) {
  const h = altura;
  const m = { t: 14, r: 12, b: 30, l: 34 };
  const totais = dias.map((_, i) => serie.reduce((s, sr) => s + sr[i], 0));
  const topo = Math.max(10, Math.ceil(Math.max(...totais) / 10) * 10);
  const larg = (W - m.l - m.r) / dias.length;
  const bw = Math.max(4, larg - 4);
  const y = (v) => ((h - m.t - m.b) * v) / topo;
  const nos = [...eixoY(W, h, m, topo, 4, (v) => String(Math.round(v)))];
  dias.forEach((d, i) => {
    const x0 = m.l + larg * i + (larg - bw) / 2;
    let base = h - m.b;
    serie.forEach((sr, e) => {
      const v = sr[i];
      if (!v) return;
      const alt = y(v);
      // 2px de respiro entre segmentos, na cor do fundo
      nos.push(svg('rect', { x: x0, y: base - alt, width: bw, height: Math.max(1, alt - 2), rx: 2, fill: ETAPAS[e].cor }));
      base -= alt;
    });
    if (i % Math.max(1, Math.ceil(44 / larg)) === 0) nos.push(svg('text', { class: 'eixo', x: x0 + bw / 2, y: h - 9, 'text-anchor': 'middle' }, curta(d)));
    nos.push(svg('rect', {
      class: 'alvo', x: m.l + larg * i, y: m.t, width: larg, height: h - m.t - m.b,
      onmousemove: (e) => mostrarDica(e, curta(d), [...ETAPAS.map((et, k) => [et.curto, String(serie[k][i]), et.cor]).filter((l) => l[1] !== '0'), ['Total', `${totais[i]} primárias`]]),
      onmouseleave: esconderDica
    }));
  });
  return svg('svg', { viewBox: `0 0 ${W} ${h}`, width: W, height: h }, nos);
}
