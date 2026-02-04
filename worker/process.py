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
from app.models import Comment, StatusEnum, Video  # type: ignore  # noqa: E402
from app.tasks import set_job_status, set_video_status, store_clustered_results  # type: ignore  # noqa: E402

from .youtube import fetch_comments, fetch_video_info  # noqa: E402
from .clustering import embed_comments, cluster_comments, select_representatives, generate_cluster_labels  # noqa: E402


def process_video(video_id: int, youtube_url: str):
    """Process a YouTube video: fetch comments, embed, cluster, and store results."""
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
        comments_data = fetch_comments(yt_video_id, max_results=100)

        print(f"[worker] Fetched {len(comments_data)} comments for '{video_info['title']}'")

        # Update video title in database
        video = db.query(Video).filter(Video.id == video_id).first()
        if video:
            video.title = video_info["title"]
            db.commit()

        # Save comments to database
        save_comments_to_db(db, video_id, comments_data)

        # Extract text for embedding
        texts = [c["text"] for c in comments_data]

        if len(texts) < 3:
            # Not enough comments for meaningful clustering
            print(f"[worker] Only {len(texts)} comments, skipping clustering")
            # Store with single empty/default cluster if needed, or handle separately
            # For MVP, we might just fail or store dummy
            set_job_status(db, job_id, StatusEnum.done, error_message="Not enough comments")
            set_video_status(db, video_id, StatusEnum.done)
        else:
            # Embed and cluster
            print(f"[worker] Embedding {len(texts)} comments...")
            embeddings = embed_comments(texts)

            print(f"[worker] Clustering...")
            labels, coords_2d, centroids = cluster_comments(embeddings)

            # Select representatives (indices list)
            rep_indices_map = select_representatives(texts, embeddings, labels, centroids, top_k=3)
            
            # Generate labels
            cluster_labels = generate_cluster_labels(len(centroids))

            print(f"[worker] Created {len(cluster_labels)} clusters")

            # Store results
            store_clustered_results(
                db, video_id, job_id, texts, labels, coords_2d, rep_indices_map, cluster_labels
            )

    except Exception as exc:  # pylint: disable=broad-except
        print(f"[worker] Error processing video: {exc}")
        set_job_status(db, job_id, StatusEnum.failed, error_message=str(exc))
        set_video_status(db, video_id, StatusEnum.failed)
        raise
    finally:
        db.close()


def save_comments_to_db(db, video_id: int, comments_data: list[dict]):
    """Save fetched comments to database."""
    # Clear existing comments for this video
    db.query(Comment).filter(Comment.video_id == video_id).delete()

    for c in comments_data:
        comment = Comment(
            video_id=video_id,
            text=c["text"],
            like_count=c.get("likes", 0),
            published_at=None,
        )
        db.add(comment)

    db.commit()
    print(f"[worker] Saved {len(comments_data)} comments to DB")


def extract_video_id(url: str) -> str:
    """Extract YouTube video ID from various URL formats."""
    from urllib.parse import urlparse, parse_qs

    parsed = urlparse(str(url))

    if parsed.hostname in {"youtu.be"}:
        return parsed.path.lstrip("/")

    if parsed.hostname and "youtube" in parsed.hostname:
        qs = parse_qs(parsed.query)
        if "v" in qs:
            return qs["v"][0]

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
