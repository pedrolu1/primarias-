// Tudo o que o app mostra sai daqui: estado de cada primária, avanço, Curva S
// por BM, RDO do dia e checklist com fotos. Funções puras
// sobre o estado do banco.
import { SEED_BATERIAS, SEED_EPOCH, SEED_VALORES_POR_PRIMARIA } from '../data/seed.js';
import { SEED_CURVA } from '../data/curva-seed.js';
import { corrigirTexto } from './corretor.js';
import {
  PRIMARIAS, FORNOS, ETAPAS, etapaPorId, contratoAtivo, blocosDa, fornoPorId, primariaPorId,
  MATERIAIS, primariasDoAlvo, BATERIAS, RDO_ULTIMO, noMeio, SLOTS_FOTO, ORDEM_RDO, TITULO_SOPRAGEM, FERIADOS
} from '../data/obra.js';
import { somarDias, semana, hoje, diaUtil, bm, bmDaSemana, semanasDoBm, periodoBm, bmsEntre, inicioDaSemana } from './datas.js';

const N_ETAPAS = ETAPAS.length;
const IDX = Object.fromEntries(ETAPAS.map((e, i) => [e.id, i]));
// etapas que pintam o mapa, na ordem (a desmontagem fica de fora)
const I_MAPA = ETAPAS.map((e, i) => (e.extra ? -1 : i)).filter((i) => i >= 0);
const I_MASSA = IDX.massa1200;

// ---------------------------------------------------------------------------
// Base histórica, da planilha de Gestão Visual: por primária, fim da demolição,
// fim da instalação, início e fim do revestimento e, com 5 valores, se o
// andaime está montado (coluna K). A montagem do andaime vale junto com a
// demolição e o Injetbar junto com o início do revestimento. Primária
// revestida com andaime "NÃO" na planilha entra com o andaime desmontado.
// O planejador atualiza essa base pela tela Configuração; sem isso, vale a
// que veio com o app.
// ---------------------------------------------------------------------------
function montarBase({ epoch, baterias, valores = 4 }) {
  const base = PRIMARIAS.map(() => new Array(N_ETAPAS).fill(null));
  const porBateria = PRIMARIAS.length / BATERIAS.length;
  BATERIAS.forEach((bat, bi) => {
    const arr = baterias[bat];
    if (!arr) return;
    for (let k = 0; k < porBateria; k++) {
      const brutos = Array.from({ length: valores }, (_, j) => arr[k * valores + j]);
      const v = brutos.slice(0, Math.min(valores, 4)).map((n) => (n >= 0 ? somarDias(epoch, n) : null));
      const [demo, inst] = v;
      const iniRev = valores >= 4 ? v[2] : null;
      const fimRev = valores >= 4 ? v[3] : v[valores - 1];
      const andaimeNaPlanilha = valores >= 5 ? brutos[4] === 1 : null;
      const b = base[bi * porBateria + k];
      if (demo) b[IDX.andaime] = b[IDX.demolicao] = demo;
      if (inst) b[IDX.assentamento] = inst;
      if (iniRev || fimRev) b[IDX.injetbar] = iniRev || fimRev;
      if (fimRev) b[IDX.massa1200] = fimRev;
      // revestida e sem andaime na planilha: o andaime já foi desmontado
      if (andaimeNaPlanilha === false && demo && fimRev) b[IDX.desmontagem] = fimRev;
    }
  });
  return base;
}
const baseDoApp = montarBase({ epoch: SEED_EPOCH, baterias: SEED_BATERIAS, valores: SEED_VALORES_POR_PRIMARIA });
let baseImportada = { fonte: null, base: null };
function baseAtual(estado) {
  const fonte = estado.base;
  if (!fonte?.baterias) return baseDoApp;
  if (baseImportada.fonte !== fonte) baseImportada = { fonte, base: montarBase(fonte) };
  return baseImportada.base;
}

let cache = { versao: -1, calc: null };

