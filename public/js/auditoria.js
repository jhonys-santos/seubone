// Auditoria de Qualidade — portado de um HTML standalone que falava direto
// com o Apps Script (URL exposta no navegador, sem checagem de segredo).
// Agora passa por /auditoria/api/{list,create} (proxy do hub, com o mesmo
// segredo compartilhado dos outros painéis) — a lógica de score e os
// critérios de avaliação são idênticos ao original.

// ============================================================
// Critérios (mesma lógica do sistema original)
// ============================================================
const AD_SECTIONS = [
  { id: 1, title: "Comunicação", weight: 25, criteria: [
    { key: "c11", code: "1.1", title: "Tom humanizado e profissional", desc: "Evitou respostas engessadas, usou nome do cliente, linguagem acessível e respeitosa?", max: 6 },
    { key: "c12", code: "1.2", title: "Clareza e objetividade", desc: "A informação foi passada de forma direta, sem ambiguidade e fácil de entender?", max: 6 },
    { key: "c13", code: "1.3", title: "Respeitou o SLA de primeira resposta", desc: "Verificar no sistema (Octadesk): tempo entre entrada do chamado e 1ª resposta está dentro do prazo definido?", max: 7 },
    { key: "c14", code: "1.4", title: "Proatividade, antecipou próximos passos", desc: "Sim = informou prazo/próxima etapa espontaneamente | Parcial = só quando perguntado | Não = não informou", max: 6 },
  ]},
  { id: 2, title: "Seguimento de Processo", weight: 40, criteria: [
    { key: "c21", code: "2.1", title: "Identificou corretamente o problema", desc: "Confirmou ou parafraseou o que o cliente precisava antes de agir? Não assumiu sem validar?", max: 10 },
    { key: "c22", code: "2.2", title: "Seguiu o fluxo padrão para o tipo de ocorrência", desc: "Respeitou o processo definido sem criar exceção manual? Utilizou a base de conhecimento?", max: 10 },
    { key: "c23", code: "2.3", title: "Acionou a área ou pessoa correta sem retrabalho", desc: "O direcionamento foi feito certo na primeira vez? Sem trocas desnecessárias?", max: 10 },
    { key: "c24", code: "2.4", title: "Documentou a tratativa conforme o padrão", desc: "Há registro completo da tratativa no canal definido pelo setor?", max: 10 },
  ]},
  { id: 3, title: "Resultado do Atendimento", weight: 35, criteria: [
    { key: "c31", code: "3.1", title: "Problema foi resolvido no contato", desc: "O cliente teve sua questão solucionada sem precisar reentrar em contato pelo mesmo motivo?", max: 10 },
    { key: "c32", code: "3.2", title: "Resolução dentro do TMR definido", desc: "O tempo entre abertura e encerramento do caso respeitou o SLA da categoria?", max: 8 },
    { key: "c33", code: "3.3", title: "Solução foi definitiva, sem retratativa", desc: "Não houve necessidade de corrigir informação ou ação tomada após o encerramento?", max: 10 },
    { key: "c34", code: "3.4", title: "Cliente encerrou satisfeito ou neutro positivo", desc: "Com base nas últimas mensagens, o cliente demonstrou satisfação ou não escalou a insatisfação?", max: 7 },
  ]},
];

const AD_FALHAS_GRAVES = [
  { key: "fg1", code: "FG1", title: "Passou informação errada ao cliente", desc: "Dado incorreto sobre prazo, status, produto, valor ou qualquer informação relevante" },
  { key: "fg2", code: "FG2", title: "Prometeu prazo ou solução sem validar", desc: "Deu garantia ao cliente sem confirmar com a área responsável" },
  { key: "fg3", code: "FG3", title: "Não consultou o histórico do atendimento", desc: "Respondeu sem verificar contatos anteriores, gerou ruptura na fluidez e/ou ação errada" },
  { key: "fg4", code: "FG4", title: "Solução alinhada pelo consultor gerou custo evitável", desc: "Confirmou ou encaminhou resolução que gerou custo operacional desnecessário (refabricação, frete extra, desconto indevido, etc.)" },
];

