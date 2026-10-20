// Página externa de cotação: alterna entre as abas Correios e Azul (cada aba tem o seu formulário e o seu resultado).
(function () {
  'use strict';
  const abas = Array.from(document.querySelectorAll('.ct-aba'));
  if (!abas.length) return;

  function abrir(aba) {
    abas.forEach((a) => {
      const ativa = a === aba;
      a.classList.toggle('ativa', ativa);
      a.setAttribute('aria-selected', ativa ? 'true' : 'false');
      document.getElementById(a.dataset.alvo).hidden = !ativa;
    });
    try { history.replaceState(null, '', '#' + aba.dataset.alvo.replace('painel', '').toLowerCase()); } catch (e) { /* sem histórico: ignora */ }
  }

  abas.forEach((a) => a.addEventListener('click', () => abrir(a)));

  const inicial = { '#azul': 'abaAzul', '#correios': 'abaCorreios' }[location.hash];
  if (inicial) abrir(document.getElementById(inicial));
})();
