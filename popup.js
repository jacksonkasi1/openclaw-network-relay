document.addEventListener("DOMContentLoaded", async () => {
  const webhookUrlInput = document.getElementById("webhookUrl");
  const saveBtn = document.getElementById("saveBtn");
  const toggleBtn = document.getElementById("toggleBtn");
  const modeSelect = document.getElementById("modeSelect");
  const statusEl = document.getElementById("status");
  const attachedTabEl = document.getElementById("attachedTab");
  const currentTabEl = document.getElementById("currentTab");

  let currentTabId = null;
  let enabled = false;

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }

  function setToggleState(nextEnabled) {
    enabled = nextEnabled;
    toggleBtn.textContent = nextEnabled ? "ON" : "OFF";
    toggleBtn.classList.toggle("on", nextEnabled);
  }

  async function refreshStatus() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0] || null;

    currentTabId = activeTab?.id ?? null;
    currentTabEl.textContent = activeTab?.url || activeTab?.title || "No active tab";

    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    webhookUrlInput.value = status.endpoint || "";
    if (modeSelect && status.mode) {
      modeSelect.value = status.mode;
    }
    attachedTabEl.textContent = status.attachedTabLabel || "Not attached";
    setToggleState(status.enabled === true && status.attachedTabId === currentTabId);
  }

  if (modeSelect) {
    modeSelect.addEventListener("change", async () => {
      const result = await chrome.runtime.sendMessage({
        type: "SET_MODE",
        mode: modeSelect.value
      });
      if (result.ok) {
        setStatus(result.mode === "listen" ? "Listening & Logging traffic." : "Intercepting & Pausing traffic.");
      }
    });
  }

  saveBtn.addEventListener("click", async () => {
    const endpoint = webhookUrlInput.value.trim();

    if (!endpoint) {
      setStatus("Enter a webhook endpoint first.", true);
      return;
    }

    const result = await chrome.runtime.sendMessage({ type: "SAVE_ENDPOINT", endpoint });
    setStatus(result.ok ? "Endpoint saved." : result.error, !result.ok);
  });

  toggleBtn.addEventListener("click", async () => {
    if (currentTabId == null) {
      setStatus("Open a normal browser tab first.", true);
      return;
    }

    const result = await chrome.runtime.sendMessage({
      type: "SET_INTERCEPTION",
      tabId: currentTabId,
      enable: !enabled,
    });

    if (!result.ok) {
      setStatus(result.error, true);
      return;
    }

    setStatus(result.enabled ? "Interception attached to current tab." : "Interception disabled.");
    await refreshStatus();
  });

  await refreshStatus();
});
