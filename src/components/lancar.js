// Fluxo de lançamento: etapa → onde → confirmar. Pensado para o celular, com
// botões grandes, o caminho mais curto já selecionado e o aviso de forno fechado no fim.
// Vindo do botão de um forno (etapa e forno já sabidos), abre direto na
// confirmação, com as primárias para ajustar ali mesmo. O 5S (limpeza e
// organização) também sai daqui: local, dia e observação, e vai para o RDO.
import { el } from '../base/dom.js';
import { abrirFolha, seis, etiquetaEtapa } from './base.js';
import { ic, iconeEtapa } from '../lib/icones.js';
import { ETAPAS, etapaPorId, FORNOS, blocosDa, contratoAtivo, fornoPorId, primariaPorId, primariasDoAlvo, NIVEL_NOME, noMeio, LOCAIS_5S } from '../data/obra.js';
import { calcular, alvosDoForno, resumoAlvos, efeitosDoLancamento, descreverLocais5S } from '../lib/calculo.js';
import { estadoAtual, lancar, registrarOcorrencia } from '../lib/banco.js';
import { hoje, somarDias, completa } from '../lib/datas.js';
import { vibrar, tocar, comemorar } from '../lib/efeitos.js';
import { autorDe } from '../lib/acesso.js';

const liberadosNoForno = (calc, etapaId, fid) => alvosDoForno(calc, etapaId, fid).filter((a) => a.ok);
const primariasLiberadas = (calc, etapaId, fornos) => fornos.reduce((s, f) => s + liberadosNoForno(calc, etapaId, f.id).reduce((t, a) => t + primariasDoAlvo(a.id).length, 0), 0);

/** Deixa o bloco escolhido visível no trilho (ele pode estar fora da tela, à direita). */
export function mostrarBlocoAtivo(raiz) {
  const ativo = raiz.querySelector('.blocos-trilho .bloco-op.ativo');
  const trilho = ativo?.parentElement;
  if (trilho) trilho.scrollLeft = ativo.offsetLeft - trilho.clientWidth / 2 + ativo.offsetWidth / 2;
}

/**
 * Abre o lançamento. Com `etapa` e `fornoId` já vem na confirmação, com o
 * forno escolhido; `alvos` restringe a seleção (ex.: só o lado máquina).
 */
