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

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

# Run with gunicorn
CMD ["sh", "-c", "gunicorn -w 2 -b 0.0.0.0:${PORT} --timeout 120 --graceful-timeout 30 app_server:app"]
