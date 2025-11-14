// frontend/app.js (module)
// Clean merged file: single declarations + robust connect handler

console.log('app.js loaded at', location.href);

// ---------- helpers
const short = (a) => a ? `${a.slice(0,6)}...${a.slice(-4)}` : '';

// ---------- DOM elements (single declaration)
const connectBtn = document.getElementById('connectBtn');
const addrEl = document.getElementById('addr');
const networkEl = document.getElementById('network');
const uploadSection = document.getElementById('uploadSection');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const statusEl = document.getElementById('status');
const web3TokenInput = document.getElementById('web3Token');

const vaultsSection = document.getElementById('vaultsSection');
const vaultList = document.getElementById('vaultList');

const accessSection = document.getElementById('accessSection');
const vaultIdInput = document.getElementById('vaultIdInput');
const addrInput = document.getElementById('addrInput');
const grantBtn = document.getElementById('grantBtn');
const revokeBtn = document.getElementById('revokeBtn');
const accessStatus = document.getElementById('accessStatus');

// ---------- contract state
let CONTRACT_ADDRESS = null;
let CONTRACT_ABI = null;
let provider, signer, contract;
let connectPending = false;

// ---------- load contract files
async function loadContractFiles(){
  try {
    // adapt path depending on where static is served
    const addrResp = await fetch('/static/contract/VaultRegistry-address.json');
    const abiResp = await fetch('/static/contract/VaultRegistry-abi.json');
    if(!addrResp.ok || !abiResp.ok) {
      statusEl && (statusEl.textContent = 'Contract files not found in static/contract. Please add ABI + address.');
      return;
    }
    const addrJson = await addrResp.json();
    CONTRACT_ADDRESS = addrJson.VaultRegistry || addrJson.address || addrJson.contractAddress || Object.values(addrJson)[0];
    CONTRACT_ABI = await abiResp.json();
    console.log('Loaded contract address', CONTRACT_ADDRESS);
  } catch(e){
    console.error('Failed to load contract files', e);
    statusEl && (statusEl.textContent = 'Failed loading contract files: ' + (e.message || e));
  }
}

// ---------- robust connect handler (uses provider.send)
async function robustConnectWallet(){
  console.log('robustConnectWallet start');
  if(!window.ethereum) {
    alert('MetaMask not detected. Install MetaMask and reload the page.');
    return;
  }
  if (connectPending) {
    console.log('connect request already pending');
    statusEl && (statusEl.textContent = 'Connection request already pending — check MetaMask.');
    return;
  }
  connectPending = true;
  if (connectBtn) { connectBtn.disabled = true; connectBtn.textContent = 'Connecting...'; }
  statusEl && (statusEl.textContent = 'Requesting wallet connection...');

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    console.log('provider created — sending eth_requestAccounts');
    await provider.send('eth_requestAccounts', []); // the working call
    console.log('eth_requestAccounts resolved');

    signer = provider.getSigner();
    const address = await signer.getAddress();
    addrEl && (addrEl.textContent = `Connected: ${short(address)}`);
    if (connectBtn) { connectBtn.textContent = 'Connected'; connectBtn.disabled = true; }
    const net = await provider.getNetwork();
    networkEl && (networkEl.textContent = `Network: ${net.name} (${net.chainId})`);

    // optional: try to add Polygon Amoy if not present
    if(net.chainId !== 80002 && net.chainId !== 31337 && net.chainId !== 1337) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x13882',
            chainName: 'Polygon Amoy',
            rpcUrls: ['https://rpc-amoy.polygon.technology/'],
            nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
            blockExplorerUrls: ['https://amoy.polygonscan.com']
          }]
        });
      } catch(e) { console.warn('User declined chain add/switch', e); }
    }

    if(!CONTRACT_ADDRESS || !CONTRACT_ABI) {
      statusEl && (statusEl.textContent = 'Contract files missing; add ABI + address then reload.');
    } else {
      contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      uploadSection && uploadSection.classList.remove('hidden');
      vaultsSection && vaultsSection.classList.remove('hidden');
      accessSection && accessSection.classList.remove('hidden');
      const saved = localStorage.getItem('web3storage_token_v1');
      if (saved && web3TokenInput && !web3TokenInput.value) web3TokenInput.value = saved;
      await refreshVaults();
      statusEl && (statusEl.textContent = 'Connected');
    }
  } catch (err) {
    console.error('connect error', err);
    if (err && err.code === -32002) {
      statusEl && (statusEl.textContent = 'MetaMask request pending — please check the extension popup and approve.');
    } else {
      statusEl && (statusEl.textContent = 'Connection failed: ' + (err.message || err));
      alert('Connection failed or was rejected. Check MetaMask.');
    }
    if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Connect Wallet'; }
  } finally {
    connectPending = false;
  }
}

