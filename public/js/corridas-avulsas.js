// Corridas Avulsas — cadastro de corrida (Uber parceiro) + resumo da
// semana atual (segunda a sexta), pronto pra printar e enviar ao
// financeiro. O servidor preenche registradoPorSlug/registradoPorNome a
// partir da sessão autenticada.

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function caFmtISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function caFmtDDMM(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
// Segunda-feira da semana de "d" (se "d" cair num domingo, volta 6 dias;
// senão volta até a segunda mais próxima pra trás).
function caSegunda(d) {
  const date = new Date(d);
  const dia = date.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function caFmtBRL(v) {
  return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
}
function caEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('caData').value = caFmtISO(new Date());

let caSemanaOffset = 0;

async function caEnviar() {
  const data = document.getElementById('caData').value;
  const nf = document.getElementById('caNf').value.trim();
  const endereco = document.getElementById('caEndereco').value.trim();
  const motorista = document.getElementById('caMotorista').value.trim();
  const valor = document.getElementById('caValor').value;
  const printInput = document.getElementById('caPrint');
  const arquivo = printInput.files[0];

  const msg = document.getElementById('caMsg');
  msg.className = 'msg';

  if (!data || !nf || !endereco || !motorista || !valor || !arquivo) {
    msg.textContent = 'Preencha todos os campos obrigatórios (*), incluindo o print do motorista.';
    msg.classList.add('err');
    return;
  }

  const btn = document.getElementById('caBtnEnviar');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const imagemBase64 = await toBase64(arquivo);
    const payload = {
      dataCorrida: data,
      numeroNf: nf,
      endereco,
      nomeMotorista: motorista,
      valor,
      imagemBase64,
      imagemTipo: arquivo.type,
    };

    const resp = await fetch('/corridas-avulsas/api/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const resultado = await resp.json();

    if (resultado.ok) {
      msg.textContent = 'Corrida registrada.';
      msg.classList.add('ok');
      document.getElementById('caNf').value = '';
      document.getElementById('caEndereco').value = '';
      document.getElementById('caMotorista').value = '';
      document.getElementById('caValor').value = '';
      printInput.value = '';
      document.getElementById('caData').value = caFmtISO(new Date());
      if (caSemanaOffset === 0) caCarregarSemana();
    } else {
      throw new Error(resultado.erro || 'Erro desconhecido');
    }
  } catch (err) {
    msg.textContent = 'Erro ao registrar: ' + err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i> Registrar corrida';
  }
}
window.caEnviar = caEnviar;

function caNavegarSemana(delta) {
  caSemanaOffset += delta;
  caCarregarSemana();
}
window.caNavegarSemana = caNavegarSemana;

let caItensSemana = [];

async function caCarregarSemana() {
  const hoje = new Date();
  const segunda = caSegunda(hoje);
  segunda.setDate(segunda.getDate() + caSemanaOffset * 7);
  const sexta = new Date(segunda);
  sexta.setDate(segunda.getDate() + 4);

  document.getElementById('caSemanaLabel').textContent = `Semana de ${caFmtDDMM(segunda)} a ${caFmtDDMM(sexta)}`;

  const lista = document.getElementById('caLista');
  lista.innerHTML = '<div class="ca-empty"><i class="ti ti-loader-2" aria-hidden="true"></i> Carregando...</div>';
  document.getElementById('caTotal').textContent = caFmtBRL(0);

  try {
    const resp = await fetch(`/corridas-avulsas/api/lista?desde=${caFmtISO(segunda)}&ate=${caFmtISO(sexta)}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.erro || 'Erro desconhecido');

    caItensSemana = json.itens || [];
    caAtualizarFiltroMotorista();
    caRenderLista();
  } catch (err) {
    caItensSemana = [];
    lista.innerHTML = `<div class="ca-empty"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Não foi possível carregar: ${err.message}</div>`;
  }
}

// Opções do filtro vêm de quem já foi cadastrado nessa semana (não da
// lista de sugestão do formulário) — reseta pra "Todos" a cada semana.
function caAtualizarFiltroMotorista() {
  const select = document.getElementById('caFiltroMotorista');
  const nomes = [...new Set(caItensSemana.map((it) => it.nomeMotorista).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  select.innerHTML = '<option value="">Todos</option>' + nomes.map((n) => `<option value="${caEsc(n)}">${caEsc(n)}</option>`).join('');
}

function caRenderLista() {
  const lista = document.getElementById('caLista');
  const filtro = document.getElementById('caFiltroMotorista').value;
  const itens = filtro ? caItensSemana.filter((it) => it.nomeMotorista === filtro) : caItensSemana;

  const total = itens.reduce((soma, it) => soma + (Number(it.valor) || 0), 0);
  document.getElementById('caTotal').textContent = caFmtBRL(total);

  if (!itens.length) {
    lista.innerHTML = `<div class="ca-empty">${filtro ? 'Nenhuma corrida desse motorista nessa semana.' : 'Nenhuma corrida registrada nessa semana.'}</div>`;
    return;
  }

  const linhas = itens.map((it) => `
    <tr>
      <td>${caFmtDDMM(new Date(it.dataCorrida + 'T12:00:00'))}</td>
      <td>${caEsc(it.numeroNf)}</td>
      <td>${caEsc(it.endereco)}</td>
      <td>${caEsc(it.nomeMotorista)}</td>
      <td class="ca-td-valor">${caFmtBRL(it.valor)}</td>
      <td class="ca-td-print">${it.printUrl ? `<a href="${it.printUrl}" target="_blank" rel="noopener"><i class="ti ti-photo" aria-hidden="true"></i> Ver</a>` : '—'}</td>
    </tr>
  `).join('');

  lista.innerHTML = `
    <div class="ca-table-wrap">
      <table class="ca-table">
        <thead><tr><th>Data</th><th>NF</th><th>Endereço</th><th>Motorista</th><th>Valor</th><th>Print</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}
window.caRenderLista = caRenderLista;

caCarregarSemana();
