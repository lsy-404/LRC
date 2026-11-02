# Regression tests

Use Python 3.11 or newer. The ingest tests cover `.github/scripts/ingest`; external transcription, OCR, and search calls are replaced with deterministic fixtures, while filesystem materialization, review serialization, metadata parsing, and final outputs execute production code.

```sh
python3 -m venv test/.venv
test/.venv/bin/pip install -r test/requirements.txt
test/.venv/bin/python -m pytest test/ingest -q
```
