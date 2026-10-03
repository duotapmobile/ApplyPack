FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS python-packages

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates cmake libcurl4-openssl-dev python3 python3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir --target /opt/python awslambdaric==4.1.0 boto3==1.43.108 \
    && rm -rf /var/lib/apt/lists/*

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates fonts-liberation libreoffice-writer poppler-utils python3 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

COPY --from=python-packages /opt/python /opt/python
COPY handler.py offline-smoke.py /var/task/

ENV HOME=/tmp \
    PYTHONPATH=/opt/python \
    PYTHONUNBUFFERED=1
WORKDIR /var/task
ENTRYPOINT ["/usr/bin/python3", "-m", "awslambdaric"]
CMD ["handler.lambda_handler"]
