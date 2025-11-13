// web/vaultui/static/js/app.js (module)
// Adapted to use Django static + upload proxy

const short = (a) => a ? `${a.slice(0,6)}...${a.slice(-4)}` : '';

const connectBtn = document.getElementById('connectBtn');
const addrEl = document.getElementById('addr');
const networkEl = document.getElementById('network');
const uploadSection = document.getElementById('uploadSection');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const statusEl = document.getElementById('status');
const web3TokenInput = document.getElementById('web3Token');
const rememberCheckbox = document.getElementById('rememberToken');

const vaultsSection = document.getElementById('vaultsSection');
const vaultList = document.getElementById('vaultList');

const accessSection = document.getElementById('accessSection');
const vaultSelect = document.getElementById('vaultSelect');
const addrInput = document.getElementById('addrInput');
const grantBtn = document.getElementById('grantBtn');
const revokeBtn = document.getElementById('revokeBtn');
const accessStatus = document.getElementById('accessStatus');

let CONTRACT_ADDRESS = null;
let CONTRACT_ABI = null;

async function loadContractFiles(){
  try {
    // These paths are static files served by Django under /static/
    const addrResp = await fetch('/static/contract/VaultRegistry-address.json');
    const abiResp = await fetch('/static/contract/VaultRegistry-abi.json');
    if(!addrResp.ok || !abiResp.ok) {
      statusEl.textContent = 'Contract files not found in static/contract. Please add ABI + address.';
      return;
    }
    const addrJson = await addrResp.json();
    CONTRACT_ADDRESS = addrJson.VaultRegistry;
    CONTRACT_ABI = await abiResp.json();
    console.log('Loaded contract address', CONTRACT_ADDRESS);
  } catch(e){
    console.error('Failed to load contract files', e);
    statusEl.textContent = 'Failed loading contract files: ' + (e.message || e);
  }
}

let provider, signer, contract;
let connectPending = false;

async function connectWallet(){
  if(!window.ethereum) {
    alert('Install MetaMask to use this demo');
    return;
  }
  if (connectPending) {
    statusEl.textContent = 'Connection request already pending — check MetaMask.';
    return;
  }
  connectPending = true;
  connectBtn.disabled = true;
  statusEl.textContent = 'Requesting wallet connection...';
  try {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    const address = await signer.getAddress();
    addrEl.textContent = `Connected: ${short(address)}`;
    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;
    const net = await provider.getNetwork();
    networkEl.textContent = `Network: ${net.name} (${net.chainId})`;
    if(!CONTRACT_ADDRESS || !CONTRACT_ABI) {
      statusEl.textContent = 'Contract files missing; add ABI + address then reload.';
      connectPending = false;
      return;
    }
    contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    uploadSection.classList.remove('hidden');
    vaultsSection.classList.remove('hidden');
    accessSection.classList.remove('hidden');
    // load saved token if present
    const saved = localStorage.getItem('web3storage_token_v1');
    if (saved && !web3TokenInput.value) web3TokenInput.value = saved;
    await refreshVaults();
    statusEl.textContent = 'Connected';
  } catch (err) {
    console.error('connectWallet error', err);
    if (err && err.code === -32002) {
      statusEl.textContent = 'MetaMask request pending — please check the extension popup and approve.';
    } else {
      statusEl.textContent = 'Connection failed: ' + (err.message || err);
    }
    connectBtn.disabled = false;
  } finally {
    connectPending = false;
  }
}
connectBtn.addEventListener('click', connectWallet);

// ---------- encryption helpers (salt+iv+cipher)
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const pwKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name:'PBKDF2',
    salt,
    iterations: 150000,
    hash: 'SHA-256'
  }, pwKey, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
}

async function encryptFileWithSalt(file, password) {
  const arrayBuffer = await file.arrayBuffer();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, arrayBuffer);
  const cipherBytes = new Uint8Array(cipher);
  const out = new Uint8Array(salt.byteLength + iv.byteLength + cipherBytes.byteLength);
  out.set(salt, 0);
  out.set(iv, salt.byteLength);
  out.set(cipherBytes, salt.byteLength + iv.byteLength);
  return new Blob([out]);
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

