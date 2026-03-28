import { getServerUrl, getSettings } from "./server-config.js";

const MIN_TEXT_LENGTH = 3;
const CHECK_DEBOUNCE_MS = 1100;
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel"]);

type CheckReplacement = { value: string };
type CheckMatch = {
  message: string;
  offset: number;
  length: number;
  replacements: CheckReplacement[];
};

let activeElement: HTMLElement | HTMLInputElement | HTMLTextAreaElement | null = null;
let activeRequestId = 0;
let debounceTimer: number | null = null;
let latestMatches: CheckMatch[] = [];
let latestText = "";

const fab = document.createElement("button");
fab.type = "button";
fab.className = "corrija-me-pt-br-fab corrija-me-pt-br-hidden";
fab.textContent = "Corrigir";
document.documentElement.appendChild(fab);

const panel = document.createElement("section");
panel.className = "corrija-me-pt-br-panel corrija-me-pt-br-hidden";
panel.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;background:linear-gradient(135deg,#fff7e3 0%,#ecfeff 100%);border-bottom:1px solid rgba(15,23,42,.08);">
    <div>
      <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#0f766e;">corrija_me_pt_br</div>
      <div style="font-size:18px;font-weight:800;line-height:1.2;margin-top:4px;">Correcoes do campo atual</div>
    </div>
    <button type="button" data-close style="border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#475569;">×</button>
  </div>
  <div style="padding:14px 18px 8px;display:grid;gap:10px;">
    <div id="cmpb-status" style="font-size:13px;line-height:1.45;color:#475569;">Foque em um campo de texto e clique em Corrigir.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" data-refresh style="border:0;border-radius:999px;background:#0f766e;color:#fff;padding:10px 14px;font-weight:700;cursor:pointer;">Analisar agora</button>
      <button type="button" data-apply-all style="border:0;border-radius:999px;background:#d9f3ef;color:#115e59;padding:10px 14px;font-weight:700;cursor:pointer;">Aplicar tudo</button>
    </div>
  </div>
  <div id="cmpb-results" style="padding:0 18px 18px;overflow:auto;max-height:calc(70vh - 140px);display:grid;gap:12px;"></div>
`;
document.documentElement.appendChild(panel);

const statusNode = panel.querySelector("#cmpb-status") as HTMLDivElement;
const resultsNode = panel.querySelector("#cmpb-results") as HTMLDivElement;

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
  return element instanceof HTMLElement && element.isContentEditable;
}

function getText(element: HTMLElement | HTMLInputElement | HTMLTextAreaElement | null): string {
  if (!element) {
    return "";
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || "";
  }
  return (element.innerText || "").replace(/\r\n/g, "\n");
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
  element.innerText = text;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function replaceTextRange(text: string, offset: number, length: number, replacement: string): string {
  return text.slice(0, offset) + replacement + text.slice(offset + length);
}

function positionFab(): void {
  if (!activeElement || fab.classList.contains("corrija-me-pt-br-hidden")) {
    return;
  }
  const rect = activeElement.getBoundingClientRect();
  const top = Math.max(12, rect.bottom - 46);
  const left = Math.max(12, Math.min(window.innerWidth - fab.offsetWidth - 12, rect.right - fab.offsetWidth));
  fab.style.top = `${top}px`;
  fab.style.left = `${left}px`;
}

function showFab(): void {
  fab.classList.remove("corrija-me-pt-br-hidden");
  positionFab();
}

function hideFab(): void {
  fab.classList.add("corrija-me-pt-br-hidden");
}

function showPanel(): void {
  panel.classList.remove("corrija-me-pt-br-hidden");
}

function hidePanel(): void {
  panel.classList.add("corrija-me-pt-br-hidden");
}

function setStatus(message: string, tone = ""): void {
  statusNode.textContent = message;
  statusNode.style.color = tone === "error" ? "#b42318" : tone === "ok" ? "#115e59" : "#475569";
}

function getExcerpt(match: CheckMatch): string {
  const start = Math.max(0, match.offset - 25);
  const end = Math.min(latestText.length, match.offset + match.length + 25);
  return latestText.slice(start, end).replace(/\s+/g, " ").trim();
}

function renderResults(matches: CheckMatch[]): void {
  latestMatches = matches;
  resultsNode.innerHTML = "";

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:14px;border:1px dashed rgba(15,23,42,.16);border-radius:16px;background:#fffcf6;font-size:13px;color:#115e59;";
    empty.textContent = "Nenhum problema encontrado nesse texto.";
    resultsNode.appendChild(empty);
    return;
  }

  matches.forEach((match, index) => {
    const card = document.createElement("article");
    card.style.cssText = "padding:14px;border:1px solid rgba(15,23,42,.1);border-radius:16px;background:#fff;display:grid;gap:10px;";

    const title = document.createElement("div");
    title.style.cssText = "font-size:13px;font-weight:700;line-height:1.45;";
    title.textContent = match.message || "Possivel ajuste encontrado.";
    card.appendChild(title);

    const excerpt = document.createElement("div");
    excerpt.style.cssText = "font-size:12px;line-height:1.5;color:#475569;background:#fffaf0;border-radius:12px;padding:10px;";
    excerpt.textContent = getExcerpt(match);
    card.appendChild(excerpt);

    const suggestions = Array.isArray(match.replacements) ? match.replacements.slice(0, 4) : [];
    if (!suggestions.length) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:12px;color:#64748b;";
      note.textContent = "Sem substituicao automatica para este item.";
      card.appendChild(note);
    } else {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
      suggestions.forEach((replacement) => {
        const button = document.createElement("button");
        button.type = "button";
        button.style.cssText = "border:0;border-radius:999px;background:#d9f3ef;color:#115e59;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;";
        button.textContent = replacement.value;
        button.addEventListener("click", () => applySingleCorrection(index, replacement.value));
        row.appendChild(button);
      });
      card.appendChild(row);
    }

    resultsNode.appendChild(card);
  });
}

async function analyzeActiveElement(manual = false): Promise<void> {
  if (!activeElement || !isSupportedElement(activeElement)) {
    return;
  }

  const text = getText(activeElement);
  latestText = text;
  showPanel();

  if (text.trim().length < MIN_TEXT_LENGTH) {
    latestMatches = [];
    setStatus("Digite um pouco mais para analisar esse campo.");
    renderResults([]);
    return;
  }

  const requestId = ++activeRequestId;
  const settings = await getSettings();
  if (!manual && !settings.autoCheck) {
    setStatus("Analise automatica desativada. Use 'Analisar agora'.");
    renderResults([]);
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
    setStatus(matches.length ? `${matches.length} sugestao(oes) encontrada(s).` : "Nenhum problema encontrado.", "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    setStatus(`Falha ao consultar o backend local: ${message}`, "error");
    renderResults([]);
  }
}

function applySingleCorrection(index: number, replacement: string): void {
  if (!activeElement || !latestMatches[index]) {
    return;
  }
  const match = latestMatches[index];
  const updatedText = replaceTextRange(getText(activeElement), match.offset, match.length, replacement);
  setText(activeElement, updatedText);
  latestText = updatedText;
  void analyzeActiveElement(true);
}

function applyAllCorrections(): void {
  if (!activeElement || !latestMatches.length) {
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
  activeElement = target;
  showFab();
  scheduleAnalysis();
});

document.addEventListener("input", (event) => {
  if (event.target === activeElement) {
    scheduleAnalysis();
    positionFab();
  }
}, true);

window.addEventListener("scroll", positionFab, true);
window.addEventListener("resize", positionFab);

fab.addEventListener("click", () => {
  showPanel();
  void analyzeActiveElement(true);
});

panel.querySelector("[data-close]")?.addEventListener("click", hidePanel);
panel.querySelector("[data-refresh]")?.addEventListener("click", () => void analyzeActiveElement(true));
panel.querySelector("[data-apply-all]")?.addEventListener("click", applyAllCorrections);

document.addEventListener("keydown", (event) => {
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === "c") {
    showPanel();
    void analyzeActiveElement(true);
  }
});
