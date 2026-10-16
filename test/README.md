# Regression tests

Use Node.js 24 or newer and Python 3.11 or newer. Worker runtime tests use Miniflare and the production SQLite UserDirectory. The worker depends on the private studio solution: place `solution-studio-<version>.tgz` in `vendor/` before installing the worker dependencies. Studio client tests live with the private solution.

```sh
corepack pnpm@10.34.6 --dir worker install --frozen-lockfile
PYTHONIOENCODING=utf-8 node --test test/*.test.mjs
node --experimental-vm-modules --test test/worker/*.test.mjs
python3 -m venv test/.venv
test/.venv/bin/pip install -r test/requirements.txt
test/.venv/bin/python -m pytest test/ingest test/runner -q
```

Create the Python environment before running the Node manifest tests, which use Python's standard TOML parser. Set `PYTHON` to a Python 3.11+ executable to use an existing environment.

The pipeline regressions create actual WAV/image/lyric inputs, generate workspace manifests in JavaScript, and run both ingestion phases. External transcription, OCR, and search calls are replaced with deterministic fixtures; filesystem materialization, review serialization, metadata parsing, and final outputs execute production code.
