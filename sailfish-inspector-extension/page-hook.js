(() => {
  "use strict";

  if (window.__sailfishExtensionHook) return;
  window.__sailfishExtensionHook = true;

  const EVENT_NAME = "__sailfish_extension_event_v1";
  const emit = (type, details = {}) => {
    document.dispatchEvent(new CustomEvent(EVENT_NAME, {
      detail: JSON.stringify({
        source: "sailfish-page-hook",
        at: new Date().toISOString(),
        type,
        details
      })
    }));
  };

  const bodyText = (value) => {
    if (value == null) return null;
    if (typeof value === "string") return value;
    if (value instanceof URLSearchParams) return value.toString();
    if (value instanceof FormData) return "[FormData]";
    if (value instanceof Blob) return `[Blob ${value.size} bytes]`;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return `[Binary ${value.byteLength || value.buffer?.byteLength || 0} bytes]`;
    }
    return String(value);
  };

  const headersObject = (headers) => {
    const result = {};
    try {
      new Headers(headers || {}).forEach((value, key) => {
        result[key] = value;
      });
    } catch {}
    return result;
  };

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = async function(input, init = {}) {
      const request = input instanceof Request ? input : null;
      const url = request?.url || String(input);
      const method = init.method || request?.method || "GET";
      const started = performance.now();
      try {
        const response = await originalFetch.apply(this, arguments);
        let responseText = null;
        try {
          responseText = await response.clone().text();
        } catch {}
        emit("fetch", {
          url,
          method,
          status: response.status,
          durationMs: Math.round(performance.now() - started),
          requestHeaders: headersObject(init.headers || request?.headers),
          requestBody: bodyText(init.body),
          contentType: response.headers.get("content-type") || "",
          responseText
        });
        return response;
      } catch (error) {
        emit("fetch-error", {url, method, error: String(error)});
        throw error;
      }
    };
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__sfi = {method, url: String(url), headers: {}, started: 0};
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__sfi) this.__sfi.headers[name] = value;
    return xhrSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__sfi) {
      this.__sfi.started = performance.now();
      this.addEventListener("loadend", () => {
        let responseText = null;
        try {
          if (this.responseType === "json" && this.response != null) {
            responseText = JSON.stringify(this.response);
          } else if (typeof this.response === "string") {
            responseText = this.response;
          } else {
            responseText = this.responseText;
          }
        } catch {}
        emit("xhr", {
          url: this.__sfi.url,
          method: this.__sfi.method,
          status: this.status,
          durationMs: Math.round(performance.now() - this.__sfi.started),
          requestHeaders: this.__sfi.headers,
          requestBody: bodyText(body),
          contentType: this.getResponseHeader("content-type") || "",
          responseText
        });
      }, {once: true});
    }
    return xhrSend.apply(this, arguments);
  };

  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    const binaryDetails = async (data) => {
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

    function InspectorWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      const socketUrl = String(url);
      emit("websocket-open", {url: socketUrl, protocols: protocols || null});

      const originalSend = socket.send;
      socket.send = function(data) {
        if (typeof data === "string") {
          emit("websocket-send", {url: socketUrl, data});
        } else {
          binaryDetails(data).then((details) => {
            emit("websocket-send", {url: socketUrl, ...details});
          });
        }
        return originalSend.apply(this, arguments);
      };

      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          emit("websocket-message", {url: socketUrl, data: event.data});
        } else {
          binaryDetails(event.data).then((details) => {
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

    InspectorWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(InspectorWebSocket, NativeWebSocket);
    Object.assign(InspectorWebSocket, {
      CONNECTING: NativeWebSocket.CONNECTING,
      OPEN: NativeWebSocket.OPEN,
      CLOSING: NativeWebSocket.CLOSING,
      CLOSED: NativeWebSocket.CLOSED
    });
    window.WebSocket = InspectorWebSocket;
  }

  emit("hook-installed", {
    page: location.href,
    frame: window === window.top ? "top" : "child"
  });
})();
