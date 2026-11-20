// RDO no painel, igual à aba do dia na planilha PLAN-RFX-002. As atividades e
// os materiais saem dos lançamentos; a sopragem e as observações, do Diário
// do campo. O planejador confere o efetivo, o clima e os materiais, fecha
// (o número fica fixo) e grava a aba no Excel ou imprime.
import { el } from '../../base/dom.js';
import { segmented } from '../../base/ui.js';
import { statusChip } from '../../components/base.js';
import { folhaRdo } from '../../components/rdoFolha.js';
import { ic } from '../../lib/icones.js';
import { EFETIVO_MODELO, TIPOS_OCORRENCIA, FERIADOS, etapaPorId } from '../../data/obra.js';
import { rdoDoDia, observacoesSugeridas, rdoUltimo, textoOcorrencia, resumoAlvos } from '../../lib/calculo.js';
import { corrigirTexto } from '../../lib/corretor.js';
import { salvarRdo } from '../../lib/banco.js';
import { modeloGuardado, estaOcupado, gerarExcel, usarRedesenho, escolherArquivo } from '../../lib/excel.js';
import { arquivoNaPasta } from '../../lib/pasta.js';
import { hoje, somarDias, completa, nomeDia, semana } from '../../lib/datas.js';
import { toast } from '../../base/toast.js';

let dia = null;
const STATUS = { rascunho: 'Em preenchimento', fechado: 'Fechado', assinado: 'Assinado', planilha: 'Emitido na planilha' };
const NOME_TIPO = Object.fromEntries(TIPOS_OCORRENCIA.map((t) => [t.id, t.nome]));

function semNumero(r) {
  if (r.status === 'planilha') return 'Emitido na planilha antes do app';
  if (FERIADOS.includes(r.data)) return 'Feriado sem serviço: sem RDO';
  return 'Sem expediente e sem serviço: sem RDO';
}

export function paginaRdo(ctx) {
  const { calc, perfil, leitura } = ctx;
  usarRedesenho(() => ctx.redesenhar());
  dia ||= hoje();
  const r = rdoDoDia(calc, dia);
  const s = r.salvo || {};
  const sugerido = observacoesSugeridas(r);
  const obsTexto = s.obs ?? sugerido;
  const ir = (d) => {
    dia = d;
    ctx.redesenhar();
  };

  const fechar = () => {
    // o número e os materiais ficam fixos no fechamento
    const materiais = Object.fromEntries(r.materiais.map((m) => [m.id, m.aplicado]));
    salvarRdo(dia, { status: 'fechado', numero: r.numero, obs: obsTexto, materiais, fechadoPor: perfil.nome, fechadoEm: Date.now() });
    toast(`RDO nº ${r.numero} fechado. O campo não registra mais neste dia.`, 'ok');
  };
  const naPasta = arquivoNaPasta('rdo');
  const modelo = naPasta || modeloGuardado('rdo');
  const gravando = estaOcupado('excel-rdo');
  const acoes = [];
  if (!leitura && r.status === 'rascunho' && r.numero) acoes.push(el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: fechar }, [el('span', { html: ic.lock(15) }), 'Fechar RDO']));
  if (!leitura && r.status === 'fechado') {
    acoes.push(el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => salvarRdo(dia, { status: 'rascunho', reabertoPor: perfil.nome }) }, 'Reabrir'));
    acoes.push(el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { salvarRdo(dia, { status: 'assinado', assinadoEm: Date.now() }); toast('Marcado como assinado.', 'ok'); } }, 'Marcar como assinado'));
  }
  if (r.numero && r.status !== 'planilha') {
    acoes.push(el('button', {
      class: 'btn btn-outline btn-sm', type: 'button', disabled: gravando,
      title: modelo ? `Grava a aba ${r.numero} em ${modelo.nome}${naPasta ? ' (pasta primarias)' : ''}` : 'Escolha a planilha do RDO uma vez',
      onclick: () => gerarExcel('rdo', calc, { datas: [dia] })
    }, [el('span', { html: gravando ? '' : ic.planilha(15), class: gravando ? 'spinner' : '', style: { display: 'inline-flex' } }), gravando ? 'Gravando…' : naPasta ? 'Gravar na pasta' : 'Gravar no Excel']));
  }
  acoes.push(el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => window.print() }, [el('span', { html: ic.imprimir(15) }), 'Imprimir ou PDF']));

  return [
    el('div', { class: 'entre nao-imprimir', style: { flexWrap: 'wrap', gap: '10px' } }, [
      el('div', { class: 'linha', style: { flexWrap: 'wrap' } }, [
        el('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Dia anterior', html: ic.chevronLeft(18), onclick: () => ir(somarDias(dia, -1)) }),
        el('input', { class: 'input', type: 'date', value: dia, max: hoje(), style: { width: '170px', height: '38px' }, onchange: (ev) => ev.target.value && ir(ev.target.value) }),
        el('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Próximo dia', disabled: dia >= hoje(), html: ic.chevronLeft(18), style: { transform: 'scaleX(-1)' }, onclick: () => ir(somarDias(dia, 1)) }),
        el('strong', { style: { fontSize: '15px' } }, r.numero ? `RDO nº ${r.numero}` : semNumero(r)),
        el('span', { class: 'fraco', style: { fontSize: '13px' } }, `${nomeDia(dia)} · ${semana(dia)}`),
        statusChip(r.status, STATUS[r.status])
      ]),
      el('div', { class: 'toolbar' }, acoes)
    ]),
    r.status === 'rascunho' && r.numero && !s.numero
      ? el('p', { class: 'rdo-aviso-num nao-imprimir' }, `Número provisório: continua a planilha (último: nº ${rdoUltimo(calc).numero} de ${completa(rdoUltimo(calc).data)}) e fica fixo ao fechar.${modelo ? '' : ' Para gravar no Excel, escolha a planilha do RDO uma vez.'}`)
      : null,
    el('div', { class: 'rdo-rolagem' }, folhaRdo(r, obsTexto)),
    registrosDoCampo(r),
    leitura ? null : edicao(r, s, obsTexto, sugerido, perfil),
    leitura || modelo ? null : el('section', { class: 'cartao nao-imprimir' }, [
      el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Planilha do RDO'), el('p', {}, 'Conecte a pasta primarias em Documentos (o app acha a PLAN-RFX-002 sozinho) ou escolha o arquivo aqui. Cada RDO fechado vira uma aba nova, depois da última, com o mesmo layout.')])]),
      el('div', { class: 'toolbar' }, [el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => escolherArquivo('rdo') }, [el('span', { html: ic.planilha(15) }), 'Escolher a planilha'])])
    ]),
    controle(calc, ir)
  ];
}

