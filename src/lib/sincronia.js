// Sincronização com a pasta primarias: acha as planilhas pelo nome, traz para
// o app o que mudou nelas fora do app e grava nelas o que mudou no app. Não
// usa a tela: recebe a pasta (FileSystemDirectoryHandle ou algo com a mesma
// cara, nos testes), o cálculo atual e as ações de gravar no banco.
//   - Gestão Visual: a base do mapa vem dela; os lançamentos voltam para ela.
//   - Curva S: o previsto vem dela; o realizado volta para ela.
//   - RDO: o último número e o acumulado de materiais vêm dele; os RDOs
//     fechados no app viram abas novas nele.
// Antes de mudar um arquivo, o app guarda uma cópia do dia em _backup_app.
import * as P from './planilhas.js';
import { FORNOS, contratoAtivo } from '../data/obra.js';
import { semanasDaPlanilha, rdoUltimo } from './calculo.js';
import { hoje, inicioDaSemana } from './datas.js';
import { TIPOS_PASTA } from './tiposPasta.js';

export const PASTA_BACKUP = '_backup_app';
const BACKUPS_POR_ARQUIVO = 7;


const ehPlanilha = (n) => /\.(xlsx|xlsm)$/i.test(n) && !n.startsWith('~$') && !n.startsWith('.');

/** Lista as planilhas e as travas do Excel (~$) até 3 pastas abaixo. */
export async function varrerPasta(dir, caminho = '', nivel = 0, saida = { arquivos: [], travas: [] }) {
  for await (const [nome, h] of dir.entries()) {
    if (h.kind === 'directory') {
      if (nivel < 3 && nome !== PASTA_BACKUP && !nome.startsWith('.')) await varrerPasta(h, `${caminho}${nome}/`, nivel + 1, saida);
    } else if (nome.startsWith('~$')) {
      saida.travas.push({ nome, dir });
    } else if (ehPlanilha(nome)) {
      saida.arquivos.push({ nome, caminho: `${caminho}${nome}`, handle: h, dir });
    }
  }
  return saida;
}

/** Para cada tipo, o arquivo mais recente com o nome certo. */
export async function acharPlanilhas(dir) {
  const { arquivos, travas } = await varrerPasta(dir);
  const achados = {};
  for (const a of arquivos) {
    const tipo = Object.keys(TIPOS_PASTA).find((t) => TIPOS_PASTA[t].teste(a.nome));
    if (!tipo) continue;
    const file = await a.handle.getFile();
    const item = { ...a, tipo, modificado: file.lastModified, tamanho: file.size, outros: [] };
    // o Excel cria "~$" + o nome (sem as 2 primeiras letras, se for comprido)
    item.aberto = travas.some((t) => t.dir === a.dir && (t.nome.slice(2) === a.nome || t.nome.slice(2) === a.nome.slice(2)));
    const atual = achados[tipo];
    if (!atual) achados[tipo] = item;
    else if (item.modificado > atual.modificado) {
      item.outros = [...atual.outros, atual.caminho];
      achados[tipo] = item;
    } else atual.outros.push(item.caminho);
  }
  return achados;
}

/** Marca do que o app tem para cada planilha: se mudar, a planilha precisa ser gravada. */
export function assinatura(tipo, calc) {
  const e = calc.estado;
  let texto = '';
  if (tipo === 'gestao') {
    texto = e.lancamentos.filter((l) => l.status === 'valido').map((l) => `${l.id}:${l.data}`).sort().join('|');
  } else if (tipo === 'curva') {
    const bat = contratoAtivo().bateria;
    texto = `${inicioDaSemana(hoje())}|${FORNOS.filter((f) => f.bateria === bat && calc.fornos[f.id].concluidoEm).map((f) => `${f.id}:${calc.fornos[f.id].concluidoEm}`).join('|')}`;
  } else if (tipo === 'rdo') {
    texto = Object.entries(e.rdos || {})
      .filter(([, r]) => ['fechado', 'assinado'].includes(r?.status))
      .map(([d, r]) => `${d}:${r.numero}:${r.status}:${r.fechadoEm || ''}`)
      .sort()
      .join('|');
  }
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `${texto.length}-${(h >>> 0).toString(36)}`;
}

