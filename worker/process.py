"""RQ worker process for YouTube comment analysis."""

import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from rq import Queue, Worker, Connection, get_current_job
from redis import Redis

# Load environment variables from worker/.env
load_dotenv(Path(__file__).parent / ".env")

# Ensure backend package is importable when worker runs from project root.
BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = BASE_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import SessionLocal  # type: ignore  # noqa: E402
from app.models import StatusEnum, Video  # type: ignore  # noqa: E402
from app.tasks import set_job_status, set_video_status, store_results_with_comments  # type: ignore  # noqa: E402

from .youtube import fetch_comments, fetch_video_info  # noqa: E402


def process_video(video_id: int, youtube_url: str):
    """Process a YouTube video: fetch comments and store results."""
    job = get_current_job()
    job_id = job.id if job else f"manual-{datetime.utcnow().timestamp()}"
    db = SessionLocal()

    try:
        set_job_status(db, job_id, StatusEnum.processing)
        set_video_status(db, video_id, StatusEnum.processing)

        # Extract YouTube video ID from URL
        yt_video_id = extract_video_id(youtube_url)
        print(f"[worker] Fetching comments for video: {yt_video_id}")

        # Fetch video info and comments from YouTube API
        video_info = fetch_video_info(yt_video_id)
        comments = fetch_comments(yt_video_id, max_results=100)

        print(f"[worker] Fetched {len(comments)} comments for '{video_info['title']}'")

        # Update video title in database
        video = db.query(Video).filter(Video.id == video_id).first()
        if video:
            video.title = video_info["title"]
            db.commit()

        # Store results (for now, group all comments into 3 dummy clusters)
        store_results_with_comments(db, video_id, job_id, comments)

    except Exception as exc:  # pylint: disable=broad-except
        print(f"[worker] Error processing video: {exc}")
        set_job_status(db, job_id, StatusEnum.failed, error_message=str(exc))
        set_video_status(db, video_id, StatusEnum.failed)
        raise
    finally:
        db.close()


def extract_video_id(url: str) -> str:
    """Extract YouTube video ID from various URL formats."""
    from urllib.parse import urlparse, parse_qs

    parsed = urlparse(str(url))

    # Handle youtu.be/VIDEO_ID
    if parsed.hostname in {"youtu.be"}:
        return parsed.path.lstrip("/")

    # Handle youtube.com/watch?v=VIDEO_ID
    if parsed.hostname and "youtube" in parsed.hostname:
        qs = parse_qs(parsed.query)
        if "v" in qs:
            return qs["v"][0]

    # Fallback: assume the URL is the video ID itself
    return str(url)


def main():
    """Start the RQ worker."""
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    queue_name = os.getenv("RQ_QUEUE", "mvp_queue")

    redis_conn = Redis.from_url(redis_url)

    Queue(name=queue_name, connection=redis_conn)

    with Connection(redis_conn):
        worker = Worker([queue_name])
        print(f"[worker] listening on queue='{queue_name}' redis='{redis_url}'")
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
