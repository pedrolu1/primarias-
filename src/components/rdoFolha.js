// Folha do RDO igual às abas recentes da planilha PLAN-RFX-002: mesma grade
// de 14 colunas (A a N), mesmos blocos, títulos e células. O que aparece aqui
// é o que o app grava na aba do dia no Excel.
import { el } from '../base/dom.js';
import { CLIENTE, SERVICO, CODIGO_RDO, EFETIVO_MODELO, HORARIO } from '../data/obra.js';
import { completa } from '../lib/datas.js';
import { LINHAS_RDO, COLUNAS_RDO } from '../lib/calculo.js';

// larguras das colunas A a N na planilha (unidades do Excel)
const LARGURAS = [5.43, 7.57, 13.71, 11.57, 11.57, 9.86, 9.86, 18.14, 19.57, 45.86, 12.14, 12.14, 12.14, 12.14];
const TOTAL = LARGURAS.reduce((a, b) => a + b, 0);
// colunas das atividades: B:C, D:E, F:G, H e I
const SPAN_ATIVIDADE = [2, 2, 2, 1, 1];

// classes com prefixo f- para não pegar estilos do resto do app
const td = (conteudo, { cs = 1, rs = 1, cls = '' } = {}) => el('td', {
  colspan: cs > 1 ? cs : null,
  rowspan: rs > 1 ? rs : null,
  class: cls ? cls.split(/\s+/).filter(Boolean).map((c) => `f-${c}`).join(' ') : null
}, conteudo ?? '');
const DIAS_EXTENSO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaExtenso = (d) => DIAS_EXTENSO[new Date(`${d}T12:00:00`).getDay()];
const num1 = (n) => (n == null ? '' : Number(n).toFixed(1).replace('.', ','));

/**
 * r: rdoDoDia(calc, data). obs: texto das observações (salvo ou sugerido).
 * Devolve o <article> pronto para a tela e para a impressão.
 */
