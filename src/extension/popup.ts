import { getServerUrl, getSettings, saveSettings } from "./server-config.js";

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

async function persistSettings(): Promise<void> {
  if (!autoCheckInput) {
    return;
  }
  const currentServerUrl = await getServerUrl();
  await saveSettings({ autoCheck: autoCheckInput.checked, serverUrl: currentServerUrl });
  setStatus("Preferencias locais salvas.", "ok");
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
  saveButton?.addEventListener("click", () => void persistSettings());
  testButton?.addEventListener("click", () => void testConnection());
}

void bootstrap();
