import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';

/**
 * /api/usuarios: o que o navegador não pode fazer sozinho com as contas.
 *
 *   GET                                  { configurado }
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
  if (req.method === 'GET') return resposta(200, { configurado: Boolean(app) });
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

  // daqui em diante, só administrador
  let quem;
  try {
    quem = await auth.verifyIdToken((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  } catch {
    return resposta(401, { erro: 'sessao' });
  }
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

export const config = { path: '/api/usuarios' };
