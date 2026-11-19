// "Trocar minha senha": no Perfil do campo e no menu lateral do painel.
import { el } from '../base/dom.js';
import { abrirFolha } from './base.js';
import { alterarMinhaSenha, mensagemDeErro, modoDemo } from '../lib/acesso.js';
import { toast } from '../base/toast.js';

export function abrirTrocarSenha() {
  const campo = (id, rotulo, auto) => {
    const input = el('input', { class: 'input', id, type: 'password', autocomplete: auto, placeholder: auto === 'current-password' ? 'A senha de agora' : 'Pelo menos 6 caracteres' });
    return [input, el('div', { class: 'field' }, [el('label', { class: 'field-label', for: id }, rotulo), input])];
  };
  const [atual, cAtual] = campo('ts-atual', 'Senha atual', 'current-password');
  const [nova, cNova] = campo('ts-nova', 'Senha nova', 'new-password');
  const [repete, cRepete] = campo('ts-repete', 'Repita a senha nova', 'new-password');
  const botao = el('button', { class: 'btn btn-primary', type: 'button', style: { flex: 1 }, onclick: async () => {
    if (nova.value.length < 6) return toast('A senha nova precisa ter pelo menos 6 caracteres.', 'error');
    if (nova.value !== repete.value) return toast('As duas senhas novas não são iguais.', 'error');
    if (modoDemo) {
      folha.fechar();
      return toast('Na demonstração não há senha.', 'info');
    }
    botao.disabled = true;
    try {
      await alterarMinhaSenha(atual.value, nova.value);
      toast('Senha trocada.', 'ok');
      folha.fechar();
    } catch (err) {
      botao.disabled = false;
      toast(mensagemDeErro(err), 'error', 6000);
    }
  } }, 'Trocar senha');
  const folha = abrirFolha({ titulo: 'Trocar minha senha', subtitulo: 'Vale a partir da próxima entrada, em qualquer aparelho', corpo: [cAtual, cNova, cRepete], pe: [botao] });
  setTimeout(() => atual.focus(), 60);
}
