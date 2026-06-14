# SkillSpector sidecar — wraps NVIDIA SkillSpector (https://github.com/NVIDIA/SkillSpector)
# behind a thin FastAPI /scan endpoint. Kept as a separate container so the heavy
# LangGraph/YARA/OpenAI dependency tree stays out of the main API image and the
# scanner can be upgraded independently (bump the pinned SHA in requirements.txt).
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SKILLSPECTOR_LOG_LEVEL=WARNING

# git is needed to pip-install SkillSpector from its pinned commit.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py .

EXPOSE 9200
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9200"]
