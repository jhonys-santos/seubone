const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');

const env = require('./src/config/env');

// A pasta de sessões não é versionada (fica no .gitignore) — em um deploy
// novo (ex: Render) ela simplesmente não existe ainda. Sem isso, a store
// falha silenciosamente ao gravar e o cookie de sessão nunca é enviado,
// deixando o login preso num loop de redirecionamento.
const SESSIONS_DIR = path.join(env.dataDir, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
const authRoutes = require('./src/routes/auth.routes');
const setupRoutes = require('./src/routes/setup.routes');
const hubRoutes = require('./src/routes/hub.routes');
const painelSacRoutes = require('./src/routes/painelSac.routes');
const wallacRoutes = require('./src/routes/wallac.routes');
const pedidosUrgentesRoutes = require('./src/routes/pedidosUrgentes.routes');
const rankingSacRoutes = require('./src/routes/rankingSac.routes');

const app = express();

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

app.use((req, res, next) => {
  res.locals.usuario = req.session.user || null;
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(authRoutes);
app.use(setupRoutes);
app.use(hubRoutes);
app.use('/painel-sac', painelSacRoutes);
app.use('/wallac', wallacRoutes);
app.use('/pedidos-urgentes', pedidosUrgentesRoutes);
app.use('/ranking-sac', rankingSacRoutes);

app.use((req, res) => {
  res.status(404).render('erro', {
    titulo: 'Página não encontrada',
    mensagem: 'O endereço acessado não existe.',
  });
});

app.listen(env.port, () => {
  console.log(`SeuBoné Hub rodando em http://localhost:${env.port}`);
});