// attach listener (direct + delegated fallback)
if (connectBtn) {
  console.log('connectBtn found, attaching listener');
  connectBtn.addEventListener('click', async (ev) => {
    console.log('connectBtn clicked');
    await robustConnectWallet();
  });
} else {
  console.warn('connectBtn not found — attaching delegated listener');
  document.addEventListener('click', async (ev) => {
    if (ev.target && (ev.target.id === 'connectBtn' || (ev.target.closest && ev.target.closest('#connectBtn')))) {
      console.log('delegated connectBtn clicked');
      await robustConnectWallet();
    }
  });
}

// ---------- encryption helpers (unchanged)
async function deriveKeyFromPassword(password) {
  const enc = new TextEncoder();
  const pw = enc.encode(password);
  const baseKey = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new Uint8Array(16),
    iterations: 100000
  }, baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt','decrypt']);
}

async function encryptFileBlob(fileBlob, password) {
  const key = await deriveKeyFromPassword(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await fileBlob.arrayBuffer();
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  const out = new Uint8Array(iv.byteLength + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.byteLength);
  return new Blob([out]);
}

async function decryptBlobToFile(blob, password, filename='file') {
  const key = await deriveKeyFromPassword(password);
  const raw = new Uint8Array(await blob.arrayBuffer());
  const iv = raw.slice(0,12);
  const cipher = raw.slice(12);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, key, cipher);
  return new File([plain], filename);
}

// ---------- Web3.Storage dynamic import (unchanged)
async function uploadToWeb3Storage(token, blob) {
  const { Web3Storage } = await import('https://cdn.jsdelivr.net/npm/web3.storage/dist/bundle.esm.min.js');
  const client = new Web3Storage({ token });
  const cid = await client.put([new File([blob], 'encrypted.bin')], { wrapWithDirectory: false });
  return cid;
}

// ---------- Upload flow (modify if you use server proxy)
uploadBtn && uploadBtn.addEventListener('click', async () => {
  const file = fileInput?.files?.[0];
  const token = web3TokenInput?.value?.trim();
  if(!file) { statusEl && (statusEl.textContent = 'Pick a file first'); return; }
  if(!token) { statusEl && (statusEl.textContent = 'Enter Web3.Storage API token'); return; }

  try {
    statusEl && (statusEl.textContent = 'Choose passphrase to encrypt (remember it!)');
    const pass = prompt('Enter passphrase to encrypt the file (keep safe):', 'vault-pass');
    if(!pass) { statusEl && (statusEl.textContent = 'Encryption cancelled'); return; }

    statusEl && (statusEl.textContent = 'Encrypting file locally...');
    const encrypted = await encryptFileBlob(file, pass);

    statusEl && (statusEl.textContent = 'Uploading encrypted file to Web3.Storage...');
    const cid = await uploadToWeb3Storage(token, encrypted);

    statusEl && (statusEl.textContent = `Uploaded CID ${cid} — sending store tx...`);
    const tx = await contract.store(cid);
    statusEl && (statusEl.textContent = 'Waiting for confirmation...');
    await tx.wait();
    statusEl && (statusEl.textContent = `Stored on-chain. Tx ${tx.hash}`);
    await refreshVaults();
  } catch(e){
    console.error(e);
    statusEl && (statusEl.textContent = 'Error: ' + (e.message || e));
  }
});

