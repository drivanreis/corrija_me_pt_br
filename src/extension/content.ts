import { getServerUrl, getSettings } from "./server-config.js";

window.__corrijaMePtBrLoaded__ = true;

const MIN_TEXT_LENGTH = 3;
const CHECK_DEBOUNCE_MS = 300;
const CHECK_REQUEST_TIMEOUT_MS = 8000;
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
const MIN_VISIBLE_CONFIDENCE_SCORE = 0.68;

type CheckReplacement = { value: string };
type CheckConfidence = {
  level?: "high" | "medium" | "low";
  score?: number;
  reason?: string;
};

type CheckMatch = {
  message: string;
  offset: number;
  length: number;
  replacements: CheckReplacement[];
  sourceText?: string;
  compositeGroupId?: string;
  confidence?: CheckConfidence;
  rule?: {
    id?: string;
  };
};

type PopupResultItem = {
  message: string;
  excerpt: string;
  replacements: string[];
};

type DiffToken = {
  text: string;
  start: number;
  end: number;
};

type DiffGroup = {
  srcText: string;
  tgtText: string;
  srcCharStart: number;
  srcCharEnd: number;
};

let activeElement: HTMLElement | HTMLInputElement | HTMLTextAreaElement | null = null;
let activeRequestId = 0;
let debounceTimer: number | null = null;
let latestMatches: CheckMatch[] = [];
let latestText = "";
let latestStatusMessage = "Foque em um campo de texto para ver as correcoes.";
let latestStatusTone = "";
let isAnalyzing = false;
let inputOverlayHost: HTMLDivElement | null = null;
let inputOverlayContent: HTMLDivElement | null = null;
let suppressNextClickHideUntil = 0;
let activeElementSessionId = 0;
const ignoredMatchSignatures = new Map<number, Set<string>>();
let latestHiddenWeakCount = 0;
let highlightedSuggestionIndex = -1;
let suggestionAnchorIndex = -1;
let activeCheckAbortController: AbortController | null = null;
let pendingAnalysisMode: "manual" | "auto" | null = null;

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
  if (activeElement !== element) {
    activeElementSessionId += 1;
    activeRequestId += 1;
    activeCheckAbortController?.abort();
    activeCheckAbortController = null;
    isAnalyzing = false;
    pendingAnalysisMode = null;
    latestMatches = [];
    latestHiddenWeakCount = 0;
    latestText = getText(element);
    highlightedSuggestionIndex = -1;
    suggestionAnchorIndex = -1;
    hideSuggestionMenu();
    clearHighlights();
    hideInputOverlay();
  }
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

function tokenizeWithOffsets(text: string): DiffToken[] {
  const tokens: DiffToken[] = [];
  const pattern = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    tokens.push({ text: token, start, end: start + token.length });
  }
  return tokens;
}

function normalizeCompositeToken(text: string): string {
  return text.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}

function buildSpecialCompositeGroups(sourceText: string, targetText: string): DiffGroup[] | null {
  const sourceTokens = tokenizeWithOffsets(sourceText);
  const targetTokens = tokenizeWithOffsets(targetText);

  if (
    sourceTokens.length < 2
    || targetTokens.length < 3
    || targetTokens[1]?.text !== "-"
  ) {
    return null;
  }

  const sourcePronoun = normalizeCompositeToken(sourceTokens[0]?.text || "");
  const sourceVerb = normalizeCompositeToken(sourceTokens[1]?.text || "");
  const targetVerb = normalizeCompositeToken(targetTokens[0]?.text || "");
  const targetPronoun = normalizeCompositeToken(targetTokens[2]?.text || "");

  if (!sourcePronoun || !sourceVerb || sourcePronoun !== targetPronoun || sourceVerb !== targetVerb) {
    return null;
  }

  const leadingGroup: DiffGroup = {
    srcText: sourceText.slice(sourceTokens[0].start, sourceTokens[1].end),
    tgtText: targetText.slice(targetTokens[0].start, targetTokens[2].end),
    srcCharStart: sourceTokens[0].start,
    srcCharEnd: sourceTokens[1].end
  };

  const sourceTailStart = sourceTokens[1].end;
  const targetTailStart = targetTokens[2].end;
  const tailGroups = buildTokenDiffGroups(
    tokenizeWithOffsets(sourceText.slice(sourceTailStart)),
    tokenizeWithOffsets(targetText.slice(targetTailStart))
  ).map((group) => ({
    ...group,
    srcCharStart: group.srcCharStart + sourceTailStart,
    srcCharEnd: group.srcCharEnd + sourceTailStart
  }));

  return [leadingGroup, ...tailGroups];
}

