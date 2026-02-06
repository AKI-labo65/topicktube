import os
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse, parse_qs

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis
from rq import Queue
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .jobs import process_video_job
from .models import Cluster, Job, StatusEnum, Video
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ClusterDetail,
    ClusterSummary,
    JobStatusResponse,
    VideoResponse,
)

# Create tables on startup (simple for MVP; use migrations later).
Base.metadata.create_all(bind=engine)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_NAME = os.getenv("RQ_QUEUE", "mvp_queue")
queue = Queue(QUEUE_NAME, connection=Redis.from_url(REDIS_URL))

app = FastAPI(title="YouTube Comment Map MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def extract_youtube_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname in {"youtu.be"}:
        return parsed.path.lstrip("/")
    if parsed.hostname and "youtube" in parsed.hostname:
        qs = parse_qs(parsed.query)
        if "v" in qs:
            return qs["v"][0]
    # Fallback: return full URL string; in MVP dummy mode this is fine.
    return url


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest, db: Session = Depends(get_db)):
    youtube_id = extract_youtube_id(request.url)

    existing_video: Optional[Video] = db.query(Video).filter(Video.youtube_id == youtube_id).first()
    if existing_video and existing_video.status == StatusEnum.done:
        # Check if new features are missing (video_summary)
        # If pending/missing, force re-analysis (fall through to enqueue)
        if not existing_video.video_summary and existing_video.video_summary_status == "pending":
            pass
        else:
            # Reuse existing job if available.
            latest_job = (
                db.query(Job)
                .filter(Job.video_id == existing_video.id, Job.status == StatusEnum.done)
                .order_by(Job.created_at.desc())
                .first()
            )
            if latest_job:
                return AnalyzeResponse(job_id=latest_job.id)

    if not existing_video:
        existing_video = Video(youtube_id=youtube_id, title=None, status=StatusEnum.queued)
        db.add(existing_video)
        db.commit()
        db.refresh(existing_video)
    else:
        existing_video.status = StatusEnum.queued
        db.commit()

    rq_job = queue.enqueue(process_video_job, existing_video.id, request.url)

    job = Job(
        id=rq_job.id,
        video_id=existing_video.id,
        status=StatusEnum.queued,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()

    return AnalyzeResponse(job_id=job.id)


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(status=job.status, video_id=job.video_id)


@app.get("/videos/{video_id}", response_model=VideoResponse)
def get_video(video_id: int, db: Session = Depends(get_db)):
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    clusters = [
        ClusterSummary(
            id=c.id,
            label=c.label,
            summary=c.summary,
            size=c.size,
            ord_x=c.ord_x,
            ord_y=c.ord_y,
            stance=c.stance,
            rep_comments_json=c.rep_comments_json,
        )
        for c in db.query(Cluster).filter(Cluster.video_id == video_id).all()
    ]
    return VideoResponse(
        id=video.id,
        youtube_id=video.youtube_id,
        title=video.title,
        overall_summary=video.overall_summary,
        issue_outline=video.issue_outline,
        video_summary=video.video_summary,
        video_summary_status=video.video_summary_status,
        status=video.status,
        created_at=video.created_at,
        updated_at=video.updated_at,
        clusters=clusters,
    )


@app.get("/clusters/{cluster_id}", response_model=ClusterDetail)
def get_cluster(cluster_id: int, db: Session = Depends(get_db)):
    cluster = db.query(Cluster).filter(Cluster.id == cluster_id).first()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return ClusterDetail(
        id=cluster.id,
        video_id=cluster.video_id,
        label=cluster.label,
        summary=cluster.summary,
        stance=cluster.stance,
        rep_comments_json=cluster.rep_comments_json,
    )