export function folhaRdo(r, obs) {
  const s = r.salvo || {};
  const efetivo = s.efetivo || {};
  const real = (f, prev) => Number(efetivo[f] ?? prev);
  const clima = s.clima?.diurno || 'estavel';
  const linhas = [];
  const add = (...cels) => linhas.push(el('tr', {}, cels));

  // cabeçalho (linhas 1 a 4)
  add(
    td('RDO Nº:', { cs: 2, cls: 'rot' }),
    td(r.numero ? String(r.numero) : '', { cls: 'val' }),
    td('RELATÓRIO DIÁRIO DE OBRA', { cs: 9, cls: 'tit1' }),
    td([el('img', { src: './marcas/reframax.png', alt: 'Reframax' }), el('b', {}, CODIGO_RDO)], { cs: 2, rs: 4, cls: 'logo' })
  );
  add(td('Data:', { cs: 2, cls: 'rot' }), td(completa(r.data), { cls: 'val' }), td('EXECUÇÃO', { cs: 9, cls: 'tit2' }));
  add(td('Dia da Semana:', { cs: 2, rs: 2, cls: 'rot' }), td(diaExtenso(r.data), { rs: 2, cls: 'val' }), td([el('b', {}, 'Cliente: '), CLIENTE], { cs: 9, cls: 'info' }));
  add(td([el('b', {}, 'Serviço: '), SERVICO], { cs: 9, cls: 'info' }));

  // linhas 5 a 8
  add(td('Registro das Atividades', { cs: 9, cls: 'sec' }), td('Efetivo', { cs: 5, cls: 'sec grande' }));
  add(td('Turno Diurno', { cs: 9, cls: 'sec cinza' }), td('MÃO DE OBRA INDIRETA', { cs: 5, cls: 'sub' }));
  add(td('', { cs: 9, cls: 'ss' }), td('Funções', { rs: 2, cls: 'cab' }), td('Diurno', { cs: 2, cls: 'cab' }), td('Noturno', { cs: 2, cls: 'cab' }));
  const colunas = r.colunas.slice(0, COLUNAS_RDO);
  add(
    td('', { cls: 'ss' }),
    ...SPAN_ATIVIDADE.map((cs, k) => td(colunas[k]?.titulo || '', { cs, cls: 'ss ativ-tit' })),
    ...['Previsto', 'Realizado', 'Previsto', 'Realizado'].map((t) => td(t, { cls: 'cab' }))
  );

  // linhas 9 a 39: itens à esquerda; efetivo e equipamentos à direita
  const moi = EFETIVO_MODELO.moi;
  const mod = EFETIVO_MODELO.mod;
  const linhaEfetivo = (lista, i) => {
    const f = lista[i];
    if (!f) return [td(''), td('', { cls: 'c' }), td('', { cls: 'c' }), td('', { cls: 'c' }), td('', { cls: 'c' })];
    return [td(f[0], { cls: 'fun' }), td(String(f[1]), { cls: 'c' }), td(String(real(f[0], f[1])), { cls: 'c' }), td('0', { cls: 'c' }), td('0', { cls: 'c' })];
  };
  const subtotal = (lista, cls = 'subtotal', rotulo = 'SUBTOTAL') => [
    td(rotulo, { cls: `fun ${cls}` }),
    td(String(lista.reduce((t, [, p]) => t + p, 0)), { cls: `c ${cls}` }),
    td(String(lista.reduce((t, [f, p]) => t + real(f, p), 0)), { cls: `c ${cls}` }),
    td('0', { cls: `c ${cls}` }),
    td('0', { cls: `c ${cls}` })
  ];
  const direita = (k) => {
    const lin = 9 + k;
    if (lin <= 17) return linhaEfetivo(moi, lin - 9);
    if (lin === 18) return subtotal(moi);
    if (lin === 19) return [td('MÃO DE OBRA DIRETA', { cs: 5, cls: 'sub' })];
    if (lin === 20) return [td('Funções', { rs: 2, cls: 'cab' }), td('Diurno', { cs: 2, cls: 'cab' }), td('Noturno', { cs: 2, cls: 'cab' })];
    if (lin === 21) return ['Previsto', 'Realizado', 'Previsto', 'Realizado'].map((t) => td(t, { cls: 'cab' }));
    if (lin <= 34) return linhaEfetivo(mod, lin - 22);
    if (lin === 35) return subtotal(mod);
    if (lin === 36) return subtotal([...moi, ...mod], 'total', 'TOTAL GERAL');
    if (lin === 37) return [td('Equipamentos Móveis', { cs: 5, cls: 'sec grande' })];
    if (lin === 38) return [td('Descrição', { rs: 2, cls: 'cab' }), td('Diurno', { cs: 2, cls: 'cab' }), td('Noturno', { cs: 2, cls: 'cab' })];
    return ['Previsto', 'Realizado', 'Previsto', 'Realizado'].map((t) => td(t, { cls: 'cab' }));
  };
  for (let k = 0; k < LINHAS_RDO; k++) {
    add(
      td('', { cls: 'ss' }),
      ...SPAN_ATIVIDADE.map((cs, c) => {
        const l = colunas[c]?.linhas[k];
        return td(l?.texto || '', { cs, cls: `ss item${l?.titulo ? ' ativ-tit' : ''}${l?.aviso ? ' aviso' : ''}` });
      }),
      ...direita(k)
    );
  }

  // linhas 40 a 44: observações e equipamentos
  const equip = EFETIVO_MODELO.equipamentos;
  add(td('Obs.:', { cs: 2, rs: 4, cls: 'obs-rot' }), td(obs || '', { cs: 7, rs: 4, cls: 'obs' }), ...linhaEfetivo(equip, 0));
  for (let k = 1; k < 4; k++) add(...linhaEfetivo(equip, k));

  // linhas 45 a 60: horário, clima e controle de produção
  add(td('HORÁRIO:', { cs: 3, cls: 'cab-b topo' }), td('CONDIÇÕES CLIMÁTICAS:', { cs: 6, cls: 'cab-b topo' }), td('CONTROLE DE PRODUÇÃO', { cls: 'cab-b' }), td('', { cs: 4, cls: 'preto' }));
  const mats = r.materiais;
  const material = (i) => {
    const m = mats[i];
    if (!m) return [td(''), td('', { cls: 'c' }), td('', { cls: 'c' }), td('', { cls: 'c azul' }), td('', { cls: 'c' })];
    return [td(m.nome.toUpperCase(), { cls: 'fun mat' }), td(m.unidade, { cls: 'c' }), td(num1(m.anterior), { cls: 'c' }), td(num1(m.aplicado), { cls: 'c azul' }), td(num1(m.acumulado), { cls: 'c' })];
  };
  add(td('DIURNO', { cs: 3, cls: 'ss hor' }), td('', { cs: 6, cls: 'ss' }), td('MATERIAIS', { cls: 'cab-b' }), ...['UNIDADE', 'ANTERIOR', 'APLICADO', 'ACUMULADO'].map((t) => td(t, { cls: 'cab mini' })));
  add(td('', { cs: 3, cls: 'ss' }), td('DIURNO', { cs: 4, cls: 'ss c clima-cab' }), td('NOTURNO', { cs: 2, cls: 'ss c clima-cab' }), ...material(0));
  add(td(HORARIO[0].dias.toUpperCase(), { cs: 3, cls: 'ss hor' }), td('Tempo Estável', { cs: 2, cls: 'clima' }), td(clima === 'estavel' ? 'X' : '', { cs: 2, cls: 'clima c' }), td('Tempo Estável', { cls: 'clima' }), td('', { cls: 'clima' }), ...material(1));
  add(td(HORARIO[0].horas, { cs: 3, cls: 'ss hor' }), td('Tempo Chuvoso', { cs: 2, cls: 'clima' }), td(clima === 'chuvoso' ? 'X' : '', { cs: 2, cls: 'clima c' }), td('Tempo Chuvoso', { cls: 'clima' }), td('', { cls: 'clima' }), ...material(2));
  add(td('', { cs: 3, cls: 'ss' }), td('', { cs: 6, cls: 'ss' }), ...material(3));
  add(td(HORARIO[1].dias.toUpperCase(), { cs: 3, cls: 'ss hor' }), td('', { cs: 6, cls: 'ss' }), ...material(4));
  add(td(HORARIO[1].horas, { cs: 3, cls: 'ss hor' }), td('', { cs: 6, cls: 'ss' }), ...material(5));
  for (let k = 6; k < 14; k++) add(td('', { cs: 3, cls: k === 13 ? 'ss base' : 'ss' }), td('', { cs: 6, cls: k === 13 ? 'ss base' : 'ss' }), ...material(k));

  // assinaturas e observações da contratante
  add(td('ASSINATURAS', { cs: 14, cls: 'sec topo' }));
  add(td('Contratada (Reframax)', { cs: 6, cls: 'ass-cab' }), td('', { cs: 4, cls: 'ass-cab' }), td('Contratante (Ternium)', { cs: 4, cls: 'ass-cab' }));
  add(td('', { cs: 6, cls: 'ass' }), td('', { cs: 4, cls: 'ass' }), td('', { cs: 4, cls: 'ass' }));
  add(td('Observações da Contratante:', { cs: 14, cls: 'cab-b c topo' }));
  add(td(s.obsContratante || '', { cs: 14, cls: 'linha-obs' }));
  for (let k = 0; k < 4; k++) add(td('', { cs: 14, cls: 'linha-obs' }));

  return el('article', { class: 'rdo-folha', 'aria-label': `RDO ${r.numero || ''} de ${completa(r.data)}` }, el('table', {}, [
    el('colgroup', {}, LARGURAS.map((w) => el('col', { style: { width: `${((w / TOTAL) * 100).toFixed(3)}%` } }))),
    el('tbody', {}, linhas)
  ]));
}
