# REFRAMAX Primárias

App de lançamento e acompanhamento da substituição das válvulas primárias dos
fornos da coqueria. Publicado em https://reframax-primarias.netlify.app (site
`reframax-primarias` na Netlify), com banco e logins num projeto Firebase só dele.

- **Login:** matrícula + senha. A primeira conta criada vira o dono do app
  (administrador que ninguém rebaixa nem bloqueia pelo app). As demais nascem
  como líder pendente, até o administrador liberar.
- **Papéis:** líder (lança o avanço e tira as fotos), planejador (acompanha,
  aprova, fecha o RDO e gera os documentos), administrador (tudo do planejador e
  a tela de Usuários) e gestor (só leitura).
- **Líder (celular):** Hoje, Mapa, Lançar, Fotos e Diário. Toca no forno, vê os
  dois lados e lança a próxima etapa de cada lado; com o forno concluído, tira as
  8 fotos do checklist (por lado: a abóbada inteira e as 3 manilhas instaladas e
  revestidas) e envia. No Diário registra 5S, ocorrências, material e segurança,
  que viram as observações do RDO. Lançamento não se altera no campo: quem errou
  pede correção ao planejador.
- **Painel:** Visão geral, Mapa visual, Curva S por BM (revestimento em fornos,
  meta de 36 por BM do dia 16 ao 15, com a semana atual destacada), RDO no
  formato PLAN-RFX-002, Checklists (aprovar ou devolver as fotos; o número segue
  a sequência da medição), Documentos, Lançamentos, Correções, Desvios, Usuários
  e Configuração.
- **Documentos:** PDF do mapa, da Curva S, do espelho da medição e do checklist
  com as fotos (por forno ou o BM inteiro), e as planilhas de controle
  preenchidas pelo app: Gestão Visual, Curva S e Resumo da medição. O app mexe
  só nas células de dados; fórmulas, gráficos, tabelas dinâmicas e macros ficam
  como estavam, e o Excel recalcula ao abrir.
- **Sem internet:** o que for lançado (fotos inclusive) fica no aparelho e sobe
  sozinho quando a rede volta. O aviso no topo mostra "Sem internet", "Enviando"
  ou "Em dia".

## Rodar no computador

```bash
npm install
npm run dev      # com o banco online (chaves em src/lib/firebase-config.js)
npm run demo     # modo demonstração, dados só no navegador
npm run build    # gera dist/
```

Para apontar para outro projeto Firebase sem mexer no código, copie
`.env.example` para `.env` e preencha as chaves.

## Colocar no ar pela primeira vez

1. **Firebase** (console.firebase.google.com, com a conta Google da empresa):
   - Criar projeto, por exemplo `reframax-primarias` (Google Analytics pode
     ficar desligado).
   - Na página do projeto, ícone `</>` (Web) → registrar o app → copiar o bloco
     `firebaseConfig` para `src/lib/firebase-config.js` (as chaves não são senha:
     vão dentro do app de qualquer jeito).
   - Authentication → Começar → Método de login → E-mail/senha → Ativar.
   - Firestore Database → Criar banco de dados → local `southamerica-east1`
     (São Paulo) → modo de produção. Na aba Regras, colar o conteúdo de
     `firestore.rules` e Publicar.
2. **Publicar:** cada push na `main` monta o app no GitHub Actions. Com o secret
   `NETLIFY_AUTH_TOKEN` (token pessoal da Netlify) no repositório, ele também
   publica; sem o secret, publique pelo conector da Netlify do Claude.
3. **Primeira conta:** abra o app e toque em "Criar conta". Essa conta vira o
   dono do app; as próximas aparecem para ele liberar na tela Usuários.
4. **Senha provisória (opcional):** Firebase → Configurações do projeto → Contas
   de serviço → Gerar nova chave privada. Na Netlify, site `reframax-primarias`
   → Site configuration → Environment variables → `FIREBASE_SERVICE_ACCOUNT`
   com o conteúdo do arquivo `.json`.

## Organização

- `src/`: o app. `src/base/` tem os componentes de interface (botões, campos,
  modais, layout) que vieram do Tempos & Métodos.
- `firestore.rules`: regras do banco (colar no console a cada mudança, ou
  `firebase deploy --only firestore:rules`).
- `netlify/functions/senha.mjs`: senha provisória gerada pelo administrador.
- `scripts/`: ícones (`npm run icones`) e a base histórica tirada da planilha.
- `rotina/`: rotina diária no computador do planejador (WhatsApp → planilhas).

## Base histórica (antes do app)

Vem da planilha de Gestão Visual: datas de demolição, instalação e revestimento
e o andaime (coluna K) de cada primária. O planejador atualiza pela tela
Configuração ("Atualizar pela Gestão Visual"), ou, no código:

```bash
python3 scripts/gerar-seed.py "Gestão Visual - Compilado.xlsx" src/data/seed.js
```

## Rotina diária (WhatsApp → planilhas)

`rotina/` tem o que roda no computador do planejador: o Claude lê o grupo das
primárias no WhatsApp Web, mostra o avanço para conferir e roda
`preencher-primarias.ps1`, que preenche o RDO, a Curva S e a Gestão Visual pelo
próprio Excel. Instruções em `rotina/SKILL.md`; instalação em `rotina/LEIA-ME.md`.
