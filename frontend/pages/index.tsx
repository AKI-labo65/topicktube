import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getJson, postJson } from "../lib/api";

type JobStatus = {
  status: string;
  video_id?: number;
};

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (jobId && !status?.includes("done")) {
      interval = setInterval(async () => {
        try {
          const data = await getJson<JobStatus>(`/jobs/${jobId}`);
          setStatus(data.status);
          if (data.status === "done" && data.video_id) {
            clearInterval(interval);
            router.push(`/videos/${data.video_id}`);
          }
        } catch (e) {
          setError("ステータス取得に失敗しました");
          clearInterval(interval);
        }
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [jobId, router, status]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const data = await postJson<{ job_id: string }>("/analyze", { url });
      setJobId(data.job_id);
      setStatus("queued");
    } catch (err) {
      setError("解析キュー投入に失敗しました");
    }
  };

  return (
    <div className="container">
      <h1>コメント論点マップ (MVP)</h1>
      <p>URLを入れるとバックエンドでダミー解析を実行し、結果ページへ遷移します。</p>
      <form onSubmit={handleSubmit} className="card" style={{ display: "grid", gap: 12 }}>
        <label>
          YouTube URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            required
          />
        </label>
        <button className="button" type="submit" disabled={!url}>
          解析を開始
        </button>
      </form>

      {jobId && (
        <div style={{ marginTop: 16 }} className="card">
          <div>ジョブID: {jobId}</div>
          <div>ステータス: {status ?? "待機中"}</div>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, color: "#b91c1c" }}>
          {error}
        </div>
      )}
    </div>
  );
}
