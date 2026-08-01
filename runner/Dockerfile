# 摄取/生成作业的运行时。管道脚本每次从仓库克隆，这里只固化系统依赖与 Python 包。
# 平台写死 amd64：容器平台只跑这一种，在 arm 机器上构建也不会推错架构的镜像。
FROM --platform=linux/amd64 python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# 转写前统一转码要用 ffmpeg/ffprobe。取静态构建而非 apt 包：后者会拖进
# mesa/X11 一整套几百个依赖，跨架构构建时既慢又撑爆内存。
COPY --from=mwader/static-ffmpeg:7.1 /ffmpeg /ffprobe /usr/local/bin/

# tesseract：视觉识别前的页面方向检测（osd 数据包必需）；git：拉管道脚本与生成作业的工作树
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-osd git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY .github/scripts/requirements.txt /tmp/base-requirements.txt
COPY .github/scripts/ingest/requirements.txt /tmp/ingest-requirements.txt
RUN pip install -r /tmp/base-requirements.txt -r /tmp/ingest-requirements.txt

COPY runner/*.py /app/

EXPOSE 8080
CMD ["python", "-u", "/app/server.py"]
