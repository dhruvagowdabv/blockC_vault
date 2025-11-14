# web/web/urls.py
from django.contrib import admin
# from . import views
# from .views_api import upload_to_web3storage
from django.urls import path, include

urlpatterns = [
    path('', include('vaultui.urls')),
    # path('api/upload/', upload_to_web3storage, name='api_upload'),
    # path('', views.index, name='index'),
    path('admin/', admin.site.urls),  # optional
]
