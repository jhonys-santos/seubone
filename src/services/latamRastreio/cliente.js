// Cliente de rastreio da LATAM Cargo (eSales, SOAP). Recorte do latam-cargo-crm: só o Tracking
// (a emissão de e-Minuta continua em latamMinuta.service.js).
const { LatamErro } = require('./erros');
const { CODIGOS_LATAM } = require('./codigos');
const { normalizarRastreio, separarAwb } = require('./normalizar');
const { buscar, el, envelope, filhos, lerXml, texto } = require('./xml');

const BASES = {
  prod: 'https://prd.services.esales.com.br/broker/latam/api/v1',
  hmg: 'https://stg.services.esales.com.br/broker/latam/api/v1',
  uat: 'https://uat.services.esales.com.br/broker/latam/api/v1',
};
const NS_LAN = 'http://webservices.lan.com/XML';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const digitos = (s) => (s ?? '').replace(/\D/g, '');
const pareceTimeout = (s) => /time ?out|timed out|tempo esgotado|indispon|unavailable/i.test(s);
const pareceNaoEncontrado = (s) => /n[aã]o (foi )?encontrad|nenhum|not found|no se encontr|no existe|n[aã]o é uma ordem/i.test(s);

class LatamRastreio {
  constructor(opcoes) {
    if (!opcoes.usuario || !opcoes.senha) throw new LatamErro('CREDENCIAL', 'Informe usuário e senha fornecidos pela eSales/LATAM');
    this.base = BASES[opcoes.ambiente ?? 'prod'];
    this.auth = 'Basic ' + Buffer.from(`${opcoes.usuario}:${opcoes.senha}`).toString('base64');
    this.opcoes = { tabelaCodigos: opcoes.tabelaCodigos ?? CODIGOS_LATAM, timeoutMs: opcoes.timeoutMs ?? 40000, tentativas: opcoes.tentativas ?? 3 };
    this.fetchImpl = opcoes.fetch || fetch;
  }

  /** Pelo AWB: "957-01234567", "95701234567" ou só "01234567". Devolve null quando a LATAM não tem registro. */
  async rastrearPorAwb(awb) {
    const { prefixo, numero } = separarAwb(awb);
    if (!numero) throw new LatamErro('DADOS_INVALIDOS', 'AWB vazio');
    return this.rastrear(el('CargoDocumentId', [el('prefix', prefixo), el('number', numero)]));
  }

  /** Pela chave de acesso da NF-e (44 dígitos). */
  async rastrearPorChaveNfe(chaveNfe) {
    const chave = digitos(chaveNfe);
    if (chave.length !== 44) throw new LatamErro('DADOS_INVALIDOS', `Chave NF-e deve ter 44 dígitos (recebido: ${chave.length})`);
    return this.rastrear(el('fiscalDocumentAccesKey', chave)); // "Acces" com um "s" só: é assim no schema
  }

  async rastrear(filtro) {
    const xml = envelope({ ns: NS_LAN }, el('ns:DisplayCargoDocumentTrackingDetailsBrRQ', [filtro]));
    const raiz = await this.chamar('tracking', xml, { 'Content-Type': 'application/xml;charset=UTF-8' });
    const rs = buscar(raiz, 'DisplayCargoDocumentTrackingDetailsBrRS') ?? raiz;
    const detalhes = filhos(rs, 'CargoDocumentTrackingDetail');
    if (!detalhes.length) {
      const st = this.status(rs);
      const msg = `${st.message ?? ''} ${st.nativeMessage ?? ''}`;
      // -58 (manual) e -99 SHP_TRACK_FLD_SHP = sem registro
      if (!st.code || st.code === '0' || st.code === '-58' || /SHP_TRACK_FLD_SHP/.test(msg) || pareceNaoEncontrado(msg)) return null;
      throw this.erroDeStatus(st);
    }
    const [principal, ...demais] = detalhes.map((d) => normalizarRastreio(d, this.opcoes.tabelaCodigos));
    if (demais.length) principal.demaisAwbs = demais;
    return principal;
  }

  status(no) {
    const s = buscar(no, 'ServiceStatus');
    return { code: texto(s, 'code'), message: texto(s, 'message'), nativeMessage: texto(s, 'nativeMessage') };
  }

  erroDeStatus(st) {
    const msg = st.message ?? `ServiceStatus ${st.code}`;
    const tipo = !pareceTimeout(`${msg} ${st.nativeMessage ?? ''}`) && Number(st.code) < 0 ? 'DADOS_INVALIDOS' : 'INDISPONIVEL';
    return new LatamErro(tipo, `LATAM ${st.code}: ${msg.slice(0, 300)}`, { codigoLatam: st.code });
  }

  /** POST SOAP com timeout e novas tentativas (1 s, 2 s, 4 s…) em falha de rede ou 5xx sem SOAP Fault. */
  async chamar(servico, xml, headers, tentativas = this.opcoes.tentativas) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      let status, corpo;
      try {
        const res = await this.fetchImpl(`${this.base}/${servico}`, {
          method: 'POST',
          headers: { Authorization: this.auth, 'LAN-ApplicationName': '1', SOAPAction: '""', ...headers },
          body: xml,
          signal: AbortSignal.timeout(this.opcoes.timeoutMs),
        });
        status = res.status;
        corpo = await res.text();
      } catch (e) {
        ultimoErro = new LatamErro('INDISPONIVEL', `Falha de comunicação com a LATAM (${servico}): ${e?.message ?? e}`);
        if (tentativa < tentativas) await esperar(1000 * 2 ** (tentativa - 1));
        continue;
      }
      // O broker da eSales responde JSON aqui: 401 "Usuário e senha inválidos" e 404 "Usuário com userName: x não encontrado"
      if (status === 401 || (status === 404 && /usu[aá]rio/i.test(corpo))) {
        throw new LatamErro('CREDENCIAL', `Usuário/senha recusados pela eSales/LATAM (${servico}): ${corpo.slice(0, 200)}`, { status });
      }
      if (status === 403) throw new LatamErro('SEM_PERMISSAO', `Usuário sem acesso ao serviço ${servico}`, { status });
      const raiz = lerXml(corpo);
      const fault = buscar(raiz, 'Fault');
      if (fault) {
        const msg = texto(fault, 'faultstring') ?? texto(fault, 'Reason', 'Text') ?? 'SOAP Fault sem descrição';
        throw new LatamErro(pareceTimeout(msg) ? 'INDISPONIVEL' : 'DADOS_INVALIDOS', `LATAM (${servico}): ${msg}`, { status });
      }
      if (status >= 500 || !buscar(raiz, 'Body')) {
        ultimoErro = new LatamErro('INDISPONIVEL', `LATAM (${servico}) respondeu HTTP ${status}: ${corpo.slice(0, 200)}`, { status });
        if (status >= 500 && tentativa < tentativas) {
          await esperar(1000 * 2 ** (tentativa - 1));
          continue;
        }
        if (status >= 400 && status < 500) throw new LatamErro('DADOS_INVALIDOS', `LATAM (${servico}) respondeu HTTP ${status}: ${corpo.slice(0, 200)}`, { status });
        throw ultimoErro;
      }
      return raiz;
    }
    throw ultimoErro;
  }
}

module.exports = { LatamRastreio };
