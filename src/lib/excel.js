// Planilhas de controle preenchidas pelo app. O planejador escolhe cada
// arquivo uma vez (fica guardado neste aparelho); a cada pedido o app devolve
// uma cópia atualizada, com fórmulas, gráficos e macros intactos.
import { el } from '../base/dom.js';
import { toast } from '../base/toast.js';
import { lerModelo, guardarModelo } from './modelos.js';
import { baixar, nomeAtualizado, TIPO_XLSX, TIPO_XLSM } from './documentos.js';
import { completa } from './datas.js';

export const MODELOS = {
  gestao: { chave: 'gestao-visual', nome: 'Gestão Visual', aceita: '.xlsx,.xlsm' },
  curva: { chave: 'curva-s', nome: 'Curva S', aceita: '.xlsm,.xlsx' },
  resumo: { chave: 'resumo-medicao', nome: 'Resumo da medição', aceita: '.xlsx,.xlsm' },
  rdo: { chave: 'rdo', nome: 'RDO (PLAN-RFX-002)', aceita: '.xlsx,.xlsm' }
};

let modelos = null;
const ocupado = new Set();
let redesenhar = () => {};

/** A página aberta avisa como se redesenhar quando um arquivo muda. */
export function usarRedesenho(fn) {
  redesenhar = fn;
}

async function carregar() {
  const lista = await Promise.all(Object.entries(MODELOS).map(async ([id, m]) => [id, await lerModelo(m.chave)]));
  modelos = Object.fromEntries(lista);
  redesenhar();
}

/** Arquivo guardado para o tipo ({ nome, salvoEm, bytes }) ou null. */
export function modeloGuardado(tipo) {
  if (modelos === null) {
    modelos = {};
    carregar();
  }
  return modelos[tipo] || null;
}

export const estaOcupado = (id) => ocupado.has(id);

export async function ocupar(id, tarefa) {
  if (ocupado.has(id)) return;
  ocupado.add(id);
  redesenhar();
  try {
    await tarefa();
  } catch (err) {
    console.error(err);
    toast(err?.message?.startsWith('Não achei') ? err.message : 'Não consegui gerar o arquivo. Confira se é a planilha certa.', 'error', 7000);
  } finally {
    ocupado.delete(id);
    redesenhar();
  }
}

export function escolherArquivo(tipo, depois) {
  const m = MODELOS[tipo];
  const entrada = el('input', {
    type: 'file', accept: m.aceita, style: { display: 'none' },
    onchange: async (ev) => {
      const arq = ev.target.files[0];
      entrada.remove();
      if (!arq) return;
      modelos = { ...(modelos || {}), [tipo]: await guardarModelo(m.chave, arq) };
      toast(`${m.nome}: planilha guardada neste aparelho.`, 'ok');
      redesenhar();
      depois?.();
    }
  });
  document.body.appendChild(entrada);
  entrada.click();
}

const plural = (n, s, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

/**
 * Gera a planilha preenchida e baixa. opcoes: { bm } para o resumo da
 * medição, { datas } para o RDO (além dos RDOs fechados que faltam nela).
 */
export async function gerarExcel(tipo, calc, opcoes = {}) {
  const modelo = modeloGuardado(tipo);
  if (!modelo) return escolherArquivo(tipo, () => gerarExcel(tipo, calc, opcoes));
  await ocupar(`excel-${tipo}`, async () => {
    const P = await import('./planilhas.js');
    let r;
    let msg;
    if (tipo === 'gestao') {
      r = P.atualizarGestaoVisual(modelo.bytes, calc);
      msg = r.resumo.celulas ? `Gestão Visual atualizada: ${plural(r.resumo.primarias, 'primária mudou', 'primárias mudaram')}.` : 'Gestão Visual já estava em dia; só a data de atualização mudou.';
    } else if (tipo === 'curva') {
      r = P.atualizarCurvaS(modelo.bytes, calc);
      msg = `Curva S atualizada: ${plural(r.resumo.realizado, 'forno revestido', 'fornos revestidos')} até hoje.`;
    } else if (tipo === 'resumo') {
      r = P.gerarEspelho(modelo.bytes, calc, opcoes.bm);
      msg = `${r.resumo.nova ? 'Aba nova' : 'Aba atualizada'}: "${r.resumo.aba}", ${plural(r.resumo.fornos, 'forno')}${r.resumo.foraDoLimite ? ` (${r.resumo.foraDoLimite} não couberam)` : ''}.`;
    } else {
      r = P.gravarRdos(modelo.bytes, calc, { datas: opcoes.datas || [] });
      const { gravadas, conflitos } = r.resumo;
      if (conflitos.length) toast(`Não gravei: ${conflitos.map((c) => `${completa(c.data)} (${c.motivo})`).join('; ')}.`, 'error', 9000);
      if (!gravadas.length) {
        if (!conflitos.length) toast('Nenhum RDO novo para gravar: feche o RDO do dia antes.', 'info', 6000);
        return;
      }
      msg = `${gravadas.length === 1 ? 'RDO' : 'RDOs'} ${gravadas.map((g) => g.numero).join(', ')} na planilha${gravadas.some((g) => g.nova) ? ' (abas novas depois da última)' : ''}.`;
    }
    baixar(r.bytes, nomeAtualizado(modelo.nome), /\.xlsm$/i.test(modelo.nome) ? TIPO_XLSM : TIPO_XLSX);
    toast(msg, 'ok', 6000);
  });
}
