// ComfyUI_Sample_Pack/web/js/Panel_Prompt_Library.js
//
// Final Panel Layout (top -> bottom):
// 1) New | Rename | Delete
// 2) Manifest Name Field
// 3) Save | Load | Clear           (panel fields + files only, NEVER workflow)
// 4) Search Field
// 5) Manifest Dropdown
// 6) Refresh (full width)          <-- ADDED under dropdown
// 7) Positive Prompt Field
// 8) Negative Prompt Field
// Bottom: Copy Positive | Copy Negative | Copy Both
//
// UX Touches:
// - Disable buttons when manifest not selected / name field empty
// - Delete has confirm
// - Rename requires selection + name field
// - New requires name field
// - Save/Load require selection
// - Clear always enabled

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXT_NAME = "comfyui_sample_pack.prompt_library";
const TAB_ID = "promptLibrary";
const API_BASE = "/sample_pack/prompt_library";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function toast(msg, severity = "info") {
  try {
    app?.extensionManager?.toast?.add?.({
      severity,
      summary: "Prompt Library",
      detail: msg,
      life: 2600,
    });
  } catch (_) {}
}

async function fetchJson(path, options = {}) {
  const res = await api.fetchApi(path, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return await res.json();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ""));
    toast("Copied ✓", "success");
    return true;
  } catch (_) {
    toast("Clipboard copy blocked by browser.", "warn");
    return false;
  }
}

// Grid row: N buttons => equal widths
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
        background: danger ? "rgba(255, 70, 70, 0.15)" : "var(--bg-color, #2a2a2a)",
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

