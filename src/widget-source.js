export const WIDGET_JS = String.raw`
(function () {
  const DEFAULT_ENDPOINT = new URL(document.currentScript?.src || window.location.href).origin;
  const ICON_TRANSITION_MS = 320;
  // While the screen is locked or asleep macOS reports loginwindow as the
  // foreground app. Its real icon is off-brand and, once the badge goes
  // offline, lingers as a desaturated leftover. Treat it as "no app" so the
  // neutral placeholder shows instead.
  const LOGINWINDOW_BUNDLE_ID = "com.apple.loginwindow";
  const PLACEHOLDER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.6 4 Q11.5 3.8 16.4 4 Q19.8 4 19.8 7.4 Q20 11.5 19.8 15.6 Q19.8 19 16.4 19 Q11.5 19.2 6.6 19 Q3.2 19 3.2 15.6 Q3 11.5 3.2 7.4 Q3.2 4 6.6 4 Z" stroke-width="1.5" opacity="0.22" transform="translate(1.1 1.4)"/><path d="M6.6 4 Q11.5 3.8 16.4 4 Q19.8 4 19.8 7.4 Q20 11.5 19.8 15.6 Q19.8 19 16.4 19 Q11.5 19.2 6.6 19 Q3.2 19 3.2 15.6 Q3 11.5 3.2 7.4 Q3.2 4 6.6 4 Z" fill="currentColor" fill-opacity="0.07" stroke="none"/><path d="M6.6 4 Q11.5 3.8 16.4 4 Q19.8 4 19.8 7.4 Q20 11.5 19.8 15.6 Q19.8 19 16.4 19 Q11.5 19.2 6.6 19 Q3.2 19 3.2 15.6 Q3 11.5 3.2 7.4 Q3.2 4 6.6 4 Z" stroke-width="1.5"/><path d="M8.85 6.85 Q11.25 9.35 13.85 11.95 Q12.75 12.25 12.05 12.35 L14.15 15.55 L12.75 16.15 L10.75 12.95 Q9.85 12.75 9.05 12.75 Q8.85 9.85 8.85 6.85 Z" stroke-width="1.3" opacity="0.32" transform="translate(0.6 0.8)"/><path d="M8.85 6.85 Q11.25 9.35 13.85 11.95 Q12.75 12.25 12.05 12.35 L14.15 15.55 L12.75 16.15 L10.75 12.95 Q9.85 12.75 9.05 12.75 Q8.85 9.85 8.85 6.85 Z" stroke-width="1.3"/></svg>';
  // Away/offline glyph: the same hand-drawn frame as the placeholder, with a
  // resting crescent moon instead of the lightning bolt — "nobody at the keys".
  const AWAY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.6 4 Q11.5 3.8 16.4 4 Q19.8 4 19.8 7.4 Q20 11.5 19.8 15.6 Q19.8 19 16.4 19 Q11.5 19.2 6.6 19 Q3.2 19 3.2 15.6 Q3 11.5 3.2 7.4 Q3.2 4 6.6 4 Z" stroke-width="1.5" opacity="0.22" transform="translate(1.1 1.4)"/><path d="M6.6 4 Q11.5 3.8 16.4 4 Q19.8 4 19.8 7.4 Q20 11.5 19.8 15.6 Q19.8 19 16.4 19 Q11.5 19.2 6.6 19 Q3.2 19 3.2 15.6 Q3 11.5 3.2 7.4 Q3.2 4 6.6 4 Z" fill="currentColor" fill-opacity="0.07" stroke="none"/><path d="M6.6 4 Q11.5 3.8 16.4 4 Q19.8 4 19.8 7.4 Q20 11.5 19.8 15.6 Q19.8 19 16.4 19 Q11.5 19.2 6.6 19 Q3.2 19 3.2 15.6 Q3 11.5 3.2 7.4 Q3.2 4 6.6 4 Z" stroke-width="1.5"/><path d="M13.4 6.9 A 5.2 5.2 0 1 0 13.4 17.1 A 4 4 0 1 1 13.4 6.9 Z" stroke-width="1.3" opacity="0.3" transform="translate(0.6 0.8)"/><path d="M13.4 6.9 A 5.2 5.2 0 1 0 13.4 17.1 A 4 4 0 1 1 13.4 6.9 Z" fill="currentColor" fill-opacity="0.12" stroke-width="1.3"/><circle cx="15.5" cy="8" r="0.7" fill="currentColor" stroke="none"/></svg>';
  const STYLE = [
    ':host{display:inline-flex;align-items:center;gap:0.45em;vertical-align:middle;color:inherit;font:inherit;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;line-height:1.4;min-width:0}',
    ':host([hidden]){display:none}',
    '.frontmost{display:inline-flex;align-items:center;gap:inherit;min-width:0}',
    '.slot{display:inline-grid;width:var(--frontmost-icon-size,1.35em);height:var(--frontmost-icon-size,1.35em);flex-shrink:0;overflow:hidden;border-radius:var(--frontmost-icon-radius,0.28em)}',
    '.slot > *{grid-area:1 / 1;width:100%;height:100%;border-radius:inherit;transition:opacity 220ms ease-out,transform 320ms cubic-bezier(.22,1,.36,1);will-change:opacity,transform}',
    '.icon{object-fit:contain}',
    '.placeholder{display:inline-flex;align-items:center;justify-content:center;opacity:0.6}',
    '.placeholder svg{width:100%;height:100%;display:block}',
    '.slot > .entering{opacity:0;transform:translate3d(110%,0,0)}',
    '.slot > .leaving{opacity:0;transform:translate3d(-110%,0,0)}',
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
      this.currentIconKey = "";
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
        this.currentIconKey = "";
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
        '<span class="slot"><span class="placeholder" part="icon">' + PLACEHOLDER_SVG + '</span></span>' +
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

      const bundleId = state?.bundleId || "";
      // Only an actively-focused, real app earns its own icon. Anything else
      // (offline, locked, sleeping, or the loginwindow stand-in) falls back to
      // the neutral placeholder so the badge never shows a stale grey icon.
      const showAppIcon = status === "active" && bundleId && bundleId !== LOGINWINDOW_BUNDLE_ID;

      this.shadowRoot.querySelector(".frontmost").className = "frontmost " + status;
      this.shadowRoot.querySelector(".name").textContent = name;
      this.shadowRoot.querySelector(".meta").textContent = meta;
      // Away states (offline / locked / sleeping) get the resting moon glyph;
      // an active app that simply lacks an icon keeps the neutral placeholder.
      const awayMode = !showAppIcon && status !== "active";
      this.updateIcon(showAppIcon ? bundleId : "", awayMode);

      // Expose live state on the host so embedders can label or theme the badge
      // (e.g. a tooltip) without reaching into the shadow DOM.
      this.dataset.status = status;
      if (showAppIcon && name) {
        this.dataset.appName = name;
      } else {
        delete this.dataset.appName;
      }
    }

    updateIcon(bundleId, away) {
      const slot = this.shadowRoot.querySelector(".slot");
      const nextIconUrl = bundleId ? this.iconUrl(bundleId) : "";
      // Key on the placeholder variant too, so an active->away swap re-renders
      // even though both are icon-less.
      const nextKey = nextIconUrl || (away ? "@away" : "@placeholder");
      if (nextKey === this.currentIconKey) {
        return;
      }

      this.currentIconKey = nextKey;
      this.currentIconUrl = nextIconUrl;

      const next = nextIconUrl ? createIconImg(nextIconUrl, () => {
        if (this.currentIconUrl === nextIconUrl) {
          replaceWithPlaceholder(next);
        }
      }) : iconPlaceholder(away);

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

  function iconPlaceholder(away) {
    const placeholder = document.createElement("span");
    placeholder.className = "placeholder";
    placeholder.setAttribute("part", "icon");
    placeholder.innerHTML = away ? AWAY_SVG : PLACEHOLDER_SVG;
    return placeholder;
  }

  function replaceWithPlaceholder(node) {
    if (!node || !node.isConnected) return;
    const fallback = iconPlaceholder(false);
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
