const DEFAULT_SERVER_URL = "http://127.0.0.1:18081";

type ServerConfigFile = {
  serverUrl?: string;
};

type ExtensionSettings = {
  autoCheck: boolean;
  serverUrl?: string;
};

export const STORAGE_DEFAULTS: ExtensionSettings = {
  autoCheck: true,
  serverUrl: DEFAULT_SERVER_URL
};

let cachedServerUrl: string | null = null;

function hasLiveExtensionContext(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

async function readPackagedServerUrl(): Promise<string> {
  if (!hasLiveExtensionContext()) {
    return DEFAULT_SERVER_URL;
  }

  try {
    const response = await fetch(chrome.runtime.getURL("server-config.json"), { cache: "no-store" });
    if (!response.ok) {
      return DEFAULT_SERVER_URL;
    }
    const config = await response.json() as ServerConfigFile;
    if (typeof config.serverUrl === "string" && config.serverUrl.trim()) {
      return config.serverUrl.trim();
    }
  } catch {
    // Ignore packaging/runtime lookup failures and fall back to the default URL.
  }

  return DEFAULT_SERVER_URL;
}

async function syncStoredServerUrl(serverUrl: string): Promise<void> {
  if (!hasLiveExtensionContext()) {
    return;
  }

  try {
    await chrome.storage.local.set({ serverUrl });
  } catch {
    // Ignore persistence errors if the extension is being reloaded.
  }
}

export async function getServerUrl(): Promise<string> {
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

export async function getSettings(): Promise<ExtensionSettings> {
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

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
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
    // Ignore persistence errors if the extension is being reloaded.
  }
}