function mergeAdjacentDiffGroups(groups: DiffGroup[], sourceText: string): DiffGroup[] {
  if (groups.length < 2) {
    return groups;
  }

  const merged: DiffGroup[] = [];

  for (const group of groups) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push(group);
      continue;
    }

    const betweenText = sourceText.slice(previous.srcCharEnd, group.srcCharStart);
    const isWhitespaceOnly = betweenText.length > 0 && /^\s+$/u.test(betweenText);
    const previousTargetHasNoWhitespace = !/\s/u.test(previous.tgtText);
    const currentTargetHasNoWhitespace = !/\s/u.test(group.tgtText);

    if (!isWhitespaceOnly || !previousTargetHasNoWhitespace || !currentTargetHasNoWhitespace) {
      merged.push(group);
      continue;
    }

    previous.srcText = `${previous.srcText}${betweenText}${group.srcText}`;
    previous.tgtText = `${previous.tgtText}${group.tgtText}`;
    previous.srcCharEnd = group.srcCharEnd;
  }

  return merged;
}

function buildTokenDiffGroups(sourceTokens: DiffToken[], targetTokens: DiffToken[]): DiffGroup[] {
  const rows = sourceTokens.length + 1;
  const cols = targetTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    dp[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    dp[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (sourceTokens[row - 1]?.text === targetTokens[col - 1]?.text) {
        dp[row][col] = dp[row - 1][col - 1];
      } else {
        dp[row][col] = Math.min(
          dp[row - 1][col] + 1,
          dp[row][col - 1] + 1,
          dp[row - 1][col - 1] + 1
        );
      }
    }
  }

  const operations: Array<{ type: "equal" | "replace" | "delete" | "insert"; srcIndex?: number; tgtIndex?: number }> = [];
  let row = sourceTokens.length;
  let col = targetTokens.length;

  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && sourceTokens[row - 1]?.text === targetTokens[col - 1]?.text) {
      operations.push({ type: "equal", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
      continue;
    }

    const replaceCost = row > 0 && col > 0 ? dp[row - 1][col - 1] : Number.POSITIVE_INFINITY;
    const deleteCost = row > 0 ? dp[row - 1][col] : Number.POSITIVE_INFINITY;
    const currentCost = dp[row][col];

    if (row > 0 && col > 0 && currentCost === replaceCost + 1) {
      operations.push({ type: "replace", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
    } else if (row > 0 && currentCost === deleteCost + 1) {
      operations.push({ type: "delete", srcIndex: row - 1 });
      row -= 1;
    } else {
      operations.push({ type: "insert", tgtIndex: col - 1 });
      col -= 1;
    }
  }

  operations.reverse();

  const groups: DiffGroup[] = [];
  let current:
    | { srcStartToken: number; srcEndToken: number; srcTexts: string[]; tgtTexts: string[] }
    | null = null;
  let sourceCursor = 0;

  function closeGroup() {
    if (!current) {
      return;
    }
    const slice = sourceTokens.slice(current.srcStartToken, current.srcEndToken);
    const srcCharStart = slice[0]?.start ?? 0;
    const srcCharEnd = slice[slice.length - 1]?.end ?? srcCharStart;
    groups.push({
      srcText: current.srcTexts.join(" ").trim(),
      tgtText: current.tgtTexts.join(" ").trim(),
      srcCharStart,
      srcCharEnd
    });
    current = null;
  }

  operations.forEach((operation) => {
    if (operation.type === "equal") {
      closeGroup();
      sourceCursor += 1;
      return;
    }

    if (operation.type === "replace") {
      closeGroup();
    }

    if (!current) {
      current = {
        srcStartToken: sourceCursor,
        srcEndToken: sourceCursor,
        srcTexts: [],
        tgtTexts: []
      };
    }

    if (operation.type === "replace") {
      current.srcTexts.push(sourceTokens[operation.srcIndex ?? 0]?.text || "");
      current.tgtTexts.push(targetTokens[operation.tgtIndex ?? 0]?.text || "");
      sourceCursor += 1;
      current.srcEndToken = sourceCursor;
      closeGroup();
      return;
    } else if (operation.type === "delete") {
      current.srcTexts.push(sourceTokens[operation.srcIndex ?? 0]?.text || "");
      sourceCursor += 1;
    } else {
      current.tgtTexts.push(targetTokens[operation.tgtIndex ?? 0]?.text || "");
    }

    current.srcEndToken = sourceCursor;
  });

  closeGroup();
  return groups.filter((group) => group.srcText && group.tgtText && group.srcCharEnd > group.srcCharStart);
}

function countRegexMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function looksLikeUrlOnly(text: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(text);
}

function looksLikeEmailOnly(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function looksLikeJwt(text: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text);
}

function looksLikeUuid(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
}

function looksLikeHashOrApiKey(text: string): boolean {
  return /^[A-Za-z0-9+/_=-]{24,}$/.test(text)
    && !/[ .,!?:;()[\]{}]/.test(text)
    && !/[aeiouáéíóúàâêôãõ]/i.test(text);
}

function looksLikeEndpointOrPath(text: string): boolean {
  return /^[/A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\?[^ ]*)?$/.test(text)
    && /[/?=&_-]/.test(text)
    && !/\s/.test(text);
}

function looksLikePixOrDocumentKey(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /^\+?\d{10,16}$/.test(compact)
    || /^\d{11}$/.test(compact)
    || /^\d{14}$/.test(compact)
    || /^[0-9a-f]{32}$/i.test(compact);
}

function classifyNonLinguisticText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return "Campo vazio.";
  }

  if (looksLikeUrlOnly(trimmed)) {
    return "Conteúdo parece ser apenas um link.";
  }

  if (looksLikeEmailOnly(trimmed)) {
    return "Conteúdo parece ser apenas um e-mail.";
  }

  if (looksLikeJwt(trimmed) || looksLikeUuid(trimmed) || looksLikeHashOrApiKey(trimmed)) {
    return "Conteúdo parece ser uma chave, token ou identificador.";
  }

  if (looksLikePixOrDocumentKey(trimmed)) {
    return "Conteúdo parece ser uma chave numérica ou identificador de pagamento.";
  }

  if (looksLikeEndpointOrPath(trimmed)) {
    return "Conteúdo parece ser um endpoint, caminho ou string técnica.";
  }

  const letters = countRegexMatches(trimmed, /\p{L}/gu);
  const digits = countRegexMatches(trimmed, /\d/g);
  const whitespace = countRegexMatches(trimmed, /\s/g);
  const punctuation = countRegexMatches(trimmed, /[.,!?;:]/g);
  const technicalChars = countRegexMatches(trimmed, /[_/=&#:%@[\]{}<>\\|$+-]/g);
  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasSentenceShape = punctuation > 0 || words.length >= 3;
  const letterRatio = trimmed.length ? letters / trimmed.length : 0;

  if (!hasSentenceShape && digits >= letters && technicalChars >= 2) {
    return "Conteúdo parece técnico demais para revisão gramatical.";
  }

  if (!hasSentenceShape && letterRatio < 0.45 && (digits >= 4 || technicalChars >= 3 || whitespace === 0)) {
    return "Conteúdo não parece uma frase em português.";
  }

  return null;
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
  highlightedSuggestionIndex = -1;
  suggestionAnchorIndex = -1;
}

function shouldIgnoreHideAfterPointerGesture(): boolean {
  return Date.now() < suppressNextClickHideUntil;
}

function markPointerGestureForSuggestionMenu(): void {
  suppressNextClickHideUntil = Date.now() + 400;
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
    hiddenWeakMatches: latestHiddenWeakCount,
    isAnalyzing,
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

function getMatchConfidenceScore(match: CheckMatch): number {
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

function shouldHideWeakMatch(match: CheckMatch): boolean {
  return match.confidence?.level === "low" || getMatchConfidenceScore(match) < MIN_VISIBLE_CONFIDENCE_SCORE;
}

function compareMatchesByUiPriority(left: CheckMatch, right: CheckMatch): number {
  return getMatchConfidenceScore(right) - getMatchConfidenceScore(left)
    || left.offset - right.offset
    || left.length - right.length;
}

function normalizeMatchSignaturePart(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchText(match: CheckMatch, text: string): string {
  if (typeof match.sourceText === "string" && match.sourceText.length > 0) {
    return match.sourceText;
  }
  const start = Math.max(0, Math.min(text.length, match.offset));
  const end = Math.max(start, Math.min(text.length, match.offset + match.length));
  return text.slice(start, end);
}

function createMatchSignature(match: CheckMatch, text: string): string {
  const snippet = getMatchText(match, text);
  const contextStart = Math.max(0, match.offset - 12);
  const contextEnd = Math.min(text.length, match.offset + match.length + 12);
  const localContext = text.slice(contextStart, contextEnd);
  const firstReplacement = Array.isArray(match.replacements) && match.replacements[0]
    ? match.replacements[0].value
    : "";

  return [
    normalizeMatchSignaturePart(match.rule?.id || "sem-regra"),
    normalizeMatchSignaturePart(snippet),
    normalizeMatchSignaturePart(firstReplacement),
    normalizeMatchSignaturePart(localContext)
  ].join("::");
}

function getIgnoredMatchSet(sessionId: number): Set<string> {
  let ignored = ignoredMatchSignatures.get(sessionId);
  if (!ignored) {
    ignored = new Set<string>();
    ignoredMatchSignatures.set(sessionId, ignored);
  }
  return ignored;
}

function filterIgnoredMatches(matches: CheckMatch[], text: string, sessionId: number): CheckMatch[] {
  const ignored = ignoredMatchSignatures.get(sessionId);
  if (!ignored?.size) {
    return matches;
  }

  return matches.filter((match) => !ignored.has(createMatchSignature(match, text)));
}

function isLikelyPluralAdjustment(sourceText: string, targetText: string): boolean {
  const source = normalizeMatchSignaturePart(sourceText);
  const target = normalizeMatchSignaturePart(targetText);
  return (target.endsWith("s") && !source.endsWith("s"))
    || (target.endsWith("m") && !source.endsWith("m"))
    || (target.endsWith("as") && !source.endsWith("as"))
    || (target.endsWith("os") && !source.endsWith("os"));
}

function getExpandedMatchMessage(sourceText: string, targetText: string, fallbackMessage: string): string {
  if (isLikelyPluralAdjustment(sourceText, targetText)) {
    return "Tem que estar no plural.";
  }
  return fallbackMessage || "Possível ajuste encontrado.";
}

function createCompositeGroupId(match: CheckMatch, text: string, primaryReplacement: string): string {
  return [
    normalizeMatchSignaturePart(match.rule?.id || "sem-regra"),
    String(match.offset),
    String(match.length),
    normalizeMatchSignaturePart(getMatchText(match, text)),
    normalizeMatchSignaturePart(primaryReplacement)
  ].join("::");
}

function expandCompositeMatches(matches: CheckMatch[], text: string): CheckMatch[] {
  const expanded: CheckMatch[] = [];

  matches.forEach((match) => {
    const primaryReplacement = Array.isArray(match.replacements) ? match.replacements[0]?.value : "";
    const sourceText = getMatchText(match, text);

    if (!primaryReplacement || !/\s/.test(sourceText) || !/\s/.test(primaryReplacement)) {
      expanded.push(match);
      return;
    }

    const validGroups = mergeAdjacentDiffGroups(
      (buildSpecialCompositeGroups(sourceText, primaryReplacement)
        || buildTokenDiffGroups(tokenizeWithOffsets(sourceText), tokenizeWithOffsets(primaryReplacement))),
      sourceText
    )
      .slice(0, 6);

    if (validGroups.length < 1) {
      expanded.push(match);
      return;
    }

    const compositeGroupId = createCompositeGroupId(match, text, primaryReplacement);

    validGroups.forEach((group) => {
      expanded.push({
        ...match,
        offset: match.offset + group.srcCharStart,
        length: group.srcCharEnd - group.srcCharStart,
        sourceText: group.srcText,
        compositeGroupId,
        message: getExpandedMatchMessage(group.srcText, group.tgtText, match.message),
        replacements: [{ value: group.tgtText }]
      });
    });
  });

  return expanded;
}

function dedupeMatches(matches: CheckMatch[], text: string): CheckMatch[] {
  const seen = new Set<string>();
  const deduped: CheckMatch[] = [];

  matches.forEach((match) => {
    const signature = createMatchSignature(match, text);
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    deduped.push(match);
  });

  return deduped;
}

function prepareVisibleMatches(matches: CheckMatch[]): CheckMatch[] {
  const expanded = expandCompositeMatches(matches, latestText);
  const merged = dedupeMatches(expanded, latestText);
  const visible = merged.filter((match) => !shouldHideWeakMatch(match));
  latestHiddenWeakCount = Math.max(0, merged.length - visible.length);
  return visible.sort(compareMatchesByUiPriority);
}

function getConfidenceLabel(match: CheckMatch): string {
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

function getSuggestionAnchorRect(): DOMRect | null {
  if (suggestionAnchorIndex < 0) {
    return null;
  }

  const overlayHit = inputOverlayContent?.querySelector<HTMLElement>(`[data-match-index="${suggestionAnchorIndex}"]`);
  if (overlayHit) {
    const rect = overlayHit.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect;
    }
  }

  if (activeElement && isContentEditableLike(activeElement)) {
    const match = latestMatches[suggestionAnchorIndex];
    if (!match) {
      return null;
    }
    const range = createRangeFromOffsets(activeElement, match.offset, match.length);
    const rect = range?.getBoundingClientRect() ?? null;
    if (rect && rect.width >= 0 && rect.height > 0) {
      return rect;
    }
  }

  return null;
}

function syncSuggestionMenuPosition(): void {
  if (!activeElement || !isVisibleElement(activeElement)) {
    suggestionMenu.classList.add("corrija-me-pt-br-hidden");
    return;
  }

  const rect = activeElement.getBoundingClientRect();
  const styles = window.getComputedStyle(activeElement);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 8;
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 8;
  const fieldWidth = Math.max(140, rect.width - Math.max(12, paddingLeft * 2));
  const panelWidth = Math.min(fieldWidth, window.innerWidth - 24);
  const anchorRect = getSuggestionAnchorRect();
  const fallbackInsideTop = rect.top + paddingTop + lineHeight + 8;
  const anchorLeft = anchorRect ? anchorRect.left : rect.left + paddingLeft;
  const anchorBottom = anchorRect ? anchorRect.bottom : fallbackInsideTop;
  const left = Math.max(12, Math.min(window.innerWidth - panelWidth - 12, anchorLeft));
  const preferredTop = anchorBottom + 8 <= rect.bottom
    ? anchorBottom + 8
    : rect.bottom + 8;
  const top = Math.max(12, Math.min(window.innerHeight - 80, preferredTop));

  suggestionMenu.style.width = "auto";
  suggestionMenu.style.maxWidth = `${panelWidth}px`;
  suggestionMenu.style.minWidth = "0";
  suggestionMenu.style.left = `${left}px`;
  suggestionMenu.style.top = `${top}px`;
}

function focusSuggestionCard(index: number): void {
  const card = suggestionMenu.querySelector<HTMLElement>(`[data-suggestion-card="${index}"]`);
  if (!card) {
    return;
  }
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderSuggestionPanel(focusIndex = highlightedSuggestionIndex): void {
  if (!latestMatches.length || !activeElement) {
    hideSuggestionMenu();
    return;
  }

  highlightedSuggestionIndex = focusIndex >= 0 ? focusIndex : -1;
  if (focusIndex >= 0) {
    suggestionAnchorIndex = focusIndex;
  } else if (suggestionAnchorIndex >= latestMatches.length) {
    suggestionAnchorIndex = -1;
  }
  suggestionMenu.innerHTML = "";

  const list = document.createElement("div");
  list.className = "corrija-me-pt-br-menu-list";

  latestMatches.forEach((match, index) => {
    const card = document.createElement("article");
    card.className = "corrija-me-pt-br-menu-card";
    if (index === highlightedSuggestionIndex) {
      card.classList.add("corrija-me-pt-br-menu-card-active");
    }
    card.dataset.suggestionCard = String(index);

    const replacements = Array.isArray(match.replacements) ? match.replacements.slice(0, 1) : [];
    const topRow = document.createElement("div");
    topRow.className = "corrija-me-pt-br-menu-card-top";

    const suggestionButton = document.createElement("button");
    suggestionButton.type = "button";
    suggestionButton.className = "corrija-me-pt-br-menu-suggestion";
    suggestionButton.textContent = replacements[0]?.value || "Sem sugestão";
    if ((replacements[0]?.value || "").length <= 5) {
      card.classList.add("corrija-me-pt-br-menu-card-compact");
    }
    if (replacements[0]?.value) {
      suggestionButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applySingleCorrection(index, replacements[0].value);
      });
    } else {
      suggestionButton.disabled = true;
    }
    topRow.appendChild(suggestionButton);

    const controls = document.createElement("div");
    controls.className = "corrija-me-pt-br-menu-controls";

    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.className = "corrija-me-pt-br-menu-control corrija-me-pt-br-menu-control-dismiss";
    dismissButton.textContent = "(x)";
    dismissButton.title = "Ignorar sugestão";
    dismissButton.setAttribute("aria-label", "Ignorar sugestão");
    dismissButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      ignoreMatch(index);
    });
    controls.appendChild(dismissButton);

    const confidenceButton = document.createElement("button");
    confidenceButton.type = "button";
    confidenceButton.className = `corrija-me-pt-br-menu-control corrija-me-pt-br-menu-confidence corrija-me-pt-br-menu-confidence-${match.confidence?.level || "default"}`;
    confidenceButton.textContent = "(c)";
    confidenceButton.title = getConfidenceLabel(match);
    confidenceButton.setAttribute("aria-label", getConfidenceLabel(match));
    confidenceButton.disabled = true;
    controls.appendChild(confidenceButton);

    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "corrija-me-pt-br-menu-control corrija-me-pt-br-menu-control-info";
    infoButton.textContent = "(i)";
    infoButton.title = match.message || "Possível ajuste encontrado.";
    infoButton.setAttribute("aria-label", match.message || "Possível ajuste encontrado.");
    infoButton.disabled = true;
    controls.appendChild(infoButton);

    topRow.appendChild(controls);

    card.appendChild(topRow);
    list.appendChild(card);
  });

  suggestionMenu.appendChild(list);
  syncSuggestionMenuPosition();
  suggestionMenu.classList.remove("corrija-me-pt-br-hidden");

  if (highlightedSuggestionIndex >= 0) {
    focusSuggestionCard(highlightedSuggestionIndex);
  }
}

function ignoreMatch(index: number): void {
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

function openSuggestionMenu(index: number, x: number, y: number): void {
  if (!latestMatches[index]) {
    hideSuggestionMenu();
    return;
  }
  void x;
  void y;
  suggestionAnchorIndex = index;
  renderSuggestionPanel(index);
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

function dispatchInputLikeEvent(type: "beforeinput" | "input", inputType: string, data: string): Event {
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

function applyReplacementToContentEditable(element: HTMLElement, match: CheckMatch, replacement: string): boolean {
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

  let applied: boolean;
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

function renderResults(matches: CheckMatch[]): void {
  latestMatches = matches;
  renderHighlightsForActiveElement(matches);
  renderInputOverlay(matches);
  renderSuggestionPanel();
}

async function analyzeActiveElement(manual = false): Promise<void> {
  ensureActiveElement();
  if (!activeElement || !isSupportedElement(activeElement)) {
    return;
  }

  if (isAnalyzing) {
    pendingAnalysisMode = manual ? "manual" : pendingAnalysisMode ?? "auto";
    return;
  }

  const text = getText(activeElement);
  latestText = text;
  if (!manual) {
    hideSuggestionMenu();
  }

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

  activeCheckAbortController?.abort();
  const abortController = new AbortController();
  activeCheckAbortController = abortController;
  isAnalyzing = true;
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
      body: payload.toString(),
      signal: AbortSignal.any([
        abortController.signal,
        AbortSignal.timeout(CHECK_REQUEST_TIMEOUT_MS)
      ])
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as { matches?: CheckMatch[] };
    if (requestId !== activeRequestId) {
      return;
    }

    const filteredMatches = filterIgnoredMatches(Array.isArray(data.matches) ? data.matches : [], text, sessionId);
    const matches = prepareVisibleMatches(filteredMatches);
    renderResults(matches);
    const statusMessage = matches.length
      ? latestHiddenWeakCount
        ? `${matches.length} sugestao(oes) visivel(is). ${latestHiddenWeakCount} fraca(s) oculta(s).`
        : `${matches.length} sugestao(oes) encontrada(s).`
      : latestHiddenWeakCount
        ? `Nenhuma sugestao visivel. ${latestHiddenWeakCount} fraca(s) oculta(s).`
        : "Nenhum problema encontrado.";
    setStatus(statusMessage, "ok");
    syncGoogleDocsBridgeState(statusMessage);
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    setStatus(`Falha ao consultar o backend local: ${message}`, "error");
    clearHighlights();
    hideInputOverlay();
    latestHiddenWeakCount = 0;
    renderResults([]);
    syncGoogleDocsBridgeState(`Falha ao consultar o backend local: ${message}`);
  } finally {
    if (activeCheckAbortController === abortController) {
      activeCheckAbortController = null;
    }
    if (requestId === activeRequestId) {
      isAnalyzing = false;
      const nextMode = pendingAnalysisMode;
      pendingAnalysisMode = null;
      if (nextMode) {
        window.setTimeout(() => {
          void analyzeActiveElement(nextMode === "manual");
        }, 0);
      }
    }
  }
}

function applySingleCorrection(index: number, replacement: string): void {
  if (!activeElement || !latestMatches[index]) {
    return;
  }
  const match = latestMatches[index];
  const previousText = getText(activeElement);
  const delta = replacement.length - match.length;
  const updatedText = replaceTextRange(previousText, match.offset, match.length, replacement);

  if (activeElement instanceof HTMLElement && (activeElement.isContentEditable || activeElement.getAttribute("role") === "textbox")) {
    const applied = applyReplacementToContentEditable(activeElement, match, replacement);
    if (!applied) {
      return;
    }
    latestText = getText(activeElement);
  } else {
    setText(activeElement, updatedText);
    latestText = updatedText;
  }

  const optimisticMatches = latestMatches
    .filter((_, matchIndex) => matchIndex !== index)
    .map((candidate) => {
      const sourceText = candidate.sourceText || getMatchText(candidate, previousText);
      const nextOffset = candidate.offset > match.offset ? candidate.offset + delta : candidate.offset;
      return {
        ...candidate,
        offset: nextOffset,
        sourceText
      };
    })
    .filter((candidate) => {
      const expectedSource = candidate.sourceText || "";
      return expectedSource && getMatchText(candidate, latestText) === expectedSource;
    });

  renderResults(optimisticMatches);
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