/** Estado calculado; recalcula só quando o banco muda. */
export function calcular(estado) {
  if (cache.versao === estado.versao && cache.calc) return cache.calc;
  const feitas = baseAtual(estado).map((b) => b.slice());
  const quem = PRIMARIAS.map(() => new Array(N_ETAPAS).fill(null)); // id do lançamento que fez
  const validos = estado.lancamentos
    .filter((l) => l.status === 'valido' && IDX[l.etapa] !== undefined)
    .sort((a, b) => a.criadoEmLocal - b.criadoEmLocal);
  for (const l of validos) {
    const e = IDX[l.etapa];
    for (const pid of l.prims) {
      const p = primariaPorId[pid];
      if (!p) continue;
      if (!feitas[p.idx][e] || l.data < feitas[p.idx][e]) {
        feitas[p.idx][e] = l.data;
        quem[p.idx][e] = l.id;
      }
    }
  }
  // etapa mais avançada do mapa em cada primária (-1 = nada); índice dentro de I_MAPA
  const nivel = feitas.map((f) => {
    for (let k = I_MAPA.length - 1; k >= 0; k--) if (f[I_MAPA[k]]) return k;
    return -1;
  });
  // forno concluído = as 6 primárias com massa 1200; vale a data da última
  const fornos = {};
  for (const f of FORNOS) {
    const ids = f.prims.map((id) => primariaPorId[id].idx);
    const finais = ids.map((i) => feitas[i][I_MASSA]);
    const concluidoEm = finais.every(Boolean) ? finais.reduce((a, b) => (a > b ? a : b)) : null;
    const fechouLanc = concluidoEm ? ids.map((i) => quem[i][I_MASSA]).find((q, k) => q && finais[k] === concluidoEm) || null : null;
    const andaime = {};
    for (const lado of ['LM', 'LC']) {
      const doLado = ids.filter((i) => PRIMARIAS[i].lado === lado);
      const montado = doLado.every((i) => feitas[i][IDX.andaime]);
      const desmontado = doLado.every((i) => feitas[i][IDX.desmontagem]);
      andaime[lado] = desmontado ? 'desmontado' : montado ? 'montado' : null;
    }
    fornos[f.id] = { concluidoEm, fechouLanc, niveis: ids.map((i) => nivel[i]), minimo: Math.min(...ids.map((i) => nivel[i])), andaime };
  }
  const blocos = {};
  for (const bat of BATERIAS) {
    for (const bl of blocosDa(bat)) {
      const fs = FORNOS.filter((f) => f.bloco === bl).map((f) => fornos[f.id]);
      const concl = fs.filter((f) => f.concluidoEm);
      blocos[bl] = { concluidos: concl.length, concluidoEm: concl.length === fs.length ? concl.map((f) => f.concluidoEm).sort().pop() : null };
    }
  }
  const lancPorId = Object.fromEntries(estado.lancamentos.map((l) => [l.id, l]));
  const calc = { versao: estado.versao, estado, feitas, quem, nivel, fornos, blocos, validos, lancPorId };
  cache = { versao: estado.versao, calc };
  return calc;
}

// ---------------------------------------------------------------------------
// Regras do lançamento: as etapas seguem a ordem do serviço.
// ---------------------------------------------------------------------------

/** Se a etapa pode ser lançada naquele alvo (primária, lado ou forno). */
export function situacaoAlvo(calc, etapaId, alvo) {
  const e = IDX[etapaId];
  const idxs = primariasDoAlvo(alvo).map((id) => primariaPorId[id].idx);
  const feitas = idxs.filter((i) => calc.feitas[i][e]).length;
  if (feitas === idxs.length) return { ok: false, feito: true, motivo: 'Já lançada' };
  const antes = etapaId === 'desmontagem' ? IDX.andaime : e - 1;
  if (antes >= 0) {
    const faltando = idxs.filter((i) => !calc.feitas[i][antes]).length;
    if (faltando) return { ok: false, motivo: `Falta ${noMeio(ETAPAS[antes])}` };
  }
  return { ok: true, parcial: feitas > 0 };
}

/** Alvos de uma etapa num forno (primárias ou lados), com a situação de cada um. */
export function alvosDoForno(calc, etapaId, fid) {
  const nivel = etapaPorId[etapaId].nivel;
  const ids = nivel === 'forno' ? [fid] : nivel === 'cabeceira' ? [`${fid}-LM`, `${fid}-LC`] : fornoPorId[fid].prims;
  return ids.map((id) => ({ id, ...situacaoAlvo(calc, etapaId, id) }));
}

/** Próxima etapa liberada num lado do forno (para o botão grande da tela do forno). */
export function proximaDoLado(calc, fid, lado) {
  for (const e of ETAPAS) {
    const alvos = alvosDoForno(calc, e.id, fid).filter((a) => (e.nivel === 'cabeceira' ? a.id.endsWith(lado) : primariaPorId[a.id].lado === lado));
    const livres = alvos.filter((a) => a.ok);
    if (livres.length) return { etapa: e, alvos: livres.map((a) => a.id) };
  }
  return null;
}

/** Peso de cada etapa no avanço físico (somam 1). Sem configuração: iguais, sem a desmontagem. */
export function pesosNormalizados(config) {
  const pesos = ETAPAS.map((e) => {
    const v = config?.pesos?.[e.id];
    return v === undefined || v === null || v === '' ? (e.extra ? 0 : 1) : Number(v) || 0;
  });
  const total = pesos.reduce((s, n) => s + n, 0) || 1;
  return pesos.map((n) => n / total);
}

