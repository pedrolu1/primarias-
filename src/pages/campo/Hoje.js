// Hoje: a meta da semana, a frente de serviço com a próxima etapa a um toque
// e o que a equipe está lançando agora.
import { el } from '../../base/dom.js';
import { anel, seis, statusChip } from '../../components/base.js';
import { feed } from '../../components/feed.js';
import { abrirPedidoCorrecao } from '../../components/correcao.js';
import { abrirTelaForno } from '../../components/telaForno.js';
import { abrirLancamento } from '../../components/lancar.js';
import { iconeEtapa, ic } from '../../lib/icones.js';
import { ETAPAS_MAPA, FORNOS, LADOS, contratoAtivo, etapaPorId, noMeio, rotulo } from '../../data/obra.js';
import { semanaAtual, proximaDoLado, resumoAlvos, checklists } from '../../lib/calculo.js';
import { hoje, porExtenso } from '../../lib/datas.js';

export function paginaHoje({ calc, perfil, stats, lancar, ir, redesenhar }) {
  const bat = contratoAtivo().bateria;
  const sem = semanaAtual(calc);
  const fornosBat = FORNOS.filter((f) => f.bateria === bat);
  const concluidos = fornosBat.filter((f) => calc.fornos[f.id].concluidoEm).length;
  const bateu = sem.meta > 0 && sem.fechados >= sem.meta;
  const hj = hoje();
  const equipeHoje = calc.validos.filter((l) => l.data === hj).reduce((s, l) => s + l.prims.length, 0);

  // a temperatura e a sequência já ficam no topo da tela; aqui só o que
  // ajuda a decidir o próximo lançamento, para a frente de serviço subir
  const hero = el('section', { class: 'semana-hero' }, [
    anel({ fracao: sem.meta ? sem.fechados / sem.meta : 0, tamanho: 84, espessura: 9, chave: 'semana', centro: [el('span', { class: 'num' }, String(sem.fechados)), el('small', {}, `de ${sem.meta}`)] }),
    el('div', {}, [
      el('h2', {}, `Semana ${sem.semana.replace('S-', '')}`),
      el('p', {}, bateu ? [el('span', { class: 'meta-ok' }, 'Meta batida. '), 'Cada forno a mais é saldo.'] : sem.meta ? `Faltam ${sem.meta - sem.fechados} forno${sem.meta - sem.fechados > 1 ? 's' : ''} para a meta da semana.` : 'Sem meta prevista nesta semana.')
    ]),
    el('div', { class: 'semana-numeros' }, [
      el('div', {}, [el('span', { class: 'num' }, String(stats.hojeEtapas)), el('small', {}, 'suas etapas hoje')]),
      el('div', {}, [el('span', { class: 'num' }, String(equipeHoje)), el('small', {}, 'da equipe hoje')]),
      el('div', {}, [el('span', { class: 'num' }, [String(concluidos), el('small', {}, `/${fornosBat.length}`)]), el('small', {}, `fornos da bateria ${bat}`)])
    ])
  ]);

  return [
    el('p', { class: 'fraco', style: { fontSize: '14px', marginBottom: '-6px' } }, `Bom trabalho, ${perfil.nome}. Hoje é ${porExtenso(hj)}.`),
    hero,
    fotosPendentes(calc, ir),
    frente(calc, fornosBat, perfil, redesenhar),
    el('section', { class: 'pilha' }, [
      el('div', { class: 'titulo-secao' }, ['Ao vivo na bateria', el('span', { class: 'ao-vivo' }, 'tempo real')]),
      feed(calc.validos, {
        vazio: el('div', { class: 'vazio-convite' }, [el('strong', {}, 'Ninguém lançou ainda'), 'O primeiro lançamento do dia acende o mapa para toda a equipe.', el('button', { class: 'btn btn-primary', type: 'button', onclick: () => lancar() }, 'Lançar agora')])
      })
    ]),
    meusLancamentos(calc, perfil)
  ];
}

const NA_TELA = 5;
let frenteToda = false;

/** A próxima etapa do forno: a do lado mais atrasado (é o que segura o forno).
 *  Se o outro lado está na mesma etapa, entram os dois. */
function proximaDoForno(calc, fid) {
  const lados = LADOS.map((l) => ({ lado: l.id, prox: proximaDoLado(calc, fid, l.id) })).filter((x) => x.prox);
  if (!lados.length) return null;
  const ordem = Math.min(...lados.map((x) => etapaPorId[x.prox.etapa.id].ordem));
  const juntos = lados.filter((x) => etapaPorId[x.prox.etapa.id].ordem === ordem);
  return { etapa: juntos[0].prox.etapa, alvos: juntos.flatMap((x) => x.prox.alvos), lados: juntos.map((x) => x.lado) };
}

/** Fornos com serviço começado e ainda não concluídos. Toque no forno abre a
 *  tela dele; o botão lança direto a próxima etapa, já na confirmação. */
