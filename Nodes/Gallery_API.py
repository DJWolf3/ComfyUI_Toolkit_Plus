# === Block 0 Start === Header === #
# Gallery_API.py
# Backend for the "Gallery" panel (Images + Videos) in your custom nodes pack.
#
# Storage (inside the custom node pack root):
#   Gallery/
#     Images/
#     Videos/
#
# Filename format:
#   YYYY-MM-DD_#########.<ext>   (9-digit number, reroll if collision for that date)
#
# Endpoints (base: /sample_pack/gallery):
#   GET  /list?media=all|images|videos&year=YYYY&month=YYYY-MM&search=...&sort=relevant|newest|oldest|asc|desc&scan=0|1
#   GET  /file?id=Images/<filename>  (or Videos/<filename>)
#   POST /save    { "data_url": "data:<mime>;base64,..." }
#   POST /delete  { "id": "Images/<filename>" }   (also accepts item_id/path)
#   POST /open_directory { "mode": "all|images|videos" }    (Windows: opens Explorer to folder)
#   POST /reveal  { "id": "Images/<filename>" }            (Windows: opens Explorer selecting file)
#
# Notes:
# - /list returns both "years/months" AND "available_years/available_months" for frontend compatibility.

import base64
import os
import re
import secrets
import subprocess
from datetime import datetime
from typing import Any, Dict, List, Tuple

from aiohttp import web
from server import PromptServer
# === Block 0 Finish === Header === #

# === Block 1 Start === Constants & Paths === #

ROUTE_BASE = "/sample_pack/gallery"

# This file is intended to live at: <PACK_ROOT>/Nodes/Gallery_API.py
PACK_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

GALLERY_ROOT = os.path.join(PACK_ROOT, "Gallery")
IMAGES_DIR = os.path.join(GALLERY_ROOT, "Images")
VIDEOS_DIR = os.path.join(GALLERY_ROOT, "Videos")

MEDIA_ALL = "all"
MEDIA_IMAGES = "images"
MEDIA_VIDEOS = "videos"

SORT_RELEVANT = "relevant"
SORT_NEWEST = "newest"
SORT_OLDEST = "oldest"
SORT_ASC = "asc"
SORT_DESC = "desc"

# Allowed extensions
IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "gif"}
VIDEO_EXTS = {"mp4", "webm", "mov", "mkv"}

# Filename must match: YYYY-MM-DD_#########.<ext>
FILENAME_RE = re.compile(r"^(?P<date>\d{4}-\d{2}-\d{2})_(?P<num>\d{9})\.(?P<ext>[A-Za-z0-9]+)$")

# Common MIME -> extension map (fallbacks handled)
MIME_TO_IMAGE_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MIME_TO_VIDEO_EXT = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
}
# === Block 1 Finish === Constants & Paths === #

# === Block 2 Start === Directory Helpers === #

def _ensure_dirs() -> None:
    os.makedirs(IMAGES_DIR, exist_ok=True)
    os.makedirs(VIDEOS_DIR, exist_ok=True)

def _is_windows() -> bool:
    return os.name == "nt"

def _today_stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d")

def _folder_for_media(media: str) -> str:
    m = (media or "").strip().lower()
    if m == MEDIA_VIDEOS:
        return VIDEOS_DIR
    return IMAGES_DIR

def _allowed_exts_for_media(media: str) -> set:
    m = (media or "").strip().lower()
    return VIDEO_EXTS if m == MEDIA_VIDEOS else IMAGE_EXTS

def _media_from_prefix(prefix: str) -> str:
    if (prefix or "").strip().lower() == "videos":
        return MEDIA_VIDEOS
    return MEDIA_IMAGES

def _id_for(media: str, filename: str) -> str:
    return ("Videos/" if (media or "").strip().lower() == MEDIA_VIDEOS else "Images/") + filename

_ensure_dirs()
# === Block 2 Finish === Directory Helpers === #

# === Block 3 Start === ID & Path Safety === #

def _normalize_id(item_id: str) -> Tuple[str, str]:
    """
    Accepts:
      "Images/<filename>" or "Videos/<filename>"

    Returns:
      (media, filename)
    """
    if not item_id or not isinstance(item_id, str):
        raise ValueError("Missing id")

    raw = item_id.strip().replace("\\", "/")
    parts = [p for p in raw.split("/") if p]
    if len(parts) != 2:
        raise ValueError("Invalid id format (expected Images/<file> or Videos/<file>)")

    prefix, filename = parts[0], parts[1]
    if prefix.strip().lower() not in ("images", "videos"):
        raise ValueError("Invalid id prefix (must be Images or Videos)")

    m = FILENAME_RE.match(filename)
    if not m:
        raise ValueError("Invalid filename format")

    media = _media_from_prefix(prefix)
    ext = (m.group("ext") or "").lower()
    if ext not in _allowed_exts_for_media(media):
        raise ValueError(f"File extension not allowed for {media}")

    return media, filename

