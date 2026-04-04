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
  async function getServerUrl() {
    if (cachedServerUrl) {
      return cachedServerUrl;
    }
    const packagedServerUrl = await readPackagedServerUrl();
    if (!hasLiveExtensionContext()) {
      cachedServerUrl = packagedServerUrl;
      return packagedServerUrl;
    }
    try {
      const stored = await chrome.storage.local.get({ serverUrl: packagedServerUrl });
      const serverUrl = typeof stored.serverUrl === "string" && stored.serverUrl.trim() ? stored.serverUrl.trim() : packagedServerUrl;
      cachedServerUrl = serverUrl;
      return serverUrl;
    } catch {
      cachedServerUrl = packagedServerUrl;
      return packagedServerUrl;
    }
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
      const stored = await chrome.storage.local.get({ ...STORAGE_DEFAULTS, serverUrl: packagedServerUrl });
      return {
        autoCheck: stored.autoCheck !== false,
        serverUrl: typeof stored.serverUrl === "string" && stored.serverUrl.trim() ? stored.serverUrl.trim() : packagedServerUrl
      };
    } catch {
      return {
        autoCheck: STORAGE_DEFAULTS.autoCheck,
        serverUrl: packagedServerUrl
      };
    }
  }

  // src/extension/content.ts
  window.__corrijaMePtBrLoaded__ = true;
  var MIN_TEXT_LENGTH = 3;
  var CHECK_DEBOUNCE_MS = 1100;
  var TEXT_INPUT_TYPES = /* @__PURE__ */ new Set(["text", "search", "email", "url", "tel"]);
  var HIGHLIGHT_NAME = "corrija-me-pt-br-issue";
  var supportsCustomHighlights = typeof CSS !== "undefined" && "highlights" in CSS;
  var DOCS_HINT_DISMISSED_KEY = "googleDocsHintDismissed";
  var isGoogleDocsHost = location.hostname === "docs.google.com";
  var isTopWindow = window.top === window;
  var useGoogleDocsFrameBridge = isGoogleDocsHost && !isTopWindow;
  var isGoogleDocsTopWindow = isGoogleDocsHost && isTopWindow;
  var GOOGLE_DOCS_BRIDGE_NAMESPACE = "corrija-me-pt-br-google-docs";
  var docsBridgeFrameId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  var GOOGLE_DOCS_EDITOR_SELECTORS = [
    'div[role="textbox"][aria-multiline="true"]',
    'div[role="textbox"]',
    "textarea[aria-label]",
    "textarea",
    '[contenteditable="true"]'
  ];
  var MIN_VISIBLE_CONFIDENCE_SCORE = 0.68;
  var activeElement = null;
  var activeRequestId = 0;
  var debounceTimer = null;
  var latestMatches = [];
  var latestText = "";
  var latestStatusMessage = "Foque em um campo de texto para ver as correcoes.";
  var latestStatusTone = "";
  var inputOverlayHost = null;
  var inputOverlayContent = null;
  var suppressNextClickHideUntil = 0;
  var activeElementSessionId = 0;
  var ignoredMatchSignatures = /* @__PURE__ */ new Map();
  var latestHiddenWeakCount = 0;
  var highlightedSuggestionIndex = -1;
  var suggestionMenu = document.createElement("section");
  suggestionMenu.className = "corrija-me-pt-br-menu corrija-me-pt-br-hidden";
  document.documentElement.appendChild(suggestionMenu);
  var googleDocsHint = null;
  function isSupportedElement(element) {
    if (!element) {
      return false;
    }
    if (element instanceof HTMLTextAreaElement) {
      return !element.disabled && !element.readOnly;
    }
    if (element instanceof HTMLInputElement) {
      return !element.disabled && !element.readOnly && TEXT_INPUT_TYPES.has((element.type || "text").toLowerCase());
    }
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    return element.isContentEditable || element.getAttribute("role") === "textbox";
  }
  function isVisibleElement(element) {
    return element instanceof HTMLElement && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  }
  function findGoogleDocsEditor() {
    for (const selector of GOOGLE_DOCS_EDITOR_SELECTORS) {
      const candidates = Array.from(document.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (candidate instanceof HTMLTextAreaElement && isSupportedElement(candidate)) {
          return candidate;
        }
        if (isSupportedElement(candidate) && isVisibleElement(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }
  function activateElement(element) {
    if (activeElement !== element) {
      activeElementSessionId += 1;
    }
    activeElement = element;
    activeElement.setAttribute("spellcheck", "false");
    if (useGoogleDocsFrameBridge) {
      postGoogleDocsBridgeMessage({ type: "activate" });
    }
  }
  function findFallbackEditableElement() {
    const currentActive = document.activeElement;
    if (isSupportedElement(currentActive instanceof Element ? currentActive : null)) {
      return currentActive;
    }
    const candidates = Array.from(document.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']"));
    for (const candidate of candidates) {
      if (isSupportedElement(candidate) && isVisibleElement(candidate)) {
        return candidate;
      }
    }
    return null;
  }
  function ensureActiveElement() {
    if (activeElement && isSupportedElement(activeElement)) {
      return;
    }
    const fallback = isGoogleDocsHost ? findGoogleDocsEditor() || findFallbackEditableElement() : findFallbackEditableElement();
    if (fallback) {
      activateElement(fallback);
    }
  }
  function getText(element) {
    if (!element) {
      return "";
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value || "";
    }
    return (element.textContent || "").replace(/\u00a0/g, " ");
  }
  function countRegexMatches(text, pattern) {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  }
  function looksLikeUrlOnly(text) {
    return /^(https?:\/\/|www\.)\S+$/i.test(text);
  }
  function looksLikeEmailOnly(text) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  }
  function looksLikeJwt(text) {
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text);
  }
  function looksLikeUuid(text) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
  }
  function looksLikeHashOrApiKey(text) {
    return /^[A-Za-z0-9+/_=-]{24,}$/.test(text) && !/[ .,!?:;()[\]{}]/.test(text) && !/[aeiouáéíóúàâêôãõ]/i.test(text);
  }
  function looksLikeEndpointOrPath(text) {
    return /^[/A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\?[^ ]*)?$/.test(text) && /[/?=&_-]/.test(text) && !/\s/.test(text);
  }
  function looksLikePixOrDocumentKey(text) {
    const compact = text.replace(/\s+/g, "");
    return /^\+?\d{10,16}$/.test(compact) || /^\d{11}$/.test(compact) || /^\d{14}$/.test(compact) || /^[0-9a-f]{32}$/i.test(compact);
  }
  function classifyNonLinguisticText(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return "Campo vazio.";
    }
    if (looksLikeUrlOnly(trimmed)) {
      return "Conte\xFAdo parece ser apenas um link.";
    }
    if (looksLikeEmailOnly(trimmed)) {
      return "Conte\xFAdo parece ser apenas um e-mail.";
    }
    if (looksLikeJwt(trimmed) || looksLikeUuid(trimmed) || looksLikeHashOrApiKey(trimmed)) {
      return "Conte\xFAdo parece ser uma chave, token ou identificador.";
    }
    if (looksLikePixOrDocumentKey(trimmed)) {
      return "Conte\xFAdo parece ser uma chave num\xE9rica ou identificador de pagamento.";
    }
    if (looksLikeEndpointOrPath(trimmed)) {
      return "Conte\xFAdo parece ser um endpoint, caminho ou string t\xE9cnica.";
    }
    const letters = countRegexMatches(trimmed, new RegExp("\\p{L}", "gu"));
    const digits = countRegexMatches(trimmed, /\d/g);
    const whitespace = countRegexMatches(trimmed, /\s/g);
    const punctuation = countRegexMatches(trimmed, /[.,!?;:]/g);
    const technicalChars = countRegexMatches(trimmed, /[_/=&#:%@[\]{}<>\\|$+-]/g);
    const words = trimmed.split(/\s+/).filter(Boolean);
    const hasSentenceShape = punctuation > 0 || words.length >= 3;
    const letterRatio = trimmed.length ? letters / trimmed.length : 0;
    if (!hasSentenceShape && digits >= letters && technicalChars >= 2) {
      return "Conte\xFAdo parece t\xE9cnico demais para revis\xE3o gramatical.";
    }
    if (!hasSentenceShape && letterRatio < 0.45 && (digits >= 4 || technicalChars >= 3 || whitespace === 0)) {
      return "Conte\xFAdo n\xE3o parece uma frase em portugu\xEAs.";
    }
    return null;
  }
  function setText(element, text) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = element.selectionStart ?? text.length;
      element.value = text;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      const cursor = Math.min(start, text.length);
      element.focus();
      element.setSelectionRange(cursor, cursor);
      return;
    }
    element.focus();
    element.textContent = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function replaceTextRange(text, offset, length, replacement) {
    return text.slice(0, offset) + replacement + text.slice(offset + length);
  }
  function hideSuggestionMenu() {
    suggestionMenu.classList.add("corrija-me-pt-br-hidden");
    suggestionMenu.innerHTML = "";
    highlightedSuggestionIndex = -1;
  }
  function shouldIgnoreHideAfterPointerGesture() {
    return Date.now() < suppressNextClickHideUntil;
  }
  function markPointerGestureForSuggestionMenu() {
    suppressNextClickHideUntil = Date.now() + 400;
  }
  async function shouldShowGoogleDocsHint() {
    if (!isGoogleDocsHost || window.top !== window) {
      return false;
    }
    try {
      const stored = await chrome.storage.local.get({ [DOCS_HINT_DISMISSED_KEY]: false });
      return stored[DOCS_HINT_DISMISSED_KEY] !== true;
    } catch {
      return false;
    }
  }
  async function dismissGoogleDocsHint() {
    try {
      await chrome.storage.local.set({ [DOCS_HINT_DISMISSED_KEY]: true });
    } catch {
    }
    googleDocsHint?.remove();
    googleDocsHint = null;
  }
  async function maybeShowGoogleDocsHint() {
    if (!await shouldShowGoogleDocsHint() || googleDocsHint) {
      return;
    }
    googleDocsHint = document.createElement("section");
    googleDocsHint.className = "corrija-me-pt-br-docs-hint";
    googleDocsHint.innerHTML = `
    <div class="corrija-me-pt-br-docs-hint-title">Modo Google Docs</div>
    <div class="corrija-me-pt-br-docs-hint-text">
      Para uma integracao melhor no Google Docs, ative em Ferramentas > Acessibilidade a opcao de suporte a leitor de tela.
    </div>
    <div class="corrija-me-pt-br-docs-hint-text">
      Depois disso, recarregue a pagina para o Corrija-me PT-BR ler melhor o texto do editor.
    </div>
    <div class="corrija-me-pt-br-docs-hint-actions">
      <button type="button" class="corrija-me-pt-br-docs-hint-button" data-dismiss>Entendi</button>
    </div>
  `;
    googleDocsHint.querySelector("[data-dismiss]")?.addEventListener("click", () => {
      void dismissGoogleDocsHint();
    });
    document.documentElement.appendChild(googleDocsHint);
  }
  function setStatus(message, tone = "") {
    latestStatusMessage = message;
    latestStatusTone = tone;
  }
  function getExcerpt(match) {
    const start = Math.max(0, match.offset - 25);
    const end = Math.min(latestText.length, match.offset + match.length + 25);
    return latestText.slice(start, end).replace(/\s+/g, " ").trim();
  }
  function getPopupResults() {
    return latestMatches.slice(0, 8).map((match) => ({
      message: match.message || "Possivel ajuste encontrado.",
      excerpt: getExcerpt(match),
      replacements: Array.isArray(match.replacements) ? match.replacements.slice(0, 4).map((item) => item.value) : []
    }));
  }
  function getPopupState() {
    return {
      status: latestStatusMessage,
      tone: latestStatusTone,
      results: getPopupResults(),
      totalMatches: latestMatches.length,
      hiddenWeakMatches: latestHiddenWeakCount,
      hasActiveElement: Boolean(activeElement),
      activeElementType: activeElement instanceof HTMLTextAreaElement ? "textarea" : activeElement instanceof HTMLInputElement ? "input" : activeElement instanceof HTMLElement && (activeElement.isContentEditable || activeElement.getAttribute("role") === "textbox") ? "editable" : "none"
    };
  }
  function clearHighlights() {
    if (!supportsCustomHighlights) {
      return;
    }
    CSS.highlights.delete(HIGHLIGHT_NAME);
  }
  function isInputLikeElement(element) {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  }
  function ensureInputOverlay() {
    if (inputOverlayHost && inputOverlayContent) {
      return;
    }
    inputOverlayHost = document.createElement("div");
    inputOverlayHost.className = "corrija-me-pt-br-input-overlay-host corrija-me-pt-br-hidden";
    inputOverlayContent = document.createElement("div");
    inputOverlayContent.className = "corrija-me-pt-br-input-overlay-content";
    inputOverlayHost.appendChild(inputOverlayContent);
    document.body.appendChild(inputOverlayHost);
  }
  function hideInputOverlay() {
    inputOverlayHost?.classList.add("corrija-me-pt-br-hidden");
    if (inputOverlayContent) {
      inputOverlayContent.innerHTML = "";
    }
  }
  function escapeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
  function syncInputOverlayPosition(element) {
    ensureInputOverlay();
    if (!inputOverlayHost || !inputOverlayContent) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    inputOverlayHost.classList.remove("corrija-me-pt-br-hidden");
    inputOverlayHost.style.left = `${rect.left}px`;
    inputOverlayHost.style.top = `${rect.top}px`;
    inputOverlayHost.style.width = `${rect.width}px`;
    inputOverlayHost.style.height = `${rect.height}px`;
    inputOverlayHost.style.borderRadius = styles.borderRadius;
    inputOverlayHost.style.padding = styles.padding;
    inputOverlayHost.style.font = styles.font;
    inputOverlayHost.style.letterSpacing = styles.letterSpacing;
    inputOverlayHost.style.lineHeight = styles.lineHeight;
    inputOverlayHost.style.textAlign = styles.textAlign;
    inputOverlayHost.style.textTransform = styles.textTransform;
    inputOverlayHost.style.textIndent = styles.textIndent;
    inputOverlayHost.style.wordSpacing = styles.wordSpacing;
    inputOverlayHost.style.whiteSpace = element instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
    inputOverlayContent.style.transform = `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`;
  }
  function renderInputOverlay(matches) {
    if (!activeElement || !isInputLikeElement(activeElement)) {
      hideInputOverlay();
      return;
    }
    if (!matches.length || !latestText.length) {
      hideInputOverlay();
      return;
    }
    ensureInputOverlay();
    if (!inputOverlayContent) {
      return;
    }
    syncInputOverlayPosition(activeElement);
    let cursor = 0;
    const parts = [];
    const sortedMatches = matches.map((match, originalIndex) => ({ match, originalIndex })).sort((left, right) => left.match.offset - right.match.offset);
    for (const entry of sortedMatches) {
      const { match, originalIndex } = entry;
      const start = Math.max(0, Math.min(latestText.length, match.offset));
      const end = Math.max(start, Math.min(latestText.length, match.offset + match.length));
      if (start > cursor) {
        parts.push(`<span class="corrija-me-pt-br-overlay-text">${escapeHtml(latestText.slice(cursor, start))}</span>`);
      }
      const fragment = latestText.slice(start, end) || " ";
      parts.push(
        `<button type="button" class="corrija-me-pt-br-overlay-hit" data-match-index="${originalIndex}" aria-label="Abrir sugestoes para ${escapeHtml(fragment)}">${escapeHtml(fragment)}</button>`
      );
      cursor = end;
    }
    if (cursor < latestText.length) {
      parts.push(`<span class="corrija-me-pt-br-overlay-text">${escapeHtml(latestText.slice(cursor))}</span>`);
    }
    inputOverlayContent.innerHTML = parts.join("");
    syncInputOverlayPosition(activeElement);
  }
  function isContentEditableLike(element) {
    return element instanceof HTMLElement && (element.isContentEditable || element.getAttribute("role") === "textbox");
  }
  function getEditableTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      if (current instanceof Text) {
        nodes.push(current);
      }
      current = walker.nextNode();
    }
    return nodes;
  }
  function createRangeFromOffsets(root, offset, length) {
    const textNodes = getEditableTextNodes(root);
    if (!textNodes.length) {
      return null;
    }
    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;
    let consumed = 0;
    const endIndex = offset + Math.max(length, 0);
    for (const textNode of textNodes) {
      const valueLength = textNode.textContent?.length ?? 0;
      const nextConsumed = consumed + valueLength;
      if (!startNode && offset <= nextConsumed) {
        startNode = textNode;
        startOffset = Math.max(0, offset - consumed);
      }
      if (!endNode && endIndex <= nextConsumed) {
        endNode = textNode;
        endOffset = Math.max(0, endIndex - consumed);
        break;
      }
      consumed = nextConsumed;
    }
    if (!startNode || !endNode) {
      return null;
    }
    const range = document.createRange();
    range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length ?? 0));
    return range;
  }
  function renderHighlightsForActiveElement(matches) {
    clearHighlights();
    if (!supportsCustomHighlights || !activeElement || !isContentEditableLike(activeElement)) {
      return;
    }
    const ranges = matches.map((match) => createRangeFromOffsets(activeElement, match.offset, match.length)).filter((range) => range !== null);
    if (!ranges.length) {
      return;
    }
    const highlight = new Highlight(...ranges);
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  }
  function getLinearOffset(root, node, offset) {
    if (!root.contains(node)) {
      return null;
    }
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
      range.setEnd(node, offset);
    } catch {
      return null;
    }
    return range.toString().length;
  }
  function getMatchIndexAtOffset(offset) {
    return latestMatches.findIndex((match) => offset >= match.offset && offset <= match.offset + match.length);
  }
  function getMatchConfidenceScore(match) {
    if (typeof match.confidence?.score === "number") {
      return match.confidence.score;
    }
    switch (match.confidence?.level) {
      case "high":
        return 0.95;
      case "medium":
        return 0.76;
      case "low":
        return 0.45;
      default:
        return 0.9;
    }
  }
  function shouldHideWeakMatch(match) {
    return match.confidence?.level === "low" || getMatchConfidenceScore(match) < MIN_VISIBLE_CONFIDENCE_SCORE;
  }
  function compareMatchesByUiPriority(left, right) {
    return getMatchConfidenceScore(right) - getMatchConfidenceScore(left) || left.offset - right.offset || left.length - right.length;
  }
  function normalizeMatchSignaturePart(value) {
    return value.normalize("NFC").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  }
  function getMatchText(match, text) {
    const start = Math.max(0, Math.min(text.length, match.offset));
    const end = Math.max(start, Math.min(text.length, match.offset + match.length));
    return text.slice(start, end);
  }
  function createMatchSignature(match, text) {
    const snippet = getMatchText(match, text);
    const contextStart = Math.max(0, match.offset - 12);
    const contextEnd = Math.min(text.length, match.offset + match.length + 12);
    const localContext = text.slice(contextStart, contextEnd);
    const firstReplacement = Array.isArray(match.replacements) && match.replacements[0] ? match.replacements[0].value : "";
    return [
      normalizeMatchSignaturePart(match.rule?.id || "sem-regra"),
      normalizeMatchSignaturePart(snippet),
      normalizeMatchSignaturePart(firstReplacement),
      normalizeMatchSignaturePart(localContext)
    ].join("::");
  }
  function getIgnoredMatchSet(sessionId) {
    let ignored = ignoredMatchSignatures.get(sessionId);
    if (!ignored) {
      ignored = /* @__PURE__ */ new Set();
      ignoredMatchSignatures.set(sessionId, ignored);
    }
    return ignored;
  }
  function filterIgnoredMatches(matches, text, sessionId) {
    const ignored = ignoredMatchSignatures.get(sessionId);
    if (!ignored?.size) {
      return matches;
    }
    return matches.filter((match) => !ignored.has(createMatchSignature(match, text)));
  }
  function prepareVisibleMatches(matches) {
    const visible = matches.filter((match) => !shouldHideWeakMatch(match));
    latestHiddenWeakCount = matches.length - visible.length;
    return visible.sort(compareMatchesByUiPriority);
  }
  function getConfidenceLabel(match) {
    switch (match.confidence?.level) {
      case "high":
        return "Confianca alta";
      case "medium":
        return "Confianca media";
      case "low":
        return "Confianca baixa";
      default:
        return "Confianca padrao";
    }
  }
  function syncSuggestionMenuPosition() {
    if (!activeElement || !isVisibleElement(activeElement)) {
      suggestionMenu.classList.add("corrija-me-pt-br-hidden");
      return;
    }
    const rect = activeElement.getBoundingClientRect();
    const panelWidth = Math.min(360, Math.max(280, window.innerWidth - 24));
    const preferRight = rect.right + 14 + panelWidth <= window.innerWidth - 12;
    const left = preferRight ? rect.right + 14 : Math.max(12, Math.min(window.innerWidth - panelWidth - 12, rect.left));
    const top = preferRight ? Math.max(12, rect.top) : Math.min(window.innerHeight - 220, rect.bottom + 12);
    suggestionMenu.style.width = `${panelWidth}px`;
    suggestionMenu.style.maxWidth = `${panelWidth}px`;
    suggestionMenu.style.left = `${left}px`;
    suggestionMenu.style.top = `${Math.max(12, top)}px`;
  }
  function focusSuggestionCard(index) {
    const card = suggestionMenu.querySelector(`[data-suggestion-card="${index}"]`);
    if (!card) {
      return;
    }
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function renderSuggestionPanel(focusIndex = highlightedSuggestionIndex) {
    if (!latestMatches.length || !activeElement) {
      hideSuggestionMenu();
      return;
    }
    highlightedSuggestionIndex = focusIndex >= 0 ? focusIndex : -1;
    suggestionMenu.innerHTML = "";
    const header = document.createElement("div");
    header.className = "corrija-me-pt-br-menu-panel-header";
    header.innerHTML = `
    <div class="corrija-me-pt-br-menu-panel-title">Sugest\xF5es do campo</div>
    <div class="corrija-me-pt-br-menu-panel-meta">${latestMatches.length} ajuste(s)</div>
  `;
    suggestionMenu.appendChild(header);
    if (latestMatches.length > 1) {
      const actions = document.createElement("div");
      actions.className = "corrija-me-pt-br-menu-panel-actions";
      const applyAllButton = document.createElement("button");
      applyAllButton.type = "button";
      applyAllButton.className = "corrija-me-pt-br-menu-bulk-button";
      applyAllButton.textContent = "Corrigir vis\xEDveis";
      applyAllButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyAllCorrections();
      });
      actions.appendChild(applyAllButton);
      suggestionMenu.appendChild(actions);
    }
    const list = document.createElement("div");
    list.className = "corrija-me-pt-br-menu-list";
    latestMatches.forEach((match, index) => {
      const card = document.createElement("article");
      card.className = "corrija-me-pt-br-menu-card";
      if (index === highlightedSuggestionIndex) {
        card.classList.add("corrija-me-pt-br-menu-card-active");
      }
      card.dataset.suggestionCard = String(index);
      const excerpt = getExcerpt(match) || getMatchText(match, latestText) || "Trecho sem contexto.";
      const replacements = Array.isArray(match.replacements) ? match.replacements.slice(0, 2) : [];
      const topRow = document.createElement("div");
      topRow.className = "corrija-me-pt-br-menu-card-top";
      const confidenceBadge = document.createElement("div");
      confidenceBadge.className = `corrija-me-pt-br-menu-confidence corrija-me-pt-br-menu-confidence-${match.confidence?.level || "default"}`;
      confidenceBadge.textContent = getConfidenceLabel(match);
      if (match.confidence?.reason) {
        confidenceBadge.title = match.confidence.reason;
      }
      topRow.appendChild(confidenceBadge);
      const ignoreButton = document.createElement("button");
      ignoreButton.type = "button";
      ignoreButton.className = "corrija-me-pt-br-menu-ignore";
      ignoreButton.textContent = "(i)";
      ignoreButton.title = "Ignorar nesta an\xE1lise";
      ignoreButton.setAttribute("aria-label", "Ignorar nesta an\xE1lise");
      ignoreButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ignoreMatch(index);
      });
      topRow.appendChild(ignoreButton);
      card.appendChild(topRow);
      const excerptNode = document.createElement("div");
      excerptNode.className = "corrija-me-pt-br-menu-excerpt";
      excerptNode.textContent = excerpt;
      card.appendChild(excerptNode);
      const messageNode = document.createElement("div");
      messageNode.className = "corrija-me-pt-br-menu-message";
      messageNode.textContent = match.message || "Poss\xEDvel ajuste encontrado.";
      card.appendChild(messageNode);
      const replacementsWrap = document.createElement("div");
      replacementsWrap.className = "corrija-me-pt-br-menu-replacements";
      if (!replacements.length) {
        const empty = document.createElement("div");
        empty.className = "corrija-me-pt-br-menu-empty";
        empty.textContent = "Sem sugest\xE3o pronta.";
        replacementsWrap.appendChild(empty);
      } else {
        replacements.forEach((replacement) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "corrija-me-pt-br-menu-item";
          button.textContent = replacement.value;
          button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            applySingleCorrection(index, replacement.value);
          });
          replacementsWrap.appendChild(button);
        });
      }
      card.appendChild(replacementsWrap);
      list.appendChild(card);
    });
    suggestionMenu.appendChild(list);
    syncSuggestionMenuPosition();
    suggestionMenu.classList.remove("corrija-me-pt-br-hidden");
    if (highlightedSuggestionIndex >= 0) {
      focusSuggestionCard(highlightedSuggestionIndex);
    }
  }
  function ignoreMatch(index) {
    const match = latestMatches[index];
    if (!match) {
      return;
    }
    getIgnoredMatchSet(activeElementSessionId).add(createMatchSignature(match, latestText));
    latestMatches = latestMatches.filter((_, matchIndex) => matchIndex !== index);
    renderResults(latestMatches);
    const statusMessage = latestMatches.length ? `${latestMatches.length} sugestao(oes) restante(s).` : "Sugestao ignorada nesta analise.";
    setStatus(statusMessage, latestMatches.length ? "ok" : "");
    syncGoogleDocsBridgeState(statusMessage);
  }
  function openSuggestionMenu(index, x, y) {
    if (!latestMatches[index]) {
      hideSuggestionMenu();
      return;
    }
    void x;
    void y;
    renderSuggestionPanel(index);
  }
  function postGoogleDocsBridgeMessage(payload) {
    if (!useGoogleDocsFrameBridge) {
      return;
    }
    window.top?.postMessage({
      namespace: GOOGLE_DOCS_BRIDGE_NAMESPACE,
      frameId: docsBridgeFrameId,
      ...payload
    }, "*");
  }
  function syncGoogleDocsBridgeState(statusMessage) {
    if (!useGoogleDocsFrameBridge) {
      return;
    }
    postGoogleDocsBridgeMessage({
      type: "state",
      text: latestText,
      matches: latestMatches,
      status: statusMessage,
      tone: latestStatusTone
    });
  }
  function dispatchInputLikeEvent(type, inputType, data) {
    try {
      return new InputEvent(type, {
        bubbles: true,
        cancelable: type === "beforeinput",
        inputType,
        data
      });
    } catch {
      return new Event(type, {
        bubbles: true,
        cancelable: type === "beforeinput"
      });
    }
  }
  function applyReplacementToContentEditable(element, match, replacement) {
    const range = createRangeFromOffsets(element, match.offset, match.length);
    if (!range) {
      return false;
    }
    element.focus();
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range.cloneRange());
    }
    let applied;
    try {
      applied = document.execCommand("insertText", false, replacement);
    } catch {
      applied = false;
    }
    if (!applied) {
      range.deleteContents();
      const textNode = document.createTextNode(replacement);
      range.insertNode(textNode);
      if (selection) {
        const caretRange = document.createRange();
        caretRange.setStart(textNode, replacement.length);
        caretRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caretRange);
      }
      applied = true;
      element.dispatchEvent(dispatchInputLikeEvent("input", "insertReplacementText", replacement));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return applied;
  }
  function renderResults(matches) {
    latestMatches = matches;
    renderHighlightsForActiveElement(matches);
    renderInputOverlay(matches);
    renderSuggestionPanel();
  }
  async function analyzeActiveElement(manual = false) {
    ensureActiveElement();
    if (!activeElement || !isSupportedElement(activeElement)) {
      return;
    }
    const text = getText(activeElement);
    latestText = text;
    hideSuggestionMenu();
    if (text.trim().length < MIN_TEXT_LENGTH) {
      latestMatches = [];
      latestHiddenWeakCount = 0;
      clearHighlights();
      hideInputOverlay();
      setStatus("Digite um pouco mais para analisar esse campo.");
      renderResults([]);
      syncGoogleDocsBridgeState("Digite um pouco mais para analisar esse campo.");
      return;
    }
    const nonLinguisticReason = classifyNonLinguisticText(text);
    if (nonLinguisticReason) {
      latestMatches = [];
      latestHiddenWeakCount = 0;
      clearHighlights();
      hideInputOverlay();
      setStatus(`${nonLinguisticReason} A analise gramatical foi ignorada.`);
      renderResults([]);
      syncGoogleDocsBridgeState(`${nonLinguisticReason} A analise gramatical foi ignorada.`);
      return;
    }
    const requestId = ++activeRequestId;
    const sessionId = activeElementSessionId;
    const settings = await getSettings();
    if (!manual && !settings.autoCheck) {
      setStatus("Analise automatica desativada. Use 'Analisar agora'.");
      renderResults([]);
      syncGoogleDocsBridgeState("Analise automatica desativada. Use 'Analisar agora'.");
      return;
    }
    setStatus("Analisando texto em pt-BR...");
    try {
      const payload = new URLSearchParams({
        language: "pt-BR",
        text
      });
      const serverUrl = await getServerUrl();
      const response = await fetch(`${serverUrl}/v2/check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: payload.toString()
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (requestId !== activeRequestId) {
        return;
      }
      const filteredMatches = filterIgnoredMatches(Array.isArray(data.matches) ? data.matches : [], text, sessionId);
      const matches = prepareVisibleMatches(filteredMatches);
      renderResults(matches);
      const statusMessage = matches.length ? latestHiddenWeakCount ? `${matches.length} sugestao(oes) visivel(is). ${latestHiddenWeakCount} fraca(s) oculta(s).` : `${matches.length} sugestao(oes) encontrada(s).` : latestHiddenWeakCount ? `Nenhuma sugestao visivel. ${latestHiddenWeakCount} fraca(s) oculta(s).` : "Nenhum problema encontrado.";
      setStatus(statusMessage, "ok");
      syncGoogleDocsBridgeState(statusMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      setStatus(`Falha ao consultar o backend local: ${message}`, "error");
      clearHighlights();
      hideInputOverlay();
      latestHiddenWeakCount = 0;
      renderResults([]);
      syncGoogleDocsBridgeState(`Falha ao consultar o backend local: ${message}`);
    }
  }
  function applySingleCorrection(index, replacement) {
    if (!activeElement || !latestMatches[index]) {
      return;
    }
    const match = latestMatches[index];
    if (activeElement instanceof HTMLElement && (activeElement.isContentEditable || activeElement.getAttribute("role") === "textbox")) {
      const applied = applyReplacementToContentEditable(activeElement, match, replacement);
      if (!applied) {
        return;
      }
      latestText = getText(activeElement);
    } else {
      const updatedText = replaceTextRange(getText(activeElement), match.offset, match.length, replacement);
      setText(activeElement, updatedText);
      latestText = updatedText;
    }
    void analyzeActiveElement(true);
  }
  function applyAllCorrections() {
    if (!activeElement || !latestMatches.length) {
      return;
    }
    if (activeElement instanceof HTMLElement && (activeElement.isContentEditable || activeElement.getAttribute("role") === "textbox")) {
      const sortedMatches2 = [...latestMatches].filter((match) => match.replacements?.length).sort((left, right) => right.offset - left.offset);
      for (const match of sortedMatches2) {
        applyReplacementToContentEditable(activeElement, match, match.replacements[0].value);
      }
      latestText = getText(activeElement);
      void analyzeActiveElement(true);
      return;
    }
    let updatedText = getText(activeElement);
    const sortedMatches = [...latestMatches].filter((match) => match.replacements?.length).sort((left, right) => right.offset - left.offset);
    for (const match of sortedMatches) {
      updatedText = replaceTextRange(updatedText, match.offset, match.length, match.replacements[0].value);
    }
    setText(activeElement, updatedText);
    latestText = updatedText;
    void analyzeActiveElement(true);
  }
  function scheduleAnalysis() {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void analyzeActiveElement(false);
    }, CHECK_DEBOUNCE_MS);
  }
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!isSupportedElement(target instanceof Element ? target : null)) {
      return;
    }
    activateElement(target);
    scheduleAnalysis();
  });
  document.addEventListener("focusout", (event) => {
    if (event.target === activeElement) {
      window.setTimeout(() => {
        ensureActiveElement();
        if (activeElement && isInputLikeElement(activeElement)) {
          syncInputOverlayPosition(activeElement);
        } else if (!document.activeElement || document.activeElement === document.body) {
          hideInputOverlay();
        }
      }, 0);
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target === activeElement) {
      scheduleAnalysis();
    }
  }, true);
  document.addEventListener("scroll", () => {
    if (activeElement && isInputLikeElement(activeElement)) {
      syncInputOverlayPosition(activeElement);
    }
    if (!suggestionMenu.classList.contains("corrija-me-pt-br-hidden")) {
      syncSuggestionMenuPosition();
    }
  }, true);
  window.addEventListener("resize", () => {
    if (activeElement && isInputLikeElement(activeElement)) {
      syncInputOverlayPosition(activeElement);
    }
    if (!suggestionMenu.classList.contains("corrija-me-pt-br-hidden")) {
      syncSuggestionMenuPosition();
    }
  });
  document.addEventListener("selectionchange", () => {
    if (!isGoogleDocsHost) {
      return;
    }
    const editor = findGoogleDocsEditor();
    if (editor && editor !== activeElement) {
      activateElement(editor);
    }
  });
  if (isGoogleDocsHost) {
    const observer = new MutationObserver(() => {
      const editor = findGoogleDocsEditor();
      if (editor && editor !== activeElement) {
        activateElement(editor);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  }
  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === "c") {
      void analyzeActiveElement(true);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains("corrija-me-pt-br-overlay-hit")) {
      const index = Number(target.dataset.matchIndex ?? "-1");
      if (Number.isInteger(index) && index >= 0) {
        markPointerGestureForSuggestionMenu();
        openSuggestionMenu(index, 0, 0);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (target instanceof Node && suggestionMenu.contains(target)) {
      return;
    }
    if (!(activeElement instanceof HTMLElement) || !activeElement.isContentEditable && activeElement.getAttribute("role") !== "textbox") {
      hideSuggestionMenu();
      return;
    }
    if (!(target instanceof Node) || !activeElement.contains(target)) {
      hideSuggestionMenu();
      return;
    }
    const mouseEvent = event;
    const caretRangeFromPoint = document.caretRangeFromPoint?.bind(document);
    const caretPositionFromPoint = document.caretPositionFromPoint?.bind(document);
    let offset = null;
    if (caretRangeFromPoint) {
      const range = caretRangeFromPoint(mouseEvent.clientX, mouseEvent.clientY);
      if (range) {
        offset = getLinearOffset(activeElement, range.startContainer, range.startOffset);
      }
    } else if (caretPositionFromPoint) {
      const position = caretPositionFromPoint(mouseEvent.clientX, mouseEvent.clientY);
      if (position) {
        offset = getLinearOffset(activeElement, position.offsetNode, position.offset);
      }
    }
    if (offset === null) {
      hideSuggestionMenu();
      return;
    }
    const matchIndex = getMatchIndexAtOffset(offset);
    if (matchIndex === -1) {
      hideSuggestionMenu();
      return;
    }
    markPointerGestureForSuggestionMenu();
    openSuggestionMenu(matchIndex, mouseEvent.clientX, mouseEvent.clientY);
    event.preventDefault();
    event.stopPropagation();
  }, true);
  document.addEventListener("click", (event) => {
    if (shouldIgnoreHideAfterPointerGesture()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target;
    if (target instanceof Node && suggestionMenu.contains(target)) {
      return;
    }
    if (target instanceof HTMLElement && target.classList.contains("corrija-me-pt-br-overlay-hit")) {
      return;
    }
    if (target instanceof Node && activeElement instanceof HTMLElement && activeElement.contains(target)) {
      return;
    }
    if (!(target instanceof Node) || !suggestionMenu.contains(target)) {
      hideSuggestionMenu();
    }
  }, true);
  window.addEventListener("message", (event) => {
    const payload = event.data;
    if (!payload || payload.namespace !== GOOGLE_DOCS_BRIDGE_NAMESPACE) {
      return;
    }
    if (isGoogleDocsTopWindow && payload.type === "activate") {
      return;
    }
    if (isGoogleDocsTopWindow && payload.type === "state") {
      latestText = typeof payload.text === "string" ? payload.text : "";
      latestMatches = Array.isArray(payload.matches) ? payload.matches : [];
      renderResults(latestMatches);
      setStatus(typeof payload.status === "string" ? payload.status : "Google Docs conectado.", typeof payload.tone === "string" ? payload.tone : latestMatches.length ? "ok" : "");
      return;
    }
    if (!useGoogleDocsFrameBridge || payload.frameId !== docsBridgeFrameId) {
      return;
    }
    if (payload.type === "analyze-now") {
      void analyzeActiveElement(true);
      return;
    }
    if (payload.type === "apply-all") {
      applyAllCorrections();
      return;
    }
    if (payload.type === "apply-single" && typeof payload.index === "number" && typeof payload.replacement === "string") {
      applySingleCorrection(payload.index, payload.replacement);
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "corrija-me-pt-br:get-state") {
      ensureActiveElement();
      sendResponse({ ok: true, state: getPopupState() });
      return;
    }
    if (message.type === "corrija-me-pt-br:analyze-now") {
      void analyzeActiveElement(true).then(() => {
        sendResponse({ ok: true, state: getPopupState() });
      });
      return true;
    }
    if (message.type === "corrija-me-pt-br:apply-all") {
      applyAllCorrections();
      window.setTimeout(() => sendResponse({ ok: true, state: getPopupState() }), 100);
      return true;
    }
    if (message.type === "corrija-me-pt-br:apply-single" && typeof message.index === "number" && typeof message.replacement === "string") {
      applySingleCorrection(message.index, message.replacement);
      window.setTimeout(() => sendResponse({ ok: true, state: getPopupState() }), 100);
      return true;
    }
  });
  void maybeShowGoogleDocsHint();
})();
