export type ResolvedSource = {
  platform: "YouTube" | "X";
  title: string;
  sourceText: string;
  comments: string[];
  commentCount: number;
  fetchedAllComments: boolean;
  fetchedAt: string;
};

export function getYouTubeVideoId(input: string): string | null {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] ?? null;
    if (url.pathname.startsWith("/live/")) return url.pathname.split("/")[2] ?? null;
    if (url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2] ?? null;
  }

  return null;
}

export function detectSourcePlatform(input: string): "YouTube" | "X" | "Unknown" {
  if (getYouTubeVideoId(input)) return "YouTube";
  if (/(^|\/\/)(x\.com|twitter\.com)/i.test(input)) return "X";
  return "Unknown";
}
