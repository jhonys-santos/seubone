# SeuBoné Hub

Painel único com login, para colaboradores verem seus próprios indicadores e
gestores verem de todos. Reúne 4 painéis que antes eram HTMLs soltos:

- **Meus Indicadores** (`/painel-sac`) — indicadores pessoais, escala, trocas de sábado, sugestões
- **Produção SBP — Wallac** (`/wallac`) — kanban de pedidos em produção; inclui `/wallac/estoque` (gestão de estoque, só o login do Wallac) e `/wallac/solicitar` (pedido de personalização, página **pública** — pode ser compartilhada com quem não tem login no hub)
- **Pedidos Urgentes** (`/pedidos-urgentes/*`) — cadastro, painel do estoque e histórico
- **Ranking SAC** (`/ranking-sac`) — painel de TV com o "ranking de corrida" entre consultores

Todos os dados continuam vindo do Google Sheets/Apps Script — o que muda é
que agora só o **servidor** conhece as URLs/credenciais desses backends; o
navegador só fala com o próprio hub, autenticado por sessão.

## 1. Instalar o Node.js (só na primeira vez)

Baixe e instale a versão **LTS** em https://nodejs.org — aceite as opções
padrão do instalador. Depois, feche e abra o terminal de novo e confirme:

```
node --version
npm --version
```

## 2. Configurar o projeto

```
npm install
copy .env.example .env
```

Abra o `.env` e preencha:

- `SESSION_SECRET` — qualquer string longa e aleatória
- `WALLAC_APPS_SCRIPT_URL`, `PEDIDOS_URGENTES_APPS_SCRIPT_URL`, `PAINEL_SAC_APPS_SCRIPT_URL` — as URLs dos Web Apps do Apps Script de cada planilha (Extensões → Apps Script → Implantar → Gerenciar implantações)
- `RANKING_SAC_CSV_ATD`, `_RSL`, `_KPI`, `_AGENDA` — as URLs de "Publicar na Web" (formato CSV) de cada aba usada no Ranking SAC
- `APPS_SCRIPT_SHARED_SECRET` — **obrigatório**: os usuários do hub (login/senha/permissões) ficam guardados numa aba da planilha do Painel SAC, e só esse segredo autoriza o hub a ler/escrever ali. Gere uma string aleatória e use o mesmo valor no `.env` e no Apps Script (próximo passo).

## 3. Atualizar o Apps Script do Painel SAC (uma vez)

Os usuários do hub (quem loga, senha, papel, painéis liberados) ficam numa
aba própria ("HubUsuarios") da mesma planilha do Painel SAC — assim
sobrevivem a qualquer deploy, sem precisar de banco de dados pago. Pra isso
funcionar, o `Code.gs` **de verdade** (dentro de Extensões → Apps Script,
na planilha do Painel SAC) precisa ter as funções novas que estão em
`apps-script/painel-sac/Code.gs` deste repositório:

1. Abra a planilha do Painel SAC → Extensões → Apps Script.
2. Compare o `Code.gs` de lá com `apps-script/painel-sac/Code.gs` deste projeto e copie o que estiver faltando: os blocos `hubListarUsuarios`/`hubSalvarUsuario` (funções) e os dois trechos que os chamam dentro de `doGet` e `doPost` (procure por `hubListarUsuarios`/`hubSalvarUsuario` no arquivo de referência).
3. Salve e implante uma nova versão (Implantar → Gerenciar implantações → ✏️ → Nova versão → Implantar). **Não precisa criar a aba "HubUsuarios" manualmente** — o script cria sozinho na primeira chamada.
4. Confirme que `SEGREDO_HUB` no Apps Script é idêntico ao `APPS_SCRIPT_SHARED_SECRET` do `.env`.

Sem esse passo, o hub não sobe (ele carrega a lista de usuários da planilha
já na inicialização, e falha alto se não conseguir).

## 4. Criar os primeiros usuários

```
npm run criar-usuario
```

O script pergunta usuário, senha, nome, slug (o identificador que já é usado
como `usuario=` nas chamadas ao Apps Script), papel (`colaborador` ou
`gestor`) e quais painéis a pessoa acessa. Rode de novo para cada pessoa.
Crie pelo menos um usuário com papel `gestor` para testar a troca de visão.

## 5. Rodar localmente

```
npm start
```

Acesse `http://localhost:3000` e faça login.

## 6. Pendências conhecidas

- **`manifesto.mp3`** do Ranking SAC — o arquivo original nunca foi
  encontrado nas pastas do projeto. O painel referencia `/public/audio/manifesto.mp3`;
  coloque o arquivo ali se quiser o som do alerta de manifesto.
- O **cofre de senhas** ("Acessos", dentro de Meus Indicadores) foi mantido
  por decisão do time — é de uso interno, cada pessoa só vê/edita os próprios
  acessos. As senhas ficam em texto puro na aba "Acessos" da planilha, como
  já era antes; se algum dia isso incomodar, dá para criptografar no
  Apps Script sem mudar a interface.

## 7. Proteger o Apps Script (opcional, recomendado)

Hoje qualquer um com a URL do Apps Script consegue ler/escrever nas
planilhas, mesmo sem passar pelo hub. Para fechar isso: no `Code.gs` de cada
planilha, valide um parâmetro `segredo` recebido em toda chamada e compare
com uma constante — o hub já envia esse parâmetro automaticamente em toda
chamada se `APPS_SCRIPT_SHARED_SECRET` estiver definido no `.env`. Na
planilha do Painel SAC isso já é obrigatório (passo 3).

## 8. Publicar de graça para o time acessar (Render + keep-alive)

O plano **gratuito** da Render "dorme" depois de ~15 min sem acesso (o
primeiro acesso depois disso demora uns 30-50s pra responder) e não tem
Shell/terminal nem disco persistente. Isso não afeta mais os usuários do
hub (ficam na planilha, sobrevivem a qualquer deploy) — só a sessão de quem
já estava logado é que se perde num deploy novo (a pessoa só precisa logar
de novo, não recriar o cadastro).

1. Crie um repositório no GitHub com este projeto (sem `.env`, `data/usuarios.json` nem `data/sessions/` — já estão no `.gitignore`) e dê `git push`.
2. Crie uma conta em https://render.com e clique em "New +" → "Web Service", apontando para esse repositório.
3. Build Command: `npm install` — Start Command: `node server.js` — Plano: **Free**.
4. Na aba "Environment", cadastre as mesmas variáveis do seu `.env` (incluindo `SETUP_TOKEN`; não precisa de `DATA_DIR` — sem disco persistente, o padrão já serve).
5. **Evite que o serviço durma**: crie uma conta grátis em https://cron-job.org (ou similar), e configure um "cron job" para acessar `https://SEU-APP.onrender.com` a cada 10 minutos. Isso mantém o hub sempre acordado, de graça.
6. Pra criar/atualizar um usuário sem terminal, acesse `https://SEU-APP.onrender.com/setup` — pede o código de acesso (`SETUP_TOKEN`) e os dados da pessoa. Diferente de antes, isso só precisa ser feito quando a pessoa muda (não mais depois de cada deploy).
