// Validação e preparo dos valores do Gerador de Autorização — porta fiel das
// regras que existiam no Apps Script original (prepararValores_, buildFilename,
// dataHojePtBr, preencherTexto_), só que rodando no servidor do hub.

const TEMPLATES = require('../config/autorizacoesTemplates');

function acharTpl(templateId) {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error('Template não encontrado: ' + templateId);
  return tpl;
}

function dataHojePtBr() {
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza', day: 'numeric', month: 'numeric', year: 'numeric',
  }).formatToParts(new Date());
  const dia = partes.find((p) => p.type === 'day').value;
  const mes = parseInt(partes.find((p) => p.type === 'month').value, 10) - 1;
  const ano = partes.find((p) => p.type === 'year').value;
  return `${dia} de ${meses[mes]} de ${ano}`;
}

// Mesma regra do original: valida, normaliza (CPF/volumes/AWBs) e devolve um
// objeto plano { CAMPO: valor } pronto pra alimentar o PDF e os e-mails.
function prepararValores(tpl, values) {
  const dados = {};
  tpl.fields.forEach((f) => {
    if (f.auto === 'today') {
      dados[f.key] = dataHojePtBr();
      return;
    }
    if (f.type === 'checkbox') {
      dados[f.key] = values[f.key] === true || values[f.key] === 'true';
      return;
    }
    if (f.awbMulti) {
      const raw = (values[f.key] == null ? '' : String(values[f.key])).trim();
      if (f.required && !raw) throw new Error('Campo obrigatório vazio: ' + f.label);
      const partes = raw.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length);
      if (partes.length > f.awbMulti) throw new Error('Máximo de ' + f.awbMulti + ' AWBs por autorização.');
      const lista = [];
      for (let i = 0; i < f.awbMulti; i++) {
        const k = 'AWB' + (i + 1);
        if (i < partes.length) {
          const num = partes[i].replace(/^957[-\s]?/i, '').replace(/\s+/g, '');
          const full = '957-' + num;
          dados[k] = full;
          lista.push(full);
        } else {
          dados[k] = '';
        }
      }
      dados.AWB_LISTA = lista.join(', ');
      dados[f.key] = raw;
      return;
    }

    let v = (values[f.key] == null ? '' : String(values[f.key])).trim();
    let obrig = f.required;
    if (f.requiredWhen && values[f.requiredWhen.field] === f.requiredWhen.value) obrig = true;
    if (obrig && !v) throw new Error('Campo obrigatório vazio: ' + f.label);
    if (f.type === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      throw new Error('E-mail inválido: ' + f.label);
    }
    if (f.unit && v) {
      const n = parseInt(v.replace(/\D/g, ''), 10);
      const palavra = n === 1 ? f.unit : f.unit + 's';
      v = (isNaN(n) ? v : n) + ' ' + palavra;
    }
    dados[f.key] = v;
  });
  return dados;
}

function buildFilename(tpl, dados) {
  const pattern = tpl.filenamePattern || tpl.id;
  const nome = pattern.replace(/\{(\w+)\}/g, (_, key) => {
    const v = (dados[key] == null ? '' : String(dados[key])).trim();
    return v.split(/\s+/)[0] || 'sem_nome';
  });
  return nome.replace(/[^\w\-.]+/g, '_');
}

function preencherTexto(texto, dados) {
  return String(texto).replace(/\{(\w+)\}/g, (_, k) => (dados[k] == null ? '' : dados[k]));
}

// Regras de e-mail do template cujo gatilho (checkbox) está marcado.
function regrasAtivas(tpl, values) {
  if (!tpl.emails) return [];
  return tpl.emails.filter((r) => values[r.triggerField] === true || values[r.triggerField] === 'true');
}

module.exports = { acharTpl, prepararValores, buildFilename, preencherTexto, regrasAtivas, dataHojePtBr };
