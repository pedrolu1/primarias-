// Documentos: os PDFs (mapa, Curva S, checklist com fotos, espelho da medição
// e RDO) e as planilhas de controle preenchidas pelo app. A planilha é
// escolhida uma vez e fica guardada neste aparelho; a cada clique o app
// devolve uma cópia atualizada, com fórmulas, gráficos e macros intactos.
import { el } from '../../base/dom.js';
import { legendaEtapas, statusChip } from '../../components/base.js';
import { mapaBateria } from '../../components/mapa.js';
import { graficoCurvaS } from '../../components/curvaS.js';
import { carimboAgora } from './Curva.js';
import { abrirImpressao } from '../../components/impressao.js';
import { NOME_STATUS } from '../../components/checklistFotos.js';
import { ic } from '../../lib/icones.js';
import { ETAPAS_MAPA, CLIENTE, SERVICO, contratoAtivo, localMedicao, rotulo } from '../../data/obra.js';
import { curvaBm, curvaContrato, bmsDoContrato, bmAtual, contagemPorEtapa, relacaoDoBm } from '../../lib/calculo.js';
import { MODELOS, modeloGuardado, estaOcupado, ocupar, escolherArquivo, gerarExcel, usarRedesenho } from '../../lib/excel.js';
import { baixar, pdfChecklists } from '../../lib/documentos.js';
import { hoje, completa, curta, nomeBm, rotuloBm, referenciaBm, periodoBm } from '../../lib/datas.js';
import { toast } from '../../base/toast.js';

let bmEscolhido = null;
let ctxAtual = null;
const qtd = (n, nome) => `${n} ${nome}${n === 1 ? '' : 's'}`;

function redesenhar() {
  if (ctxAtual && location.hash.slice(2) === 'documentos') ctxAtual.redesenhar();
}

