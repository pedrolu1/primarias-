// Login e acesso ao Primárias: a conta é a matrícula + senha, no projeto
// Firebase do próprio app. O acesso e o papel de cada um (líder, planejador,
// administrador ou gestor) ficam em prim_usuarios. A primeira conta criada vira
// o "dono": administrador que ninguém rebaixa nem bloqueia pelo app. As demais
// nascem como líder pendente, até o administrador liberar.
// Sem Firebase configurado (desenvolvimento), entra-se escolhendo um perfil
// de demonstração.
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from './firebase.js';

export const modoDemo = !firebaseConfigured;
const COL = 'prim_usuarios';
// e-mail interno: a matrícula é a conta (ninguém digita e-mail)
const DOMINIO = 'matricula.reframax-primarias.internal';
const emailDa = (matricula) => `${String(matricula).trim()}@${DOMINIO}`;
export const matriculaValida = (m) => /^\d{6}$/.test(String(m || '').trim());

function comPrazo(promessa, ms = 20000) {
  return Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'auth/timeout' })), ms))]);
}

const SEM_LOGIN = 'O login por matrícula ainda não foi ligado no Firebase do app (Authentication, método E-mail/senha). Quem administra o Firebase precisa ativar.';

export function mensagemDeErro(err) {
  const mapa = {
    'auth/invalid-email': 'Matrícula inválida: são 6 números.',
    'auth/user-disabled': 'Seu acesso foi bloqueado pelo administrador. Fale com o planejamento.',
    'auth/user-not-found': 'Matrícula ou senha incorretos.',
    'auth/wrong-password': 'Matrícula ou senha incorretos.',
    'auth/invalid-credential': 'Matrícula ou senha incorretos.',
    'auth/email-already-in-use': 'Essa matrícula já tem conta. Entre com ela.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de trocar a senha.',
    'auth/network-request-failed': 'Sem conexão. Para entrar pela primeira vez neste aparelho precisa de internet.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
    'auth/operation-not-allowed': SEM_LOGIN,
    'auth/configuration-not-found': SEM_LOGIN,
    'auth/admin-restricted-operation': 'O Firebase do app está bloqueando contas novas (Authentication, Configurações, Ações do usuário: ative a criação de contas).',
    'auth/timeout': 'O servidor demorou para responder. Confira a internet e tente de novo.',
    'permission-denied': 'O banco do app recusou a gravação. Confira se as regras do Firebase foram publicadas.',
    'tem-dono': 'O app já tem dono. Peça a ele para liberar o seu acesso.',
    'senha-atual': 'A senha atual não confere.'
  };
  // erro sem tradução: mostra o código, para o print já dizer o motivo
  return mapa[err?.code] || `Não foi possível concluir. Tente de novo.${err?.code ? ` (código: ${err.code})` : ''}`;
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

/**
 * Avisa a cada mudança: { estado, perfil, sugestao }.
 * estado: 'carregando' | 'sem-login' | 'sem-acesso' | 'pendente' | 'negado' | 'trocar-senha' | 'ok'
 */
export function observarAcesso(cb) {
  if (modoDemo) return observarDemo(cb);
  let pararDoc = null;
  const pararAuth = onAuthStateChanged(auth, (user) => {
    pararDoc?.();
    pararDoc = null;
    if (!user) return cb({ estado: 'sem-login' });
    cb({ estado: 'carregando' });
    const matricula = (user.email || '').split('@')[0];
    // dono do app: undefined enquanto não leu, null se ainda não há dono
    let dono;
    let donoLido = false;
    const lerDono = () => getDoc(doc(db, 'prim_config', 'dono'))
      .then((d) => { dono = d.exists() ? d.data().uid : null; }, () => { dono = undefined; })
      .finally(() => { donoLido = true; });
    let marcouAcesso = false;
    let ultimo = null;
    const emitir = (snap) => {
      if (!snap.exists()) return cb({ estado: 'sem-acesso', sugestao: { nome: user.displayName || '', matricula } });
      const d = snap.data();
      const perfil = { uid: user.uid, nome: d.nome, matricula: d.matricula, papel: d.papel, dono: dono === user.uid };
      if (d.status === 'negado') return cb({ estado: 'negado', perfil });
      if (d.status !== 'aprovado') return cb({ estado: 'pendente', perfil, semDono: dono === null, donoDesconhecido: dono === undefined });
      if (d.trocarSenha) return cb({ estado: 'trocar-senha', perfil });
      // último acesso, no máximo uma vez a cada meia hora
      const visto = d.ultimoAcessoEm?.toMillis?.() || 0;
      if (!marcouAcesso && Date.now() - visto > 30 * 60 * 1000) {
        marcouAcesso = true;
        updateDoc(snap.ref, { ultimoAcessoEm: serverTimestamp() }).catch(() => {});
      }
      cb({ estado: 'ok', perfil });
    };
    lerDono().then(() => ultimo && emitir(ultimo));
    pararDoc = onSnapshot(doc(db, COL, user.uid), (snap) => {
      ultimo = snap;
      if (!donoLido) return; // emite quando terminar de ler o dono
      // pendente: confere o dono de novo (alguém pode ter virado dono)
      if (snap.exists() && snap.data().status === 'pendente') lerDono().then(() => emitir(snap));
      else emitir(snap);
    }, () => cb({ estado: 'sem-acesso', sugestao: { nome: user.displayName || '', matricula } }));
  });
  return () => {
    pararAuth();
    pararDoc?.();
  };
}

export function entrar(matricula, senha) {
  if (!matriculaValida(matricula)) return Promise.reject(Object.assign(new Error('matricula'), { code: 'auth/invalid-email' }));
  if (modoDemo) return Promise.resolve();
  return comPrazo(signInWithEmailAndPassword(auth, emailDa(matricula), senha));
}

/** Se o app já tem dono. Sem conseguir ler no banco, pergunta ao servidor; sem resposta, null. */
async function haDono() {
  for (let i = 0; i < 3; i++) {
    try {
      return (await getDoc(doc(db, 'prim_config', 'dono'))).exists();
    } catch {
      await new Promise((ok) => setTimeout(ok, 700));
    }
  }
  const s = await statusServidor();
  return typeof s.temDono === 'boolean' ? s.temDono : null;
}

/** Vira o dono: cadastro de administrador e prim_config/dono na mesma gravação. */
function virarDono(uid, dados, { manter = false } = {}) {
  const lote = writeBatch(db);
  lote.set(doc(db, COL, uid), manter ? { papel: 'admin', status: 'aprovado' } : { ...dados, papel: 'admin', status: 'aprovado' }, { merge: manter });
  lote.set(doc(db, 'prim_config', 'dono'), { uid, nome: dados.nome, matricula: dados.matricula, em: serverTimestamp() });
  return lote.commit();
}

/**
 * Cadastro no Primárias de quem já está logado. Se o app ainda não tem dono,
 * esta conta vira o dono (administrador); senão nasce líder pendente.
 */
async function registrar({ nome, matricula }) {
  const uid = auth.currentUser.uid;
  const dados = { nome: nome.trim(), matricula: String(matricula).trim(), criadoEm: serverTimestamp() };
  if ((await haDono()) === false) {
    try {
      await assumirComoDono(dados, { novo: true });
      return;
    } catch {
      /* alguém virou dono antes: segue como cadastro comum */
    }
  }
  await setDoc(doc(db, COL, uid), { ...dados, papel: 'lider', status: 'pendente' });
}

/**
 * A primeira conta assume como dono. Pelo servidor primeiro: ele grava direto
 * no banco, sem depender das regras publicadas nem da rede do navegador.
 * Sem o servidor configurado, grava pelo navegador.
 */
export async function assumirComoDono(perfil, { novo = false } = {}) {
  if (modoDemo) return {};
  try {
    return await chamarServidor('assumir-dono');
  } catch (err) {
    if (!['nao-configurado', 'rede', 'falhou'].includes(err?.code)) throw err;
  }
  // conta nova grava o cadastro inteiro; quem já está pendente só muda papel e situação
  await virarDono(auth.currentUser.uid, novo ? perfil : { nome: perfil.nome, matricula: perfil.matricula }, { manter: !novo });
  return {};
}

/** Conta nova: nasce como líder pendente (ou dono, se for a primeira do app). */
export async function cadastrar({ nome, matricula, senha }) {
  if (!matriculaValida(matricula)) throw Object.assign(new Error('matricula'), { code: 'auth/invalid-email' });
  const cred = await comPrazo(createUserWithEmailAndPassword(auth, emailDa(matricula), senha));
  await updateProfile(cred.user, { displayName: nome.trim() });
  await registrar({ nome, matricula });
}

/** Quem tem conta mas ainda não tem cadastro no app pede acesso. */
export function solicitarAcesso({ nome, matricula }) {
  return registrar({ nome, matricula });
}

export function sair() {
  if (modoDemo) return sairDemo();
  return signOut(auth);
}

export async function alterarMinhaSenha(atual, nova) {
  const user = auth.currentUser;
  try {
    await comPrazo(reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, atual)));
  } catch (err) {
    if (['auth/wrong-password', 'auth/invalid-credential'].includes(err?.code)) throw Object.assign(new Error('senha-atual'), { code: 'senha-atual' });
    throw err;
  }
  await comPrazo(updatePassword(user, nova));
}

