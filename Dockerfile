FROM python:3.13-slim

WORKDIR /app

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY api/ ./api/
COPY auth/ ./auth/

# Create output directory for token storage and set ownership
RUN mkdir -p /app/output && chown -R appuser:appuser /app

USER appuser

# Cloud Run sets PORT environment variable
ENV PORT=8080

# Run the FastAPI app
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
