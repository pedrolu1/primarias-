// Usuários (só administrador). No topo, o que pede atenção: pedidos de acesso
// e de senha nova. Embaixo, todas as pessoas, com busca e filtro: papel,
// situação (ativo ou bloqueado), senha provisória, editar nome e excluir.
// O dono do app (a primeira conta) ninguém altera; outro administrador, só o
// dono. As regras do banco e o servidor garantem o mesmo.
import { el } from '../../base/dom.js';
import { initials } from '../../base/format.js';
import { segmented } from '../../base/ui.js';
import { abrirFolha, statusChip } from '../../components/base.js';
import { ic } from '../../lib/icones.js';
import { PAPEIS } from '../../data/obra.js';
import {
  atualizarUsuario, excluirUsuario, redefinirSenha, statusServidor, assinarPedidosSenha, descartarPedidoSenha, modoDemo
} from '../../lib/acesso.js';
import { toast } from '../../base/toast.js';

const ERROS = {
  'sem-permissao': 'Sem permissão. Conta de administrador, só o dono do app muda.',
  'nao-configurado': 'O servidor ainda não tem a chave do Firebase (veja o aviso no topo desta página).',
  principal: 'A conta do dono do app não muda por aqui.',
  'propria-conta': 'Para a sua senha, use "Trocar minha senha" no seu perfil.',
  rede: 'Sem conexão. Tente de novo com internet.',
  usuario: 'Essa pessoa não tem mais cadastro.'
};
const erroDe = (err, padrao) => ERROS[err?.code] || padrao;

// estado da página (fica entre um desenho e outro)
let busca = '';
let filtro = 'todos';
let pedidosSenha = [];
let pararPedidos = null;
let servidor = null; // { configurado }
let ctxAtual = null;

const ms = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : null);
function quando(v) {
  const t = ms(v);
  if (!t) return 'nunca entrou';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 2) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
const sem = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function redesenhar() {
  if (ctxAtual && location.hash.slice(2) === 'usuarios') ctxAtual.redesenhar();
}

