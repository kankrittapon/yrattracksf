const STORAGE_KEY = "sailfishInspectorLog";
let activeTabId = null;
let debuggerAttached = false;

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {
    extensionVersion: chrome.runtime.getManifest().version,
    startedAt: new Date().toISOString(),
    droppedEntries: 0,
    entries: []
  };
}

async function render() {
  const state = await loadState();
  const text = JSON.stringify(state);
  document.getElementById("count").textContent = state.entries.length;
  document.getElementById("dropped").textContent = state.droppedEntries || 0;
  document.getElementById("size").textContent = `${Math.round(text.length / 1024)} KB`;
}

async function refreshDebuggerStatus() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  activeTabId = tab?.id || null;
  if (!activeTabId) return;
  const result = await chrome.runtime.sendMessage({
    type: "debugger-status",
    tabId: activeTabId
  });
  debuggerAttached = Boolean(result?.attached);
  const button = document.getElementById("capture");
  button.textContent = debuggerAttached ? "หยุดจับ WebSocket" : "เริ่มจับ WebSocket";
  button.style.background = debuggerAttached ? "#d17b22" : "#16a085";
}

document.getElementById("capture").addEventListener("click", async () => {
  if (!activeTabId) return;
  const result = await chrome.runtime.sendMessage({
    type: debuggerAttached ? "debugger-stop" : "debugger-start",
    tabId: activeTabId
  });
  if (result?.error) {
    document.getElementById("status").textContent = `เริ่มจับไม่ได้: ${result.error}`;
  } else {
    document.getElementById("status").textContent = result?.attached
      ? "กำลังจับระดับ Network — กรุณา Reload หน้า Track"
      : "หยุดจับ WebSocket แล้ว";
  }
  await refreshDebuggerStatus();
});

document.getElementById("export").addEventListener("click", async () => {
  const state = await loadState();
  const payload = JSON.stringify({
    ...state,
    exportedAt: new Date().toISOString()
  }, null, 2);
  const blob = new Blob([payload], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sailfish-extension-log-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.getElementById("status").textContent = "ดาวน์โหลด JSON แล้ว";
});

document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("ล้าง Network log ทั้งหมด?")) return;
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      extensionVersion: chrome.runtime.getManifest().version,
      startedAt: new Date().toISOString(),
      droppedEntries: 0,
      entries: []
    }
  });
  document.getElementById("status").textContent = "ล้าง Log แล้ว";
  await render();
});

Promise.all([render(), refreshDebuggerStatus()]);
