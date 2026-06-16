export const WIDGET_JS = String.raw`
(function () {
  const DEFAULT_ENDPOINT = new URL(document.currentScript?.src || window.location.href).origin;
  const STYLE = ":host{display:inline-block;font:13px/1.35 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937}.frontmost{display:inline-flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid rgba(31,41,55,.14);border-radius:999px;background:rgba(255,255,255,.86);box-shadow:0 1px 2px rgba(0,0,0,.04)}.icon{width:20px;height:20px;border-radius:5px;object-fit:contain}.offline .icon,.locked .icon,.sleeping .icon{filter:grayscale(1);opacity:.65}.text{display:flex;flex-direction:column;min-width:0}.name{font-weight:600;white-space:nowrap}.meta{color:#6b7280;font-size:11px;white-space:nowrap}.dot{width:7px;height:7px;border-radius:99px;background:#22c55e}.offline .dot{background:#9ca3af}.locked .dot{background:#f59e0b}.sleeping .dot{background:#60a5fa}.placeholder{display:grid;place-items:center;width:20px;height:20px;border-radius:5px;background:#f3f4f6;color:#6b7280;font-size:12px}";

  class FrontmostBadge extends HTMLElement {
    static get observedAttributes() {
      return ["user", "endpoint", "interval"];
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.pollTimer = null;
      this.clockTimer = null;
      this.abortController = null;
      this.state = null;
      this.receivedAt = 0;
      this.currentIconUrl = "";
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
    }

    connectedCallback() {
      this.ensureDom();
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.start();
      this.update();
    }

    disconnectedCallback() {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.stop();
    }

    attributeChangedCallback() {
      if (this.isConnected) {
        this.currentIconUrl = "";
        this.start();
      }
    }

    onVisibilityChange() {
      if (document.hidden) {
        this.stop();
      } else {
        this.start();
      }
    }

    start() {
      this.stop();
      if (document.hidden) {
        return;
      }

      this.fetchState();
      const interval = Math.max(Number(this.getAttribute("interval")) || 5000, 3000);
      this.pollTimer = window.setInterval(() => this.fetchState(), interval);
      this.clockTimer = window.setInterval(() => this.update(), 1000);
    }

    stop() {
      if (this.pollTimer) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.clockTimer) {
        window.clearInterval(this.clockTimer);
        this.clockTimer = null;
      }
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    async fetchState() {
      const user = this.getAttribute("user");
      if (!user) {
        this.state = { error: "Missing user." };
        this.update();
        return;
      }

      this.abortController = new AbortController();
      const url = new URL("/current", this.endpoint());
      url.searchParams.set("user", user);
      url.searchParams.set("_", Date.now().toString());

      try {
        const response = await fetch(url, {
          signal: this.abortController.signal,
          cache: "no-store",
          headers: { "accept": "application/json" }
        });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        this.state = await response.json();
        this.receivedAt = Date.now();
      } catch (error) {
        if (error.name !== "AbortError") {
          this.state = { ...(this.state || {}), error: "Connection failed." };
        }
      } finally {
        this.abortController = null;
        this.update();
      }
    }

    endpoint() {
      return this.getAttribute("endpoint") || DEFAULT_ENDPOINT;
    }

    iconUrl(bundleId) {
      return new URL("/icon/" + encodeURIComponent(bundleId), this.endpoint()).toString();
    }

    ensureDom() {
      if (this.shadowRoot.querySelector(".frontmost")) {
        return;
      }

      this.shadowRoot.innerHTML = '<style>' + STYLE + '</style><span class="frontmost offline"><span class="slot"><span class="placeholder">今</span></span><span class="dot" aria-hidden="true"></span><span class="text"><span class="name"></span><span class="meta"></span></span></span>';
    }

    update() {
      this.ensureDom();

      const state = this.state;
      const status = state?.status || "offline";
      const name = state?.name || "Not broadcasting";
      const meta = state?.error || statusText(state, this.receivedAt);

      this.shadowRoot.querySelector(".frontmost").className = "frontmost " + status;
      this.shadowRoot.querySelector(".name").textContent = name;
      this.shadowRoot.querySelector(".meta").textContent = meta;
      this.updateIcon(state?.bundleId || "");
    }

    updateIcon(bundleId) {
      const slot = this.shadowRoot.querySelector(".slot");
      const nextIconUrl = bundleId ? this.iconUrl(bundleId) : "";
      if (nextIconUrl === this.currentIconUrl) {
        return;
      }

      this.currentIconUrl = nextIconUrl;
      if (!nextIconUrl) {
        slot.replaceChildren(iconPlaceholder());
        return;
      }

      const img = document.createElement("img");
      img.className = "icon";
      img.alt = "";
      img.src = nextIconUrl;
      img.addEventListener("error", () => {
        if (this.currentIconUrl === nextIconUrl) {
          slot.replaceChildren(iconPlaceholder());
        }
      }, { once: true });
      slot.replaceChildren(img);
    }
  }

  function statusText(state, receivedAt) {
    if (!state || state.status === "offline") return "offline";
    if (state.status === "locked") return "locked";
    if (state.status === "sleeping") return "sleeping";
    if (!state.lastActivityAt || !state.serverTime) return "active";

    const elapsedSinceFetch = receivedAt ? Math.floor((Date.now() - receivedAt) / 1000) : 0;
    const seconds = Math.max(0, state.serverTime + elapsedSinceFetch - state.lastActivityAt);
    if (seconds < 60) return seconds + "s ago";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    return Math.floor(minutes / 60) + "h ago";
  }

  function iconPlaceholder() {
    const placeholder = document.createElement("span");
    placeholder.className = "placeholder";
    placeholder.textContent = "今";
    return placeholder;
  }

  if (!customElements.get("frontmost-badge")) {
    customElements.define("frontmost-badge", FrontmostBadge);
  }
}());
`;
