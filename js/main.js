(() => {
  const DEFAULT_CHAT_CONFIG = Object.freeze({
    knowledgeBaseUrl: "data/page-index.json",
    api: {
      enabled: false,
      endpoint: "",
      sourceNote: "Grounded knowledge base served by the chat backend."
    },
    retrieval: {
      topK: 6,
      maxContextChars: 4600
    },
    trust: {
      retrievalMinTopScore: 1.0,
      retrievalMinAverageTopScore: 0.58,
      retrievalMinTopMatches: 1,
      sentenceSupportThreshold: 0.56,
      answerAverageSupportThreshold: 0.62,
      majorClaimMinTokens: 4
    },
    llm: {
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-5-nano",
      apiKey: "",
      apiKeyHeader: "Authorization",
      temperature: 0.15,
      maxTokens: 520
    }
  });

  const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or", "our", "should", "so", "that", "the", "their", "them", "there", "these", "they", "this", "to", "was", "we", "what", "when", "where", "which", "who", "why", "with", "you", "your"
  ]);

  const THEME_EXPANSIONS = [
    {
      match: ["about", "background", "story", "journey", "moved", "turkey", "ucf"],
      add: ["phd", "turkey", "ucf", "journey", "motive"]
    },
    {
      match: ["project", "projects", "build", "building", "work"],
      add: ["platform", "mcp", "rag", "llm", "engineer"]
    },
    {
      match: ["research", "publication", "paper", "medical", "imaging"],
      add: ["medical", "imaging", "uncertainty", "explainable", "trustworthy", "tumor"]
    },
    {
      match: ["strength", "powerlifting", "athlete", "champion", "record", "deadlift", "squat", "bench", "pr", "max"],
      add: ["powerlifting", "champion", "record", "european", "ipsu", "deadlift", "squat", "bench", "pr"]
    },
    {
      match: ["media", "article", "feature", "youtube", "interview"],
      add: ["article", "mind", "move", "mountains", "media"]
    },
    {
      match: ["contact", "reach", "email", "linkedin", "scholar"],
      add: ["email", "linkedin", "scholar", "contact"]
    }
  ];

  const EXAMPLE_QUESTION_ANSWERS = Object.freeze({
    "can you tell me about your background": {
      answer:
        "I moved from Turkey to the U.S. to pursue AI at UCF, where I completed my MS (2022) and PhD (2025) in Computer Science. I focus on building trustworthy AI for high-stakes real-world decisions.",
      citations: [
        { id: "resume", label: "Resume" },
        { id: "mind_to_move", label: "The Mind to Move Mountains" }
      ],
      links: [
        { label: "Open UCF Article", href: "https://www.ucf.edu/news/the-mind-to-move-mountains/" },
        { label: "Open Resume", href: "assets/resumeilkinisler-nov5.pdf" }
      ]
    },
    "what projects are you building": {
      answer:
        "I’m building trustworthy AI systems and LLM/RAG workflows for high-impact environments, including uncertainty-aware decision support, explainability, and hallucination-aware pipelines.",
      citations: [
        { id: "resume", label: "Resume" },
        { id: "profile_facts", label: "Profile Facts" }
      ],
      links: [{ label: "Open GitHub", href: "https://github.com/ilkinisler" }]
    },
    "what is your research focus": {
      answer:
        "My research focuses on medical imaging, explainable AI, and uncertainty modeling, with the goal of building systems that clinicians and real-world operators can actually trust. During my PhD, my dissertation centered on advanced AI algorithms for medical imaging, including tumor and organ-at-risk segmentation. More recently at Universal Creative, I architected and built a secure, production-grade MCP-based AI platform from scratch, designed RBAC/authentication/security hardening for safe ML deployment, and developed LLM + RAG solutions with hallucination detection, groundedness evaluation, citation, meta tagging, and topic modeling.",
      citations: [
        { id: "resume", label: "Resume" },
        { id: "mind_to_move", label: "The Mind to Move Mountains" }
      ],
      links: [{ label: "Open Google Scholar", href: "https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en" }]
    },
    "how much can you deadlift": {
      answer:
        "Haha, my deadlift PR is 475 lbs, and yes, I pull sumo.",
      citations: [{ id: "profile_facts", label: "Profile Facts" }]
    },
    "where can i see your media links": {
      answer:
        "The best place to start is my UCF feature article, The Mind to Move Mountains. You can also follow updates on LinkedIn and my publication list on Google Scholar.",
      citations: [{ id: "mind_to_move", label: "The Mind to Move Mountains" }],
      links: [
        { label: "Open UCF Article", href: "https://www.ucf.edu/news/the-mind-to-move-mountains/" },
        { label: "Open LinkedIn", href: "https://www.linkedin.com/in/ilkinsevgiisler/" },
        { label: "Open Google Scholar", href: "https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en" }
      ]
    },
    "how can i contact you": {
      answer:
        "The best way to reach me is by email. You can also message me on LinkedIn.",
      citations: [{ id: "resume", label: "Resume" }],
      links: [
        { label: "Email Me", href: "mailto:ilkinisler@gmail.com" },
        { label: "Open LinkedIn", href: "https://www.linkedin.com/in/ilkinsevgiisler/" }
      ]
    }
  });

  document.addEventListener("DOMContentLoaded", async () => {
    await injectPartials();
    trimHomeNavLinks();
    syncHeaderOffset();
    markActiveNav();
    initHomeReturnButton();
    initMobileNav();
    setFooterYear();
    initReveals();
    initShortcutButtons();
    await initBioChatbot();
    window.addEventListener("resize", syncHeaderOffset);
  });

  async function injectPartials() {
    const placeholders = [...document.querySelectorAll("[data-include]")];
    if (!placeholders.length) {
      return;
    }

    await Promise.all(
      placeholders.map(async (placeholder) => {
        const source = placeholder.getAttribute("data-include");
        if (!source) {
          return;
        }

        try {
          const response = await fetch(source, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`Unable to fetch ${source}`);
          }
          placeholder.innerHTML = await response.text();
        } catch (error) {
          console.error(error);
          placeholder.innerHTML = "";
        }
      })
    );
  }

  function markActiveNav() {
    const page = document.body.dataset.page;
    if (!page) {
      return;
    }

    const links = document.querySelectorAll(".site-nav-link[data-nav]");
    links.forEach((link) => {
      if (link.dataset.nav === page) {
        link.classList.add("active");
      }
    });
  }

  function trimHomeNavLinks() {
    if (document.body.dataset.page !== "home") {
      return;
    }

    const nav = document.querySelector(".site-nav");
    if (nav) {
      nav.remove();
    }

    const toggle = document.querySelector("[data-nav-toggle]");
    if (toggle) {
      toggle.remove();
    }
  }

  function initHomeReturnButton() {
    const page = document.body.dataset.page;
    if (!page || page === "home") {
      return;
    }

    const shell = document.querySelector(".page-frame .site-shell");
    if (!shell || shell.querySelector("[data-home-return]")) {
      return;
    }

    const homeLink = document.createElement("a");
    homeLink.className = "button secondary page-home-link";
    homeLink.href = "index.html";
    homeLink.setAttribute("data-home-return", "true");
    homeLink.setAttribute("aria-label", "Back to home");
    homeLink.textContent = "←";

    const container = document.createElement("div");
    container.className = "page-home-return";
    container.appendChild(homeLink);
    shell.insertBefore(container, shell.firstChild);
  }

  function syncHeaderOffset() {
    const header = document.querySelector("[data-site-header]");
    const root = document.documentElement;
    const headerHeight = header ? header.offsetHeight : 0;
    root.style.setProperty("--header-offset", `${headerHeight}px`);
  }

  function initMobileNav() {
    const header = document.querySelector("[data-site-header]");
    const toggle = document.querySelector("[data-nav-toggle]");
    if (!header || !toggle) {
      return;
    }

    const closeNav = () => {
      header.dataset.open = "false";
      toggle.setAttribute("aria-expanded", "false");
    };

    toggle.addEventListener("click", () => {
      const currentlyOpen = header.dataset.open === "true";
      header.dataset.open = currentlyOpen ? "false" : "true";
      toggle.setAttribute("aria-expanded", String(!currentlyOpen));
    });

    document.addEventListener("click", (event) => {
      if (!header.contains(event.target)) {
        closeNav();
      }
    });

    document.querySelectorAll(".site-nav-link").forEach((link) => {
      link.addEventListener("click", closeNav);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 1120) {
        closeNav();
      }
    });
  }

  function setFooterYear() {
    const year = document.getElementById("year");
    if (year) {
      year.textContent = String(new Date().getFullYear());
    }
  }

  function initReveals() {
    const targets = document.querySelectorAll(".reveal");
    if (!targets.length) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      targets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.15,
        rootMargin: "0px 0px -6% 0px"
      }
    );

    targets.forEach((target) => observer.observe(target));
  }

  function initShortcutButtons() {
    document.querySelectorAll("[data-command-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const href = button.getAttribute("data-command-target");
        if (href) {
          window.location.href = href;
        }
      });
    });
  }

  function normalizeQuestionForPreset(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getManualExampleAnswer(question) {
    const key = normalizeQuestionForPreset(question);
    const preset = EXAMPLE_QUESTION_ANSWERS[key];
    if (!preset) {
      return null;
    }

    return {
      answer: preset.answer,
      citations: preset.citations || [],
      support: [],
      links: preset.links || [],
      notice: ""
    };
  }

  async function initBioChatbot() {
    const root = document.querySelector("[data-bio-chatbot]");
    if (!root) {
      return;
    }

    const intro = root.querySelector("[data-chat-intro]");
    const sourceNote = root.querySelector("[data-chat-source-note]");
    const log = root.querySelector("[data-chat-log]");
    const form = root.querySelector("[data-chat-form]");
    const input = root.querySelector("[data-chat-input]");
    const send = form ? form.querySelector(".chat-send") : null;
    const suggestionButtons = [...document.querySelectorAll("[data-chat-suggestion]")];

    if (!intro || !log || !form || !input || !send) {
      return;
    }

    intro.textContent = "Tell me what you need and I will pull the right projects, research, CV, media, or contact links.";

    const chatConfig = mergeConfig(DEFAULT_CHAT_CONFIG, window.ILKIN_CHAT_CONFIG || {});
    const backendEnabled = Boolean(chatConfig.api?.enabled && chatConfig.api?.endpoint);

    let retrievalIndex = null;
    if (backendEnabled) {
      if (sourceNote) {
        sourceNote.textContent =
          chatConfig.api?.sourceNote || "Grounded knowledge base served by the chat backend.";
      }
    } else {
      try {
        const knowledgeBase = await loadKnowledgeBase(chatConfig.knowledgeBaseUrl);
        retrievalIndex = buildRetrievalIndex(knowledgeBase);
        if (sourceNote) {
          sourceNote.textContent = buildSourceNote(knowledgeBase);
        }
      } catch (error) {
        console.error(error);
        if (sourceNote) {
          sourceNote.textContent = "Knowledge base unavailable. Check data/page-index.json.";
        }
      }
    }

    let busy = false;

    const setBusy = (value) => {
      busy = value;
      form.setAttribute("aria-busy", String(value));
      input.disabled = value;
      send.disabled = value;
      suggestionButtons.forEach((button) => {
        button.disabled = value;
      });
    };

    const submitQuestion = async (question) => {
      const q = question.trim();
      if (!q || busy) {
        return;
      }

      if (log.hidden) {
        log.hidden = false;
      }
      intro.hidden = true;

      addMessage(log, "user", q);
      input.value = "";

      const manualAnswer = getManualExampleAnswer(q);
      if (manualAnswer) {
        addMessage(log, "bot", manualAnswer.answer, manualAnswer);
        input.focus();
        return;
      }

      setBusy(true);
      const pending = addPendingMessage(log, "Retrieving relevant context...");

      try {
        const result = await answerQuestion(q, retrievalIndex, chatConfig);
        pending.remove();
        addMessage(log, "bot", result.answer, {
          citations: result.citations,
          support: result.support,
          links: result.links,
          notice: result.notice
        });
      } catch (error) {
        console.error(error);
        pending.remove();
        addMessage(log, "bot", "I could not process that right now. Please try again.", {
          notice: "If this continues, check the LLM endpoint/API key in chat config."
        });
      }

      setBusy(false);
      input.focus();
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitQuestion(input.value);
    });

    suggestionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const question = button.getAttribute("data-chat-suggestion") || "";
        submitQuestion(question);
      });
    });
  }

  function mergeConfig(defaultConfig, overrideConfig) {
    const merged = JSON.parse(JSON.stringify(defaultConfig));

    const apply = (target, source) => {
      Object.entries(source).forEach(([key, value]) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          if (!target[key] || typeof target[key] !== "object") {
            target[key] = {};
          }
          apply(target[key], value);
        } else {
          target[key] = value;
        }
      });
    };

    apply(merged, overrideConfig || {});
    return merged;
  }

  async function askBackendQuestion(question, apiConfig) {
    const endpoint = String(apiConfig.endpoint || "").trim();
    if (!endpoint) {
      throw new Error("Backend endpoint is missing");
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (apiConfig.apiKeyHeader && apiConfig.apiKey) {
      headers[apiConfig.apiKeyHeader] = apiConfig.apiKey;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      let detailMessage = "";
      try {
        const payload = await response.json();
        if (typeof payload?.detail === "string") {
          detailMessage = payload.detail.trim();
        }
      } catch (_) {
        const details = await response.text();
        detailMessage = details.trim();
      }

      const error = new Error(
        `Backend chat call failed: ${response.status} ${detailMessage || "request failed"}`
      );
      error.status = response.status;
      error.userMessage = detailMessage;
      throw error;
    }

    const payload = await response.json();
    return normalizeBackendAnswer(payload);
  }

  function normalizeBackendAnswer(payload) {
    const answer = String(payload?.answer || "").trim() || "I don't have that in my current published sources.";

    const citations = Array.isArray(payload?.citations)
      ? payload.citations
          .map((entry) => ({
            id: String(entry?.id || entry?.chunk_id || "").trim(),
            label: String(entry?.label || entry?.id || "Source").trim()
          }))
          .filter((entry) => entry.label)
      : [];

    const support = Array.isArray(payload?.support)
      ? payload.support
          .map((entry) => ({
            label: String(entry?.label || "").trim(),
            supported: Boolean(entry?.supported)
          }))
          .filter((entry) => entry.label)
      : [];

    const links = Array.isArray(payload?.links)
      ? payload.links
          .map((entry) => ({
            label: String(entry?.label || "Source").trim(),
            href: String(entry?.href || "").trim()
          }))
          .filter((entry) => entry.href)
      : [];

    return {
      answer,
      citations,
      support,
      links,
      notice: typeof payload?.notice === "string" ? payload.notice : ""
    };
  }

  async function loadKnowledgeBase(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load knowledge base from ${url}`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.chunks) || !payload.chunks.length) {
      throw new Error("Knowledge base has no chunks");
    }

    return payload;
  }

  function buildSourceNote(knowledgeBase) {
    const sourceTitles = Array.isArray(knowledgeBase.sources)
      ? knowledgeBase.sources.map((source) => source.title).filter(Boolean)
      : [];

    if (!sourceTitles.length) {
      return "Grounded knowledge base is loaded.";
    }

    return `Grounded knowledge base: ${sourceTitles.join(" + ")}.`;
  }

  function buildRetrievalIndex(knowledgeBase) {
    const sourcesById = {};
    (knowledgeBase.sources || []).forEach((source) => {
      if (source && source.source_id) {
        sourcesById[source.source_id] = source;
      }
    });

    const chunks = (knowledgeBase.chunks || []).map((chunk) => {
      const rawText = String(chunk.text || "");
      const normalizedText = normalize(rawText);
      const tokens = tokenizeForSearch(rawText).map(stemToken);
      const termFreq = {};

      tokens.forEach((token) => {
        termFreq[token] = (termFreq[token] || 0) + 1;
      });

      return {
        ...chunk,
        source_title: chunk.source_title || sourcesById[chunk.source_id]?.title || "Source",
        source_url: chunk.source_url || sourcesById[chunk.source_id]?.url || "",
        normalizedText,
        tokens,
        termFreq,
        length: tokens.length || 1
      };
    });

    const docFreq = {};
    chunks.forEach((chunk) => {
      Object.keys(chunk.termFreq).forEach((term) => {
        docFreq[term] = (docFreq[term] || 0) + 1;
      });
    });

    const averageLength =
      chunks.reduce((sum, chunk) => sum + chunk.length, 0) / Math.max(chunks.length, 1);

    return {
      chunks,
      docFreq,
      averageLength,
      totalDocs: chunks.length
    };
  }

  async function answerQuestion(question, retrievalIndex, config) {
    if (config.api?.enabled && config.api?.endpoint) {
      try {
        return await askBackendQuestion(question, config.api);
      } catch (error) {
        console.error(error);
        if (!retrievalIndex) {
          const userMessage =
            typeof error?.userMessage === "string" && error.userMessage.trim()
              ? error.userMessage.trim()
              : "I could not reach the chat backend.";
          const backendNotice =
            Number(error?.status) === 429
              ? ""
              : "Start backend API and set chat-config endpoint.";
          return {
            answer: userMessage,
            citations: [],
            support: [],
            links: [],
            notice: backendNotice
          };
        }
      }
    }

    if (!retrievalIndex) {
      return {
        answer: "I do not have the indexed knowledge loaded yet.",
        citations: [],
        support: [],
        links: [],
        notice: "Load data/page-index.json to enable grounded answers."
      };
    }

    const retrieved = retrieveRelevantChunks(
      question,
      retrievalIndex,
      Number(config.retrieval?.topK) || 6
    );

    if (!retrieved.length) {
      return {
        answer: "I don't have that in my current published sources.",
        citations: [],
        support: [],
        links: [],
        notice: "Current sources are limited to your resume and The Mind to Move Mountains article."
      };
    }

    const retrievalAssessment = assessRetrievalStrength(retrieved, config.trust || {});
    if (!retrievalAssessment.passed) {
      return {
        answer: "I do not have enough reliable evidence in the current sources to answer that clearly yet.",
        citations: [],
        support: [],
        links: [],
        notice: "Try a more specific question and I will pull the most relevant source links."
      };
    }

    const context = buildContextPayload(
      retrieved,
      Number(config.retrieval?.maxContextChars) || 4600
    );

    let answerResult;
    let notice = "";
    const llmConfig = config.llm || {};
    const hasFrontendLlmCreds = Boolean(
      String(llmConfig.endpoint || "").trim() &&
      String(llmConfig.model || "").trim() &&
      String(llmConfig.apiKey || "").trim()
    );

    if (hasFrontendLlmCreds) {
      try {
        answerResult = await askGroundedLlm(question, context, llmConfig);
      } catch (error) {
        console.error(error);
        answerResult = buildExtractiveFallback(context.selectedChunks);
        notice = "AI response is temporarily unavailable. I returned a grounded summary from the indexed sources.";
      }
    } else {
      answerResult = buildExtractiveFallback(context.selectedChunks);
    }

    const grounding = scoreSentenceGrounding(
      answerResult.answer,
      context.selectedChunks,
      config.trust || {}
    );
    const policy = applyResponsePolicy(
      answerResult.answer,
      grounding,
      context.selectedChunks,
      config.trust || {}
    );

    notice = appendNotice(notice, policy.notice);
    const support = [];
    const links = policy.links;

    const citationIds = [
      ...(Array.isArray(answerResult.citations) ? answerResult.citations : []),
      ...grounding.perSentence
        .map((entry) => entry.chunkId)
        .filter(Boolean)
    ];
    const citations = normalizeCitations(citationIds, context.selectedChunks);

    return {
      answer: policy.answer,
      citations,
      support,
      links,
      notice
    };
  }

  function retrieveRelevantChunks(question, retrievalIndex, topK) {
    const rawTokens = tokenizeForSearch(question).map(stemToken);
    const queryTokens = expandQueryTokens(rawTokens);

    if (!queryTokens.length) {
      return [];
    }

    const k1 = 1.35;
    const b = 0.75;
    const queryText = normalize(question);
    const scored = [];

    retrievalIndex.chunks.forEach((chunk) => {
      let score = 0;
      let matches = 0;

      queryTokens.forEach((term) => {
        const tf = chunk.termFreq[term] || 0;
        if (!tf) {
          return;
        }

        const df = retrievalIndex.docFreq[term] || 0;
        const idf = Math.log(1 + (retrievalIndex.totalDocs - df + 0.5) / (df + 0.5));
        const denom =
          tf +
          k1 *
            (1 - b + b * (chunk.length / Math.max(retrievalIndex.averageLength, 1)));

        score += idf * ((tf * (k1 + 1)) / denom);
        matches += 1;
      });

      if (!matches) {
        return;
      }

      if (queryText && chunk.normalizedText.includes(queryText)) {
        score += 1.15;
      }

      if (/powerlift|champion|record|deadlift|squat|bench|pr|max/.test(queryText) && /powerlift|champion|record|ipsu|deadlift|squat|bench|pr/.test(chunk.normalizedText)) {
        score += 0.75;
      }

      if (/research|paper|publication|medical|tumor|uncertainty/.test(queryText) && /research|journal|conference|medical|tumor|uncertainty/.test(chunk.normalizedText)) {
        score += 0.65;
      }

      scored.push({
        chunk,
        score,
        matches
      });
    });

    scored.sort((a, b2) => b2.score - a.score);
    return scored.slice(0, Math.max(1, topK));
  }

  function assessRetrievalStrength(retrieved, trustConfig) {
    if (!Array.isArray(retrieved) || !retrieved.length) {
      return {
        passed: false,
        topScore: 0,
        averageTopScore: 0,
        topMatches: 0
      };
    }

    const top = retrieved[0];
    const topScore = toNumber(top?.score) || 0;
    const topMatches = toNumber(top?.matches) || 0;
    const sample = retrieved.slice(0, Math.min(3, retrieved.length));
    const averageTopScore =
      sample.reduce((sum, item) => sum + (toNumber(item?.score) || 0), 0) /
      Math.max(sample.length, 1);

    const minTopScore = numberOrDefault(trustConfig.retrievalMinTopScore, 1.0);
    const minAverageTopScore = numberOrDefault(trustConfig.retrievalMinAverageTopScore, 0.58);
    const minTopMatches = numberOrDefault(trustConfig.retrievalMinTopMatches, 1);

    return {
      passed:
        topScore >= minTopScore &&
        averageTopScore >= minAverageTopScore &&
        topMatches >= minTopMatches,
      topScore,
      averageTopScore,
      topMatches
    };
  }

  function scoreSentenceGrounding(answerText, selectedChunks, trustConfig) {
    const sentences = splitIntoSentences(answerText);
    const majorClaimMinTokens = numberOrDefault(trustConfig.majorClaimMinTokens, 4);
    const sentenceSupportThreshold = numberOrDefault(trustConfig.sentenceSupportThreshold, 0.56);

    const perSentence = sentences.map((sentence) => {
      const sentenceTokens = tokenizeForSearch(sentence).map(stemToken);
      const tokenSet = new Set(sentenceTokens);
      const normalizedSentence = normalize(sentence);

      let bestScore = 0;
      let bestChunkId = "";

      selectedChunks.forEach((chunk) => {
        const chunkTokens = new Set(chunk.tokens || []);
        let overlaps = 0;
        tokenSet.forEach((token) => {
          if (chunkTokens.has(token)) {
            overlaps += 1;
          }
        });

        const overlapScore = tokenSet.size ? overlaps / tokenSet.size : 0;
        const phraseBonus =
          normalizedSentence && chunk.normalizedText.includes(normalizedSentence) ? 1 : 0;
        const score = Math.min(1, overlapScore * 0.72 + phraseBonus * 0.28);

        if (score > bestScore) {
          bestScore = score;
          bestChunkId = chunk.chunk_id;
        }
      });

      return {
        sentence,
        score: bestScore,
        chunkId: bestChunkId,
        isMajorClaim: sentenceTokens.length >= majorClaimMinTokens,
        isSupported: bestScore >= sentenceSupportThreshold && Boolean(bestChunkId)
      };
    });

    const scoredSentences = perSentence.filter((item) => item.sentence.trim().length > 0);
    const averageSupport =
      scoredSentences.reduce((sum, item) => sum + item.score, 0) / Math.max(scoredSentences.length, 1);

    const majorClaims = scoredSentences.filter((item) => item.isMajorClaim);
    const supportedMajorClaims = majorClaims.filter((item) => item.isSupported);

    return {
      perSentence: scoredSentences,
      averageSupport,
      majorClaimCount: majorClaims.length,
      supportedMajorClaimCount: supportedMajorClaims.length
    };
  }

  function applyResponsePolicy(answerText, grounding, selectedChunks, trustConfig) {
    const averageThreshold = numberOrDefault(
      trustConfig.answerAverageSupportThreshold,
      0.62
    );
    const sentenceThreshold = numberOrDefault(trustConfig.sentenceSupportThreshold, 0.56);

    const hasSourcePerMajorClaim =
      grounding.majorClaimCount === 0 ||
      grounding.supportedMajorClaimCount >= grounding.majorClaimCount;
    const allowFullAnswer =
      grounding.averageSupport >= averageThreshold && hasSourcePerMajorClaim;

    if (allowFullAnswer) {
      return {
        answer: answerText,
        notice: "",
        links: []
      };
    }

    const supportedSentences = grounding.perSentence
      .filter((item) => item.score >= sentenceThreshold)
      .map((item) => item.sentence);

    let answer = supportedSentences.slice(0, 2).join(" ").trim();
    if (!answer) {
      answer = "I do not have enough reliable evidence in the current sources to answer that clearly yet.";
    } else {
      answer = `${answer} I can share this partial answer, but I may be missing enough evidence for a complete response.`;
    }

    const links = buildSourceLinksForReview(selectedChunks);
    let notice = "I found only partial support in the sources.";
    if (links.length) {
      notice = appendNotice(
        notice,
        "Use the source links below for full details."
      );
    }

    return {
      answer,
      notice,
      links
    };
  }

  function buildSourceLinksForReview(selectedChunks) {
    const seen = new Set();
    const links = [];

    selectedChunks.forEach((chunk) => {
      const sourceId = chunk.source_id;
      const href = String(chunk.source_url || "");
      if (!sourceId || !href || href.startsWith("local://") || seen.has(sourceId)) {
        return;
      }

      seen.add(sourceId);
      let label = chunk.source_title || "Source";
      if (sourceId === "resume_nov2025") {
        label = "Open Resume";
      } else if (sourceId === "ucf_mind_to_move_mountains_2026") {
        label = "Open UCF Article";
      }

      links.push({ label, href });
    });

    return links.slice(0, 2);
  }

  function formatSupportScores(grounding, trustConfig) {
    const supportThreshold = numberOrDefault(trustConfig.sentenceSupportThreshold, 0.56);
    return grounding.perSentence.map((item, index) => ({
      label: `S${index + 1}: ${item.score.toFixed(2)}`,
      supported: item.score >= supportThreshold
    }));
  }

  function expandQueryTokens(tokens) {
    const expanded = new Set(tokens);
    const tokenSet = new Set(tokens);

    THEME_EXPANSIONS.forEach((expansion) => {
      if (expansion.match.some((term) => tokenSet.has(stemToken(term)))) {
        expansion.add.forEach((term) => expanded.add(stemToken(term)));
      }
    });

    return [...expanded].filter(Boolean);
  }

  function buildContextPayload(retrievedChunks, maxContextChars) {
    const blocks = [];
    const selectedChunks = [];
    let currentLength = 0;

    for (const result of retrievedChunks) {
      const chunk = result.chunk;
      const header = `[${chunk.chunk_id}] source=${chunk.source_title}; section=${chunk.section}; page_index=${chunk.page_index}`;
      const block = `${header}\n${chunk.text}`;

      if (blocks.length && currentLength + block.length > maxContextChars) {
        break;
      }

      blocks.push(block);
      selectedChunks.push(chunk);
      currentLength += block.length;
    }

    return {
      contextText: blocks.join("\n\n"),
      selectedChunks
    };
  }

  async function askGroundedLlm(question, context, llmConfig) {
    if (!llmConfig || !llmConfig.endpoint || !llmConfig.model) {
      throw new Error("LLM config is incomplete");
    }

    const allowedIds = context.selectedChunks.map((chunk) => chunk.chunk_id);

    const systemPrompt = [
      "You are Ilkin Isler speaking in first person.",
      "Answer like Ilkin directly: use I/my language and do not refer to Ilkin in third person.",
      "Answer strictly using the supplied context chunks.",
      "If the answer is missing, say: I don't have that in my current published sources.",
      "Never fabricate details.",
      "Return strict JSON with keys answer and citations.",
      "citations must be an array of chunk IDs from the allowed list."
    ].join(" ");

    const userPrompt = [
      `Question: ${question}`,
      "",
      `Allowed chunk IDs: ${allowedIds.join(", ")}`,
      "",
      "Context chunks:",
      context.contextText,
      "",
      "Return format:",
      '{"answer":"...","citations":["chunk-id"]}'
    ].join("\n");

    const body = {
      model: llmConfig.model,
      temperature: Number(llmConfig.temperature ?? 0.15),
      max_tokens: Number(llmConfig.maxTokens ?? 520),
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    };

    const headers = {
      "Content-Type": "application/json"
    };

    if (llmConfig.apiKey) {
      if ((llmConfig.apiKeyHeader || "Authorization") === "Authorization") {
        headers.Authorization = `Bearer ${llmConfig.apiKey}`;
      } else {
        headers[llmConfig.apiKeyHeader] = llmConfig.apiKey;
      }
    }

    const response = await fetch(llmConfig.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`LLM call failed: ${response.status} ${details}`);
    }

    const payload = await response.json();
    const content = extractAssistantText(payload);
    const parsed = parseJsonResponse(content);

    if (!parsed.answer) {
      throw new Error("LLM response had no answer");
    }

    parsed.citations = Array.isArray(parsed.citations)
      ? parsed.citations.filter((citation) => allowedIds.includes(citation))
      : [];

    return parsed;
  }

  function buildExtractiveFallback(selectedChunks) {
    const text = selectedChunks
      .slice(0, 3)
      .map((chunk) => chunk.text)
      .join(" ");

    const sentences = splitIntoSentences(text).slice(0, 3);
    const answer = sentences.length
      ? sentences.join(" ")
      : "I don't have that in my current published sources.";

    return {
      answer,
      citations: selectedChunks.slice(0, 3).map((chunk) => chunk.chunk_id)
    };
  }

  function normalizeCitations(citations, selectedChunks) {
    const known = new Map();
    selectedChunks.forEach((chunk) => {
      known.set(chunk.chunk_id, chunk);
    });

    const resolved = [];
    const seenSources = new Set();
    const addCitation = (chunkId) => {
      const chunk = known.get(chunkId);
      if (!chunk) {
        return;
      }
      const sourceKey = String(chunk.source_id || chunkId);
      if (seenSources.has(sourceKey)) {
        return;
      }
      seenSources.add(sourceKey);
      resolved.push({
        id: sourceKey,
        label: citationLabel(chunk)
      });
    };

    if (Array.isArray(citations)) {
      citations.forEach((citation) => addCitation(String(citation || "")));
    }

    if (!resolved.length) {
      selectedChunks.slice(0, 3).forEach((chunk) => addCitation(chunk.chunk_id));
    }

    return resolved;
  }

  function citationLabel(chunk) {
    if (chunk.source_id === "resume_nov2025") {
      return "Resume";
    }

    if (chunk.source_id === "ucf_mind_to_move_mountains_2026") {
      return "The Mind to Move Mountains";
    }

    if (chunk.source_id === "ilkin_profile_facts") {
      return "Profile Facts";
    }

    return `${chunk.source_title || "Source"}`;
  }

  function extractAssistantText(payload) {
    const choiceContent = payload?.choices?.[0]?.message?.content;
    if (Array.isArray(choiceContent)) {
      return choiceContent
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          return part?.text || "";
        })
        .join(" ")
        .trim();
    }

    if (typeof choiceContent === "string") {
      return choiceContent.trim();
    }

    if (typeof payload?.output_text === "string") {
      return payload.output_text.trim();
    }

    const outputContent = payload?.output?.[0]?.content;
    if (Array.isArray(outputContent)) {
      const text = outputContent
        .map((part) => part?.text || "")
        .join(" ")
        .trim();
      if (text) {
        return text;
      }
    }

    return "";
  }

  function parseJsonResponse(rawContent) {
    const cleaned = String(rawContent || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/, "")
      .trim();

    const parseCandidate = (candidate) => {
      try {
        const parsed = JSON.parse(candidate);
        const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
        const citations = Array.isArray(parsed.citations)
          ? parsed.citations.map((item) => String(item || "").trim()).filter(Boolean)
          : [];

        return {
          answer,
          citations
        };
      } catch (_) {
        return null;
      }
    };

    const direct = parseCandidate(cleaned);
    if (direct) {
      return direct;
    }

    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      const fromMatch = parseCandidate(objectMatch[0]);
      if (fromMatch) {
        return fromMatch;
      }
    }

    return {
      answer: cleaned,
      citations: []
    };
  }

  function addMessage(log, role, text, meta = {}) {
    const item = document.createElement("li");
    item.className = `chat-row ${role === "user" ? "user" : "bot"}`;

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    const body = document.createElement("p");
    body.className = "chat-text";
    body.textContent = text;
    bubble.appendChild(body);

    if (role !== "user") {
      const metaBlock = createMetaBlock(meta);
      if (metaBlock) {
        bubble.appendChild(metaBlock);
      }
    }

    item.appendChild(bubble);
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  function createMetaBlock(meta) {
    const showCitations = Array.isArray(meta.citations) && meta.citations.length;
    const showLinks = Array.isArray(meta.links) && meta.links.length;
    const showNotice = typeof meta.notice === "string" && meta.notice.trim();

    if (!showCitations && !showLinks && !showNotice) {
      return null;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "chat-meta";

    if (showCitations) {
      const citationLabels = [...new Set(
        meta.citations
          .map((citation) => String(citation?.label || "").trim())
          .filter(Boolean)
      )];

      const citations = document.createElement("p");
      citations.className = "chat-citations";
      citations.textContent =
        citationLabels.length <= 1
          ? `Source: ${citationLabels[0] || "Provided source"}`
          : `Sources: ${citationLabels.join(" • ")}`;
      wrapper.appendChild(citations);
    }

    if (showLinks) {
      const linkRow = document.createElement("div");
      linkRow.className = "chat-links";

      meta.links.forEach((link) => {
        const anchor = document.createElement("a");
        anchor.className = "chat-link";
        anchor.href = link.href;
        anchor.textContent = link.label;
        if (/^https?:\/\//.test(link.href)) {
          anchor.target = "_blank";
          anchor.rel = "noopener";
        }
        linkRow.appendChild(anchor);
      });

      wrapper.appendChild(linkRow);
    }

    if (showNotice) {
      const notice = document.createElement("p");
      notice.className = "chat-notice";
      notice.textContent = meta.notice;
      wrapper.appendChild(notice);
    }

    return wrapper;
  }

  function addPendingMessage(log, text) {
    const item = document.createElement("li");
    item.className = "chat-row bot";

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    const body = document.createElement("p");
    body.className = "chat-text";
    body.textContent = text;

    bubble.appendChild(body);
    item.appendChild(bubble);
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;

    return item;
  }

  function tokenizeForSearch(value) {
    const text = normalize(value);
    if (!text) {
      return [];
    }

    return text
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
      .filter((token) => !STOP_WORDS.has(token));
  }

  function stemToken(token) {
    let current = String(token || "").toLowerCase();

    if (current.length > 5 && current.endsWith("ing")) {
      current = current.slice(0, -3);
    } else if (current.length > 4 && current.endsWith("ed")) {
      current = current.slice(0, -2);
    } else if (current.length > 4 && current.endsWith("es")) {
      current = current.slice(0, -2);
    } else if (current.length > 3 && current.endsWith("s")) {
      current = current.slice(0, -1);
    }

    return current;
  }

  function splitIntoSentences(text) {
    const compact = String(text || "").trim();
    if (!compact) {
      return [];
    }

    return compact
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  function numberOrDefault(value, fallback) {
    const num = toNumber(value);
    if (num === null) {
      return fallback;
    }
    return num;
  }

  function appendNotice(currentNotice, nextNotice) {
    const base = String(currentNotice || "").trim();
    const incoming = String(nextNotice || "").trim();
    if (!incoming) {
      return base;
    }
    if (!base) {
      return incoming;
    }
    return `${base} ${incoming}`;
  }

  function normalize(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s+]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
})();