def _abs_path_for_id(item_id: str) -> str:
    media, filename = _normalize_id(item_id)
    folder = _folder_for_media(media)
    abs_path = os.path.abspath(os.path.join(folder, filename))

    # Prevent traversal
    if os.path.commonpath([os.path.abspath(folder), abs_path]) != os.path.abspath(folder):
        raise ValueError("Path traversal detected")

    return abs_path
# === Block 3 Finish === ID & Path Safety === #

# === Block 4 Start === Data URL Parsing === #

def _parse_data_url(data_url: str) -> Tuple[str, bytes]:
    """
    Accept: data:<mime>;base64,<payload>
    Return: (mime, raw_bytes)
    """
    if not data_url or not isinstance(data_url, str):
        raise ValueError("Missing data_url")

    if not data_url.startswith("data:"):
        raise ValueError("data_url must start with 'data:'")

    head, sep, b64 = data_url.partition(",")
    if sep != ",":
        raise ValueError("Invalid data_url (missing comma)")

    head = head[5:]  # strip "data:"
    mime, _, meta = head.partition(";")
    if "base64" not in meta.lower():
        raise ValueError("data_url must be base64 encoded")

    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception:
        raise ValueError("Invalid base64 payload")

    return (mime.strip().lower(), raw)
# === Block 4 Finish === Data URL Parsing === #

# === Block 5 Start === Filename Generation === #

def _exists_same_date_num(folder: str, date_stamp: str, nine_digits: str) -> bool:
    """
    Collision means: same YYYY-MM-DD + same 9 digits, regardless of extension,
    within the same media folder.
    """
    prefix = f"{date_stamp}_{nine_digits}."
    try:
        for fn in os.listdir(folder):
            if fn.startswith(prefix):
                return True
    except FileNotFoundError:
        return False
    return False

def _pick_unique_filename(media: str, ext: str) -> str:
    folder = _folder_for_media(media)
    date_stamp = _today_stamp()

    ext = (ext or "").strip().lower()
    allowed = _allowed_exts_for_media(media)

    # Safe fallback
    if ext not in allowed:
        ext = "mp4" if (media or "").strip().lower() == MEDIA_VIDEOS else "png"

    # Reroll until unused
    for _ in range(5000):
        n = secrets.randbelow(1_000_000_000)  # 0..999,999,999
        nine = f"{n:09d}"
        if not _exists_same_date_num(folder, date_stamp, nine):
            return f"{date_stamp}_{nine}.{ext}"

    raise RuntimeError("Failed to generate a unique filename after many attempts")
# === Block 5 Finish === Filename Generation === #

# === Block 6 Start === Scan, Filter, Sort === #

def _scan_folder(media: str) -> List[Dict[str, Any]]:
    folder = _folder_for_media(media)
    allowed = _allowed_exts_for_media(media)
    items: List[Dict[str, Any]] = []

    try:
        names = os.listdir(folder)
    except FileNotFoundError:
        return items

    for fn in names:
        m = FILENAME_RE.match(fn)
        if not m:
            continue

        ext = (m.group("ext") or "").lower()
        if ext not in allowed:
            continue

        abs_path = os.path.join(folder, fn)
        if not os.path.isfile(abs_path):
            continue

        date_str = m.group("date")
        year = date_str[:4]
        month = date_str[:7]  # YYYY-MM

        items.append({
            "id": _id_for(media, fn),
            "filename": fn,
            "media": media,
            "type": "video" if media == MEDIA_VIDEOS else "image",
            "date": date_str,
            "year": year,
            "month": month,
            "mtime": float(os.path.getmtime(abs_path)),
            "url": f"{ROUTE_BASE}/file?id={_id_for(media, fn)}",
        })

    return items

def _relevance_key(filename: str, query: str) -> Tuple[int, int]:
    """
    Lower is better.
    Score by:
      - startswith => 0
      - contains => 1
      - else => 2
    Then earliest index.
    """
    f = filename.lower()
    q = query.lower()
    if f.startswith(q):
        return (0, 0)
    idx = f.find(q)
    if idx >= 0:
        return (1, idx)
    return (2, 10**9)

def _apply_filters(items: List[Dict[str, Any]], year: str, month: str, search: str) -> List[Dict[str, Any]]:
    out = items

    y = (year or "").strip()
    if y:
        out = [x for x in out if x.get("year") == y]

    mo = (month or "").strip()
    if mo:
        out = [x for x in out if x.get("month") == mo]

    s = (search or "").strip().lower()
    if s:
        out = [x for x in out if s in str(x.get("filename", "")).lower()]

    return out

