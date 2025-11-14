# web/vaultui/doc_processor.py
import os
import re
import json
import base64
import tempfile
from pathlib import Path
from textwrap import wrap

# imaging
try:
    import cv2
    CV2_AVAILABLE = True
except Exception:
    CV2_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False

# pdf
try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    REPORTLAB_AVAILABLE = True
except Exception:
    REPORTLAB_AVAILABLE = False

# attempt to import google.genai (Gemini) if user wants to use it
GENAI_CLIENT = None
GENAI_AVAILABLE = False
try:
    import google.genai as genai
    from google.genai.types import Part
    GENAI_KEY = os.getenv("GENAI_API_KEY") or os.getenv("GEMINI_API_KEY")
    if GENAI_KEY:
        GENAI_CLIENT = genai.Client(api_key=GENAI_KEY)
        GENAI_AVAILABLE = True
    else:
        # try client without explicit key (may read env elsewhere)
        try:
            GENAI_CLIENT = genai.Client()
            GENAI_AVAILABLE = True
        except Exception:
            GENAI_CLIENT = None
            GENAI_AVAILABLE = False
except Exception:
    GENAI_AVAILABLE = False
    GENAI_CLIENT = None

# -------------------------
# Utilities
# -------------------------
def safe_json_extract(text: str):
    """
    Attempt to extract a JSON object from the model response text.
    Returns dict or {} on failure.
    """
    if not text:
        return {}
    # Try to find first top-level {...}
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        # no JSON-looking content
        return {}
    s = m.group(0)
    try:
        return json.loads(s)
    except Exception:
        # try minor fixes (single quotes -> double)
        try:
            s2 = s.replace("'", '"')
            return json.loads(s2)
        except Exception:
            return {}

# -------------------------
# extract_fields_gemini
# -------------------------
def extract_fields_gemini(image_path: str):
    """
    Returns a dict of extracted fields using Gemini (if available).
    If Gemini not available, returns {}.
    """
    print("extract_fields_gemini: image_path =", image_path)
    if not GENAI_AVAILABLE or GENAI_CLIENT is None:
        print("extract_fields_gemini: GENAI not available — returning empty dict")
        return {}

    # read image bytes
    with open(image_path, "rb") as f:
        img_bytes = f.read()
    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    prompt = """
Return ONLY JSON with these fields:
{
 "name": "",
 "dob": "",
 "gender": "",
 "aadhaar": "",
 "address": "",
 "father_name": "",
 "extra": {}
}
Fill values from the document. Keep values as short strings.
"""

    try:
        stream = GENAI_CLIENT.models.generate_content_stream(
            model="gemini-2.0-flash",
            contents=[
                Part(text=prompt),
                Part(inline_data={"data": img_b64, "mime_type": "image/jpeg"})
            ],
        )
        output = ""
        for chunk in stream:
            if hasattr(chunk, "text"):
                output += chunk.text
        parsed = safe_json_extract(output)
        print("extract_fields_gemini: got parsed", parsed)
        return parsed
    except Exception as e:
        print("extract_fields_gemini: failed:", e)
        return {"error": str(e)}

# -------------------------
# check_authenticity
# -------------------------
def check_authenticity(image_path: str):
    """
    Returns a dict like {"authenticity_score": int, "verdict": str, "issues": [...]}
    Uses Gemini if available, else returns {}.
    """
    print("check_authenticity: image_path =", image_path)
    if not GENAI_AVAILABLE or GENAI_CLIENT is None:
        print("check_authenticity: GENAI not available — returning empty dict")
        return {}

    with open(image_path, "rb") as f:
        img_bytes = f.read()
    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    prompt = """
Return ONLY JSON:
{
  "authenticity_score": 0,
  "verdict": "",
  "issues": []
}
Provide a score 0-100 about how likely the document is genuine and list any issues found.
"""

    try:
        stream = GENAI_CLIENT.models.generate_content_stream(
            model="gemini-2.0-flash",
            contents=[
                Part(text=prompt),
                Part(inline_data={"data": img_b64, "mime_type": "image/jpeg"})
            ],
        )
        output = ""
        for chunk in stream:
            if hasattr(chunk, "text"):
                output += chunk.text
        parsed = safe_json_extract(output)
        print("check_authenticity: parsed", parsed)
        return parsed
    except Exception as e:
        print("check_authenticity: failed:", e)
        return {"error": str(e)}

