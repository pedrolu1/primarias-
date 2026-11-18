// Preenche as planilhas de controle a partir do app, direto no XML do .xlsx:
// só as células de dados mudam; fórmulas, formatação, gráficos, tabelas
// dinâmicas e macros ficam como estavam. Ao abrir, o Excel recalcula tudo e
// atualiza as tabelas dinâmicas.
//   - Gestão Visual: datas de demolição, instalação e revestimento, andaime
//     de cada primária e o "atualizado em" do mapa (a medição fica com a equipe).
//   - Curva S: realizado de cada semana (e, se pedir, a meta do app no previsto).
//   - Resumo da medição (espelho): uma aba nova para o BM, com a relação dos
//     fornos, o número do checklist e o status.
//   - RDO (PLAN-RFX-002): uma aba nova por dia, cópia da última.
// Funciona no navegador e no Node (testes), sem DOM.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { PRIMARIAS, FORNOS, primariaPorId, contratoAtivo, localMedicao, MATERIAIS, EFETIVO_MODELO } from '../data/obra.js';
import { INDICE_ETAPA as IDX, relacaoDoBm, rdoDoDia, observacoesSugeridas } from './calculo.js';
import { iso, hoje, inicioDaSemana, somarDias, periodoBm, referenciaBm, completa } from './datas.js';

// ---------------------------------------------------------------------------
// Pacote .xlsx
// ---------------------------------------------------------------------------
export function abrirPacote(bytes) {
  const arquivos = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const textos = new Map();
  return {
    arquivos,
    existe: (p) => p in arquivos || textos.has(p),
    ler(p) {
      if (!textos.has(p)) {
        if (!(p in arquivos)) throw new Error(`parte ausente: ${p}`);
        textos.set(p, strFromU8(arquivos[p]));
      }
      return textos.get(p);
    },
    gravar(p, texto) {
      textos.set(p, texto);
      if (!(p in arquivos)) arquivos[p] = new Uint8Array(0);
    },
    copiar(de, para) {
      arquivos[para] = arquivos[de].slice();
      if (textos.has(de)) textos.set(para, textos.get(de));
    },
    remover(p) {
      delete arquivos[p];
      textos.delete(p);
    },
    salvar() {
      const saida = {};
      for (const p of Object.keys(arquivos)) saida[p] = textos.has(p) ? strToU8(textos.get(p)) : arquivos[p];
      return zipSync(saida, { level: 6 });
    }
  };
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const desesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const attr = (tag, nome) => {
  const m = new RegExp(`\\s${nome}="([^"]*)"`).exec(tag);
  return m ? desesc(m[1]) : null;
};

export const colNum = (letras) => [...letras].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export function colLetra(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Data ISO → número de série do Excel (dias desde 30/12/1899). */
export const serialDe = (d) => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
export const dataDoSerial = (n) => iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(n)) * 86400000 + 12 * 3600000));

