FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD python -m uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}
# updated Sun Nov  1 20:56:43 UTC 2026