const AD_OCCURRENCE_TYPES = [
  "Refabricação","Erro de envio","Pedido atrasado","Dúvida sobre produto","Cancelamento","Dúvida sobre pagamento",
  "Dúvida sobre logística","Reembolso total","Reembolso parcial","Sugestão de melhoria","Elogio","Problema no pagamento",
  "Cobrança indevida","Produto com defeito","Produto errado","Pedido extraviado","Pedido incompleto",
  "Pedido entregue no local errado","Pedido enviado para o endereço errado","NPS Insatisfeito","Novo pedido",
  "Mal uso do produto","Problema do suador manchando","Status do pedido","Código de rastreio",
  "Retido na fiscalização (SEFAZ)","Atraso de produção","Atraso na logística","Ajuste de nota fiscal",
  "Nota fiscal do pedido","Confirmação e ajuste no endereço","Ajuste no pedido","Informações sobre envio do pedido",
  "Logística reversa","Amostra","Autorização de retirada","Teste de logo/Protótipo","Retirada no aeroporto",
  "Retirada agência correios","Retirada no escritório","Retirada em loja azul","Quitação do pedido",
  "Comprovante de quitação","Cancelamento do pedido (Não produzido)","Expectativa do cliente não atendida",
  "Erro de produção (Fábrica)","Erro de produção (SeuBoné)","Avaria do pedido no transporte","Sem contato com o cliente",
  "Foto do pedido","Time de Resolução",
];

const AD_CHANNELS = ["Octadesk", "WhatsApp", "E-mail", "Telefone", "Instagram"];
const AD_AGENT_SUGGESTIONS = ["Iasmin", "Francis", "Nathalia"];

const AD_CRITERION_KEYS = AD_SECTIONS.flatMap(s => s.criteria.map(c => c.key));

// Metadados das 3 seções pra exibir médias (S1/S2/S3 já vêm calculados por
// registro do Apps Script) — reaproveita o mesmo peso/título já definido em
// AD_SECTIONS, pra nunca ficar um "25/40/35" desatualizado em outro lugar.
const AD_SECTION_META = AD_SECTIONS.map((s, i) => ({ key: "S" + (i + 1), label: s.title, max: s.weight }));

// ============================================================
// Lógica de score (idêntica ao sistema original)
// ============================================================
function adComputeScore(scores, fgs) {
  const s1 = scores.c11 + scores.c12 + scores.c13 + scores.c14;
  const s2 = scores.c21 + scores.c22 + scores.c23 + scores.c24;
  const s3 = scores.c31 + scores.c32 + scores.c33 + scores.c34;
  const critical = fgs.fg1 || fgs.fg2 || fgs.fg3 || fgs.fg4;
  const total = critical ? 0 : s1 + s2 + s3;
  return { section1: s1, section2: s2, section3: s3, total, criticalFailure: critical, classification: adClassify(total, critical) };
}
function adClassify(total, critical) {
  if (critical) return "CRITICO";
  if (total >= 90) return "EXCELENTE";
  if (total >= 75) return "BOM";
  if (total >= 60) return "REGULAR";
  return "CRITICO";
}
function adWeekLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diffToFriday = (day - 5 + 7) % 7;
  const friday = new Date(d); friday.setUTCDate(d.getUTCDate() - diffToFriday);
  const thursday = new Date(friday); thursday.setUTCDate(friday.getUTCDate() + 6);
  const fmt = x => String(x.getUTCDate()).padStart(2, "0") + "/" + String(x.getUTCMonth() + 1).padStart(2, "0");
  return fmt(friday) + " a " + fmt(thursday);
}

// ============================================================
// Estado
// ============================================================
const adState = {
  records: [],
  loaded: false,
  scores: Object.fromEntries(AD_CRITERION_KEYS.map(k => [k, 0])),
  fgs: { fg1: false, fg2: false, fg3: false, fg4: false },
  selectedAgent: null,
};

// ============================================================
// Navegação entre telas
// ============================================================
document.getElementById("ad-nav").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  adShowView(btn.dataset.view);
});

function adShowView(view) {
  document.querySelectorAll(".ad-view").forEach(v => v.classList.remove("active"));
  document.getElementById("ad-view-" + view).classList.add("active");
  document.querySelectorAll("#ad-nav button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  if (adState.loaded) {
    if (view === "registro") adRenderRegistro();
    if (view === "dashboard") adRenderDashboard();
    if (view === "agentes") adRenderAgentesTabs();
  }
}

