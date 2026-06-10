"use client";

import {
  AlertTriangle,
  BarChart3,
  Download,
  ExternalLink,
  GitBranch,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Network,
  Send,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { InsightMap } from "@/lib/insights";
import type { ResolvedSource } from "@/lib/source";

const examples = {
  sourceText:
    "AI要約ツールは単なる時短ではなく、SNSや動画コメントから『次に作るべきコンテンツ』を発見する市場調査ツールになる。",
  comments:
    "たしかにYouTubeコメントは宝の山だけど、ノイズも多い\nXの引用RTは反論が多いから分析すると面白そう\nAPI料金が気になる。毎日大量に回すなら安いモデルが必要\n炎上時は要約だけだと危険。どのコメントを根拠にしたか見たい\nクリエイターだけでなく採用広報やCSでも使えるのでは\nコメント取得が規約的に大丈夫なのか知りたい\nDeepSeekで十分ならまずは安く試したい",
};

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

export default function Home() {
  const [url, setUrl] = useState("https://www.youtube.com/watch?v=example");
  const [sourceText, setSourceText] = useState(examples.sourceText);
  const [comments, setComments] = useState(examples.comments);
  const [maxComments, setMaxComments] = useState(80);
  const [resolvedSource, setResolvedSource] = useState<ResolvedSource | null>(null);
  const [result, setResult] = useState<InsightMap | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingLink, setIsFetchingLink] = useState(false);

  const totalVolume = useMemo(
    () => result?.clusters.reduce((sum, cluster) => sum + cluster.volume, 0) ?? 0,
    [result],
  );

  async function fetchLink() {
    setIsFetchingLink(true);
    setError("");
    setResolvedSource(null);

    try {
      const response = await fetch("/api/resolve-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, maxComments }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "リンクの取得に失敗しました。");

      const resolved = data as ResolvedSource;
      setResolvedSource(resolved);
      setSourceText(resolved.sourceText);
      setComments(resolved.comments.join("\n"));
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
        body: JSON.stringify({ url, sourceText, comments }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "分析に失敗しました。");
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="workspace">
        <aside className="inputPane">
          <div className="brandRow">
            <div className="brandMark">
              <Network size={22} />
            </div>
            <div>
              <p className="eyebrow">TopicTube</p>
              <h1>SNSと動画コメントの論点マップ</h1>
            </div>
          </div>

          <form onSubmit={analyze} className="formStack">
            <label>
              <span>URL</span>
              <div className="inputShell">
                <ExternalLink size={18} />
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="X または YouTube のリンク"
                />
              </div>
            </label>

            <div className="fetchControls">
              <label>
                <span>取得コメント数</span>
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={maxComments}
                  onChange={(event) => setMaxComments(Number(event.target.value))}
                />
              </label>
              <button type="button" className="secondaryButton" onClick={fetchLink} disabled={isFetchingLink}>
                {isFetchingLink ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
                リンクから取得
              </button>
            </div>

            {resolvedSource ? (
              <div className="sourceStatus">
                <strong>{resolvedSource.title}</strong>
                <span>
                  {resolvedSource.platform} から {resolvedSource.commentCount} 件取得
                </span>
              </div>
            ) : null}

            <label>
              <span>投稿・動画で述べられている内容</span>
              <textarea
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                rows={5}
                placeholder="動画概要、字幕、ポスト本文など"
              />
            </label>

            <label>
              <span>コメント・リプライ・引用RT</span>
              <textarea
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                rows={10}
                placeholder="1行に1コメントを目安に貼り付け"
              />
            </label>

            <button type="submit" disabled={isLoading}>
              {isLoading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              分析する
            </button>
          </form>
        </aside>

        <section className="resultPane">
          {error ? (
            <div className="emptyState errorState">
              <AlertTriangle size={28} />
              <p>{error}</p>
            </div>
          ) : result ? (
            <div className="dashboard">
              <header className="resultHeader">
                <div>
                  <p className="eyebrow">{result.source.platform}</p>
                  <h2>{result.source.title}</h2>
                  <p>{result.source.coreClaim}</p>
                </div>
                <div className="metric">
                  <BarChart3 size={20} />
                  <strong>{totalVolume}</strong>
                  <span>反応量</span>
                </div>
              </header>

              <div className="clusterGrid">
                {result.clusters.map((cluster) => (
                  <article key={cluster.id} className={`cluster ${cluster.stance}`}>
                    <div className="clusterTop">
                      <span>{stanceLabels[cluster.stance]}</span>
                      <meter min="0" max="1" value={cluster.confidence} />
                    </div>
                    <h3>{cluster.label}</h3>
                    <p>{cluster.summary}</p>
                    <div className="implication">
                      <Lightbulb size={16} />
                      <span>{cluster.implication}</span>
                    </div>
                    <div className="commentList">
                      {cluster.representativeComments.map((comment) => (
                        <div key={comment}>
                          <MessageSquareText size={15} />
                          <span>{comment}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              <div className="twoColumn">
                <section className="panel">
                  <h3>
                    <GitBranch size={18} />
                    対立軸
                  </h3>
                  {result.tensions.map((tension) => (
                    <div className="tension" key={tension.axis}>
                      <strong>{tension.axis}</strong>
                      <div>
                        <span>{tension.sideA}</span>
                        <span>{tension.sideB}</span>
                      </div>
                      <p>{tension.whyItMatters}</p>
                    </div>
                  ))}
                </section>

                <section className="panel">
                  <h3>
                    <AlertTriangle size={18} />
                    シグナル
                  </h3>
                  {result.signals.map((signal) => (
                    <div className="signal" key={signal.label}>
                      <span>{severityLabels[signal.severity]}</span>
                      <div>
                        <strong>{signal.label}</strong>
                        <p>{signal.detail}</p>
                      </div>
                    </div>
                  ))}
                </section>
              </div>

              <section className="panel questions">
                <h3>次に見るべき問い</h3>
                <div>
                  {result.nextQuestions.map((question) => (
                    <span key={question}>{question}</span>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="emptyState">
              <Network size={34} />
              <p>リンク、本文、コメントを貼ると論点クラスタと示唆を表示します。</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
