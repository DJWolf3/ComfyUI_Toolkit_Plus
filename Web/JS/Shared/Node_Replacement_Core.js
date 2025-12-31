// web/js/shared/Node_Replacement_Core.js
import { app } from "../../../scripts/app.js";

export const TKP_CMD_REPLACE_NODE = "toolkit_plus.replace_node";

// ---------- global guards / caches ----------
const TKP_STATE = (globalThis.__TKP_NODE_REPLACE_STATE__ ??= {
  isOpen: false,
  ioCache: null,      // Map<typeName, {inTypes: (string|null)[], outTypes: (string|null)[]}>
  ioCacheBuilt: false,
});

export function getSingleSelectedNode() {
  try {
    const canvas = app?.canvas;
    const graph = app?.graph;

    const selectedMap = canvas?.selected_nodes;
    if (selectedMap && typeof selectedMap === "object") {
      const nodes = Object.values(selectedMap).filter(Boolean);
      if (nodes.length === 1) return nodes[0];
      return null;
    }

    const current = canvas?.current_node;
    if (current) return current;

    const nodes = graph?._nodes;
    if (Array.isArray(nodes)) {
      const selected = nodes.filter((n) => n?.is_selected);
      if (selected.length === 1) return selected[0];
    }

    return null;
  } catch {
    return null;
  }
}

export async function runReplaceNodeFlow(node) {
  if (TKP_STATE.isOpen) return; // prevent double modal
  TKP_STATE.isOpen = true;

  try {
    if (!node) node = getSingleSelectedNode();
    if (!node) return;

    const graph = app?.graph;
    if (!graph) return;

    // Build IO cache ONCE (expensive)
    await ensureIOCacheBuilt();

    const candidates = getValidReplacementsFromConnections(graph, node);
    if (!candidates.length) return;

    const chosen = await searchNodesModal({
      title: "Search Nodes...",
      subtitle: `Replace: ${node.type}`,
      types: candidates,
      initialQuery: "",
    });

    if (!chosen || chosen === node.type) return;

    replaceNode(graph, node, chosen);
    graph.setDirtyCanvas?.(true, true);
    app.canvas?.draw?.(true, true);
  } finally {
    TKP_STATE.isOpen = false;
  }
}

// ------------------------------------------------
// Cache builder (runs once)
// ------------------------------------------------
async function ensureIOCacheBuilt() {
  if (TKP_STATE.ioCacheBuilt && TKP_STATE.ioCache) return;

  const reg = globalThis.LiteGraph?.registered_node_types;
  if (!reg) {
    TKP_STATE.ioCache = new Map();
    TKP_STATE.ioCacheBuilt = true;
    return;
  }

  TKP_STATE.ioCache = new Map();

  // Yield to UI so it doesn’t feel frozen
  await new Promise((r) => setTimeout(r, 0));

  for (const typeName of Object.keys(reg)) {
    const node = safeCreateNode(typeName);
    if (!node) continue;

    const inTypes = (node.inputs ?? []).map((i) => i?.type ?? null);
    const outTypes = (node.outputs ?? []).map((o) => o?.type ?? null);

    TKP_STATE.ioCache.set(typeName, { inTypes, outTypes });
  }

  TKP_STATE.ioCacheBuilt = true;
}

