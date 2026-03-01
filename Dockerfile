FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Create writable directories for cache and database
RUN mkdir -p .cache /data

# Set environment defaults
ENV PORT=8080
ENV FOLIO_DB_PATH=/data/folio.db

# Expose port
EXPOSE 8080

# Run with gunicorn — use shell form so $PORT is expanded at runtime
# Railway overrides PORT env var; shell form ensures it's picked up
CMD gunicorn -w 2 -b 0.0.0.0:$PORT --timeout 120 --graceful-timeout 30 app_server:app
