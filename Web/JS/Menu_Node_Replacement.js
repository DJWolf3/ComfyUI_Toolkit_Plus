// web/js/Menu_Node_Replacement.js
import { app } from "../../scripts/app.js";
import {
  TKP_CMD_REPLACE_NODE,
  runReplaceNodeFlow,
  getSingleSelectedNode,
} from "./Shared/Node_Replacement_Core.js"; // ✅ MUST be lowercase shared

(function () {
  try {
    // Prevent double-registration if loaded twice
    if (globalThis.__TKP_MENU_NODE_REPLACEMENT_LOADED__) return;
    globalThis.__TKP_MENU_NODE_REPLACEMENT_LOADED__ = true;

    app.registerExtension({
      name: "comfyui_toolkit_plus.menu_node_replacement",

      commands: [
        {
          id: TKP_CMD_REPLACE_NODE,
          label: "Replace Node…",
          icon: "pi pi-refresh",
          function: async (args) => {
            const node = args?.node ?? getSingleSelectedNode();
            if (!node) return;
            await runReplaceNodeFlow(node);
          },
        },
      ],

      setup() {
        installNodeContextMenuOption();
        installSelectionToolboxButton();
      },
    });

    function installNodeContextMenuOption() {
      const LGraphCanvas = globalThis.LGraphCanvas;
      if (!LGraphCanvas?.prototype) return;

      if (LGraphCanvas.prototype.__tkp_replace_node_menu_patched) return;
      LGraphCanvas.prototype.__tkp_replace_node_menu_patched = true;

      const orig = LGraphCanvas.prototype.getNodeMenuOptions;

      LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
        let options = [];
        try {
          options = orig ? orig.call(this, node) : [];
        } catch {
          options = [];
        }

        // Don’t inject twice
        const alreadyHasReplace = options?.some((o) => {
          const c = o?.content;
          return typeof c === "string" && c.toLowerCase().includes("replace node");
        });
        if (alreadyHasReplace) return options;

        const replaceOption = {
          content: `<i class="pi pi-refresh" style="margin-right:8px;"></i>Replace Node…`,
          callback: async () => {
            await runReplaceNodeFlow(node);
          },
        };

        const firstReal = options.findIndex((x) => x && typeof x === "object");
        if (firstReal === -1) options.push(replaceOption);
        else options.splice(firstReal, 0, replaceOption, null);

        return options;
      };
    }

    function installSelectionToolboxButton() {
      const BTN_ID = "tkp_replace_node_btn";

      function findToolboxHosts() {
        return [
          document.querySelector(".selection-toolbox"),
          document.querySelector(".comfy-selection-toolbox"),
          document.querySelector("[data-role='selection-toolbox']"),
          document.querySelector("comfy-selection-toolbox"),
        ].filter(Boolean);
      }

      function getSearchRoots(host) {
        const roots = [];
        if (host.shadowRoot) roots.push(host.shadowRoot);
        roots.push(host);
        return roots;
      }

      function tryAttach() {
        const hosts = findToolboxHosts();
        if (!hosts.length) return false;

        for (const host of hosts) {
          for (const root of getSearchRoots(host)) {
            if (!root?.querySelector) continue;
            if (root.querySelector(`#${BTN_ID}`)) continue;

            const trash =
              root.querySelector("button[title*='Delete' i]") ||
              root.querySelector("button[aria-label*='Delete' i]") ||
              root.querySelector("button[title*='Remove' i]") ||
              root.querySelector("button[aria-label*='Remove' i]") ||
              root.querySelector("button[title*='Trash' i]") ||
              root.querySelector("button[aria-label*='Trash' i]");

            if (!trash) continue;

            const btn = document.createElement("button");
            btn.id = BTN_ID;
            btn.className = trash.className;
            btn.title = "Replace selected node";
            btn.setAttribute("aria-label", "Replace selected node");
            btn.innerHTML = `<i class="pi pi-refresh"></i>`;

            btn.addEventListener("click", async () => {
              const node = getSingleSelectedNode();
              if (!node) return;
              await runReplaceNodeFlow(node);
            });

            trash.parentElement?.insertBefore(btn, trash.nextSibling);
            return true;
          }
        }
        return false;
      }

      if (tryAttach()) return;

      const obs = new MutationObserver(() => tryAttach());
      obs.observe(document.body, { childList: true, subtree: true });
    }
  } catch (err) {
    console.error("[Toolkit+] Menu_Node_Replacement failed to load:", err);
  }
})();
