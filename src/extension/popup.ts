import { getServerUrl, getSettings, saveSettings } from "./server-config.js";

const autoCheckInput = document.getElementById("autoCheck") as HTMLInputElement | null;
const saveButton = document.getElementById("saveButton") as HTMLButtonElement | null;
const testButton = document.getElementById("testButton") as HTMLButtonElement | null;
const grantAllAccessButton = document.getElementById("grantAllAccessButton") as HTMLButtonElement | null;
const grantAccessButton = document.getElementById("grantAccessButton") as HTMLButtonElement | null;
const retryAccessButton = document.getElementById("retryAccessButton") as HTMLButtonElement | null;
const activateButton = document.getElementById("activateButton") as HTMLButtonElement | null;
const status = document.getElementById("status") as HTMLDivElement | null;
const serverUrlLabel = document.getElementById("serverUrl") as HTMLSpanElement | null;
const currentSiteLabel = document.getElementById("currentSite") as HTMLInputElement | null;
const sitePermissionLabel = document.getElementById("sitePermission") as HTMLInputElement | null;
const globalPermissionLabel = document.getElementById("globalPermission") as HTMLInputElement | null;
const permissionHeadline = document.getElementById("permissionHeadline") as HTMLParagraphElement | null;
const permissionHelp = document.getElementById("permissionHelp") as HTMLParagraphElement | null;
const analyzeNowButton = document.getElementById("analyzeNowButton") as HTMLButtonElement | null;
const applyAllButton = document.getElementById("applyAllButton") as HTMLButtonElement | null;
const refreshStateButton = document.getElementById("refreshStateButton") as HTMLButtonElement | null;
const liveBadge = document.getElementById("liveBadge") as HTMLSpanElement | null;
const liveStatus = document.getElementById("liveStatus") as HTMLParagraphElement | null;
const liveResults = document.getElementById("liveResults") as HTMLDivElement | null;

type ActiveTabContext = {
  id: number;
  url: string;
  originPattern: string | null;
};

type PopupState = {
  status: string;
  tone: string;
  results: Array<{
    message: string;
    excerpt: string;
    replacements: string[];
  }>;
  totalMatches: number;
  hasActiveElement: boolean;
  activeElementType: string;
};

function setStatus(message: string, tone = ""): void {
  if (!status) {
    return;
  }
  status.textContent = message;
  status.className = `status${tone ? ` ${tone}` : ""}`;
}

function renderLiveState(state: PopupState | null): void {
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
    liveBadge.textContent = state.hasActiveElement
      ? state.totalMatches > 0 ? `${state.totalMatches} ajuste(s)` : "Sem ajustes"
      : "Sem foco";
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
    empty.textContent = state.hasActiveElement
      ? "Nenhum problema encontrado nesse texto."
      : "Foque em um campo de texto para o Corrija-me PT-BR acompanhar o que voce esta escrevendo.";
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

async function persistSettings(): Promise<void> {
  if (!autoCheckInput) {
    return;
  }
  const currentServerUrl = await getServerUrl();
  await saveSettings({ autoCheck: autoCheckInput.checked, serverUrl: currentServerUrl });
  setStatus("Preferencias locais salvas.", "ok");
}

async function getActiveTabContext(): Promise<ActiveTabContext | null> {
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

async function sendToActiveTab(message: Record<string, unknown>): Promise<{ ok?: boolean; state?: PopupState; error?: string } | null> {
  const context = await getActiveTabContext();
  if (!context?.id) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(context.id, message) as { ok?: boolean; state?: PopupState; error?: string };
  } catch {
    return null;
  }
}

async function refreshLiveState(): Promise<void> {
  const response = await sendToActiveTab({ type: "corrija-me-pt-br:get-state" });
  renderLiveState(response?.state ?? null);
}

async function refreshSiteAccessUi(): Promise<ActiveTabContext | null> {
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
    permissionHeadline.innerHTML = hasGlobalAccess || granted
      ? "A extensao <strong>corrija_me_pt_br</strong> ja saiu da instalacao com acesso suficiente para ajudar voce nesta pagina."
      : "Para a extensao <strong>corrija_me_pt_br</strong> ajudar voce, e necessario liberar o acesso.";
  }
  if (sitePermissionLabel) {
    sitePermissionLabel.value = hasGlobalAccess ? "Coberto pelo acesso global" : granted ? "Liberado neste site" : "Ainda nao liberado";
  }
  if (permissionHelp) {
    permissionHelp.textContent = hasGlobalAccess
      ? "O Corrija-me PT-BR ja esta liberado para todos os sites. Esse acesso passa a ser solicitado logo na instalacao para evitar confusao durante o uso."
      : granted
        ? "Este site ja foi liberado por voce. O acesso vale apenas para este endereco."
        : "Se voce quiser uma experiencia sem interrupcoes, use 'Liberar em todos os sites'. Se preferir mais controle, use 'Liberar neste site'.";
  }
  grantAccessButton?.toggleAttribute("disabled", granted || hasGlobalAccess);
  activateButton?.toggleAttribute("disabled", !(granted || hasGlobalAccess));
  retryAccessButton?.toggleAttribute("disabled", hasGlobalAccess || granted);
  return context;
}

async function grantAllSitesAccess(): Promise<void> {
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

async function grantCurrentSiteAccess(): Promise<void> {
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

async function retrySiteAccessRequest(): Promise<void> {
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

async function activateOnCurrentSite(): Promise<void> {
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
  }) as { ok?: boolean; error?: string } | undefined;

  if (!response?.ok) {
    setStatus(`Nao foi possivel ativar neste site: ${response?.error ?? "erro desconhecido"}`, "error");
    return;
  }

  await refreshLiveState();
  setStatus("Corrija-me PT-BR ativado neste site.", "ok");
}

async function analyzeNowFromPopup(): Promise<void> {
  const response = await sendToActiveTab({ type: "corrija-me-pt-br:analyze-now" });
  renderLiveState(response?.state ?? null);
}

async function applyAllFromPopup(): Promise<void> {
  const response = await sendToActiveTab({ type: "corrija-me-pt-br:apply-all" });
  renderLiveState(response?.state ?? null);
}

async function applySingleReplacement(index: number, replacement: string): Promise<void> {
  const response = await sendToActiveTab({
    type: "corrija-me-pt-br:apply-single",
    index,
    replacement
  });
  renderLiveState(response?.state ?? null);
}

async function testConnection(): Promise<void> {
  setStatus("Testando conexao...");
  try {
    const serverUrl = await getServerUrl();
    const response = await fetch(`${serverUrl}/v2/languages`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const languages = await response.json() as Array<{ longCode?: string }>;
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

async function bootstrap(): Promise<void> {
  const settings = await getSettings();
  if (serverUrlLabel) {
    serverUrlLabel.textContent = settings.serverUrl ?? await getServerUrl();
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
