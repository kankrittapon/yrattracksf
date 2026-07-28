// ==UserScript==
// @name         SailFish Network Inspector
// @namespace    sailtrack.local
// @version      1.4.0
// @description  ตรวจ API/WebSocket และถอด Live/Replay payload ของ SailFish
// @match        https://saill.cn/*
// @match        https://www.saill.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const STORE_KEY = "__sailfish_inspector_v1";
  const EVENT_NAME = "__sailfish_inspector_event";
  const MAX_ENTRIES = 600;
  const MAX_TEXT = 120000;
  const MAX_ARRAY_ITEMS = 5000;
  const MAX_STORAGE_CHARS = 4_000_000;
  const LARGE_EXPORT_CHARS = 1_000_000;
  const SECRET_KEY = /^(pass|password|pwd|token|accessToken|refreshToken|authorization|cookie|secret|session|captcha|verificationCode|mfaCode)$/i;
  const NOISY_RESOURCE = /\.(?:css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico)(?:[?#]|$)|\/tiles\//i;

  const state = loadState();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return {
        phase: saved.phase || "login",
        startedAt: saved.startedAt || new Date().toISOString(),
        entries: Array.isArray(saved.entries) ? saved.entries : [],
        droppedEntries: Number(saved.droppedEntries || 0)
      };
    } catch {
      return {phase: "login", startedAt: new Date().toISOString(), entries: [], droppedEntries: 0};
    }
  }

  function saveState() {
    try {
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
      localStorage.setItem(STORE_KEY, serialized);
      renderCount();
    } catch (error) {
      // Quota differs between Safari/iOS versions. Drop the oldest half and retry once.
      const removeCount = Math.max(1, Math.floor(state.entries.length / 2));
      state.entries.splice(0, removeCount);
      state.droppedEntries += removeCount;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        renderCount();
      } catch (retryError) {
        console.warn("[SailFish Inspector] บันทึก log ไม่สำเร็จ", retryError);
      }
    }
  }

  function clean(value, key = "") {
    if (SECRET_KEY.test(key)) return "[REDACTED]";
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.length > MAX_TEXT) return `${value.slice(0, MAX_TEXT)}…[TRUNCATED]`;
      try {
        if (/^\s*[\[{]/.test(value)) return clean(JSON.parse(value), key);
      } catch {}
      return value
        .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
        .replace(/((?:password|token|secret|session|authorization|cookie)[\"']?\s*[:=]\s*[\"']?)[^&,\s\"'}]+/gi, "$1[REDACTED]");
    }
    if (Array.isArray(value)) {
      const result = value.slice(0, MAX_ARRAY_ITEMS).map((item) => clean(item));
      if (value.length > MAX_ARRAY_ITEMS) {
        result.push(`[TRUNCATED ${value.length - MAX_ARRAY_ITEMS} array items]`);
      }
      return result;
    }
    if (typeof value === "object") {
      const result = {};
      for (const [itemKey, itemValue] of Object.entries(value)) {
        result[itemKey] = clean(itemValue, itemKey);
      }
      return result;
    }
    return String(value);
  }

  function headersToObject(headers) {
    const result = {};
    try {
      new Headers(headers || {}).forEach((value, key) => {
        result[key] = SECRET_KEY.test(key) ? "[REDACTED]" : clean(value, key);
      });
    } catch {}
    return result;
  }

  function add(type, details) {
    state.entries.push({
      at: new Date().toISOString(),
      phase: state.phase,
      page: location.href,
      type,
      ...clean(details)
    });
    saveState();
  }

  // Compatible decoder for the LZ-String Base64 format used by getRaceDatas.
  const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  function decompressFromBase64(input) {
    if (input == null) return "";
    if (input === "") return null;
    return lzDecompress(input.length, 32, (index) => BASE64_ALPHABET.indexOf(input.charAt(index)));
  }

  function lzDecompress(length, resetValue, getNextValue) {
    const dictionary = [0, 1, 2];
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    let entry = "";
    const result = [];
    let dataValue = getNextValue(0);
    let dataPosition = resetValue;
    let dataIndex = 1;

    const readBits = (count) => {
      let bits = 0;
      let power = 1;
      const maxPower = 1 << count;
      while (power !== maxPower) {
        const bit = dataValue & dataPosition;
        dataPosition >>= 1;
        if (dataPosition === 0) {
          dataPosition = resetValue;
          dataValue = getNextValue(dataIndex++);
        }
        if (bit > 0) bits |= power;
        power <<= 1;
      }
      return bits;
    };

    let next = readBits(2);
    let char;
    if (next === 0) char = String.fromCharCode(readBits(8));
    else if (next === 1) char = String.fromCharCode(readBits(16));
    else return "";
    dictionary[3] = char;
    let word = char;
    result.push(char);

    while (true) {
      if (dataIndex > length) return "";
      let code = readBits(numBits);
      if (code === 0) {
        dictionary[dictSize++] = String.fromCharCode(readBits(8));
        code = dictSize - 1;
        enlargeIn--;
      } else if (code === 1) {
        dictionary[dictSize++] = String.fromCharCode(readBits(16));
        code = dictSize - 1;
        enlargeIn--;
      } else if (code === 2) {
        return result.join("");
      }

      if (enlargeIn === 0) {
        enlargeIn = 1 << numBits;
        numBits++;
      }

      if (dictionary[code] != null) entry = dictionary[code];
      else if (code === dictSize) entry = word + word.charAt(0);
      else return null;

      result.push(entry);
      dictionary[dictSize++] = word + entry.charAt(0);
      enlargeIn--;
      word = entry;

      if (enlargeIn === 0) {
        enlargeIn = 1 << numBits;
        numBits++;
      }
    }
  }

  function decodeRacePayload(value) {
    if (!value || typeof value !== "object" || typeof value.result !== "string") return value;
    const compressed = value.result;
    if (compressed.length < 20) return value;
    try {
      const decodedText = decompressFromBase64(compressed.replace(/ /g, "+"));
      if (!decodedText) return value;
      let decoded;
      try { decoded = JSON.parse(decodedText); } catch { decoded = decodedText; }
      return {
        ...value,
        result: `[COMPRESSED ${compressed.length} chars]`,
        decodedResult: decoded,
        decodeInfo: {
          algorithm: "lz-string/base64",
          compressedChars: compressed.length,
          decodedChars: decodedText.length,
          parsedJson: typeof decoded === "object"
        }
      };
    } catch (error) {
      return {...value, decodeError: String(error)};
    }
  }

  function parseResponse(text, contentType) {
    if (!text) return null;
    if (/json/i.test(contentType || "") || /^\s*[\[{]/.test(text)) {
      try { return clean(decodeRacePayload(JSON.parse(text))); } catch {}
    }
    return clean(text.slice(0, 8000));
  }

  // Resource Timing ใช้เป็น fallback สำหรับ Safari/iOS ที่แยก userscript
  // ออกจาก JavaScript context ของหน้าเว็บ ทำให้ override fetch/XHR ไม่เห็น request
  const seenResources = new Set();
  function recordResource(entry) {
    const url = entry?.name;
    if (!url || seenResources.has(url) || NOISY_RESOURCE.test(url)) return;
    seenResources.add(url);
    add("resource", {
      url,
      initiatorType: entry.initiatorType || "",
      durationMs: Math.round(entry.duration || 0),
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
      decodedBodySize: entry.decodedBodySize || 0
    });
  }

  try {
    performance.getEntriesByType("resource").forEach(recordResource);
    const resourceObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach(recordResource);
    });
    resourceObserver.observe({type: "resource", buffered: true});
  } catch (error) {
    add("resource-observer-error", {error: String(error)});
  }

  // fetch
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = async function(input, init = {}) {
      const request = input instanceof Request ? input : null;
      const url = request?.url || String(input);
      const method = init.method || request?.method || "GET";
      const started = performance.now();
      try {
        const response = await originalFetch.apply(this, arguments);
        let responseBody = null;
        try {
          const clone = response.clone();
          responseBody = parseResponse(await clone.text(), clone.headers.get("content-type"));
        } catch {}
        add("fetch", {
          url,
          method,
          status: response.status,
          durationMs: Math.round(performance.now() - started),
          requestHeaders: headersToObject(init.headers || request?.headers),
          requestBody: clean(init.body || null, "body"),
          responseBody
        });
        return response;
      } catch (error) {
        add("fetch-error", {url, method, error: String(error)});
        throw error;
      }
    };
  }

  // XMLHttpRequest
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__sfi = {method, url: String(url), headers: {}, started: 0};
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__sfi) this.__sfi.headers[name] = SECRET_KEY.test(name) ? "[REDACTED]" : value;
    return xhrSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__sfi) {
      this.__sfi.started = performance.now();
      this.addEventListener("loadend", () => {
        let responseBody = null;
        try {
          responseBody = parseResponse(
            typeof this.response === "string" ? this.response : this.responseText,
            this.getResponseHeader("content-type")
          );
        } catch {}
        add("xhr", {
          url: this.__sfi.url,
          method: this.__sfi.method,
          status: this.status,
          durationMs: Math.round(performance.now() - this.__sfi.started),
          requestHeaders: clean(this.__sfi.headers),
          requestBody: clean(body, "body"),
          responseBody
        });
      }, {once: true});
    }
    return xhrSend.apply(this, arguments);
  };

  // WebSocket must be hooked in the page context. Safari/iOS may execute a
  // userscript in an isolated context where replacing window.WebSocket here
  // does not affect the SailFish application.
  let pageWebSocketHookReady = false;
  window.addEventListener(EVENT_NAME, (event) => {
    let message;
    try {
      message = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
    } catch {
      add("page-bridge-error", {error: "Invalid bridge message"});
      return;
    }
    if (!message || message.source !== "sailfish-page-websocket") return;
    if (message.type === "hook-installed") {
      pageWebSocketHookReady = true;
      add("websocket-hook-installed", {context: "page"});
      return;
    }
    const details = message.details || {};
    if (typeof details.data === "string") {
      details.data = parseResponse(details.data, "");
    }
    add(message.type, details);
  });

  function installPageWebSocketHook(eventName) {
    if (window.__sfiPageWebSocketHook) return;
    window.__sfiPageWebSocketHook = true;
    const NativeWebSocket = window.WebSocket;
    if (!NativeWebSocket) return;
    const emit = (type, details = {}) => {
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: JSON.stringify({source: "sailfish-page-websocket", type, details})
      }));
    };
    const describeBinary = async (data) => {
      if (data instanceof Blob) {
        try {
          return {binaryType: "blob", size: data.size, data: await data.text()};
        } catch (error) {
          return {binaryType: "blob", size: data.size, error: String(error)};
        }
      }
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        const bytes = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        try {
          return {
            binaryType: "arraybuffer",
            size: bytes.byteLength,
            data: new TextDecoder().decode(bytes)
          };
        } catch (error) {
          return {binaryType: "arraybuffer", size: bytes.byteLength, error: String(error)};
        }
      }
      return {binaryType: typeof data, data: "[UNKNOWN BINARY]"};
    };
    function WrappedWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      const socketUrl = String(url);
      emit("websocket-open", {url: socketUrl, protocols: protocols || null});
      const nativeSend = socket.send;
      socket.send = function(data) {
        if (typeof data === "string") {
          emit("websocket-send", {url: socketUrl, data});
        } else {
          describeBinary(data).then((details) => {
            emit("websocket-send", {url: socketUrl, ...details});
          });
        }
        return nativeSend.apply(this, arguments);
      };
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          emit("websocket-message", {url: socketUrl, data: event.data});
        } else {
          describeBinary(event.data).then((details) => {
            emit("websocket-message", {url: socketUrl, ...details});
          });
        }
      });
      socket.addEventListener("error", () => {
        emit("websocket-error", {url: socketUrl, readyState: socket.readyState});
      });
      socket.addEventListener("close", (event) => {
        emit("websocket-close", {
          url: socketUrl,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
      });
      return socket;
    }
    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
    Object.assign(WrappedWebSocket, {
      CONNECTING: NativeWebSocket.CONNECTING,
      OPEN: NativeWebSocket.OPEN,
      CLOSING: NativeWebSocket.CLOSING,
      CLOSED: NativeWebSocket.CLOSED
    });
    window.WebSocket = WrappedWebSocket;
    emit("hook-installed", {context: "page"});
  }

  try {
    const script = document.createElement("script");
    script.textContent = `(${installPageWebSocketHook.toString()})(${JSON.stringify(EVENT_NAME)});`;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
  } catch (error) {
    add("websocket-hook-error", {context: "page", error: String(error)});
  }

  // Direct-context fallback for managers that already run @grant none in page.
  if (!pageWebSocketHookReady) {
    try {
      installPageWebSocketHook(EVENT_NAME);
      add("websocket-hook-fallback", {context: "userscript"});
    } catch (error) {
      add("websocket-hook-error", {context: "userscript", error: String(error)});
    }
  }

  function setPhase(phase) {
    state.phase = phase;
    add("phase", {name: phase});
    document.querySelectorAll("[data-sfi-phase]").forEach((button) => {
      button.classList.toggle("active", button.dataset.sfiPhase === phase);
    });
  }

  async function exportLog() {
    add("export", {userAgent: navigator.userAgent});
    const payload = JSON.stringify({
      inspectorVersion: "1.4.0",
      exportedAt: new Date().toISOString(),
      startedAt: state.startedAt,
      droppedEntries: state.droppedEntries,
      entries: state.entries
    }, null, 2);
    const download = () => {
      const blob = new Blob([payload], {type: "application/json"});
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `sailfish-network-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    if (payload.length >= LARGE_EXPORT_CHARS) {
      download();
      alert("Log มีขนาดใหญ่ จึงดาวน์โหลดเป็นไฟล์ JSON โดยตรง");
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      alert("คัดลอก JSON แล้ว นำไปวางส่งให้ผู้พัฒนาได้เลย");
    } catch {
      download();
    }
  }

  function renderCount() {
    const count = document.getElementById("__sfi_count");
    if (count) {
      const sizeKb = Math.round(JSON.stringify(state).length / 1024);
      count.textContent = `${state.entries.length} • ${sizeKb} KB`;
    }
    const dropped = document.getElementById("__sfi_dropped");
    if (dropped) dropped.textContent = String(state.droppedEntries);
  }

  function mountPanel() {
    if (!document.body || document.getElementById("__sfi_panel")) return;
    const host = document.createElement("div");
    host.id = "__sfi_panel";
    host.innerHTML = `
      <style>
        #__sfi_panel{position:fixed;z-index:2147483647;right:10px;bottom:10px;width:220px;padding:10px;border-radius:12px;background:#071b22ee;color:#fff;font:12px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 5px 25px #0008}
        #__sfi_panel b{display:block;margin-bottom:7px;color:#4ee0cf}
        #__sfi_panel .row{display:flex;gap:4px;margin:4px 0}
        #__sfi_panel button{flex:1;border:0;border-radius:7px;padding:7px 4px;background:#183943;color:#fff;font-size:11px}
        #__sfi_panel button.active{background:#35cbbb;color:#041a19;font-weight:700}
        #__sfi_panel .export{background:#2878e0}
        #__sfi_panel .clear{background:#9d3c49}
      </style>
      <b>SailFish Inspector • <span id="__sfi_count">0</span></b>
      <small>ตัด log เก่าแล้ว: <span id="__sfi_dropped">0</span></small>
      <div class="row">
        <button data-sfi-phase="login">1 Login</button>
        <button data-sfi-phase="matches">2 รายการ</button>
        <button data-sfi-phase="classes">3 ประเภท</button>
        <button data-sfi-phase="track">4 Track</button>
      </div>
      <div class="row">
        <button id="__sfi_export" class="export">Export JSON</button>
        <button id="__sfi_clear" class="clear">ล้าง Log</button>
      </div>`;
    document.body.appendChild(host);
    host.querySelectorAll("[data-sfi-phase]").forEach((button) => {
      button.addEventListener("click", () => setPhase(button.dataset.sfiPhase));
      button.classList.toggle("active", button.dataset.sfiPhase === state.phase);
    });
    host.querySelector("#__sfi_export").addEventListener("click", exportLog);
    host.querySelector("#__sfi_clear").addEventListener("click", () => {
      if (!confirm("ล้าง Network log ทั้งหมด?")) return;
      state.entries = [];
      state.startedAt = new Date().toISOString();
      state.droppedEntries = 0;
      saveState();
    });
    renderCount();
    add("page", {title: document.title, referrer: document.referrer});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountPanel, {once: true});
  } else {
    mountPanel();
  }
})();
