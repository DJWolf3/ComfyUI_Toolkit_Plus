# === Block 0 Start === Code Start === #

import os
import json
import time
import shutil
import hashlib
import requests
import threading
import asyncio  # <--- CRITICAL: Required to prevent UI freeze
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from aiohttp import web
from server import PromptServer
# === Block 0 Finish === Code Start === #

# === Block 1 Start === Constants and Route Base === #

ROUTE_BASE = "/sample_pack/civitai_library"

CIVITAI_API = "https://civitai.com/api/v1"
SEARCH_ENDPOINT = f"{CIVITAI_API}/models"
MODEL_ENDPOINT = f"{CIVITAI_API}/models"
MODEL_VERSION_ENDPOINT = f"{CIVITAI_API}/model-versions"
CHUNK_SIZE = 1024 * 1024

TYPE_TO_SUBFOLDER = {
    "Checkpoint": "checkpoints",
    "LoRA": "loras",
    "LORA": "loras",  # Handle case variations
    "TextualInversion": "embeddings",
    "Controlnet": "controlnet",
    "ControlNet": "controlnet", # Handle case variations
    "VAE": "vae",
    "Upscale": "upscale_models",
    "Upscaler": "upscale_models",
}
# === Block 1 Finish === Constants and Route Base === #

# === Block 2 Start === ComfyUI Root and Data === #

def _find_comfy_root() -> Path:
    """
    Prefer ComfyUI's *actual runtime* base/models location (works with Desktop/Electron + portable installs),
    then fall back to the legacy "walk up from this file" approach.
    """
    # 1) Explicit override if you ever want it
    env_root = os.environ.get("COMFYUI_ROOT", "").strip()
    if env_root:
        p = Path(env_root).expanduser().resolve()
        if (p / "models").exists():
            return p

    # 2) Ask ComfyUI where it thinks base/models are (most reliable)
    try:
        import folder_paths  # ComfyUI core

        # Common: folder_paths.base_path is the ComfyUI root
        base_path = getattr(folder_paths, "base_path", None)
        if base_path:
            p = Path(base_path).resolve()
            if (p / "models").exists():
                return p

        # Derive root from known model folders (e.g. .../models/checkpoints)
        try:
            checkpoints_paths = folder_paths.get_folder_paths("checkpoints") or []
        except Exception:
            checkpoints_paths = []

        for cp in checkpoints_paths:
            cp_path = Path(cp).resolve()

            # If it contains a "models" directory segment, use that
            cur = cp_path
            while cur.parent != cur:
                if cur.name.lower() == "models":
                    root = cur.parent
                    if (root / "models").exists():
                        return root
                    break
                cur = cur.parent

            # If cp_path is ".../models/checkpoints", go up 2 to root
            if cp_path.parent.name.lower() == "models":
                root = cp_path.parent.parent
                if (root / "models").exists():
                    return root
    except Exception:
        pass

    # 3) Fallback: walk up from CWD first (portable launches often set this)
    for start in [Path.cwd().resolve(), Path(__file__).resolve()]:
        p = start
        while p.parent != p:
            if (p / "models").exists():
                return p
            p = p.parent

    raise RuntimeError("Could not locate ComfyUI root")


_COMFY_ROOT = _find_comfy_root()


def comfy_root() -> Path:
    return _COMFY_ROOT


def data_dir() -> Path:
    # Your requested location:
    # .\custom_nodes\ComfyUI_Toolkit_Plus\Data
    d = comfy_root() / "custom_nodes" / "ComfyUI_Toolkit_Plus" / "Data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def token_file_path() -> Path:
    return data_dir() / "token.enc"


def registry_file_path() -> Path:
    return data_dir() / "installed.json"


def filters_cache_path() -> Path:
    return data_dir() / "filters_cache.json"
# === Block 2 Finish === ComfyUI Root and Data === #

# === Block 3 Start === Filename and Target Path === #

def sanitize_filename_part(s: str) -> str:
    return "".join(c for c in s if c.isalnum() or c in (" ", "-", "_")).strip()

def infer_extension_from_filename(name: str) -> str:
    return os.path.splitext(name)[1] or ".safetensors"

