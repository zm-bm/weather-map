from __future__ import annotations


class FakeBatchClient:
    def __init__(self) -> None:
        self.submissions: list[dict] = []

    def submit_job(self, **kwargs) -> dict[str, str]:
        self.submissions.append(kwargs)
        return {"jobId": f"job-{len(self.submissions)}"}


class ConditionalCheckFailedException(Exception):
    pass


class FakeDynamoClient:
    class exceptions:
        ConditionalCheckFailedException = ConditionalCheckFailedException

    def __init__(self) -> None:
        self.items: dict[str, dict[str, int | str]] = {}
        self.updates: list[dict] = []

    def update_item(self, **kwargs) -> dict:
        self.updates.append(kwargs)
        pk = kwargs["Key"]["pk"]["S"]
        existing = self.items.get(pk)
        values = kwargs.get("ExpressionAttributeValues", {})
        now = int(values.get(":now", {"N": "0"})["N"])
        if kwargs.get("ConditionExpression") and existing is not None:
            expires_at = int(existing.get("expires_at_epoch", 0))
            if expires_at >= now and str(existing.get("state", "")) == "claimed":
                raise ConditionalCheckFailedException()

        item = dict(existing or {})
        update_expression = kwargs.get("UpdateExpression", "")
        self._apply_string_attr(item, values, update_expression, ":dataset_id", "dataset_id")
        self._apply_string_attr(item, values, update_expression, ":cycle", "cycle", alias="#cycle")
        self._apply_string_attr(item, values, update_expression, ":run_id", "run_id")
        self._apply_string_attr(item, values, update_expression, ":frame_id", "frame_id")
        self._apply_string_attr(item, values, update_expression, ":created_at", "created_at", keep_existing=True)
        self._apply_string_attr(item, values, update_expression, ":artifact_ids", "artifact_ids")
        self._apply_string_attr(item, values, update_expression, ":worker_spec_hash", "worker_spec_hash")
        self._apply_string_attr(item, values, update_expression, ":job_id", "job_id")
        self._apply_number_attr(item, values, update_expression, ":ttl", "ttl", keep_existing="#ttl = if_not_exists")
        self._apply_number_attr(item, values, update_expression, ":expires_at_epoch", "expires_at_epoch")

        if ":claimed" in values and ":claimed" in update_expression:
            item["state"] = values[":claimed"]["S"]
            item["attempt"] = int(item.get("attempt", 0)) + 1
        if ":submitted" in values and ":submitted" in update_expression:
            item["state"] = values[":submitted"]["S"]
        if ":complete" in values and ":complete" in update_expression:
            item["state"] = values[":complete"]["S"]

        self.items[pk] = item
        return {
            "Attributes": {
                "attempt": {"N": str(item.get("attempt", 1))},
                "run_id": {"S": str(item.get("run_id", ""))},
            }
        }

    def get_item(self, **kwargs) -> dict:
        item = self.items.get(kwargs["Key"]["pk"]["S"])
        if item is None:
            return {}
        return {"Item": self._dynamo_item(item)}

    def _apply_string_attr(
        self,
        item: dict[str, int | str],
        values: dict,
        update_expression: str,
        value_key: str,
        attr: str,
        *,
        alias: str | None = None,
        default: str | None = None,
        keep_existing: bool = False,
    ) -> None:
        if value_key not in values:
            return
        expression_name = alias or attr
        if keep_existing or f"if_not_exists({expression_name}" in update_expression:
            item.setdefault(attr, default or values[value_key]["S"])
        else:
            item[attr] = values[value_key]["S"]

    def _apply_number_attr(
        self,
        item: dict[str, int | str],
        values: dict,
        update_expression: str,
        value_key: str,
        attr: str,
        *,
        keep_existing: str | None = None,
    ) -> None:
        if value_key not in values:
            return
        value = int(values[value_key]["N"])
        if keep_existing and keep_existing in update_expression:
            item.setdefault(attr, value)
        else:
            item[attr] = value

    def _dynamo_item(self, item: dict[str, int | str]) -> dict:
        result = {}
        for key, value in item.items():
            result[key] = {"N": str(value)} if isinstance(value, int) else {"S": str(value)}
        return result
