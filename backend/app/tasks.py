import random
from datetime import datetime
from typing import List

from sqlalchemy.orm import Session

from .models import Cluster, Job, StatusEnum, Video


def set_job_status(db: Session, job_id: str, status: StatusEnum, error_message: str | None = None):
    job = db.query(Job).filter(Job.id == job_id).first()
    if job:
        job.status = status
        job.error_message = error_message
        job.updated_at = datetime.utcnow()
    db.commit()


def set_video_status(db: Session, video_id: int, status: StatusEnum):
    video = db.query(Video).filter(Video.id == video_id).first()
    if video:
        video.status = status
        video.updated_at = datetime.utcnow()
    db.commit()


def generate_dummy_clusters() -> List[dict]:
    labels = ["賛成派の意見", "懐疑的な意見", "中立・情報共有"]
    summaries = [
        "動画内容を支持し、参考になった点を共有するクラスタ。",
        "動画の前提や根拠に疑問を呈するクラスタ。",
        "補足情報や体験談を列挙するクラスタ。",
    ]
    clusters = []
    for idx, label in enumerate(labels, start=1):
        clusters.append(
            {
                "label": label,
                "summary": summaries[idx - 1],
                "size": random.randint(8, 20),
                "ord_x": random.uniform(-1, 1),
                "ord_y": random.uniform(-1, 1),
                "rep_comments_json": [
                    {"author": "user123", "text": f"{label} に関する代表コメント {i+1}"} for i in range(3)
                ],
            }
        )
    return clusters


def store_dummy_results(db: Session, video_id: int, job_id: str):
    # Clear previous clusters if any (idempotent rerun safeguard).
    db.query(Cluster).filter(Cluster.video_id == video_id).delete()
    for cluster_data in generate_dummy_clusters():
        cluster = Cluster(
            video_id=video_id,
            label=cluster_data["label"],
            summary=cluster_data["summary"],
            size=cluster_data["size"],
            ord_x=cluster_data["ord_x"],
            ord_y=cluster_data["ord_y"],
            rep_comments_json=cluster_data["rep_comments_json"],
        )
        db.add(cluster)
    set_video_status(db, video_id, StatusEnum.done)
    set_job_status(db, job_id, StatusEnum.done)


def store_results_with_comments(
    db: Session, video_id: int, job_id: str, comments: List[dict]
):
    """
    Store analysis results using real YouTube comments.

    For now, distributes comments into 3 fixed clusters (no real clustering yet).
    Real clustering with embeddings will be added later.
    """
    # Clear previous clusters
    db.query(Cluster).filter(Cluster.video_id == video_id).delete()

    if not comments:
        # No comments: create single empty cluster
        cluster = Cluster(
            video_id=video_id,
            label="コメントなし",
            summary="この動画にはコメントがありません。",
            size=0,
            ord_x=0.0,
            ord_y=0.0,
            rep_comments_json=[],
        )
        db.add(cluster)
    else:
        # Distribute comments into 3 clusters (temporary until real clustering)
        cluster_defs = [
            {
                "label": "主要な意見",
                "summary": "動画に対する主要なコメント群。",
                "ord_x": -0.5,
                "ord_y": 0.3,
            },
            {
                "label": "関連する議論",
                "summary": "動画内容に関連した議論やコメント。",
                "ord_x": 0.5,
                "ord_y": 0.3,
            },
            {
                "label": "その他の反応",
                "summary": "その他の反応やコメント。",
                "ord_x": 0.0,
                "ord_y": -0.5,
            },
        ]

        # Split comments into 3 groups
        chunk_size = max(1, len(comments) // 3)
        comment_chunks = [
            comments[i : i + chunk_size] for i in range(0, len(comments), chunk_size)
        ]

        for idx, cluster_def in enumerate(cluster_defs):
            chunk = comment_chunks[idx] if idx < len(comment_chunks) else []
            # Take top 5 comments as representative
            rep_comments = [
                {"author": c["author"], "text": c["text"]}
                for c in chunk[:5]
            ]
            cluster = Cluster(
                video_id=video_id,
                label=cluster_def["label"],
                summary=cluster_def["summary"],
                size=len(chunk),
                ord_x=cluster_def["ord_x"],
                ord_y=cluster_def["ord_y"],
                rep_comments_json=rep_comments,
            )
            db.add(cluster)

def store_clustered_results(
    db: Session,
    video_id: int,
    job_id: str,
    texts: List[str],
    labels: List[int],
    coords_2d: List[List[float]],
    rep_indices_map: List[List[int]],
    cluster_labels: List[str],
    cluster_summaries: List[str] | None = None,
):
    """
    Store clustered results.
    
    Args:
        labels: Cluster assignment for each text (aligned with texts)
        coords_2d: 2D coordinates for each text (aligned with texts)
        rep_indices_map: List of list of text indices for each cluster
        cluster_labels: List of label strings for each cluster
        cluster_summaries: List of summary strings for each cluster
    """
    # Clear previous clusters
    db.query(Cluster).filter(Cluster.video_id == video_id).delete()

    n_clusters = len(rep_indices_map)
    
    for cluster_idx in range(n_clusters):
        # Calculate cluster size
        size = 0
        if labels is not None:
            size = sum(1 for label in labels if label == cluster_idx)
        
        # Calculate cluster center (mean of points in cluster)
        c_x, c_y = 0.0, 0.0
        if labels is not None and coords_2d is not None:
            points = [coords_2d[i] for i, label in enumerate(labels) if label == cluster_idx]
            if points:
                avg_x = sum(p[0] for p in points) / len(points)
                avg_y = sum(p[1] for p in points) / len(points)
                c_x, c_y = float(avg_x), float(avg_y)

        # Get representative comments text
        rep_comments = []
        indices = rep_indices_map[cluster_idx]
        for idx in indices:
            if idx < len(texts):
                rep_comments.append({"author": "Unknown", "text": texts[idx]})

        # Get summary if available
        summary_text = f"Clustered opinion group {cluster_idx + 1}"
        if cluster_summaries and cluster_idx < len(cluster_summaries):
            summary_text = cluster_summaries[cluster_idx]

        cluster = Cluster(
            video_id=video_id,
            label=cluster_labels[cluster_idx],
            summary=summary_text,
            size=size,
            ord_x=c_x,
            ord_y=c_y,
            rep_comments_json=rep_comments,
        )
        db.add(cluster)

    set_video_status(db, video_id, StatusEnum.done)
    set_job_status(db, job_id, StatusEnum.done)

