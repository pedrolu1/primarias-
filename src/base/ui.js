import { el } from './dom.js';

/** Botões lado a lado em que só um fica marcado (ex.: Nº de fornos / Percentual). */
export function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'segmented' });
  options.forEach((opt) => {
    const b = el('button', { type: 'button', class: opt.value === value ? 'active' : '' }, opt.label);
    b.addEventListener('click', () => onChange(opt.value));
    wrap.appendChild(b);
  });
  return wrap;
}

/** Crédito de quem criou o app: discreto, no login, no menu lateral e no perfil. */
export const CREDITO = 'Criado por Pedro · Planejamento Coqueria · Ternium RJ';
export const credito = (classe = '') => el('div', { class: `credito ${classe}`.trim() }, CREDITO);
