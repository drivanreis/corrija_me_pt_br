import { getServerUrl, getSettings } from "./server-config.js";

window.__corrijaMePtBrLoaded__ = true;

const MIN_TEXT_LENGTH = 3;
const CHECK_DEBOUNCE_MS = 1100;
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel"]);
const HIGHLIGHT_NAME = "corrija-me-pt-br-issue";
const supportsCustomHighlights = typeof CSS !== "undefined" && "highlights" in CSS;
const DOCS_HINT_DISMISSED_KEY = "googleDocsHintDismissed";
const isGoogleDocsHost = location.hostname === "docs.google.com";
const isTopWindow = window.top === window;
const useGoogleDocsFrameBridge = isGoogleDocsHost && !isTopWindow;
const isGoogleDocsTopWindow = isGoogleDocsHost && isTopWindow;
const GOOGLE_DOCS_BRIDGE_NAMESPACE = "corrija-me-pt-br-google-docs";
const docsBridgeFrameId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const GOOGLE_DOCS_EDITOR_SELECTORS = [
  'div[role="textbox"][aria-multiline="true"]',
  'div[role="textbox"]',
  'textarea[aria-label]',
  'textarea',
  '[contenteditable="true"]'
];

type CheckReplacement = { value: string };
type CheckMatch = {
  message: string;
  offset: number;
  length: number;
  replacements: CheckReplacement[];
};

type PopupResultItem = {
  message: string;
  excerpt: string;
  replacements: string[];
};

let activeElement: HTMLElement | HTMLInputElement | HTMLTextAreaElement | null = null;
let activeRequestId = 0;
let debounceTimer: number | null = null;
let latestMatches: CheckMatch[] = [];
let latestText = "";
let latestStatusMessage = "Foque em um campo de texto para ver as correcoes.";
let latestStatusTone = "";
let inputOverlayHost: HTMLDivElement | null = null;
let inputOverlayContent: HTMLDivElement | null = null;

const suggestionMenu = document.createElement("section");
suggestionMenu.className = "corrija-me-pt-br-menu corrija-me-pt-br-hidden";
document.documentElement.appendChild(suggestionMenu);

let googleDocsHint: HTMLElement | null = null;