/** O que os líderes registraram no dia: Diário, 5S e observações dos lançamentos. */
function registrosDoCampo(r) {
  const itens = [
    ...r.ocorrencias.map((o) => ({ titulo: NOME_TIPO[o.tipo] || o.tipo, texto: corrigirTexto(textoOcorrencia(o)), autor: o.autor?.nome })),
    ...r.observacoesCampo.map((l) => ({ titulo: `${etapaPorId[l.etapa].curto} · ${resumoAlvos(l.prims, l.etapa).join(', ')}`, texto: corrigirTexto(l.obs), autor: l.autor?.nome }))
  ];
  return el('section', { class: 'cartao nao-imprimir' }, [
    el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Registros do campo'), el('p', {}, 'Diário, 5S e observações dos lançamentos. A sopragem vira coluna do RDO; o resto entra nas observações, já corrigido.')]), el('span', { class: 'num', style: { fontSize: '24px' } }, String(itens.length))]),
    itens.length
      ? el('div', { class: 'pilha', style: { gap: '8px' } }, itens.map((i) => el('div', { class: 'pedido' }, [
          el('div', {}, [el('strong', {}, i.titulo), el('p', {}, `${i.texto}${i.autor ? ` · ${i.autor}` : ''}`)])
        ])))
      : el('div', { class: 'vazio-convite' }, [el('strong', {}, 'Nenhum registro'), 'Os líderes registram o 5S, a sopragem e as ocorrências pela aba Diário do app.'])
  ]);
}

