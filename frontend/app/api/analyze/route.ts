import OpenAI from "openai";
import { NextResponse } from "next/server";
import type { InsightMap } from "@/lib/insights";

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

function extractJson(content: string): InsightMap {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned) as InsightMap;
}

function countCommentLines(comments: string | undefined): number {
  if (!comments) return 0;
  return comments
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function normalizeCommentText(comment: string): string {
  return comment.replace(/\s+/g, " ").trim();
}

function getCommentItems(comments: string | undefined, commentsList: string[] | undefined) {
  if (commentsList?.length) {
    return commentsList.map(normalizeCommentText).filter(Boolean);
  }

  if (!comments) return [];

  return comments
    .split(/\r?\n/)
    .map(normalizeCommentText)
    .filter(Boolean);
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
  });

  const schemaHint = `{
    "source": {"platform":"X|YouTube|Unknown","title":"string","coreClaim":"string"},
    "clusters": [{"id":"c1","label":"string","stance":"support|oppose|question|extension|meta","summary":"string","implication":"string","confidence":0.0,"volume":0,"representativeComments":["string"]}],
    "tensions": [{"axis":"string","sideA":"string","sideB":"string","whyItMatters":"string"}],
    "signals": [{"label":"string","detail":"string","severity":"low|medium|high"}],
    "nextQuestions": ["string"]
  }`;
  const commentItems = getCommentItems(body.comments, body.commentsList);
  const commentLineCount = body.commentsList?.length ?? countCommentLines(body.comments);
  const numberedComments = commentItems
    .map((comment, index) => `[C${index + 1}] ${comment}`)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "あなたはSNS/動画コメントの論点分析に強いリサーチアナリストです。",
            "入力から、論点クラスタ、示唆、対立軸、次に検証すべき問いを抽出してください。",
            "JSONキー名と enum 値以外のすべての文字列値は、必ず自然な日本語で書いてください。英語の label、summary、title、coreClaim、implication、axis、sideA、sideB、whyItMatters、detail、nextQuestions は禁止です。",
            "コメントが少ない場合でも反応量を推定で水増ししないでください。",
            "clusters[].volume は、そのクラスタに実際に対応する入力コメントの件数です。分類不能なら representativeComments.length と同じ数にしてください。",
            "representativeComments には必ず [C1] のようなコメントIDを含め、入力コメントを短くそのまま引用してください。入力にないコメントを作らないでください。",
            "コメントIDの境界を守ってください。コメント本文中の改行や句読点を別コメントとして数えないでください。",
            "断定できないことは signals に不確実性として入れてください。",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            "次の入力を分析し、必ずこのJSON形状だけで返してください。",
            schemaHint,
            "",
            "出力ルール:",
            "- platform と stance と severity の enum 以外はすべて日本語。",
            "- 入力コメント数が少ないときは、各コメントを無理に大きな世論として扱わない。",
            `- 入力コメント数は ${commentLineCount} 件。clusters[].volume の合計は、この件数を超えない。`,
            "- representativeComments は必ず下の番号付きコメント欄にある文だけを使い、対応するコメントIDを残す。",
            "- 論点が薄いミーム、定型句、感想、歌詞引用は無理に社会的示唆へ拡大せず、meta または support として扱う。",
            "",
            `URL:\n${body.url ?? ""}`,
            "",
            `投稿/動画本文:\n${body.sourceText ?? ""}`,
            "",
            `番号付きコメント/リプライ/引用:\n${numberedComments || body.comments || ""}`,
          ].join("\n"),
        },
      ],
      temperature: 0.2,
    });

    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error("DeepSeek returned an empty response.");

    return NextResponse.json(extractJson(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