function uiInput(placeholder) {
  const inp = el("input", {
    type: "text",
    placeholder,
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
  return inp;
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

function uiTextArea(placeholder, minHeightPx = 180) {
  return el("textarea", {
    placeholder,
    style: {
      width: "100%",
      minHeight: `${minHeightPx}px`,
      resize: "vertical",
      padding: "10px",
      borderRadius: "10px",
      border: "1px solid var(--border-color, #444)",
      background: "var(--bg-color, #1f1f1f)",
      color: "var(--fg-color, #eee)",
      outline: "none",
      boxSizing: "border-box",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: "12px",
      lineHeight: "1.35",
      whiteSpace: "pre-wrap",
    },
  });
}

app.registerExtension({
  name: EXT_NAME,

  async setup() {
    app.extensionManager.registerSidebarTab({
      id: TAB_ID,
      icon: "pi pi-book",
      title: "Prompts",
      tooltip: "Prompt Library (p)", // UPDATED TOOLTIP
      type: "custom",
      render: (root) => {
        root.innerHTML = "";
        root.style.padding = "10px";
        root.style.display = "flex";
        root.style.flexDirection = "column";
        root.style.gap = "10px";
        root.style.height = "100%";
        root.style.boxSizing = "border-box";

        // Header
        const title = el("div", { style: { fontSize: "14px", fontWeight: "650" } }, "Prompt Library");
        const sub = el(
          "div",
          { style: { fontSize: "12px", opacity: "0.75", marginTop: "-6px" } },
          ""
        );

        const manifestNameField = uiInput("Enter Name Here...");
        const searchField = uiInput("Enter Search Terms Here...");
        const dropdown = uiSelect();

        const posField = uiTextArea("Positive Prompt…", 220);
        const negField = uiTextArea("Negative Prompt…", 180);

        // Labels
        const lblManifestName = el("div", { style: { fontSize: "12px", opacity: "0.85" } }, "Prompt Name");
        const lblSearch = el("div", { style: { fontSize: "12px", opacity: "0.85" } }, "Search Prompt List");
        const lblSelect = el("div", { style: { fontSize: "12px", opacity: "0.85" } }, "Prompt Menu");
        const lblPos = el("div", { style: { fontSize: "12px", opacity: "0.85" } }, "Positive Prompt");
        const lblNeg = el("div", { style: { fontSize: "12px", opacity: "0.85" } }, "Negative Prompt");

        // Buttons
        const btnNew = uiButton("New", () => onNew());
        const btnRename = uiButton("Rename", () => onRename());
        const btnDelete = uiButton("Delete", () => onDelete(), { danger: true });

        const btnSave = uiButton("Save", () => onSave());
        const btnLoad = uiButton("Load", () => onLoad());
        const btnClear = uiButton("Clear", () => onClear());

        // NEW: Refresh button (full width) under dropdown
        const btnRefresh = uiButton("Refresh", () => onRefresh(), {
          title: "Reload manifests from disk",
        });

        const btnCopyPos = uiButton("Copy Positive", () => copyToClipboard(posField.value));
        const btnCopyNeg = uiButton("Copy Negative", () => copyToClipboard(negField.value));
        const btnCopyBoth = uiButton("Copy Both", () =>
          copyToClipboard(`# Positive\n${posField.value ?? ""}\n\n# Negative\n${negField.value ?? ""}`)
        );

        // Scroll area for big fields
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

        root.appendChild(title);
        root.appendChild(sub);

        // 1) New | Rename | Delete
        root.appendChild(buttonRow([btnNew, btnRename, btnDelete]));

        // 2) Manifest Name Field
        root.appendChild(lblManifestName);
        root.appendChild(manifestNameField);

        // 3) Save | Load | Clear
        root.appendChild(buttonRow([btnSave, btnLoad, btnClear]));

        // 4) Search Field
        root.appendChild(lblSearch);
        root.appendChild(searchField);

        // 5..8 + Copy row in scroll
        scroll.appendChild(lblSelect);
        scroll.appendChild(dropdown);

        // 6) Refresh under dropdown (full width)
        scroll.appendChild(btnRefresh);

        scroll.appendChild(lblPos);
        scroll.appendChild(posField);

        scroll.appendChild(lblNeg);
        scroll.appendChild(negField);

        scroll.appendChild(buttonRow([btnCopyPos, btnCopyNeg, btnCopyBoth]));

        root.appendChild(scroll);

        // State
        let allItems = [];

        function getSelectedName() {
          const v = (dropdown.value || "").trim();
          return v;
        }

        function getTypedName() {
          return manifestNameField.value ?? "";
        }

        function setDropdownItems(items, keepSelected = true) {
          const current = keepSelected ? dropdown.value : "";
          dropdown.innerHTML = "";
          dropdown.appendChild(el("option", { value: "" }, "— Select a manifest —"));

          for (const it of items) {
            const labelParts = [];
            labelParts.push(it.title || it.id);
            if (it.category) labelParts.push(`[${it.category}]`);
            if (Array.isArray(it.tags) && it.tags.length) labelParts.push(`{${it.tags.slice(0, 4).join(", ")}}`);
            const label = labelParts.join(" ");
            dropdown.appendChild(el("option", { value: it.id }, label));
          }

          if (keepSelected && current) dropdown.value = current;
        }

        function applySearchFilter() {
          const q = (searchField.value || "").trim().toLowerCase();
          if (!q) return allItems;
          return allItems.filter((it) => {
            const t = (it.title || "").toLowerCase();
            const c = (it.category || "").toLowerCase();
            const tags = Array.isArray(it.tags) ? it.tags.join(" ").toLowerCase() : "";
            const id = (it.id || "").toLowerCase();
            return t.includes(q) || c.includes(q) || tags.includes(q) || id.includes(q);
          });
        }

        function updateButtonStates() {
          const selected = getSelectedName();
          const typed = getTypedName();

          const hasSelection = !!selected;
          const hasTypedName = typed.length > 0;

          // Line 1
          btnNew.__setDisabled(!hasTypedName);
          btnRename.__setDisabled(!(hasSelection && hasTypedName));
          btnDelete.__setDisabled(!hasSelection);

          // Line 3
          btnSave.__setDisabled(!hasSelection);
          btnLoad.__setDisabled(!hasSelection);
          btnClear.__setDisabled(false);

          // Refresh always enabled
          btnRefresh.__setDisabled(false);
        }

        async function loadList(keepSelected = true, showToast = false) {
          const selectedBefore = getSelectedName();
          try {
            const data = await fetchJson(`${API_BASE}/list`, { method: "GET" });
            allItems = Array.isArray(data?.items) ? data.items : [];
            const filtered = applySearchFilter();
            setDropdownItems(filtered, keepSelected);

            // If we tried to keep selection but it disappeared, clear selection.
            if (keepSelected && selectedBefore && dropdown.value !== selectedBefore) {
              // dropdown.value will be "" if the option doesn't exist
              // keep name field as-is (user may be typing a new one)
            }

            if (showToast) toast(`Loaded ${allItems.length} prompt(s).`, "info");
            updateButtonStates();
          } catch (e) {
            console.error(e);
            toast("Failed to load prompt list. Check server console.", "error");
          }
        }

        async function onRefresh() {
          await loadList(true, true);
        }

        async function onNew() {
          const name = getTypedName();
          if (!name) return;

          try {
            const r = await fetchJson(`${API_BASE}/new`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            });

            toast(`Created: ${r?.name ?? name}`, "success");
            await loadList(false, false);

            dropdown.value = r?.name ?? name;
            manifestNameField.value = dropdown.value;

            await onLoad();
            updateButtonStates();
          } catch (e) {
            console.error(e);
            toast(e?.message || "Create failed.", "error");
          }
        }

        async function onRename() {
          const oldName = getSelectedName();
          const newName = getTypedName();
          if (!oldName || !newName) return;

          if (oldName === newName) {
            toast("Rename: new name is the same as current.", "warn");
            return;
          }

          const ok = confirm(`Rename "${oldName}" → "${newName}"?\n\nThis renames the manifest and its linked TXT files.`);
          if (!ok) return;

          try {
            const r = await fetchJson(`${API_BASE}/rename`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ old_name: oldName, new_name: newName }),
            });

            toast(`Renamed: ${r?.old_name ?? oldName} → ${r?.new_name ?? newName}`, "success");
            await loadList(false, false);

            dropdown.value = r?.new_name ?? newName;
            manifestNameField.value = dropdown.value;

            await onLoad();
            updateButtonStates();
          } catch (e) {
            console.error(e);
            toast(e?.message || "Rename failed.", "error");
          }
        }

        async function onDelete() {
          const name = getSelectedName();
          if (!name) return;

          const ok = confirm(`Delete "${name}"?\n\nThis removes the manifest and linked TXT files.`);
          if (!ok) return;

          try {
            const r = await fetchJson(`${API_BASE}/delete`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            });

            toast(`Deleted: ${r?.name ?? name}`, "success");

            dropdown.value = "";
            posField.value = "";
            negField.value = "";
            manifestNameField.value = "";

            await loadList(false, false);
            updateButtonStates();
          } catch (e) {
            console.error(e);
            toast(e?.message || "Delete failed.", "error");
          }
        }

        async function onSave() {
          const name = getSelectedName();
          if (!name) return;

          try {
            await fetchJson(`${API_BASE}/save`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                positive_text: posField.value ?? "",
                negative_text: negField.value ?? "",
              }),
            });

            toast(`Saved: ${name}`, "success");
            await loadList(true, false);
            updateButtonStates();
          } catch (e) {
            console.error(e);
            toast(e?.message || "Save failed.", "error");
          }
        }

        async function onLoad() {
          const name = getSelectedName();
          if (!name) return;

          try {
            const data = await fetchJson(`${API_BASE}/item?id=${encodeURIComponent(name)}`, { method: "GET" });
            posField.value = data?.positive_text ?? "";
            negField.value = data?.negative_text ?? "";
            toast(`Loaded: ${name}`, "success");
          } catch (e) {
            console.error(e);
            toast(e?.message || "Load failed.", "error");
          }
        }

        function onClear() {
          posField.value = "";
          negField.value = "";
          toast("Cleared fields.", "info");
          updateButtonStates();
        }

        // Events
        searchField.addEventListener("input", () => {
          const filtered = applySearchFilter();
          setDropdownItems(filtered, true);
          updateButtonStates();
        });

        manifestNameField.addEventListener("input", () => {
          updateButtonStates();
        });

        dropdown.addEventListener("change", () => {
          const sel = getSelectedName();
          if (sel) manifestNameField.value = sel;
          updateButtonStates();
        });

        // Initial
        loadList(true, false);
        updateButtonStates();
      },
    });
  },
});