// ============================================================
// Formulário — construir seções e pills
// ============================================================
function adBuildForm() {
  document.getElementById("ad-f-data").value = new Date().toISOString().slice(0, 10);
  document.getElementById("ad-f-auditadoPor").value = (window.USUARIO_SESSAO && window.USUARIO_SESSAO.nome) || "";

  document.getElementById("ad-agent-options").innerHTML = AD_AGENT_SUGGESTIONS.map(a => `<option value="${a}">`).join("");
  document.getElementById("ad-occurrence-options").innerHTML = AD_OCCURRENCE_TYPES.map(o => `<option value="${o}">`).join("");
  document.getElementById("ad-channel-options").innerHTML = AD_CHANNELS.map(c => `<option value="${c}">`).join("");
  document.getElementById("ad-f-canal").value = AD_CHANNELS[0];

  const container = document.getElementById("ad-sections-container");
  container.innerHTML = AD_SECTIONS.map(section => `
    <div class="ad-card">
      <div class="ad-section-head">
        <h2>Seção ${section.id} · ${section.title}</h2>
        <span class="weight">peso: ${section.weight} pts</span>
      </div>
      ${section.criteria.map(c => `
        <div class="ad-criterion">
          <div class="ad-criterion-top">
            <p>${c.code} ${c.title}</p>
            <span>máx ${c.max}</span>
          </div>
          <p class="ad-criterion-desc">${c.desc}</p>
          <div class="ad-pills" data-key="${c.key}" data-max="${c.max}">
            ${Array.from({ length: c.max + 1 }, (_, v) => `<div class="ad-pill" data-value="${v}">${v}</div>`).join("")}
          </div>
        </div>
      `).join("")}
      <div class="ad-subtotal-row">Subtotal <b id="ad-subtotal-${section.id}">0</b>/${section.weight}</div>
    </div>
  `).join("");

  container.querySelectorAll(".ad-pills").forEach(group => {
    const key = group.dataset.key;
    group.addEventListener("click", (e) => {
      const pill = e.target.closest(".ad-pill");
      if (!pill) return;
      adState.scores[key] = Number(pill.dataset.value);
      group.querySelectorAll(".ad-pill").forEach(p => p.classList.toggle("selected", p === pill));
      adUpdateScoreSummary();
    });
    group.querySelector('.ad-pill[data-value="0"]').classList.add("selected");
  });

  const fgContainer = document.getElementById("ad-fg-container");
  fgContainer.innerHTML = AD_FALHAS_GRAVES.map(fg => `
    <label class="ad-fg-item">
      <input type="checkbox" data-key="${fg.key}" />
      <span><span class="ad-fg-title">${fg.code} · ${fg.title}</span><span class="ad-fg-desc">${fg.desc}</span></span>
    </label>
  `).join("");
  fgContainer.querySelectorAll("input[type=checkbox]").forEach(input => {
    input.addEventListener("change", () => {
      adState.fgs[input.dataset.key] = input.checked;
      adUpdateScoreSummary();
    });
  });

  adUpdateScoreSummary();
}

// Avisa (sem bloquear o envio) se o ID da conversa digitado já tiver uma
// auditoria registrada — evita duplicar avaliação do mesmo atendimento sem
// querer. Só compara contra o que já carregou do hub (adState.records).
function adCheckDuplicateConversationId() {
  const input = document.getElementById("ad-f-conversationId");
  const warningEl = document.getElementById("ad-f-conversationId-warning");
  const value = input.value.trim().toLowerCase();
  if (!value) { warningEl.textContent = ""; return; }
  const match = adState.records.find(r => String(r.ConversationId || "").trim().toLowerCase() === value);
  warningEl.textContent = match
    ? `⚠ Esse ID já foi auditado em ${adFmtDate(match.Data)}, agente ${match.Agente}, por ${match.AuditadoPor}.`
    : "";
}
document.getElementById("ad-f-conversationId").addEventListener("input", adCheckDuplicateConversationId);

function adUpdateScoreSummary() {
  const result = adComputeScore(adState.scores, adState.fgs);
  document.getElementById("ad-subtotal-1").textContent = result.section1;
  document.getElementById("ad-subtotal-2").textContent = result.section2;
  document.getElementById("ad-subtotal-3").textContent = result.section3;
  document.getElementById("ad-score-total").textContent = result.total;
  const badge = document.getElementById("ad-score-badge");
  badge.textContent = result.classification;
  badge.className = "ad-badge ad-badge-" + result.classification;
  document.getElementById("ad-score-fg-warning").textContent = result.criticalFailure ? "Falha grave, score zerado" : "";
}