/** Avanço físico ponderado (0 a 1) de um conjunto de primárias, até uma data (inclusive). */
export function avancoFisico(calc, idxs, ate = null) {
  const w = pesosNormalizados(calc.estado.config);
  let soma = 0;
  for (const i of idxs) {
    const f = calc.feitas[i];
    for (let e = 0; e < N_ETAPAS; e++) if (f[e] && (!ate || f[e] <= ate)) soma += w[e];
  }
  return idxs.length ? soma / idxs.length : 0;
}

export const idxsDaBateria = (bat) => PRIMARIAS.filter((p) => p.bateria === bat).map((p) => p.idx);
export const idxsDoForno = (fid) => fornoPorId[fid].prims.map((id) => primariaPorId[id].idx);
export const idxsDoBloco = (bl) => PRIMARIAS.filter((p) => p.bloco === bl).map((p) => p.idx);

// ---------------------------------------------------------------------------
// Curva S de revestimento, igual à planilha da Curva S (aba "BD - REV"): por
// semana, o previsto e o replanejado vêm da planilha (importada na
// sincronização com a pasta, ou a que veio com o app); o realizado são os
// fornos que fecharam (as 6 primárias com massa 1200) naquela semana, de
// segunda a domingo. Semana sem revestimento fica com zero; semana futura,
// sem realizado.
// ---------------------------------------------------------------------------
export const bmAtual = () => bmDaSemana(hoje());
export const semanasDaPlanilha = (calc) => (calc.estado.config?.curva?.semanas?.length ? calc.estado.config.curva.semanas : SEED_CURVA);

function fornosFechadosEntre(calc, de, ate) {
  const bat = contratoAtivo().bateria;
  return FORNOS.filter((f) => {
    if (f.bateria !== bat) return false;
    const d = calc.fornos[f.id].concluidoEm;
    return d && d >= de && d <= ate;
  }).map((f) => f.id);
}

/** A curva do contrato inteiro, semana a semana, agrupada por BM (guardada por cálculo e por dia). */
const curvas = new WeakMap();
export function curvaContrato(calc) {
  const dataHoje = hoje();
  const guardada = curvas.get(calc);
  if (guardada?.dia === dataHoje) return guardada.curva;
  const curva = montarCurva(calc, dataHoje);
  curvas.set(calc, { dia: dataHoje, curva });
  return curva;
}

function montarCurva(calc, dataHoje) {
  const linhas = semanasDaPlanilha(calc);
  const total = linhas.reduce((s, l) => s + (Number(l.previsto) || 0), 0) || 1;
  const comReplanejado = linhas.some((l) => l.replanejado != null);
  const contadas = new Set();
  let pa = 0;
  let rpa = 0;
  let ra = 0;
  const pontos = linhas.map((l) => {
    const seg = inicioDaSemana(l.ini);
    const dom = somarDias(seg, 6);
    const futuro = seg > dataHoje;
    // a mesma semana em duas linhas (virada de BM) conta uma vez só
    const fornos = contadas.has(seg) ? [] : fornosFechadosEntre(calc, seg, dom);
    contadas.add(seg);
    const previsto = Number(l.previsto) || 0;
    const replanejado = l.replanejado == null ? null : Number(l.replanejado);
    pa += previsto;
    if (comReplanejado) rpa += replanejado ?? previsto;
    if (!futuro) ra += fornos.length;
    return {
      ...l,
      seg,
      dom,
      previsto,
      previstoAcum: pa,
      replanejado,
      replanejadoAcum: comReplanejado ? rpa : null,
      realizado: futuro ? null : fornos.length,
      realizadoAcum: futuro ? null : ra,
      fornos,
      atual: dataHoje >= seg && dataHoje <= dom,
      futuro
    };
  });
  const bms = [];
  pontos.forEach((p, i) => {
    const ult = bms[bms.length - 1];
    if (ult && ult.bm === p.bm) ult.ate = i;
    else bms.push({ bm: p.bm, rotulo: p.bmRotulo, de: i, ate: i });
  });
  const ateHoje = pontos.filter((p) => !p.futuro);
  return {
    pontos,
    bms,
    total,
    comReplanejado,
    atual: pontos.find((p) => p.atual) || null,
    realizado: ra,
    previstoAteHoje: ateHoje.length ? ateHoje[ateHoje.length - 1].previstoAcum : 0
  };
}

