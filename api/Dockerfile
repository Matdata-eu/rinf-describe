FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
# Built from the repository root (docker-compose.yml): the shapes come along for the pages.
COPY api/requirements.txt requirements.txt
RUN pip install -r requirements.txt
COPY api/app /app/app
COPY shapes /app/shapes
ENV DESCRIBE_SHAPES=/app/shapes
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]
