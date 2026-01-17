// === Block 0 Start === Code Start === //

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXT_NAME = "comfyui_sample_pack.civitai_library";
const TAB_ID = "civitaiLibrary";
const API_BASE = "/sample_pack/civitai_library"; // must match Python ROUTE_BASE

const LS_KEY_SIZE = "civitai_library_preview_size";
// === Block 0 Finish === Code Start === //

// === Block 1 Start === Core DOM Utility === //

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") {
      node.className = v;
    }
    else if (k === "style" && typeof v === "object") {
      Object.assign(node.style, v);
    }
    else if (k.startsWith("on") && typeof v === "function") {
      // Normalize event name (onClick -> click)
      node.addEventListener(k.slice(2).toLowerCase(), v);
    }
    else if (typeof v === "boolean") {
      // Proper boolean attribute handling (e.g. disabled)
      node[k] = v;
      if (v) node.setAttribute(k, k);
      else node.removeAttribute(k);
    }
    else if (k === "text") {
      node.textContent = v;
    }
    else if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }

  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    node.appendChild(
      typeof child === "string" ? document.createTextNode(child) : child
    );
  }

  return node;
}
// === Block 1 Finish === Core DOM Utility === //

// === Block 2 Start === Notifications and Networking === //

function toast(msg, severity = "info") {
  try {
    app?.extensionManager?.toast?.add?.({
      severity,
      summary: "CivitAI",
      detail: msg,
      life: 2600,
    });
  } catch (_) {
    // fail silently
  }
}

async function fetchJson(path, options = {}) {
  const res = await api.fetchApi(path, options);

  // Read body safely (some endpoints may return empty or plain text)
  const contentType = (res.headers?.get?.("content-type") || "").toLowerCase();
  const rawText = await res.text().catch(() => "");

  if (!res.ok) {
    // Prefer showing JSON error if present, otherwise show text
    try {
      const maybeJson = rawText ? JSON.parse(rawText) : null;
      const msg = maybeJson?.error || maybeJson?.message || rawText;
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${msg}`.trim());
    } catch (_) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${rawText}`.trim());
    }
  }

  // Success path: return JSON when possible, else return text
  if (contentType.includes("application/json")) {
    return rawText ? JSON.parse(rawText) : {};
  }

  // If server didn't label it JSON but it is JSON, still parse it
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    return rawText;
  }
}
// === Block 2 Finish === Notifications and Networking === //

// === Block 3 Start === UI Components === //

function uiButton(label, onClick, opts = {}) {
  const { danger = false, disabled = false, title = "" } = opts;

  const btn = el(
    "button",
    {
      title,
      style: {
        padding: "8px 10px",
        borderRadius: "10px",
        border: "1px solid var(--border-color, #444)",
        background: danger
          ? "rgba(255, 70, 70, 0.15)"
          : "var(--bg-color, #2a2a2a)",
        color: "var(--fg-color, #eee)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? "0.6" : "1",
        userSelect: "none",
      },
      onclick: disabled ? () => {} : onClick,
    },
    label
  );

  btn.__setDisabled = (isDisabled) => {
    btn.disabled = !!isDisabled;
    btn.style.cursor = isDisabled ? "not-allowed" : "pointer";
    btn.style.opacity = isDisabled ? "0.6" : "1";
  };

  btn.__setDisabled(disabled);
  return btn;
}

function uiInput(placeholder, type = "text") {
  return el("input", {
    type,
    placeholder,
    autocomplete: "off",
    style: {
      width: "100%",
      padding: "8px",
      borderRadius: "10px",
      border: "1px solid var(--border-color, #444)",
      background: "var(--bg-color, #1f1f1f)",
      color: "var(--fg-color, #eee)",
      outline: "none",
      boxSizing: "border-box",
    },
  });
}

function uiSelect() {
  return el("select", {
    style: {
      width: "100%",
      padding: "8px",
      borderRadius: "10px",
      border: "1px solid var(--border-color, #444)",
      background: "var(--bg-color, #1f1f1f)",
      color: "var(--fg-color, #eee)",
      outline: "none",
      boxSizing: "border-box",
    },
  });
}

