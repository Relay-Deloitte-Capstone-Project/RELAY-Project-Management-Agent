FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# CPU-only torch first: the default PyPI Linux wheel bundles CUDA (~2.5 GB),
# which blows past Render's free-tier memory. sentence-transformers then sees
# torch already satisfied and skips re-pulling it.
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu "torch==2.6.0+cpu"

COPY requirements.txt .
RUN pip install -r requirements.txt

# Bake the embedding model into the image so cold starts don't re-download it
# from Hugging Face on every wake.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-en-v1.5')"

COPY . .

# Render injects PORT; 8001 matches local dev.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
