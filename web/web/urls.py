# web/web/urls.py
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('', include('vaultui.urls')),
    # path('admin/', admin.site.urls),  # optional
]
