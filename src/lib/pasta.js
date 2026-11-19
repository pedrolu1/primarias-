// A pasta primarias no PC do planejador (Chrome ou Edge): escolhida uma vez,
// fica guardada neste aparelho. Com o painel aberto, a cada minuto o app olha
// as planilhas: o que mudou nelas vem para o app e o que mudou no app vai
// para elas (no máximo a cada 10 minutos por arquivo, ou na hora pelo botão).
import { lerValor, guardarValor } from './modelos.js';
import { salvarBase, salvarConfig } from './banco.js';
import { TIPOS_PASTA } from './tiposPasta.js';

// a leitura das planilhas (e o fflate) só carrega quando a pasta é usada
const sincronia = () => import('./sincronia.js');

const CHAVE_PASTA = 'pasta-primarias';
const CHAVE_META = 'pasta-meta';
const A_CADA = 60 * 1000;

export const pastaSuportada = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

const estado = {
  carregada: false,
  pasta: null, // FileSystemDirectoryHandle
  permissao: 'nenhuma', // nenhuma | prompt | granted | denied
  achados: {},
  relatorio: {},
  ultima: null,
  rodando: false,
  erro: null
};
let meta = {};
let obterCalc = null;
let relogio = null;
const ouvintes = new Set();

export const estadoPasta = () => estado;
export function aoMudarPasta(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}
const avisar = () => ouvintes.forEach((fn) => fn(estado));

async function verPermissao(pedir = false) {
  if (!estado.pasta) return (estado.permissao = 'nenhuma');
  const opcoes = { mode: 'readwrite' };
  let p = await estado.pasta.queryPermission?.(opcoes);
  if (p !== 'granted' && pedir) p = await estado.pasta.requestPermission?.(opcoes);
  estado.permissao = p || 'prompt';
  return estado.permissao;
}

/** Chamado pelo painel do planejador ao abrir. */
export async function iniciarPasta(calcAtual) {
  obterCalc = calcAtual;
  if (!pastaSuportada()) return;
  if (!estado.carregada) {
    estado.pasta = await lerValor(CHAVE_PASTA);
    meta = (await lerValor(CHAVE_META)) || {};
    estado.carregada = true;
  }
  if (estado.pasta && (await verPermissao()) === 'granted') ligar();
  avisar();
}

function ligar() {
  if (relogio) return;
  relogio = setInterval(() => sincronizar(), A_CADA);
  document.addEventListener('visibilitychange', aoVoltar);
  setTimeout(() => sincronizar(), 1500);
}
const aoVoltar = () => document.visibilityState === 'visible' && sincronizar();

export async function escolherPasta() {
  try {
    const pasta = await window.showDirectoryPicker({ id: 'primarias', mode: 'readwrite' });
    estado.pasta = pasta;
    estado.relatorio = {};
    meta = {};
    await guardarValor(CHAVE_PASTA, pasta);
    await guardarValor(CHAVE_META, meta);
    await verPermissao(true);
    estado.erro = null;
    avisar();
    if (estado.permissao === 'granted') {
      ligar();
      await sincronizar({ forcar: true });
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      estado.erro = 'Não consegui abrir a pasta.';
      avisar();
    }
  }
}

/** Depois de recarregar a página o navegador pede de novo: precisa de um clique. */
export async function reconectarPasta() {
  if ((await verPermissao(true)) === 'granted') {
    ligar();
    await sincronizar();
  }
  avisar();
}

export async function esquecerPasta() {
  clearInterval(relogio);
  relogio = null;
  document.removeEventListener('visibilitychange', aoVoltar);
  Object.assign(estado, { pasta: null, permissao: 'nenhuma', achados: {}, relatorio: {}, ultima: null, erro: null });
  meta = {};
  await guardarValor(CHAVE_PASTA, null);
  await guardarValor(CHAVE_META, {});
  avisar();
}

export async function sincronizar({ forcar = false } = {}) {
  if (!estado.pasta || estado.permissao !== 'granted' || estado.rodando || !obterCalc?.()) return null;
  estado.rodando = true;
  avisar();
  try {
    const { sincronizarPasta } = await sincronia();
    const r = await sincronizarPasta(estado.pasta, obterCalc, { salvarBase, salvarConfig }, meta, { forcar });
    meta = r.meta;
    await guardarValor(CHAVE_META, meta);
    estado.achados = r.achados;
    estado.relatorio = forcar ? r.relatorio : mesclar(estado.relatorio, r.relatorio);
    estado.ultima = Date.now();
    estado.erro = null;
    return r;
  } catch (err) {
    console.error(err);
    if (err?.name === 'NotAllowedError') {
      estado.permissao = 'prompt';
      estado.erro = 'O navegador pediu a permissão da pasta de novo.';
    } else if (err?.name === 'NotFoundError') {
      estado.erro = 'A pasta não foi encontrada. Ela foi movida ou renomeada? Escolha de novo.';
    } else {
      estado.erro = 'Não consegui ler a pasta agora. Tento de novo em um minuto.';
    }
    return null;
  } finally {
    estado.rodando = false;
    avisar();
  }
}

/** O que aconteceu fica na tela até a próxima novidade do mesmo arquivo. */
function mesclar(antes, agora) {
  const saida = {};
  for (const [tipo, r] of Object.entries(agora)) {
    const a = antes[tipo];
    const novidade = r.importou || r.gravou || r.erro || r.aviso;
    saida[tipo] = novidade || !a || a.caminho !== r.caminho ? { ...r, quando: Date.now() } : { ...a, aberto: r.aberto, aguardando: r.aguardando };
  }
  return saida;
}

/** Arquivo da pasta para o tipo, se a pasta está pronta para gravar. */
export function arquivoNaPasta(tipo) {
  return estado.permissao === 'granted' ? estado.achados[tipo] || null : null;
}

/** Grava um tipo na pasta agora (botões da tela). Devolve o resultado ou lança erro com o motivo. */
export async function gravarNaPasta(tipo, calc, opcoes = {}) {
  if (estado.permissao !== 'granted') throw new Error('Reconecte a pasta primarias antes.');
  // relê a pasta para pegar o arquivo atual (e ver se está aberto no Excel)
  const { acharPlanilhas, gravarTipo } = await sincronia();
  estado.achados = await acharPlanilhas(estado.pasta);
  const arq = estado.achados[tipo];
  if (!arq) throw new Error(`Não achei a planilha ${TIPOS_PASTA[tipo].nome} na pasta.`);
  const r = await gravarTipo(arq, calc, opcoes);
  if (r?.bytes) {
    meta[arq.caminho] = { ...(meta[arq.caminho] || {}), escrito: r.modificado, gravadoEm: Date.now() };
    await guardarValor(CHAVE_META, meta);
    estado.relatorio = { ...estado.relatorio, [tipo]: { arquivo: arq.nome, caminho: arq.caminho, gravou: r.texto, quando: Date.now() } };
    avisar();
  }
  return { ...r, arquivo: arq.nome };
}
