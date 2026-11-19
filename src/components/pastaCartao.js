// Cartão da pasta primarias (Documentos) e o indicador no topo do painel.
import { el } from '../base/dom.js';
import { ic } from '../lib/icones.js';
import { estadoPasta, pastaSuportada, escolherPasta, reconectarPasta, esquecerPasta, sincronizar } from '../lib/pasta.js';
import { TIPOS_PASTA } from '../lib/tiposPasta.js';

const hora = (t) => (t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

function linhaArquivo(tipo, e) {
  const t = TIPOS_PASTA[tipo];
  const a = e.achados[tipo];
  const r = e.relatorio[tipo] || {};
  let situacao;
  let classe = '';
  if (!a) {
    situacao = t.auto ? 'Não encontrada na pasta. O nome precisa ter "' + { gestao: 'Gestão Visual', curva: 'Curva S', rdo: 'PLAN-RFX-002 ou RDO', resumo: 'Resumo' }[tipo] + '".' : 'Opcional: grava pela página Documentos.';
    classe = t.auto ? 'alerta' : '';
  } else if (r.erro) {
    situacao = r.erro;
    classe = 'erro';
  } else {
    const partes = [];
    if (r.importou) partes.push(`trouxe para o app: ${r.importou}`);
    if (r.gravou) partes.push(`gravado: ${r.gravou}`);
    if (r.aviso) partes.push(r.aviso);
    else if (a.aberto) partes.push('aberto no Excel: grava quando fechar');
    if (!partes.length) partes.push(t.auto ? 'em dia' : 'grava pelo botão do cartão');
    situacao = `${partes.join(' · ')}${r.quando ? ` (${hora(r.quando)})` : ''}`;
    classe = a.aberto || r.aviso ? 'alerta' : 'ok';
  }
  return el('div', { class: `pasta-linha ${classe}` }, [
    el('span', { class: 'pasta-ponto' }),
    el('div', {}, [
      el('strong', {}, t.nome),
      el('small', {}, a ? a.caminho : ''),
      el('p', {}, situacao),
      a?.outros?.length ? el('p', { class: 'fraco' }, `Outros arquivos parecidos ignorados: ${a.outros.join(', ')}`) : null
    ])
  ]);
}

export function cartaoPasta() {
  const e = estadoPasta();
  const topo = (texto, acoes = []) => [
    el('div', { class: 'cartao-topo' }, [
      el('div', { class: 'linha', style: { alignItems: 'flex-start' } }, [
        el('span', { class: 'doc-icone', html: ic.pasta(22) }),
        el('div', {}, [el('h3', {}, 'Pasta primarias'), el('p', {}, texto)])
      ])
    ]),
    acoes.length ? el('div', { class: 'toolbar' }, acoes) : null
  ];
  const botao = (rotulo, fn, classe = 'btn-outline', icone = null) => el('button', { class: `btn ${classe} btn-sm`, type: 'button', onclick: fn }, [icone ? el('span', { html: icone, style: { display: 'inline-flex' } }) : null, rotulo]);

  if (!pastaSuportada()) {
    return el('section', { class: 'cartao doc-cartao pasta-cartao' }, topo('A ligação com a pasta funciona no Chrome ou no Edge do computador. Neste navegador, use "Baixar preenchida" em cada planilha e salve por cima do arquivo da pasta.'));
  }
  if (!e.pasta) {
    return el('section', { class: 'cartao doc-cartao pasta-cartao' }, topo(
      'Escolha a pasta primarias uma vez. Com o painel aberto neste computador, o app lê e grava as planilhas de lá: o que mudar no Excel aparece no app, e o que for lançado no app vai para o Excel (Gestão Visual, Curva S e RDO). Antes de mudar um arquivo, ele guarda uma cópia do dia em _backup_app.',
      [botao('Escolher a pasta', escolherPasta, 'btn-primary', ic.pasta(15))]
    ));
  }
  if (e.permissao !== 'granted') {
    return el('section', { class: 'cartao doc-cartao pasta-cartao' }, topo(
      `O navegador pede a sua confirmação para voltar a usar a pasta "${e.pasta.name}". É um clique, sempre que o painel for aberto de novo.`,
      [botao('Reconectar a pasta', reconectarPasta, 'btn-primary'), botao('Escolher outra', escolherPasta, 'btn-ghost')]
    ));
  }
  const texto = `Pasta "${e.pasta.name}" conectada. ${e.rodando ? 'Sincronizando agora…' : e.ultima ? `Última verificação às ${hora(e.ultima)}. Olha de novo a cada minuto enquanto o painel estiver aberto.` : 'Verificando…'}`;
  return el('section', { class: 'cartao doc-cartao pasta-cartao' }, [
    ...topo(texto, [
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: e.rodando, onclick: () => sincronizar({ forcar: true }) }, [el('span', { html: e.rodando ? '' : ic.nuvem(15), class: e.rodando ? 'spinner' : '', style: { display: 'inline-flex' } }), e.rodando ? 'Sincronizando…' : 'Sincronizar agora']),
      botao('Trocar pasta', escolherPasta, 'btn-ghost'),
      botao('Desconectar', () => confirm('Desconectar a pasta? Os arquivos ficam como estão.') && esquecerPasta(), 'btn-ghost')
    ]),
    e.erro ? el('div', { class: 'bloqueado-nota' }, e.erro) : null,
    el('div', { class: 'pasta-lista' }, Object.keys(TIPOS_PASTA).map((t) => linhaArquivo(t, e)))
  ]);
}

/** Indicador no topo: só aparece depois que a pasta foi escolhida. */
export function chipPasta(ir) {
  const no = el('button', { class: 'sinc-chip pasta-chip', type: 'button', style: { display: 'none' }, onclick: () => ir('documentos') });
  const atualizar = () => {
    const e = estadoPasta();
    if (!e.pasta) {
      no.style.display = 'none';
      return;
    }
    no.style.display = '';
    const erro = e.erro || Object.values(e.relatorio).some((r) => r.erro);
    const [classe, texto, titulo] = e.permissao !== 'granted'
      ? ['offline', 'Pasta: reconectar', 'Clique para reconectar a pasta primarias.']
      : e.rodando
        ? ['enviando', 'Pasta…', 'Sincronizando com a pasta primarias.']
        : erro
          ? ['offline', 'Pasta: ver aviso', 'Alguma planilha não foi lida ou gravada. Veja em Documentos.']
          : ['ok', `Pasta ${hora(e.ultima)}`, 'Planilhas da pasta primarias em dia.'];
    no.className = `sinc-chip pasta-chip ${classe}`;
    no.title = titulo;
    no.replaceChildren(el('span', { html: ic.pasta(15), style: { display: 'inline-flex' } }), texto);
  };
  return { no, atualizar };
}
