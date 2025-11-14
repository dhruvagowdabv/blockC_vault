# web/vaultui/urls.py
from django.urls import path
# from .views_api import upload_to_web3storage
from . import views
from . import views_api


urlpatterns = [
    path("", views.index, name="index"),
    # path("api/upload/", upload_to_web3storage, name="api_upload"),
    path('api/upload/', views_api.upload_to_nftstorage, name='api-upload'),
    # path('api/upload/', views_api.upload_proxy, name='api-upload'),
]
