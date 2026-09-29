# ---- 1. build the web app
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. API + static files (one service serves both)
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PAYPREDICT_STORAGE=/tmp/paypredict
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ server/
COPY data/ data/
COPY --from=web /web/dist web/dist
EXPOSE 8000
# --proxy-headers: behind Render's HTTPS proxy, so links sent to customers use https://
CMD ["sh", "-c", "uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
