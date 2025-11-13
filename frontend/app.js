// frontend/app.js (module)
// Note: this file uses Web3.Storage via dynamic import when needed to avoid extra CDNs.
// It uses native Web Crypto (Subtle) for AES-GCM encryption.

const short = (a) => a ? `${a.slice(0,6)}...${a.slice(-4)}` : '';

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

let CONTRACT_ADDRESS = null;
let CONTRACT_ABI = null;

async function loadContractFiles(){
  try {
    const addrResp = await fetch('./contract/VaultRegistry-address.json');
    const abiResp = await fetch('./contract/VaultRegistry-abi.json');
    if(!addrResp.ok || !abiResp.ok) {
      statusEl.textContent = 'Contract files not found under frontend/contract. Please add ABI + address.';
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

// provider/signer/contract
let provider, signer, contract;

async function connectWallet(){
  if(!window.ethereum) {
    alert('Install MetaMask to use this demo');
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  const address = await signer.getAddress();
  addrEl.textContent = `Connected: ${short(address)}`;
  connectBtn.textContent = 'Connected';
  connectBtn.disabled = true;

  const net = await provider.getNetwork();
  networkEl.textContent = `Network: ${net.name} (${net.chainId})`;

  // If not on Amoy and not local, try to add Amoy (user may decline)
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
    } catch(_) {
      console.warn('User declined add chain or error');
    }
  }

  if(!CONTRACT_ADDRESS || !CONTRACT_ABI) {
    statusEl.textContent = 'Contract files missing in frontend/contract. Add them and reload.';
    return;
  }

  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  uploadSection.classList.remove('hidden');
  vaultsSection.classList.remove('hidden');
  accessSection.classList.remove('hidden');

  await refreshVaults();
}

connectBtn.addEventListener('click', connectWallet);

// ---------- Crypto helpers (AES-GCM, password-based)
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

// ---------- IPFS (Web3.Storage) dynamic import when needed
async function uploadToWeb3Storage(token, blob) {
  // dynamic import to avoid bundling issues
  const { Web3Storage } = await import('https://cdn.jsdelivr.net/npm/web3.storage/dist/bundle.esm.min.js');
  const client = new Web3Storage({ token });
  const cid = await client.put([new File([blob], 'encrypted.bin')], { wrapWithDirectory: false });
  return cid;
}

// ---------- Upload flow
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  const token = web3TokenInput.value.trim();
  if(!file) { statusEl.textContent = 'Pick a file first'; return; }
  if(!token) { statusEl.textContent = 'Enter Web3.Storage API token'; return; }

  try {
    statusEl.textContent = 'Choose passphrase to encrypt (remember it!)';
    const pass = prompt('Enter passphrase to encrypt the file (keep safe):', 'vault-pass');
    if(!pass) { statusEl.textContent = 'Encryption cancelled'; return; }

    statusEl.textContent = 'Encrypting file locally...';
    const encrypted = await encryptFileBlob(file, pass);

    statusEl.textContent = 'Uploading encrypted file to Web3.Storage...';
    const cid = await uploadToWeb3Storage(token, encrypted);

    statusEl.textContent = `Uploaded CID ${cid} — sending store tx...`;
    const tx = await contract.store(cid);
    statusEl.textContent = 'Waiting for confirmation...';
    await tx.wait();
    statusEl.textContent = `Stored on-chain. Tx ${tx.hash}`;
    await refreshVaults();
  } catch(e){
    console.error(e);
    statusEl.textContent = 'Error: ' + (e.message || e);
  }
});

// ---------- UI: list vaults and download
async function refreshVaults(){
  vaultList.innerHTML = '';
  try {
    const address = await signer.getAddress();
    const ids = await contract.vaultsOfOwner(address);
    if(!ids || ids.length === 0){
      vaultList.innerHTML = '<div class="muted">No vaults found.</div>';
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
      vaultList.appendChild(div);
    }

    // attach download handlers
    document.querySelectorAll('.downloadBtn').forEach(btn=>{
      btn.addEventListener('click', async (ev)=>{
        const id = ev.currentTarget.getAttribute('data-id');
        let cid;
        try {
          cid = await contract.getCid(id);
        } catch(e2){ alert('No access to read CID'); return; }
        const token = web3TokenInput.value.trim();
        if(!token){ alert('Enter Web3.Storage token to fetch file'); return; }
        statusEl.textContent = 'Fetching encrypted file from IPFS...';
        const url = `https://${cid}.ipfs.dweb.link/encrypted.bin`;
        const resp = await fetch(url);
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
  const id = vaultIdInput.value.trim();
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
  const id = vaultIdInput.value.trim();
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
