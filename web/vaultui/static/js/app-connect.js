// app-connect.js — lightweight module to reliably connect MetaMask and expose DEVID global
console.log('app-connect.js loaded', location.href);

import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js';

const connectBtn = document.getElementById('connectBtn');
const addrEl = document.getElementById('addr');
const networkEl = document.getElementById('network');
const statusEl = document.getElementById('status');

let provider, signer, contract;
let CONTRACT_ADDRESS = null;
let CONTRACT_ABI = null;

// load contract files (optional, main app may re-load)
async function loadContractFiles(){
  try {
    const addrResp = await fetch('/static/contract/VaultRegistry-address.json');
    const abiResp = await fetch('/static/contract/VaultRegistry-abi.json');
    if (addrResp.ok && abiResp.ok) {
      const addrJson = await addrResp.json();
      CONTRACT_ADDRESS = addrJson.VaultRegistry || addrJson.address || Object.values(addrJson)[0];
      CONTRACT_ABI = await abiResp.json();
      console.log('connect: loaded contract files', CONTRACT_ADDRESS);
    } else {
      console.warn('connect: contract files not found in static/contract');
    }
  } catch(e) {
    console.warn('connect: failed loading contract files', e);
  }
}

async function doConnect(){
  if (!window.ethereum) {
    alert('Install MetaMask to use this demo');
    return;
  }
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  statusEl && (statusEl.textContent = 'Requesting wallet connection...');
  try {
    provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    await provider.send('eth_requestAccounts', []);
    signer = provider.getSigner();
    const addr = await signer.getAddress();
    const net = await provider.getNetwork();
    addrEl && (addrEl.textContent = `Connected: ${addr.slice(0,6)}...${addr.slice(-4)}`);
    networkEl && (networkEl.textContent = `Network: ${net.name} (${net.chainId})`);
    statusEl && (statusEl.textContent = 'Connected');

    // instantiate contract if ABI + address exist
    if (CONTRACT_ADDRESS && CONTRACT_ABI) {
      contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    }

    // expose global DEVID for other modules
    window.DEVID = {
      provider, signer, contract, connectedAddress: addr, chainId: net.chainId
    };

    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;
    console.log('connect: done', window.DEVID);
  } catch (err) {
    console.error('connect failed', err);
    statusEl && (statusEl.textContent = 'Connection failed: ' + (err.message || err));
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Wallet';
  }
}

connectBtn && connectBtn.addEventListener('click', async () => {
  // load contract files first (non-blocking)
  await loadContractFiles();
  await doConnect();
});

// autoscan if already connected
(async function autoAttach() {
  await loadContractFiles();
  try {
    if (window.ethereum) {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        // already connected; initialize
        await doConnect();
      }
    }
  } catch(e){ /* ignore */ }
})();
