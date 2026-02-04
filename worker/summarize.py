"""Module for summarizing clusters using OpenAI API."""

from __future__ import annotations

import os
from typing import List, Tuple

from openai import OpenAI

# Initialize client lazily to allow module import without API key
_client = None

def get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY environment variable is not set")
        _client = OpenAI(api_key=api_key)
    return _client


def summarize_cluster(
    representative_texts: List[str],
    video_title: str | None = None,
) -> Tuple[str, str]:
    """
    Generate a label and summary for a cluster of comments.

    Args:
        representative_texts: List of representative comment strings
        video_title: Title of the video (optional context)

    Returns:
        Tuple of (label, summary)
        - label: Short topic name (8-18 chars)
        - summary: 2-3 sentence summary
    """
    client = get_client()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Take top 5 for context
    joined = "\n".join([f"- {t}" for t in representative_texts[:5]])

    system = (
        "あなたはコメントの論点を短く整理する編集者です。"
        "曖昧な一般論ではなく、コメントに実際に含まれる主張だけを要約してください。"
        "過度に断定せず、コメントのトーンを維持してください。"
    )

    user = f"""
対象: YouTube動画コメントの代表例（最大5件）
動画タイトル: {video_title or "不明"}

代表コメント:
{joined}

出力形式（厳守）:
LABEL: <短い論点名>
SUMMARY: <2〜3文の要約>
""".strip()

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=300,
        )

        text = resp.choices[0].message.content or ""
        label = ""
        summary = ""

        # Parse output
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("LABEL:"):
                label = line.replace("LABEL:", "").strip()
            elif line.startswith("SUMMARY:"):
                summary = line.replace("SUMMARY:", "").strip()

        # Fallback if parsing failed
        if not label:
            # If AI didn't follow format, try to use first line as label or generic
            cleaned_text = text.replace("LABEL:", "").strip()
            label = cleaned_text.split("\n")[0][:20] if cleaned_text else "論点"
        
        if not summary:
            # Use the whole text if summary tag missing
            summary = text.replace("SUMMARY:", "").strip()[:200]

        return label, summary

    except Exception as e:
        print(f"[summarize] Error generating summary: {e}")
        return "論点（生成エラー）", "要約の生成に失敗しました。"


def summarize_overall(
    clusters_data: List[dict],
    video_title: str | None = None,
) -> str:
    """
    Generate an overall summary from all cluster labels and summaries.

    Args:
        clusters_data: List of dicts with 'label', 'summary', 'size' keys
        video_title: Title of the video (optional context)

    Returns:
        Overall summary as markdown-formatted string with key points
    """
    if not clusters_data:
        return "クラスタが見つかりませんでした。"

    client = get_client()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Format cluster info
    cluster_info = "\n".join([
        f"- {c['label']} ({c['size']}件): {c['summary']}"
        for c in clusters_data
    ])

    system = (
        "あなたはYouTube動画のコメント分析結果を要約するアナリストです。"
        "各クラスタの論点を統合し、視聴者の反応の全体像を簡潔にまとめてください。"
        "具体的な意見内容を含め、読者がすぐに理解できる形にしてください。"
    )

    user = f"""
動画タイトル: {video_title or "不明"}

コメントクラスタの分析結果:
{cluster_info}

以下の形式で出力してください:

## コメントの要点
- 要点1（具体的な内容）
- 要点2（具体的な内容）
- 要点3（具体的な内容）

## 論点の傾向
（賛成/反対/中立の傾向や、特に多い意見について1〜2文で）
""".strip()

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=500,
        )

        result = resp.choices[0].message.content or ""
        return result.strip()

    except Exception as e:
        print(f"[summarize] Error generating overall summary: {e}")
        return "全体要約の生成に失敗しました。"