export function paginaUsuarios(ctx) {
  ctxAtual = ctx;
  const { usuarios, perfil } = ctx;
  if (!pararPedidos) {
    // marca antes de assinar: o aviso pode chegar na hora, ainda dentro deste desenho
    pararPedidos = () => {};
    pararPedidos = assinarPedidosSenha((lista) => {
      if (JSON.stringify(lista) === JSON.stringify(pedidosSenha)) return;
      pedidosSenha = lista;
      setTimeout(redesenhar, 0);
    });
  }
  if (!servidor) {
    servidor = { carregando: true };
    statusServidor().then((s) => {
      servidor = s;
      redesenhar();
    });
  }
  const souDono = usuarios.some((u) => u.dono && u.uid === perfil.uid) || Boolean(perfil.dono);
  const ordenar = (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
  const pedidosAcesso = usuarios.filter((u) => u.status === 'pendente').sort(ordenar);
  const pessoas = usuarios.filter((u) => u.status !== 'pendente');
  const ativos = pessoas.filter((u) => u.status === 'aprovado');
  const bloqueados = pessoas.filter((u) => u.status === 'negado');
  const pedidosDeSenha = pedidosSenha.filter((p) => usuarios.some((u) => u.uid === p.uid)).sort((a, b) => (ms(b.em) || 0) - (ms(a.em) || 0));

  // o que esta pessoa pode fazer com cada um
  const travaDe = (u) => {
    if (u.dono) return 'Dono do app: ninguém altera';
    if (u.uid === perfil.uid) return 'É você';
    if (u.papel === 'admin' && !souDono) return 'Administrador: só o dono altera';
    return null;
  };

  const pessoa = (u, extra = null) => el('div', { class: 'usuario-pessoa' }, [
    el('span', { class: `avatar${u.dono ? ' avatar-dono' : ''}` }, initials(u.nome || '?')),
    el('div', {}, [
      el('strong', {}, [u.nome || 'Sem nome', u.dono ? el('span', { class: 'selo-dono', title: 'Dono do app' }, 'Dono') : null, u.uid === perfil.uid ? el('span', { class: 'fraco' }, ' · você') : null]),
      el('small', {}, extra || `Matrícula ${u.matricula || '?'} · ${quando(u.ultimoAcessoEm)}`)
    ])
  ]);

  const seletorPapel = (u, valor, aoMudar, opcoes = {}) => el('select', {
    class: 'select input-compact usuario-papel', 'aria-label': `Papel de ${u.nome}`, disabled: opcoes.travado,
    onchange: (ev) => aoMudar(ev.target.value)
  }, Object.entries(PAPEIS).filter(([id]) => id !== 'admin' || souDono || valor === 'admin').map(([id, p]) => el('option', { value: id, selected: valor === id }, p.nome)));

  const mudar = async (u, mudancas, msg) => {
    try {
      await atualizarUsuario(u.uid, mudancas);
      toast(msg, 'ok');
    } catch (err) {
      toast(err?.code === 'permission-denied' ? ERROS['sem-permissao'] : 'Não consegui salvar. Confira a internet.', 'error');
    }
  };

  // ---------------------------------------------------------------------
  // o que pede atenção
  // ---------------------------------------------------------------------
  const escolhas = {};
  const linhasAcesso = pedidosAcesso.map((u) => {
    escolhas[u.uid] = u.papel || 'lider';
    return el('div', { class: 'usuario-linha pedido-acesso' }, [
      pessoa(u, `Matrícula ${u.matricula || '?'} · pediu acesso`),
      seletorPapel(u, escolhas[u.uid], (v) => { escolhas[u.uid] = v; }),
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => mudar(u, { status: 'negado' }, `${u.nome} não terá acesso.`) }, 'Negar'),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => mudar(u, { status: 'aprovado', papel: escolhas[u.uid] }, `${u.nome} liberado como ${PAPEIS[escolhas[u.uid]].nome.toLowerCase()}.`) }, [el('span', { html: ic.check(15), style: { display: 'inline-flex' } }), 'Liberar'])
      ])
    ]);
  });
  const linhasSenha = pedidosDeSenha.map((p) => {
    const u = usuarios.find((x) => x.uid === p.uid);
    const trava = travaDe(u);
    return el('div', { class: 'usuario-linha pedido-senha' }, [
      pessoa(u, `Matrícula ${u.matricula} · esqueceu a senha (${quando(p.em)})`),
      el('span', { class: 'fraco', style: { fontSize: '12.5px' } }, trava || ''),
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => descartarPedidoSenha(p.uid).then(() => toast('Pedido descartado.', 'ok')) }, 'Descartar'),
        trava ? null : el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => gerarSenha(u) }, [el('span', { html: ic.key(15), style: { display: 'inline-flex' } }), 'Gerar senha'])
      ])
    ]);
  });
  const atencao = linhasAcesso.length || linhasSenha.length
    ? el('section', { class: 'cartao cartao-atencao' }, [
        el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Pede a sua atenção'), el('p', {}, 'Quem pediu acesso ao Primárias e quem esqueceu a senha na tela de entrada.')]), el('span', { class: 'num', style: { fontSize: '24px' } }, String(linhasAcesso.length + linhasSenha.length))]),
        el('div', { class: 'pilha', style: { gap: '8px' } }, [...linhasSenha, ...linhasAcesso])
      ])
    : null;

  // ---------------------------------------------------------------------
  // todas as pessoas
  // ---------------------------------------------------------------------
  const FILTROS = [
    { value: 'todos', label: `Todos (${pessoas.length})` },
    ...Object.entries(PAPEIS).map(([id, p]) => ({ value: id, label: `${p.nome} (${ativos.filter((u) => u.papel === id).length})` })),
    { value: 'bloqueados', label: `Bloqueados (${bloqueados.length})` }
  ];
  const lista = pessoas
    .filter((u) => (filtro === 'todos' ? true : filtro === 'bloqueados' ? u.status === 'negado' : u.status === 'aprovado' && u.papel === filtro))
    .sort((a, b) => (Number(Boolean(b.dono)) - Number(Boolean(a.dono))) || (a.status === 'negado') - (b.status === 'negado') || (Object.keys(PAPEIS).indexOf(a.papel) - Object.keys(PAPEIS).indexOf(b.papel)) || ordenar(a, b));

  const linhaPessoa = (u) => {
    const trava = travaDe(u);
    const bloqueado = u.status === 'negado';
    return el('div', { class: `usuario-linha${bloqueado ? ' bloqueado' : ''}` }, [
      pessoa(u),
      trava
        ? el('div', { class: 'usuario-trava' }, [statusChip('aprovado', PAPEIS[u.papel]?.nome || u.papel), el('span', {}, [el('span', { html: ic.lock(13), style: { display: 'inline-flex' } }), trava])])
        : el('div', { class: 'usuario-controles' }, [
            seletorPapel(u, u.papel || 'lider', (v) => mudar(u, { papel: v }, `${u.nome} agora é ${PAPEIS[v].nome.toLowerCase()}.`)),
            segmented([{ value: 'aprovado', label: 'Ativo' }, { value: 'negado', label: 'Bloqueado' }], u.status, (v) => {
              if (v === u.status) return;
              if (v === 'negado' && !confirm(`Bloquear ${u.nome}? Ele sai do app na hora e não entra mais até você liberar.`)) return;
              mudar(u, { status: v }, v === 'negado' ? `${u.nome} bloqueado.` : `${u.nome} liberado.`);
            })
          ]),
      trava
        ? el('span')
        : el('div', { class: 'toolbar usuario-acoes' }, [
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Gerar senha provisória', onclick: () => gerarSenha(u) }, [el('span', { html: ic.key(15), style: { display: 'inline-flex' } }), 'Senha']),
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Editar o nome', onclick: () => editarNome(u) }, 'Editar'),
            el('button', { class: 'btn btn-ghost btn-sm usuario-excluir', type: 'button', title: 'Excluir', onclick: () => excluir(u) }, [el('span', { html: ic.trash(15), style: { display: 'inline-flex' } }), 'Excluir'])
          ])
    ]);
  };

  const campoBusca = el('input', {
    class: 'input', type: 'search', placeholder: 'Buscar por nome ou matrícula', value: busca, 'aria-label': 'Buscar pessoa',
    oninput: (ev) => {
      busca = ev.target.value;
      // redesenha só a lista, para não perder o foco do campo
      listaNo.replaceChildren(...conteudoLista());
    }
  });
  const conteudoLista = () => {
    const t = sem(busca.trim());
    const filtrada = lista.filter((u) => !t || sem(u.nome).includes(t) || String(u.matricula || '').includes(t));
    return filtrada.length ? filtrada.map(linhaPessoa) : [el('div', { class: 'vazio-convite' }, [el('strong', {}, 'Ninguém encontrado'), busca ? 'Confira o nome ou a matrícula.' : 'Nenhuma pessoa neste filtro.'])];
  };
  const listaNo = el('div', { class: 'pilha', style: { gap: '8px' } }, conteudoLista());

  const avisoServidor = servidor && !servidor.carregando && !servidor.configurado && !servidor.semRede
    ? el('div', { class: 'bloqueado-nota' }, [el('span', { html: ic.key(14), style: { display: 'inline-flex' } }), 'Gerar senha, o "esqueci a senha" da tela de entrada e excluir a conta de login ainda não estão ligados: falta a chave do Firebase na Netlify. Liberar, bloquear, trocar papel e tirar do app já funcionam.'])
    : null;

  return [
    el('div', { class: 'indicadores' }, [
      indicador('Com acesso', ativos.length, `${Object.entries(PAPEIS).map(([id, p]) => `${ativos.filter((u) => u.papel === id).length} ${p.nome.toLowerCase()}`).join(' · ')}`),
      indicador('Pedidos de acesso', pedidosAcesso.length, pedidosAcesso.length ? 'esperando você liberar' : 'nenhum agora', pedidosAcesso.length ? 'alerta' : ''),
      indicador('Esqueceram a senha', pedidosDeSenha.length, pedidosDeSenha.length ? 'gere uma senha provisória' : 'nenhum agora', pedidosDeSenha.length ? 'alerta' : ''),
      indicador('Bloqueados', bloqueados.length, 'não entram no app')
    ]),
    avisoServidor,
    atencao,
    el('section', { class: 'cartao' }, [
      el('div', { class: 'cartao-topo' }, [el('div', {}, [el('h3', {}, 'Pessoas'), el('p', {}, souDono ? 'Você é o dono do app: ninguém altera o seu acesso, e só você muda outro administrador.' : 'Troque o papel ou bloqueie direto na lista; vale na hora.')])]),
      el('div', { class: 'usuarios-filtros' }, [
        campoBusca,
        el('div', { class: 'blocos-trilho', role: 'tablist', 'aria-label': 'Filtro' }, FILTROS.map((f) => el('button', {
          type: 'button', role: 'tab', 'aria-selected': String(f.value === filtro), class: `bloco-op filtro-op${f.value === filtro ? ' ativo' : ''}`,
          onclick: () => { filtro = f.value; redesenhar(); }
        }, f.label)))
      ]),
      el('div', { class: 'papeis-legenda' }, Object.values(PAPEIS).map((p) => el('span', {}, [el('b', {}, p.nome), ` ${p.desc.toLowerCase()}`]))),
      listaNo
    ])
  ];
}

