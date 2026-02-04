"""RQ worker process for YouTube comment analysis."""

# CRITICAL: Set these BEFORE any torch imports to prevent fork() crash on macOS
import os
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["OBJC_DISABLE_INITIALIZE_FORK_SAFETY"] = "YES"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import hashlib
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from rq import Queue, Worker, Connection, get_current_job
from rq.worker import SimpleWorker
from redis import Redis

# Load environment variables from worker/.env
load_dotenv(Path(__file__).parent / ".env")

# Ensure backend package is importable when worker runs from project root.
BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = BASE_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import SessionLocal  # type: ignore  # noqa: E402
from app.models import Cluster, Comment, StatusEnum, Video  # type: ignore  # noqa: E402
from app.tasks import set_job_status, set_video_status, store_clustered_results  # type: ignore  # noqa: E402

from .youtube import fetch_comments, fetch_video_info, fetch_transcript  # noqa: E402
from .clustering import embed_comments, cluster_comments, select_representatives, preprocess_texts  # noqa: E402
from .summarize import summarize_cluster, summarize_overall, summarize_issue_outline, summarize_video_content  # noqa: E402


def calc_comments_hash(comment_ids: list[str]) -> str:
    """Calculate SHA256 hash of comment IDs for cache invalidation."""
    joined = "\n".join(sorted(comment_ids))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def has_complete_analysis(db, video_id: int) -> bool:
    """Check if video has complete analysis (valid clusters AND overall summary)."""
    # Check clusters
    clusters = db.query(Cluster).filter(Cluster.video_id == video_id).all()
    if not clusters:
        return False
    # All clusters must have non-empty label, summary, and stance
    if not all(c.label and c.summary and c.stance for c in clusters):
        return False
    
    # Check overall_summary and issue_outline exist
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video or not video.overall_summary or not video.issue_outline:
        return False
    
    # video_summary should exist (or status be determined)
    if not video.video_summary and video.video_summary_status == "pending":
        return False

    return True


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

        # Fetch transcript and generate video summary
        print(f"[worker] Fetching transcript...")
        transcript_text = fetch_transcript(yt_video_id)
        video_summary_status = "unavailable"
        video_summary = None
        
        if transcript_text:
            print(f"[worker] Generating video summary from transcript...")
            video_summary = summarize_video_content(transcript_text, title=video_title, description=video_info["description"])
            video_summary_status = "ok" if video_summary else "failed"
        else:
            print(f"[worker] Transcript missing. Generating summary from description...")
            video_summary = summarize_video_content("", title=video_title, description=video_info["description"])
            video_summary_status = "ok" if video_summary else "failed"  # Should be 'ok' generally for description

        comments_data = fetch_comments(yt_video_id, max_results=100)

        print(f"[worker] Fetched {len(comments_data)} comments for '{video_title}'")

        # Calculate hash of comment IDs
        comment_ids = [c.get("comment_id", c["text"][:50]) for c in comments_data]
        new_hash = calc_comments_hash(comment_ids)

        # Get video from DB
        video = db.query(Video).filter(Video.id == video_id).first()
        if video:
            video.title = video_title
            if video_summary:
                video.video_summary = video_summary
            video.video_summary_status = video_summary_status

        # === CACHE CHECK ===
        # If hash matches AND we already have complete analysis (clusters + overall_summary), skip
        if video and video.hash_version == new_hash and has_complete_analysis(db, video_id):
            print(f"[worker] Cache hit! Complete analysis exists. Skipping processing.")
            set_job_status(db, job_id, StatusEnum.done)
            set_video_status(db, video_id, StatusEnum.done)
            db.commit()
            return

        # Update hash
        if video:
            video.hash_version = new_hash
            db.commit()

        # Save comments
        save_comments_to_db(db, video_id, comments_data)
        texts = [c["text"] for c in comments_data]

        if len(texts) < 3:
            print(f"[worker] Only {len(texts)} comments, skipping advanced analysis")
            set_job_status(db, job_id, StatusEnum.done, error_message="Not enough comments")
            set_video_status(db, video_id, StatusEnum.done)
        else:
            # 2. Preprocess: remove noise
            clean_texts, clean_indices = preprocess_texts(texts)
            print(f"[worker] Preprocessed: {len(texts)} -> {len(clean_texts)} comments (noise removed)")
            
            if len(clean_texts) < 3:
                print(f"[worker] Only {len(clean_texts)} clean comments, skipping analysis")
                set_job_status(db, job_id, StatusEnum.done, error_message="Not enough valid comments")
                set_video_status(db, video_id, StatusEnum.done)
                return
            
            # 3. Embed & Cluster (using clean texts)
            print(f"[worker] Embedding {len(clean_texts)} comments...")
            embeddings = embed_comments(clean_texts)

            print(f"[worker] Clustering with Silhouette method...")
            labels, coords_2d, centroids = cluster_comments(embeddings)

            # Select representatives (indices are relative to clean_texts)
            rep_indices_map = select_representatives(clean_texts, embeddings, labels, centroids, top_k=5)
            
            # 4. Summarize with LLM
            print(f"[worker] Summarizing {len(rep_indices_map)} clusters with LLM...")
            final_cluster_labels = []
            cluster_summaries = []
            cluster_stances = []
            
            for i in range(len(rep_indices_map)):
                rep_indices = rep_indices_map[i]
                rep_texts = [clean_texts[idx] for idx in rep_indices]
                
                if not rep_texts:
                    label, summary, stance = f"Group {i+1}", "No content", "neutral"
                else:
                    label, summary, stance = summarize_cluster(rep_texts, video_title=video_title)
                
                print(f"[worker] Cluster {i}: {label} ({stance})")
                final_cluster_labels.append(label)
                cluster_summaries.append(summary)
                cluster_stances.append(stance)

            # 5. Store Results (using clean_texts for clustering data)
            store_clustered_results(
                db, 
                video_id, 
                job_id, 
                clean_texts, 
                labels, 
                coords_2d, 
                rep_indices_map, 
                final_cluster_labels,
                cluster_summaries,
                cluster_stances
            )

            # 6. Generate overall summary and issue outline from cluster data
            print(f"[worker] Generating overall summary and issue outline...")
            clusters_data = []
            for i in range(len(rep_indices_map)):
                cluster_size = sum(1 for l in labels if l == i)
                clusters_data.append({
                    "label": final_cluster_labels[i],
                    "summary": cluster_summaries[i],
                    "size": cluster_size,
                    "stance": cluster_stances[i],
                })
            
            # Generate summaries
            overall_summary = summarize_overall(clusters_data, video_title=video_title)
            issue_outline = summarize_issue_outline(clusters_data, video_title=video_title, video_summary=video_summary)
            
            # Save to video
            video = db.query(Video).filter(Video.id == video_id).first()
            if video:
                if overall_summary:
                    video.overall_summary = overall_summary
                if issue_outline:
                    video.issue_outline = issue_outline
                
                db.commit()
                print(f"[worker] Summaries saved (overall: {bool(overall_summary)}, outline: {bool(issue_outline)})")

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
        worker = SimpleWorker([queue_name], connection=redis_conn)
        print(f"[worker] listening on queue='{queue_name}' redis='{redis_url}' (SimpleWorker mode)")
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