/** Um BM da curva: as semanas dele, o previsto (meta) e o realizado. */
export function curvaBm(calc, bmId = bmAtual()) {
  const { inicio, fim } = periodoBm(bmId);
  let pontos = curvaContrato(calc).pontos.filter((p) => p.bm === bmId);
  if (!pontos.length) {
    // BM fora da planilha: semanas sem previsto
    const dataHoje = hoje();
    pontos = semanasDoBm(bmId).map((s) => {
      const fornos = fornosFechadosEntre(calc, s.ini, s.fim);
      const futuro = s.ini > dataHoje;
      return { ...s, seg: s.ini, dom: s.fim, previsto: 0, realizado: futuro ? null : fornos.length, fornos, atual: dataHoje >= s.ini && dataHoje <= s.fim, futuro };
    });
  }
  let ma = 0;
  let ra = 0;
  pontos = pontos.map((p) => {
    ma += p.previsto;
    if (p.realizado != null) ra += p.realizado;
    return { ...p, ini: p.seg, fim: p.dom, meta: p.previsto, metaAcum: ma, realizadoAcum: p.realizado == null ? null : ra };
  });
  const meta = ma;
  const atual = pontos.find((p) => p.atual) || null;
  const restantes = pontos.filter((p) => p.futuro || p.atual).length;
  const faltam = Math.max(0, meta - ra);
  return { bm: bmId, inicio, fim, meta, realizado: ra, faltam, pontos, atual, ritmo: restantes ? Math.ceil(faltam / restantes) : 0 };
}

/** BMs do contrato: os da planilha e os que já passaram, com meta e realizado. */
export function bmsDoContrato(calc) {
  const ids = new Set(semanasDaPlanilha(calc).map((l) => l.bm));
  for (const id of bmsEntre(bm(contratoAtivo().inicio), bmAtual())) ids.add(id);
  return [...ids].sort().map((id) => {
    const c = curvaBm(calc, id);
    return { bm: id, inicio: c.inicio, fim: c.fim, meta: c.meta, realizado: c.realizado };
  });
}

/** Semana corrente: previsto e fornos fechados, e o BM em andamento. */
export function semanaAtual(calc) {
  const c = curvaBm(calc);
  const fornosBat = FORNOS.filter((f) => f.bateria === contratoAtivo().bateria);
  return {
    semana: c.atual?.semana || semana(hoje()),
    meta: c.atual?.meta || 0,
    fechados: c.atual?.realizado || 0,
    bm: c,
    escopo: fornosBat.length,
    concluidos: fornosBat.filter((f) => calc.fornos[f.id].concluidoEm).length
  };
}

// ---------------------------------------------------------------------------
// RDO do dia montado a partir dos lançamentos e dos registros (5S, ocorrências)
// ---------------------------------------------------------------------------

/** Agrupa como no RDO: "B6 · F07 · LM · P01 P02 P03", "B6 · F07 · LM/LC". */
export function resumoAlvos(prims, etapaId) {
  const nivel = etapaPorId[etapaId].nivel;
  const porForno = new Map();
  for (const id of prims) {
    const p = primariaPorId[id];
    if (!p) continue;
    if (!porForno.has(p.fornoId)) porForno.set(p.fornoId, []);
    porForno.get(p.fornoId).push(p);
  }
  const linhas = [];
  const pn = (p) => `P${String(p.p).padStart(2, '0')}`;
  for (const [fid, ps] of [...porForno.entries()].sort()) {
    const nome = fid.replace('-', ' · ');
    const lados = ['LM', 'LC'].map((lado) => ps.filter((p) => p.lado === lado).sort((a, b) => a.p - b.p)).filter((l) => l.length);
    const ladoInteiro = (l) => l.length === 3 || nivel === 'cabeceira';
    if (nivel === 'forno' || ps.length === 6 || (nivel === 'cabeceira' && lados.length === 2)) linhas.push(`${nome} · LM/LC`);
    else for (const l of lados) linhas.push(ladoInteiro(l) ? `${nome} · ${l[0].lado}` : `${nome} · ${l[0].lado} · ${l.map(pn).join(' ')}`);
  }
  return linhas;
}

/** Primárias que tiveram a etapa concluída no dia, na bateria do contrato ativo. */
export function primariasDoDia(calc, data, etapaId) {
  const e = IDX[etapaId];
  const bat = contratoAtivo().bateria;
  return PRIMARIAS.filter((p) => p.bateria === bat && calc.feitas[p.idx][e] === data).map((p) => p.id);
}

/**
 * Último RDO emitido na planilha (número, data e acumulado de materiais). Vale
 * o mais recente entre o que veio com o app e o que a sincronização gravou.
 */
export function rdoUltimo(calc) {
  const c = calc.estado.config?.rdoUltimo;
  // o ajuste feito à mão na Configuração vale mesmo se for de antes
  return c?.data && (c.manual || c.data >= RDO_ULTIMO.data) ? { ...c, materiais: c.materiais || (c.data === RDO_ULTIMO.data ? RDO_ULTIMO.materiais : null) } : RDO_ULTIMO;
}

