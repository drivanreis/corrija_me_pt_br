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

export async function getServerUrl(): Promise<string> {
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
    const serverUrl = typeof stored.serverUrl === "string" && stored.serverUrl.trim()
      ? stored.serverUrl.trim()
      : packagedServerUrl;

    cachedServerUrl = serverUrl;
    return serverUrl;
  } catch {
    cachedServerUrl = packagedServerUrl;
    return packagedServerUrl;
  }
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
    const stored = await chrome.storage.local.get({ ...STORAGE_DEFAULTS, serverUrl: packagedServerUrl });
    return {
      autoCheck: stored.autoCheck !== false,
      serverUrl: typeof stored.serverUrl === "string" && stored.serverUrl.trim()
        ? stored.serverUrl.trim()
        : packagedServerUrl
    };
  } catch {
    return {
      autoCheck: STORAGE_DEFAULTS.autoCheck,
      serverUrl: packagedServerUrl
    };
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const serverUrl = settings.serverUrl?.trim() || DEFAULT_SERVER_URL;
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