/** Depois de uma senha provisória, a pessoa cria a dela. */
export async function criarSenhaPropria(nova) {
  await comPrazo(updatePassword(auth.currentUser, nova));
  await updateDoc(doc(db, COL, auth.currentUser.uid), { trocarSenha: false });
}

// ---------------------------------------------------------------------------
// Usuários (tela do administrador)
// ---------------------------------------------------------------------------
export function assinarUsuarios(cb) {
  if (modoDemo) return assinarUsuariosDemo(cb);
  let dono = null;
  let lista = [];
  const avisar = () => cb(lista.map((u) => ({ ...u, dono: u.uid === dono })));
  getDoc(doc(db, 'prim_config', 'dono')).then((d) => {
    dono = d.exists() ? d.data().uid : null;
    avisar();
  }, () => {});
  return onSnapshot(collection(db, COL), (snap) => {
    lista = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    avisar();
  }, () => cb([]));
}

/** Pedidos de "esqueci a senha" que chegaram pela tela de entrada. */
export function assinarPedidosSenha(cb) {
  if (modoDemo) return assinarPedidosDemo(cb);
  return onSnapshot(collection(db, 'prim_pedidos_senha'), (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), () => cb([]));
}
export function descartarPedidoSenha(uid) {
  if (modoDemo) return mudarPedidosDemo((l) => l.filter((p) => p.uid !== uid));
  return deleteDoc(doc(db, 'prim_pedidos_senha', uid));
}

