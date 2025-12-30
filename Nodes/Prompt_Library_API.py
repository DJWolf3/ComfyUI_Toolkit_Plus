# ComfyUI_Sample_Pack/Nodes/Prompt_Library_API.py
# Prompt Library backend API (server-side)
#
# NEW Naming Convention (base name is EXACT user input):
#   Config/<BaseName>_Manifest.json
#   Config/Positive Prompts/<BaseName>_Positive.txt
#   Config/Negative Prompts/<BaseName>_Negative.txt
#
# Endpoints:
#   GET  /sample_pack/prompt_library/list
#   GET  /sample_pack/prompt_library/item?id=<base_name>
#   POST /sample_pack/prompt_library/new            { name }
#   POST /sample_pack/prompt_library/rename         { old_name, new_name }
#   POST /sample_pack/prompt_library/delete         { name }
#   POST /sample_pack/prompt_library/save           { name, positive_text, negative_text }
#   POST /sample_pack/prompt_library/sync_manifests { overwrite?: false }
#
# IMPORTANT:
# - Save/Load/Clear in the panel MUST NOT touch workflows (this backend never touches workflows anyway).
# - Base name is not auto-modified. We validate for safety; we do NOT "sanitize into something else".

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from aiohttp import web
from server import PromptServer

# ====== Block # 1 - Paths & Constants ====== #
ROUTE_BASE = "/sample_pack/prompt_library"

PACK_ROOT = os.path.dirname(os.path.dirname(__file__))
CONFIG_DIR = os.path.join(PACK_ROOT, "Config")

POS_DIR_NAME = "Positive Prompts"
NEG_DIR_NAME = "Negative Prompts"

POS_DIR = os.path.join(CONFIG_DIR, POS_DIR_NAME)
NEG_DIR = os.path.join(CONFIG_DIR, NEG_DIR_NAME)

MANIFEST_SUFFIX = "_Manifest.json"
POS_SUFFIX = "_Positive.txt"
NEG_SUFFIX = "_Negative.txt"
# ====== Block # 1 - End ====== #


# ====== Block # 2 - Helpers ====== #
def _ensure_dirs() -> None:
    os.makedirs(CONFIG_DIR, exist_ok=True)
    os.makedirs(POS_DIR, exist_ok=True)
    os.makedirs(NEG_DIR, exist_ok=True)

def _read_text_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""
    except Exception:
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                return f.read()
        except Exception:
            return ""

def _write_text_file(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text if text is not None else "")

