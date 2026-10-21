// Histórico de e-Minutas LATAM (Emissão LATAM). Lista as emissões do hub (/emissao-latam/api/historico), reimprime a etiqueta (LatamEtiqueta), consulta o rastreio
// por AWB, atualiza o rastreio em lote e exporta CSV. esc() vem do ui.js.
(function () {
  'use strict';
  const API = '/emissao-latam/api';
  const $ = (id) => document.getElementById(id);
  const DIA = 86400000;

  const SITUACAO = {
    SEM_REGISTRO: { rotulo: 'Aguardando rastreio', tom: 'aviso' },
    EM_TRANSITO: { rotulo: 'Em trânsito', tom: 'info' },
    AGUARDANDO_RETIRADA: { rotulo: 'Aguardando retirada', tom: 'info' },
    COM_PROBLEMA: { rotulo: 'Com alerta', tom: 'erro' },
    ENTREGUE: { rotulo: 'Entregue', tom: 'ok' },
    DEVOLVIDO: { rotulo: 'Devolvido', tom: 'neutro' },
    CANCELADO: { rotulo: 'Cancelado', tom: 'neutro' },
  };
  const SEM_CONSULTA = { rotulo: 'Sem consulta', tom: 'neutro' };
  const FINAIS = ['ENTREGUE', 'DEVOLVIDO', 'CANCELADO'];
  const rotuloSit = (v) => (v ? (SITUACAO[v] || { rotulo: v, tom: 'neutro' }) : SEM_CONSULTA);
  const chaveSit = (l) => l.situacao || 'SEM_CONSULTA';

  const hojeBr = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const diasAtras = (n) => new Date(Date.now() - 3 * 3600000 - n * DIA).toISOString().slice(0, 10);
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const brl = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const kg = (n) => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg`);
  const nomeAeroporto = (iata) => { const a = (window.AEROPORTOS_INFO || []).find((x) => x.iata === iata); return a ? a.cidade : iata; };

  let linhas = null;
  let filtroSit = [];
  let carregando = false;

  const mostrarErro = (m) => { const el = $('elHErro'); el.textContent = m || ''; el.style.display = m ? '' : 'none'; };
  const mostrarAviso = (m) => { const el = $('elHAviso'); el.textContent = m || ''; el.style.display = m ? '' : 'none'; };

  async function carregar() {
    const de = $('elHDe').value, ate = $('elHAte').value;
    if (!de || !ate) return mostrarErro('Informe o período.');
    if (de > ate) return mostrarErro('A data inicial é depois da final.');
    carregando = true; mostrarErro(''); mostrarAviso('');
    $('elHBuscar').disabled = true; $('elHBuscar').textContent = 'Buscando…';
    try {
      const res = await fetch(`${API}/historico?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) { mostrarErro(json.erro || 'Não foi possível carregar o histórico'); linhas = []; } else linhas = json.itens;
    } catch (e) {
      mostrarErro('Sem conexão com o servidor. Tente novamente.');
    } finally {
      carregando = false; $('elHBuscar').disabled = false; $('elHBuscar').textContent = 'Buscar';
    }
    render();
  }

  function visiveis() {
    const t = $('elHBusca').value.trim().toLowerCase();
    const dig = t.replace(/\D/g, '');
    return (linhas || []).filter((l) => (!filtroSit.length || filtroSit.includes(chaveSit(l))) && (!t
      || [l.minuta, l.destinatario, l.cidadeUf, l.emitidoPor, l.numeroNf, l.servico].some((v) => v && String(v).toLowerCase().includes(t))
      || (dig.length >= 4 && [l.chaveNFe, l.cep, l.minuta, l.numeroNf].some((v) => v && String(v).includes(dig)))));
  }

  function renderChips() {
    const cont = new Map();
    (linhas || []).forEach((l) => cont.set(chaveSit(l), (cont.get(chaveSit(l)) || 0) + 1));
    const ordem = ['SEM_CONSULTA', 'SEM_REGISTRO', 'EM_TRANSITO', 'AGUARDANDO_RETIRADA', 'COM_PROBLEMA', 'ENTREGUE', 'DEVOLVIDO', 'CANCELADO'];
    $('elHChips').innerHTML = ordem.filter((k) => cont.get(k) || filtroSit.includes(k)).map((k) =>
      `<button type="button" class="el-chip" data-sit="${k}" aria-pressed="${filtroSit.includes(k)}">${esc((k === 'SEM_CONSULTA' ? SEM_CONSULTA : rotuloSit(k)).rotulo)} <b>${cont.get(k) || 0}</b></button>`).join('');
    $('elHChips').querySelectorAll('.el-chip').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.sit;
      filtroSit = filtroSit.includes(v) ? filtroSit.filter((x) => x !== v) : filtroSit.concat(v);
      render();
    }));
  }

  function render() {
    renderChips();
    const lista = visiveis();
    $('elHContador').textContent = linhas ? `${lista.length} de ${linhas.length}` : '';
    $('elHCsv').disabled = !lista.length;
    $('elHAtualizar').disabled = !lista.some((l) => !FINAIS.includes(l.situacao));
    const corpo = $('elHCorpo');
    if (!lista.length) { corpo.innerHTML = `<tr><td colspan="9" class="el-vazio">${linhas && linhas.length ? 'Nenhuma e-Minuta neste filtro.' : 'Nenhuma e-Minuta emitida pelo hub neste período.'}</td></tr>`; return; }
    corpo.innerHTML = lista.map((l) => {
      const st = rotuloSit(l.situacao);
      return `<tr>
        <td class="el-num">${esc(dataHora(l.emitidoEm))}<small>${esc(l.emitidoPor || '')}</small></td>
        <td class="el-codigoCel">${esc(l.minuta)}</td>
        <td>${esc(l.servico || '—')}</td>
        <td><span class="el-status" data-tom="${st.tom}">${esc(st.rotulo)}</span>${l.entregueEm ? `<small>${esc(dataHora(l.entregueEm))}</small>` : l.consultadoEm ? `<small>consultado ${esc(dataHora(l.consultadoEm))}</small>` : ''}</td>
        <td class="el-dest">${esc(l.destinatario || '—')}<small>${esc(l.cidadeUf || '')}</small></td>
        <td>${esc(l.numeroNf || '—')}<small>${esc(brl(l.valorNf))}</small></td>
        <td>${l.entregaDomicilio ? 'Domicílio' : 'Retirada'}<small>${esc(nomeAeroporto(l.destinoIata) || '')}</small></td>
        <td class="el-num">${l.volumes != null ? esc(String(l.volumes)) : '—'} vol.<small>${esc(kg(l.pesoKg))}</small></td>
        <td><div class="el-celAcoes">
          <button type="button" class="el-acao" data-etiqueta="termica" data-minuta="${esc(l.minuta)}">10x15</button>
          <button type="button" class="el-acao" data-etiqueta="a4" data-minuta="${esc(l.minuta)}">A4</button>
          <button type="button" class="el-acao" data-consultar="${esc(l.minuta)}">Consultar</button>
        </div></td>
      </tr>`;
    }).join('');
    corpo.querySelectorAll('[data-consultar]').forEach((b) => b.addEventListener('click', () => consultar(linhas.find((l) => l.minuta === b.dataset.consultar))));
    corpo.querySelectorAll('[data-etiqueta]').forEach((b) => b.addEventListener('click', () => etiqueta(b.dataset.etiqueta, b.dataset.minuta, b)));
  }

  // ── Reimprimir a etiqueta interna ──
  async function etiqueta(layout, minuta, btn) {
    mostrarErro('');
    btn.disabled = true;
    try {
      const res = await fetch(`${API}/etiqueta/${encodeURIComponent(minuta)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.erro || 'Não foi possível carregar os dados da etiqueta');
      if (!window.LatamEtiqueta.abrir(layout, json.previa, json.minuta)) mostrarErro('O navegador bloqueou a janela da etiqueta. Permita pop-ups pra este site.');
    } catch (e) {
      mostrarErro(e.message);
    } finally { btn.disabled = false; }
  }

  // ── Consultar rastreio ──
  async function consultarApi(minuta) {
    const res = await fetch(`${API}/consulta?awb=${encodeURIComponent(minuta)}`, { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.erro || 'Não foi possível consultar');
    return json;
  }
  function aplicar(l, c) {
    l.situacao = c.situacao; l.entregueEm = c.entregueEm || null; l.consultadoEm = new Date().toISOString();
  }

  function fecharModal() { $('elHModal').hidden = true; }
  async function consultar(l) {
    if (!l) return;
    $('elHModalTitulo').textContent = `Consulta ${l.minuta}`;
    $('elHModalCorpo').innerHTML = '<p class="el-vazio">Consultando a LATAM…</p>';
    $('elHModal').hidden = false;
    try {
      const c = await consultarApi(l.minuta);
      aplicar(l, c); render();
      $('elHModalCorpo').innerHTML = renderConsulta(l, c);
    } catch (e) {
      $('elHModalCorpo').innerHTML = `<p class="el-erro">${esc(e.message)}</p>`;
    }
  }

  function renderConsulta(l, c) {
    const st = rotuloSit(c.situacao);
    const campos = [
      ['Situação do rastreio', `<span class="el-status" data-tom="${st.tom}">${esc(st.rotulo)}</span>`],
      ['Serviço', esc(l.servico || '—')],
      ['Destinatário', esc(l.destinatario || '—') + (l.cidadeUf ? ` · ${esc(l.cidadeUf)}` : '')],
      ['Nota fiscal', esc(l.numeroNf || '—') + (l.valorNf != null ? ` · ${esc(brl(l.valorNf))}` : '')],
      ['Emitida por', esc(l.emitidoPor || '—')],
      ['Emitida em', esc(dataHora(l.emitidoEm))],
    ];
    if (c.localizacao) campos.push(['Localização', esc(c.localizacao)]);
    if (c.entregueEm) campos.push(['Entregue em', esc(dataHora(c.entregueEm))]);
    if (c.recebedor) campos.push(['Recebido por', esc(c.recebedor)]);
    const dl = '<dl>' + campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('') + '</dl>';
    let eventos = '';
    if (!c.encontrado) {
      eventos = '<p class="el-aviso"><span>A LATAM ainda não tem rastreio desta e-Minuta. Isso é normal até a carga ser recebida no balcão e <b>não</b> significa que a e-Minuta não existe.</span></p>';
    } else if (c.ocorrencias.length) {
      eventos = '<h3>Rastreio</h3><ul class="el-linhaTempo">' + c.ocorrencias.slice().sort((a, b) => String(b.dataHora).localeCompare(String(a.dataHora))).map((o) =>
        `<li${o.alerta && o.catalogado ? ' data-alerta="1"' : ''}><b>${esc(o.descricao)}</b><small>${esc(dataHora(o.dataHora))}${o.aeroporto ? ' · ' + esc(o.aeroporto) + (o.municipio ? ' (' + esc(o.municipio) + ')' : '') : ''}${o.voo ? ' · voo ' + esc(o.voo) : ''}</small></li>`).join('') + '</ul>';
    }
    return `<div class="el-consulta">${dl}${eventos}</div>`;
  }

  // ── Atualizar rastreio em lote (só as não entregues, até 15, 2 por vez) ──
  async function atualizarLote() {
    const alvo = visiveis().filter((l) => !FINAIS.includes(l.situacao)).slice(0, 15);
    if (!alvo.length) return;
    const btn = $('elHAtualizar');
    btn.disabled = true; mostrarErro('');
    let feitas = 0, falhas = 0;
    const fila = alvo.slice();
    const trabalhador = async () => {
      while (fila.length) {
        const l = fila.shift();
        try { aplicar(l, await consultarApi(l.minuta)); } catch (e) { falhas++; }
        feitas++; btn.textContent = `Atualizando… ${feitas}/${alvo.length}`;
      }
    };
    await Promise.all([trabalhador(), trabalhador()]);
    btn.textContent = 'Atualizar rastreio';
    if (falhas) mostrarErro(`${falhas} consulta(s) falharam (a LATAM às vezes demora ou não responde). Tente de novo em instantes.`);
    render();
  }

  // ── Exportar CSV ──
  function exportarCsv(lista) {
    const cab = ['Emitida em', 'e-Minuta/AWB', 'Serviço', 'Rastreio', 'Entregue em', 'Destinatário', 'Cidade/UF', 'CEP', 'NF', 'Valor NF', 'Chave NF-e', 'Entrega', 'Aeroporto destino', 'Volumes', 'Peso (kg)', 'Emitida por'];
    const cel = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const linhasCsv = lista.map((l) => [dataHora(l.emitidoEm), l.minuta, l.servico, rotuloSit(l.situacao).rotulo, l.entregueEm ? dataHora(l.entregueEm) : '', l.destinatario, l.cidadeUf, l.cep, l.numeroNf,
      l.valorNf, l.chaveNFe ? `'${l.chaveNFe}` : '', l.entregaDomicilio ? 'Domicílio' : 'Retirada', l.destinoIata, l.volumes, l.pesoKg, l.emitidoPor].map(cel).join(';'));
    const csv = '﻿' + [cab.join(';'), ...linhasCsv].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `e-minutas-latam-${hojeBr()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Eventos ──
  $('elHDe').value = diasAtras(30);
  $('elHAte').value = hojeBr();
  $('elHAte').max = hojeBr();
  $('elHBuscar').addEventListener('click', carregar);
  document.querySelectorAll('.el-atalho').forEach((b) => b.addEventListener('click', () => { $('elHDe').value = diasAtras(Number(b.dataset.dias)); $('elHAte').value = hojeBr(); carregar(); }));
  $('elHBusca').addEventListener('input', render);
  $('elHCsv').addEventListener('click', () => exportarCsv(visiveis()));
  $('elHAtualizar').addEventListener('click', atualizarLote);
  $('elHModalFechar').addEventListener('click', fecharModal);
  $('elHModal').addEventListener('click', (e) => { if (e.target === $('elHModal')) fecharModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('elHModal').hidden) fecharModal(); });

  carregar();
})();
