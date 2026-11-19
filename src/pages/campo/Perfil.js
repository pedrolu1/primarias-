// Perfil: quem está usando o app, o que lançou e as opções da conta.
import { el } from '../../base/dom.js';
import { CREDITO } from '../../base/ui.js';
import { initials } from '../../base/format.js';
import { ic } from '../../lib/icones.js';
import { somLigado, alternarSom, tocar } from '../../lib/efeitos.js';
import { PAPEIS } from '../../data/obra.js';
import { abrirTrocarSenha } from '../../components/trocarSenha.js';
import { instalado, instalarApp } from '../../components/instalar.js';

export function paginaPerfil({ perfil, stats, trocarVisao, redesenhar }) {
  const som = somLigado();
  return [
    el('div', { class: 'perfil-topo' }, [
      el('span', { class: 'avatar avatar-grande' }, initials(perfil.nome)),
      el('h2', {}, perfil.nome),
      el('span', { class: 'fraco' }, `${PAPEIS[perfil.papel].nome} · matrícula ${perfil.matricula}`)
    ]),
    el('div', { class: 'dia-numeros' }, [
      el('div', {}, [el('span', { class: 'num' }, String(stats.hojeEtapas)), el('small', {}, 'etapas hoje')]),
      el('div', {}, [el('span', { class: 'num' }, String(stats.etapas)), el('small', {}, 'etapas no total')]),
      el('div', {}, [el('span', { class: 'num' }, String(stats.dias)), el('small', {}, stats.dias === 1 ? 'dia com lançamento' : 'dias com lançamento')])
    ]),
    el('div', { class: 'menu-list' }, [
      el('button', { class: 'menu-item', type: 'button', onclick: () => { alternarSom(!som); if (!som) tocar('ok'); redesenhar(); } }, [
        el('span', { html: som ? ic.som(20) : ic.semSom(20) }),
        el('div', {}, [el('strong', {}, som ? 'Som ligado' : 'Som desligado'), el('small', {}, 'Um toque curto ao lançar e ao fechar forno.')])
      ]),
      instalado() ? null : el('button', { class: 'menu-item', type: 'button', onclick: instalarApp }, [el('span', { html: ic.download(20) }), el('div', {}, [el('strong', {}, 'Colocar o app na tela do celular'), el('small', {}, 'Abre direto pelo ícone, como os outros apps.')])]),
      el('button', { class: 'menu-item', type: 'button', onclick: abrirTrocarSenha }, [el('span', { html: ic.key(20) }), el('div', {}, [el('strong', {}, 'Trocar minha senha'), el('small', {}, 'Pede a senha atual e a nova.')])]),
      trocarVisao ? el('button', { class: 'menu-item', type: 'button', onclick: () => trocarVisao('painel') }, [el('span', { html: ic.grid(20) }), el('div', {}, [el('strong', {}, 'Voltar ao painel'), el('small', {}, 'Você está vendo o app como o campo vê.')])]) : null,
      el('button', { class: 'menu-item', type: 'button', onclick: () => window.dispatchEvent(new CustomEvent('prim:sair')) }, [el('span', { html: ic.logout(20) }), el('div', {}, [el('strong', {}, 'Sair'), el('small', {}, 'Volta para a tela de entrada.')])])
    ]),
    el('div', { class: 'credito' }, CREDITO)
  ];
}