def guess_subfolder(model_type: str) -> str:
    return TYPE_TO_SUBFOLDER.get(model_type, "checkpoints")

def build_target_path(model_type: str, filename: str) -> Path:
    sub = guess_subfolder(model_type)
    return comfy_root() / "models" / sub / filename
# === Block 3 Finish === Filename and Target Path === #

# === Block 4 Start === Token Encryption and Storage === #

def _crypto_available() -> bool:
    # Encryption intentionally removed (plaintext token storage)
    return False

def _get_fernet() -> Optional["Fernet"]:
    # Kept for compatibility with older code paths; always unavailable now
    return None

def save_token_encrypted(token: str) -> Tuple[bool, str]:
    """
    Plaintext token storage (encryption removed).
    Keeps the same (ok, err) return signature because routes expect it.
    """
    try:
        token = (token or "").strip()
        if not token:
            return False, "Missing token."
        token_file_path().write_text(token, encoding="utf-8")
        return True, ""
    except Exception as e:
        return False, str(e)

def load_token_decrypted() -> Optional[str]:
    """
    Plaintext token loading (encryption removed).
    """
    p = token_file_path()
    if not p.exists():
        return None
    try:
        token = (p.read_text(encoding="utf-8") or "").strip()
        return token if token else None
    except Exception:
        return None

def clear_saved_token() -> None:
    p = token_file_path()
    if p.exists():
        try:
            p.unlink()
        except Exception:
            pass
# === Block 4 Finish === Token Encryption and Storage === #

# === Block 5 Start === Install Registry === #

def _load_registry() -> Dict:
    if registry_file_path().exists():
        return json.loads(registry_file_path().read_text())
    return {}

def _save_registry(reg: Dict):
    registry_file_path().write_text(json.dumps(reg, indent=2))

def registry_get_path(version_id: str) -> str:
    reg = _load_registry()
    return str(reg.get(str(version_id)) or "")

def registry_is_installed(version_id: str) -> bool:
    return bool(registry_get_path(str(version_id)))

def registry_set_installed(version_id: str, path: str):
    reg = _load_registry()
    reg[str(version_id)] = str(path)
    _save_registry(reg)

def registry_remove(version_id: str):
    reg = _load_registry()
    vid = str(version_id)
    if vid in reg:
        del reg[vid]
        _save_registry(reg)
# === Block 5 Finish === Install Registry === #

# === Block 6 Start === CivitAI API HTTP === #

def _authed_headers() -> Dict:
    token = load_token_decrypted()
    return {"Authorization": f"Bearer {token}"} if token else {}

