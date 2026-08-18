FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY ingest/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY ingest/pump_ingest.py /app/pump_ingest.py
COPY ingest/signal_lab.py /app/signal_lab.py
RUN useradd -r -u 10001 collector && chown -R collector:collector /app
USER collector
CMD ["python","/app/pump_ingest.py"]
