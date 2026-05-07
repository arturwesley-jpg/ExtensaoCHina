// src/content-scripts/modules/xh_status_badge/core.js
(() => {
  "use strict";

  const KEY_ENABLED = "enabled";

  const CFG = {
    PILL_ID: "__xh_status_pill__",
    STYLE_ID: "__xh_status_pill_style__",
    topPx: 10,
    leftPx: 12,
    zIndex: 2147483646,
  };

  function ensureStyle() {
    if (document.getElementById(CFG.STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = CFG.STYLE_ID;
    style.textContent = `
#${CFG.PILL_ID}{
  position: fixed;
  top: ${CFG.topPx}px;
  left: ${CFG.leftPx}px;
  z-index: ${CFG.zIndex};
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.88);
  border: 1px solid rgba(0,0,0,0.10);
  box-shadow: 0 10px 24px rgba(0,0,0,.12);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  white-space: nowrap;
  pointer-events: auto;
  user-select: none;
  cursor: pointer;
  transition: transform .10s ease, filter .12s ease, border-color .12s ease, box-shadow .12s ease;
}

#${CFG.PILL_ID}:hover{
  transform: translateY(-1px);
  border-color: rgba(0,0,0,0.16);
  filter: brightness(1.01);
  box-shadow: 0 12px 28px rgba(0,0,0,.14);
}

#${CFG.PILL_ID}:active{
  transform: translateY(0px) scale(.99);
}

#${CFG.PILL_ID}[data-xh-state="off"]{
  background: rgba(255, 245, 245, 0.92);
  border-color: rgba(255, 77, 79, 0.32);
  box-shadow: 0 10px 24px rgba(0,0,0,.12), 0 0 0 1px rgba(255, 77, 79, 0.10) inset;
}

#${CFG.PILL_ID} .xh-dot{
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: rgba(96, 210, 140, 0.95);
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.25),
    0 0 10px rgba(96,210,140,0.35);
  animation: xh_pulse 1.8s ease-in-out infinite alternate;
}

#${CFG.PILL_ID}[data-xh-state="off"] .xh-dot{
  background: rgba(255, 77, 79, 0.95);
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.20),
    0 0 10px rgba(255,77,79,0.30);
}

#${CFG.PILL_ID} .xh-text{
  display:flex;
  flex-direction:column;
  gap: 1px;
}

#${CFG.PILL_ID} .xh-name{
  font: 700 11px/1.1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  color: rgba(11,16,32,0.92);
}

#${CFG.PILL_ID} .xh-state{
  font: 700 10px/1.1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  letter-spacing: 0.6px;
  color: rgba(11,16,32,0.62);
}

#${CFG.PILL_ID}[data-xh-state="off"] .xh-state{
  color: rgba(140, 0, 0, 0.72);
}

@keyframes xh_pulse{
  0% { transform: scale(0.86); opacity: 0.65; }
  100% { transform: scale(1.00); opacity: 1.00; }
}

@media (prefers-reduced-motion: reduce){
  #${CFG.PILL_ID} .xh-dot{ animation:none; }
  #${CFG.PILL_ID}{ transition:none; }
}
    `.trim();

    document.documentElement.appendChild(style);
  }

  function ensurePill() {
    let pill = document.getElementById(CFG.PILL_ID);
    if (pill) return pill;

    pill = document.createElement("div");
    pill.id = CFG.PILL_ID;
    pill.setAttribute("role", "button");
    pill.tabIndex = 0;
    pill.setAttribute("aria-label", "ImportKit");

    const dot = document.createElement("div");
    dot.className = "xh-dot";
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("div");
    text.className = "xh-text";

    const name = document.createElement("div");
    name.className = "xh-name";
    name.textContent = "ImportKit";

    const state = document.createElement("div");
    state.className = "xh-state";
    state.textContent = "Ligado";

    text.appendChild(name);
    text.appendChild(state);
    pill.appendChild(dot);
    pill.appendChild(text);

    document.documentElement.appendChild(pill);
    return pill;
  }

  let toggling = false;

  async function applyState() {
    try {
      await chrome.runtime.sendMessage({ type: "APPLY_STATE" });
    } catch {}
  }

  function reloadCurrentPageSoon() {
    try {
      setTimeout(() => {
        location.reload();
      }, 120);
    } catch {}
  }

  async function toggleEnabled() {
    if (toggling) return;
    toggling = true;
    try {
      const cur = await loadEnabled();
      const next = !cur;
      await chrome.storage.sync.set({ [KEY_ENABLED]: next });
      setEnabledUI(next);
      await applyState();
      reloadCurrentPageSoon();
    } catch {
      // ignore
    } finally {
      toggling = false;
    }
  }

  function setEnabledUI(enabled) {
    const pill = ensurePill();
    pill.dataset.xhState = enabled ? "on" : "off";
    const stateEl = pill.querySelector(".xh-state");
    if (stateEl) stateEl.textContent = enabled ? "Ligado" : "Desligado";

    const hint = enabled ? "Clique para desligar" : "Clique para ligar";
    pill.title = `ImportKit: ${enabled ? "Ligado" : "Desligado"} - ${hint}`;
    pill.setAttribute("aria-label", `ImportKit ${enabled ? "ligado" : "desligado"}. ${hint}.`);
  }

  async function loadEnabled() {
    try {
      const res = await chrome.storage.sync.get([KEY_ENABLED]);
      return res[KEY_ENABLED] ?? true;
    } catch {
      return true;
    }
  }

  function watchEnabledChanges() {
    if (!chrome?.storage?.onChanged) return () => {};

    const listener = (changes, areaName) => {
      if (areaName !== "sync") return;
      if (!changes || !changes[KEY_ENABLED]) return;
      setEnabledUI(changes[KEY_ENABLED].newValue ?? true);
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch {}
    };
  }

  function init() {
    ensureStyle();
    const pill = ensurePill();
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleEnabled();
    });
    pill.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      toggleEnabled();
    });
    loadEnabled().then(setEnabledUI);
    watchEnabledChanges();
  }

  globalThis.__xh_status_badge = {
    init,
  };
})();