const mesmo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Traz para o app o que a planilha tem. Devolve um texto do que mudou, ou null. */
async function importar(tipo, bytes, calc, acoes, arquivo) {
  if (tipo === 'gestao') {
    const nova = P.lerBaseDaGestaoVisual(bytes);
    if (calc.estado.base && mesmo(calc.estado.base.baterias, nova.baterias)) return null;
    await acoes.salvarBase({ ...nova, fonte: arquivo, importadoEm: Date.now() });
    return 'base do mapa atualizada';
  }
  if (tipo === 'curva') {
    const semanas = P.lerCurvaS(bytes);
    if (calc.estado.config?.curva && mesmo(semanasDaPlanilha(calc), semanas)) return null;
    await acoes.salvarConfig({ curva: { semanas, arquivo, importadoEm: Date.now() } });
    return 'previsto da Curva S atualizado';
  }
  if (tipo === 'rdo') {
    const u = P.lerRdoPlanilha(bytes);
    const atual = rdoUltimo(calc);
    if (!u.data || (u.numero === Number(atual.numero) && u.data === atual.data && mesmo(u.materiais, atual.materiais))) return null;
    await acoes.salvarConfig({ rdoUltimo: { numero: u.numero, data: u.data, materiais: u.materiais, arquivo, importadoEm: Date.now() } });
    return `último RDO da planilha: nº ${u.numero}`;
  }
  return null;
}

/** Preenche a planilha com o que o app tem. Devolve { bytes, texto } ou null se não há o que gravar. */
export function preencher(tipo, bytes, calc, opcoes = {}) {
  if (tipo === 'gestao') {
    const r = P.atualizarGestaoVisual(bytes, calc);
    return { bytes: r.bytes, texto: r.resumo.celulas ? `${r.resumo.primarias} primárias atualizadas` : 'data de atualização' };
  }
  if (tipo === 'curva') {
    const r = P.atualizarCurvaS(bytes, calc);
    return { bytes: r.bytes, texto: `realizado: ${r.resumo.realizado} fornos` };
  }
  if (tipo === 'rdo') {
    const r = P.gravarRdos(bytes, calc, { datas: opcoes.datas || [] });
    const conflitos = r.resumo.conflitos.map((c) => `${c.data}: ${c.motivo}`);
    if (!r.resumo.gravadas.length) return conflitos.length ? { bytes: null, texto: '', conflitos } : null;
    return { bytes: r.bytes, texto: `RDO ${r.resumo.gravadas.map((g) => g.numero).join(', ')}`, conflitos };
  }
  if (tipo === 'resumo') {
    const r = P.gerarEspelho(bytes, calc, opcoes.bm);
    return { bytes: r.bytes, texto: `aba "${r.resumo.aba}"` };
  }
  return null;
}

const doisD = (n) => String(n).padStart(2, '0');

/** Uma cópia por dia de cada arquivo, antes da primeira mudança do app. */
async function guardarBackup(arq, bytes, agora) {
  const pasta = await arq.dir.getDirectoryHandle(PASTA_BACKUP, { create: true });
  const ponto = arq.nome.lastIndexOf('.');
  const base = arq.nome.slice(0, ponto);
  const ext = arq.nome.slice(ponto);
  const dia = `${agora.getFullYear()}-${doisD(agora.getMonth() + 1)}-${doisD(agora.getDate())}`;
  const nome = `${base} (${dia})${ext}`;
  try {
    await pasta.getFileHandle(nome);
    return null; // já tem a de hoje
  } catch {
    /* ainda não tem */
  }
  await escrever(await pasta.getFileHandle(nome, { create: true }), bytes);
  // fica só com as mais recentes deste arquivo
  const antigas = [];
  for await (const [n, h] of pasta.entries()) if (h.kind === 'file' && n.startsWith(`${base} (`) && n.endsWith(ext)) antigas.push(n);
  antigas.sort();
  for (const n of antigas.slice(0, Math.max(0, antigas.length - BACKUPS_POR_ARQUIVO))) await pasta.removeEntry(n).catch(() => {});
  return nome;
}

async function escrever(handle, bytes) {
  const w = await handle.createWritable();
  try {
    await w.write(bytes);
    await w.close();
  } catch (err) {
    await w.abort?.().catch(() => {});
    throw err;
  }
}

