// Chat configuration for the grounded homepage assistant.
// Keep API keys out of public repositories. Use environment-specific publishing when possible.
window.ILKIN_CHAT_CONFIG = {
  api: {
    enabled: false,
    endpoint: "http://localhost:8000/chat",
    sourceNote: "Grounded knowledge base is served by the backend index."
  },
  trust: {
    retrievalMinTopScore: 1.0,
    retrievalMinAverageTopScore: 0.58,
    sentenceSupportThreshold: 0.56,
    answerAverageSupportThreshold: 0.62
  },
  llm: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5-nano",
    apiKey: "",
    apiKeyHeader: "Authorization"
  }
};