function buttonRow(buttons) {
  const n = Math.max(1, buttons.length);

  return el(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: `repeat(${n}, 1fr)`,
        gap: "8px",
        width: "100%",
      },
    },
    buttons
  );
}
// === Block 3 Finish === UI Components === //

// === Block 4 Start === Generic Helpers === //

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function getPreviewSize() {
  const raw = localStorage.getItem(LS_KEY_SIZE);
  const n = parseInt(raw || "256", 10);
  if (!Number.isFinite(n)) return 256;
  return clamp(n, 128, 2048);
}

function setPreviewSize(v) {
  localStorage.setItem(LS_KEY_SIZE, String(v));
}

/**
 * Ensures:
 * - values are strings
 * - de-duplicated
 * - "Any" is always FIRST
 */
function normalizeListWithAny(values) {
  const src = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();

  // Always start with Any
  out.push("Any");
  seen.add("Any");

  for (const v of src) {
    const val =
      typeof v === "string"
        ? v
        : v?.name || String(v);

    const s = (val || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

function fillSelect(selectEl, values, keepValue = true) {
  const cur = keepValue ? selectEl.value : "";
  const normalized = normalizeListWithAny(values);

  selectEl.innerHTML = "";

  for (const v of normalized) {
    selectEl.appendChild(el("option", { value: v }, v));
  }

  // keep existing selection if still valid, otherwise default to Any
  if (keepValue && normalized.includes(cur)) {
    selectEl.value = cur;
  } else {
    selectEl.value = "Any";
  }
}

function labeled(labelText, node) {
  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        minWidth: "160px",
      },
    },
    [
      el(
        "div",
        { style: { fontSize: "12px", opacity: "0.85" } },
        labelText
      ),
      node,
    ]
  );
}
// === Block 4 Finish === Generic Helpers === //

// === Block 5 Start === Extension Registration Shell === //

