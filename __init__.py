# ComfyUI_Sample_Pack/__init__.py
# Auto-register all ComfyUI nodes in the Nodes/ folder.
# Also expose a WEB_DIRECTORY so ComfyUI auto-loads any .js frontend extensions.

import importlib
import inspect
import os
import pkgutil
import sys

# Base package
PACKAGE_NAME = __name__
BASE_DIR = os.path.dirname(__file__)
NODES_DIR = os.path.join(BASE_DIR, "Nodes")

# ------------------------------------------------------------------------------
# Frontend Extension Loading (ComfyUI)
# ------------------------------------------------------------------------------
# ComfyUI will automatically load ALL .js files located inside WEB_DIRECTORY
# as the web client loads. Point this at your web/js folder.
# Docs: exporting WEB_DIRECTORY is the standard way to ship frontend extensions.
# ------------------------------------------------------------------------------

# Prefer web/js, fall back to web if someone uses a flatter structure.
_web_js_dir = os.path.join(BASE_DIR, "web", "js")
_web_dir = os.path.join(BASE_DIR, "web")

if os.path.isdir(_web_js_dir):
    WEB_DIRECTORY = "./web/js"
elif os.path.isdir(_web_dir):
    WEB_DIRECTORY = "./web"
else:
    # No web folder present (or not packaged). This is fine; nodes still load.
    WEB_DIRECTORY = None

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

def _discover_nodes():
    """Dynamically import every module in the Nodes/ directory and register any node classes."""
    for _, mod_name, is_pkg in pkgutil.iter_modules([NODES_DIR]):
        if is_pkg or mod_name.startswith("_"):
            continue
        full_mod = f"{PACKAGE_NAME}.Nodes.{mod_name}"

        try:
            module = importlib.import_module(full_mod)
        except Exception as e:
            print(f"[ComfyUI_Sample_Pack] ⚠ Failed to import {full_mod}: {e}")
            continue

        # Inspect module members for node-like classes
        for name, obj in inspect.getmembers(module, inspect.isclass):
            # Must be defined in this module (not imported)
            if obj.__module__ != full_mod:
                continue

            # Heuristic: must define core ComfyUI attributes
            if all(hasattr(obj, attr) for attr in ("INPUT_TYPES", "RETURN_TYPES", "FUNCTION")):
                NODE_CLASS_MAPPINGS[name] = obj
                # Optional display name, auto-formatted
                pretty_name = getattr(obj, "CATEGORY", "Samples").replace("/", " • ")
                NODE_DISPLAY_NAME_MAPPINGS[name] = f"{pretty_name} • {name}"

# Discover and register nodes automatically
_discover_nodes()

# Export mappings (and WEB_DIRECTORY when present)
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
