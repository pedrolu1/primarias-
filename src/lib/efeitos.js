// Retorno imediato a cada ação: vibração, som curto e o aviso de forno fechado.
// O som respeita o botão do perfil.
import { el } from '../base/dom.js';
import { ic } from './icones.js';

export const vibrar = (padrao = 12) => navigator.vibrate?.(padrao);

// ---------------------------------------------------------------------------
// Som: dois tons curtos sintetizados (sem arquivo de áudio para baixar)
// ---------------------------------------------------------------------------
const CHAVE_SOM = 'prim.som';
export function somLigado() {
  try {
    return localStorage.getItem(CHAVE_SOM) !== 'off';
  } catch {
    return true;
  }
}
export function alternarSom(ligado) {
  try {
    localStorage.setItem(CHAVE_SOM, ligado ? 'on' : 'off');
  } catch {
    /* sem armazenamento: vale até recarregar */
  }
}
let audio;
export function tocar(tipo = 'ok') {
  if (!somLigado()) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const notas = { ok: [660, 990], forno: [523, 659, 784, 1047] }[tipo] || [660];
    notas.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const t = audio.currentTime + i * 0.085;
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.25);
    });
  } catch {
    /* navegador sem áudio: segue em silêncio */
  }
}

// ---------------------------------------------------------------------------
// Aviso grande: forno fechado, bloco concluído, checklist enviado
// ---------------------------------------------------------------------------
export function comemorar({ titulo, texto, icone = ic.check(46), grande = false, som = 'forno' }) {
  vibrar(grande ? [30, 50, 30, 50, 60] : [25, 40, 40]);
  tocar(som);
  const n = el('div', { class: `festa${grande ? ' festa-grande' : ''}`, role: 'status' }, [
    el('div', { class: 'festa-cartao' }, [
      el('div', { class: 'festa-icone', html: icone }),
      el('strong', {}, titulo),
      texto ? el('p', {}, texto) : null,
      el('small', {}, 'Toque para continuar')
    ])
  ]);
  const fechar = () => {
    n.classList.add('saindo');
    setTimeout(() => n.remove(), 260);
  };
  n.addEventListener('click', fechar);
  document.body.appendChild(n);
  setTimeout(fechar, grande ? 3600 : 2600);
}