/** Grava um tipo agora (pedido pela tela): backup, preenche e escreve. */
export async function gravarTipo(arq, calc, opcoes = {}, agora = new Date()) {
  if (arq.aberto) throw new Error(`"${arq.nome}" está aberto no Excel. Feche o arquivo e tente de novo.`);
  const original = new Uint8Array(await (await arq.handle.getFile()).arrayBuffer());
  const r = preencher(arq.tipo, original, calc, opcoes);
  if (!r?.bytes) return r;
  await guardarBackup(arq, original, agora);
  try {
    await escrever(arq.handle, r.bytes);
  } catch (err) {
    throw new Error(motivoDoErro(err, arq.nome));
  }
  r.modificado = (await arq.handle.getFile()).lastModified;
  return r;
}

export function motivoDoErro(err, nome) {
  const n = err?.name || '';
  if (n === 'NoModificationAllowedError' || n === 'InvalidModificationError' || n === 'InvalidStateError') return `Não consegui gravar "${nome}": ele parece aberto em outro programa. Feche e tente de novo.`;
  if (n === 'NotAllowedError') return 'O navegador tirou a permissão da pasta. Clique em "Reconectar a pasta".';
  if (n === 'SecurityError' || n === 'AbortError') return `O navegador bloqueou a gravação de "${nome}". Use "Baixar preenchida" e substitua o arquivo na pasta.`;
  if (n === 'QuotaExceededError') return 'Sem espaço no disco para gravar a planilha.';
  return err?.message || `Não consegui gravar "${nome}".`;
}

/**
 * Uma rodada: para cada planilha automática, importa se mudou fora do app e
 * grava se o app mudou (respeitando o intervalo mínimo entre gravações).
 * meta: { [caminho]: { lido, escrito, assinatura, gravadoEm } }, guardado
 * pelo chamador. Devolve { achados, meta, relatorio }.
 */
export async function sincronizarPasta(dir, obterCalc, acoes, meta = {}, { forcar = false, intervaloMin = 10 * 60 * 1000, agora = new Date(), esperar = () => new Promise((ok) => setTimeout(ok, 400)) } = {}) {
  const achados = await acharPlanilhas(dir);
  const relatorio = {};
  const novaMeta = { ...meta };
  let importou = false;
  for (const [tipo, arq] of Object.entries(achados)) {
    if (!TIPOS_PASTA[tipo].auto) continue;
    const m = { ...(novaMeta[arq.caminho] || {}) };
    const r = (relatorio[tipo] = { arquivo: arq.nome, caminho: arq.caminho, aberto: arq.aberto, outros: arq.outros });
    // 1) mudou fora do app desde a última vez que o app leu ou gravou?
    if (arq.modificado !== m.lido && arq.modificado !== m.escrito) {
      try {
        const bytes = new Uint8Array(await (await arq.handle.getFile()).arrayBuffer());
        const texto = await importar(tipo, bytes, obterCalc(), acoes, arq.nome);
        if (texto) {
          r.importou = texto;
          importou = true;
        }
        m.lido = arq.modificado;
      } catch (err) {
        r.erro = err?.message?.startsWith('Não achei') || err?.message?.startsWith('A aba') ? err.message : `Não consegui ler "${arq.nome}".`;
      }
    }
    novaMeta[arq.caminho] = m;
  }
  // o banco leva um instante para devolver o que acabou de ser importado
  if (importou) await esperar();
  const calc = obterCalc();
  for (const [tipo, arq] of Object.entries(achados)) {
    if (!TIPOS_PASTA[tipo].auto || relatorio[tipo].erro) continue;
    const m = novaMeta[arq.caminho];
    const r = relatorio[tipo];
    const sig = assinatura(tipo, calc);
    if (sig === m.assinatura && !forcar) continue;
    if (!forcar && m.gravadoEm && agora.getTime() - m.gravadoEm < intervaloMin) {
      r.aguardando = true;
      continue;
    }
    if (arq.aberto) {
      r.aguardando = true;
      r.aviso = 'aberto no Excel: grava quando fechar';
      continue;
    }
    try {
      const g = await gravarTipo(arq, calc, {}, agora);
      if (g?.conflitos?.length) r.aviso = `não gravei ${g.conflitos.join('; ')}`;
      if (g?.bytes) {
        r.gravou = g.texto;
        m.escrito = g.modificado;
        m.gravadoEm = agora.getTime();
      }
      m.assinatura = sig;
    } catch (err) {
      r.erro = err.message;
    }
  }
  return { achados, meta: novaMeta, relatorio };
}
