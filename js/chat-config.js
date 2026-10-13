// Chat configuration for the grounded homepage assistant.
// Keep API keys out of public repositories. Use environment-specific publishing when possible.
window.ILKIN_CHAT_CONFIG = {
  api: (() => {
    // Production endpoint is set once the backend is deployed; until then the live site
    // answers in the browser. Local previews use the backend on localhost:8000.
    const productionEndpoint = "https://ilkin-chat-api-601328376296.us-east1.run.app/chat";
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const endpoint = isLocal ? "http://localhost:8000/chat" : productionEndpoint;
    return {
      enabled: Boolean(endpoint),
      endpoint,
      sourceNote:
        "An LLM answers from my resume and public sources, then Vectara's HHEM model scores how well each answer is grounded."
    };
  })(),
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
