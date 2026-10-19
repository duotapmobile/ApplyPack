# syntax=docker/dockerfile:1.7
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS python-packages

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates cmake libcurl4-openssl-dev python3 python3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir --target /opt/python awslambdaric==4.1.0 boto3==1.43.108 \
    && rm -rf /var/lib/apt/lists/*

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates fontconfig libreoffice-writer poppler-utils python3 \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# Liberation Sans 2.1.5 is licensed under SIL OFL 1.1. The upstream archive,
# every installed style, and the resulting immutable image are independently
# pinned. No paid-font file, upload, or BuildKit secret is accepted.
ADD --checksum=sha256:7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0 \
    https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz \
    /tmp/liberation-fonts-ttf-2.1.5.tar.gz
RUN mkdir -p /tmp/liberation-fonts /usr/local/share/fonts/truetype/applypack \
    && tar -xzf /tmp/liberation-fonts-ttf-2.1.5.tar.gz -C /tmp/liberation-fonts --strip-components=1 \
    && install -m 0644 /tmp/liberation-fonts/LiberationSans-Regular.ttf /usr/local/share/fonts/truetype/applypack/LiberationSans-Regular.ttf \
    && install -m 0644 /tmp/liberation-fonts/LiberationSans-Bold.ttf /usr/local/share/fonts/truetype/applypack/LiberationSans-Bold.ttf \
    && install -m 0644 /tmp/liberation-fonts/LiberationSans-Italic.ttf /usr/local/share/fonts/truetype/applypack/LiberationSans-Italic.ttf \
    && install -m 0644 /tmp/liberation-fonts/LiberationSans-BoldItalic.ttf /usr/local/share/fonts/truetype/applypack/LiberationSans-BoldItalic.ttf \
    && printf '%s  %s\n' \
      76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8 /usr/local/share/fonts/truetype/applypack/LiberationSans-Regular.ttf \
      788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173 /usr/local/share/fonts/truetype/applypack/LiberationSans-Bold.ttf \
      e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0 /usr/local/share/fonts/truetype/applypack/LiberationSans-Italic.ttf \
      698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee /usr/local/share/fonts/truetype/applypack/LiberationSans-BoldItalic.ttf \
      | sha256sum -c - \
    && fc-cache -f \
    && test "$(fc-match --format='%{family}' 'Liberation Sans:style=Regular')" = "Liberation Sans" \
    && test "$(fc-match --format='%{family}' 'Liberation Sans:style=Bold')" = "Liberation Sans" \
    && test "$(fc-match --format='%{family}' 'Liberation Sans:style=Italic')" = "Liberation Sans" \
    && test "$(fc-match --format='%{family}' 'Liberation Sans:style=Bold Italic')" = "Liberation Sans" \
    && rm -rf /tmp/liberation-fonts /tmp/liberation-fonts-ttf-2.1.5.tar.gz

COPY --from=python-packages /opt/python /opt/python
COPY handler.py offline-smoke.py /var/task/

ENV HOME=/tmp \
    LIBERATION_SANS_REGULAR_FONT_PATH=/usr/local/share/fonts/truetype/applypack/LiberationSans-Regular.ttf \
    LIBERATION_SANS_BOLD_FONT_PATH=/usr/local/share/fonts/truetype/applypack/LiberationSans-Bold.ttf \
    LIBERATION_SANS_ITALIC_FONT_PATH=/usr/local/share/fonts/truetype/applypack/LiberationSans-Italic.ttf \
    LIBERATION_SANS_BOLD_ITALIC_FONT_PATH=/usr/local/share/fonts/truetype/applypack/LiberationSans-BoldItalic.ttf \
    PYTHONPATH=/opt/python \
    PYTHONUNBUFFERED=1
WORKDIR /var/task
ENTRYPOINT ["/usr/bin/python3", "-m", "awslambdaric"]
CMD ["handler.lambda_handler"]
