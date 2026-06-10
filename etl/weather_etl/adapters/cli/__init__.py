"""Command-line interface for weather-etl."""

from __future__ import annotations

from .parser import build_arg_parser, main

__all__ = ("build_arg_parser", "main")
