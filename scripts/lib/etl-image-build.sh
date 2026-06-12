#!/usr/bin/env bash

ETL_BASE_FINGERPRINT_LABEL="org.zmbm.weather-map.weather-etl.base-fingerprint"
ETL_APP_FINGERPRINT_LABEL="org.zmbm.weather-map.weather-etl.app-fingerprint"

etl_base_image_source_fingerprint() {
	local root="$1"
	(
		cd "$root"
		printf '%s\0' etl/Dockerfile.base \
			| xargs -0 sha256sum
	) | sha256sum | awk '{print $1}'
}

etl_app_image_source_fingerprint() {
	local root="$1"
	(
		cd "$root"
		{
			printf '%s\0' \
				etl/Dockerfile \
				etl/pyproject.toml
			find etl/weather_etl \
				-type f \
				! -path '*/__pycache__/*' \
				! -name '*.pyc' \
				-print0
		} | LC_ALL=C sort -z | xargs -0 sha256sum
	) | sha256sum | awk '{print $1}'
}

etl_inspect_image_label() {
	local image="$1"
	local label="$2"
	docker image inspect \
		--format "{{ index .Config.Labels \"$label\" }}" \
		"$image" 2>/dev/null
}

etl_base_image_rebuild_reason() {
	local image="$1"
	local expected_fingerprint="$2"
	local force_rebuild="$3"
	local current_fingerprint=""

	if [[ "$force_rebuild" == "true" ]]; then
		echo "forced by --rebuild"
	elif ! current_fingerprint="$(etl_inspect_image_label "$image" "$ETL_BASE_FINGERPRINT_LABEL")"; then
		echo "base image is missing"
	elif [[ -z "$current_fingerprint" || "$current_fingerprint" == "<no value>" ]]; then
		echo "base image has no source fingerprint"
	elif [[ "$current_fingerprint" != "$expected_fingerprint" ]]; then
		echo "base image inputs changed"
	fi
}

etl_app_image_rebuild_reason() {
	local image="$1"
	local expected_app_fingerprint="$2"
	local expected_base_fingerprint="$3"
	local base_rebuilt="$4"
	local force_rebuild="$5"
	local current_app_fingerprint=""
	local current_base_fingerprint=""

	if [[ "$force_rebuild" == "true" ]]; then
		echo "forced by --rebuild"
	elif [[ "$base_rebuilt" == "true" ]]; then
		echo "base image changed"
	elif ! current_app_fingerprint="$(etl_inspect_image_label "$image" "$ETL_APP_FINGERPRINT_LABEL")"; then
		echo "app image is missing"
	elif [[ -z "$current_app_fingerprint" || "$current_app_fingerprint" == "<no value>" ]]; then
		echo "app image has no source fingerprint"
	elif [[ "$current_app_fingerprint" != "$expected_app_fingerprint" ]]; then
		echo "app image inputs changed"
	else
		current_base_fingerprint="$(etl_inspect_image_label "$image" "$ETL_BASE_FINGERPRINT_LABEL" || true)"
		if [[ -z "$current_base_fingerprint" || "$current_base_fingerprint" == "<no value>" ]]; then
			echo "app image has no base fingerprint"
		elif [[ "$current_base_fingerprint" != "$expected_base_fingerprint" ]]; then
			echo "base image fingerprint changed"
		fi
	fi
}
