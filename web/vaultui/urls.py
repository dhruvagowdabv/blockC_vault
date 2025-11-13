# web/vaultui/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('api/contract/', views.contract_info, name='contract_info'),
    path('api/upload/', views.upload_proxy, name='upload_proxy'),
]