// ---------------------------------------------------------------------------
// RDO no formato das abas recentes da PLAN-RFX-002: até 5 colunas de
// atividades (B, D, F, H e I), título em maiúsculas na linha 8 e um item por
// linha, da 9 à 39 ("B6 - F16 - LM - P01", "B6 - F08 - LM/LC").
// ---------------------------------------------------------------------------
export const COLUNAS_RDO = 5;
export const LINHAS_RDO = 31;
const nomeForno = (fid) => fid.replace('-', ' - ');
const pn = (p) => `P${String(p.p).padStart(2, '0')}`;

/** Itens de uma atividade, como a equipe escreve no RDO. */
export function itensRdo(prims, etapaId) {
  const nivel = etapaPorId[etapaId].nivel;
  const porForno = new Map();
  for (const id of prims) {
    const p = primariaPorId[id];
    if (!p) continue;
    if (!porForno.has(p.fornoId)) porForno.set(p.fornoId, []);
    porForno.get(p.fornoId).push(p);
  }
  const fornos = [...porForno.entries()].sort(([a], [b]) => a.localeCompare(b));
  const lados = (ps) => ['LM', 'LC'].map((lado) => ps.filter((p) => p.lado === lado).sort((a, b) => a.p - b.p)).filter((l) => l.length);
  const umaPorLinha = () => fornos.flatMap(([fid, ps]) => lados(ps).flat().map((p) => `${nomeForno(fid)} - ${p.lado} - ${pn(p)}`));
  const agrupado = () => fornos.flatMap(([fid, ps]) => {
    const ls = lados(ps);
    if (nivel !== 'primaria' && ls.length === 2) return [`${nomeForno(fid)} - LM/LC`];
    if (nivel === 'primaria' && ps.length === 6) return [`${nomeForno(fid)} - LM/LC`];
    return ls.flatMap((l) => (nivel !== 'primaria' || l.length === 3 ? [`${nomeForno(fid)} - ${l[0].lado}`] : l.map((p) => `${nomeForno(fid)} - ${p.lado} - ${pn(p)}`)));
  });
  // demolição e assentamento vão uma primária por linha, como na planilha; se
  // não couber na coluna, agrupa por forno e lado
  if (['demolicao', 'assentamento'].includes(etapaId)) {
    const linhas = umaPorLinha();
    if (linhas.length <= LINHAS_RDO) return linhas;
  }
  return agrupado();
}

/** Fornos soprados no dia (registrados no Diário). */
export function sopragemDoDia(calc, data) {
  const fornos = new Set();
  for (const o of calc.estado.ocorrencias || []) {
    if (o.data !== data || o.status === 'cancelado' || o.tipo !== 'sopragem') continue;
    for (const f of o.fornos || []) if (fornoPorId[f]) fornos.add(f);
  }
  return [...fornos].sort();
}

/**
 * Distribui as atividades nas 5 colunas. Com mais de 5, a coluna mais curta
 * recebe a próxima atividade embaixo (linha em branco e o título).
 */
export function colunasRdo(atividades) {
  const colunas = atividades.map((a) => ({ blocos: [a], linhas: a.itens.length }));
  while (colunas.length > COLUNAS_RDO) {
    let melhor = null;
    for (let i = 0; i < colunas.length - 1; i++) {
      const soma = colunas[i].linhas + 2 + colunas[i + 1].linhas;
      if (!melhor || soma < melhor.soma) melhor = { i, soma };
    }
    const [a, b] = colunas.splice(melhor.i, 2);
    colunas.splice(melhor.i, 0, { blocos: [...a.blocos, ...b.blocos], linhas: melhor.soma });
  }
  return colunas.map((c) => {
    const linhas = [];
    c.blocos.forEach((b, k) => {
      if (k > 0) linhas.push({ texto: '' }, { texto: b.titulo, titulo: true });
      for (const t of b.itens) linhas.push({ texto: t });
    });
    // o que não cabe nas 31 linhas fica numa linha de aviso
    if (linhas.length > LINHAS_RDO) {
      const sobra = linhas.length - (LINHAS_RDO - 1);
      linhas.splice(LINHAS_RDO - 1, linhas.length, { texto: `E MAIS ${sobra} ITENS`, aviso: true });
    }
    return { titulo: c.blocos[0].titulo, cor: c.blocos[0].cor, blocos: c.blocos, linhas };
  });
}

/** Dias que tiveram algum serviço lançado ou registrado (para numerar o RDO). */
const diasComServico = new WeakMap();
function diaComServico(calc, data) {
  if (!diasComServico.has(calc)) {
    const dias = new Set();
    const bat = contratoAtivo().bateria;
    for (const p of PRIMARIAS) {
      if (p.bateria !== bat) continue;
      for (const d of calc.feitas[p.idx]) if (d) dias.add(d);
    }
    for (const o of calc.estado.ocorrencias || []) if (o.status !== 'cancelado') dias.add(o.data);
    diasComServico.set(calc, dias);
  }
  return diasComServico.get(calc).has(data);
}

