# web/vaultui/views_api.py
import os
from pathlib import Path
from dotenv import load_dotenv
import requests
from django.conf import settings
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt

# Load .env from project root
load_dotenv(Path(settings.BASE_DIR) / ".env")

# NFT.storage settings
NFT_UPLOAD_URL = "https://api.nft.storage/upload"
NFT_TOKEN = os.getenv("NFT_STORAGE_TOKEN")
MAX_MB = int(os.getenv("UPLOAD_MAX_MB", "50"))  # default 50 MB

# simple health-check helper for debug
def _log(msg):
    try:
        print("[views_api]", msg)
    except Exception:
        pass

@csrf_exempt
def upload_proxy(request):
    """
    POST /api/upload/
    Expects multipart/form-data with field 'file'.
    Returns JSON { "cid": "<cid>" } on success.
    """
    _log("upload_proxy called")

    if request.method != "POST":
        return HttpResponseBadRequest("Only POST allowed")

    if 'file' not in request.FILES:
        return HttpResponseBadRequest("Missing file field (form field name must be 'file')")

    if not NFT_TOKEN:
        _log("NFT token missing in server environment")
        return JsonResponse({"error": "Server not configured (missing NFT_STORAGE_TOKEN)"}, status=500)

    uploaded = request.FILES['file']

    # size limit
    if uploaded.size > MAX_MB * 1024 * 1024:
        return JsonResponse({"error": "File too large"}, status=413)

    # log masked token info for debugging (never print full token in production)
    _log(f"Using nft.storage token present? {bool(NFT_TOKEN)} length={len(NFT_TOKEN) if NFT_TOKEN else 0}")

    headers = {
        "Authorization": f"Bearer {NFT_TOKEN}"
        # requests will set Content-Type for multipart automatically
    }

    files = {"file": (uploaded.name, uploaded.read())}

    try:
        resp = requests.post(NFT_UPLOAD_URL, headers=headers, files=files, timeout=120)
        # If nft.storage returns a 401/400 with JSON body, we want to forward it for debugging
        try:
            resp.raise_for_status()
        except requests.HTTPError as e:
            _log(f"nft.storage response {resp.status_code}: {resp.text}")
            return JsonResponse({"error": "Upload failed", "status": resp.status_code, "raw": resp.text}, status=502)

        data = resp.json()
        # nft.storage returns {"ok": true, "value": { "cid": "bafy..." , ... } }
        cid = data.get("value", {}).get("cid") or data.get("cid") or data.get("value")
        if not cid:
            _log(f"No CID in provider response: {data}")
            return JsonResponse({"error": "No CID in provider response", "raw": data}, status=500)

        _log(f"Upload success CID={cid}")
        return JsonResponse({"cid": cid})
    except requests.RequestException as e:
        _log(f"requests exception: {e}")
        return JsonResponse({"error": "Upload failed", "details": str(e)}, status=502)
