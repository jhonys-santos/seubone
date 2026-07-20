// Gerador de Autorização — porta do Apps Script original (Index.html +
// Código.js). A diferença principal é que a config já vem inline do servidor
// (window.AUTORIZACOES_CONFIG, um array de templates) em vez de um round
// trip a getClientConfig(), e os botões chamam /autorizacoes/api/... em vez
// de google.script.run.

const CFG = window.AUTORIZACOES_CONFIG;

(function inicializar() {
  const sel = document.getElementById('tpl');
  CFG.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.label;
    sel.appendChild(o);
  });
  renderCampos();
})();

function templateAtual() {
  const id = document.getElementById('tpl').value;
  return CFG.find((t) => t.id === id);
}

function renderCampos() {
  const t = templateAtual();
  if (!t) return;
  const div = document.getElementById('campos');
  div.innerHTML = '';

  t.fields.forEach((f) => {
    if (f.type === 'checkbox') {
      const wrap = document.createElement('label');
      wrap.className = 'qt-toggle-label';
      wrap.style.marginTop = '16px';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = 'f_' + f.key;
      chk.onchange = () => { aplicarVisibilidade(); esconderEnvio(); };
      wrap.appendChild(chk);
      wrap.appendChild(document.createTextNode(f.label));
      div.appendChild(wrap);
    } else {
      const box = document.createElement('div');
      box.id = 'campo_' + f.key;
      const lbl = document.createElement('label');
      lbl.textContent = f.label + (f.required ? ' *' : '');
      const inp = document.createElement('input');
      inp.id = 'f_' + f.key;
      inp.type = f.type === 'email' ? 'email' : 'text';
      inp.autocomplete = 'off';
      const ku = f.key.toUpperCase();
      if (ku.indexOf('CPF') >= 0) {
        inp.inputMode = 'numeric';
        inp.oninput = () => { inp.value = mascaraCPF(inp.value); };
      } else if (ku.indexOf('CEP') >= 0) {
        inp.inputMode = 'numeric';
        inp.oninput = () => { inp.value = mascaraCEP(inp.value); };
      }
      box.appendChild(lbl);
      box.appendChild(inp);
      div.appendChild(box);
    }
  });

  esconde();
  esconderEnvio();
  aplicarVisibilidade();
}

function aplicarVisibilidade() {
  const t = templateAtual();
  if (!t) return;
  t.fields.forEach((f) => {
    if (!f.showWhen) return;
    const ctrl = document.getElementById('f_' + f.showWhen.field);
    const box = document.getElementById('campo_' + f.key);
    if (ctrl && box) box.style.display = ctrl.checked === f.showWhen.value ? 'block' : 'none';
  });
}

function esconderEnvio() {
  document.getElementById('enviar').style.display = 'none';
}

let ULTIMO = null; // { templateId, values, envios } da última geração

async function gerar() {
  const t = templateAtual();
  if (!t) return;

  const values = {};
  let faltou = '';
  t.fields.forEach((f) => {
    const el = document.getElementById('f_' + f.key);
    if (f.type === 'checkbox') { values[f.key] = el.checked; return; }
    const v = el.value.trim();
    let obrig = f.required;
    if (f.requiredWhen) {
      const c = document.getElementById('f_' + f.requiredWhen.field);
      obrig = !!(c && c.checked === f.requiredWhen.value);
    }
    if (obrig && !v && !faltou) faltou = f.label;
    values[f.key] = v;
  });
  if (faltou) { mostra('erro', 'Preencha: ' + faltou); return; }

  const btn = document.getElementById('gerar');
  btn.disabled = true;
  btn.textContent = 'Gerando...';
  esconde();
  esconderEnvio();

  try {
    const resp = await fetch('/autorizacoes/api/gerar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: t.id, values }),
    });
    const res = await resp.json();
    if (!res.ok) throw new Error(res.erro || 'Erro desconhecido');

    baixar(res.base64, res.filename, res.mimeType);
    btn.classList.add('ok');
    btn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Gerado';
    setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = '<i class="ti ti-file-download" aria-hidden="true"></i> Gerar e baixar PDF'; }, 2200);
    mostra('ok', 'Pronto: ' + res.filename);

    ULTIMO = { templateId: t.id, values, envios: res.emailsDisponiveis || [] };
    const be = document.getElementById('enviar');
    if (ULTIMO.envios.length) {
      be.innerHTML = `<i class="ti ti-mail-forward" aria-hidden="true"></i> ${ULTIMO.envios.length > 1 ? 'Enviar e-mails' : 'Enviar e-mail'}`;
      be.style.display = 'block';
    }
  } catch (err) {
    mostra('erro', err.message);
  } finally {
    btn.disabled = false;
    if (!btn.classList.contains('ok')) btn.innerHTML = '<i class="ti ti-file-download" aria-hidden="true"></i> Gerar e baixar PDF';
  }
}

async function enviar() {
  if (!ULTIMO || !ULTIMO.envios.length) return;
  const lista = ULTIMO.envios.map((e) => `• ${e.label}: ${e.recipientLabel}`).join('\n');
  const ok = await hubConfirm(`Enviar a autorização por e-mail para:\n\n${lista}\n\nConfirmar?`);
  if (!ok) return;

  const btn = document.getElementById('enviar');
  const txtOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  esconde();

  try {
    const resp = await fetch('/autorizacoes/api/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ULTIMO),
    });
    const res = await resp.json();
    if (!res.ok) throw new Error(res.erro || 'Erro desconhecido');
    const quem = res.enviados.map((e) => e.label).join(', ');
    mostra('ok', `Enviado (${quem})`);
  } catch (err) {
    mostra('erro', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = txtOriginal;
  }
}

function baixar(base64, filename, mimeType) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function mostra(tipo, txt) {
  const m = document.getElementById('msg');
  m.className = 'msg ' + tipo;
  m.textContent = txt;
}
function esconde() {
  const m = document.getElementById('msg');
  m.className = 'msg';
  m.textContent = '';
}

function mascaraCPF(v) {
  v = v.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  if (v.length > 6) return v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  if (v.length > 3) return v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  return v;
}
function mascaraCEP(v) {
  v = v.replace(/\D/g, '').slice(0, 8);
  if (v.length > 5) return v.replace(/(\d{5})(\d{1,3})/, '$1-$2');
  return v;
}

function limpar() {
  const t = templateAtual();
  if (!t) return;
  t.fields.forEach((f) => {
    const el = document.getElementById('f_' + f.key);
    if (!el) return;
    if (f.type === 'checkbox') el.checked = false; else el.value = '';
  });
  ULTIMO = null;
  esconde();
  esconderEnvio();
  aplicarVisibilidade();
}
