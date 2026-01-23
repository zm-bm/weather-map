import json
import hashlib
from typing import Any

def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def compute_revision(*, cycle: str, run_config: dict[str, Any], layer_config_obj: object) -> str:
    payload = "|".join(
        [
            cycle,
            json.dumps(run_config, sort_keys=True, separators=(",", ":")),
            json.dumps(layer_config_obj, sort_keys=True, separators=(",", ":")),
        ]
    )
    return sha256_hex(payload)[:12]