/** Textos compartilhados (sharedStrings.xml). */
export function lerStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => (m[1] ? desesc([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')) : ''));
}

/** Abas do livro: nome → caminho da parte. */
export function abasDoLivro(pacote) {
  const wb = pacote.ler('xl/workbook.xml');
  const rels = pacote.ler('xl/_rels/workbook.xml.rels');
  const alvo = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  return [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => {
    const t = alvo[attr(m[0], 'r:id')];
    return { nome: attr(m[0], 'name'), sheetId: Number(attr(m[0], 'sheetId')), rid: attr(m[0], 'r:id'), caminho: t.startsWith('/') ? t.slice(1) : `xl/${t}` };
  });
}

// ---------------------------------------------------------------------------
// Aba: leitura e escrita de células no XML, preservando o resto.
// ---------------------------------------------------------------------------
const RE_LINHA = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
const RE_CEL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

export class Aba {
  constructor(xml, strings = []) {
    this.strings = strings;
    this.indiceStrings = null;
    const ini = xml.indexOf('<sheetData');
    const fimAbre = xml.indexOf('>', ini) + 1;
    let brutas = [];
    if (xml[fimAbre - 2] === '/') {
      this.antes = `${xml.slice(0, ini)}<sheetData>`;
      this.depois = `</sheetData>${xml.slice(fimAbre)}`;
    } else {
      const fim = xml.indexOf('</sheetData>');
      this.antes = xml.slice(0, fimAbre);
      this.depois = xml.slice(fim);
      brutas = xml.slice(fimAbre, fim).match(RE_LINHA) || [];
    }
    // cada linha guarda o número e o XML original; só as alteradas são refeitas
    this.partes = brutas.map((x) => ({ r: Number(attr(x.slice(0, x.indexOf('>') + 1), 'r')), xml: x }));
    this.pos = new Map(this.partes.map((p, i) => [p.r, i]));
    this.abertas = new Map();
  }

  /** Linha decodificada (abre, células por coluna). */
  linha(r) {
    if (this.abertas.has(r)) return this.abertas.get(r);
    const i = this.pos.get(r);
    if (i === undefined) return null;
    const p = this.partes[i].xml;
    const fimAbre = p.indexOf('>') + 1;
    const fechada = p[fimAbre - 2] === '/';
    const abre = fechada ? `${p.slice(0, fimAbre - 2)}>` : p.slice(0, fimAbre);
    const corpo = fechada ? '' : p.slice(fimAbre, p.length - '</row>'.length);
    const celulas = new Map();
    for (const m of corpo.matchAll(RE_CEL)) {
      const ref = attr(` ${m[1]}`, 'r');
      celulas.set(colNum(ref.replace(/\d+/g, '')), { atributos: m[1], interno: m[2] ?? null, xml: m[0] });
    }
    const l = { r, abre, celulas, mudou: false };
    this.abertas.set(r, l);
    return l;
  }

  linhas() {
    return this.partes.map((p) => p.r);
  }

  /** Valor da célula: número, texto, booleano ou null. */
  valor(ref) {
    const { col, r } = separar(ref);
    const c = this.linha(r)?.celulas.get(col);
    if (!c || c.interno == null) return null;
    const t = attr(` ${c.atributos}`, 't');
    if (t === 'inlineStr') return desesc([...c.interno.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    const v = /<v>([\s\S]*?)<\/v>/.exec(c.interno);
    if (!v) return null;
    if (t === 's') return this.strings[Number(v[1])] ?? null;
    if (t === 'str' || t === 'e') return desesc(v[1]);
    if (t === 'b') return v[1] === '1';
    return v[1] === '' ? null : Number(v[1]);
  }

  temFormula(ref) {
    const { col, r } = separar(ref);
    const c = this.linha(r)?.celulas.get(col);
    return Boolean(c?.interno && /<f[\s>/]/.test(c.interno));
  }

  /**
   * Grava um valor mantendo o estilo da célula. valor: número, texto, null
   * (limpa) ou { data: 'aaaa-mm-dd' }. Nunca sobrescreve fórmula.
   */
  definir(ref, valor, { estilo = null } = {}) {
    const { col, r } = separar(ref);
    let l = this.linha(r);
    if (!l) l = this.criarLinha(r);
    const atual = l.celulas.get(col);
    if (atual?.interno && /<f[\s>/]/.test(atual.interno)) throw new Error(`a célula ${ref} tem fórmula`);
    const s = atual ? attr(` ${atual.atributos}`, 's') : estilo;
    const base = `r="${colLetra(col)}${r}"${s != null ? ` s="${s}"` : ''}`;
    let xml;
    if (valor == null || valor === '') xml = `<c ${base}/>`;
    else if (typeof valor === 'object' && valor.data) xml = `<c ${base}><v>${serialDe(valor.data)}</v></c>`;
    else if (typeof valor === 'number') xml = `<c ${base}><v>${Number.isFinite(valor) ? valor : 0}</v></c>`;
    else {
      const k = this.indiceDoTexto(String(valor));
      xml = k >= 0 ? `<c ${base} t="s"><v>${k}</v></c>` : `<c ${base} t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
    }
    if (atual?.xml === xml) return false;
    l.celulas.set(col, { atributos: xml.slice(2, xml.indexOf('>')).replace(/\/$/, ''), interno: xml.endsWith('/>') ? null : xml.slice(xml.indexOf('>') + 1, -4), xml });
    l.mudou = true;
    return true;
  }

  /** Estilo (índice s) da célula, ou null. */
  estilo(ref) {
    const { col, r } = separar(ref);
    const c = this.linha(r)?.celulas.get(col);
    return c ? attr(` ${c.atributos}`, 's') : null;
  }

  /** Troca só o valor guardado de uma célula com fórmula (o Excel recalcula ao abrir). */
  definirCache(ref, numero) {
    const { col, r } = separar(ref);
    const l = this.linha(r);
    const c = l?.celulas.get(col);
    if (!c?.interno || !/<f[\s>/]/.test(c.interno)) return false;
    const interno = /<v>[\s\S]*?<\/v>/.test(c.interno) ? c.interno.replace(/<v>[\s\S]*?<\/v>/, `<v>${numero}</v>`) : `${c.interno}<v>${numero}</v>`;
    const atributos = c.atributos.replace(/\st="[^"]*"/, '');
    l.celulas.set(col, { atributos, interno, xml: `<c ${atributos.trim()}>${interno}</c>` });
    l.mudou = true;
    return true;
  }

  indiceDoTexto(t) {
    if (!this.indiceStrings) {
      this.indiceStrings = new Map();
      this.strings.forEach((s, i) => !this.indiceStrings.has(s) && this.indiceStrings.set(s, i));
    }
    return this.indiceStrings.get(t) ?? -1;
  }

  criarLinha(r) {
    const nova = { r, abre: `<row r="${r}">`, celulas: new Map(), mudou: true };
    let i = this.partes.findIndex((p) => p.r > r);
    if (i < 0) i = this.partes.length;
    this.partes.splice(i, 0, { r, xml: '' });
    this.pos = new Map(this.partes.map((p, k) => [p.r, k]));
    this.abertas.set(r, nova);
    return nova;
  }

  /** Troca o texto de um atributo da raiz (ex.: tirar tabSelected). */
  ajustarCabecalho(fn) {
    this.antes = fn(this.antes);
  }

  toString() {
    const partes = this.partes.map((p) => {
      const l = this.abertas.get(p.r);
      if (!l || !l.mudou) return p.xml;
      const cels = [...l.celulas.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c.xml).join('');
      return cels ? `${l.abre}${cels}</row>` : `${l.abre.slice(0, -1)}/>`;
    });
    return this.antes + partes.join('') + this.depois;
  }
}

function separar(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`referência inválida: ${ref}`);
  return { col: colNum(m[1]), r: Number(m[2]) };
}

function abrirAba(pacote, nome) {
  const abas = abasDoLivro(pacote);
  const a = abas.find((x) => x.nome.trim().toLowerCase() === nome.trim().toLowerCase());
  if (!a) return null;
  const strings = pacote.existe('xl/sharedStrings.xml') ? lerStrings(pacote.ler('xl/sharedStrings.xml')) : [];
  return { ...a, aba: new Aba(pacote.ler(a.caminho), strings) };
}

/** Recalcula tudo ao abrir e atualiza as tabelas dinâmicas. */
function marcarParaRecalcular(pacote) {
  let wb = pacote.ler('xl/workbook.xml');
  if (/<calcPr\b[^>]*\/>/.test(wb)) {
    wb = wb.replace(/<calcPr\b([^>]*)\/>/, (_, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
  } else if (/<calcPr\b[^>]*>/.test(wb)) {
    wb = wb.replace(/<calcPr\b([^>]*)>/, (_, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1">`);
  } else {
    wb = wb.replace(/(<\/definedNames>|<\/sheets>)(?![\s\S]*(<\/definedNames>))/, (m) => `${m}<calcPr fullCalcOnLoad="1"/>`);
  }
  pacote.gravar('xl/workbook.xml', wb);
  for (const p of Object.keys(pacote.arquivos)) {
    if (!/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(p)) continue;
    pacote.gravar(p, pacote.ler(p).replace(/<pivotCacheDefinition\b([^>]*)>/, (_, a) => `<pivotCacheDefinition${a.replace(/\srefreshOnLoad="[^"]*"/, '')} refreshOnLoad="1">`));
  }
}

const doisDigitos = (n) => String(n).padStart(2, '0');
const carimbo = (agora) => `${doisDigitos(agora.getDate())}/${doisDigitos(agora.getMonth() + 1)}/${agora.getFullYear()} - ${doisDigitos(agora.getHours())}:${doisDigitos(agora.getMinutes())}`;
// ---------------------------------------------------------------------------
// Gestão Visual: aba "Banco de Dados" (linha 32 em diante)
// C item · E bloco · F lado · G forno · H primária · K andaime (SIM/NÃO)
// L/M demolição início/fim · O/P instalação início/fim · R/S revestimento
// início/fim. A coluna W (medição) não é tocada.
// ---------------------------------------------------------------------------
export function atualizarGestaoVisual(bytes, calc, { agora = new Date(), baterias = [contratoAtivo().bateria] } = {}) {
  const pacote = abrirPacote(bytes);
  const bd = abrirAba(pacote, 'Banco de Dados');
  if (!bd) throw new Error('Não achei a aba "Banco de Dados". Confira se é a planilha de Gestão Visual.');
  const { aba } = bd;
  const resumo = { primarias: 0, celulas: 0, linhas: 0, semLinha: [] };
  const vistas = new Set();
  const ajustar = (ref, valor) => {
    if (aba.temFormula(ref)) return;
    if (aba.definir(ref, valor)) resumo.celulas++;
  };
  const dataDe = (ref) => {
    const v = aba.valor(ref);
    return typeof v === 'number' && v > 0 ? dataDoSerial(v) : null;
  };
  const par = (r, colIni, colFim, d) => {
    if (!d) return;
    if (dataDe(`${colFim}${r}`) !== d) ajustar(`${colFim}${r}`, { data: d });
    const ini = dataDe(`${colIni}${r}`);
    if (!ini || ini > d) ajustar(`${colIni}${r}`, { data: d });
  };
  for (const r of aba.linhas()) {
    if (r < 32) continue;
    const bloco = aba.valor(`E${r}`);
    if (typeof bloco !== 'string' || !baterias.includes(bloco.trim()[0])) continue;
    const id = `${bloco.trim()}-${String(aba.valor(`G${r}`)).trim()}-${String(aba.valor(`F${r}`)).trim()}-${String(aba.valor(`H${r}`)).trim()}`;
    const p = primariaPorId[id];
    if (!p) continue;
    resumo.linhas++;
    vistas.add(id);
    const f = calc.feitas[p.idx];
    const q = calc.quem[p.idx];
    const antes = resumo.celulas;
    par(r, 'L', 'M', f[IDX.demolicao]);
    par(r, 'O', 'P', f[IDX.assentamento]);
    // revestimento: começa no Injetbar e termina na massa 1200
    par(r, 'R', 'S', f[IDX.massa1200]);
    const iniRev = f[IDX.injetbar] || f[IDX.massa1200];
    if (iniRev) {
      const atual = dataDe(`R${r}`);
      if (!atual || atual > iniRev) ajustar(`R${r}`, { data: iniRev });
    }
    // andaime: só o que foi lançado no app (a planilha sabe o resto)
    if (q[IDX.desmontagem]) ajustar(`K${r}`, 'NÃO');
    else if (q[IDX.andaime] && !f[IDX.desmontagem]) ajustar(`K${r}`, 'SIM');
    // a medição (coluna W) fica com a equipe: só entra quando o forno é medido
    if (resumo.celulas > antes) resumo.primarias++;
  }
  resumo.semLinha = PRIMARIAS.filter((p) => baterias.includes(p.bateria) && !vistas.has(p.id)).map((p) => p.id);
  pacote.gravar(bd.caminho, aba.toString());

  // "ATUALIZADO EM" do mapa da bateria: data em W27 e hora em Y27
  for (const bat of baterias) {
    const vis = abrirAba(pacote, `Visual - Bat. ${bat}`);
    if (!vis) continue;
    const rotulo = vis.aba.valor('W26');
    if (typeof rotulo === 'string' && /ATUALIZADO/i.test(rotulo)) {
      vis.aba.definir('W27', { data: iso(agora) });
      if (!vis.aba.temFormula('Y27')) vis.aba.definir('Y27', Number(((agora.getHours() * 60 + agora.getMinutes()) / 1440).toFixed(10)));
      pacote.gravar(vis.caminho, vis.aba.toString());
    }
  }
  marcarParaRecalcular(pacote);
  return { bytes: pacote.salvar(), resumo };
}

// ---------------------------------------------------------------------------
// Curva S: aba "BD - REV" (linha 2 em diante)
// A BM · E início da semana ("dd/mm/aaaa - ddd") · H semana · I previsto · U realizado
// ---------------------------------------------------------------------------
export function atualizarCurvaS(bytes, calc, { agora = new Date(), dataHoje = hoje() } = {}) {
  const pacote = abrirPacote(bytes);
  const bd = abrirAba(pacote, 'BD - REV');
  if (!bd) throw new Error('Não achei a aba "BD - REV". Confira se é a planilha da Curva S.');
  const { aba } = bd;
  const bat = contratoAtivo().bateria;
  const fechados = FORNOS.filter((f) => f.bateria === bat && calc.fornos[f.id].concluidoEm).map((f) => calc.fornos[f.id].concluidoEm);
  const resumo = { semanas: 0, realizado: 0, celulas: 0 };
  const usadas = new Set();
  for (const r of aba.linhas()) {
    if (r < 2) continue;
    const texto = aba.valor(`E${r}`);
    const m = typeof texto === 'string' ? /(\d{2})\/(\d{2})\/(\d{4})/.exec(texto) : null;
    let ini = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    if (!ini && typeof texto === 'number') ini = dataDoSerial(texto);
    if (!ini) continue;
    const seg = inicioDaSemana(ini);
    const dom = somarDias(seg, 6);
    resumo.semanas++;
    let valor = null;
    if (seg <= dataHoje) {
      // a mesma semana partida em duas linhas conta uma vez só
      valor = usadas.has(seg) ? 0 : fechados.filter((d) => d >= seg && d <= dom).length;
      usadas.add(seg);
      resumo.realizado += valor;
    }
    if (!aba.temFormula(`U${r}`) && aba.definir(`U${r}`, valor)) resumo.celulas++;
  }
  pacote.gravar(bd.caminho, aba.toString());
  const at = abrirAba(pacote, 'Atualização');
  if (at && typeof at.aba.valor('B2') === 'string' && !at.aba.temFormula('B2')) {
    at.aba.definir('B2', `ATUALIZADO EM: ${carimbo(agora)}`);
    pacote.gravar(at.caminho, at.aba.toString());
  }
  marcarParaRecalcular(pacote);
  return { bytes: pacote.salvar(), resumo };
}

/**
 * Lê a aba "BD - REV" da Curva S: por semana, BM, rótulo do BM, início e fim,
 * dias úteis, previsto e replanejado (o realizado sai dos lançamentos do app).
 */
export function lerCurvaS(bytes) {
  const pacote = abrirPacote(bytes);
  const bd = abrirAba(pacote, 'BD - REV');
  if (!bd) throw new Error('Não achei a aba "BD - REV". Confira se é a planilha da Curva S.');
  const { aba } = bd;
  const data = (v) => {
    if (typeof v === 'number') return dataDoSerial(v);
    const m = typeof v === 'string' ? /(\d{2})\/(\d{2})\/(\d{4})/.exec(v) : null;
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const num = (v) => (v === null || v === '' || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
  const semanas = [];
  for (const r of aba.linhas()) {
    if (r < 2) continue;
    const bm = aba.valor(`A${r}`);
    const ini = data(aba.valor(`E${r}`));
    if (typeof bm !== 'string' || !/^\d{4}_\d{2}$/.test(bm.trim()) || !ini) continue;
    semanas.push({
      bm: bm.trim(),
      bmRotulo: String(aba.valor(`B${r}`) || '').trim(),
      semana: String(aba.valor(`H${r}`) || '').trim(),
      ini,
      fim: data(aba.valor(`F${r}`)) || ini,
      dias: num(aba.valor(`G${r}`)),
      previsto: num(aba.valor(`I${r}`)) || 0,
      replanejado: num(aba.valor(`O${r}`))
    });
  }
  if (!semanas.length) throw new Error('A aba "BD - REV" não tem semanas.');
  return semanas;
}

// ---------------------------------------------------------------------------
// Resumo da medição (espelho): uma aba por BM. Copia a última aba e preenche
// período (E8), mês de referência (E9) e a relação: itens 1 a 25 em C:F
// (linhas 14 a 38) e 26 a 50 em H:K; subtotais em F40/K40 e total em K42.
// ---------------------------------------------------------------------------
const MESES_MAIUSC = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const POR_COLUNA = 25;

export function nomeAbaEspelho(bmId, blocos) {
  const [a, m] = bmId.split('_').map(Number);
  const ini = MESES_MAIUSC[(m + 10) % 12];
  const fim = MESES_MAIUSC[m - 1];
  const lista = blocos.length > 1 ? `${blocos.slice(0, -1).join(', ')} E ${blocos[blocos.length - 1]}` : blocos[0] || '';
  return `BM ${ini} - ${fim}${lista ? ` - ${lista}` : ''}`.slice(0, 31).replace(/[[\]:*?/\\]/g, '-') || `BM ${a}`;
}

export function gerarEspelho(bytes, calc, bmId) {
  const pacote = abrirPacote(bytes);
  const itens = relacaoDoBm(calc, bmId);
  const blocos = [...new Set(itens.map((i) => i.bloco))];
  const nome = nomeAbaEspelho(bmId, blocos);
  const abas = abasDoLivro(pacote);
  if (!abas.length) throw new Error('A planilha não tem abas.');
  const mesmaRef = abas.find((a) => a.nome.trim() === nome.trim());
  let alvo;
  if (mesmaRef) alvo = mesmaRef;
  else alvo = clonarAba(pacote, abas[abas.length - 1], nome);

  const strings = pacote.existe('xl/sharedStrings.xml') ? lerStrings(pacote.ler('xl/sharedStrings.xml')) : [];
  const aba = new Aba(pacote.ler(alvo.caminho), strings);
  const { inicio, fim } = periodoBm(bmId);
  aba.definir('E8', `${completa(inicio)} a ${completa(fim)}`);
  aba.definir('E9', referenciaBm(bmId));
  for (let k = 0; k < POR_COLUNA; k++) {
    const r = 14 + k;
    for (const c of ['C', 'D', 'E', 'F', 'H', 'I', 'J', 'K']) if (!aba.temFormula(`${c}${r}`)) aba.definir(`${c}${r}`, null);
  }
  const lim = Math.min(itens.length, POR_COLUNA * 2);
  for (let i = 0; i < lim; i++) {
    const it = itens[i];
    const r = 14 + (i % POR_COLUNA);
    const [ci, cn, cl, cs] = i < POR_COLUNA ? ['C', 'D', 'E', 'F'] : ['H', 'I', 'J', 'K'];
    aba.definir(`${ci}${r}`, i + 1);
    aba.definir(`${cn}${r}`, it.checklist?.numero ?? null);
    aba.definir(`${cl}${r}`, localMedicao(it.fid));
    aba.definir(`${cs}${r}`, it.checklist?.status === 'aprovado' ? 'APROVADO' : 'PENDENTE');
  }
  const ajustarSe = (ref, v) => !aba.temFormula(ref) && aba.definir(ref, v);
  ajustarSe('F40', Math.min(lim, POR_COLUNA));
  ajustarSe('K40', lim > POR_COLUNA ? lim - POR_COLUNA : null);
  ajustarSe('K42', lim);
  // esta aba fica selecionada ao abrir
  pacote.gravar(alvo.caminho, aba.toString());
  selecionarAba(pacote, alvo.nome);
  marcarParaRecalcular(pacote);
  return { bytes: pacote.salvar(), resumo: { aba: alvo.nome, nova: !mesmaRef, fornos: itens.length, aprovados: itens.filter((i) => i.checklist?.status === 'aprovado').length, foraDoLimite: Math.max(0, itens.length - lim) } };
}

function proximoNumero(pacote, prefixo, sufixo) {
  let n = 1;
  while (pacote.existe(`${prefixo}${n}${sufixo}`)) n++;
  return n;
}
const guid = () => '{xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx}'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16).toUpperCase();
});

/**
 * Copia uma aba (com desenho e configuração de impressão) para uma aba nova,
 * no fim do livro ou, com logoDepois, logo depois da origem.
 */
function clonarAba(pacote, origem, nome, { logoDepois = false } = {}) {
  const n = proximoNumero(pacote, 'xl/worksheets/sheet', '.xml');
  const caminho = `xl/worksheets/sheet${n}.xml`;
  let xml = pacote.ler(origem.caminho).replace(/\sxr:uid="\{[^}]*\}"/, ` xr:uid="${guid()}"`);
  pacote.gravar(caminho, xml);
  const tipos = [`<Override PartName="/${caminho}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`];

  // relações da aba: desenho e impressão ganham cópias próprias
  const relsOrigem = origem.caminho.replace('worksheets/', 'worksheets/_rels/') + '.rels';
  if (pacote.existe(relsOrigem)) {
    let rels = pacote.ler(relsOrigem);
    rels = rels.replace(/<Relationship\b[^>]*>/g, (tag) => {
      const alvo = attr(tag, 'Target');
      const tipo = attr(tag, 'Type') || '';
      if (/\/drawing$/.test(tipo)) {
        const d = proximoNumero(pacote, 'xl/drawings/drawing', '.xml');
        const de = `xl/drawings/${alvo.split('/').pop()}`;
        pacote.copiar(de, `xl/drawings/drawing${d}.xml`);
        const relsDe = `xl/drawings/_rels/${alvo.split('/').pop()}.rels`;
        if (pacote.existe(relsDe)) pacote.copiar(relsDe, `xl/drawings/_rels/drawing${d}.xml.rels`);
        tipos.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
        return tag.replace(/Target="[^"]*"/, `Target="../drawings/drawing${d}.xml"`);
      }
      if (/\/printerSettings$/.test(tipo)) {
        const k = proximoNumero(pacote, 'xl/printerSettings/printerSettings', '.bin');
        pacote.copiar(`xl/printerSettings/${alvo.split('/').pop()}`, `xl/printerSettings/printerSettings${k}.bin`);
        return tag.replace(/Target="[^"]*"/, `Target="../printerSettings/printerSettings${k}.bin"`);
      }
      return tag;
    });
    pacote.gravar(`xl/worksheets/_rels/sheet${n}.xml.rels`, rels);
  }
  let ct = pacote.ler('[Content_Types].xml');
  pacote.gravar('[Content_Types].xml', ct.replace('</Types>', `${tipos.join('')}</Types>`));

  // livro: a aba nova, o vínculo e os nomes de impressão/filtro da origem
  let wbRels = pacote.ler('xl/_rels/workbook.xml.rels');
  let id = 1;
  while (wbRels.includes(`Id="rId${id}"`)) id++;
  wbRels = wbRels.replace('</Relationships>', `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`);
  pacote.gravar('xl/_rels/workbook.xml.rels', wbRels);
  let wb = pacote.ler('xl/workbook.xml');
  const abas = abasDoLivro(pacote);
  const sheetId = Math.max(...abas.map((a) => a.sheetId)) + 1;
  const idxOrigem = abas.findIndex((a) => a.nome === origem.nome);
  const idxNova = logoDepois ? idxOrigem + 1 : abas.length;
  const tagNova = `<sheet name="${esc(nome)}" sheetId="${sheetId}" r:id="rId${id}"/>`;
  if (idxNova < abas.length) {
    // as abas depois da nova andam uma posição: nomes locais e aba ativa
    let k = -1;
    wb = wb.replace(/<sheet\b[^>]*\/>/g, (tag) => (++k === idxNova ? `${tagNova}${tag}` : tag));
    wb = wb.replace(/(<definedName\b[^>]*localSheetId=")(\d+)(")/g, (_, a, n, b) => `${a}${Number(n) >= idxNova ? Number(n) + 1 : n}${b}`);
  } else {
    wb = wb.replace('</sheets>', `${tagNova}</sheets>`);
  }
  const citar = (t) => `'${t.replace(/'/g, "''")}'`;
  const nomes = [...wb.matchAll(/<definedName\b[^>]*localSheetId="(\d+)"[^>]*>([\s\S]*?)<\/definedName>/g)].filter((m) => Number(m[1]) === idxOrigem);
  const novos = nomes.map((m) => {
    const ref = desesc(m[2]).replace(/^(?:'(?:[^']|'')+'|[^!]+)!/, `${citar(nome)}!`);
    return m[0].replace(/localSheetId="\d+"/, `localSheetId="${idxNova}"`).replace(/>[\s\S]*<\/definedName>$/, `>${esc(ref)}</definedName>`);
  });
  if (novos.length) wb = wb.replace('</definedNames>', `${novos.join('')}</definedNames>`);
  pacote.gravar('xl/workbook.xml', wb);

  // a cadeia de cálculo é refeita pelo Excel
  if (pacote.existe('xl/calcChain.xml')) {
    pacote.remover('xl/calcChain.xml');
    pacote.gravar('xl/_rels/workbook.xml.rels', pacote.ler('xl/_rels/workbook.xml.rels').replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/, ''));
    pacote.gravar('[Content_Types].xml', pacote.ler('[Content_Types].xml').replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
  }
  return { nome, sheetId, rid: `rId${id}`, caminho };
}

/** Deixa só a aba indicada selecionada e ativa. */
function selecionarAba(pacote, nome) {
  const abas = abasDoLivro(pacote);
  const k = abas.findIndex((a) => a.nome === nome);
  for (const a of abas) {
    const xml = pacote.ler(a.caminho);
    const novo = xml.replace(/<sheetView\b([^>]*?)(\/?)>/, (_, at, fecha) => {
      const sem = at.replace(/\stabSelected="[^"]*"/, '');
      return `<sheetView${a.nome === nome ? `${sem} tabSelected="1"` : sem}${fecha}>`;
    });
    if (novo !== xml) pacote.gravar(a.caminho, novo);
  }
  let wb = pacote.ler('xl/workbook.xml');
  wb = wb.replace(/<workbookView\b([^>]*?)\/>/, (_, at) => {
    const sem = at.replace(/\sactiveTab="[^"]*"/, '').replace(/\sfirstSheet="[^"]*"/, '');
    return `<workbookView${sem}${k > 0 ? ` activeTab="${k}"` : ''}/>`;
  });
  pacote.gravar('xl/workbook.xml', wb);
}

// ---------------------------------------------------------------------------
// RDO (PLAN-RFX-002): uma aba por dia, com o número no nome ("254"). A aba
// nova é cópia da anterior e entra logo depois dela. Células usadas:
// C1 nº · C2 data · B8, D8, F8, H8 e I8 os títulos e, da linha 9 à 39, os
// itens · C40 observações · L efetivo realizado (pela função da coluna J) ·
// F48/F49 clima do turno diurno · L, M e N os materiais (pela descrição da
// coluna J) · A70 observações da contratante. Fórmulas não são tocadas.
// ---------------------------------------------------------------------------
const COLUNAS_ATIVIDADE = ['B', 'D', 'F', 'H', 'I'];
const LIMPAR_ATIVIDADES = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const normal = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function abasDoRdo(pacote) {
  return abasDoLivro(pacote)
    .filter((a) => /^\d+$/.test(a.nome.trim()))
    .map((a) => ({ ...a, numero: Number(a.nome.trim()) }))
    .sort((a, b) => a.numero - b.numero);
}
const stringsDe = (pacote) => (pacote.existe('xl/sharedStrings.xml') ? lerStrings(pacote.ler('xl/sharedStrings.xml')) : []);
const materialDaLinha = (aba, r) => {
  const desc = aba.valor(`J${r}`);
  return typeof desc === 'string' ? MATERIAIS.find((m) => desc.toUpperCase().includes(m.chave)) || null : null;
};

/** Última aba do RDO: número, data e acumulado de cada material. */
export function lerRdoPlanilha(bytes) {
  const pacote = abrirPacote(bytes);
  const abas = abasDoRdo(pacote);
  if (!abas.length) throw new Error('Não achei as abas numeradas do RDO. Confira se é a planilha PLAN-RFX-002.');
  const strings = stringsDe(pacote);
  const ultima = abas[abas.length - 1];
  const aba = new Aba(pacote.ler(ultima.caminho), strings);
  const c2 = aba.valor('C2');
  const materiais = {};
  for (let r = 44; r <= 60; r++) {
    const m = materialDaLinha(aba, r);
    if (!m) continue;
    const n = aba.valor(`N${r}`);
    const l = aba.valor(`L${r}`);
    const ap = aba.valor(`M${r}`);
    materiais[m.id] = typeof n === 'number' ? n : (Number(l) || 0) + (Number(ap) || 0);
  }
  return { numero: ultima.numero, data: typeof c2 === 'number' ? dataDoSerial(c2) : null, materiais, abas: abas.length };
}

/**
 * Grava no livro do RDO os dias pedidos e todos os RDOs fechados no app que
 * ainda não estão nele (número maior que o da última aba). Aba que já existe
 * com o mesmo número e a mesma data é atualizada; com outra data, fica como
 * está e volta em "conflitos".
 */
export function gravarRdos(bytes, calc, { datas = [] } = {}) {
  const pacote = abrirPacote(bytes);
  if (!abasDoRdo(pacote).length) throw new Error('Não achei as abas numeradas do RDO. Confira se é a planilha PLAN-RFX-002.');
  const strings = stringsDe(pacote);
  const ultimaDaPlanilha = abasDoRdo(pacote).pop().numero;
  const fechados = Object.entries(calc.estado.rdos || {})
    .filter(([, r]) => ['fechado', 'assinado'].includes(r?.status) && Number(r.numero) > ultimaDaPlanilha)
    .map(([d]) => d);
  const resumo = { gravadas: [], novas: 0, conflitos: [] };
  let ultimaGravada = null;
  for (const data of [...new Set([...fechados, ...datas])].sort()) {
    const rdo = rdoDoDia(calc, data);
    if (!rdo.numero) {
      resumo.conflitos.push({ data, motivo: 'dia sem número de RDO' });
      continue;
    }
    const abas = abasDoRdo(pacote);
    let alvo = abas.find((a) => a.numero === rdo.numero);
    let nova = false;
    if (alvo) {
      const c2 = new Aba(pacote.ler(alvo.caminho), strings).valor('C2');
      if (typeof c2 === 'number' && dataDoSerial(c2) !== data) {
        resumo.conflitos.push({ data, numero: rdo.numero, motivo: `a aba ${rdo.numero} da planilha é de ${completa(dataDoSerial(c2))}` });
        continue;
      }
    } else {
      const origem = [...abas].reverse().find((a) => a.numero < rdo.numero) || abas[abas.length - 1];
      alvo = clonarAba(pacote, origem, String(rdo.numero), { logoDepois: true });
      nova = true;
      resumo.novas++;
    }
    const aba = new Aba(pacote.ler(alvo.caminho), strings);
    preencherAbaRdo(aba, rdo);
    pacote.gravar(alvo.caminho, aba.toString());
    resumo.gravadas.push({ numero: rdo.numero, data, status: rdo.status, nova });
    ultimaGravada = alvo.nome;
  }
  if (ultimaGravada) selecionarAba(pacote, ultimaGravada);
  marcarParaRecalcular(pacote);
  return { bytes: pacote.salvar(), resumo };
}

function preencherAbaRdo(aba, rdo) {
  const s = rdo.salvo || {};
  const def = (ref, v, estilo = null) => !aba.temFormula(ref) && aba.definir(ref, v, { estilo });
  const limpar = (ref) => aba.valor(ref) !== null && def(ref, null);
  def('C1', rdo.numero);
  def('C2', { data: rdo.data });
  aba.definirCache('C3', serialDe(rdo.data));

  // registro das atividades
  const estTitulo = aba.estilo('B8');
  const estItem = aba.estilo('B9');
  for (let r = 8; r <= 39; r++) for (const c of LIMPAR_ATIVIDADES) limpar(`${c}${r}`);
  rdo.colunas.slice(0, COLUNAS_ATIVIDADE.length).forEach((col, k) => {
    const c = COLUNAS_ATIVIDADE[k];
    def(`${c}8`, col.titulo, estTitulo);
    col.linhas.forEach((l, i) => l.texto && def(`${c}${9 + i}`, l.texto, estItem));
  });
  const obs = s.obs ?? observacoesSugeridas(rdo);
  def('C40', obs || null);

  // efetivo realizado, pela função escrita na coluna J
  const efetivo = s.efetivo || {};
  const funcoes = new Map([...EFETIVO_MODELO.moi, ...EFETIVO_MODELO.mod, ...EFETIVO_MODELO.equipamentos].map(([f, prev]) => [normal(f), [f, prev]]));
  for (let r = 9; r <= 44; r++) {
    const f = funcoes.get(normal(aba.valor(`J${r}`)));
    if (f) def(`L${r}`, Number(efetivo[f[0]] ?? f[1]));
  }
  const soma = (de, ate) => {
    let t = 0;
    for (let r = de; r <= ate; r++) t += Number(aba.valor(`L${r}`)) || 0;
    return t;
  };
  const moi = soma(9, 17);
  const mod = soma(22, 34);
  aba.definirCache('L18', moi);
  aba.definirCache('L35', mod);
  aba.definirCache('L36', moi + mod);

  // clima do turno diurno
  const clima = s.clima?.diurno || 'estavel';
  def('F48', clima === 'estavel' ? 'X' : null);
  def('F49', clima === 'chuvoso' ? 'X' : null);

  // controle de produção
  for (let r = 44; r <= 60; r++) {
    const m = materialDaLinha(aba, r);
    const v = m && rdo.materiais.find((x) => x.id === m.id);
    if (!v) continue;
    def(`L${r}`, v.anterior);
    def(`M${r}`, v.aplicado);
    if (aba.temFormula(`N${r}`)) aba.definirCache(`N${r}`, v.acumulado);
    else def(`N${r}`, v.acumulado);
  }
  if (s.obsContratante) def('A70', s.obsContratante);
}

// ---------------------------------------------------------------------------
// Base do app a partir da Gestão Visual (tela Configuração): por primária,
// fim da demolição, fim da instalação, início e fim do revestimento e andaime.
// ---------------------------------------------------------------------------
export function lerBaseDaGestaoVisual(bytes, { epoch = '2025-09-01' } = {}) {
  const pacote = abrirPacote(bytes);
  const bd = abrirAba(pacote, 'Banco de Dados');
  if (!bd) throw new Error('Não achei a aba "Banco de Dados". Confira se é a planilha de Gestão Visual.');
  const { aba } = bd;
  const e0 = serialDe(epoch);
  const dias = (ref) => {
    const v = aba.valor(ref);
    return typeof v === 'number' && v > 0 ? Math.floor(v) - e0 : -1;
  };
  const porId = new Map();
  let ultima = epoch;
  for (const r of aba.linhas()) {
    if (r < 32) continue;
    const bloco = aba.valor(`E${r}`);
    if (typeof bloco !== 'string') continue;
    const id = `${bloco.trim()}-${String(aba.valor(`G${r}`)).trim()}-${String(aba.valor(`F${r}`)).trim()}-${String(aba.valor(`H${r}`)).trim()}`;
    if (!primariaPorId[id]) continue;
    const v = [dias(`M${r}`), dias(`P${r}`), dias(`R${r}`), dias(`S${r}`)];
    for (const n of v) if (n >= 0) ultima = somarDias(epoch, n) > ultima ? somarDias(epoch, n) : ultima;
    const k = String(aba.valor(`K${r}`) || '').trim().toUpperCase();
    porId.set(id, [...v, k === 'SIM' ? 1 : 0]);
  }
  const baterias = {};
  let faltando = 0;
  for (const p of PRIMARIAS) {
    const v = porId.get(p.id);
    if (!v) faltando++;
    (baterias[p.bateria] ||= []).push(...(v || [-1, -1, -1, -1, 0]));
  }
  if (porId.size < PRIMARIAS.length / 2) throw new Error('A aba "Banco de Dados" não tem as primárias esperadas.');
  return { epoch, valores: 5, baterias, ate: ultima, faltando };
}
