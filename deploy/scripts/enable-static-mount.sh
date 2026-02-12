#!/bin/bash
set -euo pipefail

DEVICE="${1:-}"
MOUNT_POINT="${2:-/opt/weather-map/tileserver/static}"
UNIT_NAME=$(systemd-escape --suffix=mount --path "$MOUNT_POINT")

if [[ -z "$DEVICE" ]]; then
  echo "[enable-static-mount] No device provided; skipping." >&2
  exit 0
fi

for _ in $(seq 1 30); do
  if [[ -b "$DEVICE" ]]; then
    break
  fi
  sleep 2
done

if [[ ! -b "$DEVICE" ]]; then
  echo "[enable-static-mount] Device not found after waiting: $DEVICE" >&2
  exit 0
fi

mkdir -p "$MOUNT_POINT"
if ! blkid "$DEVICE" >/dev/null 2>&1; then
  mkfs -t ext4 "$DEVICE"
fi

UUID=$(blkid -s UUID -o value "$DEVICE")
OVERRIDE_DIR="/etc/systemd/system/${UNIT_NAME}.d"
mkdir -p "$OVERRIDE_DIR"
cat <<EOF > "${OVERRIDE_DIR}/override.conf"
[Mount]
What=/dev/disk/by-uuid/${UUID}
EOF

systemctl daemon-reload
if ! systemctl enable --now "$UNIT_NAME"; then
  echo "[enable-static-mount] Failed to enable mount unit: $UNIT_NAME" >&2
  exit 0
fi
touch "$MOUNT_POINT/.static_synced"