/** Edição do planejador: clima, efetivo, materiais e textos. Salva sozinho. */
function edicao(r, s, obsTexto, sugerido, perfil) {
  const travado = r.status !== 'rascunho';
  const efetivo = s.efetivo || {};
  const clima = s.clima || { diurno: 'estavel' };
  const salvar = (mud) => salvarRdo(r.data, { ...mud, atualizadoPor: perfil.nome, atualizadoEm: Date.now() });
  const numero = (valor, aoMudar, rotulo, max = 99) => el('input', {
    class: 'input input-compact', type: 'number', min: 0, max, disabled: travado, value: valor,
    style: { width: '84px', height: '32px', textAlign: 'right' }, 'aria-label': rotulo,
    onchange: (ev) => aoMudar(Math.max(0, Math.round(Number(ev.target.value) || 0)))
  });
  const tabela = (titulo, lista) => el('table', { class: 'data-table tabela-compacta tabela-estreita' }, [
    el('thead', {}, el('tr', {}, [el('th', {}, titulo), el('th', { class: 'n' }, 'Previsto'), el('th', { class: 'n' }, 'Realizado')])),
    el('tbody', {}, lista.map(([f, prev]) => el('tr', {}, [
      el('td', {}, f),
      el('td', { class: 'n' }, String(prev)),
      el('td', { class: 'n' }, numero(efetivo[f] ?? prev, (v) => salvar({ efetivo: { ...efetivo, [f]: v } }), `${f} realizado`))
    ])))
  ]);
  const materiais = el('table', { class: 'data-table tabela-compacta tabela-estreita' }, [
    el('thead', {}, el('tr', {}, [el('th', {}, 'Material'), el('th', { class: 'n' }, 'Anterior'), el('th', { class: 'n' }, 'Aplicado'), el('th', { class: 'n' }, 'Acumulado')])),
    el('tbody', {}, r.materiais.map((m) => el('tr', {}, [
      el('td', {}, [m.nome, el('small', { class: 'fraco', style: { display: 'block' } }, m.calculado ? `${m.unidade} · pelos lançamentos` : `${m.unidade} · corrigido`)]),
      el('td', { class: 'n' }, m.anterior.toLocaleString('pt-BR')),
      el('td', { class: 'n' }, numero(m.aplicado, (v) => salvar({ materiais: { ...(s.materiais || {}), [m.id]: v } }), `${m.nome} aplicado`, 999999)),
      el('td', { class: 'n' }, m.acumulado.toLocaleString('pt-BR'))
    ])))
  ]);
  return el('section', { class: 'cartao nao-imprimir' }, [
    el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Preencher o RDO'), el('p', {}, travado ? 'RDO fechado. Reabra para mudar.' : 'Clima, efetivo, materiais e textos. Salva sozinho a cada mudança.')])]),
    el('div', { class: 'rdo-edicao' }, [
      el('div', { class: 'pilha', style: { gap: '12px' } }, [
        el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Condições climáticas (diurno)'), segmented([{ value: 'estavel', label: 'Tempo estável' }, { value: 'chuvoso', label: 'Tempo chuvoso' }], clima.diurno, (v) => !travado && salvar({ clima: { ...clima, diurno: v } }))]),
        el('div', { class: 'table-wrap' }, tabela('Mão de obra direta', EFETIVO_MODELO.mod)),
        el('div', { class: 'table-wrap' }, tabela('Mão de obra indireta', EFETIVO_MODELO.moi)),
        el('div', { class: 'table-wrap' }, tabela('Equipamentos móveis', EFETIVO_MODELO.equipamentos))
      ]),
      el('div', { class: 'pilha', style: { gap: '12px' } }, [
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'rdo-obs' }, 'Observações (Reframax)'),
          el('textarea', { id: 'rdo-obs', class: 'textarea', rows: 5, disabled: travado, value: obsTexto, placeholder: 'A REFRAMAX INFORMA QUE…', onchange: (ev) => salvar({ obs: ev.target.value }) }),
          sugerido && !travado && sugerido !== obsTexto ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => salvar({ obs: sugerido }) }, 'Refazer pelos registros do campo') : null
        ]),
        el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Controle de produção'), el('div', { class: 'table-wrap' }, materiais)]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'rdo-obs-contratante' }, 'Observações da contratante'),
          el('textarea', { id: 'rdo-obs-contratante', class: 'textarea', rows: 3, disabled: ['assinado', 'planilha'].includes(r.status), value: s.obsContratante || '', onchange: (ev) => salvar({ obsContratante: ev.target.value }) })
        ])
      ])
    ])
  ]);
}

/** Controle dos RDOs (como a aba CONTROLE da planilha): últimos 14 dias. */
function controle(calc, ir) {
  const dias = Array.from({ length: 14 }, (_, i) => somarDias(hoje(), -i));
  const prevTotal = [...EFETIVO_MODELO.moi, ...EFETIVO_MODELO.mod].reduce((t, [, p]) => t + p, 0);
  return el('section', { class: 'cartao nao-imprimir' }, [
    el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Controle de RDOs'), el('p', {}, 'Últimos 14 dias. Toque na linha para abrir.')])]),
    el('div', { class: 'table-wrap' }, el('table', { class: 'data-table tabela-compacta' }, [
      el('thead', {}, el('tr', {}, ['Nº', 'Data', 'Dia', 'Semana', 'Atividades', 'Efetivo previsto', 'Efetivo realizado', 'Situação'].map((t, i) => el('th', { class: [0, 4, 5, 6].includes(i) ? 'n' : '' }, t)))),
      el('tbody', {}, dias.map((d) => {
        const r = rdoDoDia(calc, d);
        const ef = r.salvo?.efetivo || {};
        const real = [...EFETIVO_MODELO.moi, ...EFETIVO_MODELO.mod].reduce((t, [f, p]) => t + Number(ef[f] ?? p), 0);
        const itens = r.colunas.reduce((t, c) => t + c.linhas.filter((l) => l.texto && !l.titulo).length, 0);
        return el('tr', { style: { cursor: 'pointer' }, class: d === dia ? 'semana-atual' : '', onclick: () => ir(d) }, [
          el('td', { class: 'n strong' }, r.numero ? String(r.numero) : '-'),
          el('td', {}, completa(d)),
          el('td', {}, nomeDia(d)),
          el('td', {}, semana(d)),
          el('td', { class: 'n' }, itens ? String(itens) : ''),
          el('td', { class: 'n' }, r.numero ? String(prevTotal) : ''),
          el('td', { class: 'n' }, r.numero ? String(real) : ''),
          el('td', {}, r.numero || r.salvo ? statusChip(r.status, STATUS[r.status]) : el('span', { class: 'fraco' }, FERIADOS.includes(d) ? 'feriado' : 'sem expediente'))
        ]);
      }))
    ]))
  ]);
}
