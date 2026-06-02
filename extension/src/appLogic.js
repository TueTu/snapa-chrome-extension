export const parseSseEventJson = (eventText) => {
  const data = String(eventText || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  if (!data) return { empty: true };
  if (data === "[DONE]") return { done: true };

  try {
    return { json: JSON.parse(data) };
  } catch {
    return { malformed: true };
  }
};

export const isFreeOpenRouterModel = (model) => {
  const id = String(model?.id || "");
  const promptPrice = model?.pricing?.prompt;
  const completionPrice = model?.pricing?.completion;

  if (id.endsWith(":free")) return true;
  if (promptPrice === undefined || completionPrice === undefined) return false;

  return Number(promptPrice) === 0 && Number(completionPrice) === 0;
};

export const isTextOpenRouterModel = (model) => {
  const id = String(model?.id || "").toLowerCase();
  const blockedTerms = [
    "audio",
    "asr",
    "image",
    "imagine",
    "recraft",
    "tts",
    "transcribe",
    "vision",
    "vl",
    "video",
  ];

  return Boolean(id) && !blockedTerms.some((term) => id.includes(term));
};

export const scoreOpenRouterModel = (model, preferredPatterns = []) => {
  const id = String(model?.id || "").toLowerCase();
  let score = 0;

  preferredPatterns.forEach((pattern, index) => {
    if (id.includes(pattern)) score += 40 - index * 2;
  });

  if (id.includes("reasoning") || id.includes("deepseek-r1")) score -= 35;
  if (id.includes("preview") || id.includes("experimental")) score -= 8;
  if (id.includes("free")) score += 4;

  return score;
};