// ============================================================
// Envio do formulário
// ============================================================
document.getElementById("ad-audit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("ad-form-error");
  errorBox.innerHTML = "";

  const payload = {
    data: document.getElementById("ad-f-data").value,
    conversationId: document.getElementById("ad-f-conversationId").value.trim(),
    agente: document.getElementById("ad-f-agente").value.trim(),
    tipoOcorrencia: document.getElementById("ad-f-tipoOcorrencia").value.trim(),
    canal: document.getElementById("ad-f-canal").value.trim(),
    observacoes: document.getElementById("ad-f-observacoes").value.trim(),
    ...adState.scores,
    ...adState.fgs,
  };

  if (!payload.conversationId || !payload.agente || !payload.tipoOcorrencia || !payload.canal) {
    errorBox.innerHTML = `<div class="ad-error-box">Preencha todos os campos obrigatórios.</div>`;
    return;
  }

  const btn = document.getElementById("ad-submit-btn");
  btn.disabled = true;
  btn.textContent = "Salvando...";

  try {
    const res = await fetch("/auditoria/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Erro desconhecido");

    adResetForm();
    await adLoadRecords();
  } catch (err) {
    errorBox.innerHTML = `<div class="ad-error-box">Erro ao salvar: ${err.message}. Verifique sua conexão.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Salvar Auditoria";
  }
});

function adResetForm() {
  document.getElementById("ad-audit-form").reset();
  AD_CRITERION_KEYS.forEach(k => (adState.scores[k] = 0));
  Object.keys(adState.fgs).forEach(k => (adState.fgs[k] = false));
  adBuildForm();
  adCheckDuplicateConversationId();
}

// ============================================================
// Carregar registros do hub
// ============================================================
async function adLoadRecords() {
  try {
    const res = await fetch("/auditoria/api/list");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    adState.records = json.data;
    adState.loaded = true;
    adPopulateFilterOptions();
    adRenderRegistro();
    adRenderDashboard();
    adRenderAgentesTabs();
    adCheckDuplicateConversationId();
  } catch (err) {
    console.error("Erro ao carregar auditorias:", err);
  }
}

// ============================================================
// Registro — filtros e tabela
// ============================================================
function adPopulateFilterOptions() {
  const uniq = (arr) => Array.from(new Set(arr)).sort();
  adFillSelect("ad-filter-agente", uniq(adState.records.map(r => r.Agente)), "Todos os agentes");
  adFillSelect("ad-filter-semana", uniq(adState.records.map(r => r.Semana)), "Todas as semanas");
  adFillSelect("ad-filter-tipo", uniq(adState.records.map(r => r.TipoOcorrencia)), "Todos os tipos");
  adFillSelect("ad-filter-canal", uniq(adState.records.map(r => r.Canal)), "Todos os canais");
}
function adFillSelect(id, values, placeholder) {
  const el = document.getElementById(id);
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option value="${v}">${v}</option>`).join("");
  el.value = current;
}

["ad-filter-agente", "ad-filter-semana", "ad-filter-tipo", "ad-filter-canal", "ad-filter-class"].forEach(id => {
  document.getElementById(id).addEventListener("change", adRenderRegistro);
});
document.getElementById("ad-filter-clear").addEventListener("click", () => {
  ["ad-filter-agente", "ad-filter-semana", "ad-filter-tipo", "ad-filter-canal", "ad-filter-class"].forEach(id => (document.getElementById(id).value = ""));
  adRenderRegistro();
});

function adGetFilteredRecords() {
  const agente = document.getElementById("ad-filter-agente").value;
  const semana = document.getElementById("ad-filter-semana").value;
  const tipo = document.getElementById("ad-filter-tipo").value;
  const canal = document.getElementById("ad-filter-canal").value;
  const classe = document.getElementById("ad-filter-class").value;
  return adState.records.filter(r =>
    (!agente || r.Agente === agente) &&
    (!semana || r.Semana === semana) &&
    (!tipo || r.TipoOcorrencia === tipo) &&
    (!canal || r.Canal === canal) &&
    (!classe || r.Classificacao === classe)
  ).sort((a, b) => new Date(b.Data) - new Date(a.Data));
}

