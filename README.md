# SeuBoné Hub

Painel único com login, para colaboradores verem seus próprios indicadores e
gestores verem de todos. Reúne 4 painéis que antes eram HTMLs soltos:

- **Meus Indicadores** (`/painel-sac`) — indicadores pessoais, escala, trocas de sábado, sugestões
- **Produção — Wallac** (`/wallac`) — kanban de pedidos em produção
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
- `APPS_SCRIPT_SHARED_SECRET` — opcional por enquanto; se quiser fechar mais o Apps Script, veja a seção "Proteger o Apps Script" abaixo

## 3. Criar os primeiros usuários

```
npm run criar-usuario
```

O script pergunta usuário, senha, nome, slug (o identificador que já é usado
como `usuario=` nas chamadas ao Apps Script), papel (`colaborador` ou
`gestor`) e quais painéis a pessoa acessa. Rode de novo para cada pessoa.
Crie pelo menos um usuário com papel `gestor` para testar a troca de visão.

## 4. Rodar localmente

```
npm start
```

Acesse `http://localhost:3000` e faça login.

## 5. Pendências conhecidas

- **`manifesto.mp3`** do Ranking SAC — o arquivo original nunca foi
  encontrado nas pastas do projeto. O painel referencia `/public/audio/manifesto.mp3`;
  coloque o arquivo ali se quiser o som do alerta de manifesto.
- O **cofre de senhas** ("Acessos", dentro de Meus Indicadores) foi mantido
  por decisão do time — é de uso interno, cada pessoa só vê/edita os próprios
  acessos. As senhas ficam em texto puro na aba "Acessos" da planilha, como
  já era antes; se algum dia isso incomodar, dá para criptografar no
  Apps Script sem mudar a interface.

## 6. Proteger o Apps Script (opcional, recomendado)

Hoje qualquer um com a URL do Apps Script consegue ler/escrever nas
planilhas, mesmo sem passar pelo hub. Para fechar isso: no `Code.gs` de cada
planilha, valide um parâmetro `segredo` recebido em toda chamada e compare
com uma constante — o hub já envia esse parâmetro automaticamente em toda
chamada se `APPS_SCRIPT_SHARED_SECRET` estiver definido no `.env`.

## 7. Publicar de graça para o time acessar (Render + keep-alive)

O plano **gratuito** da Render tem duas limitações: "dorme" depois de ~15 min
sem acesso (o primeiro acesso depois disso demora uns 30-50s pra responder),
e não permite disco persistente — ou seja, `data/usuarios.json` e as sessões
salvas só sobrevivem enquanto o serviço não passa por um novo deploy. Como
os deploys são raros (só quando eu mudo o código), isso é tranquilo: depois
de um deploy, basta recriar os usuários uma vez (passo 6).

1. Crie um repositório no GitHub com este projeto (sem `.env`, `data/usuarios.json` nem `data/sessions/` — já estão no `.gitignore`) e dê `git push`.
2. Crie uma conta em https://render.com e clique em "New +" → "Web Service", apontando para esse repositório.
3. Build Command: `npm install` — Start Command: `node server.js` — Plano: **Free**.
4. Na aba "Environment", cadastre as mesmas variáveis do seu `.env` (não precisa de `DATA_DIR` — sem disco persistente, o padrão já serve).
5. **Evite que o serviço durma**: crie uma conta grátis em https://cron-job.org (ou similar), e configure um "cron job" para acessar `https://SEU-APP.onrender.com` a cada 10 minutos. Isso mantém o hub sempre acordado, de graça.
6. Depois de cada deploy (inclusive o primeiro), abra o "Shell" do serviço no Render e rode `npm run criar-usuario` ali dentro, uma vez por pessoa, pra recriar os usuários.
