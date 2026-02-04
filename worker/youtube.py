"""YouTube Data API v3 client for fetching video comments."""

import os
from typing import Optional

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


def get_api_key() -> str:
    """Get YouTube API key from environment variable."""
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY environment variable is not set")
    return api_key


def fetch_comments(
    video_id: str,
    api_key: Optional[str] = None,
    max_results: int = 100,
) -> list[dict]:
    """
    Fetch comments from a YouTube video.

    Args:
        video_id: YouTube video ID (e.g., 'dQw4w9WgXcQ')
        api_key: YouTube Data API key (uses env var if not provided)
        max_results: Maximum number of comments to fetch (default 100)

    Returns:
        List of comment dicts with keys: author, text, likes, published_at
    """
    if api_key is None:
        api_key = get_api_key()

    youtube = build("youtube", "v3", developerKey=api_key)

    comments = []
    next_page_token = None

    while len(comments) < max_results:
        try:
            request = youtube.commentThreads().list(
                part="snippet",
                videoId=video_id,
                maxResults=min(100, max_results - len(comments)),
                pageToken=next_page_token,
                textFormat="plainText",
                order="relevance",
            )
            response = request.execute()
        except HttpError as e:
            if e.resp.status == 403:
                raise ValueError(f"API quota exceeded or comments disabled: {e}")
            elif e.resp.status == 404:
                raise ValueError(f"Video not found: {video_id}")
            else:
                raise ValueError(f"YouTube API error: {e}")

        for item in response.get("items", []):
            snippet = item["snippet"]["topLevelComment"]["snippet"]
            comments.append({
                "author": snippet.get("authorDisplayName", "Unknown"),
                "text": snippet.get("textDisplay", ""),
                "likes": snippet.get("likeCount", 0),
                "published_at": snippet.get("publishedAt", ""),
            })

        next_page_token = response.get("nextPageToken")
        if not next_page_token:
            break

    return comments


def fetch_video_info(video_id: str, api_key: Optional[str] = None) -> dict:
    """
    Fetch video metadata.

    Returns:
        Dict with keys: title, channel, description
    """
    if api_key is None:
        api_key = get_api_key()

    youtube = build("youtube", "v3", developerKey=api_key)

    try:
        request = youtube.videos().list(part="snippet", id=video_id)
        response = request.execute()
    except HttpError as e:
        raise ValueError(f"YouTube API error: {e}")

    items = response.get("items", [])
    if not items:
        raise ValueError(f"Video not found: {video_id}")

    snippet = items[0]["snippet"]
    return {
        "title": snippet.get("title", ""),
        "channel": snippet.get("channelTitle", ""),
        "description": snippet.get("description", ""),
    }
