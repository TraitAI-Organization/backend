# Dashboard Plot Data (Synthetic)

This project now includes a synthetic CSV for the new analytics plots:

- `sample_data/traitharvest_synthetic_dashboard.csv`

It contains:
- 1,680 field-season rows
- 4 states (`Kansas`, `Missouri`, `Oklahoma`, `Texas`)
- 3 seasons (`2021`, `2022`, `2023`)
- realistic `yield_bu_ac` and `totalN_per_ac` relationship

## Generate a New Synthetic File

```bash
python tools/generate_synthetic_dashboard_csv.py \
  --output sample_data/traitharvest_synthetic_dashboard.csv \
  --rows-per-state-season 140 \
  --seed 42
```

## Upload and Test (Local)

```bash
curl -sS -X POST http://localhost:8001/api/v1/data/upload \
  -F "file=@sample_data/traitharvest_synthetic_dashboard.csv"
```

Then open:
- `http://localhost:8501`
- Analytics tab (`📈 Analytics`)

## Upload and Test (EC2)

Option A: generate directly on EC2:

```bash
cd /home/ubuntu/backend
python tools/generate_synthetic_dashboard_csv.py \
  --output sample_data/traitharvest_synthetic_dashboard.csv \
  --rows-per-state-season 140 \
  --seed 42
```

Option B: copy file from local:

```bash
scp -i "/path/to/traitharvest.pem" \
  sample_data/traitharvest_synthetic_dashboard.csv \
  ubuntu@<EC2_HOST>:/home/ubuntu/backend/sample_data/
```

Upload on server:

```bash
curl -sS -X POST https://traitharvest.ai/api/v1/data/upload \
  -F "file=@/home/ubuntu/backend/sample_data/traitharvest_synthetic_dashboard.csv"
```

## Important

CSV ingestion deduplicates by file hash.  
If you re-upload the exact same file, it will be skipped as already ingested.  
To ingest again, regenerate with a different `--seed` or modify the file.

Also note: `*.csv` is git-ignored in this repo.  
Use the generator script to recreate CSV files on any environment.
