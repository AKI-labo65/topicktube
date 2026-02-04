import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getJson } from "../../lib/api";

type ClusterDetail = {
  id: number;
  video_id: number;
  label: string;
  summary?: string;
  rep_comments_json?: Array<{ text: string; author?: string }>;
};

export default function ClusterPage() {
  const router = useRouter();
  const { id } = router.query;
  const [cluster, setCluster] = useState<ClusterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getJson<ClusterDetail>(`/clusters/${id}`)
      .then(setCluster)
      .catch(() => setError("クラスタ取得に失敗しました"));
  }, [id]);

  if (error) {
    return <div className="container">{error}</div>;
  }

  if (!cluster) {
    return <div className="container">読み込み中...</div>;
  }

  return (
    <div className="container">
      <h1>論点詳細</h1>
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{cluster.label}</div>
        <p style={{ color: "#475569", marginTop: 8 }}>{cluster.summary}</p>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>代表コメント</div>
          <div className="grid">
            {cluster.rep_comments_json?.map((c, idx) => (
              <div key={idx} style={{ padding: 10, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
                <div style={{ fontSize: 14 }}>{c.text}</div>
                {c.author && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>by {c.author}</div>}
              </div>
            )) || <div>まだ代表コメントがありません。</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