# -------------------------
# extract_face
# -------------------------
def extract_face(image_path: str):
    """
    Attempts to extract a face from the image and writes a JPEG to temp dir.
    Returns filepath or None on failure.
    """
    print("extract_face: image_path =", image_path)
    if not CV2_AVAILABLE:
        print("extract_face: OpenCV not installed")
        return None

    img = cv2.imread(image_path)
    if img is None:
        print("extract_face: image read returned None")
        return None

    h, w = img.shape[:2]

    # try MediaPipe if available
    try:
        import mediapipe as mp
        mpfd = mp.solutions.face_detection
        with mpfd.FaceDetection(model_selection=0, min_detection_confidence=0.5) as fd:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            result = fd.process(rgb)
            if result.detections:
                det = result.detections[0]
                box = det.location_data.relative_bounding_box
                x = int(box.xmin * w)
                y = int(box.ymin * h)
                bw = int(box.width * w)
                bh = int(box.height * h)

                pad_x = int(bw * 0.25)
                pad_y = int(bh * 0.28)

                x1 = max(0, x - pad_x)
                y1 = max(0, y - pad_y)
                x2 = min(w, x + bw + pad_x)
                y2 = min(h, y + bh + pad_y)

                face = img[y1:y2, x1:x2]
                if face.size > 0:
                    outp = Path(tempfile.gettempdir()) / f"face_{Path(image_path).stem}.jpg"
                    cv2.imwrite(str(outp), face)
                    print("extract_face: saved face via MediaPipe ->", outp)
                    return str(outp)
        print("extract_face: MediaPipe did not find face, falling back")
    except Exception as e:
        print("extract_face: MediaPipe error or not installed:", e)

    # Haar cascade fallback
    try:
        haar = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = haar.detectMultiScale(gray, 1.2, 5)
        if len(faces) == 0:
            print("extract_face: Haar found no faces")
            return None
        x, y, bw, bh = faces[0]
        face = img[y:y+bh, x:x+bw]
        outp = Path(tempfile.gettempdir()) / f"face_{Path(image_path).stem}.jpg"
        cv2.imwrite(str(outp), face)
        print("extract_face: saved face via Haar ->", outp)
        return str(outp)
    except Exception as e:
        print("extract_face: Haar fallback failed:", e)
        return None

# -------------------------
# create_pdf
# -------------------------
def create_pdf(details: dict, face_path: str = None, output: str = "output.pdf"):
    """
    Create a simple PDF summarizing the details and embedding the face image (if present).
    Writes output file to 'output' path. Uses reportlab.
    """
    print("create_pdf: output =", output)
    if not REPORTLAB_AVAILABLE:
        raise RuntimeError("reportlab not installed; cannot create PDF")

    c = canvas.Canvas(output, pagesize=A4)
    x = 70
    y = 450
    width = 480
    height = 250
    c.roundRect(x, y, width, height, 20)

    # Face
    if face_path and os.path.exists(face_path):
        try:
            c.drawImage(face_path, x + 20, y + height - 150, 120, 120, mask='auto')
        except Exception as e:
            print("create_pdf: drawImage failed:", e)

    text_x = x + 170
    text_y = y + height - 90

    c.setFont("Helvetica-Bold", 16)
    c.drawString(text_x, text_y, details.get("name", "") or "")

    c.setFont("Helvetica", 12)
    c.drawString(text_x, text_y - 25, f"DOB: {details.get('dob', '') or ''}")
    c.drawString(text_x, text_y - 45, f"Gender: {details.get('gender', '') or ''}")
    c.drawString(text_x, text_y - 65, f"Aadhaar: {details.get('aadhaar', '') or ''}")

    # Address block
    addr_y = y + 40
    c.setFont("Helvetica-Bold", 13)
    c.drawString(x + 25, addr_y, "Address:")

    address_text = details.get("address") or ""
    for i, ln in enumerate(wrap(address_text, 70)):
        c.drawString(x + 25, addr_y - 20 - i * 15, ln)

    # Footer: raw extra fields (pretty-printed)
    extra = details.get("extra") or {}
    try:
        c.setFont("Helvetica", 10)
        pp = json.dumps(extra, indent=2, ensure_ascii=False)
        lines = pp.splitlines()
        start_y = 80
        for i, ln in enumerate(lines[:10]):
            c.drawString(70, start_y - i * 12, ln[:100])
    except Exception:
        pass

    c.save()
    print("create_pdf: written", output)