/** Dia com RDO: dia útil que não é feriado, ou qualquer dia com serviço. */
export const temExpediente = (calc, data) => (diaUtil(data) && !FERIADOS.includes(data)) || Boolean(calc.estado.rdos?.[data]) || diaComServico(calc, data);

export function rdoDoDia(calc, data) {
  const bat = contratoAtivo().bateria;
  const salvo = calc.estado.rdos[data] || null;
  const etapas = ETAPAS.map((et) => {
    const prims = primariasDoDia(calc, data, et.id);
    return { id: et.id, etapa: et, prims, linhas: resumoAlvos(prims, et.id), titulo: et.rdo, cor: et.cor, itens: itensRdo(prims, et.id) };
  });
  const atividades = etapas.filter((a) => a.prims.length);
  const soprados = sopragemDoDia(calc, data);
  const sopragem = soprados.length ? { id: 'sopragem', titulo: TITULO_SOPRAGEM, cor: '#a2a9b8', fornos: soprados, itens: soprados.map((f) => `${nomeForno(f)} - LM/LC`) } : null;
  const naOrdem = ORDEM_RDO.map((id) => (id === 'sopragem' ? sopragem : atividades.find((a) => a.id === id))).filter(Boolean);
  const colunas = colunasRdo(naOrdem);

  // materiais: o anterior continua o acumulado da última aba da planilha; o
  // aplicado sai dos lançamentos (ou do que o planejador corrigiu no RDO)
  const daBat = PRIMARIAS.filter((p) => p.bateria === bat);
  const aplicadoNoDia = (m, d) => {
    const fixo = calc.estado.rdos[d]?.materiais?.[m.id];
    if (fixo != null) return Number(fixo) || 0;
    const e = IDX[m.etapa];
    return daBat.filter((p) => calc.feitas[p.idx][e] === d).length * m.porPrimaria;
  };
  const ultimo = rdoUltimo(calc);
  const materiais = MATERIAIS.map((m) => {
    const aplicado = aplicadoNoDia(m, data);
    let anterior;
    if (ultimo.materiais?.[m.id] != null && data > ultimo.data) {
      anterior = Number(ultimo.materiais[m.id]) || 0;
      for (let d = somarDias(ultimo.data, 1); d < data; d = somarDias(d, 1)) anterior += aplicadoNoDia(m, d);
    } else {
      const e = IDX[m.etapa];
      anterior = daBat.filter((p) => calc.feitas[p.idx][e] && calc.feitas[p.idx][e] < data).length * m.porPrimaria;
    }
    return { ...m, anterior, aplicado, acumulado: anterior + aplicado, calculado: salvo?.materiais?.[m.id] == null };
  });
  const ocorrencias = (calc.estado.ocorrencias || []).filter((o) => o.data === data && o.status !== 'cancelado').sort((a, b) => (a.criadoEmLocal || 0) - (b.criadoEmLocal || 0));
  // lançamentos do dia com observação: entram nas observações do RDO
  const observacoesCampo = calc.validos.filter((l) => l.data === data && l.obs?.trim()).sort((a, b) => (a.criadoEmLocal || 0) - (b.criadoEmLocal || 0));
  // até o último RDO da planilha, o relatório já foi emitido fora do app
  const status = salvo?.status && salvo.status !== 'rascunho' ? salvo.status : data <= ultimo.data ? 'planilha' : 'rascunho';
  return { data, numero: numeroRdo(calc, data), atividades, sopragem, colunas, materiais, ocorrencias, observacoesCampo, salvo, status, expediente: temExpediente(calc, data) };
}

/**
 * Numeração: continua a da planilha. O RDO fechado guarda o número; o aberto
 * conta, a partir do último numerado, os dias com expediente ou com serviço.
 */
export function numeroRdo(calc, data) {
  const rdos = calc.estado.rdos || {};
  if (rdos[data]?.numero) return Number(rdos[data].numero);
  const ultimo = rdoUltimo(calc);
  if (data <= ultimo.data || !temExpediente(calc, data)) return null;
  let ancora = { data: ultimo.data, numero: Number(ultimo.numero) };
  for (const [d, r] of Object.entries(rdos)) if (r?.numero && d > ancora.data && d < data) ancora = { data: d, numero: Number(r.numero) };
  let n = ancora.numero;
  for (let d = somarDias(ancora.data, 1); d <= data; d = somarDias(d, 1)) if (temExpediente(calc, d)) n++;
  return n;
}

