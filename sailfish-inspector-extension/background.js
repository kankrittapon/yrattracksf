"use strict";

const STORAGE_KEY = "sailfishInspectorLog";
const attachedTabs = new Set();
let writeQueue = Promise.resolve();

function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|accessToken|refreshToken)=)[^&#]+/gi, "$1[REDACTED]")
    .replace(/((?:password|token|secret|session|authorization|cookie)["']?\s*[:=]\s*["']?)[^&,\s"'}]+/gi, "$1[REDACTED]");
}

function clean(value) {
  if (typeof value === "string") {
    const redacted = redact(value);
    try {
      if (/^\s*[\[{]/.test(redacted)) return clean(JSON.parse(redacted));
    } catch {}
    return redacted;
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(password|token|accessToken|refreshToken|authorization|cookie|secret|session)$/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = clean(item);
      }
    }
    return result;
  }
  return value;
}

function store(entry) {
  writeQueue = writeQueue.then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const state = stored[STORAGE_KEY] || {
      extensionVersion: chrome.runtime.getManifest().version,
      startedAt: new Date().toISOString(),
      droppedEntries: 0,
      entries: []
    };
    state.extensionVersion = chrome.runtime.getManifest().version;
    state.entries.push(clean(entry));
    if (state.entries.length > 5000) {
      const removed = state.entries.length - 5000;
      state.entries.splice(0, removed);
      state.droppedEntries += removed;
    }
    await chrome.storage.local.set({[STORAGE_KEY]: state});
  }).catch((error) => {
    console.warn("[SailFish Inspector] Background store failed", error);
  });
}

async function attach(tabId) {
  if (attachedTabs.has(tabId)) return {attached: true};
  await chrome.debugger.attach({tabId}, "1.3");
  await chrome.debugger.sendCommand({tabId}, "Network.enable", {
    maxTotalBufferSize: 100000000,
    maxResourceBufferSize: 10000000,
    maxPostDataSize: 10000000
  });
  await chrome.debugger.sendCommand({tabId}, "Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true
  });
  attachedTabs.add(tabId);
  await chrome.action.setBadgeBackgroundColor({tabId, color: "#16a085"});
  await chrome.action.setBadgeText({tabId, text: "REC"});
  store({
    at: new Date().toISOString(),
    type: "debugger-attached",
    tabId
  });
  return {attached: true};
}

async function detach(tabId) {
  if (attachedTabs.has(tabId)) {
    await chrome.debugger.detach({tabId}).catch(() => {});
    attachedTabs.delete(tabId);
  }
  await chrome.action.setBadgeText({tabId, text: ""}).catch(() => {});
  store({
    at: new Date().toISOString(),
    type: "debugger-detached",
    tabId
  });
  return {attached: false};
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId || !attachedTabs.has(source.tabId)) return;
  if (method === "Target.attachedToTarget" && params.sessionId) {
    chrome.debugger.sendCommand(
      {tabId: source.tabId, sessionId: params.sessionId},
      "Network.enable",
      {
        maxTotalBufferSize: 100000000,
        maxResourceBufferSize: 10000000,
        maxPostDataSize: 10000000
      }
    ).catch((error) => {
      store({
        at: new Date().toISOString(),
        type: "debugger-child-target-error",
        tabId: source.tabId,
        targetType: params.targetInfo?.type,
        error: String(error)
      });
    });
    store({
      at: new Date().toISOString(),
      type: "debugger-child-target",
      tabId: source.tabId,
      targetType: params.targetInfo?.type,
      targetUrl: params.targetInfo?.url
    });
    return;
  }
  const types = {
    "Network.webSocketCreated": "cdp-websocket-open",
    "Network.webSocketWillSendHandshakeRequest": "cdp-websocket-handshake-request",
    "Network.webSocketHandshakeResponseReceived": "cdp-websocket-handshake-response",
    "Network.webSocketFrameSent": "cdp-websocket-send",
    "Network.webSocketFrameReceived": "cdp-websocket-message",
    "Network.webSocketFrameError": "cdp-websocket-error",
    "Network.webSocketClosed": "cdp-websocket-close"
  };
  const type = types[method];
  if (!type) return;
  store({
    at: new Date().toISOString(),
    type,
    tabId: source.tabId,
    requestId: params.requestId,
    url: params.url,
    timestamp: params.timestamp,
    wallTime: params.wallTime,
    frame: params.response || params.request || params.errorMessage
      ? {
          response: params.response,
          request: params.request,
          errorMessage: params.errorMessage
        }
      : params.response,
    payload: params.response?.payloadData
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!source.tabId) return;
  attachedTabs.delete(source.tabId);
  chrome.action.setBadgeText({tabId: source.tabId, text: ""}).catch(() => {});
  store({
    at: new Date().toISOString(),
    type: "debugger-detached",
    tabId: source.tabId,
    reason
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "debugger-status") {
    sendResponse({attached: attachedTabs.has(message.tabId)});
    return;
  }
  if (message?.type === "debugger-start") {
    attach(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({attached: false, error: String(error)}));
    return true;
  }
  if (message?.type === "debugger-stop") {
    detach(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({attached: false, error: String(error)}));
    return true;
  }
});
