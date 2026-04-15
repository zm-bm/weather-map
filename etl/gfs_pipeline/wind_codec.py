"""Wind payload encoding helpers.

This module contains the numeric conversion logic used by the worker's wind
artifact path so worker.py can stay orchestration-focused.
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

from . import gdal_ops


def extract_float32_band_bytes(
    *,
    grib_path: Path,
    band_idx: int,
    workdir_path: Path,
    run: gdal_ops.RunFn,
) -> tuple[bytes, str]:
    """Extract one GRIB band into contiguous Float32 bytes (row-major)."""
    gdal_ops.gdal_translate(
        grib_path,
        workdir_path,
        opts=gdal_ops.TranslateOpts(
            band=band_idx,
            output_type="Float32",
            output_format="ENVI",
            creation_options=("INTERLEAVE=BSQ",),
        ),
        run=run,
    )

    # ENVI sidecar header stores byte order as 0=little, 1=big.
    hdr_path = workdir_path.with_suffix(".hdr")
    byte_order = "little"
    if hdr_path.exists():
        try:
            for line in hdr_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                normalized = line.strip().lower()
                if normalized.startswith("byte order"):
                    parts = normalized.split("=", 1)
                    if len(parts) == 2:
                        value = parts[1].strip()
                        if value == "0":
                            byte_order = "little"
                        elif value == "1":
                            byte_order = "big"
                    break
        except Exception:
            pass

    return workdir_path.read_bytes(), byte_order


def quantize_f32_to_i8_q0p5(data: bytes, *, byte_order: str) -> bytes:
    """Quantize float32 m/s values to int8 with 0.5 m/s precision."""
    if len(data) % 4 != 0:
        raise SystemExit(f"Invalid float32 byte length: {len(data)}")

    fmt = "<f" if byte_order == "little" else ">f"
    out = bytearray(len(data) // 4)
    for i, (value,) in enumerate(struct.iter_unpack(fmt, data)):
        if math.isfinite(value):
            q = int(round(value * 2.0))
            if q < -128:
                q = -128
            elif q > 127:
                q = 127
        else:
            q = 0
        out[i] = q & 0xFF
    return bytes(out)
