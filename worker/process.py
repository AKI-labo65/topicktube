import os
import sys
from datetime import datetime
from pathlib import Path

from rq import Queue, Worker, Connection, get_current_job
from redis import Redis

# Ensure backend package is importable when worker runs from project root.
BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = BASE_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import SessionLocal  # type: ignore  # noqa: E402
from app.models import StatusEnum  # type: ignore  # noqa: E402
from app.tasks import set_job_status, set_video_status, store_dummy_results  # type: ignore  # noqa: E402


def process_video(video_id: int, youtube_url: str):
    job = get_current_job()
    job_id = job.id if job else f"manual-{datetime.utcnow().timestamp()}"
    db = SessionLocal()
    try:
        set_job_status(db, job_id, StatusEnum.processing)
        set_video_status(db, video_id, StatusEnum.processing)

        # Dummy placeholder: generate synthetic clusters and mark as done.
        store_dummy_results(db, video_id, job_id)
    except Exception as exc:  # pylint: disable=broad-except
        set_job_status(db, job_id, StatusEnum.failed, error_message=str(exc))
        set_video_status(db, video_id, StatusEnum.failed)
        raise
    finally:
        db.close()


def main():
    # Use docker-compose Redis exposed on localhost:6379 by default.
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    queue_name = os.getenv("RQ_QUEUE", "mvp_queue")

    redis_conn = Redis.from_url(redis_url)

    # Create queue explicitly (not strictly required, but clarifies intent)
    Queue(name=queue_name, connection=redis_conn)

    with Connection(redis_conn):
        worker = Worker([queue_name])
        print(f"[worker] listening on queue='{queue_name}' redis='{redis_url}'")
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
