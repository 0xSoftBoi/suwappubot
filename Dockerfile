FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    cmake \
    make \
    libpq-dev \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && which curl || (echo "curl not found!" && exit 1)

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir psycopg2-binary gunicorn

# Copy application code
COPY . .

# Make scripts executable
RUN chmod +x scripts/*.sh

# Create non-root user for security
RUN useradd -m -u 1000 botuser && chown -R botuser:botuser /app
USER botuser

# Default port for Render (Render will override with PORT env var)
ENV PORT=10000
EXPOSE 10000

# Health check via API (use explicit port for healthcheck)
# Note: Render sets PORT dynamically, but healthcheck needs explicit port
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD /usr/bin/curl -f http://localhost:${PORT:-10000}/health || exit 1

# Run both bot and API
CMD ["bash", "scripts/start_all.sh"]
