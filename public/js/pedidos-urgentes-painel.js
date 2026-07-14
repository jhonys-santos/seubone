// Painel do estoque — portado do painel.html original.
// Mudança: endpoint agora é /pedidos-urgentes/api/... e o despacho não pede
// mais o nome via prompt() — o servidor usa o nome da sessão autenticada.

let idsConhecidos = new Set();
let primeiraCarga = true;

function ativarSom() {
  const audio = document.getElementById('somAlerta');
  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    document.getElementById('btnAtivarSom').textContent = '✓ Som ativado';
    document.getElementById('btnAtivarSom').disabled = true;
  }).catch(() => {
    document.getElementById('btnAtivarSom').textContent = 'Não foi possível ativar — clique em qualquer lugar da página';
  });
}

function tocarAlerta() {
  const audio = document.getElementById('somAlerta');
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function formatarHora(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function urgencia(prazoIso) {
  const prazo = new Date(prazoIso);
  const diffMin = (prazo - new Date()) / 60000;
  if (diffMin < 0) return 'danger';
  if (diffMin < 120) return 'warn';
  return 'ok';
}

function rotuloUrgencia(prazoIso) {
  const prazo = new Date(prazoIso);
  const diffMin = Math.round((prazo - new Date()) / 60000);
  if (diffMin < 0) return `Atrasado ${Math.abs(diffMin)} min`;
  if (diffMin < 120) return `Faltam ${diffMin} min`;
  return `No prazo`;
}

function abrirImagem(url) {
  document.getElementById('lightboxImg').src = url;
  document.getElementById('lightbox').classList.add('aberto');
}

function fecharImagem() {
  document.getElementById('lightbox').classList.remove('aberto');
  document.getElementById('lightboxImg').src = '';
}

async function despachar(id, os) {
  if (!confirm(`Confirmar despacho do pedido ${os}?`)) return;
  try {
    const resp = await fetch('/pedidos-urgentes/api/despachar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await resp.json();
    if (data.ok) {
      idsConhecidos.delete(id);
      carregar();
    } else {
      alert('Erro: ' + (data.erro || 'não foi possível despachar'));
    }
  } catch (e) {
    alert('Erro de conexão ao despachar.');
  }
}

async function carregar() {
  try {
    const resp = await fetch('/pedidos-urgentes/api/list?status=Pendente');
    const pedidos = await resp.json();

    pedidos.sort((a, b) => new Date(a.Prazo) - new Date(b.Prazo));

    const idsAtuais = new Set(pedidos.map(p => p.ID));
    if (!primeiraCarga) {
      const novos = [...idsAtuais].filter(id => !idsConhecidos.has(id));
      if (novos.length > 0) tocarAlerta();
    }
    idsConhecidos = idsAtuais;
    primeiraCarga = false;

    const atrasados = pedidos.filter(p => urgencia(p.Prazo) === 'danger').length;
    document.getElementById('statTotal').textContent = pedidos.length;
    document.getElementById('statAtrasado').textContent = atrasados;
    document.getElementById('statNoPrazo').textContent = pedidos.length - atrasados;

    const lista = document.getElementById('lista');
    if (pedidos.length === 0) {
      lista.innerHTML = `<div class="empty"><div class="big"><i class="ti ti-circle-check" aria-hidden="true"></i></div>Nenhum pedido pendente agora.</div>`;
      return;
    }

    lista.innerHTML = pedidos.map(p => {
      const u = urgencia(p.Prazo);
      return `
        <div class="pedido ${u}">
          <div class="pedido-top">
            <div>
              <div class="pedido-os mono">${p.OS}</div>
              <div class="pedido-cliente">${p.Cliente}</div>
            </div>
            <span class="badge ${u}">${rotuloUrgencia(p.Prazo)}</span>
          </div>
          <div class="pedido-meta">
            <div><div class="k">Prazo</div>${formatarHora(p.Prazo)}</div>
            <div><div class="k">Transportadora</div>${p.Transportadora}</div>
            <div><div class="k">Modalidade</div>${p.Modalidade}</div>
            ${p.TipoEnvioAereo ? `<div><div class="k">Envio aéreo</div>${p.TipoEnvioAereo}${p.AeroportoRetirada ? ' — ' + p.AeroportoRetirada : ''}</div>` : ''}
            <div><div class="k">Bitrix/Lulu 2.0</div><a href="${p.LinkCRM}" target="_blank">Abrir pedido →</a></div>
            ${p.ManifestoLink ? `<div><div class="k">Minuta</div><a href="${p.ManifestoLink}" target="_blank">Ver PDF →</a></div>` : ''}
            ${p.NotaFiscalLink ? `<div><div class="k">Nota fiscal</div><a href="${p.NotaFiscalLink}" target="_blank">Ver PDF →</a></div>` : ''}
            <div><div class="k">Inserido por</div>${p.InseridoPor}</div>
          </div>
          ${p.Observacao ? `<div class="observacao"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${p.Observacao}</div>` : ''}
          ${p.OSImagemId ? `
            <img class="os-thumb" src="https://drive.google.com/thumbnail?id=${p.OSImagemId}&sz=w300"
                 alt="Foto da OS ${p.OS}"
                 onclick="abrirImagem('https://drive.google.com/thumbnail?id=${p.OSImagemId}&sz=w1600')">
          ` : ''}
          <div class="pedido-actions">
            <button class="btn-dispatch" onclick="despachar('${p.ID}', '${p.OS}')"><i class="ti ti-truck-delivery" aria-hidden="true"></i> Despachar</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('lista').innerHTML = `<div class="empty">Erro ao carregar.</div>`;
  }
}

carregar();
setInterval(carregar, 15000);
