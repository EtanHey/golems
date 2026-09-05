FROM ollama/ollama:latest

# Run as non-root for additional security
# Note: Ollama needs to write to /root/.ollama by default, we'll override
ENV OLLAMA_HOME=/data/.ollama
ENV OLLAMA_MODELS=/data/.ollama/models

# Create non-root user for security (let system assign UID)
RUN useradd -m ollama || true

# Create data directory for models and state with proper permissions
RUN mkdir -p /data/.ollama/models && \
    chown -R ollama:ollama /data && \
    chmod -R 750 /data

# Switch to non-root user
USER ollama

# Expose the API port
EXPOSE 11434

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:11434/api/tags || exit 1

# Default command
CMD ["serve"]
