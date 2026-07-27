"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Download,
  ExternalLink,
  GitBranch,
  Layers3,
  Lightbulb,
  Loader2,
  Map,
  MessageSquareText,
  Network,
  Send,
  Settings2,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { InsightMap } from "@/lib/insights";
import type { ResolvedSource } from "@/lib/source";

const stanceLabels: Record<InsightMap["clusters"][number]["stance"], string> = {
  support: "賛同",
  oppose: "反論",
  question: "疑問",
  extension: "展開",
  meta: "メタ",
};

const severityLabels: Record<InsightMap["signals"][number]["severity"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const stanceOrder: InsightMap["clusters"][number]["stance"][] = [
  "support",
  "oppose",
  "question",
  "extension",
  "meta",
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [comments, setComments] = useState("");
  const [maxComments, setMaxComments] = useState(80);
  const [fetchAllComments, setFetchAllComments] = useState(true);
  const [resolvedSource, setResolvedSource] = useState<ResolvedSource | null>(null);
  const [result, setResult] = useState<InsightMap | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingLink, setIsFetchingLink] = useState(false);
  const [activeView, setActiveView] = useState<"map" | "clusters" | "signals">("map");

  const totalVolume = useMemo(
    () => result?.clusters.reduce((sum, cluster) => sum + cluster.volume, 0) ?? 0,
    [result],
  );
  const stanceSummary = useMemo(() => {
    if (!result) return [];

    return stanceOrder
      .map((stance) => {
        const volume = result.clusters
          .filter((cluster) => cluster.stance === stance)
          .reduce((sum, cluster) => sum + cluster.volume, 0);
        return { stance, volume };
      })
      .filter((item) => item.volume > 0);
  }, [result]);
  const averageConfidence = useMemo(() => {
    if (!result?.clusters.length) return 0;
    return Math.round(
      (result.clusters.reduce((sum, cluster) => sum + cluster.confidence, 0) / result.clusters.length) * 100,
    );
  }, [result]);

  async function fetchLink() {
    setIsFetchingLink(true);
    setError("");
    setResolvedSource(null);

    try {
      const response = await fetch("/api/resolve-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, maxComments, fetchAllComments }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "リンクの取得に失敗しました。");

      const resolved = data as ResolvedSource;
      setResolvedSource(resolved);
      setSourceText(resolved.sourceText);
      setComments(
        resolved.comments
          .map((comment, index) => `[C${index + 1}] ${comment.replace(/\s+/g, " ").trim()}`)
          .join("\n"),
      );
      setResult(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "リンクの取得に失敗しました。");
    } finally {
      setIsFetchingLink(false);
    }
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          sourceText,
          comments,
          commentsList: resolvedSource?.comments,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "分析に失敗しました。");
      setResult(data);
      setActiveView("map");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div className="appIdentity">
          <div className="brandMark"><Network size={20} /></div>
          <div>
            <strong>TopicTube</strong>
            <span>Discussion Workbench</span>
          </div>
        </div>
        <div className="headerStatus">
          <span><i />Full comments</span>
          <span><i />DeepSeek JSON</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="inputPane">
          <div className="panelHeading">
            <p className="eyebrow">New analysis</p>
            <h1>論点を採取する</h1>
            <p>リンク、本文、コメントをひとつの分析材料として整理します。</p>
          </div>

          <form onSubmit={analyze} className="formStack">
            <label>
              <span>コンテンツURL</span>
              <div className="linkRow">
                <div className="inputShell">
                  <ExternalLink size={17} />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="YouTube または X のURL"
                  />
                </div>
                <button type="button" className="secondaryButton" onClick={fetchLink} disabled={isFetchingLink}>
                  {isFetchingLink ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                  取得
                </button>
              </div>
            </label>

            <div className="sourceOptions">
              <label className="checkControl">
                <input
                  type="checkbox"
                  checked={fetchAllComments}
                  onChange={(event) => setFetchAllComments(event.target.checked)}
                />
                <span>全件取得</span>
              </label>
              <label className="countControl">
                <span>上限</span>
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={maxComments}
                  disabled={fetchAllComments}
                  onChange={(event) => setMaxComments(Number(event.target.value))}
                />
              </label>
            </div>

            {resolvedSource ? (
              <div className="sourceStatus">
                <div><span className="statusDot" />取得完了</div>
                <strong>{resolvedSource.title}</strong>
                <span>{resolvedSource.commentCount}件{resolvedSource.fetchedAllComments ? "・全件" : ""}</span>
              </div>
            ) : null}

            <details className="advancedInputs">
              <summary><Settings2 size={16} />手動入力</summary>
              <div className="advancedContent">
                <label>
                  <span>投稿・動画の内容</span>
                  <textarea
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                    rows={5}
                    placeholder="動画概要、字幕、投稿本文"
                  />
                </label>
                <label>
                  <span>コメント・リプライ</span>
                  <textarea
                    value={comments}
                    onChange={(event) => setComments(event.target.value)}
                    rows={9}
                    placeholder="1行に1コメント"
                  />
                </label>
              </div>
            </details>

            <button type="submit" className="primaryButton" disabled={isLoading} aria-busy={isLoading}>
              {isLoading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {isLoading ? "分析中" : "分析を開始"}
            </button>
          </form>
        </aside>

        <section className="resultPane">
          {error ? (
            <div className="emptyState errorState">
              <AlertTriangle size={28} />
              <strong>処理を完了できませんでした</strong>
              <p>{error}</p>
            </div>
          ) : result ? (
            <div className="dashboard">
              <header className="resultHeader">
                <div className="resultTitle">
                  <span className="platformBadge">{result.source.platform}</span>
                  <h2>{result.source.title}</h2>
                  <p>{result.source.coreClaim}</p>
                </div>
                <div className="statStrip">
                  <div><span>コメント</span><strong>{totalVolume}</strong></div>
                  <div><span>論点</span><strong>{result.clusters.length}</strong></div>
                  <div><span>確信度</span><strong>{averageConfidence}%</strong></div>
                </div>
              </header>

              <nav className="viewTabs" aria-label="分析ビュー">
                <button type="button" className={activeView === "map" ? "active" : ""} onClick={() => setActiveView("map")} aria-pressed={activeView === "map"}>
                  <Map size={16} />マップ
                </button>
                <button type="button" className={activeView === "clusters" ? "active" : ""} onClick={() => setActiveView("clusters")} aria-pressed={activeView === "clusters"}>
                  <Layers3 size={16} />論点
                </button>
                <button type="button" className={activeView === "signals" ? "active" : ""} onClick={() => setActiveView("signals")} aria-pressed={activeView === "signals"}>
                  <Activity size={16} />インサイト
                </button>
              </nav>

              {activeView === "map" ? (
                <section className="mapPanel">
                  <div className="mapHeader">
                    <div><p className="eyebrow">Comment map</p><h3>論点コメントマップ</h3></div>
                    <div className="stanceLegend">
                      {stanceSummary.map((item) => <span key={item.stance} className={item.stance}>{stanceLabels[item.stance]} {item.volume}</span>)}
                    </div>
                  </div>
                  <div className="commentMap">
                    <div className="claimNode"><span>中心主張</span><strong>{result.source.coreClaim}</strong></div>
                    <div className="mapNodes">
                      {result.clusters.map((cluster, index) => {
                        const share = totalVolume > 0 ? cluster.volume / totalVolume : 0;
                        const size = Math.max(140, Math.min(220, 140 + share * 240));
                        return (
                          <article key={cluster.id} className={`mapNode ${cluster.stance} ${index % 2 === 0 ? "upper" : "lower"}`} style={{ "--node-size": `${size}px` } as React.CSSProperties}>
                            <div><span>{stanceLabels[cluster.stance]}</span><strong>{cluster.volume}</strong></div>
                            <h4>{cluster.label}</h4><p>{cluster.summary}</p>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                  <div className="commentMatrix">
                    {result.clusters.map((cluster) => (
                      <article key={cluster.id} className={`matrixRow ${cluster.stance}`}>
                        <div className="matrixMeta"><span>{stanceLabels[cluster.stance]}</span><strong>{cluster.label}</strong><small>{cluster.volume}件</small></div>
                        <p>{cluster.implication}</p>
                        <div className="matrixComments">{cluster.representativeComments.slice(0, 3).map((comment) => <span key={comment}>{comment}</span>)}</div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {activeView === "clusters" ? (
                <section className="clusterGrid">
                  {result.clusters.map((cluster) => (
                    <article key={cluster.id} className={`cluster ${cluster.stance}`}>
                      <div className="clusterTop"><span>{stanceLabels[cluster.stance]}</span><meter min="0" max="1" value={cluster.confidence} /></div>
                      <h3>{cluster.label}</h3><p>{cluster.summary}</p>
                      <div className="implication"><Lightbulb size={16} /><span>{cluster.implication}</span></div>
                      <div className="commentList">{cluster.representativeComments.map((comment) => <div key={comment}><MessageSquareText size={15} /><span>{comment}</span></div>)}</div>
                    </article>
                  ))}
                </section>
              ) : null}

              {activeView === "signals" ? (
                <div className="insightView">
                  <div className="twoColumn">
                    <section className="panel"><h3><GitBranch size={18} />対立軸</h3>{result.tensions.map((tension) => <div className="tension" key={tension.axis}><strong>{tension.axis}</strong><div><span>{tension.sideA}</span><span>{tension.sideB}</span></div><p>{tension.whyItMatters}</p></div>)}</section>
                    <section className="panel"><h3><AlertTriangle size={18} />シグナル</h3>{result.signals.map((signal) => <div className="signal" key={signal.label}><span>{severityLabels[signal.severity]}</span><div><strong>{signal.label}</strong><p>{signal.detail}</p></div></div>)}</section>
                  </div>
                  <section className="questions"><h3>次に見るべき問い</h3><div>{result.nextQuestions.map((question) => <span key={question}>{question}</span>)}</div></section>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="startState">
              <header className="emptyHeader">
                <div><p className="eyebrow">Analysis workspace</p><h2>コメントの地形を読む</h2></div>
                <span className="emptyBadge">データ未取得</span>
              </header>
              <div className="previewMap" aria-hidden="true">
                <div className="previewClaim">
                  <span>source</span>
                  <strong>中心主張</strong>
                </div>
                <div className="previewNode support"><span>01</span>賛同</div>
                <div className="previewNode question"><span>02</span>疑問</div>
                <div className="previewNode extension"><span>03</span>展開</div>
                <div className="previewNode meta"><span>04</span>メタ</div>
              </div>
              <div className="emptyStats"><div><span>コメント</span><strong>0</strong></div><div><span>論点</span><strong>0</strong></div><div><span>シグナル</span><strong>0</strong></div></div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
