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

WEB3_API = "https://api.web3.storage/upload"
WEB3_TOKEN = os.getenv("WEB3_STORAGE_TOKEN")
MAX_MB = int(os.getenv("UPLOAD_MAX_MB", "50"))

@csrf_exempt
def upload_to_web3storage(request):
    """
    POST /api/upload/  (form-data, field 'file')
    Returns JSON { "cid": "<cid>" } on success.
    """
    if request.method != "POST":
        return HttpResponseBadRequest("Only POST allowed")

    if 'file' not in request.FILES:
        return HttpResponseBadRequest("Missing file field")

    uploaded = request.FILES['file']

    # size limit
    if uploaded.size > MAX_MB * 1024 * 1024:
        return JsonResponse({"error": "File too large"}, status=413)

    if not WEB3_TOKEN:
        return JsonResponse({"error": "Server not configured (missing token)"}, status=500)

    headers = {"Authorization": f"Bearer {WEB3_TOKEN}"}
    files = {"file": (uploaded.name, uploaded.read())}

    try:
        resp = requests.post(WEB3_API, headers=headers, files=files, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        cid = data.get("cid") or data.get("value", {}).get("cid")
        if not cid:
            return JsonResponse({"error": "No CID in provider response", "raw": data}, status=500)
        return JsonResponse({"cid": cid})
    except requests.RequestException as e:
        return JsonResponse({"error": "Upload failed", "details": str(e)}, status=502)