def _apply_sort(items: List[Dict[str, Any]], sort: str, search: str) -> List[Dict[str, Any]]:
    mode = (sort or SORT_NEWEST).strip().lower()
    s = (search or "").strip()

    if mode == SORT_OLDEST:
        return sorted(items, key=lambda x: x.get("mtime", 0.0))
    if mode == SORT_ASC:
        return sorted(items, key=lambda x: str(x.get("filename", "")).lower())
    if mode == SORT_DESC:
        return sorted(items, key=lambda x: str(x.get("filename", "")).lower(), reverse=True)
    if mode == SORT_RELEVANT and s:
        return sorted(items, key=lambda x: (_relevance_key(str(x.get("filename", "")), s), -float(x.get("mtime", 0.0))))
    return sorted(items, key=lambda x: float(x.get("mtime", 0.0)), reverse=True)

def _years_months(items: List[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    years = sorted({str(x.get("year")) for x in items if x.get("year")}, reverse=True)
    months = sorted({str(x.get("month")) for x in items if x.get("month")}, reverse=True)
    return years, months
# === Block 6 Finish === Scan, Filter, Sort === #

# === Block 7 Start === Explorer Integration === #

def _open_explorer_folder(path: str) -> None:
    if not _is_windows():
        raise RuntimeError("Open directory is only supported on Windows.")
    subprocess.Popen(["explorer", os.path.abspath(path)])

def _reveal_in_explorer(file_path: str) -> None:
    if not _is_windows():
        raise RuntimeError("Reveal is only supported on Windows.")
    subprocess.Popen(["explorer", "/select,", os.path.abspath(file_path)])
# === Block 7 Finish === Explorer Integration === #

# === Block 8 Start === Routes === #

routes = PromptServer.instance.routes

async def _fetch_bytes_from_source_url(request: web.Request, source_url: str) -> Tuple[str, bytes]:
    """
    Fetch bytes server-side from a ComfyUI URL so the frontend doesn't need to base64 large media.
    Accepts:
      - Relative: /view?... or /api/view?... etc
      - Absolute: must match the current host
    Returns:
      (mime, raw_bytes)
    """
    import aiohttp
    from urllib.parse import urlparse

    if not source_url or not isinstance(source_url, str):
        raise ValueError("Missing source_url")

    src = source_url.strip()

    host = request.headers.get("Host", "").strip()
    scheme = (request.scheme or "http").strip()

    if src.startswith("/"):
        if not host:
            raise RuntimeError("Host header missing; cannot resolve relative source_url")
        full_url = f"{scheme}://{host}{src}"
    else:
        u = urlparse(src)
        if not u.scheme or not u.netloc:
            raise ValueError("Invalid source_url")
        # Require same host for safety
        if host and u.netloc.lower() != host.lower():
            raise ValueError("source_url host mismatch")
        full_url = src

    async with aiohttp.ClientSession() as session:
        async with session.get(full_url) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Failed to fetch source_url (HTTP {resp.status})")
            mime = (resp.headers.get("Content-Type", "") or "").split(";")[0].strip().lower()
            raw = await resp.read()
            return mime, raw

def _infer_media_ext_from_url(source_url: str) -> Tuple[str, str]:
    """
    Fallback if Content-Type is missing:
      returns (media, ext)
    """
    from urllib.parse import urlparse
    u = urlparse(source_url)
    path = (u.path or "")
    ext = ""
    if "." in path:
        ext = path.rsplit(".", 1)[-1].strip().lower()

    if ext in VIDEO_EXTS:
        return MEDIA_VIDEOS, ext
    if ext in IMAGE_EXTS:
        return MEDIA_IMAGES, ext
    return MEDIA_IMAGES, "png"

@routes.get(f"{ROUTE_BASE}/list")
async def gallery_list(request: web.Request):
    try:
        media = (request.rel_url.query.get("media", MEDIA_ALL) or MEDIA_ALL).strip().lower()
        year = str(request.rel_url.query.get("year", "") or "").strip()
        month = str(request.rel_url.query.get("month", "") or "").strip()
        search = str(request.rel_url.query.get("search", "") or "").strip()
        sort = str(request.rel_url.query.get("sort", SORT_NEWEST) or SORT_NEWEST).strip().lower()

        items: List[Dict[str, Any]] = []

        if media in (MEDIA_ALL, ""):
            items.extend(_scan_folder(MEDIA_IMAGES))
            items.extend(_scan_folder(MEDIA_VIDEOS))
        elif media == MEDIA_IMAGES:
            items.extend(_scan_folder(MEDIA_IMAGES))
        elif media == MEDIA_VIDEOS:
            items.extend(_scan_folder(MEDIA_VIDEOS))
        else:
            raise ValueError("Invalid media filter")

        available_years, available_months = _years_months(items)

        filtered = _apply_filters(items, year=year, month=month, search=search)
        sorted_items = _apply_sort(filtered, sort=sort, search=search)

        return web.json_response({
            "ok": True,
            "items": sorted_items,
            "available_years": available_years,
            "available_months": available_months,
            "counts": {"total": len(items), "filtered": len(sorted_items)},
        })
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)

@routes.get(f"{ROUTE_BASE}/file")
async def gallery_file(request: web.Request):
    try:
        item_id = str(request.rel_url.query.get("id", "") or "").strip()
        if not item_id:
            raise ValueError("Missing id")

        path = _abs_path_for_id(item_id)
        if not os.path.isfile(path):
            return web.json_response({"ok": False, "error": "Not found"}, status=404)

        return web.FileResponse(path, headers={"Cache-Control": "no-cache"})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)

