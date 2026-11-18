// Curva S igual à da planilha "Curva S - Rev": por semana, barras de previsto
// (preto), replanejado (roxo) e realizado (azul-claro); linhas acumuladas no
// eixo da direita; rótulo em cada ponto; semanas agrupadas por BM; e o
// retângulo tracejado da SEMANA ATUAL. Em nº de fornos ou em percentual.
import { el, svg } from '../base/dom.js';
import { responsivo, mostrarDica, esconderDica } from './graficos.js';
import { curta } from '../lib/datas.js';

export const CORES_CURVA = { previsto: '#000000', replanejado: '#7030A0', realizado: '#00B0F0', atual: '#ED7D31' };
const fmtN = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const fmtP = (v) => (v == null ? '' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

/**
 * curva: resultado de curvaContrato(calc).
 * modo: 'numero' (nº de fornos) ou 'percentual' (do total previsto).
 */
export function graficoCurvaS(curva, { modo = 'numero', altura = 420, titulo = null, atualizadoEm = null, compacto = false } = {}) {
  const series = [
    { id: 'previsto', nome: 'Previsto', cor: CORES_CURVA.previsto },
    curva.comReplanejado ? { id: 'replanejado', nome: 'Replanejado', cor: CORES_CURVA.replanejado } : null,
    { id: 'realizado', nome: 'Realizado', cor: CORES_CURVA.realizado }
  ].filter(Boolean);
  const legenda = el('div', { class: 'cs-legenda' }, [
    ...series.map((s) => el('span', {}, [el('i', { class: 'barra', style: { background: s.cor } }), s.nome])),
    ...series.map((s) => el('span', {}, [el('i', { class: 'linha', style: { background: s.cor } }), el('b', { style: { borderColor: s.cor } }), `${s.nome} acum.`]))
  ]);
  const grafico = responsivo((W) => desenhar(curva, series, W, altura, modo, compacto), 'Curva S do contrato', { largMin: compacto ? 640 : 900 });
  return el('figure', { class: `curva-excel${compacto ? ' compacta' : ''}` }, [
    compacto ? null : el('header', { class: 'cs-cab' }, [
      el('img', { src: './marcas/reframax.png', alt: 'Reframax', class: 'cs-logo' }),
      el('div', { class: 'cs-titulo' }, [
        el('strong', {}, titulo || `Curva S - Substituição das Primárias e Revestimento dos Fornos da Bateria B na Coqueria (${modo === 'percentual' ? 'Percentual' : 'Nº Absoluto de Fornos'})`),
        atualizadoEm ? el('span', { class: 'cs-atualizado' }, `ATUALIZADO EM: ${atualizadoEm}`) : null
      ]),
      el('img', { src: './marcas/ternium.png', alt: 'Ternium', class: 'cs-logo' })
    ]),
    el('div', { class: 'cs-rolagem' }, grafico),
    legenda
  ]);
}

function desenhar(curva, series, W, h, modo, compacto) {
  const { pontos, bms, total } = curva;
  const n = pontos.length;
  const pct = modo === 'percentual';
  const v = (x) => (x == null ? null : pct ? x / total : x);
  const m = { t: compacto ? 26 : 34, r: 54, b: compacto ? 58 : 74, l: 52 };
  const larg = (W - m.l - m.r) / Math.max(1, n);
  const cx = (i) => m.l + larg * i + larg / 2;
  // eixo da esquerda: barras da semana
  const maiorBarra = Math.max(...pontos.flatMap((p) => series.map((s) => v(p[s.id]) || 0)), pct ? 0.05 : 5);
  const passoE = pct ? niceStep(maiorBarra * 1.35 / 5, true) : niceStep(maiorBarra * 1.35 / 5);
  const topoE = passoE * 5;
  const yE = (x) => h - m.b - ((h - m.t - m.b) * x) / topoE;
  // eixo da direita: acumulados (como no Excel, começa abaixo de zero para as
  // linhas ficarem acima das barras)
  const topoAcum = v(Math.max(total, ...pontos.map((p) => Math.max(p.previstoAcum || 0, p.realizadoAcum || 0, p.replanejadoAcum || 0))));
  const maxD = topoAcum * 1.12;
  const minD = -topoAcum * 0.55;
  const yD = (x) => h - m.b - ((h - m.t - m.b) * (x - minD)) / (maxD - minD);
  const nos = [];
  // grade e eixo da esquerda
  for (let k = 0; k <= 5; k++) {
    const val = passoE * k;
    nos.push(svg('line', { class: 'cs-grade', x1: m.l, x2: W - m.r, y1: yE(val), y2: yE(val) }));
    nos.push(svg('text', { class: 'cs-eixo', x: m.l - 8, y: yE(val) + 4, 'text-anchor': 'end' }, pct ? fmtP(val) : fmtN(val)));
  }
  nos.push(svg('text', { class: 'cs-eixo-titulo', x: 14, y: (h - m.b + m.t) / 2, transform: `rotate(-90 14 ${(h - m.b + m.t) / 2})`, 'text-anchor': 'middle' }, pct ? 'Percentual' : 'Quantidade (Fornos)'));
  // eixo da direita
  const passoD = niceStep((maxD - Math.max(0, minD)) / 5, pct);
  for (let val = 0; val <= maxD; val += passoD) nos.push(svg('text', { class: 'cs-eixo', x: W - m.r + 8, y: yD(val) + 4 }, pct ? fmtP(val) : fmtN(val)));
  // semana atual: retângulo tracejado, como na planilha
  const iAtual = pontos.findIndex((p) => p.atual);
  if (iAtual >= 0) {
    nos.push(svg('rect', { class: 'cs-atual', x: m.l + larg * iAtual + 1, y: m.t - 18, width: larg - 2, height: h - m.b - m.t + 18 + 36, rx: 2 }));
    nos.push(svg('rect', { class: 'cs-atual-rot', x: cx(iAtual) - 44, y: m.t - 32, width: 88, height: 16 }));
    nos.push(svg('text', { class: 'cs-atual-txt', x: cx(iAtual), y: m.t - 20, 'text-anchor': 'middle' }, 'SEMANA ATUAL'));
  }
  // barras de cada semana
  const nb = series.length;
  const bw = Math.max(3, Math.min(18, (larg - 6) / nb));
  pontos.forEach((p, i) => {
    series.forEach((s, k) => {
      const val = v(p[s.id]);
      if (val == null) return;
      const x0 = cx(i) - (bw * nb) / 2 + k * bw;
      const y0 = yE(val);
      if (val > 0) nos.push(svg('rect', { x: x0, y: y0, width: bw - 1, height: h - m.b - y0, fill: s.cor }));
      if (!compacto || val > 0) nos.push(svg('text', { class: 'cs-rotulo', x: x0 + (bw - 1) / 2, y: y0 - 3, 'text-anchor': 'middle' }, pct ? fmtP(val) : fmtN(val)));
    });
  });
  // linhas acumuladas
  for (const s of series) {
    const campo = `${s.id}Acum`;
    let d = '';
    const marcas = [];
    pontos.forEach((p, i) => {
      const val = v(p[campo]);
      if (val == null) return;
      d += `${d ? 'L' : 'M'}${cx(i).toFixed(1)},${yD(val).toFixed(1)}`;
      marcas.push([i, val]);
    });
    if (!d) continue;
    nos.push(svg('path', { d, fill: 'none', stroke: s.cor, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
    for (const [i, val] of marcas) {
      nos.push(svg('circle', { cx: cx(i), cy: yD(val), r: 3.2, fill: s.cor, stroke: '#fff', 'stroke-width': 1 }));
      if (!compacto || i === marcas[marcas.length - 1][0]) nos.push(svg('text', { class: 'cs-rotulo acum', x: cx(i), y: yD(val) - 7, 'text-anchor': 'middle', fill: s.cor }, pct ? fmtP(val) : fmtN(val)));
    }
  }
  // eixo de baixo: semana, período do BM e BM
  nos.push(svg('line', { class: 'cs-base', x1: m.l, x2: W - m.r, y1: h - m.b, y2: h - m.b }));
  pontos.forEach((p, i) => {
    const y = h - m.b + 12;
    nos.push(svg('text', { class: `cs-semana${p.atual ? ' forte' : ''}`, x: cx(i), y, 'text-anchor': 'end', transform: `rotate(-45 ${cx(i)} ${y})` }, p.semana));
  });
  for (const b of bms) {
    const x1 = m.l + larg * b.de;
    const x2 = m.l + larg * (b.ate + 1);
    nos.push(svg('line', { class: 'cs-divisa', x1, x2: x1, y1: h - m.b, y2: h - 4 }));
    nos.push(svg('text', { class: 'cs-bm', x: (x1 + x2) / 2, y: h - (compacto ? 16 : 22), 'text-anchor': 'middle' }, b.rotulo || b.bm));
    if (!compacto) nos.push(svg('text', { class: 'cs-bm id', x: (x1 + x2) / 2, y: h - 8, 'text-anchor': 'middle' }, b.bm));
  }
  nos.push(svg('line', { class: 'cs-divisa', x1: W - m.r, x2: W - m.r, y1: h - m.b, y2: h - 4 }));
  // dica ao passar o mouse
  pontos.forEach((p, i) => {
    nos.push(svg('rect', {
      class: 'alvo', x: m.l + larg * i, y: m.t, width: larg, height: h - m.t - m.b,
      onmousemove: (e) => mostrarDica(e, `${p.semana} · ${curta(p.ini)} a ${curta(p.fim)} · BM ${p.bmRotulo || p.bm}`, [
        ['Previsto', `${fmtN(p.previsto)} · acum. ${fmtN(p.previstoAcum)} (${fmtP(p.previstoAcum / total)})`, CORES_CURVA.previsto],
        curva.comReplanejado ? ['Replanejado', `${fmtN(p.replanejado ?? p.previsto)} · acum. ${fmtN(p.replanejadoAcum)}`, CORES_CURVA.replanejado] : null,
        ['Realizado', p.realizado == null ? 'semana futura' : `${fmtN(p.realizado)} · acum. ${fmtN(p.realizadoAcum)} (${fmtP(p.realizadoAcum / total)})`, CORES_CURVA.realizado],
        p.fornos?.length ? ['Fornos', p.fornos.map((f) => f.replace('-', ' ')).join(', ')] : null
      ].filter(Boolean)),
      onmouseleave: esconderDica
    }));
  });
  return svg('svg', { viewBox: `0 0 ${W} ${h}`, width: W, height: h, class: 'cs-svg' }, nos);
}

/** Passo "redondo" para o eixo (1, 2, 5, 10...). */
function niceStep(bruto, pct = false) {
  if (bruto <= 0) return pct ? 0.05 : 1;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / p;
  const k = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return k * p;
}