function adFmtDate(v) {
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function adRenderRegistro() {
  const rows = adGetFilteredRecords();
  document.getElementById("ad-registro-count").textContent = `${rows.length} auditorias encontradas`;
  const tbody = document.getElementById("ad-registro-tbody");
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="ad-empty">Nenhuma auditoria encontrada.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${adFmtDate(r.Data)}</td>
      <td style="color:var(--text-hint)">${r.Semana}</td>
      <td style="font-weight:500">${r.Agente}</td>
      <td>${r.TipoOcorrencia}</td>
      <td>${r.Canal}</td>
      <td>${r.S1}</td><td>${r.S2}</td><td>${r.S3}</td>
      <td style="font-weight:600">${r.Total}</td>
      <td><span class="ad-badge ad-badge-${r.Classificacao}">${r.Classificacao}</span></td>
      <td style="color:var(--text-hint)">${r.AuditadoPor}</td>
      <td style="color:var(--text-hint)">${r.ConversationId}</td>
    </tr>
  `).join("");
}

document.getElementById("ad-export-csv-btn").addEventListener("click", () => {
  const rows = adGetFilteredRecords();
  const header = ["Data","Semana","Agente","Tipo de Ocorrência","Canal","S1","S2","S3","Total","Classificação","Falha Grave","Auditor","ID Conversa","Observações"];
  const esc = (v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const lines = [header.join(",")];
  rows.forEach(r => {
    lines.push([adFmtDate(r.Data), r.Semana, r.Agente, r.TipoOcorrencia, r.Canal, r.S1, r.S2, r.S3, r.Total, r.Classificacao, r.FalhaGrave, r.AuditadoPor, r.ConversationId, r.Observacoes].map(esc).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `auditorias-${Date.now()}.csv`;
  a.click();
});

// ============================================================
// Dashboard
// ============================================================
let adCharts = {};
let adSectionAvgData = []; // guardado pra reaproveitar no export CSV, sem recalcular

// Agrupa por agente e calcula a média (não a soma) de cada seção — usado no
// dashboard (todos os agentes) e no detalhe individual (um agente só, com
// "records" já filtrado antes de chamar).
function adComputeSectionAveragesByAgent(records) {
  const byAgent = new Map();
  records.forEach(r => {
    const cur = byAgent.get(r.Agente) || { count: 0, sumS1: 0, sumS2: 0, sumS3: 0, sumTotal: 0 };
    cur.count += 1;
    cur.sumS1 += Number(r.S1) || 0;
    cur.sumS2 += Number(r.S2) || 0;
    cur.sumS3 += Number(r.S3) || 0;
    cur.sumTotal += Number(r.Total) || 0;
    byAgent.set(r.Agente, cur);
  });
  return Array.from(byAgent.entries())
    .map(([agent, v]) => ({
      agent,
      count: v.count,
      avgS1: v.sumS1 / v.count,
      avgS2: v.sumS2 / v.count,
      avgS3: v.sumS3 / v.count,
      avgTotal: v.sumTotal / v.count,
    }))
    .sort((a, b) => b.avgTotal - a.avgTotal);
}

const adRound1 = (n) => Math.round(n * 10) / 10;

// Tabela + gráfico de "média por seção, por agente" no dashboard — usa %
// do máximo de cada seção no gráfico (S1/25, S2/40, S3/35 têm pesos
// diferentes; comparar em pontos crus faria a seção de maior peso parecer
// sempre "melhor" sem ser, de fato, o ponto fraco do agente).
function adRenderSectionAverages(records) {
  adSectionAvgData = adComputeSectionAveragesByAgent(records);

  const tbody = document.getElementById("ad-section-avg-tbody");
  tbody.innerHTML = adSectionAvgData.length === 0
    ? `<tr><td colspan="6" class="ad-empty">Nenhuma auditoria registrada ainda.</td></tr>`
    : adSectionAvgData.map(d => `
      <tr>
        <td style="font-weight:500">${d.agent}</td>
        <td>${d.count}</td>
        <td>${adRound1(d.avgS1)}/${AD_SECTION_META[0].max}</td>
        <td>${adRound1(d.avgS2)}/${AD_SECTION_META[1].max}</td>
        <td>${adRound1(d.avgS3)}/${AD_SECTION_META[2].max}</td>
        <td style="font-weight:600">${adRound1(d.avgTotal)}/100</td>
      </tr>
    `).join("");

  // Não precisa destruir adCharts.sectionAvg aqui — adDrawCharts() já
  // destrói TODOS os charts guardados em adCharts (inclusive este, de um
  // render anterior) antes desta função ser chamada, na mesma passada de
  // adRenderDashboard(). Destruir de novo aqui destruiria duas vezes a
  // mesma instância.
  const c = adGetChartColors();
  adCharts.sectionAvg = new Chart(document.getElementById("ad-chart-section-avg"), {
    type: "bar",
    data: {
      labels: adSectionAvgData.map(d => d.agent),
      datasets: [
        { label: AD_SECTION_META[0].label, data: adSectionAvgData.map(d => adRound1(d.avgS1 / AD_SECTION_META[0].max * 100)), backgroundColor: "#F2B90C", borderRadius: 4 },
        { label: AD_SECTION_META[1].label, data: adSectionAvgData.map(d => adRound1(d.avgS2 / AD_SECTION_META[1].max * 100)), backgroundColor: "#3B82F6", borderRadius: 4 },
        { label: AD_SECTION_META[2].label, data: adSectionAvgData.map(d => adRound1(d.avgS3 / AD_SECTION_META[2].max * 100)), backgroundColor: "#EF4444", borderRadius: 4 },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: c.textMuted } } },
      scales: {
        x: { ticks: { color: c.textMuted }, grid: { color: c.border } },
        y: { min: 0, max: 100, ticks: { color: c.textMuted }, grid: { color: c.border } },
      },
    },
  });
}

document.getElementById("ad-export-section-avg-btn").addEventListener("click", () => {
  const esc = (v) => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const header = ["Agente", "Nº Auditorias", `Média ${AD_SECTION_META[0].label} (S1)`, `Média ${AD_SECTION_META[1].label} (S2)`, `Média ${AD_SECTION_META[2].label} (S3)`, "Média Total"];
  const lines = [header.join(",")];
  adSectionAvgData.forEach(d => {
    lines.push([d.agent, d.count, adRound1(d.avgS1), adRound1(d.avgS2), adRound1(d.avgS3), adRound1(d.avgTotal)].map(esc).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `auditoria-media-por-secao-${Date.now()}.csv`;
  a.click();
});

function adRenderDashboard() {
  const records = adState.records;
  const total = records.length;
  const avgTotal = total ? Math.round((records.reduce((s, r) => s + Number(r.Total), 0) / total) * 10) / 10 : 0;
  const criticalRecords = records.filter(r => r.FalhaGrave === "Sim");
  const criticalCount = criticalRecords.length;

  const byAgent = new Map();
  records.forEach(r => {
    const cur = byAgent.get(r.Agente) || { sum: 0, count: 0, critical: 0 };
    cur.sum += Number(r.Total); cur.count += 1;
    if (r.FalhaGrave === "Sim") cur.critical += 1;
    byAgent.set(r.Agente, cur);
  });
  const avgScoreByAgent = Array.from(byAgent.entries()).map(([agent, v]) => ({ agent, avgScore: Math.round((v.sum / v.count) * 10) / 10 })).sort((a, b) => b.avgScore - a.avgScore);
  const criticalRanking = Array.from(byAgent.entries()).map(([agent, v]) => ({ agent, count: v.critical })).filter(v => v.count > 0).sort((a, b) => b.count - a.count);

  const byWeek = new Map();
  records.forEach(r => {
    const cur = byWeek.get(r.Semana) || { sum: 0, count: 0, first: new Date(r.Data).getTime() };
    cur.sum += Number(r.Total); cur.count += 1;
    cur.first = Math.min(cur.first, new Date(r.Data).getTime());
    byWeek.set(r.Semana, cur);
  });
  const weeklyEvolution = Array.from(byWeek.entries()).map(([week, v]) => ({ week, avgScore: Math.round((v.sum / v.count) * 10) / 10, count: v.count, first: v.first })).sort((a, b) => a.first - b.first);

  const byOccurrence = new Map();
  records.forEach(r => byOccurrence.set(r.TipoOcorrencia, (byOccurrence.get(r.TipoOcorrencia) || 0) + 1));
  const occurrenceDist = Array.from(byOccurrence.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);

  const alertBox = document.getElementById("ad-dash-alert");
  if (criticalCount > 0) {
    const recent = [...criticalRecords].sort((a, b) => new Date(b.Data) - new Date(a.Data)).slice(0, 5);
    alertBox.innerHTML = `<div class="ad-alert"><p class="title">⚠ Falhas graves recentes (${criticalCount} no total)</p>${recent.map(r => `<div class="ad-alert-item"><span><b>${r.Agente}</b> · ${r.TipoOcorrencia} · ${adFmtDate(r.Data)}</span></div>`).join("")}</div>`;
  } else {
    alertBox.innerHTML = "";
  }

  document.getElementById("ad-dash-kpis").innerHTML = `
    <div class="ad-kpi"><p class="label">Total de auditorias</p><p class="value">${total}</p></div>
    <div class="ad-kpi"><p class="label">Score médio</p><p class="value">${avgTotal}</p></div>
    <div class="ad-kpi"><p class="label">Agentes avaliados</p><p class="value">${byAgent.size}</p></div>
    <div class="ad-kpi danger"><p class="label">Falhas graves</p><p class="value" style="color:var(--bad-text, var(--bad))">${criticalCount}</p></div>
  `;

  const weekBox = document.getElementById("ad-dash-week-compare");
  const current = weeklyEvolution[weeklyEvolution.length - 1];
  const previous = weeklyEvolution[weeklyEvolution.length - 2];
  if (current && previous) {
    const scoreDelta = Math.round((current.avgScore - previous.avgScore) * 10) / 10;
    const countDelta = current.count - previous.count;
    weekBox.style.display = "flex";
    weekBox.style.flexWrap = "wrap";
    weekBox.style.gap = "24px";
    weekBox.innerHTML = `
      <div><p style="font-size:12px;color:var(--text-muted);margin:0;">Semana atual</p><p style="font-weight:500;margin:2px 0 0;">${current.week}</p></div>
      <div><p style="font-size:12px;color:var(--text-muted);margin:0;">Score médio</p><p style="font-weight:600;margin:2px 0 0;">${current.avgScore} <span style="color:${scoreDelta >= 0 ? "var(--ok-text, var(--ok))" : "var(--bad-text, var(--bad))"};font-size:13px;">(${scoreDelta >= 0 ? "▲" : "▼"} ${Math.abs(scoreDelta)} vs semana anterior)</span></p></div>
      <div><p style="font-size:12px;color:var(--text-muted);margin:0;">Auditorias na semana</p><p style="font-weight:600;margin:2px 0 0;">${current.count} <span style="color:${countDelta >= 0 ? "var(--ok-text, var(--ok))" : "var(--bad-text, var(--bad))"};font-size:13px;">(${countDelta >= 0 ? "+" : ""}${countDelta} vs semana anterior)</span></p></div>
    `;
  } else {
    weekBox.style.display = "none";
  }

  adDrawCharts(avgScoreByAgent, weeklyEvolution, occurrenceDist, criticalRanking);
  adRenderSectionAverages(records);
}

function adGetChartColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    gold: cs.getPropertyValue("--gold").trim() || "#F5B800",
    bad: cs.getPropertyValue("--bad").trim() || "#F0554F",
    textMuted: cs.getPropertyValue("--text-muted").trim() || "#9A9994",
    border: cs.getPropertyValue("--border").trim() || "rgba(255,255,255,0.08)",
  };
}

function adDrawCharts(avgScoreByAgent, weeklyEvolution, occurrenceDist, criticalRanking) {
  const c = adGetChartColors();
  const commonOpts = {
    plugins: { legend: { labels: { color: c.textMuted } } },
    scales: {
      x: { ticks: { color: c.textMuted }, grid: { color: c.border } },
      y: { ticks: { color: c.textMuted }, grid: { color: c.border } },
    },
  };

  Object.values(adCharts).forEach(chart => chart && chart.destroy());

  adCharts.agent = new Chart(document.getElementById("ad-chart-agent"), {
    type: "bar",
    data: { labels: avgScoreByAgent.map(a => a.agent), datasets: [{ label: "Score médio", data: avgScoreByAgent.map(a => a.avgScore), backgroundColor: c.gold, borderRadius: 6 }] },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, min: 0, max: 100 } }, plugins: { legend: { display: false } } },
  });

  adCharts.week = new Chart(document.getElementById("ad-chart-week"), {
    type: "line",
    data: { labels: weeklyEvolution.map(w => w.week), datasets: [{ label: "Score médio", data: weeklyEvolution.map(w => w.avgScore), borderColor: c.gold, backgroundColor: c.gold, tension: 0.3, pointRadius: 4 }] },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, min: 0, max: 100 } }, plugins: { legend: { display: false } } },
  });

  adCharts.occurrence = new Chart(document.getElementById("ad-chart-occurrence"), {
    type: "pie",
    data: { labels: occurrenceDist.map(o => o.type), datasets: [{ data: occurrenceDist.map(o => o.count), backgroundColor: ["#F2B90C","#e5e5e5","#8a8a8a","#d97706","#737373","#f97316","#525252","#fbbf24","#a3a3a3"] }] },
    options: { plugins: { legend: { position: "right", labels: { color: c.textMuted, boxWidth: 12, font: { size: 11 } } } } },
  });

  adCharts.critical = new Chart(document.getElementById("ad-chart-critical"), {
    type: "bar",
    data: { labels: criticalRanking.map(cr => cr.agent), datasets: [{ label: "Falhas graves", data: criticalRanking.map(cr => cr.count), backgroundColor: c.bad, borderRadius: 6 }] },
    options: { ...commonOpts, indexAxis: "y", plugins: { legend: { display: false } }, scales: { ...commonOpts.scales, x: { ...commonOpts.scales.x, ticks: { ...commonOpts.scales.x.ticks, precision: 0 } } } },
  });
}

// ============================================================
// Agentes — desempenho individual
// ============================================================
function adRenderAgentesTabs() {
  const tabsEl = document.getElementById("ad-agent-tabs");
  const agentsWithData = adState.records.map(r => r.Agente);
  const allAgents = Array.from(new Set([...AD_AGENT_SUGGESTIONS, ...agentsWithData])).sort();

  if (!adState.selectedAgent && allAgents.length) adState.selectedAgent = allAgents[0];

  tabsEl.innerHTML = allAgents.map(a => `<button class="ad-agent-tab${a === adState.selectedAgent ? " selected" : ""}" data-agent="${a}">${a}</button>`).join("");
  tabsEl.querySelectorAll(".ad-agent-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      adState.selectedAgent = btn.dataset.agent;
      tabsEl.querySelectorAll(".ad-agent-tab").forEach(b => b.classList.toggle("selected", b === btn));
      adRenderAgentDetail();
    });
  });

  adRenderAgentDetail();
}

let adAgentChart = null;
function adRenderAgentDetail() {
  const container = document.getElementById("ad-agent-detail");
  if (!adState.selectedAgent) {
    container.innerHTML = `<p class="ad-empty">Nenhum agente selecionado.</p>`;
    return;
  }

  const records = adState.records.filter(r => r.Agente === adState.selectedAgent).sort((a, b) => new Date(b.Data) - new Date(a.Data));
  const total = records.length;
  const avgTotal = total ? Math.round((records.reduce((s, r) => s + Number(r.Total), 0) / total) * 10) / 10 : 0;
  const criticalCount = records.filter(r => r.FalhaGrave === "Sim").length;
  const avgS1 = total ? records.reduce((s, r) => s + (Number(r.S1) || 0), 0) / total : 0;
  const avgS2 = total ? records.reduce((s, r) => s + (Number(r.S2) || 0), 0) / total : 0;
  const avgS3 = total ? records.reduce((s, r) => s + (Number(r.S3) || 0), 0) / total : 0;

  container.innerHTML = `
    <div class="ad-kpis">
      <div class="ad-kpi"><p class="label">Total de auditorias</p><p class="value">${total}</p></div>
      <div class="ad-kpi"><p class="label">Score médio</p><p class="value">${avgTotal}</p></div>
      <div class="ad-kpi danger"><p class="label">Falhas graves</p><p class="value" style="color:var(--bad-text, var(--bad))">${criticalCount}</p></div>
    </div>
    <div class="ad-kpis">
      <div class="ad-kpi"><p class="label">${AD_SECTION_META[0].label} (méd)</p><p class="value">${adRound1(avgS1)}/${AD_SECTION_META[0].max}</p></div>
      <div class="ad-kpi"><p class="label">${AD_SECTION_META[1].label} (méd)</p><p class="value">${adRound1(avgS2)}/${AD_SECTION_META[1].max}</p></div>
      <div class="ad-kpi"><p class="label">${AD_SECTION_META[2].label} (méd)</p><p class="value">${adRound1(avgS3)}/${AD_SECTION_META[2].max}</p></div>
    </div>
    <div class="ad-card ad-chart-card"><h3>Evolução do score · ${adState.selectedAgent}</h3><div class="ad-chart-wrap"><canvas id="ad-chart-agent-detail"></canvas></div></div>
    <div class="ad-card ad-table-wrap" style="padding:0;">
      <table>
        <thead><tr><th>Data</th><th>Tipo de Ocorrência</th><th>Canal</th><th>Total</th><th>Classificação</th><th>ID Conversa</th></tr></thead>
        <tbody>
          ${total === 0
            ? `<tr><td colspan="6" class="ad-empty">Nenhuma auditoria para este agente ainda.</td></tr>`
            : records.map(r => `
              <tr>
                <td>${adFmtDate(r.Data)}</td>
                <td>${r.TipoOcorrencia}</td>
                <td>${r.Canal}</td>
                <td style="font-weight:600">${r.Total}</td>
                <td><span class="ad-badge ad-badge-${r.Classificacao}">${r.Classificacao}</span></td>
                <td style="color:var(--text-hint)">${r.ConversationId}</td>
              </tr>
            `).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (adAgentChart) { adAgentChart.destroy(); adAgentChart = null; }
  const chrono = [...records].sort((a, b) => new Date(a.Data) - new Date(b.Data));
  if (chrono.length) {
    const c = adGetChartColors();
    adAgentChart = new Chart(document.getElementById("ad-chart-agent-detail"), {
      type: "line",
      data: {
        labels: chrono.map(r => adFmtDate(r.Data)),
        datasets: [{ label: "Score", data: chrono.map(r => Number(r.Total)), borderColor: c.gold, backgroundColor: c.gold, tension: 0.3, pointRadius: 4 }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: c.textMuted }, grid: { color: c.border } },
          y: { min: 0, max: 100, ticks: { color: c.textMuted }, grid: { color: c.border } },
        },
      },
    });
  }
}

// ============================================================
// Início
// ============================================================
adBuildForm();
adLoadRecords();
