# web/vaultui/urls.py
from django.urls import path
from .views_api import upload_to_web3storage
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/upload/", upload_to_web3storage, name="api_upload"),
]