/** Papel, status e nome. Bloquear também desliga o login (se o servidor estiver ligado). */
export async function atualizarUsuario(uid, mudancas) {
  if (modoDemo) return atualizarUsuarioDemo(uid, mudancas);
  await updateDoc(doc(db, COL, uid), { ...mudancas, alteradoEm: serverTimestamp(), alteradoPor: auth.currentUser.uid });
  if (mudancas.status === 'negado' || mudancas.status === 'aprovado') chamarServidor('acesso', { uid, ativo: mudancas.status === 'aprovado' }).catch(() => {});
}

/** Exclui a pessoa: com o servidor ligado, a conta de login vai junto. */
export async function excluirUsuario(uid) {
  if (modoDemo) {
    await atualizarUsuarioDemo(uid, null);
    return { completo: true };
  }
  if ((await statusServidor()).configurado) {
    await chamarServidor('excluir', { uid });
    return { completo: true };
  }
  await deleteDoc(doc(db, COL, uid));
  return { completo: false };
}

/** Senha provisória (a pessoa cria a dela no próximo acesso). */
export async function redefinirSenha(uid) {
  if (modoDemo) {
    await mudarPedidosDemo((l) => l.filter((p) => p.uid !== uid));
    return 'demo2026';
  }
  return (await chamarServidor('senha', { uid })).senha || '';
}

let servidor = null;
/** Se a função /api/usuarios tem a chave do Firebase. */
export function statusServidor() {
  if (modoDemo) return Promise.resolve({ configurado: true });
  servidor ||= fetch('/api/usuarios', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { configurado: false }))
    .catch(() => {
      servidor = null;
      return { configurado: false, semRede: true };
    });
  return servidor;
}

async function chamarServidor(acao, dados) {
  const token = await auth.currentUser.getIdToken();
  let r;
  try {
    r = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao, ...dados }) });
  } catch {
    throw Object.assign(new Error('rede'), { code: 'rede' });
  }
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(corpo.erro || 'falhou'), { code: corpo.erro || (r.status === 404 ? 'nao-configurado' : 'falhou') });
  return corpo;
}

/** "Esqueci a senha", na tela de entrada (sem login): vira um pedido para o administrador. */
export async function pedirNovaSenha(matricula) {
  if (!matriculaValida(matricula)) throw Object.assign(new Error('matricula'), { code: 'auth/invalid-email' });
  if (modoDemo) {
    const u = usuariosDemo().find((x) => x.matricula === String(matricula).trim());
    if (u) await mudarPedidosDemo((l) => [...l.filter((p) => p.uid !== u.uid), { uid: u.uid, nome: u.nome, matricula: u.matricula, em: Date.now() }]);
    return;
  }
  let r;
  try {
    r = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'pedido-senha', matricula: String(matricula).trim() }) });
  } catch {
    throw Object.assign(new Error('rede'), { code: 'auth/network-request-failed' });
  }
  if (r.status === 503 || r.status === 404) throw Object.assign(new Error('nao-configurado'), { code: 'nao-configurado' });
  if (!r.ok) throw Object.assign(new Error('falhou'), { code: 'falhou' });
}

