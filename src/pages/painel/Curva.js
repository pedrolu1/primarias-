// Curva S igual à planilha da Curva S: o contrato inteiro, semana a semana,
// agrupado por BM, com previsto e replanejado da planilha e o realizado dos
// lançamentos. O previsto se muda no Excel; a sincronização traz para o app.
import { el } from '../../base/dom.js';
import { segmented } from '../../base/ui.js';
import { graficoCurvaS } from '../../components/curvaS.js';
import { graficoBms } from '../../components/graficos.js';
import { contratoAtivo } from '../../data/obra.js';
import { curvaContrato, curvaBm, bmsDoContrato, bmAtual } from '../../lib/calculo.js';
import { curta, rotuloBm, completa, hoje } from '../../lib/datas.js';

let modo = 'numero';
const qtd = (n) => `${n} forno${n === 1 ? '' : 's'}`;
const pct = (v) => (v == null || !Number.isFinite(v) ? '' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

export function carimboAgora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} - ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function paginaCurva(ctx) {
  const { calc } = ctx;
  const c = curvaContrato(calc);
  const bmA = curvaBm(calc, bmAtual());
  const sem = c.atual;
  const desvio = c.realizado - c.previstoAteHoje;
  const fonte = calc.estado.config?.curva;
  const bms = bmsDoContrato(calc).map((b) => ({ ...b, rotulo: rotuloBm(b.bm), atual: b.bm === bmAtual() }));

  return [
    el('div', { class: 'indicadores' }, [
      bloco('Previsto no contrato', qtd(c.total), `${contratoAtivo().nome} · bateria ${contratoAtivo().bateria}`),
      bloco('Realizado', qtd(c.realizado), `${pct(c.realizado / c.total)} do previsto total`, 'bom'),
      bloco('Previsto até hoje', qtd(c.previstoAteHoje), desvio >= 0 ? `${qtd(desvio)} à frente` : `${qtd(-desvio)} atrás`, desvio >= 0 ? 'bom' : 'alerta'),
      bloco(`BM ${rotuloBm(bmA.bm)}`, `${bmA.realizado} de ${bmA.meta}`, bmA.faltam ? `faltam ${qtd(bmA.faltam)} até ${curta(bmA.fim)}` : 'previsto do BM atingido', bmA.faltam ? '' : 'bom'),
      sem ? bloco(`Semana ${sem.semana}`, `${sem.realizado ?? 0} de ${sem.previsto}`, `${curta(sem.seg)} a ${curta(sem.dom)}`) : null
    ]),
    el('section', { class: 'cartao' }, [
      el('div', { class: 'cartao-topo' }, [
        el('div', {}, [
          el('h3', {}, 'Curva S'),
          el('p', {}, fonte?.importadoEm ? `Previsto da planilha "${fonte.arquivo || 'Curva S'}", sincronizada em ${new Date(fonte.importadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : 'Previsto da planilha da Curva S. Para mudar o previsto, mude no Excel e sincronize a pasta.')
        ]),
        el('div', { class: 'curva-modo' }, segmented([{ value: 'numero', label: 'Nº de fornos' }, { value: 'percentual', label: 'Percentual' }], modo, (v) => { modo = v; ctx.redesenhar(); }))
      ]),
      graficoCurvaS(c, { modo, atualizadoEm: carimboAgora() })
    ]),
    el('section', { class: 'cartao' }, [
      el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Semana a semana'), el('p', {}, 'Como na aba "BD - REV" da planilha. O realizado conta o forno na semana em que a última primária recebeu a massa 1200.')])]),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data-table tabela-compacta' }, [
        el('thead', {}, el('tr', {}, ['BM', 'Período do BM', 'Semana', 'Início', 'Fim', 'Previsto', 'Prev. acum.', '% prev. acum.', ...(c.comReplanejado ? ['Replanejado', 'Replan. acum.'] : []), 'Realizado', 'Real. acum.', '% real. acum.', 'Fornos'].map((t, i) => el('th', { class: i >= 5 && t !== 'Fornos' ? 'n' : '' }, t)))),
        el('tbody', {}, c.pontos.map((p) => el('tr', { class: p.atual ? 'semana-atual' : '' }, [
          el('td', {}, p.bm),
          el('td', { class: 'nowrap' }, p.bmRotulo),
          el('td', { class: 'strong' }, p.atual ? [p.semana, el('small', { class: 'fraco' }, ' atual')] : p.semana),
          el('td', {}, curta(p.ini)),
          el('td', {}, curta(p.fim)),
          el('td', { class: 'n' }, String(p.previsto)),
          el('td', { class: 'n' }, String(p.previstoAcum)),
          el('td', { class: 'n' }, pct(p.previstoAcum / c.total)),
          ...(c.comReplanejado ? [el('td', { class: 'n' }, p.replanejado == null ? '' : String(p.replanejado)), el('td', { class: 'n' }, String(p.replanejadoAcum ?? ''))] : []),
          el('td', { class: 'n strong' }, p.realizado == null ? '' : String(p.realizado)),
          el('td', { class: 'n' }, p.realizadoAcum == null ? '' : String(p.realizadoAcum)),
          el('td', { class: 'n' }, p.realizadoAcum == null ? '' : pct(p.realizadoAcum / c.total)),
          el('td', { class: 'fraco', style: { fontSize: '12.5px' } }, p.fornos.map((f) => f.replace('-', ' ')).join(', '))
        ])))
      ]))
    ]),
    el('section', { class: 'cartao' }, [
      el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Fornos revestidos por BM'), el('p', {}, `Previsto da planilha × realizado · situação em ${completa(hoje())}`)])]),
      graficoBms(bms)
    ])
  ];
}

function bloco(rotulo, valor, texto, classe = '') {
  return el('div', { class: `indicador ${classe}` }, [el('span', {}, rotulo), el('div', { class: 'num', style: { fontSize: '30px' } }, valor), el('p', {}, texto)]);
}