function frente(calc, fornosBat, perfil, redesenhar) {
  const ultimo = ETAPAS_MAPA.length - 1;
  const abertos = fornosBat
    .filter((f) => !calc.fornos[f.id].concluidoEm && calc.fornos[f.id].niveis.some((n) => n >= 0))
    .map((f) => ({ f, soma: calc.fornos[f.id].niveis.reduce((s, n) => s + n + 1, 0) }))
    .sort((a, b) => b.soma - a.soma || a.f.id.localeCompare(b.f.id))
    .map((x) => x.f);
  let lista = abertos;
  let titulo = 'Na frente de serviço';
  if (!lista.length) {
    lista = fornosBat.filter((f) => !calc.fornos[f.id].concluidoEm).slice(0, 3);
    titulo = 'Próximos fornos';
  }
  if (!lista.length) return null;
  const sobra = lista.length - NA_TELA;
  const visiveis = frenteToda || sobra <= 1 ? lista : lista.slice(0, NA_TELA);
  return el('section', { class: 'pilha' }, [
    el('div', { class: 'titulo-secao' }, [titulo, el('small', {}, abertos.length ? `${abertos.length} forno${abertos.length > 1 ? 's' : ''} aberto${abertos.length > 1 ? 's' : ''}` : 'toque para abrir')]),
    el('div', { class: 'frente' }, visiveis.map((f) => {
      const niveis = calc.fornos[f.id].niveis;
      const prontas = niveis.filter((n) => n === ultimo).length;
      const faltam = niveis.reduce((s, n) => s + (ultimo - n), 0);
      const prox = proximaDoForno(calc, f.id);
      return el('div', { class: 'forno-linha', role: 'button', tabindex: '0', 'aria-label': `Abrir ${rotulo(f.id)}`, onclick: () => abrirTelaForno(f.id, { perfil }), onkeydown: (ev) => ev.key === 'Enter' && abrirTelaForno(f.id, { perfil }) }, [
        el('div', { class: 'nome' }, [`F${String(f.forno).padStart(2, '0')}`, el('small', {}, `bloco ${f.bloco}`)]),
        seis(calc, f.id),
        el('div', { class: 'rodape' }, [
          el('span', {}, prontas ? `${prontas} de 6 prontas · faltam ${faltam} etapas` : `faltam ${faltam} etapas para fechar`),
          prox ? el('button', {
            class: `proxima cor-${prox.etapa.id}`, type: 'button',
            onclick: (ev) => { ev.stopPropagation(); abrirLancamento({ perfil, etapa: prox.etapa.id, fornoId: f.id, alvos: prox.alvos }); }
          }, [
            el('span', { html: iconeEtapa(prox.etapa.id, 16), style: { display: 'inline-flex', color: 'var(--cor)' } }),
            `Lançar ${noMeio(prox.etapa)}`,
            prox.lados.length === 1 ? el('small', {}, prox.lados[0]) : null
          ]) : null
        ])
      ]);
    })),
    sobra > 1 ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { frenteToda = !frenteToda; redesenhar(); } }, frenteToda ? 'Mostrar menos' : `Ver os outros ${sobra} fornos`) : null
  ]);
}

/** Fornos que esperam as fotos do checklist (devolvidos primeiro). */
function fotosPendentes(calc, ir) {
  const ck = checklists(calc);
  const devolvidos = Object.values(ck).filter((c) => c.status === 'devolvido').length;
  const semFotos = Object.values(ck).filter((c) => c.concluidoEm && ['pendente', 'rascunho'].includes(c.status)).length;
  if (!devolvidos && !semFotos) return null;
  return el('button', { type: 'button', class: 'cartao-fotos', onclick: () => ir('fotos') }, [
    el('span', { class: 'cartao-fotos-icone', html: ic.camera(26) }),
    el('div', {}, [
      el('strong', {}, devolvidos ? `${devolvidos} checklist${devolvidos > 1 ? 's' : ''} devolvido${devolvidos > 1 ? 's' : ''}` : `${semFotos} forno${semFotos > 1 ? 's' : ''} esperando fotos`),
      el('small', {}, devolvidos ? 'O planejador pediu ajuste nas fotos.' : 'Forno concluído precisa das 8 fotos para entrar na medição.')
    ]),
    el('span', { html: ic.chevronLeft(18), style: { transform: 'scaleX(-1)', display: 'inline-flex' } })
  ]);
}

function meusLancamentos(calc, perfil) {
  const hj = hoje();
  const meus = calc.estado.lancamentos.filter((l) => l.autor?.uid === perfil.uid && (l.data === hj || l.criadoEmLocal > Date.now() - 36 * 3600 * 1000)).sort((a, b) => b.criadoEmLocal - a.criadoEmLocal);
  if (!meus.length) return null;
  const pedidos = calc.estado.correcoes;
  return el('section', { class: 'pilha' }, [
    el('div', { class: 'titulo-secao' }, ['Meus lançamentos', el('small', {}, 'só o planejador altera')]),
    el('div', { class: 'card card-pad', style: { padding: '4px 14px' } }, meus.slice(0, 8).map((l) => {
      const e = etapaPorId[l.etapa];
      const pedido = pedidos.filter((c) => c.lancId === l.id).pop();
      let estado = null;
      if (l.status === 'cancelado') estado = el('span', { class: 'estado estado-cancelado' }, 'Apagado pelo planejador');
      else if (pedido?.status === 'pendente') estado = statusChip('pendente', 'Correção pedida');
      else if (pedido?.status === 'recusada') estado = el('span', { class: 'estado fraco', title: pedido.resposta }, 'Pedido recusado');
      return el('div', { class: 'meu-lanc' }, [
        el('div', {}, [
          el('span', { class: `etiqueta-etapa cor-${e.id}` }, [el('span', { class: 'ponto' }), `${e.curto} · ${l.prims.length}`]),
          el('div', { class: 'alvos' }, resumoAlvos(l.prims, l.etapa).join(', '))
        ]),
        estado || el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => abrirPedidoCorrecao(l, perfil) }, [el('span', { html: ic.pedido(15) }), 'Corrigir'])
      ]);
    }))
  ]);
}