app.registerExtension({
  name: EXT_NAME,

  async setup() {
    app.extensionManager.registerSidebarTab({
      id: TAB_ID,
      icon: "pi pi-cloud-download",
      title: "CivitAI",
      tooltip: "CivitAI Library",
      type: "custom",

      render: (root) => {

        // NOTE:
        // UI layout creation lives in Block 6
        // UI helper functions live in Block 7+
        // This block only establishes the shell
// === Block 5 Finish === Extension Registration Shell === //

// === Block 6 Start === Layout Construction === //

        // Reset root
        root.innerHTML = "";
        root.style.padding = "10px";
        root.style.display = "flex";
        root.style.flexDirection = "column";
        root.style.gap = "10px";
        root.style.height = "100%";
        root.style.boxSizing = "border-box";

        // Title + Status
        const title = el(
          "div",
          { style: { fontSize: "14px", fontWeight: "650" } },
          "CivitAI Library"
        );
        const statusLine = el(
          "div",
          { style: { fontSize: "12px", opacity: "0.8", marginTop: "-6px" } },
          ""
        );

        // ----- Auth Row -----
        const tokenField = uiInput("Paste CivitAI API token (stored locally)", "password");
        const btnSaveToken = uiButton("Save Token", () => onSaveToken());
        const btnClearToken = uiButton("Clear Token", () => onClearToken(), { danger: true });

        const authRow = el(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: "8px",
              alignItems: "center",
            },
          },
          [tokenField, btnSaveToken, btnClearToken]
        );

        // ----- Filters Strip (horizontal scroll) -----
        const selBaseModel = uiSelect();
        const selModelType = uiSelect();
        const selFileFormat = uiSelect();
        const selCategory = uiSelect();

        // Sorting Order dropdown (populated by API /filters)
        const selSortOrder = uiSelect();

        // Ensure ALL dropdowns start with Any
        fillSelect(selBaseModel, ["Any"], false);
        fillSelect(selModelType, ["Any"], false);
        fillSelect(selFileFormat, ["Any"], false);
        fillSelect(selCategory, ["Any"], false);

        // Sorting Order: Any always at top
        fillSelect(selSortOrder, ["Any", "Relevance"], false);
        selSortOrder.value = "Any";

        const btnRefreshFilters = uiButton("Refresh Filters", () => loadFilters(true), {
          title: "Reload filter options",
        });

        const filtersStrip = el(
          "div",
          {
            style: {
              display: "flex",
              gap: "8px",
              overflowX: "auto",
              paddingBottom: "6px",
            },
          },
          [
            labeled("Base Model", selBaseModel),
            labeled("Model Type", selModelType),
            labeled("File Format", selFileFormat),
            labeled("Category", selCategory),

            labeled("Sorting Order", selSortOrder),

            el(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  minWidth: "160px",
                },
              },
              [btnRefreshFilters]
            ),
          ]
        );

        // ----- Search Row -----
        const searchField = uiInput("Search CivitAI…");
        const btnSearch = uiButton("Search", () => onSearch());

        const searchRow = el(
          "div",
          { style: { display: "grid", gridTemplateColumns: "1fr auto", gap: "8px" } },
          [searchField, btnSearch]
        );

        // ----- Grid Scroll Area -----
        const scroll = el("div", {
          style: {
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            flex: "1",
            minHeight: "0",
            paddingRight: "4px",
          },
        });

        const grid = el("div", {
          style: {
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(var(--civitai-card, 256px), 1fr))`,
            gap: "10px",
            alignItems: "start",
          },
        });

        scroll.appendChild(grid);

        // ----- Bottom Bar -----
        const bottomBar = el("div", {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            paddingTop: "6px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
          },
        });

        const bottomLeft = el("div", { style: { fontSize: "12px", opacity: "0.85" } }, "");
        const sizeLabel = el("div", { style: { fontSize: "12px", opacity: "0.75" } }, "");

        const sizeSlider = el("input", {
          type: "range",
          min: "128",
          max: "2048",
          step: "128",
          value: String(getPreviewSize()),
          style: { width: "260px" },
          oninput: (e) => {
            const v = clamp(parseInt(e.target.value || "256", 10), 128, 2048);
            setPreviewSize(v);
            root.style.setProperty("--civitai-card", `${v}px`);
            sizeLabel.textContent = `Preview Size: ${v}px`;
          },
        });

        const bottomRight = el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px" } },
          [sizeLabel, sizeSlider]
        );

        bottomBar.appendChild(bottomLeft);
        bottomBar.appendChild(bottomRight);

        // Compose
        root.appendChild(title);
        root.appendChild(statusLine);
        root.appendChild(authRow);
        root.appendChild(filtersStrip);
        root.appendChild(searchRow);
        root.appendChild(scroll);
        root.appendChild(bottomBar);

        // Init CSS var for card size
        const initialSize = getPreviewSize();
        root.style.setProperty("--civitai-card", `${initialSize}px`);
        sizeLabel.textContent = `Preview Size: ${initialSize}px`;
// === Block 6 Finish === Layout Construction === //

// === Block 7 Start === Render UI === //

        function setStatus(msg, severity = "info") {
          statusLine.textContent = msg || "";
          if (severity === "error") statusLine.style.color = "#ff6b6b";
          else if (severity === "success") statusLine.style.color = "#51cf66";
          else statusLine.style.color = "";
        }

        function setBottom(msg) {
          bottomLeft.textContent = msg || "";
        }

        function clearGrid(msg) {
          grid.innerHTML = "";
          if (msg) {
            grid.appendChild(
              el(
                "div",
                { style: { fontSize: "12px", opacity: "0.75", padding: "8px" } },
                msg
              )
            );
          }
        }

        function cardButton(label, onClick, opts = {}) {
          return uiButton(label, onClick, opts);
        }
// === Block 7 Finish === Render UI === //

// === Block 8 Start === Card System === //

        function badgeStyle() {
          return {
            fontSize: "10px",
            padding: "2px 6px",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.08)",
          };
        }

        function makeCard(item) {

          // ----- Header: Name (left) + Author (right) -----
          const headerRow = el(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
              },
            },
            [
              el(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    lineHeight: "1.2",
                    fontWeight: "600",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                item?.name || "(unnamed)"
              ),
              el(
                "div",
                {
                  style: {
                    fontSize: "11px",
                    opacity: "0.7",
                    whiteSpace: "nowrap",
                  },
                },
                item?.creator || "Unknown"
              ),
            ]
          );

          // ----- Thumbnail -----
          const thumbWrap = el("div", {
            style: {
              width: "100%",
              aspectRatio: "1 / 1",
              borderRadius: "10px",
              overflow: "hidden",
              background: "rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
          });

          if (item?.thumb) {
            thumbWrap.appendChild(
              el("img", {
                src: item.thumb,
                loading: "lazy",
                style: {
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                },
              })
            );
          } else {
            thumbWrap.appendChild(
              el("div", { style: { fontSize: "12px", opacity: "0.65" } }, "No Preview")
            );
          }

          // ----- Metadata badges -----
          const meta = el(
            "div",
            {
              style: {
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
                fontSize: "11px",
                opacity: "0.8",
              },
            },
            [
              el("span", { style: badgeStyle() }, item?.baseModel || "Base?"),
              el("span", { style: badgeStyle() }, item?.type || "Type?"),
              el(
                "span",
                { style: badgeStyle() },
                item?.fileFormats?.length ? item.fileFormats.join(", ") : "fmt?"
              ),
              el("span", { style: badgeStyle() }, item?.installed ? "Installed" : "Not Installed"),
            ]
          );

          // ----- Install button with progress bar -----
          const installProgress = el("div", {
            style: {
              position: "absolute",
              inset: "0",
              width: "0%",
              background: "rgba(80, 140, 255, 0.35)",
              transition: "width 0.25s ease",
              borderRadius: "10px",
              zIndex: "0",
            },
          });

          const installLabel = el(
            "div",
            {
              style: {
                position: "relative",
                zIndex: "1",
              },
            },
            item?.installed ? "Installed" : "Install"
          );

          const btnInstall = uiButton("", () => onInstall(item), {
            disabled: !item?.defaultVersionId || !!item?.installed,
          });

          btnInstall.style.position = "relative";
          btnInstall.style.overflow = "hidden";
          btnInstall.textContent = "";
          btnInstall.appendChild(installProgress);
          btnInstall.appendChild(installLabel);

          const btnUninstall = uiButton("Uninstall", () => onUninstall(item), {
            disabled: !item?.defaultVersionId || !item?.installed,
            danger: true,
          });

          const buttons = el(
            "div",
            { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
            [btnInstall, btnUninstall]
          );

          const card = el(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "8px" } },
            [headerRow, thumbWrap, meta, buttons]
          );

          // Attach ID for robust finding
          if (item?.defaultVersionId) {
            card.dataset.civitaiId = item.defaultVersionId;
          }

          // ----- State helpers -----
          card.__setInstalled = (isInstalled) => {
            item.installed = !!isInstalled;
            installLabel.textContent = item.installed ? "Installed" : "Install";
            installProgress.style.width = "0%";

            btnInstall.__setDisabled(!item.defaultVersionId || item.installed);
            btnUninstall.__setDisabled(!item.defaultVersionId || !item.installed);

            const badges = meta.querySelectorAll("span");
            if (badges && badges.length) {
              badges[badges.length - 1].textContent = item.installed
                ? "Installed"
                : "Not Installed";
            }
          };

          card.__setBusy = (busyText, progress = 0) => {
            btnInstall.__setDisabled(true);
            btnUninstall.__setDisabled(true);

            installLabel.textContent = busyText || "Installing…";
            installProgress.style.width = `${Math.max(0, Math.min(100, progress))}%`;
          };

          return card;
        }

        function findCardForItem(item) {
          if (!item || !item.defaultVersionId) return null;
          // Query by ID to avoid mismatches due to duplicate names or special chars
          return grid.querySelector(`div[data-civitai-id="${item.defaultVersionId}"]`) || null;
        }
// === Block 8 Finish === Card System === //

// === Block 9 Start === API Operations === //

function _asStringList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (typeof x === "string" ? x : (x?.name || String(x || ""))))
    .map((s) => (s || "").trim())
    .filter(Boolean);
}

function _withAnyTop(list) {
  const out = _asStringList(list);
  const dedup = [];
  const seen = new Set();

  for (const v of out) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(v);
  }

  // Always force Any to top
  const filtered = dedup.filter((x) => x.toLowerCase() !== "any");
  return ["Any", ...filtered];
}

async function loadStatus() {
  try {
    const s = await fetchJson(`${API_BASE}/status`, { method: "GET" });

    // New API: canEncrypt is intentionally false (plaintext token storage).
    if (s?.ok) {
      setStatus(s?.hasToken ? "Token saved." : "No token saved yet.", "info");
    } else {
      setStatus("CivitAI backend returned an error status.", "error");
    }
  } catch (e) {
    console.error(e);
    setStatus("CivitAI backend not reachable. Check server console.", "error");
  }
}

async function loadFilters(force = false) {
  try {
    setStatus("Loading filters…", "info");

    const f = await fetchJson(
      `${API_BASE}/filters?force=${force ? "1" : "0"}`,
      { method: "GET" }
    );

    // Ensure Any is always top for every dropdown
    fillSelect(selModelType, _withAnyTop(f?.types), true);
    fillSelect(selBaseModel, _withAnyTop(f?.baseModels), true);
    fillSelect(selFileFormat, _withAnyTop(f?.fileFormats), true);

    const catsRaw = f?.categories || [];
    fillSelect(selCategory, _withAnyTop(catsRaw), true);

    const sortRaw = f?.sortOrders || f?.sort_orders || f?.sort || [];
    const sortList = _asStringList(sortRaw);

    const sortFinal = ["Any", ...(sortList.length ? sortList : ["Relevance"])];
    const prevSort = selSortOrder.value || "Any";

    fillSelect(selSortOrder, sortFinal, false);
    selSortOrder.value = sortFinal.includes(prevSort) ? prevSort : "Any";

    setStatus("Filters loaded.", "success");
  } catch (e) {
    console.error(e);
    setStatus("Failed to load filters. Check server console.", "error");
  }
}

async function onSaveToken() {
  const token = (tokenField.value || "").trim();
  if (!token) {
    toast("Paste a token first.", "warn");
    return;
  }

  try {
    await fetchJson(`${API_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    tokenField.value = "";
    toast("Token saved.", "success");

    await loadStatus();
    await loadFilters(true);
  } catch (e) {
    console.error(e);
    toast(e?.message || "Token save failed.", "error");
  }
}

async function onClearToken() {
  try {
    await fetchJson(`${API_BASE}/token/clear`, { method: "POST" });
    toast("Token cleared.", "success");
    await loadStatus();
    await loadFilters(true);
  } catch (e) {
    console.error(e);
    toast(e?.message || "Token clear failed.", "error");
  }
}

async function onSearch() {
  const q = (searchField.value || "").trim();

  const params = new URLSearchParams({
    q,
    limit: "60",
    page: "1",
    baseModel: selBaseModel.value || "Any",
    modelType: selModelType.value || "Any",
    fileFormat: selFileFormat.value || "Any",
    category: selCategory.value || "Any",
  });

  const sortPick = (selSortOrder.value || "Any").trim();
  if (sortPick && sortPick.toLowerCase() !== "any") {
    params.set("sort", sortPick);
  }

  clearGrid("Searching…");
  setBottom("");
  setStatus("Searching CivitAI…", "info");

  try {
    const res = await fetchJson(
      `${API_BASE}/search?${params.toString()}`,
      { method: "GET" }
    );

    const items = Array.isArray(res?.items) ? res.items : [];
    grid.innerHTML = "";

    if (!items.length) {
      clearGrid("No results. Try different filters or search terms.");
      setBottom(
        res?.searchMode === "tag_fallback"
          ? "No results (tag fallback)."
          : "No results."
      );
      setStatus("Search complete.", "success");
      return;
    }

    for (const it of items) {
      grid.appendChild(makeCard(it));
    }

    setBottom(
      `Showing ${items.length} result(s)${
        res?.searchMode === "tag_fallback" ? " (tag fallback)" : ""
      }.`
    );
    setStatus("Search complete.", "success");
  } catch (e) {
    console.error(e);
    clearGrid("");
    setStatus(e?.message || "Search failed. Check server console.", "error");
  }
}

// Helper to poll for download progress
async function checkDownloadProgress(versionId, card) {
  try {
    const data = await fetchJson(`${API_BASE}/progress/${versionId}`);
    if (data && typeof data.progress === 'number') {
      card?.__setBusy?.("Installing…", data.progress);
    }
  } catch (e) {
    // Fail silently during polling to avoid console spam
  }
}

async function onInstall(item) {
  const vid = item?.defaultVersionId;
  if (!vid) {
    toast("Invalid model ID.", "error");
    return;
  }

  const card = findCardForItem(item);
  card?.__setBusy?.("Installing…", 0);

  // Start polling for progress
  const progressInterval = setInterval(() => {
    checkDownloadProgress(vid, card);
  }, 500);

  try {
    const categoryPick = (selCategory?.value || "Any").trim();

    const payload = {
      versionId: vid,
      baseModel: selBaseModel.value || "Any",
      fileFormat: selFileFormat.value || "Any",
    };

    // NEW: pass category through so backend can sort into:
    // .\models\<Type>\<Base Model>\<Category>\...
    if (categoryPick && categoryPick.toLowerCase() !== "any") {
      payload.category = categoryPick;
    }

    const res = await fetchJson(`${API_BASE}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Stop polling once install finishes (success or fail)
    clearInterval(progressInterval);

    const ok = typeof res === "string" ? true : !!res?.ok;

    if (ok) {
      const savedPath =
        typeof res === "string"
          ? res
          : (res?.saved_to || res?.path || res?.installedPath || "");

      toast(`Installed: ${item?.name}`, "success");
      item.installed = true;
      item.installedPath = savedPath;
      card?.__setInstalled?.(true);
      setStatus("Install complete.", "success");
    } else {
      throw new Error(res?.error || "Install failed.");
    }
  } catch (e) {
    // Stop polling on error
    clearInterval(progressInterval);
    
    console.error(e);
    toast(e?.message || "Install failed.", "error");
    card?.__setBusy?.(""); // Clear progress
    card?.__setInstalled?.(!!item.installed);
  }
}

async function onUninstall(item) {
  const vid = item?.defaultVersionId;
  if (!vid) return;

  const card = findCardForItem(item);
  card?.__setBusy?.("Removing…");

  try {
    const res = await fetchJson(`${API_BASE}/uninstall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: vid }),
    });

    if (res?.ok) {
      toast(`Uninstalled: ${item?.name}`, "success");
      item.installed = false;
      item.installedPath = "";
      card?.__setInstalled?.(false);
      setStatus("Uninstall complete.", "success");
    } else {
      throw new Error(res?.error || "Uninstall failed.");
    }
  } catch (e) {
    console.error(e);
    toast(e?.message || "Uninstall failed.", "error");
    card?.__setBusy?.("");
    card?.__setInstalled?.(!!item.installed);
  }
}
// === Block 9 Finish === API Operations === //

// === Block 10 Start === Event Wiring === //

        // Events
        searchField.addEventListener("keydown", (e) => {
          if (e.key === "Enter") onSearch();
        });

        // Initial load
        clearGrid("Use the search bar to find models.");
        setBottom("Ready.");
        loadStatus();
        loadFilters(false);
// === Block 10 Finish === Event Wiring === //

// === Block 11 Start === Code End === //

      }, // render
    }); // registerSidebarTab
  }, // setup
}); // registerExtension
// === Block 11 Finish === Code End === //
