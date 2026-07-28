(() => {
  "use strict";

  const EVENT_NAME = "__sailfish_extension_event_v1";
  const STORAGE_KEY = "sailfishInspectorLog";
  const MAX_ENTRIES = 2000;
  const MAX_STORAGE_CHARS = 8_000_000;
  const MAX_TEXT = 250_000;
  const SECRET_KEY = /^(pass|password|pwd|token|accessToken|refreshToken|authorization|cookie|secret|session|captcha|verificationCode|mfaCode)$/i;

  function clean(value, key = "") {
    if (SECRET_KEY.test(key)) return "[REDACTED]";
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
      const limited = value.length > MAX_TEXT
        ? `${value.slice(0, MAX_TEXT)}…[TRUNCATED]`
        : value;
      try {
        if (/^\s*[\[{]/.test(limited)) return clean(JSON.parse(limited), key);
      } catch {}
      return limited
        .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
        .replace(/([?&](?:token|accessToken|refreshToken)=)[^&#]+/gi, "$1[REDACTED]")
        .replace(/((?:password|token|secret|session|authorization|cookie)["']?\s*[:=]\s*["']?)[^&,\s"'}]+/gi, "$1[REDACTED]");
    }
    if (Array.isArray(value)) return value.map((item) => clean(item));
    if (typeof value === "object") {
      const result = {};
      for (const [itemKey, itemValue] of Object.entries(value)) {
        result[itemKey] = clean(itemValue, itemKey);
      }
      return result;
    }
    return String(value);
  }

  let writeQueue = Promise.resolve();
  function store(entry) {
    writeQueue = writeQueue.then(async () => {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const state = stored[STORAGE_KEY] || {
        extensionVersion: chrome.runtime.getManifest().version,
        startedAt: new Date().toISOString(),
        droppedEntries: 0,
        entries: []
      };
      state.entries.push(clean(entry));
      if (state.entries.length > MAX_ENTRIES) {
        const removed = state.entries.length - MAX_ENTRIES;
        state.entries.splice(0, removed);
        state.droppedEntries += removed;
      }
      let serialized = JSON.stringify(state);
      while (serialized.length > MAX_STORAGE_CHARS && state.entries.length > 1) {
        const removeCount = Math.max(1, Math.ceil(state.entries.length * 0.1));
        state.entries.splice(0, removeCount);
        state.droppedEntries += removeCount;
        serialized = JSON.stringify(state);
      }
      await chrome.storage.local.set({[STORAGE_KEY]: state});
      await chrome.runtime.sendMessage({
        type: "log-updated",
        count: state.entries.length
      }).catch(() => {});
    }).catch((error) => {
      console.warn("[SailFish Inspector] Store failed", error);
    });
  }

  document.addEventListener(EVENT_NAME, (event) => {
    try {
      const message = JSON.parse(event.detail);
      if (message?.source !== "sailfish-page-hook") return;
      store({
        at: message.at || new Date().toISOString(),
        page: location.href,
        frame: window === window.top ? "top" : "child",
        type: message.type,
        ...(message.details || {})
      });
    } catch (error) {
      store({
        at: new Date().toISOString(),
        page: location.href,
        type: "bridge-error",
        error: String(error)
      });
    }
  });

  store({
    at: new Date().toISOString(),
    page: location.href,
    frame: window === window.top ? "top" : "child",
    type: "collector-installed"
  });
})();
