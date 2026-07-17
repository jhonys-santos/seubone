const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');

const env = require('./src/config/env');
const usuariosService = require('./src/services/usuarios.service');
const catalogoPaineis = require('./src/config/paineis');
const catalogoAtalhos = require('./src/config/atalhos');

// A pasta de sessões não é versionada (fica no .gitignore) — em um deploy
// novo (ex: Render) ela simplesmente não existe ainda. Sem isso, a store
// falha silenciosamente ao gravar e o cookie de sessão nunca é enviado,
// deixando o login preso num loop de redirecionamento.
const SESSIONS_DIR = path.join(env.dataDir, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
const authRoutes = require('./src/routes/auth.routes');
const setupRoutes = require('./src/routes/setup.routes');
const hubRoutes = require('./src/routes/hub.routes');
const perfilRoutes = require('./src/routes/perfil.routes');
const painelSacRoutes = require('./src/routes/painelSac.routes');
const wallacRoutes = require('./src/routes/wallac.routes');
const pedidosUrgentesRoutes = require('./src/routes/pedidosUrgentes.routes');
const rankingSacRoutes = require('./src/routes/rankingSac.routes');
const registroDemandasRoutes = require('./src/routes/registroDemandas.routes');
const indicadoresEquipeRoutes = require('./src/routes/indicadoresEquipe.routes');

const app = express();

// Render (e a maioria dos PaaS) termina o HTTPS num proxy antes de chegar
// no Node — sem isso, o Express acha que a conexão é HTTP simples e nunca
// envia o cookie de sessão (que exige secure:true em produção).
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(
  helmet({
    // O ranking-sac usa animações inline; content security policy fica para
    // uma fase de hardening dedicada em vez de travar o app inteiro agora.
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    // Sessão gravada em disco (data/sessions) em vez de só na memória — assim
    // reiniciar o servidor (deploy, crash, atualização) não desloga o time.
    store: new FileStore({
      path: SESSIONS_DIR,
      logFn: () => {}, // silencia os logs internos da lib no console
    }),
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
  })
);

// Deixa a sidebar (renderizada em toda página autenticada) disponível sem
// que cada rota precise montar essa lista na mão — mesmo filtro de
// permissões que a home já usava (podeAcessarPainel), só que agora
// centralizado aqui em vez de só em hub.routes.js.
app.use((req, res, next) => {
  const usuario = req.session.user || null;
  res.locals.usuario = usuario;
  res.locals.rotaAtual = req.path;
  if (usuario) {
    res.locals.paineisVisiveis = catalogoPaineis.filter((p) => usuariosService.podeAcessarPainel(usuario, p.chave) && (!p.somenteRole || usuario.role === p.somenteRole));
    res.locals.atalhosVisiveis = catalogoAtalhos.filter((a) => !a.requerPainel || usuariosService.podeAcessarPainel(usuario, a.requerPainel));
  } else {
    res.locals.paineisVisiveis = [];
    res.locals.atalhosVisiveis = [];
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(authRoutes);
app.use(setupRoutes);
app.use(hubRoutes);
app.use(perfilRoutes);
app.use('/painel-sac', painelSacRoutes);
app.use('/wallac', wallacRoutes);
app.use('/pedidos-urgentes', pedidosUrgentesRoutes);
app.use('/ranking-sac', rankingSacRoutes);
app.use('/registro-demandas', registroDemandasRoutes);
app.use('/indicadores-equipe', indicadoresEquipeRoutes);

app.use((req, res) => {
  res.status(404).render('erro', {
    titulo: 'Página não encontrada',
    mensagem: 'O endereço acessado não existe.',
  });
});

usuariosService
  .inicializar()
  .then(() => {
    app.listen(env.port, () => {
      console.log(`SeuBoné Hub rodando em http://localhost:${env.port}`);
    });
  })
  .catch((err) => {
    // Sem a lista de usuários carregada, ninguém consegue logar — melhor
    // falhar alto e cedo (logs do Render deixam claro o motivo) do que
    // subir o servidor com todo login quebrado silenciosamente.
    console.error('Falha ao carregar usuários do hub na inicialização:', err.message);
    process.exit(1);
  });
