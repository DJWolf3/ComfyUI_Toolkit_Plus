// === Block 0 Start === Header + Imports === //
//
// ComfyUI_Sidebar_Extension.js
// Frontend-only tweak: Alphabetize ALL sidebar panels (tabs) A→Z by their visible title.
// - DOM reorder only (no patching other extensions, no API, no unregister/register)
// - Safe: preserves existing event handlers by moving existing nodes
//
// Debug:
//   localStorage.sidebar_alpha_sort_debug = "1"  (then reload)
//
import { app } from "../../scripts/app.js";
//
// === Block 0 Finish === Header + Imports === //


// === Block 1 Start === Bootstrap + Guards === //

(function () {
  try {
    if (globalThis.__COMFYUI_SIDEBAR_ALPHA_SORT_LOADED__) return;
    globalThis.__COMFYUI_SIDEBAR_ALPHA_SORT_LOADED__ = true;

    const EXT_NAME = "comfyui_tweak.sidebar_alphabetize";
    const DEBUG = (() => {
      try { return String(localStorage.getItem("sidebar_alpha_sort_debug") || "") === "1"; }
      catch (_) { return false; }
    })();

    // Per-container signature cache to avoid re-sorting when nothing changed.
    const containerSig = new WeakMap();

    // Sort scheduling + mutation safety flags
    let scheduled = false;
    let isReordering = false;
    let observer = null;

// === Block 1 Finish === Bootstrap + Guards === //


// === Block 2 Start === Helpers === //

    function normText(s) {
      return String(s || "").replace(/\s+/g, " ").trim();
    }

    function labelKey(s) {
      return normText(s).toLocaleLowerCase();
    }

    function unique(arr) {
      return Array.from(new Set(arr));
    }

    function getDescendantAttrLabel(node) {
      if (!node?.querySelector) return "";

      // Prefer aria-label, then title, then tooltip-like attrs
      const ariaEl = node.querySelector("[aria-label]:not([aria-label=''])");
      if (ariaEl) {
        const v = normText(ariaEl.getAttribute("aria-label"));
        if (v) return v;
      }

      const titleEl = node.querySelector("[title]:not([title=''])");
      if (titleEl) {
        const v = normText(titleEl.getAttribute("title"));
        if (v) return v;
      }

      const tipEl = node.querySelector(
        "[data-p-tooltip]:not([data-p-tooltip='']), [data-tooltip]:not([data-tooltip='']), [data-tip]:not([data-tip=''])"
      );
      if (tipEl) {
        const v1 = normText(tipEl.getAttribute("data-p-tooltip"));
        if (v1) return v1;
        const v2 = normText(tipEl.getAttribute("data-tooltip"));
        if (v2) return v2;
        const v3 = normText(tipEl.getAttribute("data-tip"));
        if (v3) return v3;
      }

      return "";
    }

    function getTabLabel(node) {
      if (!node) return "";

      // PrimeVue title span
      const primeTitle = node.querySelector?.(".p-tabview-title, .p-tabmenuitem-text, .p-tabview-nav-link");
      if (primeTitle?.textContent) {
        const t = normText(primeTitle.textContent);
        if (t) return t;
      }

      // Common fallbacks
      const titleEl =
        node.querySelector?.("[data-title]") ||
        node.querySelector?.(".tab-title") ||
        node.querySelector?.(".title");
      if (titleEl?.textContent) {
        const t = normText(titleEl.textContent);
        if (t) return t;
      }

      // Self attrs
      const aria = node.getAttribute?.("aria-label");
      if (aria) return normText(aria);

      const titleAttr = node.getAttribute?.("title");
      if (titleAttr) return normText(titleAttr);

      // Descendant attrs (vanilla icon-only tabs often store label here)
      const desc = getDescendantAttrLabel(node);
      if (desc) return desc;

      // Last resort
      return normText(node.textContent || "");
    }

    function getDirectChild(container, node) {
      let n = node;
      while (n && n.parentElement && n.parentElement !== container) n = n.parentElement;
      return n && n.parentElement === container ? n : null;
    }

    function isTabLike(node) {
      if (!node || node.nodeType !== 1) return false;

      const role = node.getAttribute?.("role");
      if (role === "tab") return true;

      const tag = (node.tagName || "").toUpperCase();
      if (tag === "BUTTON" || tag === "A" || tag === "LI") return true;

      // Many ComfyUI vanilla tabs are DIV wrappers
      if (tag === "DIV" || tag === "SPAN") {
        // If it carries an accessible label or tooltip, treat as tab-like
        const selfLabel =
          normText(node.getAttribute?.("aria-label") || "") ||
          normText(node.getAttribute?.("title") || "") ||
          normText(node.getAttribute?.("data-tooltip") || "") ||
          normText(node.getAttribute?.("data-p-tooltip") || "") ||
          normText(node.getAttribute?.("data-tip") || "");

        if (selfLabel) return true;

        const childLabel = getDescendantAttrLabel(node);
        if (childLabel) return true;
      }

      return false;
    }

    function looksLikeTabContainer(el) {
      if (!el || !el.isConnected) return false;

      // Strong signals
      const role = el.getAttribute?.("role");
      if (role === "tablist") return true;

      // PrimeVue variants
      if (
        el.classList?.contains("p-tabview-nav") ||
        el.classList?.contains("p-tabmenu-nav") ||
        el.classList?.contains("p-tabs-nav") ||
        el.classList?.contains("p-tablist")
      ) return true;

      // Heuristic: multiple direct children that are tab-like with labels
      const kids = Array.from(el.children || []);
      if (kids.length < 2) return false;

      const tabKids = kids.filter((k) => isTabLike(k) || k.querySelector?.("[role='tab']") || k.querySelector?.("button,a"));
      if (tabKids.length < 2) return false;

      // Ensure we can extract at least 2 labels
      const labels = tabKids.map((k) => labelKey(getTabLabel(k))).filter(Boolean);
      return labels.length >= 2;
    }

    function withinLeftSidebar(el) {
      // We try to avoid sorting unrelated tab bars (settings dialogs, etc.)
      // So we prefer containers physically near the left edge, or under known sidebar roots.
      try {
        const r = el.getBoundingClientRect();
        if (!r || !Number.isFinite(r.left)) return false;
        // “Left-ish” threshold (works for most layouts)
        return r.left < 350;
      } catch (_) {
        return false;
      }
    }

// === Block 2 Finish === Helpers === //


// === Block 3 Start === Container Discovery === //

    function findSidebarRoots() {
      const roots = new Set();

      // Common ids/classes across ComfyUI builds (web + electron)
      const selectors = [
        "#sidebar",
        "#left-sidebar",
        "#comfyui-sidebar",
        ".sidebar",
        ".left-sidebar",
        ".comfyui-sidebar",
        ".side-panel",
        ".sidepanel",
        ".sidebar-panel",
        "[id*='sidebar']",
        "[class*='sidebar']",
      ];

      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((n) => roots.add(n));
      }

      // Fallback: the left column containers often have many buttons
      document.querySelectorAll("nav, aside, div").forEach((n) => {
        if (!n?.isConnected) return;
        const cls = (n.className || "").toString().toLowerCase();
        const id = (n.id || "").toString().toLowerCase();
        if (cls.includes("sidebar") || id.includes("sidebar")) roots.add(n);
      });

      return Array.from(roots);
    }

    function findTabContainers() {
      const set = new Set();

      // PrimeVue / explicit tablists
      document.querySelectorAll("ul.p-tabview-nav, ul.p-tabmenu-nav, ul.p-tabs-nav").forEach((n) => set.add(n));
      document.querySelectorAll("[role='tablist']").forEach((n) => set.add(n));
      document.querySelectorAll(".p-tablist, .p-tabview-nav, .p-tabmenu-nav").forEach((n) => set.add(n));

      // Vanilla sidebar icon bars are often div/nav containers with many buttons.
      // We search inside probable sidebar roots and pick inner containers that “look like” tab bars.
      const roots = findSidebarRoots();
      for (const root of roots) {
        // Scan likely container types
        root.querySelectorAll("ul, nav, div").forEach((n) => set.add(n));
      }

      // Filter + prefer left-side containers
      const containers = Array.from(set).filter(looksLikeTabContainer);

      // If we found many, prefer those that sit near the left edge
      const leftPref = containers.filter(withinLeftSidebar);
      return leftPref.length ? leftPref : containers;
    }

    function getSortableItems(container) {
      if (!container) return [];

      // Prefer direct children first (common for icon bars & UL nav)
      let candidates = Array.from(container.children || []);

      // If too few, collect inner tab/button elements and map them to direct children
      if (candidates.length < 2) {
        const inner = Array.from(container.querySelectorAll("[role='tab'], button, a, li"));
        candidates = inner.map((n) => getDirectChild(container, n)).filter(Boolean);
      }

      // Filter: only keep items that are tab-like AND have a label
      const filtered = candidates
        .filter((n) => isTabLike(n) || n.querySelector?.("[role='tab'],button,a"))
        .filter((n) => labelKey(getTabLabel(n)).length > 0);

      return unique(filtered);
    }

// === Block 3 Finish === Container Discovery === //


// === Block 4 Start === Sorting Logic === //

    function sortOneContainer(container) {
      const items = getSortableItems(container);
      if (items.length < 2) return false;

      const labels = items.map((n) => labelKey(getTabLabel(n)));
      const sigNow = labels.join("|");

      const lastSig = containerSig.get(container);
      if (lastSig === sigNow) return false;

      const entries = items.map((el, idx) => ({
        el,
        idx,
        label: labelKey(getTabLabel(el)),
      }));

      const sorted = entries.slice().sort((a, b) => {
        const cmp = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
        return cmp !== 0 ? cmp : a.idx - b.idx;
      });

      const changed = sorted.some((e, i) => e.el !== items[i]);
      if (!changed) {
        containerSig.set(container, sigNow);
        return false;
      }

      isReordering = true;
      try {
        for (const e of sorted) container.appendChild(e.el);
      } finally {
        isReordering = false;
      }

      const sigAfter = sorted.map((e) => e.label).join("|");
      containerSig.set(container, sigAfter);

      if (DEBUG) {
        console.log("[Sidebar A→Z] Sorted container:", container, sorted.map((e) => e.label));
      }

      return true;
    }

    function sortAllSidebars() {
      const containers = findTabContainers();

      if (DEBUG) {
        console.log("[Sidebar A→Z] Found containers:", containers.length);
        for (const c of containers.slice(0, 8)) {
          const items = getSortableItems(c);
          const labels = items.map((n) => getTabLabel(n)).filter(Boolean);
          console.log("[Sidebar A→Z] Container sample labels:", labels);
        }
      }

      let any = false;
      for (const c of containers) {
        try {
          any = sortOneContainer(c) || any;
        } catch (e) {
          if (DEBUG) console.warn("[Sidebar A→Z] Sort error:", e);
        }
      }
      return any;
    }

    function scheduleSort() {
      if (scheduled) return;
      scheduled = true;

      // micro-debounce to batch rapid mutations
      setTimeout(() => {
        scheduled = false;
        sortAllSidebars();
      }, 60);
    }

// === Block 4 Finish === Sorting Logic === //


// === Block 5 Start === Observers + Extension Setup === //

    function startObserver() {
      if (observer) return;

      observer = new MutationObserver((mutations) => {
        if (isReordering) return;

        // If tab bars are re-rendered or tabs added/removed/renamed, re-sort.
        for (const m of mutations) {
          if (m.type === "childList" && (m.addedNodes?.length || m.removedNodes?.length)) {
            scheduleSort();
            return;
          }
          if (m.type === "attributes") {
            scheduleSort();
            return;
          }
        }
      });

      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-label", "title", "class", "data-tooltip", "data-p-tooltip", "data-tip"],
      });
    }

    function stopObserver() {
      try {
        observer?.disconnect?.();
      } catch (_) {}
      observer = null;
    }

    app.registerExtension({
      name: EXT_NAME,

      async setup() {
        // Initial pass
        scheduleSort();

        // Observe future UI rebuilds / late-loading extensions
        startObserver();

        // Extra delayed passes (some vanilla panels mount later in electron builds)
        setTimeout(scheduleSort, 250);
        setTimeout(scheduleSort, 1000);
        setTimeout(scheduleSort, 2500);
        setTimeout(scheduleSort, 5000);

        window.addEventListener("beforeunload", () => stopObserver(), { once: true });

        if (DEBUG) console.log("[Sidebar A→Z] Loaded (debug enabled).");
      },
    });

// === Block 5 Finish === Observers + Extension Setup === //

  } catch (err) {
    console.error("[Sidebar A→Z] Failed to load:", err);
  }
})();

