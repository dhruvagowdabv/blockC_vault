// web/vaultui/static/js/process.js
// Frontend integration for /api/process/ + preview + download + optional store-to-IPFS
// Assumes your template has the elements from the HTML snippet.

const byId = (id) => document.getElementById(id);

// DOM
const processSection = byId('processSection');
const processFileInput = byId('processFileInput');
const processBtn = byId('processBtn');
const processStatus = byId('processStatus');
const processPreview = byId('processPreview');
const extractedJson = byId('extractedJson');
const facePreview = byId('facePreview');
const authSummary = byId('authSummary');
const downloadPdfBtn = byId('downloadPdfBtn');
const storePdfBtn = byId('storePdfBtn');

let latestPdfBlob = null;
let latestResultJson = null;

// show section (you can modify logic: show only after wallet connect)
processSection.classList.remove('hidden');

function setStatus(msg, isError=false) {
  processStatus.textContent = msg;
  processStatus.style.color = isError ? '#ff9b9b' : '';
}

// Helper: download blob
function downloadBlob(blob, filename='document_processed.pdf') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// POST file to /api/process/
async function processFile(file) {
  const form = new FormData();
  form.append('file', file, file.name);

  const resp = await fetch('/api/process/', { method: 'POST', body: form });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Server ${resp.status}: ${txt}`);
  }
  // The endpoint returns PDF file. But we also want JSON preview.
  // Two scenarios:
  // 1) Server returns PDF (application/pdf) -> we fetch as blob and then try to fetch JSON preview separately (if server supports).
  // 2) If you prefer debug-first, you can add an alternate endpoint that returns JSON fields.
  const contentType = resp.headers.get('Content-Type') || '';
  const blob = await resp.blob();
  return { blob, contentType };
}

processBtn.addEventListener('click', async () => {
  const file = processFileInput.files[0];
  if (!file) { setStatus('Pick a file to process'); return; }

  processBtn.disabled = true;
  setStatus('Uploading & processing — this may take 5-20s depending on model/network...');

  try {
    const { blob, contentType } = await processFile(file);

    // Save PDF blob for download
    if (contentType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
      latestPdfBlob = blob;
      downloadPdfBtn.classList.remove('hidden');
      storePdfBtn.classList.remove('hidden');
      setStatus('Processing finished. PDF ready for download.');
    } else {
      // fallback: server may return JSON (debug mode)
      const txt = await blob.text();
      try {
        latestResultJson = JSON.parse(txt);
        extractedJson.textContent = JSON.stringify(latestResultJson, null, 2);
        processPreview.classList.remove('hidden');
        setStatus('Processing finished (debug JSON returned).');
      } catch(e) {
        setStatus('Processing finished (non-PDF response). See console.', true);
        console.error('Non-PDF response', txt);
      }
    }

    // Try to fetch JSON preview via the debug route: /api/process/json (optional)
    try {
      const jsonResp = await fetch('/api/process/?json=1', {
        method: 'POST',
        body: (() => { const f = new FormData(); f.append('file', file, file.name); return f; })()
      });
      if (jsonResp.ok) {
        const pj = await jsonResp.json();
        latestResultJson = pj;
        extractedJson.textContent = JSON.stringify(pj.details || pj, null, 2);
        if (pj.face_thumbnail_b64) {
          facePreview.innerHTML = `<img src="data:image/jpeg;base64,${pj.face_thumbnail_b64}" style="width:140px;height:140px;border-radius:6px;object-fit:cover" />`;
        } else {
          facePreview.innerHTML = '<span class="muted small">no face</span>';
        }
        authSummary.textContent = (pj.authenticity && pj.authenticity.verdict) ? pj.authenticity.verdict : '';
        processPreview.classList.remove('hidden');
      }
    } catch(e){
      // optional non-fatal
    }

  } catch (err) {
    console.error(err);
    setStatus('Error: ' + (err.message || err), true);
  } finally {
    processBtn.disabled = false;
  }
});

// download button
downloadPdfBtn.addEventListener('click', () => {
  if (!latestPdfBlob) { setStatus('No PDF available to download', true); return; }
  downloadBlob(latestPdfBlob, 'document_processed.pdf');
});

// store PDF button -> reuse existing server upload proxy at /api/upload/
storePdfBtn.addEventListener('click', async () => {
  if (!latestPdfBlob) { setStatus('No PDF to store', true); return; }
  setStatus('Uploading PDF to IPFS via server proxy...');
  try {
    const form = new FormData();
    form.append('file', latestPdfBlob, 'document_processed.pdf');
    const resp = await fetch('/api/upload/', { method: 'POST', body: form });
    const txt = await resp.text();
    if (!resp.ok) throw new Error(`Upload error ${resp.status}: ${txt}`);
    // try parse JSON
    const j = JSON.parse(txt);
    setStatus('Uploaded. CID: ' + (j.cid || JSON.stringify(j)));
  } catch (e) {
    console.error(e);
    setStatus('Upload failed: ' + (e.message || e), true);
  }
});
v