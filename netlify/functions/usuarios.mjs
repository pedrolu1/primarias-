import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { randomInt } from 'node:crypto';

/**
 * /api/usuarios: o que o navegador não pode fazer sozinho com as contas.
 *
 *   GET                                  { configurado, temDono, regras }
 *   POST { acao: 'assumir-dono' }        a primeira conta vira o dono (só se o app não tem dono)
 *   POST { acao: 'senha', uid }          senha provisória (a pessoa cria a dela no próximo acesso)
 *   POST { acao: 'excluir', uid }        apaga a conta de login e o cadastro no app
 *   POST { acao: 'acesso', uid, ativo }  liga ou desliga o login (bloqueio)
 *   POST { acao: 'pedido-senha', matricula }   "esqueci a senha", sem login: vira um
 *                                        pedido para o administrador (resposta sempre igual)
 *
 * Regras: só administrador aprovado; nunca a própria conta nem a do dono do
 * app; conta de outro administrador, só o dono mexe.
 *
 * Precisa da chave da conta de serviço na variável FIREBASE_SERVICE_ACCOUNT da
 * Netlify (o .json de Firebase → Configurações do projeto → Contas de serviço).
 */

const resposta = (status, corpo) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// sem letras e números que se confundem (l/1, o/0)
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
const senhaProvisoria = () => Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
const DOMINIO = 'matricula.reframax-primarias.internal';
const INTERVALO_PEDIDO = 10 * 60 * 1000;

function firebase() {
  if (getApps().length) return getApps()[0];
  const chave = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!chave) return null;
  return initializeApp({ credential: cert(JSON.parse(chave)) });
}

export default async (req) => {
  let app;
  try {
    app = firebase();
  } catch {
    return resposta(500, { erro: 'credencial-invalida' });
  }
  if (req.method === 'GET') {
    if (!app) return resposta(200, { configurado: false });
    const db = getFirestore(app);
    const [dono, regras] = await Promise.all([
      db.doc('prim_config/dono').get().then((d) => d.exists, () => null),
      situacaoRegras(app)
    ]);
    return resposta(200, { configurado: true, temDono: dono, regras });
  }
  if (req.method !== 'POST') return resposta(405, { erro: 'metodo' });
  if (!app) return resposta(503, { erro: 'nao-configurado' });
  const auth = getAuth(app);
  const db = getFirestore(app);

  let pedido;
  try {
    pedido = await req.json();
  } catch {
    return resposta(400, { erro: 'pedido' });
  }

  // "esqueci a senha": sem login. Nunca diz se a matrícula existe.
  if (pedido?.acao === 'pedido-senha') {
    const matricula = String(pedido.matricula || '').trim();
    if (!/^\d{6}$/.test(matricula)) return resposta(400, { erro: 'matricula' });
    try {
      const conta = await auth.getUserByEmail(`${matricula}@${DOMINIO}`);
      const cadastro = (await db.doc(`prim_usuarios/${conta.uid}`).get()).data();
      const ref = db.doc(`prim_pedidos_senha/${conta.uid}`);
      const antes = (await ref.get()).data();
      if (cadastro && (!antes || Date.now() - (antes.em?.toMillis?.() || 0) > INTERVALO_PEDIDO)) {
        await ref.set({ uid: conta.uid, matricula, nome: cadastro.nome || conta.displayName || '', em: FieldValue.serverTimestamp() });
      }
    } catch {
      /* matrícula sem conta: responde igual */
    }
    return resposta(200, { ok: true });
  }

  let quem;
  try {
    quem = await auth.verifyIdToken((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  } catch {
    return resposta(401, { erro: 'sessao' });
  }

  // a primeira conta vira o dono, mesmo se o navegador não conseguiu
  // gravar no banco (regras antigas ou rede da empresa bloqueando)
  if (pedido?.acao === 'assumir-dono') {
    const [matricula, dominio] = String(quem.email || '').split('@');
    if (dominio !== DOMINIO || !/^\d{6}$/.test(matricula)) return resposta(400, { erro: 'matricula' });
    const conta = await auth.getUser(quem.uid);
    const resultado = await db.runTransaction(async (t) => {
      const donoRef = db.doc('prim_config/dono');
      const dono = await t.get(donoRef);
      if (dono.exists) return dono.data().uid === quem.uid ? 'ja-e-dono' : 'tem-dono';
      const ref = db.doc(`prim_usuarios/${quem.uid}`);
      const cadastro = await t.get(ref);
      const nome = String(cadastro.data()?.nome || conta.displayName || matricula).trim().slice(0, 120);
      t.set(ref, { nome, matricula, papel: 'admin', status: 'aprovado', ...(cadastro.exists ? {} : { criadoEm: FieldValue.serverTimestamp() }) }, { merge: true });
      t.set(donoRef, { uid: quem.uid, nome, matricula, em: FieldValue.serverTimestamp() });
      return cadastro.exists ? 'ok' : 'ok-sem-cadastro';
    });
    if (resultado === 'tem-dono') return resposta(409, { erro: 'tem-dono' });
    return resposta(200, { ok: true, cadastroNoServidor: resultado !== 'ok-sem-cadastro', regras: await situacaoRegras(app) });
  }

  // daqui em diante, só administrador
  const eu = (await db.doc(`prim_usuarios/${quem.uid}`).get()).data();
  if (!(eu && eu.papel === 'admin' && eu.status === 'aprovado')) return resposta(403, { erro: 'sem-permissao' });

  const uid = String(pedido?.uid || '');
  if (!uid || uid === quem.uid) return resposta(400, { erro: 'propria-conta' });
  const dono = (await db.doc('prim_config/dono').get()).data()?.uid || null;
  if (uid === dono) return resposta(403, { erro: 'principal' });
  const alvo = db.doc(`prim_usuarios/${uid}`);
  const cadastro = await alvo.get();
  if (cadastro.data()?.papel === 'admin' && quem.uid !== dono) return resposta(403, { erro: 'sem-permissao' });

  if (pedido.acao === 'senha') {
    if (!cadastro.exists) return resposta(404, { erro: 'usuario' });
    const senha = senhaProvisoria();
    await auth.updateUser(uid, { password: senha, disabled: false });
    await auth.revokeRefreshTokens(uid);
    await alvo.update({ trocarSenha: true, senhaRedefinidaEm: FieldValue.serverTimestamp(), senhaRedefinidaPor: quem.uid });
    await db.doc(`prim_pedidos_senha/${uid}`).delete().catch(() => {});
    return resposta(200, { ok: true, senha });
  }

  if (pedido.acao === 'excluir') {
    try {
      await auth.deleteUser(uid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
    }
    await alvo.delete();
    await db.doc(`prim_pedidos_senha/${uid}`).delete().catch(() => {});
    return resposta(200, { ok: true });
  }

  if (pedido.acao === 'acesso') {
    const ativo = pedido.ativo !== false;
    try {
      await auth.updateUser(uid, { disabled: !ativo });
      if (!ativo) await auth.revokeRefreshTokens(uid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
    }
    return resposta(200, { ok: true });
  }

  return resposta(400, { erro: 'acao' });
};

/** Se as regras publicadas no Firebase são as deste app (as atuais têm o pedido de senha e o "assume dono"). */
async function situacaoRegras(app) {
  try {
    const ruleset = await getSecurityRules(app).getFirestoreRuleset();
    const texto = ruleset.source.map((f) => f.content).join('\n');
    return texto.includes('prim_pedidos_senha') && texto.includes('assumeDono') ? 'atuais' : 'antigas';
  } catch {
    return 'desconhecido';
  }
}

export const config = { path: '/api/usuarios' };