def _get_json(url: str, params: Dict = None) -> Dict:
    r = requests.get(url, headers=_authed_headers(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()

# ---- Category Fetching (REAL CivitAI Categories) ----

def fetch_civitai_categories() -> List[str]:
    """
    Fetches CivitAI's Category list for the "Filter by Category" dropdown.

    Source: /api/v1/tags
    Strategy:
      - Page through all results (the endpoint is paginated)
      - Keep tags whose `type` == "Category" (case-insensitive)
      - If the API doesn't return any explicit Category-typed tags, fall back to a
        small known-good list so the UI stays usable.
    """
    DEFAULT_CATEGORIES = [
        "Character",
        "Clothing",
        "Concept",
        "Objects",
        "Poses",
        "Style",
    ]

    try:
        cats: List[str] = []
        page = 1
        limit = 200  # high, but still safe
        total_pages = 1

        while page <= total_pages:
            data = _get_json(f"{CIVITAI_API}/tags", params={"limit": limit, "page": page})
            items = data.get("items") or []

            for t in items:
                if not isinstance(t, dict):
                    continue
                ttype = str(t.get("type") or "").strip().lower()
                if ttype != "category":
                    continue

                name = str(t.get("name") or "").strip()
                if name:
                    cats.append(name)

            meta = data.get("metadata") or {}
            try:
                total_pages = int(meta.get("totalPages") or total_pages)
            except Exception:
                total_pages = total_pages

            page += 1

        # Deduplicate + sort
        uniq = sorted({c.strip() for c in cats if c and c.strip()}, key=lambda s: s.lower())
        if uniq:
            return uniq

        # Fallback: keep UI functional even if the API doesn't expose Category types
        return DEFAULT_CATEGORIES

    except Exception:
        return DEFAULT_CATEGORIES

# ---- Request param normalization (prevents 400s) ----

def _bool_param(v: bool) -> str:
    # CivitAI is picky; lowercase string is safest.
    return "true" if bool(v) else "false"

def _normalize_sort_api(v: str) -> Optional[str]:
    """
    Normalize UI sort strings into API-accepted /api/v1/models 'sort' values.

    IMPORTANT (verified):
      - API accepts: "Highest Rated", "Most Downloaded", "Newest"
      - API rejects: "HighestRated", "MostDownloaded" (no-space variants)

    Returns None to omit sort (let API default / relevance).
    """
    if not v:
        return None

    sv = str(v).strip()
    if not sv:
        return None

    low = sv.lower()
    if low in ("any", "relevance", "relevant", "default"):
        return None

    if low in ("highestrated", "highest rated"):
        return "Highest Rated"

    if low in ("mostdownloaded", "most downloaded"):
        return "Most Downloaded"

    if low == "newest":
        return "Newest"

    # Unknown -> omit (safer than sending a bad value that 400s)
    return None

def _normalize_period(v: str) -> Optional[str]:
    """
    Converts UI-ish period strings into API enums.
    Returns None to omit period.
    """
    if not v:
        return None

    pv = str(v).strip().lower()
    if pv in ("any", "none", "all", "relevance", "default"):
        return None

    period_map = {
        "alltime": "AllTime",
        "all time": "AllTime",
        "year": "Year",
        "month": "Month",
        "week": "Week",
        "day": "Day",
    }
    return period_map.get(pv, None)

def civitai_search_models(
    *,
    query: str = "",
    token: Optional[str] = None,
    limit: int = 60,
    page: int = 1,
    model_type: str = "Any",
    tag: Optional[str] = None,
    base_models: Optional[List[str]] = None,
    sort: Optional[str] = None,
    period: Optional[str] = None,
    nsfw: bool = False,
) -> Dict:
    """
    Wrapper around CivitAI /models with safer param formatting.

    Two Searchbar Modes (tied ONLY to whether query has letters):
      Mode 1 (Searchbar Empty): q == ""  -> normal browse mode
      Mode 2 (Searchbar Populated): q != "" -> tag-search mode using q as tag
        (because your UI behavior is tag-driven when text is typed)

    SORT (critical):
      - Always send API-accepted values: "Highest Rated", "Most Downloaded", "Newest"
      - Never send no-space enums.
      - requests will URL-encode spaces automatically -> Highest%20Rated, etc.
    """
    params: Dict = {
        "limit": int(limit),
        "page": int(page),
        "nsfw": _bool_param(nsfw),
    }

    q = str(query or "").strip()
    searchbar_populated = bool(q)

    # Model type
    mt = str(model_type or "").strip()
    if mt and mt.lower() not in ("any", "all"):
        params["types"] = mt

    # Mode switch:
    # - If searchbar has letters: treat it as TAG mode (tag=q)
    # - If empty: do not inject a tag from q; allow explicit tag param if provided
    if searchbar_populated:
        params["tag"] = q
    else:
        if tag:
            t = str(tag).strip()
            if t:
                params["tag"] = t

    if base_models:
        clean = [str(b).strip() for b in base_models if str(b).strip()]
        if clean:
            params["baseModels"] = clean

    # Sort: ALWAYS normalize to API-accepted values (spaces included)
    s = _normalize_sort_api(sort or "")
    if s:
        params["sort"] = s

    p = _normalize_period(period or "")
    if p:
        params["period"] = p

    headers = _authed_headers()
    if token:
        headers = {"Authorization": f"Bearer {token}"}

    r = requests.get(f"{CIVITAI_API}/models", headers=headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json()

# ---- Result normalization helpers ----

def _file_ext_from_name(filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower().lstrip(".")
    return ext or ""

def _preferred_file_formats_from_version(version: Dict) -> List[str]:
    out: List[str] = []
    for f in (version.get("files") or []):
        if not isinstance(f, dict):
            continue
        name = str(f.get("name") or "").strip()
        ext = _file_ext_from_name(name)
        if ext:
            out.append(ext)

        meta = f.get("metadata") or {}
        meta_fmt = str(meta.get("format") or "").strip()
        if meta_fmt:
            out.append(meta_fmt)

    seen = set()
    uniq: List[str] = []
    for x in out:
        xl = str(x).lower()
        if xl and xl not in seen:
            seen.add(xl)
            uniq.append(str(x))
    return uniq

def _formats_from_item(model_item: Dict) -> List[str]:
    mv = model_item.get("modelVersions") or []
    if not mv:
        return []
    v0 = mv[0] if isinstance(mv[0], dict) else {}
    return _preferred_file_formats_from_version(v0)

def _default_version_id(model_item: Dict) -> Optional[int]:
    mv = model_item.get("modelVersions") or []
    if not mv:
        return None
    v0 = mv[0] if isinstance(mv[0], dict) else {}
    vid = v0.get("id")
    return int(vid) if vid is not None else None

def _base_model_from_item(model_item: Dict) -> str:
    mv = model_item.get("modelVersions") or []
    if not mv:
        return ""
    v0 = mv[0] if isinstance(mv[0], dict) else {}
    return str(v0.get("baseModel") or "")

def _thumb_from_model_item(model_item: Dict) -> str:
    imgs = model_item.get("images") or []
    if not imgs:
        mv = model_item.get("modelVersions") or []
        if mv and isinstance(mv[0], dict):
            imgs = mv[0].get("images") or []
    if not imgs:
        return ""
    img0 = imgs[0] if isinstance(imgs[0], dict) else {}
    return str(img0.get("url") or "")

def _author_from_item(model_item: Dict) -> str:
    creator = model_item.get("creator") or {}
    return str(creator.get("username") or "")

def _stats_from_item(model_item: Dict) -> Dict:
    s = model_item.get("stats") or {}
    return {
        "downloads": int(s.get("downloadCount") or 0),
        "favorites": int(s.get("favoriteCount") or 0),
        "rating": float(s.get("rating") or 0.0),
    }
# === Block 6 Finish === CivitAI API HTTP === #

# === Block 7 Start === Filter Cache and Derivation === #

def _load_filters_cache() -> Optional[Dict]:
    p = filters_cache_path()
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None

def _save_filters_cache(payload: Dict) -> None:
    try:
        filters_cache_path().write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception:
        pass

SORT_ORDERS = [
    "Relevance",
    "Highest Rated",
    "Most Downloaded",
    "Newest",
]

def derive_filters(items: List[Dict]) -> Dict:
    types, bases, formats = set(), set(), set()

    for it in (items or []):
        if not isinstance(it, dict):
            continue

        t = str(it.get("type") or "").strip()
        if t:
            types.add(t)

        bm = _base_model_from_item(it)
        if bm:
            bases.add(bm)

        for f in _formats_from_item(it):
            if f:
                formats.add(str(f))

    categories = fetch_civitai_categories()

    return {
        "types": sorted(types),
        "baseModels": sorted(bases),
        "fileFormats": sorted(formats, key=lambda s: s.lower()),
        "categories": categories,
        "sortOrders": SORT_ORDERS[:],
    }

def get_filters(force: bool = False) -> Dict:
    if not force:
        cached = _load_filters_cache()
        if isinstance(cached, dict) and cached.get("ok") is True:
            return cached

    try:
        data = civitai_search_models(
            query="",
            token=load_token_decrypted(),
            limit=100,
            page=1,
            model_type="Any",
            tag=None,
            base_models=None,
            sort="Newest",
            period="AllTime",
            nsfw=False,
        )

        items = data.get("items") or []
        filt = derive_filters(items)
        payload = {"ok": True, **filt}
        _save_filters_cache(payload)
        return payload
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "types": [],
            "baseModels": [],
            "fileFormats": [],
            "categories": fetch_civitai_categories(),
            "sortOrders": SORT_ORDERS[:],
        }
# === Block 7 Finish === Filter Cache and Derivation === #

# === Block 8 Start === Search Result Shaping === #

def shape_item(item: Dict) -> Dict:
    versions = item.get("modelVersions") or []
    version = versions[0] if versions else {}

    vid = str(version.get("id") or "")
    installed_path = registry_get_path(vid) if vid else ""
    installed = bool(installed_path and Path(installed_path).exists())

    file_formats = []
    for f in (version.get("files") or []):
        if isinstance(f, dict):
            fmt = f.get("format") or f.get("type")
            if fmt:
                file_formats.append(str(fmt))

    thumb = _thumb_from_model_item(item)

    return {
        "name": item.get("name") or "",
        "creator": (item.get("creator") or {}).get("username") or "",
        "type": item.get("type") or "",
        "baseModel": str(version.get("baseModel") or ""),
        "fileFormats": file_formats,
        "thumb": thumb,
        "defaultVersionId": vid,
        "installed": installed,
        "installedPath": installed_path if installed else "",
    }
# === Block 8 Finish === Search Result Shaping === #

# === Block 9 Start === Download, Install, Uninstall Core === #

# Global state for download progress
_active_downloads: Dict[str, Dict[str, int]] = {}
_progress_lock = threading.Lock()

def install_version(
    version_id: int,
    base_model_filter: str = "Any",
    file_format_filter: str = "Any",
    category: str = "Any",
) -> Dict:
    try:
        # IMPORTANT: version_id here is a *modelVersionId* (defaultVersionId from search results)
        # So we must fetch via /model-versions/{id}, NOT /models/{id}
        data = _get_json(f"{MODEL_VERSION_ENDPOINT}/{int(version_id)}")

        files = data.get("files") or []
        if not files:
            return {"ok": False, "error": "No downloadable files found for this version."}

        # Choose first file (simple + stable)
        file = files[0]

        raw_name = str(file.get("name") or f"civitai_{version_id}")
        safe_name = sanitize_filename_part(raw_name)
        ext = infer_extension_from_filename(raw_name)

        # ---- Extract model identity fields (for naming + base-model folder) ----
        # /model-versions payloads may include either:
        # - data["model"] (full model object), or
        # - data["modelId"] (id only)
        model_obj = data.get("model") or {}
        model_id = data.get("modelId") or model_obj.get("id")

        # Base model is typically on the version object
        base_model = str(data.get("baseModel") or "").strip()

        # Try to get name/type/creator from embedded model object first
        model_name = str(model_obj.get("name") or "").strip()
        model_type = str(model_obj.get("type") or "").strip()

        creator_obj = model_obj.get("creator") or {}
        model_author = str(creator_obj.get("username") or creator_obj.get("name") or "").strip()

        # Fallback: if the version response doesn't include model info, fetch the model by id
        if (not model_name or not model_type or not model_author) and model_id:
            try:
                mdata = _get_json(f"{MODEL_ENDPOINT}/{int(model_id)}")
                model_name = model_name or str(mdata.get("name") or "").strip()
                model_type = model_type or str(mdata.get("type") or "").strip()
                mcreator = mdata.get("creator") or {}
                model_author = model_author or str(mcreator.get("username") or mcreator.get("name") or "").strip()
            except Exception:
                pass

        # Final fallbacks (never let naming crash)
        if not model_name:
            model_name = f"civitai_{version_id}"
        if not model_type:
            model_type = "Checkpoint"

        # ---- Filename format: Base-Model_Model-Name_Model-Author ----
        def _slug(s: str) -> str:
            s = sanitize_filename_part(str(s or "").strip())
            s = s.replace(" ", "-")
            while "--" in s:
                s = s.replace("--", "-")
            return s.strip("-_")

        base_part = _slug(base_model) if base_model else ""
        name_part = _slug(model_name) if model_name else _slug(safe_name)
        author_part = _slug(model_author) if model_author else ""

        # NEW: Category folder part (only if provided and not "Any")
        category_raw = str(category or "").strip()
        category_part = ""
        if category_raw and category_raw.lower() not in ("any", "all", "none"):
            category_part = _slug(category_raw)

        parts = []
        if base_part:
            parts.append(base_part)
        if name_part:
            parts.append(name_part)
        if author_part:
            parts.append(author_part)

        stem = "_".join(parts) if parts else (_slug(safe_name) or f"civitai_{version_id}")
        filename = stem if stem.lower().endswith(ext.lower()) else (stem + ext)

        # ---- Build target folder (type folder + base-model subfolder + category subfolder + model-name subfolder) ----
        sub = guess_subfolder(model_type)

        # Desired structure:
        # .\models\<Type>\<Base Model>\<Category>\<Model Name>\<Filename>
        #
        # Falls back gracefully if any component is missing.
        if base_part and category_part and name_part:
            target = comfy_root() / "models" / sub / base_part / category_part / name_part / filename
        elif base_part and category_part:
            # Fallback: Base Model + Category known
            target = comfy_root() / "models" / sub / base_part / category_part / filename
        elif base_part and name_part:
            # Fallback: Base Model + Model Name known (current behavior)
            target = comfy_root() / "models" / sub / base_part / name_part / filename
        elif base_part:
            # Fallback: Only Base Model known
            target = comfy_root() / "models" / sub / base_part / filename
        elif category_part and name_part:
            # Fallback: Category + Model Name known
            target = comfy_root() / "models" / sub / category_part / name_part / filename
        elif category_part:
            # Fallback: Only Category known
            target = comfy_root() / "models" / sub / category_part / filename
        elif name_part:
            # Fallback: Only Model Name known
            target = comfy_root() / "models" / sub / name_part / filename
        else:
            # Ultimate fallback
            target = comfy_root() / "models" / sub / filename

        # ---- Download URL ----
        download_url = file.get("downloadUrl")

        # Fallback: CivitAI also supports /api/download/models/{modelVersionId}
        if not download_url:
            download_url = f"https://civitai.com/api/download/models/{int(version_id)}"

        target.parent.mkdir(parents=True, exist_ok=True)

        # Initialize progress state
        vid_str = str(version_id)
        with requests.get(download_url, headers=_authed_headers(), stream=True) as r:
            r.raise_for_status()
            
            # Get total size if available
            total_size = int(r.headers.get('content-length', 0))
            
            # Set initial state
            with _progress_lock:
                _active_downloads[vid_str] = {"current": 0, "total": total_size}

            with open(target, "wb") as f:
                downloaded = 0
                for chunk in r.iter_content(CHUNK_SIZE):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        
                        # Update progress
                        with _progress_lock:
                            _active_downloads[vid_str]["current"] = downloaded

        registry_set_installed(vid_str, str(target))
        return {"ok": True, "path": str(target)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def uninstall_version(version_id: int) -> Dict:
    try:
        vid = str(int(version_id))
        path = registry_get_path(vid)

        if path and os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                # still remove from registry if file is gone/locked
                registry_remove(vid)
                return {"ok": False, "error": f"Failed to remove file: {e}"}

        registry_remove(vid)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
# === Block 9 Finish === Download, Install, Uninstall Core === #

# === Block 10 Start === Routes and Endpoint Handlers === #

def _normalize_sort_for_api(sort_label: str) -> Optional[str]:
    """
    Converts UI-facing sort labels into values accepted by our CivitAI request helper.
    """
    if not sort_label:
        return None

    s = str(sort_label).strip()
    if not s:
        return None

    SORT_MAP = {
        "Relevance": None,
        "Any": None,
        "Highest Rated": "Highest Rated",
        "Most Downloaded": "Most Downloaded",
        "Newest": "Newest",
    }

    return SORT_MAP.get(s, None)


async def _read_json(request: web.Request) -> Dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def register_routes():
    server = PromptServer.instance
    if server is None:
        print("[CivitAI Library] ❌ PromptServer not ready, routes not registered.")
        return False

    routes = server.routes

    # -----------------------------
    # GET: Status / Filters / Search / Progress
    # -----------------------------

    @routes.get(f"{ROUTE_BASE}/status")
    async def civitai_status(request: web.Request):
        return web.json_response({
            "ok": True,
            "hasToken": bool(load_token_decrypted()),
            "canEncrypt": False,
        })

    @routes.get(f"{ROUTE_BASE}/filters")
    async def civitai_filters(request: web.Request):
        force = (str(request.rel_url.query.get("force", "0")) == "1")
        payload = get_filters(force=force)
        return web.json_response(payload, status=200 if payload.get("ok") else 500)

    @routes.get(f"{ROUTE_BASE}/search")
    async def civitai_search(request: web.Request):
        try:
            q = str(request.rel_url.query.get("q", "")).strip()
            limit = int(request.rel_url.query.get("limit", "60"))
            page = int(request.rel_url.query.get("page", "1"))

            base_model_filter = str(request.rel_url.query.get("baseModel", "Any")).strip()
            model_type = str(request.rel_url.query.get("modelType", "Any")).strip()
            file_format_filter = str(request.rel_url.query.get("fileFormat", "Any")).strip()
            category = str(request.rel_url.query.get("category", "Any")).strip()
            sort_label = str(request.rel_url.query.get("sort", "Relevance")).strip()

            api_sort = _normalize_sort_for_api(sort_label)
            category_tag = None if category == "Any" else category
            base_models = None if base_model_filter == "Any" else [base_model_filter]
            search_mode = bool(q)
            period_for_call = "Any" if search_mode else "AllTime"
            sort_for_call = (api_sort or "Any")
            token = load_token_decrypted()

            def _call_models(tag_value: Optional[str], query_value: str = "") -> Dict:
                return civitai_search_models(
                    query=query_value,
                    token=token,
                    limit=limit,
                    page=page,
                    model_type=model_type,
                    tag=tag_value,
                    base_models=base_models,
                    sort=sort_for_call,
                    period=period_for_call,
                    nsfw=False,
                )

            if search_mode:
                search_tag = q
                if category_tag:
                    data_a = _call_models(tag_value=search_tag, query_value="")
                    items_a = data_a.get("items") or []
                    data_b = _call_models(tag_value=category_tag, query_value="")
                    items_b = data_b.get("items") or []
                    ids_b = set()
                    for it in items_b:
                        try:
                            ids_b.add(int(it.get("id")))
                        except Exception:
                            pass
                    items = []
                    for it in items_a:
                        try:
                            if int(it.get("id")) in ids_b:
                                items.append(it)
                        except Exception:
                            continue
                else:
                    data = _call_models(tag_value=search_tag, query_value="")
                    items = data.get("items") or []

                if q and not items:
                    q_lower = q.lower()
                    if q_lower != q:
                        if category_tag:
                            data_a = _call_models(tag_value=q_lower, query_value="")
                            items_a = data_a.get("items") or []
                            data_b = _call_models(tag_value=category_tag, query_value="")
                            items_b = data_b.get("items") or []
                            ids_b = set()
                            for it in items_b:
                                try:
                                    ids_b.add(int(it.get("id")))
                                except Exception:
                                    pass
                            items = []
                            for it in items_a:
                                try:
                                    if int(it.get("id")) in ids_b:
                                        items.append(it)
                                except Exception:
                                    continue
                        else:
                            data = _call_models(tag_value=q_lower, query_value="")
                            items = data.get("items") or []

                if q and not items and (" " in q):
                    first = q.split(" ", 1)[0].strip()
                    if first:
                        if category_tag:
                            data_a = _call_models(tag_value=first, query_value="")
                            items_a = data_a.get("items") or []
                            data_b = _call_models(tag_value=category_tag, query_value="")
                            items_b = data_b.get("items") or []
                            ids_b = set()
                            for it in items_b:
                                try:
                                    ids_b.add(int(it.get("id")))
                                except Exception:
                                    pass
                            items = []
                            for it in items_a:
                                try:
                                    if int(it.get("id")) in ids_b:
                                        items.append(it)
                                except Exception:
                                    continue
                        else:
                            data = _call_models(tag_value=first, query_value="")
                            items = data.get("items") or []
            else:
                data = _call_models(tag_value=category_tag, query_value="")
                items = data.get("items") or []

            results = []
            for it in items:
                fmts = _formats_from_item(it)
                if file_format_filter != "Any":
                    if file_format_filter.lower() not in [f.lower() for f in fmts]:
                        continue
                vid = _default_version_id(it)
                installed_path = registry_get_path(vid) if vid else ""
                installed = bool(installed_path and Path(installed_path).exists())

                results.append({
                    "id": it.get("id"),
                    "name": it.get("name") or "",
                    "type": it.get("type") or "",
                    "creator": _author_from_item(it),
                    "thumb": _thumb_from_model_item(it),
                    "defaultVersionId": vid,
                    "baseModel": _base_model_from_item(it),
                    "fileFormats": fmts,
                    "stats": _stats_from_item(it),
                    "installed": installed,
                    "installedPath": installed_path if installed else "",
                })

            return web.json_response({"ok": True, "items": results})

        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @routes.get(f"{ROUTE_BASE}/progress/{{version_id}}")
    async def civitai_progress(request: web.Request):
        """
        Returns download progress for a specific version_id.
        Format: {"progress": 0-100}
        """
        try:
            # Extract version_id from URL path
            version_id = request.match_info.get("version_id")
            if not version_id:
                return web.json_response({"progress": 0}, status=400)

            with _progress_lock:
                state = _active_downloads.get(version_id)
                if not state:
                    return web.json_response({"progress": 0})
                
                current = state.get("current", 0)
                total = state.get("total", 0)
                
                if total > 0:
                    percent = int((current / total) * 100)
                else:
                    percent = 0 # Unknown size

            return web.json_response({"progress": percent})
        except Exception as e:
            return web.json_response({"progress": 0}, status=500)

    # -----------------------------
    # POST: Token / Install / Uninstall
    # -----------------------------

    @routes.post(f"{ROUTE_BASE}/token")
    async def civitai_token_save(request: web.Request):
        try:
            body = await _read_json(request)
            token = str(body.get("token") or "").strip()
            ok, err = save_token_encrypted(token)
            if ok:
                return web.json_response({"ok": True})
            return web.json_response({"ok": False, "error": err or "Failed to save token."}, status=500)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @routes.post(f"{ROUTE_BASE}/token/clear")
    async def civitai_token_clear(request: web.Request):
        try:
            clear_saved_token()
            return web.json_response({"ok": True})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @routes.post(f"{ROUTE_BASE}/install")
    async def civitai_install(request: web.Request):
        try:
            body = await _read_json(request)
            version_id = body.get("versionId", None)
            if version_id is None:
                return web.json_response({"ok": False, "error": "Missing versionId."}, status=400)

            base_model = str(body.get("baseModel") or "Any").strip()
            file_format = str(body.get("fileFormat") or "Any").strip()

            # NEW: Category (used for extra folder level: models/<type>/<base>/<category>/...)
            category = str(body.get("category") or "Any").strip()

            # CRITICAL FIX: Run the blocking download in a thread executor
            # to prevent freezing the ComfyUI async event loop.
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(
                None,
                install_version,
                int(version_id),
                base_model,
                file_format,
                category,
            )

            return web.json_response(res, status=200 if res.get("ok") else 500)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @routes.post(f"{ROUTE_BASE}/uninstall")
    async def civitai_uninstall(request: web.Request):
        try:
            body = await _read_json(request)
            version_id = body.get("versionId", None)
            if version_id is None:
                return web.json_response({"ok": False, "error": "Missing versionId."}, status=400)

            res = uninstall_version(int(version_id))
            return web.json_response(res, status=200 if res.get("ok") else 500)
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    print("[CivitAI Library] ✅ Routes registered successfully")
    return True


# Retry registration until PromptServer is ready (ComfyUI init timing can vary)
_routes_registered = False

def _try_register_routes_with_retry():
    global _routes_registered
    if _routes_registered:
        return

    try:
        ok = register_routes()
        if ok:
            _routes_registered = True
            return
    except Exception as e:
        print(f"[CivitAI Library] ❌ Route registration failed: {e}")

    # Retry shortly
    threading.Timer(0.5, _try_register_routes_with_retry).start()


_try_register_routes_with_retry()
# === Block 10 Finish === Routes and Endpoint Handlers === #

# === Block 11 Start === Code End === #

# End of CivitAI_Library_API.py
# === Block 11 Finish === Code End === #