const lista = (itens) => (itens.length <= 1 ? itens[0] || '' : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`);

/** Onde foi o 5S, em frase: "na intermediária, na laje entre os blocos B6 e B7 e nos fornos B7 F03 e F04". */
export function descreverLocais5S(locais = []) {
  const partes = [];
  if (locais.includes('intermediaria')) partes.push('na intermediária');
  if (locais.includes('interligacao')) partes.push('na interligação');
  const lajes = locais.filter((l) => l.startsWith('laje:')).map((l) => l.slice(5).split('-')).sort();
  if (lajes.length === 1) partes.push(`na laje entre os blocos ${lajes[0][0]} e ${lajes[0][1]}`);
  else if (lajes.length) partes.push(`nas lajes entre os blocos ${lista(lajes.map(([a, b]) => `${a}/${b}`))}`);
  const fornos = locais.filter((l) => l.startsWith('forno:')).map((l) => l.slice(6)).sort();
  if (fornos.length) {
    const porBloco = new Map();
    for (const f of fornos) {
      const [bl, fo] = f.split('-');
      if (!porBloco.has(bl)) porBloco.set(bl, []);
      porBloco.get(bl).push(fo);
    }
    const grupos = [...porBloco.entries()].map(([bl, fs]) => `${bl} ${lista(fs)}`);
    partes.push(`${fornos.length === 1 ? 'no forno' : 'nos fornos'} ${grupos.join(', ')}`);
  }
  return lista(partes);
}

/** Texto de um registro do Diário (o 5S com local vira frase). */
export function textoOcorrencia(o) {
  if (o.tipo === '5s' && o.locais?.length) return `a equipe realizou 5S (limpeza e organização) ${descreverLocais5S(o.locais)}${o.texto?.trim() ? `. ${o.texto.trim()}` : ''}`;
  return o.texto || '';
}

/**
 * Observações do RDO montadas com tudo o que o campo registrou no dia: o 5S
 * e as ocorrências do Diário e a observação de cada lançamento, com o texto
 * corrigido e em maiúsculas, como na planilha.
 */
export function observacoesSugeridas(rdo) {
  const doLancamento = (l) => {
    const e = etapaPorId[l.etapa];
    const onde = resumoAlvos(l.prims, l.etapa).map((s) => s.replace(/ · /g, ' ')).join(', ');
    return `${e.id === 'assentamento' ? 'no' : 'na'} ${e.rdo.toLowerCase()} do ${onde}, ${l.obs.trim()}`;
  };
  const itens = [
    ...rdo.ocorrencias.filter((o) => o.tipo !== 'sopragem').map(textoOcorrencia),
    ...(rdo.observacoesCampo || []).map(doLancamento)
  ].map(corrigirTexto).filter(Boolean);
  if (!itens.length) return '';
  return `A REFRAMAX INFORMA QUE ${itens.join('; ')}.`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Checklist de entrega: 8 fotos por forno (abóbada + 3 manilhas, em cada
// lado). O líder tira e envia; o planejador aprova e o número entra na
// medição. Os fornos que vieram da planilha entram aprovados, numerados na
// ordem em que os blocos fecharam e, dentro do bloco, pela ordem dos fornos.
// ---------------------------------------------------------------------------
export function checklists(calc) {
  const bat = contratoAtivo().bateria;
  const salvos = calc.estado.checklists || {};
  const concluidos = FORNOS.filter((f) => f.bateria === bat && calc.fornos[f.id].concluidoEm);
  const fimDoBloco = (bl) => concluidos.filter((f) => f.bloco === bl).map((f) => calc.fornos[f.id].concluidoEm).sort().pop();
  const daPlanilha = concluidos
    .filter((f) => !calc.fornos[f.id].fechouLanc && !salvos[f.id])
    .sort((a, b) => fimDoBloco(a.bloco).localeCompare(fimDoBloco(b.bloco)) || a.bloco.localeCompare(b.bloco) || a.forno - b.forno);
  const mapa = {};
  daPlanilha.forEach((f, i) => {
    mapa[f.id] = { numero: i + 1, status: 'aprovado', fotos: {}, nFotos: 0, origem: 'planilha', concluidoEm: calc.fornos[f.id].concluidoEm };
  });
  const comServico = FORNOS.filter((f) => f.bateria === bat && !mapa[f.id] && (salvos[f.id] || calc.fornos[f.id].niveis.some((n) => n >= I_MAPA.indexOf(IDX.injetbar))));
  for (const f of comServico) {
    const s = salvos[f.id] || {};
    const fotos = s.fotos || {};
    const nFotos = SLOTS_FOTO.filter((sl) => fotos[sl.id]).length;
    const status = ['aprovado', 'enviado', 'devolvido'].includes(s.status) ? s.status : nFotos ? 'rascunho' : 'pendente';
    mapa[f.id] = { ...s, status, fotos, nFotos, numero: s.numero || null, concluidoEm: calc.fornos[f.id].concluidoEm };
  }
  return mapa;
}

export const proximoNumeroChecklist = (calc) => Math.max(0, ...Object.values(checklists(calc)).map((c) => c.numero || 0)) + 1;

// ---------------------------------------------------------------------------
// Pessoas: o que cada um lançou (perfil e o lembrete no botão de lançar)
// ---------------------------------------------------------------------------
export function numerosPessoa(calc, uid) {
  const meus = calc.validos.filter((l) => l.autor?.uid === uid);
  const hj = hoje();
  const soma = (ls) => ls.reduce((s, l) => s + l.prims.length, 0);
  return { etapas: soma(meus), hojeEtapas: soma(meus.filter((l) => l.data === hj)), dias: new Set(meus.map((l) => l.data)).size };
}

/** O que um lançamento novo provocou: fornos e blocos fechados (para avisar o líder). */
export function efeitosDoLancamento(antes, depois, lanc) {
  const fornos = [...new Set(lanc.prims.map((id) => primariaPorId[id].fornoId))].filter((fid) => !antes.fornos[fid].concluidoEm && depois.fornos[fid].concluidoEm);
  const blocos = [...new Set(fornos.map((fid) => fornoPorId[fid].bloco))].filter((bl) => !antes.blocos[bl].concluidoEm && depois.blocos[bl].concluidoEm);
  return { fornos, blocos };
}

// ---------------------------------------------------------------------------
// Resumos para o painel
// ---------------------------------------------------------------------------
export function contagemPorEtapa(calc, bat) {
  const c = new Array(I_MAPA.length + 1).fill(0); // índice 0 = pendente
  for (const p of PRIMARIAS) if (p.bateria === bat) c[calc.nivel[p.idx] + 1]++;
  return c;
}

/**
 * Andamento da bateria: primárias que já passaram por cada etapa (acumulado,
 * mesmo as que já seguiram adiante) e os andaimes montados agora.
 */
export function andamento(calc, bat) {
  const prims = PRIMARIAS.filter((p) => p.bateria === bat);
  const fornos = FORNOS.filter((f) => f.bateria === bat);
  const feitas = (etapa) => prims.filter((p) => calc.feitas[p.idx][IDX[etapa]]).length;
  const montados = (f) => ['LM', 'LC'].filter((l) => calc.fornos[f.id].andaime[l] === 'montado').length;
  return {
    primarias: prims.length,
    fornosComAndaime: fornos.filter((f) => montados(f) > 0).length,
    ladosComAndaime: fornos.reduce((s, f) => s + montados(f), 0),
    demolidas: feitas('demolicao'),
    instaladas: feitas('assentamento'),
    injetbar: feitas('injetbar'),
    revestidas: feitas('massa1200')
  };
}

/** Etapas feitas por dia (primária × etapa) num intervalo, separadas por etapa. */
export function producaoDiaria(calc, de, ate) {
  const bat = contratoAtivo().bateria;
  const dias = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  const pos = Object.fromEntries(dias.map((d, i) => [d, i]));
  const serie = ETAPAS.map(() => new Array(dias.length).fill(0));
  for (const p of PRIMARIAS) {
    if (p.bateria !== bat) continue;
    const f = calc.feitas[p.idx];
    for (let e = 0; e < N_ETAPAS; e++) if (f[e] && pos[f[e]] !== undefined) serie[e][pos[f[e]]]++;
  }
  return { dias, serie };
}

/** Fornos concluídos agrupados por boletim de medição (pela semana em que fecharam). */
export function fornosPorBm(calc) {
  const bat = contratoAtivo().bateria;
  const grupos = {};
  for (const f of FORNOS) {
    const d = calc.fornos[f.id].concluidoEm;
    if (f.bateria !== bat || !d) continue;
    (grupos[bmDaSemana(d)] ||= []).push({ ...f, concluidoEm: d });
  }
  for (const g of Object.values(grupos)) g.sort((a, b) => a.concluidoEm.localeCompare(b.concluidoEm) || a.id.localeCompare(b.id));
  return grupos;
}

/** Relação da medição: fornos do BM (pela semana em que fecharam), na ordem do checklist. */
export function relacaoDoBm(calc, bmId) {
  const bat = contratoAtivo().bateria;
  const ck = checklists(calc);
  return FORNOS.filter((f) => f.bateria === bat && calc.fornos[f.id].concluidoEm && bmDaSemana(calc.fornos[f.id].concluidoEm) === bmId)
    .map((f) => ({ fid: f.id, bloco: f.bloco, forno: f.forno, concluidoEm: calc.fornos[f.id].concluidoEm, checklist: ck[f.id] || null }))
    .sort((a, b) => (a.checklist?.numero || 1e9) - (b.checklist?.numero || 1e9) || a.concluidoEm.localeCompare(b.concluidoEm) || a.fid.localeCompare(b.fid));
}

export { IDX as INDICE_ETAPA, N_ETAPAS, I_MAPA };
