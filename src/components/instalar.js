// Colocar o app na tela do celular. No Android (e no Chrome ou Edge do
// computador) o navegador oferece a instalação e o botão chama ela; no iPhone
// não há botão: o caminho é Compartilhar > Adicionar à Tela de Início, e o
// app mostra esse passo a passo.
import { el } from '../base/dom.js';
import { abrirFolha } from './base.js';
import { ic } from '../lib/icones.js';

const CHAVE_DISPENSA = 'prim.instalar.dispensado';
let pedido = null; // o convite do navegador (beforeinstallprompt), guardado para o clique

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  pedido = ev;
});
window.addEventListener('appinstalled', () => {
  pedido = null;
});

/** Aberto pelo ícone da tela inicial (já instalado). */
export const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function dispensado() {
  try {
    return Boolean(localStorage.getItem(CHAVE_DISPENSA));
  } catch {
    return false;
  }
}
function dispensar() {
  try {
    localStorage.setItem(CHAVE_DISPENSA, String(Date.now()));
  } catch {
    /* sem armazenamento: o cartão volta na próxima vez */
  }
}

/** Instala direto quando o navegador permite; senão, mostra o passo a passo. */
export async function instalarApp() {
  if (pedido) {
    const convite = pedido;
    pedido = null;
    convite.prompt();
    await convite.userChoice.catch(() => null);
    return;
  }
  comoInstalar();
}

function comoInstalar() {
  const iphone = ehIphone();
  const passos = iphone
    ? [
        ['Abra o app no Safari.', 'No Chrome do iPhone também funciona.'],
        ['Toque em Compartilhar.', 'É o quadrado com uma seta para cima, na barra de baixo da tela.'],
        ['Toque em "Adicionar à Tela de Início".', 'Se não aparecer, role a lista para baixo.'],
        ['Toque em "Adicionar".', 'O ícone do Primárias aparece junto dos outros apps.']
      ]
    : [
        ['Abra o menu do navegador.', 'No Chrome, são os três pontinhos no canto de cima.'],
        ['Toque em "Instalar app" ou "Adicionar à tela inicial".', ''],
        ['Confirme.', 'O ícone do Primárias aparece junto dos outros apps.']
      ];
  const folha = abrirFolha({
    titulo: 'Colocar o app na tela do celular',
    subtitulo: iphone ? 'iPhone' : 'Android',
    corpo: [el('ol', { class: 'passos-instalar' }, passos.map(([t, s]) => el('li', {}, [el('strong', {}, t), s ? el('small', {}, s) : null])))],
    pe: [el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => folha.fechar() }, 'Entendi')]
  });
}

/** Cartão da tela Hoje. Some quando o app já abre pelo ícone ou a pessoa dispensa. */
export function cartaoInstalar() {
  if (instalado() || dispensado()) return null;
  const cartao = el('section', { class: 'cartao-instalar' }, [
    el('span', { class: 'cartao-instalar-icone', html: ic.download(22) }),
    el('div', {}, [el('strong', {}, 'Coloque o Primárias na tela do celular'), el('small', {}, 'Abre como um aplicativo, direto no ícone, sem procurar o endereço.')]),
    el('div', { class: 'cartao-instalar-acoes' }, [
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: instalarApp }, ehIphone() ? 'Como instalar' : 'Instalar'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { dispensar(); cartao.remove(); } }, 'Agora não')
    ])
  ]);
  return cartao;
}
