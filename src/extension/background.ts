function getOriginPattern(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

async function hasOriginPermission(rawUrl: string): Promise<boolean> {
  const originPattern = getOriginPattern(rawUrl);
  if (!originPattern) {
    return false;
  }

  return chrome.permissions.contains({
    origins: [originPattern]
  });
}

async function injectIntoTab(tabId: number): Promise<void> {
  try {
    const probeResult = await chrome.scripting.executeScript({
      target: {
        tabId,
        allFrames: false
      },
      func: () => window.__corrijaMePtBrLoaded__ === true
    });

    if (probeResult[0]?.result === true) {
      return;
    }
  } catch {
    // If the probe fails, we still try the real injection below.
  }

  try {
    await chrome.scripting.insertCSS({
      target: {
        tabId,
        allFrames: true
      },
      files: ["content.css"]
    });
  } catch {
    // Ignore CSS injection failures and still attempt script injection.
  }

  await chrome.scripting.executeScript({
    target: {
      tabId,
      allFrames: true
    },
    files: ["content.js"]
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "corrija-me-pt-br:inject-tab" && typeof message.tabId === "number") {
    void injectIntoTab(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  void hasOriginPermission(tab.url).then((allowed) => {
    if (!allowed) {
      return;
    }
    void injectIntoTab(tabId).catch(() => {});
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then((tab) => {
    if (!tab.url) {
      return;
    }
    return hasOriginPermission(tab.url).then((allowed) => {
      if (!allowed) {
        return;
      }
      return injectIntoTab(tabId).catch(() => {});
    });
  }).catch(() => {});
});