function safeCreateNode(typeName) {
  try {
    return globalThis.LiteGraph?.createNode?.(typeName) ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------
// Valid replacements based on CURRENT connections
// ------------------------------------------------
function getValidReplacementsFromConnections(graph, oldNode) {
  const cache = TKP_STATE.ioCache;
  if (!cache) return [];

  // Required types from connections:
  const reqIn = [];
  (oldNode.inputs ?? []).forEach((inp, idx) => {
    const linkId = inp?.link;
    if (linkId == null) return;
    const link = graph.links?.[linkId];
    if (!link) return;

    const origin = graph.getNodeById?.(link.origin_id);
    const originOut = origin?.outputs?.[link.origin_slot];
    reqIn[idx] = originOut?.type ?? inp?.type ?? null;
  });

  const reqOut = [];
  (oldNode.outputs ?? []).forEach((out, idx) => {
    if (Array.isArray(out?.links) && out.links.length > 0) {
      reqOut[idx] = out?.type ?? null;
    }
  });

  const minInSlots = highestRequiredIndex(reqIn) + 1;
  const minOutSlots = highestRequiredIndex(reqOut) + 1;

  const results = [];
  for (const [typeName, sig] of cache.entries()) {
    if (typeName === oldNode.type) continue;

    if (sig.inTypes.length < minInSlots) continue;
    if (sig.outTypes.length < minOutSlots) continue;

    if (!matchRequired(reqIn, sig.inTypes)) continue;
    if (!matchRequired(reqOut, sig.outTypes)) continue;

    results.push(typeName);
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function highestRequiredIndex(arr) {
  let hi = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i] != null) hi = i;
  return hi;
}

function matchRequired(required, candidate) {
  for (let i = 0; i < required.length; i++) {
    const r = required[i];
    if (r == null) continue;
    const c = candidate[i];
    if (!typeCompatible(r, c)) return false;
  }
  return true;
}

function typeCompatible(requiredType, candidateType) {
  if (!requiredType) return true;
  if (!candidateType) return false;

  const A = String(requiredType).toLowerCase();
  const B = String(candidateType).toLowerCase();

  if (A === "*" || A === "any") return true;
  if (B === "*" || B === "any") return true;

  return A === B;
}

// ------------------------------------------------
// NEW: normalize node positions to valid [x,y] numbers
// This prevents pos: [null,null] (or object/odd formats) from breaking zod validation.
// ------------------------------------------------
function normalizePos(pos) {
  let x = 0, y = 0;

  // Array format: [x, y]
  if (Array.isArray(pos)) {
    x = pos[0];
    y = pos[1];
  }
  // Object format: {x, y} or {0: x, 1: y}
  else if (pos && typeof pos === "object") {
    x = pos.x ?? pos[0];
    y = pos.y ?? pos[1];
  }

  x = Number(x);
  y = Number(y);

  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;

  return [x, y];
}

// ------------------------------------------------
// Replace node (keeps position + tries to reconnect)
// ------------------------------------------------
function replaceNode(graph, oldNode, newType) {
  const newNode = safeCreateNode(newType);
  if (!newNode) return;

  // ✅ CHANGED: always force valid numeric position
  const pos = normalizePos(oldNode?.pos);
  const size = oldNode.size ? [...oldNode.size] : null;

  const inputLinks = snapshotInputs(graph, oldNode);
  const outputLinks = snapshotOutputs(graph, oldNode);

  graph.add(newNode);

  // ✅ CHANGED: ensure newNode.pos is valid numbers
  newNode.pos = normalizePos(pos);

  if (size && newNode.size) {
    newNode.size[0] = size[0];
    newNode.size[1] = size[1];
  }

  reconnectInputs(graph, newNode, inputLinks);
  reconnectOutputs(graph, newNode, outputLinks);

  graph.remove(oldNode);
  try { app.canvas?.selectNode?.(newNode, false); } catch {}
}

function snapshotInputs(graph, node) {
  const links = [];
  node.inputs?.forEach((inp, index) => {
    if (inp?.link == null) return;
    const link = graph.links?.[inp.link];
    if (!link) return;
    links.push({ origin_id: link.origin_id, origin_slot: link.origin_slot, target_slot: index, name: inp.name });
  });
  return links;
}

function snapshotOutputs(graph, node) {
  const links = [];
  node.outputs?.forEach((out, index) => {
    out.links?.forEach((linkId) => {
      const link = graph.links?.[linkId];
      if (!link) return;
      links.push({ target_id: link.target_id, target_slot: link.target_slot, origin_slot: index, name: out.name });
    });
  });
  return links;
}

function reconnectInputs(graph, newNode, links) {
  links.forEach((l) => {
    const origin = graph.getNodeById?.(l.origin_id);
    if (!origin) return;
    const idx = l.target_slot;
    if (!newNode.inputs || idx < 0 || idx >= newNode.inputs.length) return;
    try { origin.connect(l.origin_slot, newNode, idx); } catch {}
  });
}

function reconnectOutputs(graph, newNode, links) {
  links.forEach((l) => {
    const target = graph.getNodeById?.(l.target_id);
    if (!target) return;
    const idx = l.origin_slot;
    if (!newNode.outputs || idx < 0 || idx >= newNode.outputs.length) return;
    try { newNode.connect(idx, target, l.target_slot); } catch {}
  });
}

// ------------------------------------------------
// Modal (live search)
// ------------------------------------------------
function searchNodesModal({ title, subtitle, types, initialQuery }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "999999";
    overlay.style.background = "rgba(0,0,0,0.55)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const panel = document.createElement("div");
    panel.style.width = "620px";
    panel.style.maxWidth = "92vw";
    panel.style.maxHeight = "80vh";
    panel.style.background = "rgba(25,25,25,0.98)";
    panel.style.border = "1px solid rgba(255,255,255,0.12)";
    panel.style.borderRadius = "14px";
    panel.style.boxShadow = "0 18px 60px rgba(0,0,0,0.55)";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.overflow = "hidden";

    const header = document.createElement("div");
    header.style.padding = "14px";
    header.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

    const t = document.createElement("div");
    t.textContent = title || "Search Nodes...";
    t.style.fontSize = "16px";
    t.style.fontWeight = "700";
    t.style.color = "rgba(255,255,255,0.92)";

    const sub = document.createElement("div");
    sub.textContent = subtitle || "";
    sub.style.marginTop = "4px";
    sub.style.fontSize = "12px";
    sub.style.color = "rgba(255,255,255,0.62)";

    header.appendChild(t);
    header.appendChild(sub);

    const body = document.createElement("div");
    body.style.padding = "12px 14px";
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "10px";

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search…";
    search.value = initialQuery || "";
    search.style.width = "100%";
    search.style.padding = "10px 12px";
    search.style.borderRadius = "10px";
    search.style.border = "1px solid rgba(255,255,255,0.12)";
    search.style.background = "rgba(255,255,255,0.06)";
    search.style.color = "rgba(255,255,255,0.92)";
    search.style.outline = "none";

    const list = document.createElement("div");
    list.style.height = "52vh";
    list.style.maxHeight = "440px";
    list.style.overflow = "auto";
    list.style.borderRadius = "10px";
    list.style.border = "1px solid rgba(255,255,255,0.10)";
    list.style.background = "rgba(255,255,255,0.03)";

    const footer = document.createElement("div");
    footer.style.padding = "12px 14px";
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";
    footer.style.gap = "10px";
    footer.style.borderTop = "1px solid rgba(255,255,255,0.08)";

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    styleBtn(cancel, false);

    const ok = document.createElement("button");
    ok.textContent = "Replace";
    styleBtn(ok, true);
    ok.disabled = true;
    ok.style.opacity = "0.65";

    footer.appendChild(cancel);
    footer.appendChild(ok);

    body.appendChild(search);
    body.appendChild(list);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let chosen = null;

    function setChosen(v) {
      chosen = v;
      ok.disabled = !chosen;
      ok.style.opacity = chosen ? "1.0" : "0.65";
    }

    function render(filterText) {
      const ft = (filterText ?? "").trim().toLowerCase();
      const filtered = !ft ? types : types.filter((x) => x.toLowerCase().includes(ft));

      list.innerHTML = "";
      for (const type of filtered.slice(0, 1500)) {
        const item = document.createElement("div");
        item.textContent = type;
        item.style.padding = "8px 10px";
        item.style.cursor = "pointer";
        item.style.fontSize = "13px";
        item.style.color = "rgba(255,255,255,0.88)";
        item.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
        item.style.background = chosen === type ? "rgba(255,255,255,0.10)" : "transparent";

        item.addEventListener("click", () => {
          setChosen(type);
          render(search.value);
        });

        item.addEventListener("dblclick", () => {
          cleanup();
          resolve(type);
        });

        list.appendChild(item);
      }
    }

    function cleanup() {
      window.removeEventListener("keydown", onKey);
      overlay.remove();
    }

    function onKey(e) {
      if (e.key === "Escape") { cleanup(); resolve(null); }
      if (e.key === "Enter") {
        if (!chosen) return;
        cleanup(); resolve(chosen);
      }
    }

    cancel.addEventListener("click", () => { cleanup(); resolve(null); });
    ok.addEventListener("click", () => { if (!chosen) return; cleanup(); resolve(chosen); });

    search.addEventListener("input", () => {
      const ft = search.value.trim().toLowerCase();
      if (chosen && ft && !chosen.toLowerCase().includes(ft)) setChosen(null);
      render(search.value);
    });

    window.addEventListener("keydown", onKey);

    render(search.value);
    setTimeout(() => search.focus(), 0);
  });
}

function styleBtn(btn, primary) {
  btn.style.padding = "9px 14px";
  btn.style.borderRadius = "10px 10px";
  btn.style.border = "1px solid rgba(255,255,255,0.14)";
  btn.style.cursor = "pointer";
  btn.style.fontSize = "13px";
  btn.style.fontWeight = "700";
  btn.style.background = primary ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
  btn.style.color = "rgba(255,255,255,0.92)";
}
