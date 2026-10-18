FROM python:3.12-alpine
WORKDIR /app
COPY server/app.py /app/app.py
COPY web /app/web
ENV DATA_DIR=/data WEB_DIR=/app/web PORT=8000 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=3s CMD wget -qO- http://127.0.0.1:8000/api/health || exit 1
CMD ["python", "/app/app.py"]
