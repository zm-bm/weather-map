from __future__ import annotations


class CountingStore:
    name = "counting"

    def __init__(self, delegate) -> None:
        self.delegate = delegate
        self.list_object_prefixes: list[str] = []

    def __getattr__(self, name: str):
        return getattr(self.delegate, name)

    def read_bytes(self, *, uri: str):
        return self.delegate.read_bytes(uri=uri)

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        return self.delegate.write_bytes(uri=uri, data=data)

    def exists(self, *, uri: str):
        return self.delegate.exists(uri=uri)

    def list_prefix(self, *, prefix_uri: str):
        return self.delegate.list_prefix(prefix_uri=prefix_uri)

    def list_objects(self, *, prefix_uri: str):
        self.list_object_prefixes.append(prefix_uri)
        return self.delegate.list_objects(prefix_uri=prefix_uri)

    def get_to_file(self, *, uri: str, dst):
        return self.delegate.get_to_file(uri=uri, dst=dst)

    def put_file(self, *, uri: str, src):
        return self.delegate.put_file(uri=uri, src=src)
