import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { InsightMap } from "@/lib/insights";

type NumberedComment = {
  id: string;
  text: string;
};

type ChunkInsight = {
  chunkId: string;
  commentRange: string;
  clusters: InsightMap["clusters"];
  tensions: InsightMap["tensions"];
  signals: InsightMap["signals"];
  nextQuestions: string[];
};

const fallback: InsightMap = {
  source: {
    platform: "Unknown",
    title: "サンプル分析",
    coreClaim:
      "貼られた投稿や動画の主張に対して、コメント群がどの論点に反応しているかを整理します。",
  },
  clusters: [
    {
      id: "c1",
      label: "前提への賛同",
      stance: "support",
      summary: "主張の方向性には賛成しつつ、補足情報や自分の経験を足している反応。",
      implication: "初期ユーザーは価値を感じており、深掘り記事や続編コンテンツに転換しやすい。",
      confidence: 0.82,
      volume: 34,
      representativeComments: [
        "これは現場でも同じことが起きている",
        "数字で見るとかなり納得感がある",
      ],
    },
    {
      id: "c2",
      label: "根拠不足への疑問",
      stance: "question",
      summary: "結論そのものより、データの出典や比較条件の公平性を気にしている反応。",
      implication: "信頼性を上げるには一次情報、条件、反例を明示する必要がある。",
      confidence: 0.76,
      volume: 21,
      representativeComments: [
        "その比較は母数が違うのでは",
        "ソースが分からないと判断しづらい",
      ],
    },
    {
      id: "c3",
      label: "別ユースケースへの展開",
      stance: "extension",
      summary: "元の論点を別業界、別ユーザー、別ツールに広げて考えている反応。",
      implication: "プロダクト化するなら、対象を一つに絞るより分析テンプレートを複数用意すると刺さる。",
      confidence: 0.71,
      volume: 15,
      representativeComments: [
        "教育系YouTubeでも使えそう",
        "採用広報の反応分析にも向いていそう",
      ],
    },
  ],
  tensions: [
    {
      axis: "スピード vs 正確性",
      sideA: "すぐ反応の温度感を知りたい",
      sideB: "誤読や炎上文脈を避けたい",
      whyItMatters: "自動要約だけでなく、根拠コメントへの導線が必要になる。",
    },
  ],
  signals: [
    {
      label: "APIキー未設定",
      detail: "DEEPSEEK_API_KEY を設定すると実入力を DeepSeek で分析します。",
      severity: "medium",
    },
  ],
  nextQuestions: [
    "どのコメントがクラスタを代表しているか",
    "反論のうち、改善に使えるものはどれか",
    "投稿者が次に返すべき論点は何か",
  ],
};

function detectPlatform(url: string): InsightMap["source"]["platform"] {
  if (/youtu\.be|youtube\.com/i.test(url)) return "YouTube";
  if (/(^|\/\/)(x\.com|twitter\.com)/i.test(url)) return "X";
  return "Unknown";
}

