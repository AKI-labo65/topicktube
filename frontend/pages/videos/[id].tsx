import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getJson } from "../../lib/api";

type Cluster = {
  id: number;
  label: string;
  summary?: string;
  size: number;
  ord_x: number;
  ord_y: number;
  rep_comments_json?: Array<{ text: string; author?: string }>;
};

type Video = {
  id: number;
  youtube_id: string;
  title?: string;
  status: string;
  clusters: Cluster[];
};

export default function VideoPage() {
  const router = useRouter();
  const { id } = router.query;
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getJson<Video>(`/videos/${id}`)
      .then(setVideo)
      .catch(() => setError("動画データの取得に失敗しました"));
  }, [id]);

  const mapPointStyle = (c: Cluster) => {
    const x = ((c.ord_x + 1) / 2) * 100;
    const y = (1 - (c.ord_y + 1) / 2) * 100;
    const size = 12 + c.size * 1.2;
    return {
      position: "absolute" as const,
      left: `${x}%`,
      top: `${y}%`,
      width: size,
      height: size,
      borderRadius: "50%",
      background: "#0f172a",
      opacity: 0.8,
      transform: "translate(-50%, -50%)",
      cursor: "pointer",
    };
  };

  if (error) {
    return <div className="container">{error}</div>;
  }

  if (!video) {
    return <div className="container">読み込み中...</div>;
  }

  return (
    <div className="container">
      <h1>論点の全体像</h1>
      <p>動画ID: {video.youtube_id}</p>

      <div className="card" style={{ marginTop: 12 }}>
        <h3>簡易マップ</h3>
        <div style={{ position: "relative", height: 320, background: "#e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          {video.clusters.map((c) => (
            <div
              key={c.id}
              style={mapPointStyle(c)}
              title={c.label}
              onClick={() => router.push(`/clusters/${c.id}`)}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }} className="grid" >
        {video.clusters.map((c) => (
          <div key={c.id} className="card">
            <div style={{ fontWeight: 600 }}>{c.label}</div>
            <div style={{ color: "#475569", marginTop: 6 }}>{c.summary}</div>
            <div style={{ marginTop: 8, fontSize: 14 }}>コメント数の目安: {c.size}</div>
            <button className="button" style={{ marginTop: 10 }} onClick={() => router.push(`/clusters/${c.id}`)}>
              詳細を見る
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