export function paginaDocumentos(ctx) {
  ctxAtual = ctx;
  usarRedesenho(redesenhar);
  const { calc, ir } = ctx;
  const atual = bmAtual();
  const bms = bmsDoContrato(calc);
  if (!bmEscolhido || !bms.some((b) => b.bm === bmEscolhido)) bmEscolhido = atual;
  const rel = relacaoDoBm(calc, bmEscolhido);

  const seletor = el('div', { class: 'pilha', style: { gap: '8px' } }, [
    el('div', { class: 'fraco', style: { fontSize: '13px' } }, 'Boletim de medição usado na Curva S, no checklist e no espelho:'),
    el('div', { class: 'blocos-trilho', role: 'tablist', 'aria-label': 'Boletim de medição' }, bms.map((b) => el('button', {
      type: 'button', role: 'tab', 'aria-selected': String(b.bm === bmEscolhido), class: `bloco-op${b.bm === bmEscolhido ? ' ativo' : ''}`,
      onclick: () => { bmEscolhido = b.bm; redesenhar(); }
    }, [`BM ${rotuloBm(b.bm)}`, el('small', {}, qtd(b.realizado, 'forno'))])))
  ]);

  const excel = (tipo, extra = null, opcoes = {}) => {
    const m = MODELOS[tipo];
    const modelo = modeloGuardado(tipo);
    const gerando = estaOcupado(`excel-${tipo}`);
    return el('div', { class: 'doc-excel' }, [
      el('div', { class: 'doc-excel-info' }, [
        el('span', { class: 'doc-excel-icone', html: ic.planilha(20) }),
        el('div', {}, [
          el('strong', {}, `Planilha ${m.nome}`),
          el('small', {}, modelo ? `${modelo.nome} · guardada ${new Date(modelo.salvoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Escolha o arquivo uma vez; ele fica guardado neste aparelho.')
        ])
      ]),
      extra,
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: gerando, onclick: () => gerarExcel(tipo, calc, opcoes) }, [el('span', { html: gerando ? '' : ic.download(15), class: gerando ? 'spinner' : '', style: { display: 'inline-flex' } }), gerando ? 'Gerando…' : modelo ? 'Baixar preenchida' : 'Escolher a planilha']),
        modelo ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => escolherArquivo(tipo) }, 'Trocar arquivo') : null
      ])
    ]);
  };

  const cartao = (icone, titulo, texto, corpo) => el('section', { class: 'cartao doc-cartao' }, [
    el('div', { class: 'cartao-topo' }, [el('div', { class: 'linha', style: { alignItems: 'flex-start' } }, [el('span', { class: 'doc-icone', html: icone }), el('div', {}, [el('h3', {}, titulo), el('p', {}, texto)])])]),
    ...corpo
  ]);
  const botaoPdf = (rotulo, fn, id = null) => {
    const gerando = id && estaOcupado(id);
    return el('button', { class: 'btn btn-outline btn-sm', type: 'button', disabled: gerando, onclick: fn }, [el('span', { html: gerando ? '' : ic.imprimir(15), class: gerando ? 'spinner' : '', style: { display: 'inline-flex' } }), gerando ? 'Gerando…' : rotulo]);
  };

  const c = curvaBm(calc, bmEscolhido);
  const comFotos = rel.filter((r) => r.checklist && r.checklist.origem !== 'planilha');

  return [
    seletor,
    el('div', { class: 'painel-grade doc-grade' }, [
      cartao(ic.mapa(22), 'Mapa visual', `Bateria ${contratoAtivo().bateria} com andaime, demolição, assentamento e revestimento de cada primária.`, [
        el('div', { class: 'toolbar' }, [botaoPdf('PDF do mapa', () => imprimirMapa(calc))]),
        excel('gestao')
      ]),
      cartao(ic.curva(22), 'Curva S', `Contrato inteiro, como na planilha: ${curvaContrato(calc).realizado} de ${curvaContrato(calc).total} fornos revestidos.`, [
        el('div', { class: 'toolbar' }, [botaoPdf('PDF da Curva S', () => imprimirCurva(calc))]),
        excel('curva')
      ]),
      cartao(ic.camera(22), 'Checklist de entrega', `${qtd(rel.length, 'forno')} no BM ${rotuloBm(bmEscolhido)}; ${comFotos.length} com fotos no app.`, [
        el('div', { class: 'toolbar' }, [
          botaoPdf(`PDF do BM (${qtd(comFotos.length, 'forno')})`, () => comFotos.length ? ocupar('pdf-bm', async () => {
            const r = await pdfChecklists(comFotos, { reduzido: true });
            baixar(r.blob, `Checklists BM ${rotuloBm(bmEscolhido).replace('/', ' ')}.pdf`, 'application/pdf');
          }) : toast('Nenhum forno deste BM tem fotos no app.', 'info'), 'pdf-bm')
        ]),
        rel.length
          ? el('div', { class: 'doc-lista' }, rel.map((r) => el('div', { class: 'doc-linha' }, [
              el('span', { class: 'strong' }, rotulo(r.fid)),
              el('span', { class: 'fraco' }, r.checklist?.numero ? `nº ${r.checklist.numero}` : 'sem nº'),
              statusChip(r.checklist?.status || 'pendente', r.checklist?.origem === 'planilha' ? 'Planilha' : NOME_STATUS[r.checklist?.status || 'pendente']),
              r.checklist && r.checklist.origem !== 'planilha'
                ? botaoPdf('PDF', () => ocupar(`pdf-${r.fid}`, async () => {
                    const x = await pdfChecklists([r]);
                    baixar(x.blob, `Checklist ${r.fid}${r.checklist?.numero ? ` n${r.checklist.numero}` : ''}.pdf`, 'application/pdf');
                  }), `pdf-${r.fid}`)
                : el('span')
            ])))
          : el('div', { class: 'vazio-convite' }, [el('strong', {}, 'Nenhum forno fechado neste BM'), 'Quando a última massa 1200 de um forno for lançada, ele entra aqui.'])
      ]),
      cartao(ic.documento(22), `Espelho da medição · BM ${rotuloBm(bmEscolhido)}`, 'Relação dos fornos reparados no período, com o nº e o status do checklist (o resumo enviado à Ternium).', [
        el('div', { class: 'toolbar' }, [botaoPdf('PDF do espelho', () => imprimirEspelho(calc, bmEscolhido))]),
        excel('resumo', null, { bm: bmEscolhido })
      ]),
      cartao(ic.diario(22), 'RDO', 'Relatório diário de obra igual à planilha PLAN-RFX-002. Cada RDO fechado no app vira uma aba nova, depois da última.', [
        el('div', { class: 'toolbar' }, [el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => ir('rdo') }, [el('span', { html: ic.diario(15), style: { display: 'inline-flex' } }), 'Abrir o RDO do dia'])]),
        excel('rdo')
      ])
    ])
  ];
}

// ---------------------------------------------------------------------------
// Folhas para imprimir ou salvar em PDF
// ---------------------------------------------------------------------------
function imprimirMapa(calc) {
  const bat = contratoAtivo().bateria;
  const cont = contagemPorEtapa(calc, bat);
  const total = cont.reduce((s, n) => s + n, 0);
  abrirImpressao({
    titulo: `Mapa visual · Bateria ${bat}`,
    subtitulo: `${contratoAtivo().nome} · situação em ${completa(hoje())}`,
    paisagem: true,
    conteudo: [
      legendaEtapas(),
      mapaBateria(calc, bat, { grande: true }),
      el('table', { class: 'doc-tabela' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Situação (etapa mais avançada)'), el('th', { class: 'n' }, 'Primárias'), el('th', { class: 'n' }, '%')])),
        el('tbody', {}, [
          el('tr', {}, [el('td', {}, 'Pendente'), el('td', { class: 'n' }, String(cont[0])), el('td', { class: 'n' }, `${Math.round((cont[0] / total) * 100)}%`)]),
          ...ETAPAS_MAPA.map((e, i) => el('tr', {}, [el('td', {}, e.nome), el('td', { class: 'n' }, String(cont[i + 1])), el('td', { class: 'n' }, `${Math.round((cont[i + 1] / total) * 100)}%`)]))
        ])
      ])
    ]
  });
}

function imprimirCurva(calc) {
  const c = curvaContrato(calc);
  abrirImpressao({
    titulo: 'Curva S de revestimento',
    subtitulo: `${contratoAtivo().nome} · previsto ${c.total} fornos · realizado ${c.realizado} · situação em ${completa(hoje())}`,
    paisagem: true,
    conteudo: [graficoCurvaS(c, { atualizadoEm: carimboAgora(), altura: 430 })]
  });
}

function imprimirEspelho(calc, bmId) {
  const itens = relacaoDoBm(calc, bmId);
  const { inicio, fim } = periodoBm(bmId);
  const linha = (it, i) => el('tr', {}, [
    el('td', { class: 'n' }, String(i + 1)),
    el('td', { class: 'n' }, it.checklist?.numero ? String(it.checklist.numero) : ''),
    el('td', {}, localMedicao(it.fid)),
    el('td', {}, it.checklist?.status === 'aprovado' ? 'APROVADO' : 'PENDENTE')
  ]);
  const tabela = (lista, ini) => el('table', { class: 'doc-tabela' }, [
    el('thead', {}, el('tr', {}, ['Item', 'Nº do checklist', 'Localização', 'Status do checklist'].map((t, i) => el('th', { class: i < 2 ? 'n' : '' }, t)))),
    el('tbody', {}, lista.map((it, k) => linha(it, ini + k)))
  ]);
  const metade = Math.ceil(itens.length / 2);
  abrirImpressao({
    titulo: 'Relatório do serviço de substituição das primárias',
    subtitulo: 'e revestimento das abóbadas dos fornos da coqueria',
    conteudo: [
      el('dl', { class: 'doc-dados' }, [
        el('dt', {}, 'Contratante:'), el('dd', {}, CLIENTE),
        el('dt', {}, 'Contratada:'), el('dd', {}, 'Reframax Engenharia Ltda.'),
        el('dt', {}, 'Contrato:'), el('dd', {}, SERVICO),
        el('dt', {}, 'Período:'), el('dd', {}, `${completa(inicio)} a ${completa(fim)}`),
        el('dt', {}, 'Mês de referência:'), el('dd', {}, referenciaBm(bmId))
      ]),
      el('h2', {}, 'Relação dos fornos reparados no período de medição'),
      itens.length
        ? el('div', { class: 'doc-colunas' }, [tabela(itens.slice(0, metade), 0), tabela(itens.slice(metade), metade)])
        : el('p', {}, 'Nenhum forno concluído neste período.'),
      el('div', { class: 'doc-totais' }, [el('span', {}, ['Total geral (fornos): ', el('b', {}, String(itens.length))])]),
      el('div', { class: 'doc-ass' }, [el('div', {}, 'Contratada (Reframax) · data, assinatura e carimbo'), el('div', {}, 'Contratante (Ternium) · data, assinatura e carimbo')])
    ]
  });
}
