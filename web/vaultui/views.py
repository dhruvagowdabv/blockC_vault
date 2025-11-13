# web/vaultui/views.py
from django.shortcuts import render
from django.http import JsonResponse, HttpResponseBadRequest, HttpResponse
import os
import requests
from django.views.decorators.csrf import csrf_exempt
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

def index(request):
    return render(request, 'index.html')

def contract_info(request):
    abi_path = BASE_DIR / 'vaultui' / 'static' / 'contract' / 'VaultRegistry-abi.json'
    addr_path = BASE_DIR / 'vaultui' / 'static' / 'contract' / 'VaultRegistry-address.json'
    try:
        with open(abi_path, 'r', encoding='utf-8') as f:
            abi = f.read()
        with open(addr_path, 'r', encoding='utf-8') as f:
            addr = f.read()
        return JsonResponse({"abi": abi, "address": addr})
    except Exception as e:
        return HttpResponseBadRequest(str(e))

@csrf_exempt
def upload_proxy(request):
    # accepts POST with form-data file field 'file' OR raw body
    if request.method != 'POST':
        return HttpResponseBadRequest('Use POST with file body or form-data (file)')
    token = os.environ.get('WEB3STORAGE_TOKEN')
    if not token:
        return HttpResponseBadRequest('Server missing WEB3STORAGE_TOKEN in environment')
    # get bytes
    if request.FILES.get('file'):
        file_bytes = request.FILES['file'].read()
    else:
        file_bytes = request.body
    try:
        headers = {'Authorization': f'Bearer {token}'}
        files = {'file': ('encrypted.bin', file_bytes)}
        r = requests.post('https://api.web3.storage/upload', headers=headers, files=files, timeout=120)
        r.raise_for_status()
        return JsonResponse(r.json())
    except Exception as e:
        return HttpResponseBadRequest(str(e))
