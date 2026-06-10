import { NextResponse } from "next/server";
import { detectSourcePlatform, getYouTubeVideoId, type ResolvedSource } from "@/lib/source";

type YouTubeVideoResponse = {
  items?: Array<{
    snippet?: {
      title?: string;
      channelTitle?: string;
      description?: string;
      publishedAt?: string;
    };
    statistics?: {
      commentCount?: string;
      viewCount?: string;
      likeCount?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type YouTubeCommentsResponse = {
  nextPageToken?: string;
  items?: Array<{
    snippet?: {
      topLevelComment?: {
        snippet?: {
          textDisplay?: string;
          textOriginal?: string;
          authorDisplayName?: string;
          likeCount?: number;
          publishedAt?: string;
        };
      };
      totalReplyCount?: number;
    };
  }>;
  error?: {
    message?: string;
  };
};

function decodeHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toPositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function fetchYouTubeJson<T>(path: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${searchParams}`, {
    cache: "no-store",
  });
  const data = (await response.json()) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(data.error?.message ?? "YouTube API request failed.");
  }

  return data;
}

async function resolveYouTube(url: string, maxComments: number): Promise<ResolvedSource> {
  const videoId = getYouTubeVideoId(url);
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!videoId) {
    throw new Error("YouTube動画URLを認識できませんでした。");
  }

  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY が未設定です。YouTubeコメント取得には YouTube Data API キーが必要です。");
  }

  const video = await fetchYouTubeJson<YouTubeVideoResponse>("videos", {
    key: apiKey,
    id: videoId,
    part: "snippet,statistics",
  });
  const item = video.items?.[0];

  if (!item) {
    throw new Error("動画情報を取得できませんでした。非公開、削除済み、またはURLが誤っている可能性があります。");
  }

  const comments: string[] = [];
  let pageToken = "";

  while (comments.length < maxComments) {
    const batchSize = Math.min(100, maxComments - comments.length);
    const commentData = await fetchYouTubeJson<YouTubeCommentsResponse>("commentThreads", {
      key: apiKey,
      videoId,
      part: "snippet",
      order: "relevance",
      textFormat: "plainText",
      maxResults: String(batchSize),
      ...(pageToken ? { pageToken } : {}),
    });

    const batch =
      commentData.items
        ?.map((comment) => {
          const snippet = comment.snippet?.topLevelComment?.snippet;
          const text = snippet?.textOriginal || snippet?.textDisplay || "";
          return decodeHtml(text);
        })
        .filter(Boolean) ?? [];

    comments.push(...batch);

    if (!commentData.nextPageToken || batch.length === 0) break;
    pageToken = commentData.nextPageToken;
  }

  const snippet = item.snippet;
  const statistics = item.statistics;
  const sourceText = [
    `タイトル: ${snippet?.title ?? "不明"}`,
    snippet?.channelTitle ? `チャンネル: ${snippet.channelTitle}` : "",
    snippet?.publishedAt ? `公開日: ${snippet.publishedAt}` : "",
    statistics?.viewCount ? `再生数: ${statistics.viewCount}` : "",
    statistics?.likeCount ? `高評価数: ${statistics.likeCount}` : "",
    statistics?.commentCount ? `コメント数: ${statistics.commentCount}` : "",
    "",
    snippet?.description ? `概要:\n${decodeHtml(snippet.description).slice(0, 1800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    platform: "YouTube",
    title: snippet?.title ?? url,
    sourceText,
    comments,
    commentCount: comments.length,
    fetchedAt: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    url?: string;
    maxComments?: number;
  };
  const url = body.url?.trim() ?? "";

  if (!url) {
    return NextResponse.json({ error: "URLを入力してください。" }, { status: 400 });
  }

  const platform = detectSourcePlatform(url);
  const maxComments = toPositiveInteger(body.maxComments, 80, 300);

  try {
    if (platform === "YouTube") {
      return NextResponse.json(await resolveYouTube(url, maxComments));
    }

    if (platform === "X") {
      return NextResponse.json(
        {
          error:
            "Xのリプライ・引用取得は未実装です。X APIの有料プランまたは公式エクスポート/手動貼り付けに対応する取得方式を選ぶ必要があります。",
        },
        { status: 501 },
      );
    }

    return NextResponse.json(
      { error: "対応しているURLは YouTube 動画リンクと X 投稿リンクです。" },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "リンクの取得に失敗しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
