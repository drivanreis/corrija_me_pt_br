(async () => {
  const LOCAL_SERVER_URL = "http://localhost:8081";
  const defaults = {
    autoCheck: true
  };

  const autoCheckInput = document.getElementById("autoCheck");
  const saveButton = document.getElementById("saveButton");
  const testButton = document.getElementById("testButton");
  const status = document.getElementById("status");
  const serverUrlLabel = document.getElementById("serverUrl");

  function setStatus(message, tone) {
    status.textContent = message;
    status.className = `status${tone ? ` ${tone}` : ""}`;
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(defaults);
    return {
      autoCheck: stored.autoCheck !== false
    };
  }

  async function saveSettings() {
    const payload = {
      autoCheck: autoCheckInput.checked
    };
    await chrome.storage.local.set(payload);
    setStatus("Preferencias locais salvas.", "ok");
  }

  async function testConnection() {
    setStatus("Testando conexao...", "");
    try {
      const response = await fetch(`${LOCAL_SERVER_URL}/v2/languages`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const languages = await response.json();
      const hasPtBr = Array.isArray(languages) && languages.some((item) => item.longCode === "pt-BR");
      if (!hasPtBr) {
        throw new Error("Servidor respondeu, mas nao retornou pt-BR.");
      }
      setStatus("Conexao ok. Servidor local pt-BR encontrado.", "ok");
    } catch (error) {
      setStatus(`Falha na conexao: ${error.message}`, "error");
    }
  }

  const settings = await getSettings();
  serverUrlLabel.textContent = LOCAL_SERVER_URL;
  autoCheckInput.checked = settings.autoCheck;

  saveButton.addEventListener("click", saveSettings);
  testButton.addEventListener("click", testConnection);
})();