// ---------------------------------------------------------------------------
// Modo demonstração (sem Firebase): perfis prontos, guardados no navegador
// ---------------------------------------------------------------------------
export const PERFIS_DEMO = [
  { uid: 'demo-lider-1', nome: 'Líder 1', matricula: '100001', papel: 'lider' },
  { uid: 'demo-lider-2', nome: 'Líder 2', matricula: '100002', papel: 'lider' },
  { uid: 'demo-planejador', nome: 'Planejador', matricula: '100003', papel: 'planejador' },
  { uid: 'demo-admin', nome: 'Administrador', matricula: '100004', papel: 'admin' },
  { uid: 'demo-gestor', nome: 'Gestor', matricula: '100005', papel: 'gestor' }
];
const CHAVE_DEMO = 'prim.perfil';
const CHAVE_USUARIOS = 'prim.demo.usuarios';
const ouvintesDemo = new Set();
let perfilDemo = null;
function lerDemo() {
  try {
    const uid = sessionStorage.getItem(CHAVE_DEMO) || localStorage.getItem(CHAVE_DEMO);
    return PERFIS_DEMO.find((p) => p.uid === uid) || null;
  } catch {
    return null;
  }
}
function observarDemo(cb) {
  perfilDemo = lerDemo();
  const avisar = () => cb(perfilDemo ? { estado: 'ok', perfil: { ...perfilDemo, dono: perfilDemo.uid === 'demo-admin' } } : { estado: 'sem-login', demo: true });
  ouvintesDemo.add(avisar);
  avisar();
  return () => ouvintesDemo.delete(avisar);
}
export function entrarDemo(uid) {
  try {
    sessionStorage.setItem(CHAVE_DEMO, uid);
    localStorage.setItem(CHAVE_DEMO, uid);
  } catch {
    /* sem armazenamento: vale só nesta página */
  }
  perfilDemo = PERFIS_DEMO.find((p) => p.uid === uid) || null;
  ouvintesDemo.forEach((f) => f());
}
function sairDemo() {
  try {
    sessionStorage.removeItem(CHAVE_DEMO);
    localStorage.removeItem(CHAVE_DEMO);
  } catch {
    /* nada a limpar */
  }
  perfilDemo = null;
  ouvintesDemo.forEach((f) => f());
}
function usuariosDemo() {
  let extras = {};
  try {
    extras = JSON.parse(localStorage.getItem(CHAVE_USUARIOS) || '{}');
  } catch {
    extras = {};
  }
  const agora = Date.now();
  const base = [
    ...PERFIS_DEMO.map((p, i) => ({ ...p, status: 'aprovado', dono: p.uid === 'demo-admin', ultimoAcessoEm: agora - i * 5.5 * 3600 * 1000 })),
    { uid: 'demo-novo', nome: 'Líder Novo', matricula: '100006', papel: 'lider', status: 'pendente' },
    { uid: 'demo-bloq', nome: 'Líder Antigo', matricula: '100007', papel: 'lider', status: 'negado', ultimoAcessoEm: agora - 20 * 86400 * 1000 }
  ];
  return base.map((u) => (extras[u.uid] === null ? null : { ...u, ...(extras[u.uid] || {}) })).filter(Boolean);
}
const ouvintesUsuarios = new Set();
function assinarUsuariosDemo(cb) {
  ouvintesUsuarios.add(cb);
  cb(usuariosDemo());
  return () => ouvintesUsuarios.delete(cb);
}
function atualizarUsuarioDemo(uid, mudancas) {
  let extras = {};
  try {
    extras = JSON.parse(localStorage.getItem(CHAVE_USUARIOS) || '{}');
  } catch {
    extras = {};
  }
  extras[uid] = mudancas === null ? null : { ...(extras[uid] || {}), ...mudancas };
  try {
    localStorage.setItem(CHAVE_USUARIOS, JSON.stringify(extras));
  } catch {
    /* sem armazenamento */
  }
  const lista = usuariosDemo();
  ouvintesUsuarios.forEach((f) => f(lista));
  return Promise.resolve();
}

const CHAVE_PEDIDOS = 'prim.demo.pedidos-senha';
const ouvintesPedidos = new Set();
function pedidosDemo() {
  try {
    const salvo = localStorage.getItem(CHAVE_PEDIDOS);
    if (salvo) return JSON.parse(salvo);
  } catch {
    /* sem armazenamento */
  }
  return [{ uid: 'demo-lider-2', nome: 'Líder 2', matricula: '100002', em: Date.now() - 40 * 60 * 1000 }];
}
function assinarPedidosDemo(cb) {
  ouvintesPedidos.add(cb);
  cb(pedidosDemo());
  return () => ouvintesPedidos.delete(cb);
}
function mudarPedidosDemo(fn) {
  const lista = fn(pedidosDemo());
  try {
    localStorage.setItem(CHAVE_PEDIDOS, JSON.stringify(lista));
  } catch {
    /* sem armazenamento */
  }
  ouvintesPedidos.forEach((f) => f(lista));
  return Promise.resolve();
}

export const autorDe = (p) => ({ uid: p.uid, nome: p.nome, papel: p.papel });