// ---------- Upload to server proxy (Django)
async function uploadToServerProxy(blob) {
  const form = new FormData();
  form.append('file', blob, 'encrypted.bin');
  const resp = await fetch('/api/upload/', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(await resp.text());
  const body = await resp.json();
  return body.cid || body.value?.cid || (Array.isArray(body) && body[0]?.cid) || null;
}

// ---------- Upload handler
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  const token = web3TokenInput.value.trim();
  if(!file) { statusEl.textContent = 'Pick a file first'; return; }

  // optionally save token locally
  if (rememberCheckbox && rememberCheckbox.checked && token) {
    localStorage.setItem('web3storage_token_v1', token);
  }

  try {
    const pass = prompt('Enter a passphrase to encrypt the file (remember it):', '');
    if (!pass) { statusEl.textContent = 'Encryption cancelled'; return; }

    statusEl.textContent = 'Encrypting file (client-side)...';
    const encrypted = await encryptFileWithSalt(file, pass);

    statusEl.textContent = 'Uploading encrypted file to server proxy...';
    // if you want to use client Web3.Storage directly, you can pass token and call Web3.Storage
    const cid = await uploadToServerProxy(encrypted);
    if (!cid) throw new Error('No CID returned from proxy');

    statusEl.textContent = `Uploaded CID ${cid} — storing on chain...`;
    const tx = await contract.store(cid);
    const receipt = await tx.wait();

    // parse Stored event for vaultId
    let newVaultId = null;
    if (receipt && receipt.events) {
      for (const ev of receipt.events) {
        if (ev.event === 'Stored') {
          newVaultId = ev.args ? ev.args.vaultId?.toString() || ev.args[0]?.toString() : null;
          break;
        }
      }
    }
    if (!newVaultId && receipt && receipt.logs) {
      const storedSig = ethers.utils.id("Stored(uint256,string,address)");
      const iface = new ethers.utils.Interface(CONTRACT_ABI);
      for (const log of receipt.logs) {
        if (log.topics && log.topics[0] === storedSig) {
          try {
            const parsed = iface.parseLog(log);
            newVaultId = parsed.args.vaultId.toString();
            break;
          } catch(e){}
        }
      }
    }

    if (newVaultId) {
      statusEl.textContent = `Stored as vault #${newVaultId}. Refreshing list...`;
    } else {
      statusEl.textContent = `Stored (tx ${tx.hash}). Refreshing list...`;
    }
    await refreshVaults();
  } catch(e){
    console.error(e);
    statusEl.textContent = 'Error: ' + (e.message || e);
  }
});

// ---------- refreshVaults + UI code (same behavior as before)
async function refreshVaults(){
  vaultList.innerHTML = '';
  try {
    const address = await signer.getAddress();
    const ids = await contract.vaultsOfOwner(address);

    // populate select
    if (vaultSelect) {
      vaultSelect.innerHTML = '<option value="">Select vault</option>';
    }

    if(!ids || ids.length === 0){
      vaultList.innerHTML = '<div class="muted">No vaults found.</div>';
      return;
    }
    for (let i=0;i<ids.length;i++){
      const id = ids[i].toString();
      const info = await contract.getVaultInfo(id);
      let cid = '[locked]';
      try { cid = await contract.getCid(id); } catch(e){ /* no read access */ }

      const div = document.createElement('div');
      div.className = 'vault';
      div.innerHTML = `
        <div class="row"><strong>Vault #${id}</strong> &nbsp;<span class="muted">created: ${new Date(info.createdAt*1000).toLocaleString()}</span></div>
        <div>CID: <span class="addrShort">${cid}</span></div>
        <div class="row"><button data-id="${id}" class="downloadBtn">Download & Decrypt</button></div>
      `;
      vaultList.appendChild(div);

      if (vaultSelect) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `#${id} ${cid === '[locked]' ? '(locked)' : cid}`;
        vaultSelect.appendChild(opt);
      }
    }

    document.querySelectorAll('.downloadBtn').forEach(btn=>{
      btn.addEventListener('click', async (ev)=>{
        const id = ev.currentTarget.getAttribute('data-id');
        let cid;
        try {
          cid = await contract.getCid(id);
        } catch(e2){ alert('No access to read CID'); return; }
        statusEl.textContent = 'Fetching encrypted file from IPFS via gateway...';
        // try gateway direct
        const url = `https://${cid}.ipfs.dweb.link/encrypted.bin`;
        let resp = await fetch(url);
        if (!resp.ok) {
          // try nftstorage gateway
          resp = await fetch(`https://${cid}.ipfs.nftstorage.link/encrypted.bin`);
        }
        if (!resp.ok) {
          alert('Failed to fetch from public gateways. Consider using server proxy.');
          return;
        }
        const blob = await resp.blob();
        const pass = prompt('Enter passphrase to decrypt file:');
        if(!pass){ statusEl.textContent='Decryption cancelled'; return; }
        try {
          const file = await decryptBlobToFile(blob, pass, `vault-${id}-download`);
          const urlObj = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = urlObj; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
          statusEl.textContent = 'Downloaded and decrypted locally.';
        } catch(e){
          console.error(e);
          statusEl.textContent = 'Decryption failed: wrong passphrase or corrupted file';
        }
      });
    });

  } catch(e){
    console.error(e);
    vaultList.innerHTML = '<div class="muted">Error fetching vaults; are you connected?</div>';
  }
}

// Grant / revoke handlers
grantBtn.addEventListener('click', async ()=>{
  const id = vaultSelect.value;
  const who = addrInput.value.trim();
  if(!id || !who) { accessStatus.textContent = 'fill vault id and address'; return; }
  try {
    const tx = await contract.grantAccess(id, who);
    accessStatus.textContent = 'tx sent, waiting...';
    await tx.wait();
    accessStatus.textContent = 'Access granted.';
  } catch(e){ accessStatus.textContent = 'Error: ' + (e.message || e); console.error(e); }
});

revokeBtn.addEventListener('click', async ()=>{
  const id = vaultSelect.value;
  const who = addrInput.value.trim();
  if(!id || !who) { accessStatus.textContent = 'fill vault id and address'; return; }
  try {
    const tx = await contract.revokeAccess(id, who);
    accessStatus.textContent = 'tx sent, waiting...';
    await tx.wait();
    accessStatus.textContent = 'Access revoked.';
  } catch(e){ accessStatus.textContent = 'Error: ' + (e.message || e); console.error(e); }
});

// load contract files on start
await loadContractFiles();