function isSupportedElement(element: Element | null): element is HTMLElement | HTMLInputElement | HTMLTextAreaElement {
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

function isVisibleElement(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
}

function findGoogleDocsEditor(): HTMLElement | HTMLTextAreaElement | null {
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

function activateElement(element: HTMLElement | HTMLInputElement | HTMLTextAreaElement): void {
  activeElement = element;
  activeElement.setAttribute("spellcheck", "false");
  if (useGoogleDocsFrameBridge) {
    postGoogleDocsBridgeMessage({ type: "activate" });
  }
}

function findFallbackEditableElement(): HTMLElement | HTMLInputElement | HTMLTextAreaElement | null {
  const currentActive = document.activeElement;
  if (isSupportedElement(currentActive instanceof Element ? currentActive : null)) {
    return currentActive as HTMLElement | HTMLInputElement | HTMLTextAreaElement;
  }

  const candidates = Array.from(document.querySelectorAll("textarea, input, [contenteditable='true'], [role='textbox']"));
  for (const candidate of candidates) {
    if (isSupportedElement(candidate) && isVisibleElement(candidate)) {
      return candidate;
    }
  }

  return null;
}

function ensureActiveElement(): void {
  if (activeElement && isSupportedElement(activeElement)) {
    return;
  }

  const fallback = isGoogleDocsHost ? findGoogleDocsEditor() || findFallbackEditableElement() : findFallbackEditableElement();
  if (fallback) {
    activateElement(fallback);
  }
}

function getText(element: HTMLElement | HTMLInputElement | HTMLTextAreaElement | null): string {
  if (!element) {
    return "";
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || "";
  }
  return (element.textContent || "").replace(/\u00a0/g, " ");
}

function setText(element: HTMLElement | HTMLInputElement | HTMLTextAreaElement, text: string): void {
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

function replaceTextRange(text: string, offset: number, length: number, replacement: string): string {
  return text.slice(0, offset) + replacement + text.slice(offset + length);
}

function hideSuggestionMenu(): void {
  suggestionMenu.classList.add("corrija-me-pt-br-hidden");
  suggestionMenu.innerHTML = "";
}

async function shouldShowGoogleDocsHint(): Promise<boolean> {
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

async function dismissGoogleDocsHint(): Promise<void> {
  try {
    await chrome.storage.local.set({ [DOCS_HINT_DISMISSED_KEY]: true });
  } catch {
    // Ignore storage failures when the extension context is being reloaded.
  }
  googleDocsHint?.remove();
  googleDocsHint = null;
}

async function maybeShowGoogleDocsHint(): Promise<void> {
  if (!(await shouldShowGoogleDocsHint()) || googleDocsHint) {
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

function setStatus(message: string, tone = ""): void {
  latestStatusMessage = message;
  latestStatusTone = tone;
}

function getExcerpt(match: CheckMatch): string {
  const start = Math.max(0, match.offset - 25);
  const end = Math.min(latestText.length, match.offset + match.length + 25);
  return latestText.slice(start, end).replace(/\s+/g, " ").trim();
}

function getPopupResults(): PopupResultItem[] {
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
    hasActiveElement: Boolean(activeElement),
    activeElementType: activeElement instanceof HTMLTextAreaElement
      ? "textarea"
      : activeElement instanceof HTMLInputElement
        ? "input"
        : activeElement instanceof HTMLElement && (activeElement.isContentEditable || activeElement.getAttribute("role") === "textbox")
          ? "editable"
          : "none"
  };
}

function clearHighlights(): void {
  if (!supportsCustomHighlights) {
    return;
  }
  (CSS.highlights as unknown as Map<string, Highlight>).delete(HIGHLIGHT_NAME);
}

function isInputLikeElement(element: HTMLElement | HTMLInputElement | HTMLTextAreaElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function ensureInputOverlay(): void {
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

function hideInputOverlay(): void {
  inputOverlayHost?.classList.add("corrija-me-pt-br-hidden");
  if (inputOverlayContent) {
    inputOverlayContent.innerHTML = "";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function syncInputOverlayPosition(element: HTMLInputElement | HTMLTextAreaElement): void {
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

function renderInputOverlay(matches: CheckMatch[]): void {
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
  const parts: string[] = [];
  const sortedMatches = matches
    .map((match, originalIndex) => ({ match, originalIndex }))
    .sort((left, right) => left.match.offset - right.match.offset);

  for (const entry of sortedMatches) {
    const { match, originalIndex } = entry;
    const start = Math.max(0, Math.min(latestText.length, match.offset));
    const end = Math.max(start, Math.min(latestText.length, match.offset + match.length));
    if (start > cursor) {
      parts.push(`<span class="corrija-me-pt-br-overlay-text">${escapeHtml(latestText.slice(cursor, start))}</span>`);
    }

    const fragment = latestText.slice(start, end) || " ";
    parts.push(
      `<button type="button" class="corrija-me-pt-br-overlay-hit" data-match-index="${originalIndex}" aria-label="Abrir sugestoes para ${escapeHtml(fragment)}">` +
      `${escapeHtml(fragment)}` +
      "</button>"
    );
    cursor = end;
  }

  if (cursor < latestText.length) {
    parts.push(`<span class="corrija-me-pt-br-overlay-text">${escapeHtml(latestText.slice(cursor))}</span>`);
  }

  inputOverlayContent.innerHTML = parts.join("");
  syncInputOverlayPosition(activeElement);
}

function isContentEditableLike(element: HTMLElement | HTMLInputElement | HTMLTextAreaElement): element is HTMLElement {
  return element instanceof HTMLElement && (element.isContentEditable || element.getAttribute("role") === "textbox");
}

function getEditableTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      nodes.push(current);
    }
    current = walker.nextNode();
  }
  return nodes;
}

function createRangeFromOffsets(root: HTMLElement, offset: number, length: number): Range | null {
  const textNodes = getEditableTextNodes(root);
  if (!textNodes.length) {
    return null;
  }

  let startNode: Text | null = null;
  let endNode: Text | null = null;
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

function renderHighlightsForActiveElement(matches: CheckMatch[]): void {
  clearHighlights();

  if (!supportsCustomHighlights || !activeElement || !isContentEditableLike(activeElement)) {
    return;
  }

  const ranges = matches
    .map((match) => createRangeFromOffsets(activeElement as HTMLElement, match.offset, match.length))
    .filter((range): range is Range => range !== null);

  if (!ranges.length) {
    return;
  }

  const highlight = new Highlight(...ranges);
  (CSS.highlights as unknown as Map<string, Highlight>).set(HIGHLIGHT_NAME, highlight);
}

function getLinearOffset(root: HTMLElement, node: Node, offset: number): number | null {
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

function getMatchIndexAtOffset(offset: number): number {
  return latestMatches.findIndex((match) => offset >= match.offset && offset <= match.offset + match.length);
}

function openSuggestionMenu(index: number, x: number, y: number): void {
  const match = latestMatches[index];
  if (!match) {
    hideSuggestionMenu();
    return;
  }

  suggestionMenu.innerHTML = "";

  const replacements = Array.isArray(match.replacements) ? match.replacements.slice(0, 2) : [];
  if (!replacements.length) {
    const empty = document.createElement("div");
    empty.className = "corrija-me-pt-br-menu-empty";
    empty.textContent = "Sem sugestao.";
    suggestionMenu.appendChild(empty);
  } else {
    for (const replacement of replacements) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "corrija-me-pt-br-menu-item";
      button.textContent = replacement.value;
      button.addEventListener("click", () => {
        applySingleCorrection(index, replacement.value);
        hideSuggestionMenu();
      });
      suggestionMenu.appendChild(button);
    }
  }

  suggestionMenu.style.left = `${Math.min(window.innerWidth - 240, Math.max(12, x))}px`;
  suggestionMenu.style.top = `${Math.min(window.innerHeight - 220, Math.max(12, y + 12))}px`;
  suggestionMenu.classList.remove("corrija-me-pt-br-hidden");
}

function postGoogleDocsBridgeMessage(payload: Record<string, unknown>): void {
  if (!useGoogleDocsFrameBridge) {
    return;
  }

  window.top?.postMessage({
    namespace: GOOGLE_DOCS_BRIDGE_NAMESPACE,
    frameId: docsBridgeFrameId,
    ...payload
  }, "*");
}

function syncGoogleDocsBridgeState(statusMessage: string): void {
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

function applyReplacementToContentEditable(element: HTMLElement, match: CheckMatch, replacement: string): boolean {
  const range = createRangeFromOffsets(element, match.offset, match.length);
  if (!range) {
    return false;
  }

  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function renderResults(matches: CheckMatch[]): void {
  latestMatches = matches;
  renderHighlightsForActiveElement(matches);
  renderInputOverlay(matches);
}

async function analyzeActiveElement(manual = false): Promise<void> {
  ensureActiveElement();
  if (!activeElement || !isSupportedElement(activeElement)) {
    return;
  }

  const text = getText(activeElement);
  latestText = text;
  hideSuggestionMenu();

  if (text.trim().length < MIN_TEXT_LENGTH) {
    latestMatches = [];
    clearHighlights();
    hideInputOverlay();
    setStatus("Digite um pouco mais para analisar esse campo.");
    renderResults([]);
    syncGoogleDocsBridgeState("Digite um pouco mais para analisar esse campo.");
    return;
  }

  const requestId = ++activeRequestId;
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

    const data = await response.json() as { matches?: CheckMatch[] };
    if (requestId !== activeRequestId) {
      return;
    }

    const matches = Array.isArray(data.matches) ? data.matches : [];
    renderResults(matches);
    const statusMessage = matches.length ? `${matches.length} sugestao(oes) encontrada(s).` : "Nenhum problema encontrado.";
    setStatus(statusMessage, "ok");
    syncGoogleDocsBridgeState(statusMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    setStatus(`Falha ao consultar o backend local: ${message}`, "error");
    clearHighlights();
    hideInputOverlay();
    renderResults([]);
    syncGoogleDocsBridgeState(`Falha ao consultar o backend local: ${message}`);
  }
}

function applySingleCorrection(index: number, replacement: string): void {
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

function applyAllCorrections(): void {
  if (!activeElement || !latestMatches.length) {
    return;
  }

  if (activeElement instanceof HTMLElement && (activeElement.isContentEditable || activeElement.getAttribute("role") === "textbox")) {
    const sortedMatches = [...latestMatches]
      .filter((match) => match.replacements?.length)
      .sort((left, right) => right.offset - left.offset);

    for (const match of sortedMatches) {
      applyReplacementToContentEditable(activeElement, match, match.replacements[0].value);
    }

    latestText = getText(activeElement);
    void analyzeActiveElement(true);
    return;
  }

  let updatedText = getText(activeElement);
  const sortedMatches = [...latestMatches]
    .filter((match) => match.replacements?.length)
    .sort((left, right) => right.offset - left.offset);

  for (const match of sortedMatches) {
    updatedText = replaceTextRange(updatedText, match.offset, match.length, match.replacements[0].value);
  }

  setText(activeElement, updatedText);
  latestText = updatedText;
  void analyzeActiveElement(true);
}

function scheduleAnalysis(): void {
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
  activateElement(target as HTMLElement | HTMLInputElement | HTMLTextAreaElement);
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
}, true);

window.addEventListener("resize", () => {
  if (activeElement && isInputLikeElement(activeElement)) {
    syncInputOverlayPosition(activeElement);
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

document.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement && target.classList.contains("corrija-me-pt-br-overlay-hit")) {
    const index = Number(target.dataset.matchIndex ?? "-1");
    if (Number.isInteger(index) && index >= 0) {
      const rect = target.getBoundingClientRect();
      openSuggestionMenu(index, rect.left, rect.bottom);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  if (target instanceof Node && suggestionMenu.contains(target)) {
    return;
  }

  if (!(activeElement instanceof HTMLElement) || (!activeElement.isContentEditable && activeElement.getAttribute("role") !== "textbox")) {
    hideSuggestionMenu();
    return;
  }

  if (!(target instanceof Node) || !activeElement.contains(target)) {
    hideSuggestionMenu();
    return;
  }

  const mouseEvent = event as MouseEvent;
  const caretRangeFromPoint = document.caretRangeFromPoint?.bind(document);
  const caretPositionFromPoint = document.caretPositionFromPoint?.bind(document);

  let offset: number | null = null;
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

  openSuggestionMenu(matchIndex, mouseEvent.clientX, mouseEvent.clientY);
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
    latestMatches = Array.isArray(payload.matches) ? payload.matches as CheckMatch[] : [];
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
