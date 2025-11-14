/* web/vaultui/static/js/app-main.js
   Encrypt file (AES-GCM PBKDF2), upload to Django proxy, then store CID on-chain.
   Expects window.DEVID to be set by the connect logic (provider, signer, contract).
*/
(function(){
  const short = (a) => a ? `${a.slice(0,6)}...${a.slice(-4)}` : '';
  const connectBtn = document.getElementById('connectBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  const statusEl = document.getElementById('status');
  const vaultList = document.getElementById('vaultList');
  const vaultIdInput = document.getElementById('vaultIdInput');
  const addrInput = document.getElementById('addrInput');
  const grantBtn = document.getElementById('grantBtn');
  const revokeBtn = document.getElementById('revokeBtn');
  const accessStatus = document.getElementById('accessStatus');

  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({
      name: 'PBKDF2',
      salt,
      iterations: 150000,
      hash: 'SHA-256'
    }, baseKey, { name: 'AES-GCM', length: 256}, true, ['encrypt','decrypt']);
  }

  async function encryptFileBlob(file, password) {
    const data = await file.arrayBuffer();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, data);
    const cbytes = new Uint8Array(cipher);
    const out = new Uint8Array(16 + 12 + cbytes.byteLength);
    out.set(salt, 0);
    out.set(iv, 16);
    out.set(cbytes, 28);
    return new Blob([out], { type: 'application/octet-stream' });
  }

  async function decryptBlobToFile(blob, password, filename='file') {
    const raw = new Uint8Array(await blob.arrayBuffer());
    const salt = raw.slice(0,16);
    const iv = raw.slice(16,28);
    const cipher = raw.slice(28);
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, cipher);
    return new File([plain], filename);
  }

  async function uploadToServerProxy(blob, filename='encrypted.bin') {
    const fd = new FormData();
    fd.append('file', blob, filename);
    const resp = await fetch('/api/upload/', { method: 'POST', body: fd });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Upload failed: ${resp.status} ${txt}`);
    }
    const body = await resp.json();
    if (!body.cid) throw new Error('No CID returned from server');
    return body.cid;
  }

  function parseVaultIdFromReceipt(receipt, iface) {
    try {
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === 'Stored') return parsed.args.vaultId?.toString();
        } catch(e){}
      }
    } catch(e){}
    return null;
  }

  // upload handler
  uploadBtn && uploadBtn.addEventListener('click', async () => {
    if (!window.DEVID || !window.DEVID.contract) {
      alert('Connect wallet first');
      return;
    }
    const file = fileInput.files[0];
    if (!file) { statusEl.textContent = 'Pick a file first'; return; }

    try {
      const pass = prompt('Enter a passphrase to encrypt the file (remember it!)');
      if (!pass) { statusEl.textContent = 'Encryption cancelled'; return; }

      uploadBtn.disabled = true;
      statusEl.textContent = 'Encrypting file locally...';
      const encrypted = await encryptFileBlob(file, pass);

      statusEl.textContent = 'Uploading encrypted file to server...';
      const cid = await uploadToServerProxy(encrypted, `${file.name}.encrypted`);

      statusEl.textContent = `Uploaded to IPFS: ${cid}. Storing on-chain...`;

      const contract = window.DEVID.contract;
      const tx = await contract.store(cid);
      statusEl.textContent = `Tx submitted ${tx.hash}, waiting...`;
      const receipt = await tx.wait();

      const iface = contract.interface;
      const vaultId = parseVaultIdFromReceipt(receipt, iface);
      if (vaultId) statusEl.textContent = `Stored as vault #${vaultId}`;
      else statusEl.textContent = `Stored on-chain. Tx ${tx.hash}`;

      // refresh list
      await refreshVaults();
    } catch(e) {
      console.error(e);
      statusEl.textContent = 'Error: ' + (e.message || e);
    } finally {
      uploadBtn.disabled = false;
    }
  });

  async function refreshVaults(){
    if (!window.DEVID || !window.DEVID.contract || !window.DEVID.connectedAddress) return;
    vaultList && (vaultList.innerHTML = '');
    try {
      const contract = window.DEVID.contract;
      const owner = window.DEVID.connectedAddress;
      const ids = await contract.vaultsOfOwner(owner);
      if (!ids || ids.length === 0) { vaultList && (vaultList.innerHTML = '<div class="muted">No vaults found.</div>'); return; }

      for (let i=0;i<ids.length;i++){
        const id = ids[i].toString();
        const info = await contract.getVaultInfo(id);
        let cid = '[locked]';
        try { cid = await contract.getCid(id); } catch(e){}
        const div = document.createElement('div');
        div.className = 'vault';
        div.innerHTML = `
          <div class="row"><strong>Vault #${id}</strong> <span class="muted" style="margin-left:8px">created: ${new Date(info.createdAt*1000).toLocaleString()}</span></div>
          <div>CID: <span class="addrShort monos">${cid}</span></div>
          <div class="row" style="margin-top:8px">
            <button data-id="${id}" class="btn downloadBtn">Download & Decrypt</button>
            <button data-cid="${cid}" class="btn copyCidBtn">Copy CID</button>
          </div>
        `;
        vaultList.appendChild(div);
      }

      document.querySelectorAll('.copyCidBtn').forEach(b=>{
        b.addEventListener('click', (e)=>{
          const c = e.currentTarget.getAttribute('data-cid');
          navigator.clipboard && navigator.clipboard.writeText(c);
          alert('CID copied');
        });
      });

      document.querySelectorAll('.downloadBtn').forEach(b=>{
        b.addEventListener('click', async (ev)=>{
          const id = ev.currentTarget.getAttribute('data-id');
          let cid;
          try {
            cid = await window.DEVID.contract.getCid(id);
          } catch(e){ alert('No access to read CID'); return; }
          const url = `https://${cid}.ipfs.dweb.link/encrypted.bin`;
          let resp = await fetch(url);
          if (!resp.ok) resp = await fetch(`https://${cid}.ipfs.nftstorage.link/encrypted.bin`);
          if (!resp.ok) { alert('Failed to fetch encrypted file from public gateways'); return; }
          const blob = await resp.blob();
          const pass = prompt('Enter passphrase to decrypt file:');
          if (!pass) return;
          try {
            const file = await decryptBlobToFile(blob, pass, `vault-${id}-download`);
            const urlObj = URL.createObjectURL(file);
            const a = document.createElement('a'); a.href = urlObj; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
            alert('Downloaded and decrypted locally');
          } catch(e) { console.error(e); alert('Decryption failed'); }
        });
      });

    } catch(e){
      console.error(e);
      vaultList && (vaultList.innerHTML = '<div class="muted">Error fetching vaults; are you connected?</div>');
    }
  }

  // init: poll for window.DEVID then refresh vaults
  (async function init(){
    for (let i=0;i<30;i++){
      if (window.DEVID && window.DEVID.contract) break;
      await new Promise(r=>setTimeout(r,200));
    }
    if (window.DEVID && window.DEVID.contract) await refreshVaults();
  })();

})();
