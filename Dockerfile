FROM python:3.9-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies including C++ build tools
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    cmake \
    make \
    libpq-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir psycopg2-binary

# Copy C++ source and build extension
COPY cpp/ ./cpp/
COPY setup.py pyproject.toml ./

# Build C++ extension
RUN pip install --no-cache-dir pybind11 cmake
RUN pip install -e . --no-build-isolation

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd -m -u 1000 botuser && chown -R botuser:botuser /app
USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import suwappu_core; print('healthy')" || exit 1

# Expose a lightweight HTTP port for Render port scan while the bot runs
ENV PORT=10000
EXPOSE 10000

# Run the bot and a tiny HTTP server to satisfy Render's port scan
CMD ["bash", "-lc", "python -m bot.main & python -m http.server ${PORT}"]
