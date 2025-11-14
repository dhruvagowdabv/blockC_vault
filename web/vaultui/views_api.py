# web/vaultui/views_api.py
import os
from pathlib import Path
from dotenv import load_dotenv
import requests
from django.conf import settings
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt

# Load .env from project root (only if not already in environment)
load_dotenv(Path(settings.BASE_DIR) / ".env")

NFT_API = "https://api.nft.storage/upload"
NFT_TOKEN = os.getenv("NFT_STORAGE_TOKEN")
MAX_MB = int(os.getenv("UPLOAD_MAX_MB", "50"))  # default 50 MB

@csrf_exempt
def upload_to_nftstorage(request):
    """POST /api/upload/  (form-data 'file') -> { "cid": "<cid>" }"""
    if request.method != "POST":
        return HttpResponseBadRequest("Only POST allowed")
    if 'file' not in request.FILES:
        return HttpResponseBadRequest("Missing file field")
    uploaded = request.FILES['file']
    if uploaded.size > MAX_MB * 1024 * 1024:
        return JsonResponse({"error": "File too large"}, status=413)
    if not NFT_TOKEN:
        return JsonResponse({"error": "Server not configured (missing NFT_STORAGE_TOKEN)"}, status=500)

    headers = {"Authorization": f"Bearer {NFT_TOKEN}"}
    files = {"file": (uploaded.name, uploaded.read())}

    try:
        resp = requests.post(NFT_API, headers=headers, files=files, timeout=120)
        # include provider response for debugging if it's not OK
        if resp.status_code != 200 and resp.status_code != 202:
            return JsonResponse({
                "error": "Upload failed",
                "status": resp.status_code,
                "raw": resp.text
            }, status=502)
        data = resp.json()
        # nft.storage returns { ok: true, value: { cid: "..." } }
        cid = data.get("value", {}).get("cid") or data.get("cid")
        if not cid:
            return JsonResponse({"error": "No CID in provider response", "raw": data}, status=500)
        return JsonResponse({"cid": cid})
    except requests.RequestException as e:
        return JsonResponse({"error": "Upload failed", "details": str(e)}, status=502)
