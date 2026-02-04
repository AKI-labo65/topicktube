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
