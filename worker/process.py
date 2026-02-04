"""RQ worker process for YouTube comment analysis."""

# CRITICAL: Set these BEFORE any torch imports to prevent fork() crash on macOS
import os
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["OBJC_DISABLE_INITIALIZE_FORK_SAFETY"] = "YES"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

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
from .summarize import summarize_cluster  # noqa: E402


def process_video(video_id: int, youtube_url: str):
    """Process a YouTube video: fetch, embed, cluster, summarize, and store."""
    job = get_current_job()
    job_id = job.id if job else f"manual-{datetime.utcnow().timestamp()}"
    db = SessionLocal()

    try:
        set_job_status(db, job_id, StatusEnum.processing)
        set_video_status(db, video_id, StatusEnum.processing)

        # 1. Fetch Data
        yt_video_id = extract_video_id(youtube_url)
        print(f"[worker] Fetching comments for video: {yt_video_id}")

        video_info = fetch_video_info(yt_video_id)
        video_title = video_info["title"]
        comments_data = fetch_comments(yt_video_id, max_results=100)

        print(f"[worker] Fetched {len(comments_data)} comments for '{video_title}'")

        # Update video title
        video = db.query(Video).filter(Video.id == video_id).first()
        if video:
            video.title = video_title
            db.commit()

        # Save comments
        save_comments_to_db(db, video_id, comments_data)
        texts = [c["text"] for c in comments_data]

        if len(texts) < 3:
            print(f"[worker] Only {len(texts)} comments, skipping advanced analysis")
            set_job_status(db, job_id, StatusEnum.done, error_message="Not enough comments")
            set_video_status(db, video_id, StatusEnum.done)
        else:
            # 2. Embed & Cluster
            print(f"[worker] Embedding {len(texts)} comments...")
            embeddings = embed_comments(texts)

            print(f"[worker] Clustering...")
            labels, coords_2d, centroids = cluster_comments(embeddings)

            # Select representatives
            rep_indices_map = select_representatives(texts, embeddings, labels, centroids, top_k=5)
            
            # 3. Summarize with LLM
            print(f"[worker] Summarizing {len(rep_indices_map)} clusters with LLM...")
            cluster_labels = []
            cluster_summaries = [] # New: store summaries (currently not passed to store_clustered_results but good to have ready)
            
            # Note: tasks.store_clustered_results currently takes cluster_labels but logic handles objects inside 
            # We need to pass labels and potentially summaries if we update tasks.py
            
            final_cluster_labels = []
            
            for i in range(len(rep_indices_map)):
                rep_indices = rep_indices_map[i]
                rep_texts = [texts[idx] for idx in rep_indices]
                
                if not rep_texts:
                    label, summary = f"Group {i+1}", "No content"
                else:
                    label, summary = summarize_cluster(rep_texts, video_title=video_title)
                
                print(f"[worker] Cluster {i}: {label}")
                final_cluster_labels.append(label)
                # We will inject summary into the label or store it if schema allows
                # app.tasks.store_clustered_results expects list of strings for labels
                
                # To actually store summary, we need to update store_clustered_results or hack it
                # For MVP, let's pass it to store_clustered_results. 
                # We need to update tasks.py signature first.
                cluster_summaries.append(summary)

            # 4. Store Results
            store_clustered_results(
                db, 
                video_id, 
                job_id, 
                texts, 
                labels, 
                coords_2d, 
                rep_indices_map, 
                final_cluster_labels,
                cluster_summaries # We will add this arg to tasks.py next
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


def extract_video_id(url: str) -> str:
    """Extract YouTube video ID."""
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
