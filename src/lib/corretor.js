// Corrige o texto que vai para as observações do RDO. O líder digita rápido
// no celular, sem acento e abreviado ("manutencao no b6 f7 lm, q ja foi
// liberado"); aqui vira texto de relatório ("manutenção no B6 F07 LM, que já
// foi liberado"). Não reescreve frases: só acentos, abreviações, nomes de
// bloco, forno, lado e primária, espaços e pontuação.

// palavras comuns na obra que perdem o acento no celular
const ACENTOS = {
  nao: 'não', ja: 'já', ate: 'até', apos: 'após', tambem: 'também', alem: 'além', porem: 'porém', so: 'só',
  voce: 'você', voces: 'vocês', estao: 'estão', sao: 'são', entao: 'então', tres: 'três', mes: 'mês',
  area: 'área', areas: 'áreas', inicio: 'início', termino: 'término', proximo: 'próximo', proxima: 'próxima',
  ultimo: 'último', ultima: 'última', unico: 'único', unica: 'única', util: 'útil', uteis: 'úteis', varios: 'vários', varias: 'várias',
  maquina: 'máquina', maquinas: 'máquinas', refratario: 'refratário', refratarios: 'refratários', refrataria: 'refratária', refratarias: 'refratárias',
  intermediaria: 'intermediária', intermediarias: 'intermediárias', servico: 'serviço', servicos: 'serviços', agua: 'água',
  horario: 'horário', horarios: 'horários', necessario: 'necessário', necessaria: 'necessária', residuo: 'resíduo', residuos: 'resíduos',
  ceramica: 'cerâmica', tecnico: 'técnico', tecnica: 'técnica', termica: 'térmica', eletrica: 'elétrica', mecanica: 'mecânica',
  periodo: 'período', almoco: 'almoço', cacamba: 'caçamba', cacambas: 'caçambas', peca: 'peça', pecas: 'peças', rapido: 'rápido',
  concluido: 'concluído', concluida: 'concluída', concluidos: 'concluídos', concluidas: 'concluídas', especifico: 'específico',
  critico: 'crítico', obstaculo: 'obstáculo', veiculo: 'veículo', veiculos: 'veículos', ferias: 'férias', ausencia: 'ausência', ausencias: 'ausências', emergencia: 'emergência', experiencia: 'experiência',
  materia: 'matéria'
};

// nomes próprios da obra
const NOMES = { ternium: 'Ternium', reframax: 'Reframax', injetbar: 'Injetbar', silplate: 'Silplate', didurit: 'Didurit', munck: 'Munck' };

// abreviações de mensagem
const ABREVIACOES = {
  q: 'que', pq: 'porque', tb: 'também', tbm: 'também', vc: 'você', vcs: 'vocês', hj: 'hoje', td: 'tudo', tds: 'todos',
  msm: 'mesmo', qdo: 'quando', qnd: 'quando', qndo: 'quando', ñ: 'não', eqp: 'equipe', manut: 'manutenção', obg: 'obrigado'
};

function trocarPalavra(original) {
  const p = original.toLowerCase();
  if (NOMES[p]) return original === original.toUpperCase() && original.length > 1 ? NOMES[p].toUpperCase() : NOMES[p];
  let nova = ABREVIACOES[p] || ACENTOS[p];
  // terminações que em português quase sempre levam acento ou cedilha
  if (!nova && !/[à-ÿ]/.test(p) && p.length > 3) {
    nova = p
      .replace(/coes$/, 'ções').replace(/cao$/, 'ção')
      .replace(/soes$/, 'sões').replace(/sao$/, 'são')
      .replace(/aveis$/, 'áveis').replace(/avel$/, 'ável')
      .replace(/iveis$/, 'íveis').replace(/ivel$/, 'ível');
    if (nova === p) nova = null;
  }
  if (!nova) return original;
  // mantém maiúsculas de quem escreveu
  if (original === original.toUpperCase() && original.length > 1) return nova.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return nova[0].toUpperCase() + nova.slice(1);
  return nova;
}

const doisDigitos = (n) => String(Number(n)).padStart(2, '0');

/** Texto corrigido, sem ponto final (quem monta a frase decide a pontuação). */
export function corrigirTexto(texto) {
  let t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // p/ c/ s/ soltos
  t = t.replace(/(^|[\s(])([pcs])\/(?=\s|$)/gi, (_, antes, l) => `${antes}${{ p: 'para', c: 'com', s: 'sem' }[l.toLowerCase()]}`);
  // bloco, forno, primária e lado no jeito do RDO: B6 F07 LM P01
  t = t
    .replace(/\b(?:bloco|bl|b)\s?\.?\s?([1-8])\b(?!\s*(?:dias?|horas?|h\b|min))/gi, 'B$1')
    .replace(/\b(?:forno|fr|f)\s?\.?\s?(\d{1,2})\b(?!\s*(?:dias?|horas?|h\b|min))/gi, (_, n) => (Number(n) >= 1 && Number(n) <= 18 ? `F${doisDigitos(n)}` : _))
    .replace(/\bp0?([1-6])\b/gi, 'P0$1')
    .replace(/\blado\s+maquina\b/gi, 'lado máquina')
    .replace(/\b(lm|lc)\b/gi, (m) => m.toUpperCase())
    .replace(/\b5s\b/gi, '5S');
  // palavras: acentos e abreviações
  t = t.replace(/[A-Za-zÀ-ÿ]+/g, trocarPalavra);
  // pontuação: sem espaço antes, com espaço depois, sem repetição
  t = t
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:.!?])\1+/g, '$1')
    .replace(/([,;:])(?=[^\s\d])/g, '$1 ')
    .replace(/([.!?])(?=[A-Za-zÀ-ÿ])/g, '$1 ')
    .replace(/([.!?]\s+)([a-zà-ÿ])/g, (_, fim, letra) => fim + letra.toUpperCase())
    .replace(/[\s,;:.]+$/, '');
  return t[0].toUpperCase() + t.slice(1);
}
