/**
 * Landing page: menu mobile + validação e envio do formulário.
 * Os dados são enviados para uma planilha do Google Sheets via Apps Script.
 */
(function () {
  "use strict";

  const CONFIG = window.APP_CONFIG || {};

  const MENSAGENS = {
    obrigatorio: "Este campo é obrigatório.",
    nomeCurto: "Informe pelo menos 2 caracteres.",
    emailInvalido: "Informe um e-mail válido.",
    consentimento: "É preciso concordar para continuar.",
    sucesso: "Obrigado! Recebemos sua mensagem e entraremos em contato em breve.",
    erro: "Não foi possível enviar agora. Tente novamente em alguns instantes.",
    naoConfigurado: "Formulário ainda não configurado (veja js/config.js)."
  };

  /* ---------- Menu mobile ---------- */
  function iniciarMenu() {
    const botao = document.querySelector(".header__toggle");
    const menu = document.getElementById("menu");
    if (!botao || !menu) return;

    const fechar = () => {
      botao.setAttribute("aria-expanded", "false");
      menu.classList.remove("is-open");
    };

    botao.addEventListener("click", () => {
      const aberto = botao.getAttribute("aria-expanded") === "true";
      botao.setAttribute("aria-expanded", String(!aberto));
      menu.classList.toggle("is-open", !aberto);
    });

    menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", fechar));
  }

  /* ---------- Validação ---------- */
  const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validarCampo(campo) {
    const valor = campo.type === "checkbox" ? campo.checked : campo.value.trim();

    if (campo.type === "checkbox") return valor ? "" : MENSAGENS.consentimento;
    if (!valor) return MENSAGENS.obrigatorio;
    if (campo.name === "nome" && valor.length < 2) return MENSAGENS.nomeCurto;
    if (campo.type === "email" && !REGEX_EMAIL.test(valor)) return MENSAGENS.emailInvalido;
    return "";
  }

  function mostrarErro(campo, mensagem) {
    const grupo = campo.closest(".form__group");
    if (!grupo) return;
    grupo.classList.toggle("is-invalid", Boolean(mensagem));
    const alvo = grupo.querySelector(".form__error");
    if (alvo) alvo.textContent = mensagem;
    campo.setAttribute("aria-invalid", mensagem ? "true" : "false");
  }

  function validarFormulario(form) {
    let primeiroInvalido = null;
    form.querySelectorAll("[required]").forEach((campo) => {
      const erro = validarCampo(campo);
      mostrarErro(campo, erro);
      if (erro && !primeiroInvalido) primeiroInvalido = campo;
    });
    if (primeiroInvalido) primeiroInvalido.focus();
    return !primeiroInvalido;
  }

  /* ---------- Envio ---------- */
  function coletarDados(form) {
    const dados = new FormData(form);
    return {
      nome: String(dados.get("nome") || "").trim(),
      email: String(dados.get("email") || "").trim().toLowerCase(),
      empresa: String(dados.get("empresa") || "").trim(),
      consentimento: dados.get("consentimento") ? "Sim" : "Não",
      website: String(dados.get("website") || ""), // honeypot
      pagina: window.location.href,
      origem: document.referrer || "direto"
    };
  }

  // Modo diagnóstico: abra a página com ?debug no fim do endereço
  const MODO_DEBUG = new URLSearchParams(window.location.search).has("debug");

  async function enviarDados(dados) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), CONFIG.TIMEOUT_MS || 30000);

    try {
      // O Apps Script grava os dados, mas nem sempre devolve a resposta com
      // permissão de leitura para outros sites (CORS). Por isso o envio normal
      // usa "no-cors": os dados chegam à planilha e o navegador não bloqueia.
      // Falhas de rede (sem internet, endereço errado) continuam gerando erro.
      if (!MODO_DEBUG) {
        await fetch(CONFIG.ENDPOINT_URL, {
          method: "POST",
          mode: "no-cors",
          body: new URLSearchParams(dados),
          signal: controle.signal
        });
        return { ok: true };
      }

      // Modo diagnóstico: lê a resposta da planilha para mostrar o motivo de um erro
      const resposta = await fetch(CONFIG.ENDPOINT_URL, {
        method: "POST",
        body: new URLSearchParams(dados),
        signal: controle.signal
      });
      const texto = await resposta.text();
      let json;
      try {
        json = JSON.parse(texto);
      } catch (e) {
        const resumo = texto.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        throw new Error(`Resposta inesperada (HTTP ${resposta.status}): ${resumo}`);
      }
      if (!json.ok) throw new Error(json.erro || "Erro no servidor");
      return json;
    } catch (erro) {
      if (erro.name === "AbortError") throw new Error("Tempo esgotado esperando a planilha responder");
      throw erro;
    } finally {
      clearTimeout(timer);
    }
  }

  function definirStatus(el, texto, tipo) {
    el.textContent = texto;
    el.classList.remove("is-success", "is-error");
    if (tipo) el.classList.add(`is-${tipo}`);
  }

  function iniciarFormulario() {
    const form = document.getElementById("contact-form");
    if (!form) return;

    const botao = form.querySelector(".btn");
    const status = form.querySelector(".form__status");

    // Valida ao sair do campo e limpa o erro enquanto digita
    form.querySelectorAll("[required]").forEach((campo) => {
      campo.addEventListener("blur", () => mostrarErro(campo, validarCampo(campo)));
      campo.addEventListener("input", () => {
        if (campo.closest(".is-invalid")) mostrarErro(campo, validarCampo(campo));
      });
      campo.addEventListener("change", () => mostrarErro(campo, validarCampo(campo)));
    });

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      definirStatus(status, "");

      if (!validarFormulario(form)) return;

      const dados = coletarDados(form);

      // Robô preencheu o campo invisível: finge sucesso e não envia nada
      if (dados.website) {
        definirStatus(status, MENSAGENS.sucesso, "success");
        form.reset();
        return;
      }

      if (!CONFIG.ENDPOINT_URL || CONFIG.ENDPOINT_URL.startsWith("COLE_AQUI")) {
        definirStatus(status, MENSAGENS.naoConfigurado, "error");
        return;
      }

      botao.disabled = true;
      botao.classList.add("is-loading");

      try {
        await enviarDados(dados);
        definirStatus(status, MENSAGENS.sucesso, "success");
        form.reset();
      } catch (erro) {
        console.error("Falha no envio:", erro);
        const detalhe = MODO_DEBUG ? ` [${erro.message}]` : "";
        definirStatus(status, MENSAGENS.erro + detalhe, "error");
      } finally {
        botao.disabled = false;
        botao.classList.remove("is-loading");
      }
    });
  }

  /* ---------- Marca (nome e logo vindos do config.js) ---------- */
  function aplicarMarca() {
    const marca = CONFIG.MARCA;
    if (!marca) return;
    document.querySelectorAll("[data-marca]").forEach((el) => (el.textContent = marca));
    document.title = `${marca} | Entre em contato`;

    if (CONFIG.LOGO) {
      const link = document.querySelector(".header__logo");
      const img = new Image();
      img.src = CONFIG.LOGO;
      img.alt = marca;
      img.onload = () => link.replaceChildren(img);
    }
  }

  /* ---------- Inicialização ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const ano = document.getElementById("ano");
    if (ano) ano.textContent = new Date().getFullYear();
    aplicarMarca();
    iniciarMenu();
    iniciarFormulario();
  });
})();
