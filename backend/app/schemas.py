from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, HttpUrl

from .models import StatusEnum


class AnalyzeRequest(BaseModel):
    url: HttpUrl


class AnalyzeResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    status: StatusEnum
    video_id: Optional[int] = None


class ClusterSummary(BaseModel):
    id: int
    label: str
    summary: Optional[str] = None
    size: int
    ord_x: float
    ord_y: float
    rep_comments_json: Optional[list] = None


class VideoResponse(BaseModel):
    id: int
    youtube_id: str
    title: Optional[str] = None
    overall_summary: Optional[str] = None
    status: StatusEnum
    created_at: datetime
    updated_at: datetime
    clusters: List[ClusterSummary] = []


class ClusterDetail(BaseModel):
    id: int
    video_id: int
    label: str
    summary: Optional[str] = None
    rep_comments_json: Optional[list] = None

