// === Block 0 Start === Header + Imports === //

// Panel_Gallery.js
// Gallery Panel (Images + Videos)
//
// Right-click:
// - Node menu: Save To Gallery… (shown with download icon)
// - Uses same section as Replace Node… if present

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
// === Block 0 Finish === Header + Imports === //

// === Block 1 Start === Constants + Bootstrap === //

(function () {
  try {
    // Prevent double-registration if loaded twice
    if (globalThis.__SAMPLE_PACK_GALLERY_PANEL_LOADED__) return;
    globalThis.__SAMPLE_PACK_GALLERY_PANEL_LOADED__ = true;

    const EXT_NAME = "comfyui_sample_pack.gallery";
    const TAB_ID = "gallery";
    const API_BASE = "/sample_pack/gallery";

    const LS_KEY_PREVIEW = "sample_pack.gallery.previewSize";
    const LS_KEY_PREVIEW_VER = "sample_pack.gallery.previewSize.ver";
    const LS_PREVIEW_VER = "3"; // bump to force default reset to 256 once

    const MEDIA_ALL = "all";
    const MEDIA_IMAGES = "images";
    const MEDIA_VIDEOS = "videos";

    const SORT_RELEVANT = "relevant";
    const SORT_NEWEST = "newest";
    const SORT_OLDEST = "oldest";
    const SORT_ASC = "asc";
    const SORT_DESC = "desc";
// === Block 1 Finish === Constants + Bootstrap === //

// === Block 2 Start === UI Helpers + Storage === //

    // NOTE:
    // - This block intentionally contains ALL small helpers the panel needs.
    // - A missing helper here can prevent the sidebar tab from registering.

    function clampInt(v, min, max) {
      const n = Number.parseInt(String(v ?? ""), 10);
      if (!Number.isFinite(n)) return min;
      return Math.max(min, Math.min(max, n));
    }

    function debounce(fn, ms) {
      let t = null;
      return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          t = null;
          try {
            fn(...args);
          } catch (e) {
            console.error(e);
          }
        }, ms);
      };
    }

    function el(tag, attrs = {}, children = null) {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined) continue;
        if (k === "style" && typeof v === "object") {
          Object.assign(n.style, v);
          continue;
        }
        if (k.startsWith("on") && typeof v === "function") {
          n[k] = v;
          continue;
        }
        try {
          n.setAttribute(k, String(v));
        } catch (_) {}
      }
      if (children !== null && children !== undefined) {
        const arr = Array.isArray(children) ? children : [children];
        for (const c of arr) {
          if (c === null || c === undefined) continue;
          if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
          else n.appendChild(c);
        }
      }
      return n;
    }

    function toast(msg, severity = "info") {
      // PrimeVue toast (preferred)
      const t = app?.extensionManager?.toast;
      if (t?.add) {
        t.add({ severity, summary: severity === "error" ? "Error" : "Gallery", detail: String(msg || ""), life: 3500 });
        return;
      }
      // Fallback: console + small in-page toast
      const text = String(msg || "");
      if (severity === "error") console.error(text);
      else console.log(text);

      try {
        const id = "__sample_pack_gallery_toast";
        let wrap = document.getElementById(id);
        if (!wrap) {
          wrap = el("div", {
            id,
            style: {
              position: "fixed",
              right: "14px",
              bottom: "14px",
              zIndex: "99999",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              pointerEvents: "none",
            },
          });
          document.body.appendChild(wrap);
        }

        const pill = el(
          "div",
          {
            style: {
              pointerEvents: "none",
              maxWidth: "420px",
              padding: "10px 12px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(20,20,20,0.92)",
              color: "rgba(255,255,255,0.92)",
              fontSize: "12px",
              boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
              opacity: "0",
              transform: "translateY(6px)",
              transition: "opacity 160ms ease, transform 160ms ease",
            },
          },
          text
        );

        wrap.appendChild(pill);
        requestAnimationFrame(() => {
          pill.style.opacity = "1";
          pill.style.transform = "translateY(0px)";
        });
        setTimeout(() => {
          pill.style.opacity = "0";
          pill.style.transform = "translateY(6px)";
          setTimeout(() => pill.remove(), 220);
        }, 3200);
      } catch (_) {}
    }

    async function fetchJson(url, options = {}) {
      const doFetch = api?.fetchApi ? api.fetchApi.bind(api) : fetch;
      const res = await doFetch(url, {
        cache: "no-cache",
        ...options,
      });

      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        // If not JSON, produce a helpful error
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Request failed (${res.status})`);
      }

      if (!res.ok) {
        const err = data?.error || data?.message || `Request failed (${res.status})`;
        throw new Error(err);
      }
      return data;
    }

    function uiButton(label, onClick, opts = {}) {
      const b = el(
        "button",
        {
          type: "button",
          title: opts.title || "",
          style: {
            width: "100%",
            padding: "8px 10px",
            borderRadius: "10px",
            border: "1px solid var(--border-color, rgba(255,255,255,0.12))",
            background: opts.danger ? "rgba(220,60,60,0.22)" : "rgba(255,255,255,0.06)",
            color: "var(--fg-color, rgba(255,255,255,0.92))",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: "650",
          },
          onclick: (e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();
            if (b.disabled) return;
            try {
              onClick?.(e);
            } catch (err) {
              console.error(err);
            }
          },
        },
        label
      );

      b.__setDisabled = (v) => {
        b.disabled = !!v;
        b.style.opacity = b.disabled ? "0.55" : "1";
        b.style.cursor = b.disabled ? "not-allowed" : "pointer";
      };

      if (opts.disabled) b.__setDisabled(true);
      return b;
    }

    function uiInput(placeholder) {
      return el("input", {
        type: "text",
        placeholder: placeholder || "",
        style: {
          width: "100%",
          padding: "8px 10px",
          borderRadius: "10px",
          border: "1px solid var(--border-color, rgba(255,255,255,0.12))",
          background: "rgba(255,255,255,0.04)",
          color: "var(--fg-color, rgba(255,255,255,0.92))",
          outline: "none",
          fontSize: "12px",
          boxSizing: "border-box",
        },
      });
    }

    function uiSelect() {
      return el("select", {
        style: {
          width: "100%",
          padding: "8px 10px",
          borderRadius: "10px",
          border: "1px solid var(--border-color, rgba(255,255,255,0.12))",
          background: "rgba(255,255,255,0.04)",
          color: "var(--fg-color, rgba(255,255,255,0.92))",
          outline: "none",
          fontSize: "12px",
          boxSizing: "border-box",
        },
      });
    }

    function buttonRow(items) {
      const row = el("div", {
        style: {
          width: "100%",
          display: "flex",
          gap: "10px",
          alignItems: "center",
        },
      });

      const arr = (items || []).filter(Boolean);
      const single = arr.length <= 1;

      for (const it of arr) {
        // Prompt Panel behavior:
        // - single button spans full width
        // - multiple share width evenly
        if (single) {
          it.style.width = "100%";
          it.style.flex = "1";
        } else {
          it.style.width = "auto";
          it.style.flex = "1";
        }
        row.appendChild(it);
      }

      return row;
    }

    // This used to be referenced by setup(); keep it as a stable alias.
    function installDomRightClickSave() {
      installContextMenuAugmenter();
    }

    async function blobToDataUrl(blob) {
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("Failed to read blob."));
        r.onload = () => resolve(String(r.result || ""));
        r.readAsDataURL(blob);
      });
    }

    async function saveUrlToGallery(url) {
      if (!url) throw new Error("No URL found to save.");

      // Some ComfyUI preview URLs can be relative; normalize.
      const abs = url.startsWith("http") ? url : url.startsWith("/") ? url : `/${url}`;

      // Prefer server-side fetching to avoid base64 for large media (videos, big images).
      // Only fall back to data_url for blob:/data: URLs.
      const canUseSourceUrl = !abs.startsWith("blob:") && !abs.startsWith("data:");

      let out;
      if (canUseSourceUrl) {
        out = await fetchJson(`${API_BASE}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_url: abs }),
        });
      } else {
        const res = await fetch(abs, { cache: "no-cache" });
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        out = await fetchJson(`${API_BASE}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_url: dataUrl }),
        });
      }

      if (!out?.ok) throw new Error(out?.error || "Save failed.");
      toast(`Saved: ${out?.filename ?? "item"}`, "success");
      return out;
    }

    function isVideoUrl(url) {
      const u = String(url || "").toLowerCase();
      return u.includes(".mp4") || u.includes(".webm") || u.includes(".mov") || u.includes(".mkv");
    }

    function extractPreviewUrlFromNode(node) {
      try {
        // Common ComfyUI/LiteGraph patterns:
        // - node.imgs: array of Image() objects with .src
        // - node.image: Image()
        // - node._last_preview_url (sometimes)
        const candidates = [];

        // Helper: build ComfyUI /view URL from output metadata
        const buildViewUrl = (filename, subfolder = "", type = "output") => {
          if (!filename) return "";
          const p = new URLSearchParams();
          p.set("filename", String(filename));
          if (subfolder) p.set("subfolder", String(subfolder));
          if (type) p.set("type", String(type));
          return `/view?${p.toString()}`;
        };

        // Helper: pull media URLs from ComfyUI's last executed outputs (works for videos too)
        const tryFromNodeOutputs = () => {
          const id = node?.id;
          if (id === null || id === undefined) return;

          const store = app?.nodeOutputs;
          if (!store) return;

          const outputs = (typeof store.get === "function" ? store.get(id) : store[id]) || null;
          if (!outputs) return;

          // Walk a few levels deep; output objects often contain {filename, subfolder, type} or {url}
          const stack = [{ v: outputs, depth: 0 }];
          const seen = new Set();

          while (stack.length) {
            const { v, depth } = stack.pop();
            if (v === null || v === undefined) continue;
            if (seen.has(v)) continue;
            if (typeof v === "object") seen.add(v);

            if (typeof v === "string") {
              if (v.includes("/view?") || v.startsWith("data:") || v.startsWith("blob:") || v.startsWith("http") || v.startsWith("/")) {
                candidates.push(v);
              }
              continue;
            }

            if (typeof v !== "object") continue;

            // Direct url
            if (typeof v.url === "string" && v.url) {
              candidates.push(v.url);
              continue;
            }

            // Direct output metadata
            const filename = v.filename || v.name || v.file || "";
            if (filename) {
              const subfolder = v.subfolder || v.subfolder_name || "";
              const type = v.type || v.output_type || "output";
              const built = buildViewUrl(filename, subfolder, type);
              if (built) candidates.push(built);
              continue;
            }

            if (depth >= 3) continue;

            if (Array.isArray(v)) {
              for (const it of v) stack.push({ v: it, depth: depth + 1 });
            } else {
              for (const it of Object.values(v)) stack.push({ v: it, depth: depth + 1 });
            }
          }
        };

        if (node?.imgs?.length) {
          for (const im of node.imgs) {
            if (im?.src) candidates.push(im.src);
          }
        }
        if (node?.image?.src) candidates.push(node.image.src);
        if (node?._last_preview_url) candidates.push(node._last_preview_url);

        // If the node itself doesn't expose a DOM preview (common for video), fall back to nodeOutputs
        tryFromNodeOutputs();

        // Some nodes store a widget with image-like value
        if (node?.widgets?.length) {
          for (const w of node.widgets) {
            const v = w?.value;
            if (typeof v === "string" && (v.includes("/view?") || v.startsWith("data:") || v.startsWith("http"))) {
              candidates.push(v);
            }
          }
        }

        // Return first usable
        return candidates.find((x) => typeof x === "string" && x.length > 0) || "";
      } catch {
        return "";
      }
    }


    // Download a gallery item with a real Save dialog when supported.
    // - Uses the backend /download endpoint (Content-Disposition: attachment)
    // - Prefer File System Access API (Chromium) for true "Save As" prompt
    // - Falls back to a normal browser download
    async function downloadGalleryItemWithPrompt(id, suggestedName) {
      if (!id) throw new Error("No item selected.");

      const url = `${API_BASE}/download?id=${encodeURIComponent(String(id))}`;
      const doFetch = api?.fetchApi ? api.fetchApi.bind(api) : fetch;

      const res = await doFetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);

      const blob = await res.blob();

      // True Save As dialog (supported in Chromium-based browsers)
      if (typeof window.showSaveFilePicker === "function") {
        const safeName = String(suggestedName || "download").replace(/[\/:*?"<>|]+/g, "_");
        const ext = safeName.includes(".") ? "." + safeName.split(".").pop() : "";

        const types = [];
        if (blob.type) {
          types.push({ description: "File", accept: { [blob.type]: [ext || ".bin"] } });
        }

        const handle = await window.showSaveFilePicker({
          suggestedName: safeName,
          types: types.length ? types : undefined,
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      }

      // Fallback: normal download (may go to default Downloads depending on browser settings)
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = String(suggestedName || "download");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
    }
// === Block 2 Finish === UI Helpers + Storage === //

// === Block 3 Start === Context Menu Injection === //

    function installNodeContextMenuOption() {
      const LGraphCanvas = globalThis.LGraphCanvas;
      if (!LGraphCanvas?.prototype) return;

      if (LGraphCanvas.prototype.__sample_pack_gallery_menu_patched) return;
      LGraphCanvas.prototype.__sample_pack_gallery_menu_patched = true;

      const orig = LGraphCanvas.prototype.getNodeMenuOptions;

      LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
        let options = [];
        try {
          options = orig ? orig.call(this, node) : [];
        } catch {
          options = [];
        }

        const alreadyHas = options?.some((o) => {
          const c = o?.content;
          return typeof c === "string" && c.toLowerCase().includes("save to gallery");
        });
        if (alreadyHas) return options;

        const url = extractPreviewUrlFromNode(node);
        if (!url) return options;

        const saveOption = {
          content: `<i class="pi pi-download" style="margin-right:8px;"></i>Save To Gallery…`,
          callback: async () => {
            try {
              await saveUrlToGallery(url);
            } catch (e) {
              console.error(e);
              toast(e?.message || "Save To Gallery failed.", "error");
            }
          },
        };

        const replaceIdx = options.findIndex((o) => {
          const c = o?.content;
          return typeof c === "string" && c.toLowerCase().includes("replace node");
        });

        if (replaceIdx >= 0) {
          options.splice(replaceIdx + 1, 0, saveOption);
          return options;
        }

        const firstReal = options.findIndex((x) => x && typeof x === "object");
        if (firstReal === -1) options.push(saveOption);
        else options.splice(firstReal, 0, saveOption);

        return options;
      };
    }

    function isInsideAssetsLikeContainer(target) {
      let n = target;
      for (let i = 0; i < 12 && n; i++) {
        const id = (n.id || "").toLowerCase();
        const cls = (n.className || "").toString().toLowerCase();
        if (id.includes("asset") || cls.includes("asset") || id.includes("assets") || cls.includes("assets")) return true;
        n = n.parentElement;
      }
      return false;
    }

    function getMediaUrlFromElement(t) {
      if (!t) return "";

      const el = t.closest ? (t.closest("img,video") || t) : t;
      const tag = (el.tagName || "").toLowerCase();

      if (tag === "img") {
        return String(el.currentSrc || el.src || "");
      }

      if (tag === "video") {
        const src = el.currentSrc || el.src || el.querySelector?.("source")?.src || "";
        return String(src);
      }

      // If click landed on a child overlay, still try to find nearby video/img
      const near = t.closest?.("div")?.querySelector?.("video, img");
      if (near) {
        const nt = (near.tagName || "").toLowerCase();
        if (nt === "img") return String(near.currentSrc || near.src || "");
        if (nt === "video") return String(near.currentSrc || near.src || near.querySelector?.("source")?.src || "");
      }

      return "";
    }

    function installContextMenuAugmenter() {
      const LiteGraph = globalThis.LiteGraph;
      if (!LiteGraph?.ContextMenu) return;

      if (LiteGraph.ContextMenu.__sample_pack_gallery_patched) return;
      LiteGraph.ContextMenu.__sample_pack_gallery_patched = true;

      const Orig = LiteGraph.ContextMenu;

      function PatchedContextMenu(values, options) {
        try {
          const ev = options?.event;
          const t = ev?.target;

          if (Array.isArray(values) && t && isInsideAssetsLikeContainer(t)) {
            const src = getMediaUrlFromElement(t);
            if (src) {
              const already = values.some((v) => String(v?.content || "").toLowerCase().includes("save to gallery"));
              if (!already) {
                values.unshift({
                  content: `<i class="pi pi-download" style="margin-right:8px;"></i>Save To Gallery…`,
                  callback: async () => {
                    try {
                      await saveUrlToGallery(src);
                    } catch (e) {
                      console.error(e);
                      toast(e?.message || "Save To Gallery failed.", "error");
                    }
                  },
                });
              }
            }
          }
        } catch (_) {}

        return new Orig(values, options);
      }

      PatchedContextMenu.prototype = Orig.prototype;
      for (const k of Object.keys(Orig)) {
        try {
          PatchedContextMenu[k] = Orig[k];
        } catch (_) {}
      }
      LiteGraph.ContextMenu = PatchedContextMenu;
    }
// === Block 3 Finish === Context Menu Injection === //

// === Block 4 Start === Panel UI === //

    function readPreviewSize() {
      // Versioned default so we can safely adjust defaults without breaking older saves.
      try {
        const ver = localStorage.getItem(LS_KEY_PREVIEW_VER);
        if (ver !== LS_PREVIEW_VER) {
          localStorage.setItem(LS_KEY_PREVIEW_VER, LS_PREVIEW_VER);
          localStorage.setItem(LS_KEY_PREVIEW, "256");
          return 256;
        }

        const raw = localStorage.getItem(LS_KEY_PREVIEW);
        const v = clampInt(raw || "256", 128, 2048);
        // step to 16
        return Math.round(v / 16) * 16;
      } catch (_) {
        return 256;
      }
    }

    function writePreviewSize(v) {
      try {
        localStorage.setItem(LS_KEY_PREVIEW_VER, LS_PREVIEW_VER);
        localStorage.setItem(LS_KEY_PREVIEW, String(v));
      } catch (_) {}
    }

    function buildDropdownMenu(state, onChange) {
      // Custom dropdown panel so we can have multiple independent selections (media + sort + year + month)
      const menu = el("div", {
        style: {
          display: "none",
          position: "absolute",
          top: "calc(100% + 6px)",
          right: "0px",
          zIndex: "9999",
          minWidth: "260px",
          padding: "10px",
          borderRadius: "12px",
          border: "1px solid var(--border-color, #444)",
          background: "var(--bg-color, #1f1f1f)",
          boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
          // Helps native form controls (like <select>) render in dark mode where supported
          colorScheme: "dark",
        },
      });

      const sectionTitle = (txt) =>
        el("div", { style: { fontSize: "12px", opacity: "0.85", margin: "8px 0 6px 0", fontWeight: "650" } }, txt);

      // Shared option styling (attempts to force dark dropdown list)
      const OPT_STYLE = {
        background: "var(--bg-color, #1f1f1f)",
        color: "var(--fg-color, rgba(255,255,255,0.92))",
      };

      function radioRow(name, label, value, checked) {
        const id = `${name}_${value}_${Math.random().toString(16).slice(2)}`;
        const input = el("input", {
          type: "radio",
          id,
          name,
          value,
          checked: checked ? "checked" : null,
          style: { marginRight: "8px" },
          onchange: () => onChange(value),
        });
        const lab = el("label", { for: id, style: { cursor: "pointer" } }, label);
        return el("div", { style: { display: "flex", alignItems: "center", padding: "2px 0" } }, [input, lab]);
      }

      // Media
      menu.appendChild(sectionTitle("Media"));
      menu.appendChild(radioRow("gallery_media", "All", MEDIA_ALL, state.media === MEDIA_ALL));
      menu.appendChild(radioRow("gallery_media", "Images Only", MEDIA_IMAGES, state.media === MEDIA_IMAGES));
      menu.appendChild(radioRow("gallery_media", "Videos Only", MEDIA_VIDEOS, state.media === MEDIA_VIDEOS));

      // Sort
      menu.appendChild(sectionTitle("Sort"));
      menu.appendChild(radioRow("gallery_sort", "Relevant", SORT_RELEVANT, state.sort === SORT_RELEVANT));
      menu.appendChild(radioRow("gallery_sort", "Newest", SORT_NEWEST, state.sort === SORT_NEWEST));
      menu.appendChild(radioRow("gallery_sort", "Oldest", SORT_OLDEST, state.sort === SORT_OLDEST));
      menu.appendChild(radioRow("gallery_sort", "Ascending", SORT_ASC, state.sort === SORT_ASC));
      menu.appendChild(radioRow("gallery_sort", "Descending", SORT_DESC, state.sort === SORT_DESC));

      // Year + Month as selects (populated/updated by refreshYearMonthOptions())
      menu.appendChild(sectionTitle("Year"));
      const yearSel = uiSelect();
      yearSel.style.marginBottom = "6px";
      yearSel.style.colorScheme = "dark"; // helps native dropdown match dark theme
      yearSel.appendChild(el("option", { value: "", style: OPT_STYLE }, "All Years"));
      yearSel.value = state.year || "";
      yearSel.addEventListener("change", () => onChange({ year: yearSel.value, month_num: "" }));
      menu.appendChild(yearSel);

      menu.appendChild(sectionTitle("Month"));
      const monthSel = uiSelect();
      monthSel.style.colorScheme = "dark";
      monthSel.appendChild(el("option", { value: "", style: OPT_STYLE }, "All Months"));
      monthSel.value = "";
      monthSel.addEventListener("change", () => onChange({ month_num: monthSel.value }));
      menu.appendChild(monthSel);

      return { menu, yearSel, monthSel, OPT_STYLE };
    }

    function makeTile(item, tilePx, isSelected, onSelect) {
      const box = el("div", {
        style: {
          borderRadius: "12px",
          border: isSelected ? "2px solid rgba(120, 180, 255, 0.95)" : "1px solid var(--border-color, #444)",
          background: "rgba(255,255,255,0.03)",
          overflow: "hidden",
          cursor: "pointer",
          userSelect: "none",
        },
        onclick: () => onSelect(item),
        ondblclick: async () => {
          // Double-click: reveal in explorer (best for quick locate)
          try {
            await fetchJson(`${API_BASE}/reveal`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: item.id }),
            });
          } catch (_) {}
        },
      });

      const mediaBox = el("div", {
        style: {
          width: "100%",
          height: `${tilePx}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.15)",
        },
      });

      if (item.media === MEDIA_VIDEOS) {
        const vid = el("video", {
          src: item.url,
          muted: "muted",
          playsinline: "playsinline",
          preload: "metadata",
          style: {
            width: "100%",
            height: "100%",
            objectFit: "cover",
          },
          onmouseenter: (e) => {
            try {
              e.currentTarget.currentTime = 0;
              e.currentTarget.play().catch(() => {});
            } catch (_) {}
          },
          onmouseleave: (e) => {
            try {
              e.currentTarget.pause();
            } catch (_) {}
          },
        });
        mediaBox.appendChild(vid);
      } else {
        const img = el("img", {
          src: item.url,
          style: {
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          },
          loading: "lazy",
        });
        mediaBox.appendChild(img);
      }

      const meta = el(
        "div",
        {
          style: {
            padding: "8px",
            fontSize: "12px",
            lineHeight: "1.2",
            opacity: "0.92",
            wordBreak: "break-word",
          },
        },
        [
          el("div", { style: { fontWeight: "650" } }, item.filename || ""),
          el(
            "div",
            { style: { opacity: "0.75", marginTop: "4px", display: "flex", justifyContent: "space-between" } },
            [
              el("span", {}, item.date || ""),
              el("span", {}, item.media === MEDIA_VIDEOS ? "Video" : "Image"),
            ]
          ),
        ]
      );

      box.appendChild(mediaBox);
      box.appendChild(meta);
      return box;
    }

    app.registerExtension({
      name: EXT_NAME,

      async setup() {
        // Context menu additions
        installNodeContextMenuOption();
        installDomRightClickSave();

        // Sidebar panel
        const mgr = app?.extensionManager;
        if (!mgr || typeof mgr.registerSidebarTab !== "function") {
          console.warn("[Sample Pack] Gallery: sidebar tab API unavailable (extensionManager.registerSidebarTab)");
          return;
        }

        mgr.registerSidebarTab({
          id: TAB_ID,
          icon: "pi pi-images",
          title: "Gallery",
          tooltip: "Gallery",
          type: "custom",
          render: (root) => {
            root.innerHTML = "";
            root.style.padding = "10px";
            root.style.display = "flex";
            root.style.flexDirection = "column";
            root.style.gap = "10px";
            root.style.height = "100%";
            root.style.boxSizing = "border-box";

            // State
            const state = {
              media: MEDIA_ALL,
              sort: SORT_NEWEST,
              year: "",
              month: "",
              search: "",
              items: [],
              availableYears: [],
              availableMonths: [],
              selectedId: "",
              previewSize: readPreviewSize(),
            };

            // Header
            const header = el("div", { style: { fontSize: "14px", fontWeight: "650" } }, "Gallery");
            root.appendChild(header);

            // Line 1: Save As | Delete | Dropdown Menu
            const btnSaveAs = uiButton(
              "Save As",
              async () => {
                if (!state.selectedId) return;
                try {
                  const it = (state.items || []).find((x) => x?.id === state.selectedId) || null;
                  const name = it?.filename || it?.name || "download";
                  await downloadGalleryItemWithPrompt(state.selectedId, name);
                } catch (e) {
                  console.error(e);
                  toast(e?.message || "Save As failed.", "error");
                }
              },
              { disabled: true, title: "Download the selected item (Save As)" }
            );

            const btnDelete = uiButton(
              "Delete",
              async () => {
                if (!state.selectedId) return;
                const ok = confirm("Delete selected item from Gallery?\n\nThis cannot be undone.");
                if (!ok) return;

                try {
                  await fetchJson(`${API_BASE}/delete`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: state.selectedId }),
                  });
                  toast("Deleted.", "success");
                  state.selectedId = "";
                  await loadList(true);
                  updateButtonStates();
                } catch (e) {
                  console.error(e);
                  toast(e?.message || "Delete failed.", "error");
                }
              },
              { danger: true, disabled: true, title: "Delete selected item" }
            );

            // Dropdown button + menu (custom)
            const dropdownWrap = el("div", { style: { position: "relative", width: "100%" } });
            const dropdownBtn = uiButton("Options ▾", () => toggleMenu(), { title: "Media / Sort / Year / Month" });
            dropdownBtn.style.width = "100%";

            // NOTE: OPT_STYLE comes from buildDropdownMenu return now (style only; behavior unchanged)
            const { menu: dropdownMenu, yearSel, monthSel, OPT_STYLE } = buildDropdownMenu(
              state,
              async (value) => {
                // value can be string (radio) or object (year/month changes)
                if (typeof value === "string") {
                  if (value === MEDIA_ALL || value === MEDIA_IMAGES || value === MEDIA_VIDEOS) {
                    state.media = value;
                    // reset filters on media change (keeps UX predictable)
                    state.year = "";
                    state.month = "";
                    refreshYearMonthOptions();
                  } else {
                    state.sort = value;
                  }
                } else if (value && typeof value === "object") {
                  if (Object.prototype.hasOwnProperty.call(value, "year")) {
                    state.year = value.year || "";
                    state.month = "";
                  }

                  if (Object.prototype.hasOwnProperty.call(value, "month_num")) {
                    const mm = String(value.month_num || "");
                    if (!mm) {
                      state.month = "";
                    } else {
                      // Month selection expects a year; if none selected, pick newest available (or current year as fallback)
                      const newest = Array.isArray(state.availableYears) && state.availableYears.length ? String(state.availableYears[0]) : String(new Date().getFullYear());
                      const yy = String(state.year || newest);
                      state.year = yy;
                      state.month = `${yy}-${mm}`;
                    }
                  }
                }

                refreshYearMonthOptions();
                hideMenu();
                state.selectedId = ""; // selection can become invalid after filter changes
                updateButtonStates();
                await loadList(true);
              }
            );

            function refreshYearMonthOptions() {
              try {
                // Years from API
                const years = Array.isArray(state.availableYears) ? state.availableYears : [];

                // Months from API are in YYYY-MM form; we convert to MONTH NUMBERS and ONLY show those that exist.
                const monthKeys = Array.isArray(state.availableMonths) ? state.availableMonths : [];
                const selectedYear = String(state.year || "");
                const selectedMM =
                  state.month && typeof state.month === "string" && state.month.length >= 7 ? state.month.slice(5, 7) : "";

                // Rebuild year select
                yearSel.innerHTML = "";
                yearSel.appendChild(el("option", { value: "", style: OPT_STYLE }, "All Years"));
                for (const y of years) yearSel.appendChild(el("option", { value: y, style: OPT_STYLE }, y));
                yearSel.value = state.year || "";

                // Gather available months (MM) either:
                // - for the selected year, or
                // - across all years if no year selected
                const mmSet = new Set();
                for (const k of monthKeys) {
                  if (typeof k !== "string" || k.length < 7) continue;
                  const yy = k.slice(0, 4);
                  const mm = k.slice(5, 7);
                  if (selectedYear) {
                    if (yy === selectedYear) mmSet.add(mm);
                  } else {
                    mmSet.add(mm);
                  }
                }

                const monthsSorted = Array.from(mmSet)
                  .filter(Boolean)
                  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

                // Rebuild month select to behave like Year (ONLY available months)
                monthSel.innerHTML = "";
                monthSel.appendChild(el("option", { value: "", style: OPT_STYLE }, "All Months"));

                for (const mm of monthsSorted) {
                  const mNum = Number.parseInt(mm, 10);
                  if (!Number.isFinite(mNum)) continue;
                  monthSel.appendChild(el("option", { value: mm, style: OPT_STYLE }, String(mNum)));
                }

                monthSel.value = selectedMM || "";
              } catch (e) {
                console.error(e);
              }
            }

            function toggleMenu() {
              const isOpen = dropdownMenu.style.display !== "none";
              if (isOpen) hideMenu();
              else showMenu();
            }
            function showMenu() {
              dropdownMenu.style.display = "block";
            }
            function hideMenu() {
              dropdownMenu.style.display = "none";
            }

            // Close menu on outside click
            document.addEventListener(
              "mousedown",
              (e) => {
                if (!dropdownWrap.contains(e.target)) hideMenu();
              },
              { capture: true }
            );

            dropdownWrap.appendChild(dropdownBtn);
            dropdownWrap.appendChild(dropdownMenu);
            refreshYearMonthOptions();

            root.appendChild(buttonRow([btnSaveAs, btnDelete, dropdownWrap]));

            // Line 2: Show Directory | Refresh
            const btnShowDir = uiButton(
              "Show Directory",
              async () => {
                try {
                  await fetchJson(`${API_BASE}/open_directory`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mode: state.media }),
                  });
                } catch (e) {
                  console.error(e);
                  toast(e?.message || "Open directory failed (Explorer may be unsupported on this OS).", "error");
                }
              },
              { title: "Open Gallery folder (or Images/Videos folder depending on Media filter)" }
            );

            const btnRefresh = uiButton(
              "Refresh",
              async () => {
                await loadList(true, true);
              },
              { title: "Re-scan Gallery folders" }
            );

            root.appendChild(buttonRow([btnShowDir, btnRefresh]));

            // Line 3: Search
            const searchField = uiInput("Search Gallery… (date, 9-digit ID, filename)");
            root.appendChild(searchField);

            // Ensure the LiteGraph canvas doesn't hijack keystrokes (can happen on first load)
            // Prompt Panel does something similar so inputs work immediately.
            searchField.disabled = false;
            searchField.readOnly = false;
            for (const ev of [
              "keydown",
              "keyup",
              "keypress",
              "pointerdown",
              "mousedown",
              "mouseup",
              "click",
              "contextmenu",
            ]) {
              searchField.addEventListener(ev, (e) => e.stopPropagation(), { capture: true });
            }

            // Line 4: Grid
            const grid = el("div", {
              style: {
                flex: "1",
                overflow: "auto",
                paddingRight: "4px",
                display: "grid",
                gap: "10px",
                gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(128, Math.min(320, state.previewSize / 2))}px, 1fr))`,
                alignContent: "start",
              },
            });
            root.appendChild(grid);

            // Line 5: Settings
            const lblSettings = el("div", { style: { fontSize: "12px", opacity: "0.85" } }, "Panel Settings");
            const sliderRow = el("div", {
              style: {
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "10px",
                alignItems: "center",
              },
            });

            const sizeLabel = el("div", { style: { fontSize: "12px", opacity: "0.9" } }, "Preview Size");
            const sizeValue = el("div", { style: { fontSize: "12px", opacity: "0.8" } }, `${state.previewSize}px`);

            const sizeSlider = el("input", {
              type: "range",
              min: "128",
              max: "2048",
              step: "16",
              value: String(state.previewSize),
              style: { width: "100%" },
              oninput: () => {
                const v = clampInt(sizeSlider.value, 128, 2048);
                state.previewSize = v;
                sizeValue.textContent = `${v}px`;
                writePreviewSize(v);
                renderGrid();
              },
            });

            const sliderBox = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, [
              sizeLabel,
              sizeSlider,
            ]);

            sliderRow.appendChild(sliderBox);
            sliderRow.appendChild(sizeValue);

            root.appendChild(lblSettings);
            root.appendChild(sliderRow);

            // ---- Core UI logic ----
            function updateButtonStates() {
              const hasSel = !!state.selectedId;
              btnSaveAs.__setDisabled(!hasSel);
              btnDelete.__setDisabled(!hasSel);
            }

            function setDropdownButtonText() {
              const mediaTxt =
                state.media === MEDIA_IMAGES ? "Images" : state.media === MEDIA_VIDEOS ? "Videos" : "All";
              const sortTxt =
                state.sort === SORT_RELEVANT
                  ? "Relevant"
                  : state.sort === SORT_OLDEST
                  ? "Oldest"
                  : state.sort === SORT_ASC
                  ? "Ascending"
                  : state.sort === SORT_DESC
                  ? "Descending"
                  : "Newest";
              let dateTxt = "All Dates";
              if (state.month && typeof state.month === "string" && state.month.length >= 7) {
                const yy = state.month.slice(0, 4);
                const mm = state.month.slice(5, 7);
                const mNum = String(parseInt(mm, 10) || "");
                dateTxt = mNum ? `${yy} • ${mNum}` : yy;
              } else if (state.year) {
                dateTxt = state.year;
              }
              dropdownBtn.textContent = `${mediaTxt} • ${sortTxt} • ${dateTxt} ▾`;
            }

            function renderGrid() {
              grid.innerHTML = "";

              // Tile size: keep it responsive; use previewSize as "max desired",
              // but constrain minmax so grid fits in narrow panels.
              const minCol = Math.max(128, Math.min(320, Math.floor(state.previewSize / 2)));
              grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${minCol}px, 1fr))`;

              if (!state.items.length) {
                grid.appendChild(
                  el(
                    "div",
                    { style: { opacity: "0.75", fontSize: "12px", padding: "10px" } },
                    "No items found."
                  )
                );
                return;
              }

              for (const it of state.items) {
                const tile = makeTile(it, Math.max(128, Math.min(512, Math.floor(state.previewSize / 2))), it.id === state.selectedId, (item) => {
                  state.selectedId = item.id;
                  updateButtonStates();
                  // re-render to update highlights
                  renderGrid();
                });
                grid.appendChild(tile);
              }
            }

            async function loadList(keepFilters = true, showToast = false) {
              try {
                setDropdownButtonText();

                const params = new URLSearchParams();
                params.set("media", state.media);
                params.set("sort", state.sort);
                if (state.year) params.set("year", state.year);
                if (state.month) params.set("month", state.month);
                if (state.search) params.set("search", state.search);

                const data = await fetchJson(`${API_BASE}/list?${params.toString()}`, { method: "GET" });

                if (!data?.ok) throw new Error(data?.error || "List failed.");

                state.items = Array.isArray(data?.items) ? data.items : [];
                state.availableYears = Array.isArray(data?.available_years) ? data.available_years : [];
                state.availableMonths = Array.isArray(data?.available_months) ? data.available_months : [];
                refreshYearMonthOptions();

                // Clear selection if it no longer exists
                if (state.selectedId && !state.items.some((x) => x.id === state.selectedId)) {
                  state.selectedId = "";
                }

                updateButtonStates();
                renderGrid();

                if (showToast) toast(`Loaded ${state.items.length} item(s).`, "info");
              } catch (e) {
                console.error(e);
                toast(e?.message || "Failed to load Gallery list. Check server console.", "error");
              }
            }

            // Search events (debounced)
            const onSearchChanged = debounce(async () => {
              state.search = String(searchField.value || "").trim();
              state.selectedId = "";
              updateButtonStates();
              await loadList(true, false);
            }, 250);

            searchField.addEventListener("input", onSearchChanged);

            // Initial
            loadList(true, false);
            updateButtonStates();
          },
        });
      },
    });
// === Block 4 Finish === Panel UI === //

// === Block 5 Start === Grid Tile Rendering === //

  } catch (err) {
    console.error("[Sample Pack] Panel_Gallery failed to load:", err);
  }
})();
// === Block 5 Finish === Grid Tile Rendering === //