@routes.get(f"{ROUTE_BASE}/download")
async def gallery_download(request: web.Request):
    try:
        item_id = str(request.rel_url.query.get("id", "") or "").strip()
        if not item_id:
            raise ValueError("Missing id")

        path = _abs_path_for_id(item_id)
        if not os.path.isfile(path):
            return web.json_response({"ok": False, "error": "Not found"}, status=404)

        filename = os.path.basename(path)
        headers = {
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="{filename}"',
        }
        return web.FileResponse(path, headers=headers)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/save")
async def gallery_save(request: web.Request):
    """
    Body supports either:
      { "data_url": "data:<mime>;base64,..." }
    or:
      { "source_url": "/view?..." }   (server-side fetch; best for video/webp/gif)
    """
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid JSON payload")

        data_url = str(payload.get("data_url") or "").strip()
        source_url = str(payload.get("source_url") or "").strip()

        if not data_url and not source_url:
            raise ValueError("Missing data_url or source_url")

        if source_url:
            mime, raw = await _fetch_bytes_from_source_url(request, source_url)
            if mime.startswith("video/"):
                media = MEDIA_VIDEOS
                ext = MIME_TO_VIDEO_EXT.get(mime, "mp4")
            elif mime.startswith("image/"):
                media = MEDIA_IMAGES
                ext = MIME_TO_IMAGE_EXT.get(mime, "png")
            else:
                media, ext = _infer_media_ext_from_url(source_url)
        else:
            mime, raw = _parse_data_url(data_url)
            if mime.startswith("video/"):
                media = MEDIA_VIDEOS
                ext = MIME_TO_VIDEO_EXT.get(mime, "mp4")
            else:
                media = MEDIA_IMAGES
                ext = MIME_TO_IMAGE_EXT.get(mime, "png")

        _ensure_dirs()
        filename = _pick_unique_filename(media, ext)
        folder = _folder_for_media(media)
        out_path = os.path.join(folder, filename)

        with open(out_path, "wb") as f:
            f.write(raw)

        return web.json_response({
            "ok": True,
            "id": _id_for(media, filename),
            "filename": filename,
            "media": media,
            "url": f"{ROUTE_BASE}/file?id={_id_for(media, filename)}",
        })
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/delete")
async def gallery_delete(request: web.Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid JSON payload")

        item_id = str(payload.get("id") or payload.get("item_id") or payload.get("path") or "").strip()
        if not item_id:
            raise ValueError("Missing id")

        path = _abs_path_for_id(item_id)
        if not os.path.isfile(path):
            return web.json_response({"ok": False, "error": "Not found"}, status=404)

        os.remove(path)
        return web.json_response({"ok": True, "id": item_id})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/open_directory")
async def gallery_open_directory(request: web.Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid JSON payload")

        mode = (payload.get("mode", MEDIA_ALL) or MEDIA_ALL).strip().lower()

        if mode == MEDIA_IMAGES:
            target = IMAGES_DIR
        elif mode == MEDIA_VIDEOS:
            target = VIDEOS_DIR
        else:
            target = GALLERY_ROOT

        _ensure_dirs()
        _open_explorer_folder(target)

        return web.json_response({"ok": True, "opened": target})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)

@routes.post(f"{ROUTE_BASE}/reveal")
async def gallery_reveal(request: web.Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid JSON payload")

        item_id = str(payload.get("id", "") or "").strip()
        if not item_id:
            raise ValueError("Missing id")

        path = _abs_path_for_id(item_id)
        if not os.path.isfile(path):
            return web.json_response({"ok": False, "error": "Not found"}, status=404)

        _reveal_in_explorer(path)
        return web.json_response({"ok": True, "id": item_id})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)
# === Block 8 Finish === Routes === #
