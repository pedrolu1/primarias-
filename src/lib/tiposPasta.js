// As planilhas que o app procura na pasta primarias, pelo nome do arquivo.
// auto: lida e gravada sozinha a cada sincronização.
export const TIPOS_PASTA = {
  gestao: { nome: 'Gestão Visual', auto: true, teste: (n) => /gest.{0,2}o.?visual/i.test(n) },
  curva: { nome: 'Curva S', auto: true, teste: (n) => /curva.?s(?![a-z])/i.test(n) },
  rdo: { nome: 'RDO', auto: true, teste: (n) => /plan.?rfx.?002|(^|[^a-z])rdo([^a-z]|$)/i.test(n) },
  resumo: { nome: 'Resumo da medição', auto: false, teste: (n) => /resumo|espelho/i.test(n) }
};