function indicador(rotulo, valor, texto, classe = '') {
  return el('div', { class: `indicador ${classe}` }, [el('span', {}, rotulo), el('div', { class: 'num', style: { fontSize: '30px' } }, String(valor)), el('p', {}, texto)]);
}

// ---------------------------------------------------------------------------
// Ações em folha (senha, nome, exclusão)
// ---------------------------------------------------------------------------
async function gerarSenha(u) {
  if (!confirm(`Gerar uma senha provisória para ${u.nome}? A senha atual deixa de valer e ele sai dos aparelhos.`)) return;
  let nova;
  try {
    nova = await redefinirSenha(u.uid);
  } catch (err) {
    toast(erroDe(err, 'Não consegui gerar a senha. Tente de novo.'), 'error', 7000);
    return;
  }
  const texto = `Primárias: sua senha provisória é ${nova}. Entre com a matrícula ${u.matricula} em ${location.origin} e crie a sua senha.`;
  abrirFolha({
    titulo: 'Senha provisória',
    subtitulo: `${u.nome} · matrícula ${u.matricula}${modoDemo ? ' · demonstração' : ''}`,
    corpo: [
      el('div', { class: 'senha-provisoria' }, nova),
      el('p', { class: 'fraco', style: { fontSize: '13.5px' } }, 'Passe para a pessoa. No próximo acesso ela cria uma senha só dela. Esta senha não aparece de novo.')
    ],
    pe: [
      el('a', { class: 'btn btn-outline', href: `https://wa.me/?text=${encodeURIComponent(texto)}`, target: '_blank', rel: 'noopener', style: { flex: 1 } }, 'Enviar pelo WhatsApp'),
      el('button', { class: 'btn btn-primary', type: 'button', style: { flex: 1 }, onclick: () => navigator.clipboard?.writeText(nova).then(() => toast('Senha copiada.', 'ok')) }, 'Copiar senha')
    ]
  });
}

