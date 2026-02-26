#!/usr/bin/env python3
"""
Generate synthetic field-season CSV for dashboard analytics demos.

Output columns are compatible with the existing CSV ingestion service.
"""
from __future__ import annotations

import argparse
import csv
import random
from pathlib import Path


STATE_CONFIG = {
    "Kansas": {"county": "Ford", "lat": 37.7, "long": -99.8, "base_yield": 122.0},
    "Missouri": {"county": "Boone", "lat": 38.9, "long": -92.3, "base_yield": 132.0},
    "Oklahoma": {"county": "Payne", "lat": 36.1, "long": -97.1, "base_yield": 126.0},
    "Texas": {"county": "Lubbock", "lat": 33.6, "long": -101.8, "base_yield": 116.0},
}

CROPS = [
    ("Sorghum", ["Sorghum Hybrid A", "Sorghum Hybrid B"]),
    ("Corn", ["Corn Pioneer 86P20", "Corn DKC63-58"]),
    ("Wheat, Hard Winter", ["TAM 114", "WB-Grainfield"]),
]

SEASONS = [2021, 2022, 2023]


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def build_rows(rows_per_state_season: int, seed: int):
    random.seed(seed)
    field_counter = 100000

    for season in SEASONS:
        for state, cfg in STATE_CONFIG.items():
            seasonal_shift = {
                2021: -8.0,
                2022: -2.5,
                2023: 5.0,
            }[season]

            for _ in range(rows_per_state_season):
                field_counter += 1
                crop_name, varieties = random.choice(CROPS)
                variety_name = random.choice(varieties)

                acres = round(random.uniform(20, 280), 1)
                total_n = round(clamp(random.gauss(130, 45), 15, 280), 2)
                total_p = round(clamp(random.gauss(45, 16), 5, 100), 2)
                total_k = round(clamp(random.gauss(36, 14), 0, 95), 2)

                crop_offset = {
                    "Sorghum": -4.5,
                    "Corn": 10.0,
                    "Wheat, Hard Winter": 2.5,
                }[crop_name]

                # Positive response to N plus realistic noise.
                yield_bu = (
                    cfg["base_yield"]
                    + seasonal_shift
                    + crop_offset
                    + 0.26 * total_n
                    + random.gauss(0, 11)
                )
                yield_bu = round(clamp(yield_bu, 45, 210), 1)
                yield_target = round(yield_bu + random.uniform(-8, 9), 1)

                lat = round(cfg["lat"] + random.uniform(-0.95, 0.95), 6)
                long = round(cfg["long"] + random.uniform(-1.1, 1.1), 6)

                yield {
                    "field": field_counter,
                    "crop_name_en": crop_name,
                    "variety_name_en": variety_name,
                    "season": season,
                    "yield_bu_ac": yield_bu,
                    "yield_target": yield_target,
                    "totalN_per_ac": total_n,
                    "totalP_per_ac": total_p,
                    "totalK_per_ac": total_k,
                    "state": state,
                    "county": cfg["county"],
                    "acres": acres,
                    "lat": lat,
                    "long": long,
                }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="sample_data/traitharvest_synthetic_dashboard.csv",
        help="Output CSV path.",
    )
    parser.add_argument(
        "--rows-per-state-season",
        type=int,
        default=140,
        help="Rows per state x season cell.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducible output.",
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rows = list(build_rows(args.rows_per_state_season, args.seed))
    if not rows:
        print("No rows generated.")
        return 1

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows)} rows -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
