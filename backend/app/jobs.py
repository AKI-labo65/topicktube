"""RQ job entrypoints.

This module intentionally avoids importing worker-only dependencies at import
time so the backend can run with only `backend/requirements.txt`.
"""

from __future__ import annotations


def process_video_job(video_id: int, youtube_url: str) -> None:
    # Delayed import: only the worker environment should need these deps.
    from worker.process import process_video  # type: ignore

    process_video(video_id, youtube_url)

