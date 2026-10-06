// Portado de azul-rastreio-crm (ESM compilado) para CommonJS; lógica idêntica. Rastreio Azul Logística (Integração Fácil).
const { AzulErro } = require('./erros');
const { normalizarRastreio } = require('./normalizar');
const { CODIGOS_AZUL } = require('./codigos');
const URLS = {
    prod: 'https://ediapi.onlineapp.com.br/toolkit',
    hmg: 'https://hmg.onlineapp.com.br/EDIv2_API_INTEGRACAO_Toolkit',
};
// Token obtido por login: a documentação diz 8 h; renovamos antes para não expirar no meio de uma rodada.
// Token informado nas opções: não expira por tempo (em produção durou dias) — só troca se a Azul recusar.
const VALIDADE_TOKEN_MS = 7.5 * 60 * 60 * 1000;
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
class AzulRastreio {
    base;
    opcoes;
    email;
    senha;
    token;
    tokenEm = 0;
    /** true enquanto o token em uso for o informado nas opções (sem expiração por tempo) */
    tokenFixo;
    loginEmAndamento = null;
    constructor(opcoes) {
        const token = opcoes.token?.trim() || null;
        this.email = opcoes.email?.trim() || null;
        this.senha = opcoes.senha || null;
        if (!token && !(this.email && this.senha)) {
            throw new AzulErro('CREDENCIAL', 'Informe o token (AZUL_TOKEN) ou email e senha da conta Integração Fácil');
        }
        this.base = URLS[opcoes.ambiente ?? 'prod'];
        this.opcoes = {
            tabelaCodigos: opcoes.tabelaCodigos ?? CODIGOS_AZUL,
            timeoutMs: opcoes.timeoutMs ?? 30_000,
            tentativas: opcoes.tentativas ?? 3,
        };
        this.token = token;
        this.tokenFixo = Boolean(token);
        if (token)
            this.tokenEm = Date.now();
    }
    /**
     * Busca o rastreio pela chave de acesso da NF-e (44 dígitos).
     * Retorna `null` quando a Azul ainda não tem registro dessa NF (ou ela não pertence à conta).
     */
    async rastrearPorChaveNfe(chaveNfe) {
        const chave = String(chaveNfe).replace(/\D/g, '');
        if (chave.length !== 44)
            throw new AzulErro('DADOS_INVALIDOS', `Chave NF-e deve ter 44 dígitos (recebido: ${chave.length})`);
        return this.consultar({ ChaveNfe: chave, Awb: '', Pedido: '' });
    }
    /** Busca pelo AWB, com ou sem o prefixo 577- (ex.: "577-22574215" ou "22574215"). */
    async rastrearPorAwb(awb) {
        const numero = String(awb).trim().replace(/^577-?/, '');
        if (!numero)
            throw new AzulErro('DADOS_INVALIDOS', 'AWB vazio');
        return this.consultar({ ChaveNfe: '', Awb: numero, Pedido: '' });
    }
    // ─── interno ──────────────────────────────────────────────────────────────
    async consultar(filtro) {
        let resp = await this.post('/api/Rastreio/Consultar', { Token: await this.obterToken(), ...filtro });
        if (resp.status === 401 && !this.ehFaltaDePermissao(resp.corpo)) {
            if (!this.podeFazerLogin()) {
                throw new AzulErro('CREDENCIAL', 'Token recusado pela Azul (' + (resp.corpo?.ErrorText ?? 'HTTP 401') + '). Gere um token novo no Integração Fácil e atualize AZUL_TOKEN.', 401);
            }
            // Token expirado/invalidado → faz login e tenta uma única vez
            this.token = null;
            this.tokenFixo = false;
            resp = await this.post('/api/Rastreio/Consultar', { Token: await this.obterToken(), ...filtro });
        }
        // NF/AWB que a Azul ainda não recebeu volta como erro "AWB não encontrada!" — para o CRM é "sem registro"
        if (resp.corpo?.HasErrors && /n[aã]o encontrad|not found/i.test(resp.corpo.ErrorText ?? ''))
            return null;
        if (resp.corpo?.HasErrors && this.ehEnvioDeOutraConta(resp.corpo)) {
            throw new AzulErro('SEM_PERMISSAO', 'O envio existe na Azul, mas pertence a outro CNPJ (ex.: filial) que este token não acessa: ' + resp.corpo.ErrorText, resp.status);
        }
        const lista = this.validar(resp);
        if (!lista || lista.length === 0)
            return null; // 201/203/vazio = sem registro na Azul ainda
        const [principal, ...demais] = lista.map(b => normalizarRastreio(b, this.opcoes.tabelaCodigos));
        if (demais.length)
            principal.demaisAwbs = demais;
        return principal;
    }
    podeFazerLogin() {
        return Boolean(this.email && this.senha);
    }
    async obterToken() {
        if (this.token && (this.tokenFixo || Date.now() - this.tokenEm < VALIDADE_TOKEN_MS))
            return this.token;
        if (!this.podeFazerLogin())
            throw new AzulErro('CREDENCIAL', 'Sem token válido e sem email/senha para login');
        // Evita vários logins simultâneos quando o CRM consulta em paralelo
        this.loginEmAndamento ??= this.login().finally(() => { this.loginEmAndamento = null; });
        return this.loginEmAndamento;
    }
    async login() {
        const resp = await this.post('/api/Autenticacao/AutenticarUsuario', {
            Email: this.email,
            Senha: this.senha,
        });
        if (resp.status === 401 || resp.corpo?.HasErrors || !resp.corpo?.Value) {
            throw new AzulErro('CREDENCIAL', `Login recusado pela Azul: ${resp.corpo?.ErrorText ?? `HTTP ${resp.status}`}`, resp.status);
        }
        this.token = resp.corpo.Value;
        this.tokenEm = Date.now();
        this.tokenFixo = false;
        return this.token;
    }
    ehFaltaDePermissao(corpo) {
        return /n[aã]o possui acesso a funcionalidade/i.test(corpo?.ErrorText ?? '');
    }
    /** Envio existe, mas pertence a outro CNPJ (ex.: filial) que o token não enxerga. */
    ehEnvioDeOutraConta(corpo) {
        return /n[aã]o tem permiss[aã]o para acessar/i.test(corpo?.ErrorText ?? '');
    }
    validar(resp) {
        const { status, corpo } = resp;
        if (status === 201 || status === 203 || status === 204)
            return null;
        if (status === 401) {
            if (this.ehFaltaDePermissao(corpo))
                throw new AzulErro('SEM_PERMISSAO', corpo.ErrorText, status);
            throw new AzulErro('CREDENCIAL', corpo?.ErrorText ?? 'Acesso negado', status);
        }
        if (status === 403)
            throw new AzulErro('SEM_PERMISSAO', corpo?.ErrorText ?? 'Sem permissão', status);
        if (status === 400 || status === 404)
            throw new AzulErro('DADOS_INVALIDOS', corpo?.ErrorText ?? `HTTP ${status}`, status);
        if (status !== 200 || !corpo)
            throw new AzulErro('INDISPONIVEL', corpo?.ErrorText ?? `HTTP ${status}`, status);
        if (corpo.HasErrors)
            throw new AzulErro('DADOS_INVALIDOS', corpo.ErrorText ?? 'Erro sem descrição', status);
        return corpo.Value;
    }
    /** POST JSON com timeout e novas tentativas (espera 1 s, 2 s, 4 s…) em falha de rede ou 5xx. */
    async post(caminho, corpo) {
        let ultimoErro;
        for (let tentativa = 1; tentativa <= this.opcoes.tentativas; tentativa++) {
            try {
                const res = await fetch(this.base + caminho, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpo),
                    signal: AbortSignal.timeout(this.opcoes.timeoutMs),
                });
                const texto = await res.text();
                let json = null;
                try {
                    json = texto ? JSON.parse(texto) : null;
                }
                catch { /* corpo não-JSON */ }
                if (res.status >= 500 && tentativa < this.opcoes.tentativas) {
                    ultimoErro = new AzulErro('INDISPONIVEL', json?.ErrorText ?? `HTTP ${res.status}`, res.status);
                }
                else {
                    return { status: res.status, corpo: json };
                }
            }
            catch (e) {
                ultimoErro = e;
            }
            await esperar(1000 * 2 ** (tentativa - 1));
        }
        if (ultimoErro instanceof AzulErro)
            throw ultimoErro;
        throw new AzulErro('INDISPONIVEL', `Falha de comunicação com a Azul: ${ultimoErro?.message ?? ultimoErro}`);
    }
}

module.exports = { AzulRastreio };
