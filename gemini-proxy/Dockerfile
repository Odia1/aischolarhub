FROM python:3.12-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

USER app

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn server:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000}"]
