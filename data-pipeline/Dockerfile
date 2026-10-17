FROM python:3.12-slim-bookworm

# osmium-tool is used to cut the regional extract out of the country PBF.
RUN apt-get update \
    && apt-get install -y --no-install-recommends osmium-tool curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY pipeline ./pipeline
COPY tests ./tests
COPY regions.yml ./regions.yml

ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8
ENTRYPOINT ["python", "-m", "pipeline"]
CMD ["--help"]
