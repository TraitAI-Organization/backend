# Backend Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
# --timeout=600 + --retries=5 protect against transient network issues
# pulling large wheels (xgboost is ~297 MB; the default pip timeout fires
# mid-download on slower or rate-limited EC2 connections).
RUN pip install --no-cache-dir --timeout=600 --retries=5 -r requirements.txt

# Copy application code
COPY . .

# Create models directory
RUN mkdir -p models

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
