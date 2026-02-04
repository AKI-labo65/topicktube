import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship

from .db import Base


class StatusEnum(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"


class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    youtube_id = Column(String, unique=True, nullable=False, index=True)
    title = Column(String, nullable=True)
    status = Column(Enum(StatusEnum), default=StatusEnum.queued, nullable=False)
    hash_version = Column(String, nullable=True)  # SHA256 of comment IDs for cache invalidation
    overall_summary = Column(Text, nullable=True)  # LLM-generated summary of all cluster key points
    issue_outline = Column(Text, nullable=True)  # LLM-generated structured issue outline
    video_summary = Column(Text, nullable=True)  # LLM-generated summary of video content (transcript)
    video_summary_status = Column(String, default="pending", nullable=False)  # pending, ok, unavailable, failed
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    comments = relationship("Comment", back_populates="video", cascade="all, delete-orphan")
    clusters = relationship("Cluster", back_populates="video", cascade="all, delete-orphan")
    jobs = relationship("Job", back_populates="video", cascade="all, delete-orphan")


class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    like_count = Column(Integer, default=0)
    published_at = Column(DateTime, nullable=True)

    video = relationship("Video", back_populates="comments")


class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False, index=True)
    label = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    size = Column(Integer, default=0)
    ord_x = Column(Float, default=0.0)
    ord_y = Column(Float, default=0.0)
    stance = Column(String, nullable=True)  # support, skeptic, neutral
    rep_comments_json = Column(JSON, nullable=True)  # list of brief representative comments

    video = relationship("Video", back_populates="clusters")


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, index=True)  # RQ job id
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False, index=True)
    status = Column(Enum(StatusEnum), default=StatusEnum.queued, nullable=False)
    error_message: Optional[str] = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    video = relationship("Video", back_populates="jobs")