def _load_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def _save_json(path: str, data: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def _safe_config_path(rel_under_config: str) -> str:
    rel_under_config = rel_under_config.replace("\\", "/").lstrip("/")
    abs_path = os.path.abspath(os.path.join(CONFIG_DIR, rel_under_config))
    if os.path.commonpath([os.path.abspath(CONFIG_DIR), abs_path]) != os.path.abspath(CONFIG_DIR):
        raise ValueError("Invalid path traversal.")
    return abs_path

def _validate_base_name(name: str) -> str:
    """
    Base name must be EXACT user input (no auto-rewrite), but we must validate for safety.
    Allowed characters: letters, numbers, spaces, underscores, hyphens.
    Disallowed: path separators, dots-only names, empty names, weird symbols.
    """
    if name is None:
        raise ValueError("Missing name")

    base = str(name)
    if base.strip() == "":
        raise ValueError("Name is empty")

    # Reject path separators explicitly
    if "/" in base or "\\" in base:
        raise ValueError("Name must not contain / or \\")

    # Reject leading/trailing whitespace-only trickery
    if base != base.strip():
        # Keep the input exact: but whitespace at ends is almost always accidental and breaks file matching.
        # So we reject it rather than trimming.
        raise ValueError("Name must not start or end with spaces")

    # Allow: A-Z a-z 0-9 _ - space
    if not re.fullmatch(r"[A-Za-z0-9_\- ]+", base):
        raise ValueError("Name contains invalid characters. Use letters/numbers/space/_/- only.")

    # Reject names that are only spaces
    if base.replace(" ", "") == "":
        raise ValueError("Name cannot be only spaces")

    return base

def _manifest_path_for_base(base_name: str) -> str:
    return os.path.join(CONFIG_DIR, f"{base_name}{MANIFEST_SUFFIX}")

def _pos_path_for_base(base_name: str) -> str:
    return os.path.join(POS_DIR, f"{base_name}{POS_SUFFIX}")

def _neg_path_for_base(base_name: str) -> str:
    return os.path.join(NEG_DIR, f"{base_name}{NEG_SUFFIX}")

def _rel_pos_for_base(base_name: str) -> str:
    return f"{POS_DIR_NAME}/{base_name}{POS_SUFFIX}"

def _rel_neg_for_base(base_name: str) -> str:
    return f"{NEG_DIR_NAME}/{base_name}{NEG_SUFFIX}"

def _build_manifest_for_base(base_name: str) -> Dict[str, Any]:
    return {
        "name": base_name,                    # your exact base name
        "id": base_name,                      # keep compatibility with existing UI patterns
        "title": base_name,                   # no prettify; exact base
        "category": "",
        "tags": [],
        "notes": "",
        "positive_path": _rel_pos_for_base(base_name),
        "negative_path": _rel_neg_for_base(base_name),
    }

def _resolve_manifest_paths(manifest: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    pos_rel = manifest.get("positive_path") or manifest.get("positive")
    neg_rel = manifest.get("negative_path") or manifest.get("negative")
    pos_abs = _safe_config_path(pos_rel) if isinstance(pos_rel, str) and pos_rel else None
    neg_abs = _safe_config_path(neg_rel) if isinstance(neg_rel, str) and neg_rel else None
    return pos_rel, neg_rel, pos_abs, neg_abs

def _list_json_files() -> List[str]:
    if not os.path.isdir(CONFIG_DIR):
        return []
    out = [n for n in os.listdir(CONFIG_DIR) if n.lower().endswith(".json")]
    out.sort(key=lambda x: x.lower())
    return out

def _base_from_manifest_filename(filename: str) -> Optional[str]:
    # New convention: <Base>_Manifest.json
    if filename.endswith(MANIFEST_SUFFIX):
        return filename[: -len(MANIFEST_SUFFIX)]
    return None
# ====== Block # 2 - End ====== #


# ====== Block # 3 - Core operations (new/rename/delete/save/load) ====== #
def create_new_prompt(base_name: str) -> Dict[str, Any]:
    _ensure_dirs()
    base = _validate_base_name(base_name)

    mp = _manifest_path_for_base(base)
    pp = _pos_path_for_base(base)
    np = _neg_path_for_base(base)

    if os.path.exists(mp) or os.path.exists(pp) or os.path.exists(np):
        raise ValueError("A prompt with this name already exists (one or more files already present).")

    # Create txt files empty
    _write_text_file(pp, "")
    _write_text_file(np, "")

    # Create manifest linking them
    manifest = _build_manifest_for_base(base)
    _save_json(mp, manifest)

    return {"ok": True, "name": base}

def rename_prompt(old_name: str, new_name: str) -> Dict[str, Any]:
    _ensure_dirs()
    old_base = _validate_base_name(old_name)
    new_base = _validate_base_name(new_name)

    if old_base == new_base:
        raise ValueError("New name is the same as the old name.")

    old_mp = _manifest_path_for_base(old_base)
    old_pp = _pos_path_for_base(old_base)
    old_np = _neg_path_for_base(old_base)

    if not os.path.isfile(old_mp):
        raise ValueError(f"Manifest not found: {old_base}{MANIFEST_SUFFIX}")

    new_mp = _manifest_path_for_base(new_base)
    new_pp = _pos_path_for_base(new_base)
    new_np = _neg_path_for_base(new_base)

    if os.path.exists(new_mp) or os.path.exists(new_pp) or os.path.exists(new_np):
        raise ValueError("Target name already exists (one or more target files already present).")

    # Load manifest and resolve current linked paths (so we rename the actual files it references)
    manifest = _load_json(old_mp)
    if not isinstance(manifest, dict):
        raise ValueError("Invalid manifest JSON.")

    _, _, pos_abs, neg_abs = _resolve_manifest_paths(manifest)

    if pos_abs and os.path.isfile(pos_abs):
        os.rename(pos_abs, new_pp)
    else:
        _write_text_file(new_pp, "")

    if neg_abs and os.path.isfile(neg_abs):
        os.rename(neg_abs, new_np)
    else:
        _write_text_file(new_np, "")

    os.rename(old_mp, new_mp)

    updated = dict(manifest)
    updated["name"] = new_base
    updated["id"] = new_base
    updated["title"] = new_base
    updated["positive_path"] = _rel_pos_for_base(new_base)
    updated["negative_path"] = _rel_neg_for_base(new_base)

    _save_json(new_mp, updated)

    return {"ok": True, "old_name": old_base, "new_name": new_base}

def delete_prompt(base_name: str) -> Dict[str, Any]:
    _ensure_dirs()
    base = _validate_base_name(base_name)

    mp = _manifest_path_for_base(base)
    if not os.path.isfile(mp):
        raise ValueError("Manifest not found for selected prompt.")

    manifest = _load_json(mp)
    if not isinstance(manifest, dict):
        manifest = None

    deleted: List[str] = []

    if isinstance(manifest, dict):
        _, _, pos_abs, neg_abs = _resolve_manifest_paths(manifest)
        for abs_path in (pos_abs, neg_abs):
            if abs_path and os.path.isfile(abs_path):
                try:
                    os.remove(abs_path)
                    deleted.append(os.path.relpath(abs_path, CONFIG_DIR).replace("\\", "/"))
                except Exception:
                    pass
    else:
        for abs_path in (_pos_path_for_base(base), _neg_path_for_base(base)):
            if os.path.isfile(abs_path):
                try:
                    os.remove(abs_path)
                    deleted.append(os.path.relpath(abs_path, CONFIG_DIR).replace("\\", "/"))
                except Exception:
                    pass

    try:
        os.remove(mp)
        deleted.append(os.path.relpath(mp, CONFIG_DIR).replace("\\", "/"))
    except Exception:
        pass

    return {"ok": True, "name": base, "deleted": deleted}

def save_prompt_text(base_name: str, positive_text: str, negative_text: str) -> Dict[str, Any]:
    _ensure_dirs()
    base = _validate_base_name(base_name)

    mp = _manifest_path_for_base(base)
    if not os.path.isfile(mp):
        raise ValueError("Manifest not found. Select a manifest before saving.")

    manifest = _load_json(mp)
    if not isinstance(manifest, dict):
        raise ValueError("Invalid manifest JSON.")

    pos_rel, neg_rel, pos_abs, neg_abs = _resolve_manifest_paths(manifest)

    if not pos_rel:
        manifest["positive_path"] = _rel_pos_for_base(base)
        pos_abs = _pos_path_for_base(base)
    if not neg_rel:
        manifest["negative_path"] = _rel_neg_for_base(base)
        neg_abs = _neg_path_for_base(base)

    if not pos_abs or not neg_abs:
        raise ValueError("Manifest paths could not be resolved safely.")

    _write_text_file(pos_abs, str(positive_text or ""))
    _write_text_file(neg_abs, str(negative_text or ""))

    manifest["name"] = base
    manifest["id"] = base
    manifest["title"] = base

    _save_json(mp, manifest)

    return {"ok": True, "name": base}

def load_prompt_text(base_name: str) -> Dict[str, Any]:
    _ensure_dirs()
    base = _validate_base_name(base_name)

    mp = _manifest_path_for_base(base)

    if not os.path.isfile(mp):
        legacy = os.path.join(CONFIG_DIR, f"{base}.json")
        if os.path.isfile(legacy):
            mp = legacy
        else:
            raise ValueError("Manifest not found.")

    manifest = _load_json(mp)
    if not isinstance(manifest, dict):
        raise ValueError("Invalid manifest JSON.")

    _, _, pos_abs, neg_abs = _resolve_manifest_paths(manifest)

    pos_txt = _read_text_file(pos_abs) if pos_abs else ""
    neg_txt = _read_text_file(neg_abs) if neg_abs else ""

    return {
        "ok": True,
        "name": base,
        "positive_text": pos_txt,
        "negative_text": neg_txt,
        "manifest": manifest,
    }
# ====== Block # 3 - End ====== #


# ====== Block # 4 - Listing (dropdown population) ====== #
def _scan_manifests() -> List[Dict[str, Any]]:
    _ensure_dirs()
    items: List[Dict[str, Any]] = []

    for fname in _list_json_files():
        full = os.path.join(CONFIG_DIR, fname)
        manifest = _load_json(full)
        if not isinstance(manifest, dict):
            continue

        base = _base_from_manifest_filename(fname)
        if base is None:
            base = os.path.splitext(fname)[0]

        display_name = str(manifest.get("name") or base)
        item_id = display_name

        _, _, pos_abs, neg_abs = _resolve_manifest_paths(manifest)
        has_pos = bool(pos_abs and os.path.isfile(pos_abs))
        has_neg = bool(neg_abs and os.path.isfile(neg_abs))

        tags = manifest.get("tags")
        if not isinstance(tags, list):
            tags = []
        tags = [str(t) for t in tags if t is not None]

        category = manifest.get("category")
        category = str(category) if category is not None else ""

        title = str(manifest.get("title") or display_name)

        items.append({
            "id": item_id,
            "title": title,
            "tags": tags,
            "category": category,
            "has_positive": has_pos,
            "has_negative": has_neg,
        })

    items.sort(key=lambda x: (x.get("category", "").lower(), x.get("title", "").lower()))
    return items
# ====== Block # 4 - End ====== #


# ====== Block # 5 - Auto-Manifest Generation from TXT (creates NEW-style manifests) ====== #
_POS_DETECT_SUFFIXES = ["_positive", "_pos", " positive", " pos", "-positive", "-pos"]
_NEG_DETECT_SUFFIXES = ["_negative", "_neg", " negative", " neg", "-negative", "-neg"]

def _strip_suffix_case_insensitive(stem: str, suffixes: List[str]) -> str:
    lower = stem.lower()
    for suf in suffixes:
        if lower.endswith(suf):
            return stem[: len(stem) - len(suf)]
    return stem

def _list_txt(folder: str) -> List[str]:
    if not os.path.isdir(folder):
        return []
    out = [n for n in os.listdir(folder) if n.lower().endswith(".txt") and not n.startswith("_")]
    out.sort(key=lambda x: x.lower())
    return out

def sync_manifests_from_txt(overwrite_existing: bool = False) -> Dict[str, Any]:
    _ensure_dirs()
    pos_files = _list_txt(POS_DIR)
    neg_files = _list_txt(NEG_DIR)

    pos_map: Dict[str, str] = {}
    for f in pos_files:
        stem = os.path.splitext(os.path.basename(f))[0]
        base = _strip_suffix_case_insensitive(stem, _POS_DETECT_SUFFIXES).strip()
        pos_map.setdefault(base, f)

    neg_map: Dict[str, str] = {}
    for f in neg_files:
        stem = os.path.splitext(os.path.basename(f))[0]
        base = _strip_suffix_case_insensitive(stem, _NEG_DETECT_SUFFIXES).strip()
        neg_map.setdefault(base, f)

    keys = sorted(set(pos_map.keys()) | set(neg_map.keys()), key=lambda x: x.lower())

    created = 0
    updated = 0
    skipped = 0
    problems: List[str] = []

    for raw_base in keys:
        if raw_base.strip() == "":
            continue

        try:
            base = _validate_base_name(raw_base)
        except Exception as e:
            problems.append(f"Skipped base '{raw_base}': {e}")
            continue

        mp = _manifest_path_for_base(base)
        exists = os.path.isfile(mp)

        if exists and not overwrite_existing:
            skipped += 1
            continue

        pos_txt = pos_map.get(raw_base)
        neg_txt = neg_map.get(raw_base)

        manifest = _build_manifest_for_base(base)

        if pos_txt:
            manifest["positive_path"] = f"{POS_DIR_NAME}/{pos_txt}"
        if neg_txt:
            manifest["negative_path"] = f"{NEG_DIR_NAME}/{neg_txt}"

        try:
            _save_json(mp, manifest)
            if exists:
                updated += 1
            else:
                created += 1
        except Exception as e:
            problems.append(f"{os.path.basename(mp)}: {e}")

    return {
        "created": created,
        "updated": updated,
        "skipped_existing": skipped,
        "pos_found": len(pos_files),
        "neg_found": len(neg_files),
        "problems": problems,
    }
# ====== Block # 5 - End ====== #


# ====== Block # 6 - Routes ====== #
routes = PromptServer.instance.routes

@routes.get(f"{ROUTE_BASE}/list")
async def prompt_library_list(request: web.Request):
    sync_manifests_from_txt(overwrite_existing=False)
    items = _scan_manifests()
    return web.json_response({"items": items})

@routes.get(f"{ROUTE_BASE}/item")
async def prompt_library_item(request: web.Request):
    base_name = str(request.rel_url.query.get("id", "")).strip()
    if not base_name:
        return web.json_response({"error": "Missing id"}, status=400)
    try:
        data = load_prompt_text(base_name)
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/new")
async def prompt_library_new(request: web.Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            return web.json_response({"error": "Invalid payload"}, status=400)
        name = payload.get("name", "")
        result = create_new_prompt(name)
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/rename")
async def prompt_library_rename(request: web.Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            return web.json_response({"error": "Invalid payload"}, status=400)
        old_name = payload.get("old_name", "")
        new_name = payload.get("new_name", "")
        result = rename_prompt(old_name, new_name)
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/delete")
async def prompt_library_delete(request: web.Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            return web.json_response({"error": "Invalid payload"}, status=400)
        name = payload.get("name", "")
        result = delete_prompt(name)
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/save")
async def prompt_library_save(request: web.Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            return web.json_response({"error": "Invalid payload"}, status=400)
        name = payload.get("name", "")
        pos = payload.get("positive_text", "")
        neg = payload.get("negative_text", "")
        result = save_prompt_text(name, pos, neg)
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/sync_manifests")
async def prompt_library_sync_manifests(request: web.Request):
    overwrite = False
    try:
        body = await request.json()
        if isinstance(body, dict):
            overwrite = bool(body.get("overwrite", False))
    except Exception:
        overwrite = False
    result = sync_manifests_from_txt(overwrite_existing=overwrite)
    return web.json_response(result)
# ====== Block # 6 - End ====== #
