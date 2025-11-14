# web/vaultui/views_api.py
import os
import tempfile
import traceback
import sys
import base64
from pathlib import Path
from dotenv import load_dotenv
import requests
from django.conf import settings
from django.http import JsonResponse, HttpResponseBadRequest, HttpResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

# load .env
load_dotenv(Path(settings.BASE_DIR) / ".env")

# upload proxy config (existing)
NFT_API = "https://api.nft.storage/upload"
NFT_TOKEN = os.getenv("NFT_STORAGE_TOKEN")
MAX_MB = int(os.getenv("UPLOAD_MAX_MB", "50"))

# Attempt to import your OCR/processor functions
try:
    from .doc_processor import extract_fields_gemini, check_authenticity, extract_face, create_pdf
    DOC_PROCESSOR_AVAILABLE = True
except Exception:
    DOC_PROCESSOR_AVAILABLE = False


# --- replace the existing upload_to_web3storage with this debug-friendly version ---
@csrf_exempt
@require_POST
def upload_to_nftstorage(request):

    try:
        if 'file' not in request.FILES:
            return HttpResponseBadRequest("Missing file field")

        uploaded = request.FILES['file']

        if uploaded.size > MAX_MB * 1024 * 1024:
            return JsonResponse({"error": "File too large"}, status=413)

        if not NFT_TOKEN:
            return JsonResponse({"error": "Server missing NFT_STORAGE_TOKEN"}, status=500)

        headers = {"Authorization": f"Bearer {NFT_TOKEN}"}
        files = {"file": (uploaded.name, uploaded.read())}

        resp = requests.post(NFT_API, headers=headers, files=files)
        resp.raise_for_status()

        data = resp.json()
        cid = data.get("value", {}).get("cid") or data.get("cid")

        if not cid:
            return JsonResponse({"error": "No CID returned", "raw": data}, status=500)

        return JsonResponse({"cid": cid})

    except Exception as exc:
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        print("UPLOAD ERROR:\n", tb)

        return JsonResponse({
            "error": "Upload failed",
            "exception": type(exc).__name__,
            "message": str(exc)
        }, status=500)

# ---------------------- process endpoint ----------------------
@csrf_exempt
@require_POST
def process_document(request):
    """
    POST /api/process/
    form-data: file=<image/pdf>
    Query:
      ?json=1  -> return JSON preview (extracted fields + authenticity + base64 face thumbnail)
      default -> return generated PDF (application/pdf) as attachment

    This view writes the incoming file to a temp file and calls your doc_processor functions.
    """
    if 'file' not in request.FILES:
        return HttpResponseBadRequest("Missing file field")

    file = request.FILES['file']
    if file.size > MAX_MB * 1024 * 1024:
        return JsonResponse({"error": "File too large"}, status=413)

    # Save to a temporary file
    tmp_dir = Path(tempfile.gettempdir()) / "devid_vault_proc"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_in = tmp_dir / file.name
    with open(tmp_in, "wb") as fh:
        for chunk in file.chunks():
            fh.write(chunk)

    # If processor not available, return helpful message
    if not DOC_PROCESSOR_AVAILABLE:
        # cleanup
        try:
            tmp_in.unlink()
        except Exception:
            pass
        msg = {
            "error": "Document processor not installed",
            "install_instructions": "Create vaultui/doc_processor.py with functions: extract_fields_gemini, check_authenticity, extract_face, create_pdf. See conversation history for pipeline code."
        }
        return JsonResponse(msg, status=501)

    # Call pipeline functions (wrap errors)
    try:
        details = extract_fields_gemini(str(tmp_in)) or {}
    except Exception as e:
        details = {"error": f"extract_fields_gemini failed: {e}"}

    try:
        authenticity = check_authenticity(str(tmp_in)) or {}
    except Exception as e:
        authenticity = {"error": f"check_authenticity failed: {e}"}

    face_path = None
    face_b64 = None
    try:
        face_path = extract_face(str(tmp_in))  # should return path or None
        if face_path and os.path.exists(face_path):
            with open(face_path, "rb") as fh:
                face_b64 = base64.b64encode(fh.read()).decode("utf-8")
    except Exception as e:
        face_b64 = None

    # If ?json=1 requested, return JSON preview and base64 face
    if request.GET.get("json"):
        # clean tmp_in if you want
        return JsonResponse({"details": details, "authenticity": authenticity, "face_thumbnail_b64": face_b64})

    # Otherwise generate PDF and return it as response
    try:
        out_pdf = tmp_dir / f"processed_{tmp_in.stem}.pdf"
        # create_pdf(details, face_path, output=out_pdf)  # expects a string path
        # ensure create_pdf accepts pathlib Path or string
        create_pdf(details, face_path, str(out_pdf))

        if not out_pdf.exists():
            raise RuntimeError("PDF not created by create_pdf")

        # stream PDF back
        resp = FileResponse(open(out_pdf, "rb"), content_type="application/pdf")
        resp['Content-Disposition'] = f'attachment; filename="{out_pdf.name}"'

        # optionally cleanup input + face (keeps pdf for debugging)
        try:
            tmp_in.unlink()
        except Exception:
            pass

        return resp

    except Exception as e:
        # cleanup
        try:
            tmp_in.unlink()
        except Exception:
            pass
        return JsonResponse({"error": "Processing failed", "details": str(e)}, status=500)