export function abrirLancamento({ perfil, etapa = null, fornoId = null, alvos = null, aoLancar = null, cincoS = false }) {
  const bat = contratoAtivo().bateria;
  const fornosBat = FORNOS.filter((f) => f.bateria === bat);
  const st = { passo: cincoS ? '5s' : etapa ? 2 : 1, etapa, bloco: fornoId ? fornoPorId[fornoId].bloco : null, sel: new Map(), data: hoje(), outroDia: false, obs: '', locais: new Set(), lajes: new Set(), fornos5S: new Set(), bloco5S: null };
  if (etapa && fornoId) {
    const lib = liberadosNoForno(calcular(estadoAtual()), etapa, fornoId).map((a) => a.id).filter((id) => !alvos || alvos.includes(id));
    if (lib.length) {
      st.sel.set(fornoId, new Set(lib));
      st.passo = 3;
    }
  }
  const folha = abrirFolha({ titulo: '', corpo: [], classe: 'folha-lancar' });
  let passoDesenhado = 0;

  function totalPrims() {
    return [...st.sel.values()].reduce((s, alvos) => s + [...alvos].reduce((t, a) => t + primariasDoAlvo(a).length, 0), 0);
  }
  const alvosEscolhidos = () => [...st.sel.values()].flatMap((s) => [...s]);
  const voltarParaOnde = () => {
    for (const [fid, alvos] of st.sel) if (!alvos.size) st.sel.delete(fid);
    st.passo = 2;
    desenhar();
  };
  const passos = () => el('div', { class: 'passos', 'aria-hidden': 'true' }, [1, 2, 3].map((n) => el('span', { class: n < st.passo ? 'feito' : n === st.passo ? 'atual' : '' })));
  desenhar();

  function desenhar() {
    const calc = calcular(estadoAtual());
    // trocou de passo: volta ao topo; redesenho do mesmo passo mantém a rolagem
    st.topo = passoDesenhado !== st.passo;
    passoDesenhado = st.passo;
    if (st.passo === 1) passoEtapa(calc);
    else if (st.passo === '5s') passo5S(calc);
    else if (st.passo === 2) passoOnde(calc);
    else passoConfirmar(calc);
  }

  // ---- 1. O que foi feito ----
  function passoEtapa(calc) {
    folha.montar({
      topo: st.topo,
      titulo: 'O que foi feito?',
      subtitulo: `Bateria ${bat} · ${completa(st.data)}`,
      corpo: [
        passos(),
        el('div', { class: 'etapa-grade' }, ETAPAS.map((e, i) => {
          const livres = primariasLiberadas(calc, e.id, fornosBat);
          return el('button', {
            type: 'button', class: `etapa-op cor-${e.id}`,
            onclick: () => {
              vibrar(8);
              st.etapa = e.id;
              st.sel.clear();
              st.bloco = melhorBloco(calc, e.id);
              st.passo = 2;
              desenhar();
            }
          }, [
            el('span', { class: 'ordem' }, String(i + 1)),
            el('span', { class: 'icone', html: iconeEtapa(e.id, 22) }),
            el('div', {}, [el('strong', {}, e.curto), el('small', {}, NIVEL_NOME[e.nivel])]),
            el('span', { class: 'pend' }, livres ? `${livres} primárias liberadas` : 'Nada liberado agora')
          ]);
        })),
        el('button', { type: 'button', class: 'etapa-op op-5s', onclick: () => { vibrar(8); st.passo = '5s'; desenhar(); } }, [
          el('span', { class: 'icone', html: ic.vassoura(22) }),
          el('div', {}, [el('strong', {}, '5S · Limpeza e organização'), el('small', {}, 'Intermediária, interligação, laje entre blocos ou fornos')])
        ])
      ]
    });
  }

  function melhorBloco(calc, etapaId) {
    const conta = blocosDa(bat).map((bl) => [bl, primariasLiberadas(calc, etapaId, fornosBat.filter((f) => f.bloco === bl))]);
    const comAlgo = conta.filter((c) => c[1] > 0);
    return (comAlgo[0] || conta[0])[0];
  }

  // ---- 2. Onde ----
  function passoOnde(calc) {
    const e = etapaPorId[st.etapa];
    if (!st.bloco) st.bloco = melhorBloco(calc, e.id);
    const fornosBloco = fornosBat.filter((f) => f.bloco === st.bloco);
    const n = totalPrims();
    folha.montar({
      topo: st.topo,
      titulo: e.curto,
      subtitulo: `Bloco ${st.bloco} · escolha ${e.nivel === 'forno' ? 'os fornos' : e.nivel === 'cabeceira' ? 'os fornos e os lados' : 'os fornos e as primárias'}`,
      corpo: [
        el('div', { class: 'entre' }, [passos(), el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { st.passo = 1; desenhar(); } }, 'Trocar etapa')]),
        el('div', { class: 'blocos-trilho', role: 'tablist', 'aria-label': 'Blocos' }, blocosDa(bat).map((bl) => {
          const fs = fornosBat.filter((f) => f.bloco === bl);
          const livres = primariasLiberadas(calc, e.id, fs);
          const feitos = calc.blocos[bl].concluidos;
          const qtdSel = fs.filter((f) => st.sel.has(f.id)).length;
          return el('button', { type: 'button', role: 'tab', 'aria-selected': String(bl === st.bloco), class: `bloco-op${bl === st.bloco ? ' ativo' : ''}`, onclick: () => { st.bloco = bl; desenhar(); } }, [
            bl,
            el('i', {}, el('b', { style: { width: `${(feitos / 18) * 100}%` } })),
            el('small', {}, qtdSel ? `${qtdSel} escolhido${qtdSel > 1 ? 's' : ''}` : livres ? `${livres} livres` : 'nada livre')
          ]);
        })),
        el('div', { class: 'fornos-grade' }, fornosBloco.map((f) => {
          const lib = liberadosNoForno(calc, e.id, f.id);
          const marcado = st.sel.has(f.id);
          const todos = alvosDoForno(calc, e.id, f.id);
          const motivo = lib.length ? '' : todos.every((a) => a.feito) ? 'feito' : todos[0]?.motivo || '';
          return el('button', {
            type: 'button', class: `forno-op${marcado ? ' sel' : ''}`, disabled: !lib.length, 'aria-pressed': String(marcado),
            onclick: () => {
              vibrar(8);
              if (marcado) st.sel.delete(f.id);
              else st.sel.set(f.id, new Set(lib.map((a) => a.id)));
              desenhar();
            }
          }, [el('strong', {}, `F${String(f.forno).padStart(2, '0')}`), seis(calc, f.id), motivo ? el('span', { class: 'motivo' }, motivo) : null]);
        })),
        ...[...st.sel.keys()].map((fid) => ajusteForno(calc, e, fid))
      ],
      pe: [el('button', { type: 'button', class: 'btn btn-brasa', disabled: !n, onclick: () => { st.passo = 3; desenhar(); } }, n ? `Continuar · ${n} primária${n > 1 ? 's' : ''}` : 'Escolha onde foi feito')]
    });
    mostrarBlocoAtivo(folha.caixa);
  }

  /** Ajuste fino do forno escolhido: quais primárias (ou lados) entram.
   *  Na confirmação não tem "Tirar": desmarcar tudo só desliga o botão. */
  function ajusteForno(calc, e, fid, { naConfirmacao = false } = {}) {
    const escolhidos = st.sel.get(fid);
    const alvos = alvosDoForno(calc, e.id, fid);
    const alternar = (id) => {
      vibrar(6);
      if (escolhidos.has(id)) escolhidos.delete(id);
      else escolhidos.add(id);
      if (!escolhidos.size && !naConfirmacao) st.sel.delete(fid);
      desenhar();
    };
    const botao = (a, rotulo, extra = '') => el('button', {
      type: 'button', class: `prim-op cor-${e.id}${escolhidos.has(a.id) ? ' sel' : ''}${a.feito ? ' feita' : ''} ${extra}`,
      disabled: !a.ok, 'aria-pressed': String(escolhidos.has(a.id)), title: a.ok ? '' : a.motivo, onclick: () => alternar(a.id)
    }, rotulo);
    let conteudo;
    if (e.nivel === 'forno') conteudo = el('p', { class: 'fraco', style: { fontSize: '13.5px' } }, 'Vale para as 6 primárias do forno.');
    else if (e.nivel === 'cabeceira') conteudo = el('div', { class: 'lados' }, alvos.map((a) => el('div', { class: 'lado-caixa' }, [el('span', {}, a.id.endsWith('LM') ? 'Lado máquina' : 'Lado coque'), botao(a, a.id.slice(-2), 'cab-op')])));
    else conteudo = el('div', { class: 'lados' }, ['LM', 'LC'].map((lado) => el('div', { class: 'lado-caixa' }, [
      el('span', {}, lado === 'LM' ? 'Lado máquina' : 'Lado coque'),
      el('div', { class: 'prims-op' }, alvos.filter((a) => primariaPorId[a.id].lado === lado).map((a) => botao(a, `P0${primariaPorId[a.id].p}`)))
    ])));
    const bloqueadas = alvos.filter((a) => !a.ok && !a.feito);
    return el('div', { class: 'selecao-forno' }, [
      el('div', { class: 'selecao-forno-topo' }, [
        naConfirmacao ? `${fid.replace('-', ' · ')} · toque para tirar ou pôr` : fid.replace('-', ' · '),
        naConfirmacao ? null : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { st.sel.delete(fid); desenhar(); } }, 'Tirar')
      ]),
      conteudo,
      bloqueadas.length ? el('div', { class: 'bloqueado-nota' }, [el('span', { html: ic.lock(14) }), `${bloqueadas.map((a) => a.id.split('-').slice(2).join(' ')).join(', ')}: ${bloqueadas[0].motivo}`]) : null
    ]);
  }

  // ---- 3. Confirmar ----
  function passoConfirmar(calc) {
    const e = etapaPorId[st.etapa];
    const alvos = alvosEscolhidos();
    const prims = [...new Set(alvos.flatMap(primariasDoAlvo))];
    const n = prims.length;
    const fornos = [...st.sel.values()].filter((s) => s.size).length;
    const umForno = st.sel.size === 1 ? [...st.sel.keys()][0] : null;
    const botao = el('button', { type: 'button', class: 'btn btn-brasa', disabled: !n, onclick: () => confirmar(botao) }, n ? [el('span', { html: iconeEtapa(e.id, 22) }), `Lançar ${noMeio(e)}`] : 'Marque o que foi feito');
    folha.montar({
      topo: st.topo,
      titulo: 'Confere e lança',
      subtitulo: 'Depois de lançado, só o planejador altera',
      corpo: [
        el('div', { class: 'entre' }, [passos(), el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: voltarParaOnde }, umForno ? 'Outro forno' : 'Voltar')]),
        el('div', { class: `resumo-lanc cor-${e.id}` }, [
          etiquetaEtapa(e),
          el('div', {}, [el('span', { class: 'contagem' }, String(n)), el('span', { class: 'fraco' }, ` primária${n === 1 ? '' : 's'} em ${fornos} forno${fornos === 1 ? '' : 's'}`)]),
          umForno ? null : el('ul', {}, resumoAlvos(prims, e.id).map((l) => el('li', {}, [el('span', { class: 'ponto' }), l])))
        ]),
        umForno ? ajusteForno(calc, e, umForno, { naConfirmacao: true }) : null,
        campoDia(),
        campoObs('Ex.: manilha trincada no P02, trocada')
      ],
      pe: [botao]
    });
  }

  function campoDia() {
    const dia = (rotuloDia, data) => el('button', {
      type: 'button', class: `tipo-op${!st.outroDia && st.data === data ? ' ativo' : ''}`, 'aria-pressed': String(!st.outroDia && st.data === data),
      onclick: () => { st.data = data; st.outroDia = false; desenhar(); }
    }, rotuloDia);
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, 'Dia em que foi feito'),
      el('div', { class: 'tipos-ocorrencia' }, [
        dia('Hoje', hoje()),
        dia('Ontem', somarDias(hoje(), -1)),
        el('button', { type: 'button', class: `tipo-op${st.outroDia ? ' ativo' : ''}`, 'aria-pressed': String(st.outroDia), onclick: () => { st.outroDia = true; desenhar(); } }, 'Outro dia')
      ]),
      st.outroDia ? el('input', { id: 'lanc-data', class: 'input', type: 'date', 'aria-label': 'Dia em que foi feito', value: st.data, max: hoje(), min: somarDias(hoje(), -7), onchange: (ev) => { st.data = ev.target.value || hoje(); } }) : null
    ]);
  }

  function campoObs(exemplo) {
    return el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'lanc-obs' }, 'Observação (vai para o RDO)'),
      el('textarea', { id: 'lanc-obs', class: 'textarea', rows: 2, placeholder: exemplo, value: st.obs, oninput: (ev) => { st.obs = ev.target.value; } })
    ]);
  }

  // ---- 5S: onde foi feito ----
  function passo5S(calc) {
    const blocos = blocosDa(bat);
    // lajes entre blocos vizinhos da mesma metade da bateria (a via separa as metades)
    const pares = [blocos.slice(0, 4), blocos.slice(4)].flatMap((m) => m.slice(0, -1).map((b, i) => `${b}-${m[i + 1]}`));
    st.bloco5S ||= blocos.find((bl) => !calc.blocos[bl].concluidoEm) || blocos[0];
    const alternar = (conj, v) => { vibrar(6); if (conj.has(v)) conj.delete(v); else conj.add(v); desenhar(); };
    const chip = (ativo, rotulo, fn) => el('button', { type: 'button', class: `tipo-op${ativo ? ' ativo' : ''}`, 'aria-pressed': String(ativo), onclick: fn }, rotulo);
    const locais = montarLocais5S();
    const falta = st.locais.has('laje') && !st.lajes.size ? 'Escolha entre quais blocos' : st.locais.has('fornos') && !st.fornos5S.size ? 'Escolha os fornos' : !locais.length ? 'Escolha onde foi feito' : '';
    const botao = el('button', { type: 'button', class: 'btn btn-brasa', disabled: Boolean(falta), onclick: () => registrar5S(botao, locais) }, falta || [el('span', { html: ic.vassoura(22) }), 'Registrar 5S']);
    folha.montar({
      topo: st.topo,
      titulo: '5S · Limpeza e organização',
      subtitulo: 'Onde a equipe fez? Pode marcar mais de um.',
      corpo: [
        el('div', { class: 'entre' }, [el('span'), el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { st.passo = 1; desenhar(); } }, 'Trocar o que foi feito')]),
        el('div', { class: 'locais-5s' }, LOCAIS_5S.map((l) => chip(st.locais.has(l.id), l.nome, () => alternar(st.locais, l.id)))),
        st.locais.has('laje') ? el('div', { class: 'field' }, [
          el('span', { class: 'field-label' }, 'Laje entre quais blocos?'),
          el('div', { class: 'tipos-ocorrencia' }, pares.map((par) => chip(st.lajes.has(par), par.replace('-', ' e '), () => alternar(st.lajes, par))))
        ]) : null,
        st.locais.has('fornos') ? el('div', { class: 'field' }, [
          el('span', { class: 'field-label' }, `Quais fornos?${st.fornos5S.size ? ` (${st.fornos5S.size} marcado${st.fornos5S.size > 1 ? 's' : ''})` : ''}`),
          el('div', { class: 'blocos-trilho', role: 'tablist', 'aria-label': 'Blocos' }, blocos.map((bl) => {
            const marcados = [...st.fornos5S].filter((f) => f.startsWith(`${bl}-`)).length;
            return el('button', { type: 'button', role: 'tab', 'aria-selected': String(bl === st.bloco5S), class: `bloco-op${bl === st.bloco5S ? ' ativo' : ''}`, onclick: () => { st.bloco5S = bl; desenhar(); } }, [bl, el('small', {}, marcados ? `${marcados} marcado${marcados > 1 ? 's' : ''}` : '')]);
          })),
          el('div', { class: 'grade-fornos' }, fornosBat.filter((f) => f.bloco === st.bloco5S).map((f) => {
            const marcado = st.fornos5S.has(f.id);
            return el('button', { type: 'button', class: `sopro-op${marcado ? ' ativo' : ''}`, 'aria-pressed': String(marcado), onclick: () => alternar(st.fornos5S, f.id) }, `F${String(f.forno).padStart(2, '0')}`);
          }))
        ]) : null,
        locais.length ? el('p', { class: 'resumo-5s' }, `Vai para o RDO: a equipe realizou 5S ${descreverLocais5S(locais)}.`) : null,
        campoDia(),
        campoObs('Ex.: retirada de resíduos para a caçamba')
      ],
      pe: [botao]
    });
    mostrarBlocoAtivo(folha.caixa);
  }

  function montarLocais5S() {
    const l = [];
    if (st.locais.has('intermediaria')) l.push('intermediaria');
    if (st.locais.has('interligacao')) l.push('interligacao');
    if (st.locais.has('laje')) l.push(...[...st.lajes].sort().map((p) => `laje:${p}`));
    if (st.locais.has('fornos')) l.push(...[...st.fornos5S].sort().map((f) => `forno:${f}`));
    return l;
  }

  function registrar5S(botao, locais) {
    botao.disabled = true;
    registrarOcorrencia({ data: st.data, tipo: '5s', texto: st.obs.trim(), autor: autorDe(perfil), locais });
    vibrar([18, 30, 26]);
    tocar('ok');
    setTimeout(() => {
      folha.fechar();
      const aviso = el('div', { class: 'lancado-aviso', role: 'status' }, [
        el('span', { class: 'lancado-selo', style: { background: 'var(--accent-500)' }, html: ic.check(22) }),
        el('div', {}, [el('small', { style: { color: 'var(--text-1)' } }, '5S registrado'), el('strong', {}, 'Vai para o RDO do dia')])
      ]);
      document.body.appendChild(aviso);
      setTimeout(() => aviso.classList.add('saindo'), 2200);
      setTimeout(() => aviso.remove(), 2600);
    }, 250);
  }

  function confirmar(botao) {
    botao.disabled = true;
    const antes = calcular(estadoAtual());
    const lanc = lancar({ etapa: st.etapa, alvos: alvosEscolhidos(), data: st.data, obs: st.obs, autor: autorDe(perfil) });
    // o banco online só avisa a mudança um instante depois: calcula já com o
    // lançamento novo, para o aviso de forno fechado sair na hora
    const lancamentos = antes.estado.lancamentos.some((l) => l.id === lanc.id) ? antes.estado.lancamentos : [...antes.estado.lancamentos, lanc];
    const depois = calcular({ ...antes.estado, versao: `${antes.estado.versao}+${lanc.id}`, lancamentos });
    const ef = efeitosDoLancamento(antes, depois, lanc);
    const e = etapaPorId[st.etapa];

    vibrar([18, 30, 26]);
    tocar('ok');
    aoLancar?.(lanc);
    setTimeout(() => {
      folha.fechar();
      if (ef.blocos.length) comemorar({ titulo: `Bloco ${ef.blocos.join(', ')} concluído`, texto: 'Os 18 fornos do bloco estão com massa 1200.', grande: true });
      else if (ef.fornos.length) comemorar({ titulo: ef.fornos.length > 1 ? `${ef.fornos.length} fornos fechados` : `Forno ${ef.fornos[0].replace('-', ' ')} fechado`, texto: 'As 6 primárias com massa 1200. Já pode tirar as fotos do checklist.' });
      else avisoLancado(e, lanc.prims.length);
    }, 300);
  }

  function avisoLancado(e, n) {
    const aviso = el('div', { class: 'lancado-aviso', role: 'status' }, [
      el('span', { class: 'lancado-selo', style: { background: e.cor }, html: ic.check(22) }),
      el('div', {}, [el('small', { style: { color: 'var(--text-1)' } }, `${e.curto} lançada`), el('strong', {}, `${n} primária${n > 1 ? 's' : ''} no mapa`)])
    ]);
    document.body.appendChild(aviso);
    setTimeout(() => aviso.classList.add('saindo'), 2200);
    setTimeout(() => aviso.remove(), 2600);
  }
}
