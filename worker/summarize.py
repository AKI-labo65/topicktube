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
) -> Tuple[str, str, str]:
    """
    Generate a label, summary, and stance for a cluster of comments.

    Args:
        representative_texts: List of representative comment strings
        video_title: Title of the video (optional context)

    Returns:
        Tuple of (label, summary, stance)
        - label: Short topic name (8-18 chars)
        - summary: 2-3 sentence summary
        - stance: 'support', 'skeptic', or 'neutral'
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
STANCE: <support|skeptic|neutral> (動画内容に対して肯定的=support, 懐疑的/批判的=skeptic, 中立/その他=neutral)
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
        stance = "neutral"

        # Parse output
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("LABEL:"):
                label = line.replace("LABEL:", "").strip()
            elif line.startswith("SUMMARY:"):
                summary = line.replace("SUMMARY:", "").strip()
            elif line.startswith("STANCE:"):
                parsed_stance = line.replace("STANCE:", "").strip().lower()
                if parsed_stance in ["support", "skeptic", "neutral"]:
                    stance = parsed_stance

        # Fallback if parsing failed
        if not label:
            # If AI didn't follow format, try to use first line as label or generic
            cleaned_text = text.replace("LABEL:", "").strip()
            label = cleaned_text.split("\n")[0][:20] if cleaned_text else "論点"
        
        if not summary:
            # Use the whole text if summary tag missing
            summary = text.replace("SUMMARY:", "").strip()[:200]

        return label, summary, stance

    except Exception as e:
        print(f"[summarize] Error generating summary: {e}")
        return "論点（生成エラー）", "要約の生成に失敗しました。", "neutral"


def summarize_overall(
    clusters_data: List[dict],
    video_title: str | None = None,
) -> str | None:
    """
    Generate an overall summary from all cluster labels and summaries.

    Args:
        clusters_data: List of dicts with 'label', 'summary', 'size' keys
        video_title: Title of the video (optional context)

    Returns:
        Overall summary as markdown-formatted string with key points, or None if failed
    """
    if not clusters_data:
        return None

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
        return None


def summarize_issue_outline(
    clusters_data: List[dict],
    video_title: str | None = None,
    video_summary: str | None = None,
) -> str | None:
    """
    Generate a structured issue outline (issues, disputes, agreements, unanswered questions).

    Args:
        clusters_data: List of dicts with 'label', 'summary', 'size', 'stance' keys
        video_title: Title of the video (optional context)
        video_summary: Summary of the video content (optional context)

    Returns:
        Markdown string with structured issue outline, or None if failed
    """
    if not clusters_data:
        return None

    client = get_client()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Format cluster info
    cluster_info = "\n".join([
        f"- {c['label']} ({c['size']}件, {c['stance']}): {c['summary']}"
        for c in clusters_data
    ])

    system = (
        "あなたは動画コメントを分析するアナリストです。"
        "コメント群から「主要論点」「何が対立しているか（争点）」「何が合意されているか（合意点）」「未解決の問い」を整理してください。"
        "動画内容の要約も提供されている場合は、コメントが動画のどの部分に反応しているかも考慮してください。"
    )

    user = f"""
動画タイトル: {video_title or "不明"}
動画内容の要約: {video_summary or "なし"}

コメントクラスタの分析結果:
{cluster_info}

以下のセクション形式で、Markdownで出力してください（見出しは ## を使用）:

## 📌 主要論点
（議論の中心となっているトピックを3〜6個程度。各1行タイトル＋2〜3行の説明）

## ⚔️ 争点（対立ポイント）
（肯定派と懐疑派で意見が分かれている点。具体的にどこで対立しているか）

## 🤝 合意点・共通認識
（スタンスに関わらず多くの人が同意している点、または前提として共有されている事実）

## ❓ 未解決の問い・残された課題
（結論が出ていない疑問、証拠不足の指摘、今後の懸念点など）
""".strip()

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=800,
        )

        result = resp.choices[0].message.content or ""
        return result.strip()

    except Exception as e:
        print(f"[summarize] Error generating issue outline: {e}")
        return None


def summarize_video_content(
    transcript_text: str,
    title: str = "",
    description: str = "",
) -> str | None:
    """
    Generate a summary of the video content based on transcript (or description).
    """
    if not transcript_text and not description:
        return None

    client = get_client()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Access text limit (truncate if too long)
    # gpt-4o-mini context is large (128k), but let's limit to ~15k chars to be safe and fast
    limit = 15000
    context_text = transcript_text[:limit]
    if len(transcript_text) > limit:
        context_text += "...(truncated)"
    
    system = (
        "あなたは動画の内容を要約するアシスタントです。"
        "提供された字幕（または説明文）をもとに、動画で語られている主要な内容、結論、エピソードなどを300文字程度で簡潔にまとめてください。"
    )

    user = f"""
動画タイトル: {title}
説明文: {description[:500]}

字幕データ:
{context_text}

要約:
""".strip()

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=400,
        )

        return (resp.choices[0].message.content or "").strip()

    except Exception as e:
        print(f"[summarize] Error generating video summary: {e}")
        return None
