import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { getJson } from "../../lib/api";

type Cluster = {
  id: number;
  label: string;
  summary?: string;
  stance?: "support" | "skeptic" | "neutral";
  size: number;
  ord_x: number;
  ord_y: number;
  rep_comments_json?: Array<{ text: string; author?: string }>;
};

type Video = {
  id: number;
  youtube_id: string;
  title?: string;
  overall_summary?: string;
  status: string;
  clusters: Cluster[];
};

// Stance colors
const STANCE_COLORS = {
  support: "#3b82f6", // blue-500
  skeptic: "#ef4444", // red-500
  neutral: "#94a3b8", // slate-400
};

// Fallback palette
const CLUSTER_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6",
];

export default function VideoPage() {
  const router = useRouter();
  const { id } = router.query;
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<Cluster | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const cardRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  useEffect(() => {
    if (!id) return;
    getJson<Video>(`/videos/${id}`)
      .then(setVideo)
      .catch(() => setError("動画データの取得に失敗しました"));
  }, [id]);

  const getClusterColor = (c: Cluster, index: number) => {
    if (c.stance && STANCE_COLORS[c.stance]) {
      return STANCE_COLORS[c.stance];
    }
    return CLUSTER_COLORS[index % CLUSTER_COLORS.length];
  };

  const mapPointStyle = (c: Cluster, index: number) => {
    const x = ((c.ord_x + 1) / 2) * 100;
    const y = (1 - (c.ord_y + 1) / 2) * 100;
    const size = 14 + c.size * 1.5;
    const isHovered = hoveredCluster?.id === c.id;
    const isHighlighted = highlightedId === c.id;

    return {
      position: "absolute" as const,
      left: `${x}%`,
      top: `${y}%`,
      width: size,
      height: size,
      borderRadius: "50%",
      background: getClusterColor(c, index),
      opacity: isHovered || isHighlighted ? 1 : 0.85,
      transform: `translate(-50%, -50%) scale(${isHovered ? 1.3 : 1})`,
      cursor: "pointer",
      transition: "all 0.2s ease",
      boxShadow: isHovered || isHighlighted ? "0 4px 12px rgba(0,0,0,0.3)" : "none",
      border: isHighlighted ? "3px solid #fff" : "none",
    };
  };

  const handlePointClick = (cluster: Cluster) => {
    setHighlightedId(cluster.id);
    const cardEl = cardRefs.current[cluster.id];
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // Clear highlight after 2 seconds
    setTimeout(() => setHighlightedId(null), 2000);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  if (error) {
    return <div className="container">{error}</div>;
  }

  if (!video) {
    return <div className="container">読み込み中...</div>;
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${video.youtube_id}`;
  const thumbnailUrl = `https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg`;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(youtubeUrl);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="container">
      <h1>論点の全体像</h1>

      {/* Video Header Card */}
      <div
        className="card"
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          marginTop: 12,
        }}
      >
        {/* Thumbnail */}
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flexShrink: 0 }}
        >
          <img
            src={thumbnailUrl}
            alt="動画サムネイル"
            style={{
              width: 160,
              height: 90,
              objectFit: "cover",
              borderRadius: 8,
              background: "#e2e8f0",
            }}
          />
        </a>

        {/* Video Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            fontSize: 18,
            fontWeight: 600,
            margin: 0,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {video.title || video.youtube_id}
          </h2>

          <p style={{
            color: "#64748b",
            fontSize: 13,
            margin: "6px 0 12px",
          }}>
            動画ID: {video.youtube_id}
          </p>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              ▶ YouTubeで開く
            </a>
            <button
              className="button"
              onClick={handleCopyUrl}
              style={{
                background: copyFeedback ? "#10b981" : "#475569",
                fontSize: 14,
              }}
            >
              {copyFeedback ? "✓ コピーしました" : "🔗 URLをコピー"}
            </button>
          </div>
        </div>
      </div>

      {/* Overall Summary Card */}
      <div
        className="card"
        style={{
          marginTop: 16,
          background: video.overall_summary
            ? "linear-gradient(135deg, #fef3c7 0%, #fff7ed 100%)"
            : "#f8fafc",
          borderLeft: video.overall_summary
            ? "4px solid #f59e0b"
            : "4px solid #cbd5e1",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>📊 コメントの要点</h3>
        {video.overall_summary ? (
          <div
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 1.7,
              color: "#1e293b",
              whiteSpace: "pre-wrap",
            }}
            dangerouslySetInnerHTML={{
              __html: video.overall_summary
                .replace(/^## /gm, '<strong style="display:block;margin-top:12px;margin-bottom:4px;">')
                .replace(/\n(?=- )/g, '</strong>\n')
                .replace(/^- /gm, '• ')
            }}
          />
        ) : (
          <div style={{ marginTop: 12, fontSize: 14, color: "#64748b" }}>
            要約の生成に失敗しました。再解析してください。
          </div>
        )}
      </div>

      {/* Conflict Axis (Stance Balance) */}
      {video.clusters.some(c => c.stance) && (
        <div className="card" style={{ marginTop: 16, padding: "20px 24px" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>⚖️ 意見の対立軸 (全体バランス)</h3>

          {/* Bar Chart */}
          <div style={{ display: "flex", height: 24, borderRadius: 12, overflow: "hidden", background: "#f1f5f9" }}>
            {(() => {
              const total = video.clusters.reduce((sum, c) => sum + c.size, 0);
              const support = video.clusters.filter(c => c.stance === "support").reduce((sum, c) => sum + c.size, 0);
              const skeptic = video.clusters.filter(c => c.stance === "skeptic").reduce((sum, c) => sum + c.size, 0);
              const neutral = video.clusters.filter(c => c.stance === "neutral" || !c.stance).reduce((sum, c) => sum + c.size, 0);

              if (total === 0) return null;

              return (
                <>
                  {support > 0 && (
                    <div style={{ width: `${(support / total) * 100}%`, background: STANCE_COLORS.support }} title={`肯定的: ${support}件`} />
                  )}
                  {neutral > 0 && (
                    <div style={{ width: `${(neutral / total) * 100}%`, background: STANCE_COLORS.neutral }} title={`中立/その他: ${neutral}件`} />
                  )}
                  {skeptic > 0 && (
                    <div style={{ width: `${(skeptic / total) * 100}%`, background: STANCE_COLORS.skeptic }} title={`懐疑的: ${skeptic}件`} />
                  )}
                </>
              );
            })()}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 13, color: "#475569", justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: STANCE_COLORS.support }}></div>
              肯定的
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: STANCE_COLORS.neutral }}></div>
              中立・情報共有
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: STANCE_COLORS.skeptic }}></div>
              懐疑的・批判的
            </div>
          </div>
        </div>
      )}

      {/* Map Section */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>💬 意見マップ</h3>
        <p style={{ color: "#64748b", fontSize: 14, marginTop: -4 }}>
          点をホバーで詳細表示、クリックでカードへジャンプ
        </p>
        <div
          style={{
            position: "relative",
            height: 360,
            background: "linear-gradient(135deg, #e0e7ff 0%, #f0f9ff 100%)",
            borderRadius: 12,
            overflow: "hidden",
            marginTop: 12,
          }}
          onMouseMove={handleMouseMove}
        >
          {video.clusters.map((c, index) => (
            <button
              key={c.id}
              type="button"
              aria-label={`${c.label}: ${c.size}コメント`}
              style={{
                ...mapPointStyle(c, index),
                border: "none",
                outline: "none",
              }}
              onMouseEnter={() => setHoveredCluster(c)}
              onMouseLeave={() => setHoveredCluster(null)}
              onFocus={() => setHoveredCluster(c)}
              onBlur={() => setHoveredCluster(null)}
              onClick={() => handlePointClick(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handlePointClick(c);
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* Tooltip with edge detection */}
      {hoveredCluster && (
        <div
          style={(() => {
            const tooltipWidth = 280;
            const tooltipHeight = 120;
            const margin = 16;
            const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
            const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

            // Calculate position with edge detection
            let left = mousePos.x + margin;
            let top = mousePos.y + margin;

            // Flip horizontally if too close to right edge
            if (mousePos.x + tooltipWidth + margin > windowWidth) {
              left = mousePos.x - tooltipWidth - margin;
            }

            // Flip vertically if too close to bottom edge
            if (mousePos.y + tooltipHeight + margin > windowHeight) {
              top = mousePos.y - tooltipHeight - margin;
            }

            // Ensure minimum boundaries
            left = Math.max(8, left);
            top = Math.max(8, top);

            return {
              position: "fixed" as const,
              left,
              top,
              background: "#1e293b",
              color: "#fff",
              padding: "12px 16px",
              borderRadius: 10,
              maxWidth: tooltipWidth,
              zIndex: 1000,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              pointerEvents: "none" as const,
            };
          })()}
        >
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
            {hoveredCluster.label}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.9 }}>
            {hoveredCluster.summary || "要約なし"}
          </div>
          <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>
            💬 {hoveredCluster.size} コメント
          </div>
        </div>
      )}

      {/* Cluster Cards */}
      <div style={{ marginTop: 20 }}>
        <h3>📋 クラスタ一覧</h3>
        <div className="grid" style={{ marginTop: 12 }}>
          {video.clusters.map((c, index) => (
            <div
              key={c.id}
              ref={(el) => (cardRefs.current[c.id] = el)}
              className="card"
              style={{
                borderLeft: `5px solid ${getClusterColor(c, index)}`,
                transition: "all 0.3s ease",
                transform: highlightedId === c.id ? "scale(1.02)" : "scale(1)",
                boxShadow: highlightedId === c.id
                  ? `0 8px 24px ${getClusterColor(c, index)}40`
                  : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: getClusterColor(c, index),
                    flexShrink: 0,
                  }}
                />
                <div style={{ fontWeight: 600, fontSize: 16 }}>{c.label}</div>
              </div>
              <div style={{ color: "#475569", marginTop: 8, lineHeight: 1.6 }}>
                {c.summary}
              </div>
              <div style={{ marginTop: 12, fontSize: 14, color: "#64748b" }}>
                💬 コメント数: {c.size}
              </div>
              <button
                className="button"
                style={{ marginTop: 12 }}
                onClick={() => router.push(`/clusters/${c.id}`)}
              >
                詳細を見る →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