function extractJson<T>(content: string): T {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

function countCommentLines(comments: string | undefined): number {
  if (!comments) return 0;
  return comments
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function normalizeCommentText(comment: string, maxChars: number): string {
  const normalized = comment.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function getCommentItems(comments: string | undefined, commentsList: string[] | undefined, maxCommentChars: number) {
  if (commentsList?.length) {
    return commentsList.map((comment) => normalizeCommentText(comment, maxCommentChars)).filter(Boolean);
  }

  if (!comments) return [];

  return comments
    .split(/\r?\n/)
    .map((comment) => normalizeCommentText(comment, maxCommentChars))
    .filter(Boolean);
}

function toNumberedComments(commentItems: string[]): NumberedComment[] {
  return commentItems.map((comment, index) => ({
    id: `C${index + 1}`,
    text: comment.replace(/^\[C\d+\]\s*/i, ""),
  }));
}

function formatNumberedComments(comments: NumberedComment[]) {
  return comments.map((comment) => `[${comment.id}] ${comment.text}`).join("\n");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toPositiveEnvInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableDeepSeekError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /empty response|invalid json|unterminated|unexpected end|timeout|timedout|etimedout|econnreset|temporar|overload|rate limit|5\d\d/i.test(
    message,
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

function getSchemaHint() {
  return `{
    "source": {"platform":"X|YouTube|Unknown","title":"string","coreClaim":"string"},
    "clusters": [{"id":"c1","label":"string","stance":"support|oppose|question|extension|meta","summary":"string","implication":"string","confidence":0.0,"volume":0,"representativeComments":["string"]}],
    "tensions": [{"axis":"string","sideA":"string","sideB":"string","whyItMatters":"string"}],
    "signals": [{"label":"string","detail":"string","severity":"low|medium|high"}],
    "nextQuestions": ["string"]
  }`;
}

function getBaseSystemPrompt() {
  return [
    "あなたはSNS/動画コメントの論点分析に強いリサーチアナリストです。",
    "入力から、論点クラスタ、示唆、対立軸、次に検証すべき問いを抽出してください。",
    "出力は必ず有効な json object のみで、説明文やMarkdownを混ぜないでください。",
    "JSONキー名と enum 値以外のすべての文字列値は、必ず自然な日本語で書いてください。英語の label、summary、title、coreClaim、implication、axis、sideA、sideB、whyItMatters、detail、nextQuestions は禁止です。",
    "コメントが少ない場合でも反応量を推定で水増ししないでください。",
    "clusters[].volume は、そのクラスタに実際に対応する入力コメントの件数です。分類不能なら representativeComments.length と同じ数にしてください。",
    "representativeComments には必ず [C1] のようなコメントIDを含め、入力コメントを短くそのまま引用してください。入力にないコメントを作らないでください。",
    "representativeComments は各クラスタ最大3件、1件120文字以内にしてください。",
    "コメントIDの境界を守ってください。コメント本文中の改行や句読点を別コメントとして数えないでください。",
    "論点が薄いミーム、定型句、感想、歌詞引用は無理に社会的示唆へ拡大せず、meta または support として扱ってください。",
    "断定できないことは signals に不確実性として入れてください。",
  ].join(" ");
}

async function createJsonCompletion<T>(client: OpenAI, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const maxAttempts = toPositiveEnvInteger(process.env.DEEPSEEK_COMPLETION_ATTEMPTS, 2);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
        response_format: { type: "json_object" },
        messages,
        temperature: 0.2,
        max_tokens: toPositiveEnvInteger(process.env.DEEPSEEK_MAX_TOKENS, 5000),
        thinking: {
          type: process.env.DEEPSEEK_THINKING ?? "disabled",
        },
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
        thinking: { type: string };
      });
      const choice = completion.choices[0];
      const content = choice?.message.content;

      if (!content?.trim()) {
        throw new Error(`DeepSeek returned an empty response${choice?.finish_reason ? ` (${choice.finish_reason})` : ""}.`);
      }

      try {
        return extractJson<T>(content);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown parse error";
        throw new Error(`DeepSeek returned invalid JSON: ${message}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableDeepSeekError(error)) throw error;
      await wait(800 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("DeepSeek request failed.");
}

async function analyzeDirectly({
  client,
  url,
  sourceText,
  numberedComments,
}: {
  client: OpenAI;
  url: string;
  sourceText: string;
  numberedComments: NumberedComment[];
}) {
  const commentCount = numberedComments.length;

  return createJsonCompletion<InsightMap>(client, [
    {
      role: "system",
      content: getBaseSystemPrompt(),
    },
    {
      role: "user",
      content: [
        "次の入力を分析し、必ずこのJSON形状だけで返してください。",
        getSchemaHint(),
        "",
        "出力ルール:",
        "- platform と stance と severity の enum 以外はすべて日本語。",
        "- 入力コメント数が少ないときは、各コメントを無理に大きな世論として扱わない。",
        `- 入力コメント数は ${commentCount} 件。clusters[].volume の合計は、この件数を超えない。`,
        "- clusters は最大6個。tensions、signals、nextQuestions は最大4個ずつ。",
        "- representativeComments は必ず下の番号付きコメント欄にある文だけを使い、対応するコメントIDを残す。",
        "",
        `URL:\n${url}`,
        "",
        `投稿/動画本文:\n${sourceText}`,
        "",
        `番号付きコメント/リプライ/引用:\n${formatNumberedComments(numberedComments)}`,
      ].join("\n"),
    },
  ]);
}

async function analyzeChunk({
  client,
  chunk,
  chunkIndex,
  totalChunks,
  sourceText,
}: {
  client: OpenAI;
  chunk: NumberedComment[];
  chunkIndex: number;
  totalChunks: number;
  sourceText: string;
}) {
  const chunkSchema = `{
    "chunkId":"chunk-1",
    "commentRange":"C1-C120",
    "clusters":[{"id":"c1","label":"string","stance":"support|oppose|question|extension|meta","summary":"string","implication":"string","confidence":0.0,"volume":0,"representativeComments":["[C1] string"]}],
    "tensions":[{"axis":"string","sideA":"string","sideB":"string","whyItMatters":"string"}],
    "signals":[{"label":"string","detail":"string","severity":"low|medium|high"}],
    "nextQuestions":["string"]
  }`;
  const firstId = chunk[0]?.id ?? "C?";
  const lastId = chunk[chunk.length - 1]?.id ?? "C?";

  return createJsonCompletion<ChunkInsight>(client, [
    {
      role: "system",
      content: getBaseSystemPrompt(),
    },
    {
      role: "user",
      content: [
        `これは全${totalChunks}チャンク中の${chunkIndex + 1}番目です。このチャンク内だけを分析してください。`,
        "必ずこのJSON形状だけで返してください。",
        chunkSchema,
        "",
        "出力ルール:",
        `- chunkId は "chunk-${chunkIndex + 1}"。commentRange は "${firstId}-${lastId}"。`,
        `- このチャンクのコメント数は ${chunk.length} 件。clusters[].volume の合計はこの件数を超えない。`,
        "- clusters は最大6個。tensions、signals、nextQuestions は最大4個ずつ。",
        "- 代表コメントには必ずコメントIDを残す。",
        "- 後段で統合するため、似た論点でもラベルと要約は具体的に書く。",
        "",
        `投稿/動画本文:\n${sourceText.slice(0, 2200)}`,
        "",
        `番号付きコメント:\n${formatNumberedComments(chunk)}`,
      ].join("\n"),
    },
  ]);
}

async function integrateChunkInsights({
  client,
  url,
  sourceText,
  totalCommentCount,
  chunks,
}: {
  client: OpenAI;
  url: string;
  sourceText: string;
  totalCommentCount: number;
  chunks: ChunkInsight[];
}) {
  return createJsonCompletion<InsightMap>(client, [
    {
      role: "system",
      content: getBaseSystemPrompt(),
    },
    {
      role: "user",
      content: [
        "複数チャンクのコメント分析結果を統合し、最終的な論点マップを作ってください。",
        "必ずこのJSON形状だけで返してください。",
        getSchemaHint(),
        "",
        "統合ルール:",
        "- 似たクラスタを統合し、全体で3〜8個程度の主要クラスタにまとめる。",
        `- 全コメント数は ${totalCommentCount} 件。clusters[].volume の合計はこの件数を超えない。`,
        "- 各クラスタのvolumeは統合元チャンクの件数を足し合わせる。ただし同じコメントIDを重複カウントしない。",
        "- representativeComments はチャンク分析に含まれるコメントID付き引用だけから選ぶ。各クラスタ最大3件。",
        "- 一部チャンクだけの局所的な反応と、全体で強い反応を区別する。",
        "- シグナルには、コメント全体から見た不確実性、偏り、取得条件の注意点を入れる。",
        "",
        `URL:\n${url}`,
        "",
        `投稿/動画本文:\n${sourceText.slice(0, 2600)}`,
        "",
        `チャンク分析結果JSON:\n${JSON.stringify(chunks)}`,
      ].join("\n"),
    },
  ]);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    url?: string;
    sourceText?: string;
    comments?: string;
    commentsList?: string[];
  };

  if (!body.url && !body.sourceText && !body.comments) {
    return NextResponse.json({ error: "分析するURL、本文、コメントのいずれかを入力してください。" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      ...fallback,
      source: {
        ...fallback.source,
        platform: detectPlatform(body.url ?? ""),
        title: body.url || fallback.source.title,
      },
    });
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    timeout: toPositiveEnvInteger(process.env.DEEPSEEK_TIMEOUT_MS, 120000),
    maxRetries: toPositiveEnvInteger(process.env.DEEPSEEK_SDK_RETRIES, 1),
  });

  const maxCommentChars = toPositiveEnvInteger(process.env.ANALYZE_MAX_COMMENT_CHARS, 700);
  const commentItems = getCommentItems(body.comments, body.commentsList, maxCommentChars);
  const numberedComments = toNumberedComments(commentItems);
  const directAnalysisLimit = toPositiveEnvInteger(process.env.ANALYZE_DIRECT_COMMENT_LIMIT, 40);
  const chunkSize = toPositiveEnvInteger(process.env.ANALYZE_CHUNK_SIZE, 40);
  const chunkConcurrency = toPositiveEnvInteger(process.env.ANALYZE_CHUNK_CONCURRENCY, 3);

  try {
    if (numberedComments.length <= directAnalysisLimit) {
      return NextResponse.json(
        await analyzeDirectly({
          client,
          url: body.url ?? "",
          sourceText: body.sourceText ?? "",
          numberedComments,
        }),
      );
    }

    const commentChunks = chunkArray(numberedComments, chunkSize);
    const chunkInsights = await mapWithConcurrency(commentChunks, chunkConcurrency, (chunk, index) =>
      analyzeChunk({
        client,
        chunk,
        chunkIndex: index,
        totalChunks: commentChunks.length,
        sourceText: body.sourceText ?? "",
      }),
    );

    return NextResponse.json(
      await integrateChunkInsights({
        client,
        url: body.url ?? "",
        sourceText: body.sourceText ?? "",
        totalCommentCount: numberedComments.length,
        chunks: chunkInsights,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
