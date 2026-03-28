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

  let stored: { serverUrl?: string } = {};
  try {
    stored = await chrome.storage.local.get({ serverUrl: packagedServerUrl });
  } catch {
    cachedServerUrl = packagedServerUrl;
    return packagedServerUrl;
  }
  const serverUrl = typeof stored.serverUrl === "string" && stored.serverUrl.trim()
    ? stored.serverUrl.trim()
    : packagedServerUrl;

  cachedServerUrl = serverUrl;
  return serverUrl;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const packagedServerUrl = await readPackagedServerUrl();
  if (!hasLiveExtensionContext()) {
    return {
      autoCheck: STORAGE_DEFAULTS.autoCheck,
      serverUrl: packagedServerUrl
    };
  }

  let stored: ExtensionSettings = { ...STORAGE_DEFAULTS, serverUrl: packagedServerUrl };
  try {
    stored = await chrome.storage.local.get({ ...STORAGE_DEFAULTS, serverUrl: packagedServerUrl });
  } catch {
    return {
      autoCheck: STORAGE_DEFAULTS.autoCheck,
      serverUrl: packagedServerUrl
    };
  }

  return {
    autoCheck: stored.autoCheck !== false,
    serverUrl: typeof stored.serverUrl === "string" && stored.serverUrl.trim()
      ? stored.serverUrl.trim()
      : packagedServerUrl
  };
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
  }
}
