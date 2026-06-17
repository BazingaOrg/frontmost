export const WIDGET_JS = String.raw`
(function () {
  const DEFAULT_ENDPOINT = new URL(document.currentScript?.src || window.location.href).origin;
  const ICON_TRANSITION_MS = 320;
  const STYLE = [
    ':host{display:inline-flex;align-items:center;gap:0.45em;vertical-align:middle;color:inherit;font:inherit;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;line-height:1.4;min-width:0}',
    ':host([hidden]){display:none}',
    '.frontmost{display:inline-flex;align-items:center;gap:inherit;min-width:0}',
    '.slot{display:inline-grid;width:var(--frontmost-icon-size,1.35em);height:var(--frontmost-icon-size,1.35em);flex-shrink:0}',
    '.slot > *{grid-area:1 / 1;width:100%;height:100%;border-radius:var(--frontmost-icon-radius,0.28em);transition:opacity 320ms ease,transform 320ms cubic-bezier(.22,1,.36,1);transform-origin:center;will-change:opacity,transform}',
    '.icon{object-fit:contain}',
    '.placeholder{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '.slot > .entering{opacity:0;transform:scale(0.6)}',
    '.slot > .leaving{opacity:0;transform:scale(1.18)}',
    '@media (prefers-reduced-motion: reduce){.slot > *{transition:opacity 160ms ease;transform:none !important}}',
    '.name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:16em}',
    '.meta{opacity:0.55;white-space:nowrap}',
    '.meta:not(:empty)::before{content:"·";padding-right:0.3em}',
    '.name:empty + .meta::before{content:"";padding-right:0}',
    '.locked .icon,.locked .placeholder,.sleeping .icon,.sleeping .placeholder,.offline .icon,.offline .placeholder{filter:saturate(0);opacity:0.5}'
  ].join("");

  class FrontmostBadge extends HTMLElement {
    static get observedAttributes() {
      return ["user", "endpoint", "interval", "hide-when-offline"];
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

      this.shadowRoot.innerHTML =
        '<style>' + STYLE + '</style>' +
        '<span class="frontmost offline" part="badge">' +
        '<span class="slot"><span class="placeholder" part="icon"></span></span>' +
        '<span class="name" part="name"></span>' +
        '<span class="meta" part="meta"></span>' +
        '</span>';
    }

    update() {
      this.ensureDom();

      const state = this.state;
      const status = state?.status || "offline";
      const hideWhenOffline = this.hasAttribute("hide-when-offline") && status === "offline" && !state?.error;
      this.toggleAttribute("hidden", hideWhenOffline);

      const name = state?.name || "";
      const meta = state?.error || metaText(state, this.receivedAt);

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

      const next = nextIconUrl ? createIconImg(nextIconUrl, () => {
        if (this.currentIconUrl === nextIconUrl) {
          replaceWithPlaceholder(next);
        }
      }) : iconPlaceholder();

      next.classList.add("entering");

      Array.from(slot.children).forEach(child => {
        child.classList.remove("entering");
        child.classList.add("leaving");
      });

      slot.appendChild(next);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        next.classList.remove("entering");
      }));

      window.setTimeout(() => {
        Array.from(slot.children).forEach(child => {
          if (child !== next) child.remove();
        });
      }, ICON_TRANSITION_MS + 60);
    }
  }

  function createIconImg(url, onError) {
    const img = document.createElement("img");
    img.className = "icon";
    img.setAttribute("part", "icon");
    img.alt = "";
    img.src = url;
    if (onError) {
      img.addEventListener("error", onError, { once: true });
    }
    return img;
  }

  function iconPlaceholder() {
    const placeholder = document.createElement("span");
    placeholder.className = "placeholder";
    placeholder.setAttribute("part", "icon");
    return placeholder;
  }

  function replaceWithPlaceholder(node) {
    if (!node || !node.isConnected) return;
    const fallback = iconPlaceholder();
    fallback.className += " " + (node.className.includes("entering") ? "entering" : "");
    node.replaceWith(fallback);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fallback.classList.remove("entering");
    }));
  }

  function metaText(state, receivedAt) {
    if (!state) return "";
    if (state.status === "offline") return "offline";
    if (state.status === "locked") return "locked";
    if (state.status === "sleeping") return "sleeping";
    if (!state.lastActivityAt || !state.serverTime) return "";

    const elapsedSinceFetch = receivedAt ? Math.floor((Date.now() - receivedAt) / 1000) : 0;
    const seconds = Math.max(0, state.serverTime + elapsedSinceFetch - state.lastActivityAt);
    if (seconds < 60) return seconds + "s";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m";
    return Math.floor(minutes / 60) + "h";
  }

  if (!customElements.get("frontmost-badge")) {
    customElements.define("frontmost-badge", FrontmostBadge);
  }
}());
`;
