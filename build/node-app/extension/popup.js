"use strict";
(() => {
  // src/extension/server-config.ts
  var DEFAULT_SERVER_URL = "http://127.0.0.1:18081";
  var STORAGE_DEFAULTS = {
    autoCheck: true,
    serverUrl: DEFAULT_SERVER_URL
  };
  var cachedServerUrl = null;
  function hasLiveExtensionContext() {
    try {
      return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }
  async function readPackagedServerUrl() {
    if (!hasLiveExtensionContext()) {
      return DEFAULT_SERVER_URL;
    }
    try {
      const response = await fetch(chrome.runtime.getURL("server-config.json"), { cache: "no-store" });
      if (!response.ok) {
        return DEFAULT_SERVER_URL;
      }
      const config = await response.json();
      if (typeof config.serverUrl === "string" && config.serverUrl.trim()) {
        return config.serverUrl.trim();
      }
    } catch {
    }
    return DEFAULT_SERVER_URL;
  }
  async function syncStoredServerUrl(serverUrl) {
    if (!hasLiveExtensionContext()) {
      return;
    }
    try {
      await chrome.storage.local.set({ serverUrl });
    } catch {
    }
  }
  async function getServerUrl() {
    if (cachedServerUrl) {
      return cachedServerUrl;
    }
    const packagedServerUrl = await readPackagedServerUrl();
    cachedServerUrl = packagedServerUrl;
    if (!hasLiveExtensionContext()) {
      return packagedServerUrl;
    }
    await syncStoredServerUrl(packagedServerUrl);
    return packagedServerUrl;
  }
  async function getSettings() {
    const packagedServerUrl = await readPackagedServerUrl();
    if (!hasLiveExtensionContext()) {
      return {
        autoCheck: STORAGE_DEFAULTS.autoCheck,
        serverUrl: packagedServerUrl
      };
    }
    try {
      const stored = await chrome.storage.local.get({ autoCheck: STORAGE_DEFAULTS.autoCheck });
      await syncStoredServerUrl(packagedServerUrl);
      return {
        autoCheck: stored.autoCheck !== false,
        serverUrl: packagedServerUrl
      };
    } catch {
      return {
        autoCheck: STORAGE_DEFAULTS.autoCheck,
        serverUrl: packagedServerUrl
      };
    }
  }
  async function saveSettings(settings) {
    const serverUrl = settings.serverUrl?.trim() || await readPackagedServerUrl();
    cachedServerUrl = serverUrl;
    if (!hasLiveExtensionContext()) {
      return;
    }
    try {
      await chrome.storage.local.set({
        autoCheck: settings.autoCheck,
        serverUrl
      });
    } catch {
    }
  }

  // src/extension/popup.ts
  var autoCheckInput = document.getElementById("autoCheck");
  var saveButton = document.getElementById("saveButton");
  var testButton = document.getElementById("testButton");
  var grantAllAccessButton = document.getElementById("grantAllAccessButton");
  var grantAccessButton = document.getElementById("grantAccessButton");
  var retryAccessButton = document.getElementById("retryAccessButton");
  var activateButton = document.getElementById("activateButton");
  var status = document.getElementById("status");
  var serverUrlLabel = document.getElementById("serverUrl");
  var currentSiteLabel = document.getElementById("currentSite");
  var sitePermissionLabel = document.getElementById("sitePermission");
  var globalPermissionLabel = document.getElementById("globalPermission");
  var permissionHeadline = document.getElementById("permissionHeadline");
  var permissionHelp = document.getElementById("permissionHelp");
  var analyzeNowButton = document.getElementById("analyzeNowButton");
  var applyAllButton = document.getElementById("applyAllButton");
  var refreshStateButton = document.getElementById("refreshStateButton");
  var liveBadge = document.getElementById("liveBadge");
  var liveStatus = document.getElementById("liveStatus");
  var liveResults = document.getElementById("liveResults");
  function setStatus(message, tone = "") {
    if (!status) {
      return;
    }
    status.textContent = message;
    status.className = `status${tone ? ` ${tone}` : ""}`;
  }
  function renderLiveState(state) {
    if (liveResults) {
      liveResults.innerHTML = "";
    }
    if (!state) {
      if (liveBadge) {
        liveBadge.textContent = "Sem dados";
      }
      if (liveStatus) {
        liveStatus.textContent = "Abra um site liberado e foque em um campo de texto.";
        liveStatus.className = "status live-status";
      }
      return;
    }
    if (liveBadge) {
      liveBadge.textContent = state.hasActiveElement ? state.totalMatches > 0 ? state.hiddenWeakMatches ? `${state.totalMatches} ajuste(s), ${state.hiddenWeakMatches} oculto(s)` : `${state.totalMatches} ajuste(s)` : state.hiddenWeakMatches ? `0 ajuste, ${state.hiddenWeakMatches} oculto(s)` : "Sem ajustes" : "Sem foco";
    }
    if (liveStatus) {
      liveStatus.textContent = state.status;
      liveStatus.className = `status live-status${state.tone ? ` ${state.tone}` : ""}`;
    }
    if (!liveResults) {
      return;
    }
    if (!state.results.length) {
      const empty = document.createElement("div");
      empty.className = "live-card";
      empty.textContent = state.hasActiveElement ? "Nenhum problema encontrado nesse texto." : "Foque em um campo de texto para o Corrija-me PT-BR acompanhar o que voce esta escrevendo.";
      liveResults.appendChild(empty);
      return;
    }
    state.results.forEach((result, index) => {
      const card = document.createElement("article");
      card.className = "live-card";
      const title = document.createElement("div");
      title.className = "live-card-title";
      title.textContent = result.message;
      card.appendChild(title);
      const excerpt = document.createElement("div");
      excerpt.className = "live-card-excerpt";
      excerpt.textContent = result.excerpt;
      card.appendChild(excerpt);
      if (result.replacements.length) {
        const actions = document.createElement("div");
        actions.className = "live-card-actions";
        result.replacements.forEach((replacement) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "live-chip";
          button.textContent = replacement;
          button.addEventListener("click", () => void applySingleReplacement(index, replacement));
          actions.appendChild(button);
        });
        card.appendChild(actions);
      }
      liveResults.appendChild(card);
    });
  }
  async function persistSettings() {
    if (!autoCheckInput) {
      return;
    }
    const currentServerUrl = await getServerUrl();
    await saveSettings({ autoCheck: autoCheckInput.checked, serverUrl: currentServerUrl });
    setStatus("Preferencias locais salvas.", "ok");
  }
  async function getActiveTabContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      return null;
    }
    try {
      const url = new URL(tab.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return {
          id: tab.id,
          url: tab.url,
          originPattern: null
        };
      }
      return {
        id: tab.id,
        url: tab.url,
        originPattern: `${url.origin}/*`
      };
    } catch {
      return {
        id: tab.id,
        url: tab.url,
        originPattern: null
      };
    }
  }
  async function sendToActiveTab(message) {
    const context = await getActiveTabContext();
    if (!context?.id) {
      return null;
    }
    try {
      return await chrome.tabs.sendMessage(context.id, message);
    } catch {
      return null;
    }
  }
  async function ensureContentScriptActive() {
    const context = await getActiveTabContext();
    if (!context?.id || !context.originPattern) {
      return false;
    }
    const hasGlobalAccess = await chrome.permissions.contains({
      origins: ["http://*/*", "https://*/*"]
    });
    const granted = hasGlobalAccess || await chrome.permissions.contains({ origins: [context.originPattern] });
    if (!granted) {
      return false;
    }
    const response = await chrome.runtime.sendMessage({
      type: "corrija-me-pt-br:inject-tab",
      tabId: context.id
    });
    return response?.ok === true;
  }
  async function refreshLiveState() {
    let response = await sendToActiveTab({ type: "corrija-me-pt-br:get-state" });
    if (!response) {
      const reinjected = await ensureContentScriptActive();
      if (reinjected) {
        response = await sendToActiveTab({ type: "corrija-me-pt-br:get-state" });
      }
    }
    renderLiveState(response?.state ?? null);
  }
  async function refreshSiteAccessUi() {
    const context = await getActiveTabContext();
    const hasGlobalAccess = await chrome.permissions.contains({
      origins: ["http://*/*", "https://*/*"]
    });
    if (globalPermissionLabel) {
      globalPermissionLabel.value = hasGlobalAccess ? "Liberado em todos os sites" : "Ainda nao liberado";
    }
    grantAllAccessButton?.toggleAttribute("disabled", hasGlobalAccess);
    retryAccessButton?.removeAttribute("disabled");
    if (!context) {
      if (currentSiteLabel) {
        currentSiteLabel.value = "Nao foi possivel detectar a aba atual";
      }
      if (sitePermissionLabel) {
        sitePermissionLabel.value = "Indisponivel";
      }
      grantAccessButton?.setAttribute("disabled", "true");
      activateButton?.setAttribute("disabled", "true");
      return null;
    }
    if (currentSiteLabel) {
      currentSiteLabel.value = context.url;
    }
    if (!context.originPattern) {
      if (sitePermissionLabel) {
        sitePermissionLabel.value = "Este tipo de pagina nao aceita permissao";
      }
      if (permissionHeadline) {
        permissionHeadline.innerHTML = "Para a extensao <strong>corrija_me_pt_br</strong> ajudar voce, e necessario abrir uma pagina comum da web.";
      }
      if (permissionHelp) {
        permissionHelp.textContent = "O Corrija-me PT-BR so pode ser liberado em paginas http ou https.";
      }
      grantAccessButton?.setAttribute("disabled", "true");
      activateButton?.setAttribute("disabled", "true");
      return context;
    }
    const granted = await chrome.permissions.contains({ origins: [context.originPattern] });
    if (permissionHeadline) {
      permissionHeadline.innerHTML = hasGlobalAccess || granted ? "A extensao <strong>corrija_me_pt_br</strong> ja saiu da instalacao com acesso suficiente para ajudar voce nesta pagina." : "Para a extensao <strong>corrija_me_pt_br</strong> ajudar voce, e necessario liberar o acesso.";
    }
    if (sitePermissionLabel) {
      sitePermissionLabel.value = hasGlobalAccess ? "Coberto pelo acesso global" : granted ? "Liberado neste site" : "Ainda nao liberado";
    }
    if (permissionHelp) {
      permissionHelp.textContent = hasGlobalAccess ? "O Corrija-me PT-BR ja esta liberado para todos os sites. Esse acesso passa a ser solicitado logo na instalacao para evitar confusao durante o uso." : granted ? "Este site ja foi liberado por voce. O acesso vale apenas para este endereco." : "Se voce quiser uma experiencia sem interrupcoes, use 'Liberar em todos os sites'. Se preferir mais controle, use 'Liberar neste site'.";
    }
    grantAccessButton?.toggleAttribute("disabled", granted || hasGlobalAccess);
    activateButton?.toggleAttribute("disabled", !(granted || hasGlobalAccess));
    retryAccessButton?.toggleAttribute("disabled", hasGlobalAccess || granted);
    return context;
  }
  async function grantAllSitesAccess() {
    const granted = await chrome.permissions.request({
      origins: ["http://*/*", "https://*/*"]
    });
    if (!granted) {
      setStatus("Acesso global negado. Voce ainda pode liberar apenas sites especificos.", "error");
      await refreshSiteAccessUi();
      return;
    }
    const context = await getActiveTabContext();
    if (context) {
      await chrome.runtime.sendMessage({
        type: "corrija-me-pt-br:inject-tab",
        tabId: context.id
      });
    }
    await refreshSiteAccessUi();
    await refreshLiveState();
    setStatus("Acesso liberado para todos os sites.", "ok");
  }
  async function grantCurrentSiteAccess() {
    const context = await refreshSiteAccessUi();
    if (!context?.originPattern) {
      setStatus("Nao foi possivel pedir permissao para esta pagina.", "error");
      return;
    }
    const granted = await chrome.permissions.request({ origins: [context.originPattern] });
    if (!granted) {
      setStatus("Acesso negado. O Corrija-me PT-BR continuara desativado neste site.", "error");
      await refreshSiteAccessUi();
      return;
    }
    await refreshSiteAccessUi();
    await refreshLiveState();
    setStatus("Acesso liberado para este site.", "ok");
  }
  async function retrySiteAccessRequest() {
    const context = await refreshSiteAccessUi();
    if (!context?.originPattern) {
      setStatus("Nao foi possivel solicitar acesso novamente para esta pagina.", "error");
      return;
    }
    const granted = await chrome.permissions.request({ origins: [context.originPattern] });
    if (!granted) {
      setStatus("Acesso negado novamente. Quando quiser, clique em 'Solicitar acesso novamente'.", "error");
      await refreshSiteAccessUi();
      return;
    }
    await refreshSiteAccessUi();
    await refreshLiveState();
    setStatus("Acesso liberado com sucesso para este site.", "ok");
  }
  async function activateOnCurrentSite() {
    const context = await refreshSiteAccessUi();
    if (!context?.originPattern) {
      setStatus("Nao foi possivel ativar nesta pagina.", "error");
      return;
    }
    const granted = await chrome.permissions.contains({ origins: [context.originPattern] });
    if (!granted) {
      setStatus("Primeiro libere o acesso para este site.", "error");
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: "corrija-me-pt-br:inject-tab",
      tabId: context.id
    });
    if (!response?.ok) {
      setStatus(`Nao foi possivel ativar neste site: ${response?.error ?? "erro desconhecido"}`, "error");
      return;
    }
    await refreshLiveState();
    setStatus("Corrija-me PT-BR ativado neste site.", "ok");
  }
  async function analyzeNowFromPopup() {
    const response = await sendToActiveTab({ type: "corrija-me-pt-br:analyze-now" });
    renderLiveState(response?.state ?? null);
  }
  async function applyAllFromPopup() {
    const response = await sendToActiveTab({ type: "corrija-me-pt-br:apply-all" });
    renderLiveState(response?.state ?? null);
  }
  async function applySingleReplacement(index, replacement) {
    const response = await sendToActiveTab({
      type: "corrija-me-pt-br:apply-single",
      index,
      replacement
    });
    renderLiveState(response?.state ?? null);
  }
  async function testConnection() {
    setStatus("Testando conexao...");
    try {
      const serverUrl = await getServerUrl();
      const response = await fetch(`${serverUrl}/v2/languages`, {
        signal: AbortSignal.timeout(5e3)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const languages = await response.json();
      const hasPtBr = languages.some((item) => item.longCode === "pt-BR");
      if (!hasPtBr) {
        throw new Error("Servidor respondeu sem pt-BR.");
      }
      setStatus("Conexao ok. Backend local encontrado.", "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      setStatus(`Falha na conexao: ${message}`, "error");
    }
  }
  async function bootstrap() {
    const settings = await getSettings();
    if (serverUrlLabel) {
      serverUrlLabel.value = settings.serverUrl ?? await getServerUrl();
    }
    if (autoCheckInput) {
      autoCheckInput.checked = settings.autoCheck;
    }
    await refreshSiteAccessUi();
    await refreshLiveState();
    saveButton?.addEventListener("click", () => void persistSettings());
    testButton?.addEventListener("click", () => void testConnection());
    grantAllAccessButton?.addEventListener("click", () => void grantAllSitesAccess());
    grantAccessButton?.addEventListener("click", () => void grantCurrentSiteAccess());
    retryAccessButton?.addEventListener("click", () => void retrySiteAccessRequest());
    activateButton?.addEventListener("click", () => void activateOnCurrentSite());
    analyzeNowButton?.addEventListener("click", () => void analyzeNowFromPopup());
    applyAllButton?.addEventListener("click", () => void applyAllFromPopup());
    refreshStateButton?.addEventListener("click", () => void refreshLiveState());
  }
  void bootstrap();
})();
