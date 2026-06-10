export type InsightMap = {
  source: {
    platform: "X" | "YouTube" | "Unknown";
    title: string;
    coreClaim: string;
  };
  clusters: Array<{
    id: string;
    label: string;
    stance: "support" | "oppose" | "question" | "extension" | "meta";
    summary: string;
    implication: string;
    confidence: number;
    volume: number;
    representativeComments: string[];
  }>;
  tensions: Array<{
    axis: string;
    sideA: string;
    sideB: string;
    whyItMatters: string;
  }>;
  signals: Array<{
    label: string;
    detail: string;
    severity: "low" | "medium" | "high";
  }>;
  nextQuestions: string[];
};