function editarNome(u) {
  const campo = el('input', { class: 'input', value: u.nome || '', maxlength: 120, 'aria-label': 'Nome' });
  const folha = abrirFolha({
    titulo: 'Editar nome',
    subtitulo: `Matrícula ${u.matricula} (a matrícula não muda: é o login)`,
    corpo: [el('div', { class: 'field' }, [el('label', { class: 'field-label' }, 'Nome e sobrenome'), campo])],
    pe: [el('button', { class: 'btn btn-primary', type: 'button', style: { flex: 1 }, onclick: async () => {
      const nome = campo.value.trim();
      if (nome.length < 3) return toast('Escreva o nome completo.', 'error');
      try {
        await atualizarUsuario(u.uid, { nome });
        toast('Nome salvo.', 'ok');
        folha.fechar();
      } catch {
        toast('Não consegui salvar. Confira a internet.', 'error');
      }
    } }, 'Salvar')]
  });
  setTimeout(() => campo.focus(), 60);
}

async function excluir(u) {
  const st = await statusServidor();
  const completo = st.configurado;
  const folha = abrirFolha({
    titulo: `Excluir ${u.nome}?`,
    subtitulo: `Matrícula ${u.matricula}`,
    corpo: [
      el('p', {}, completo
        ? 'Apaga a conta de login e o cadastro no Primárias. Para voltar, a pessoa precisa criar a conta de novo.'
        : 'Tira a pessoa do Primárias. A conta de login continua (falta a chave do Firebase na Netlify para apagar), então ela pode pedir acesso de novo.'),
      el('p', { class: 'fraco', style: { fontSize: '13.5px' } }, 'Os lançamentos, fotos e registros que ela fez continuam no app, com o nome dela. Se a ideia é só impedir a entrada, prefira "Bloqueado".')
    ],
    pe: [
      el('button', { class: 'btn btn-ghost', type: 'button', style: { flex: 1 }, onclick: () => folha.fechar() }, 'Cancelar'),
      el('button', { class: 'btn btn-danger', type: 'button', style: { flex: 1 }, onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          const r = await excluirUsuario(u.uid);
          toast(r.completo ? `${u.nome} excluído.` : `${u.nome} saiu do Primárias.`, 'ok');
          folha.fechar();
        } catch (err) {
          ev.currentTarget.disabled = false;
          toast(erroDe(err, 'Não consegui excluir. Tente de novo.'), 'error', 7000);
        }
      } }, 'Excluir')
    ]
  });
}