// ---------- Vaults listing and download (unchanged)
async function refreshVaults(){
  vaultList && (vaultList.innerHTML = '');
  try {
    if(!signer || !contract) { vaultList && (vaultList.innerHTML = '<div class="muted">Connect first.</div>'); return; }
    const address = await signer.getAddress();
    const ids = await contract.vaultsOfOwner(address);
    if(!ids || ids.length === 0){
      vaultList && (vaultList.innerHTML = '<div class="muted">No vaults found.</div>');
      return;
    }
    for(let i=0;i<ids.length;i++){
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
      vaultList && vaultList.appendChild(div);
    }

    // attach download handlers
    document.querySelectorAll('.downloadBtn').forEach(btn=>{
      btn.addEventListener('click', async (ev)=>{
        const id = ev.currentTarget.getAttribute('data-id');
        let cid;
        try {
          cid = await contract.getCid(id);
        } catch(e2){ alert('No access to read CID'); return; }
        const token = web3TokenInput?.value?.trim();
        if(!token){ alert('Enter Web3.Storage token to fetch file'); return; }
        statusEl && (statusEl.textContent = 'Fetching encrypted file from IPFS...');
        const url = `https://${cid}.ipfs.dweb.link/encrypted.bin`;
        const resp = await fetch(url);
        if(!resp.ok){ alert('Failed to fetch from public gateways.'); return; }
        const blob = await resp.blob();
        const pass = prompt('Enter passphrase to decrypt file:');
        if(!pass){ statusEl && (statusEl.textContent='Decryption cancelled'); return; }
        try {
          const file = await decryptBlobToFile(blob, pass, `vault-${id}-download`);
          const urlObj = URL.createObjectURL(file);
          const a = document.createElement('a'); a.href = urlObj; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
          statusEl && (statusEl.textContent = 'Downloaded and decrypted locally.');
        } catch(e){
          console.error(e);
          statusEl && (statusEl.textContent = 'Decryption failed: wrong passphrase or corrupted file');
        }
      });
    });

  } catch(e){
    console.error(e);
    vaultList && (vaultList.innerHTML = '<div class="muted">Error fetching vaults; are you connected?</div>');
  }
}

// Grant / revoke handlers (unchanged)
grantBtn && grantBtn.addEventListener('click', async ()=>{
  const id = vaultIdInput?.value?.trim();
  const who = addrInput?.value?.trim();
  if(!id || !who) { accessStatus && (accessStatus.textContent = 'fill vault id and address'); return; }
  try {
    const tx = await contract.grantAccess(id, who);
    accessStatus && (accessStatus.textContent = 'tx sent, waiting...');
    await tx.wait();
    accessStatus && (accessStatus.textContent = 'Access granted.');
  } catch(e){ accessStatus && (accessStatus.textContent = 'Error: ' + (e.message || e)); console.error(e); }
});

revokeBtn && revokeBtn.addEventListener('click', async ()=>{
  const id = vaultIdInput?.value?.trim();
  const who = addrInput?.value?.trim();
  if(!id || !who) { accessStatus && (accessStatus.textContent = 'fill vault id and address'); return; }
  try {
    const tx = await contract.revokeAccess(id, who);
    accessStatus && (accessStatus.textContent = 'tx sent, waiting...');
    await tx.wait();
    accessStatus && (accessStatus.textContent = 'Access revoked.');
  } catch(e){ accessStatus && (accessStatus.textContent = 'Error: ' + (e.message || e)); console.error(e); }
});

// load contract files on start
await loadContractFiles();
