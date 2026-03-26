const LOCAL_SERVER_URL = "http://127.0.0.1:8081";
const defaults = {
  autoCheck: true
};

const autoCheckInput = document.getElementById("autoCheck") as HTMLInputElement | null;
const saveButton = document.getElementById("saveButton") as HTMLButtonElement | null;
const testButton = document.getElementById("testButton") as HTMLButtonElement | null;
const status = document.getElementById("status") as HTMLDivElement | null;
const serverUrlLabel = document.getElementById("serverUrl") as HTMLSpanElement | null;

function setStatus(message: string, tone = ""): void {
  if (!status) {
    return;
  }
  status.textContent = message;
  status.className = `status${tone ? ` ${tone}` : ""}`;
}

async function getSettings(): Promise<{ autoCheck: boolean }> {
  const stored = await chrome.storage.local.get(defaults);
  return {
    autoCheck: stored.autoCheck !== false
  };
}

async function saveSettings(): Promise<void> {
  if (!autoCheckInput) {
    return;
  }
  await chrome.storage.local.set({ autoCheck: autoCheckInput.checked });
  setStatus("Preferencias locais salvas.", "ok");
}

async function testConnection(): Promise<void> {
  setStatus("Testando conexao...");
  try {
    const response = await fetch(`${LOCAL_SERVER_URL}/v2/languages`);
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
    serverUrlLabel.textContent = LOCAL_SERVER_URL;
  }
  if (autoCheckInput) {
    autoCheckInput.checked = settings.autoCheck;
  }
  saveButton?.addEventListener("click", () => void saveSettings());
  testButton?.addEventListener("click", () => void testConnection());
}

void bootstrap();
