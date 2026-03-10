// Chat configuration for the grounded homepage assistant.
// Keep API keys out of public repositories. Use environment-specific publishing when possible.
window.ILKIN_CHAT_CONFIG = {
  trust: {
    retrievalMinTopScore: 1.0,
    retrievalMinAverageTopScore: 0.58,
    sentenceSupportThreshold: 0.56,
    answerAverageSupportThreshold: 0.62
  },
  llm: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1-mini",
    apiKey: "",
    apiKeyHeader: "Authorization"
  },
  vectara: {
    endpoint: "https://api.vectara.io/v2/evaluate_factual_consistency",
    apiKey: "",
    enabled: true
  }
};
