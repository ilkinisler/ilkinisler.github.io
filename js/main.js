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
  const FALLBACK_NOT_ENOUGH_INFO = "I don't have enough information to answer this question.";

  const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or", "our", "should", "so", "that", "the", "their", "them", "there", "these", "they", "this", "to", "was", "we", "what", "when", "where", "which", "who", "why", "with", "you", "your", "ilkin", "isler", "hi", "hello", "hey"
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

  // Curated answers that restate the knowledge base verbatim. Navigational questions
  // (publications, media, contact) read better as a pointer plus link buttons than as
  // LLM prose, and HHEM scores paraphrased link lists poorly, so these skip the LLM.
  const PRE_VERIFIED = Object.freeze({
    score: 1,
    passed: true,
    model: "Pre-verified answer",
    note: "Pre-verified answer written from my resume and profile facts."
  });

  const EXAMPLE_QUESTION_ANSWERS = Object.freeze({
    "can you tell me about your background": {
      answer:
        "I moved from Turkey to the U.S. to study AI at UCF, where I earned my MS (2022) and PhD (2025) in Computer Science, with research on uncertainty-aware medical image segmentation. Today I'm a Senior AI Engineer at Universal Creative in a forward-deployed role: I work with business teams to scope what they need and take the AI solution from first prototype to trusted production, and I lead an AI engineering team across our AI platform, finance, and cost-estimating work.",
      citations: [
        { id: "resume", label: "Resume" },
        { id: "mind_to_move", label: "The Mind to Move Mountains" }
      ],
      links: [
        { label: "Open UCF Article", href: "https://www.ucf.edu/news/the-mind-to-move-mountains/" },
        { label: "Open Resume", href: "assets/Ilkin_Isler_Resume.pdf" }
      ]
    },
    "where can i see your publications": {
      fixed: true,
      groundedness: PRE_VERIFIED,
      answer:
        "My research is on trustworthy AI for medical imaging: segmentation, uncertainty quantification, and self-supervised learning. Here are my publications with direct links, and Google Scholar has the full, up-to-date list.",
      citations: [
        { id: "resume", label: "Resume" },
        { id: "scholar", label: "Google Scholar" }
      ],
      links: [
        { label: "Pancreas CT/MRI Segmentation (2025)", href: "https://doi.org/10.1016/j.media.2024.103382" },
        { label: "Uncertainty-Guided Tumor Segmentation (2025)", href: "https://doi.org/10.48550/arXiv.2504.12215" },
        { label: "Generative AI in Medical Imaging (2024)", href: "https://doi.org/10.1007/978-3-031-72787-0_17" },
        { label: "OAR + Tumor Segmentation UQ (2023)", href: "https://doi.org/10.1109/ICECCME57830.2023.10252269" },
        { label: "Enhancing OAR Segmentation (2022)", href: "https://doi.org/10.1117/12.2611498" },
        { label: "Power-VR (2022)", href: "https://doi.org/10.1002/cav.2045" },
        { label: "Facial Expression Translation (2019)", href: "https://doi.org/10.48550/arXiv.1910.05595" },
        { label: "3D Modelling in Plastic Surgery (2019)", href: "https://scholar.google.com/scholar?q=Usage+of+3D+Modelling+and+Morphing+Tools+in+Plastic+Surgery" },
        { label: "Open Google Scholar", href: "https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en" }
      ]
    },
    "what is your research focus": {
      answer:
        "My research is about building AI that people can rely on, which starts with knowing when a model is wrong. During my PhD I designed 3D neural network architectures, loss functions, and uncertainty quantification methods for tumor and organ-at-risk segmentation; my self-supervised and uncertainty-guided approaches achieved state-of-the-art results at publication. Today I apply the same idea to LLMs: retrieval-augmented generation, hallucination detection, groundedness and citation checks, and evaluation pipelines that decide when an answer can be trusted, or when the system should decline to answer.",
      citations: [
        { id: "resume", label: "Resume" },
        { id: "profile_facts", label: "Profile Facts" }
      ],
      links: [{ label: "Open Google Scholar", href: "https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en" }]
    },
    "how much can you deadlift": {
      // Kept as a fixed answer for its personality; it restates the profile facts verbatim.
      fixed: true,
      groundedness: PRE_VERIFIED,
      media: {
        type: "video",
        src: "assets/deadlift-475.mp4",
        poster: "assets/deadlift-475-poster.jpg",
        caption: "Proof: the 475 lb sumo deadlift"
      },
      answer:
        "Haha, my deadlift PR is 475 lbs, and yes, I pull sumo. I've held deadlift records in Türkiye since 2020 and in Florida since 2022, including both junior and open records. I'm a four-time USA Powerlifting Florida state record holder, a two-time Overall Champion of Türkiye, and placed 1st overall at the IPSU European Championship.",
      citations: [{ id: "profile_facts", label: "Profile Facts" }],
      links: [
        {
          label: "USAPL Record Database",
          href: "https://usapl.liftingdatabase.com/records-default?priority=0&recordtypeid=120382&categoryid=&weightclassid="
        },
        {
          label: "Türkiye Powerlifting Records",
          href: "https://powerlifting.org.tr/turkiye-rekorlari"
        }
      ]
    },
    "where can i see your media links": {
      fixed: true,
      groundedness: PRE_VERIFIED,
      answer:
        "The best place to start is my UCF News feature, The Mind to Move Mountains. You can also follow updates on LinkedIn, see my publications on Google Scholar, and find my research code on GitHub.",
      citations: [{ id: "mind_to_move", label: "The Mind to Move Mountains" }],
      links: [
        { label: "Open UCF Article", href: "https://www.ucf.edu/news/the-mind-to-move-mountains/" },
        { label: "Open LinkedIn", href: "https://www.linkedin.com/in/ilkinsevgiisler/" },
        { label: "Open Google Scholar", href: "https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en" },
        { label: "Open GitHub", href: "https://github.com/ilkinisler" }
      ]
    },
    "how can i contact you": {
      fixed: true,
      groundedness: PRE_VERIFIED,
      answer:
        "The best way to reach me is by email. You can also message me on LinkedIn.",
      citations: [{ id: "resume", label: "Resume" }],
      links: [
        { label: "Email Me", href: "mailto:ilkinisler@gmail.com" },
        { label: "Open LinkedIn", href: "https://www.linkedin.com/in/ilkinsevgiisler/" },
        { label: "Open Resume", href: "assets/Ilkin_Isler_Resume.pdf" }
      ]
    }
  });

  const SMALL_TALK_RESPONSES = Object.freeze({
    greeting:
      "Hi! I am doing great, thanks for asking. Ask me about my research focus, publications, projects, deadlift PR, media links, or contact.",
    thanks:
      "You are welcome. If you want, ask me about research, publications, projects, strength stats, media, or contact.",
    who:
      "I'm Ilkin Isler, an AI engineer and researcher working on trustworthy AI, LLM evaluation, and medical imaging. Ask me about my work, research, or background.",
    personal:
      "I keep this assistant focused on my work, research, and background, so I'll skip personal questions. Happy to help with anything professional, or you can reach me by email."
  });

  // Personal or private topics are declined before retrieval, so a stray keyword
  // match (e.g. "single" in "a single source of truth") can't produce an answer.
  const PERSONAL_TOPIC_PATTERN =
    /(^| )(are you single|are u single|u single|you single|still single|married|marry|boyfriend|girlfriend|husband|wife|your partner|dating|date me|in a relationship|are you engaged|crush|kids|children|pregnant|how old|your age|age are you|born in|birthday|date of birth|salary|income|compensation|net worth|how much do you (make|earn)|how much are you paid|religion|religious|muslim|christian|atheist|believe in god|politics|political|vote|democrat|republican|where do you live|home address|your address|phone number|social security|how tall|your height|how much do you weigh|your weight|your health|are you sick|visa|green card|citizenship|sponsorship|immigration)( |$)/;

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
      notice: "",
      fixed: Boolean(preset.fixed),
      media: preset.media || null,
      groundedness: preset.groundedness ? normalizeGroundedness(preset.groundedness) : null
    };
  }

  function getSmallTalkAnswer(question) {
    const text = normalize(question);
    if (!text) {
      return null;
    }

    if (PERSONAL_TOPIC_PATTERN.test(text)) {
      return {
        answer: SMALL_TALK_RESPONSES.personal,
        citations: [],
        support: [],
        links: [{ label: "Email Me", href: "mailto:ilkinisler@gmail.com" }],
        notice: ""
      };
    }

    if (/(^| )who are you( |$)|(^| )tell me about yourself( |$)/.test(text)) {
      return {
        answer: SMALL_TALK_RESPONSES.who,
        citations: [],
        support: [],
        links: [],
        notice: ""
      };
    }

    if (/(^| )(thank you|thanks|thx)( |$)/.test(text)) {
      return {
        answer: SMALL_TALK_RESPONSES.thanks,
        citations: [],
        support: [],
        links: [],
        notice: ""
      };
    }

    const hasGreeting = /(^| )(hi|hello|hey|good morning|good afternoon|good evening)( |$)/.test(text);
    const isHowAreYou = /(how are you|how s it going|how is it going|how are u)/.test(text);
    const hasKnowledgeIntent =
      /(research|publication|paper|project|build|background|story|deadlift|squat|bench|pr|media|article|contact|email|linkedin|scholar|cv|resume)/.test(
        text
      );
    const tokenCount = tokenizeForSearch(question).length;

    if (isHowAreYou || (hasGreeting && tokenCount <= 4 && !hasKnowledgeIntent)) {
      return {
        answer: SMALL_TALK_RESPONSES.greeting,
        citations: [],
        support: [],
        links: [],
        notice: ""
      };
    }

    return null;
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

    intro.textContent = "Hi! Ask me about my work, research, or background.";

    const chatConfig = mergeConfig(DEFAULT_CHAT_CONFIG, window.ILKIN_CHAT_CONFIG || {});
    const backendEnabled = Boolean(chatConfig.api?.enabled && chatConfig.api?.endpoint);

    // The local index is always loaded so the browser can still answer if the backend is down.
    let retrievalIndex = null;
    try {
      const knowledgeBase = await loadKnowledgeBase(chatConfig.knowledgeBaseUrl);
      retrievalIndex = buildRetrievalIndex(knowledgeBase);
      if (sourceNote) {
        sourceNote.textContent = backendEnabled
          ? chatConfig.api?.sourceNote || "Grounded knowledge base served by the chat backend."
          : buildSourceNote(knowledgeBase);
      }
    } catch (error) {
      console.error(error);
      if (sourceNote && !backendEnabled) {
        sourceNote.textContent = "Knowledge base unavailable. Check data/page-index.json.";
      }
    }

    // Cloud Run scales to zero, so the first request after a quiet period waits for the
    // server to start. Ping /health on load so it's usually warm before anyone asks.
    let backendWarm = !backendEnabled;
    if (backendEnabled) {
      const healthUrl = chatConfig.api.endpoint.replace(/\/chat$/, "/health");
      fetch(healthUrl, { cache: "no-store" })
        .then((response) => {
          backendWarm = response.ok;
        })
        .catch(() => {});
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

      const smallTalk = getSmallTalkAnswer(q);
      if (smallTalk) {
        addMessage(log, "bot", smallTalk.answer, smallTalk);
        input.focus();
        return;
      }

      // Preset answers are instant but unscored, so they're only used when there's no
      // backend; with a backend, presets just contribute their extra link buttons.
      const manualAnswer = getManualExampleAnswer(q);
      if (manualAnswer && (manualAnswer.fixed || !backendEnabled)) {
        addMessage(log, "bot", manualAnswer.answer, manualAnswer);
        input.focus();
        return;
      }

      setBusy(true);
      const pending = addPendingMessage(
        log,
        backendWarm
          ? "Retrieving sources and checking groundedness..."
          : "Waking up the server: the first answer can take up to ~20 seconds. After that it's quick."
      );

      try {
        let result = await answerQuestion(q, retrievalIndex, chatConfig);
        backendWarm = true;
        if (manualAnswer && !result.groundedness) {
          // Backend unreachable: the curated preset beats an unscored extractive answer.
          result = manualAnswer;
        }
        pending.remove();
        addMessage(log, "bot", result.answer, {
          citations: result.citations,
          support: result.support,
          links: mergeLinks(result.links, manualAnswer?.links),
          notice: result.notice,
          groundedness: result.groundedness,
          passages: result.passages
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
      notice: typeof payload?.notice === "string" ? payload.notice : "",
      groundedness: normalizeGroundedness(payload?.groundedness),
      passages: normalizePassages(payload?.passages)
    };
  }

  function mergeLinks(primary = [], extra = []) {
    const seen = new Set();
    return [...(primary || []), ...(extra || [])].filter((link) => {
      if (!link?.href || seen.has(link.href)) {
        return false;
      }
      seen.add(link.href);
      return true;
    });
  }

  function normalizePassages(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => ({
        label: String(entry?.label || "Source").trim(),
        section: String(entry?.section || "").trim(),
        text: String(entry?.text || "").trim(),
        url: String(entry?.url || "").trim()
      }))
      .filter((entry) => entry.text);
  }

  // Retrieved chunks for the "View sources" panel, cited ones first.
  function buildPassages(selectedChunks, citedIds = [], limit = 4) {
    const cited = new Set(citedIds);
    return [...selectedChunks]
      .sort((a, b) => Number(!cited.has(a.chunk_id)) - Number(!cited.has(b.chunk_id)))
      .slice(0, limit)
      .map((chunk) => ({
        label: citationLabel(chunk),
        section: String(chunk.section || "").trim(),
        text: String(chunk.text || "").trim(),
        url: /^https?:\/\//.test(chunk.source_url || "") ? chunk.source_url : ""
      }));
  }

  function normalizeGroundedness(value) {
    const score = Number(value?.score);
    if (!value || !Number.isFinite(score)) {
      return null;
    }
    return {
      score,
      passed: Boolean(value.passed),
      model: String(value.model || "HHEM").trim(),
      note: String(value.note || "").trim()
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
        answer: FALLBACK_NOT_ENOUGH_INFO,
        citations: [],
        support: [],
        links: [],
        notice: ""
      };
    }

    const retrievalAssessment = assessRetrievalStrength(retrieved, config.trust || {});
    if (!retrievalAssessment.passed) {
      return {
        answer: FALLBACK_NOT_ENOUGH_INFO,
        citations: [],
        support: [],
        links: [],
        notice: ""
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

    const answerText = String(answerResult?.answer || "").trim();
    const noAnswer =
      !answerText ||
      /^i don't have that in my current published sources\.?$/i.test(answerText);

    if (noAnswer) {
      return {
        answer: FALLBACK_NOT_ENOUGH_INFO,
        citations: [],
        support: [],
        links: [],
        notice: ""
      };
    }

    const citationIds = Array.isArray(answerResult?.citations)
      ? answerResult.citations
      : context.selectedChunks.slice(0, 2).map((chunk) => chunk.chunk_id);
    const citations = normalizeCitations(citationIds, context.selectedChunks);

    return {
      answer: answerText,
      citations,
      support: [],
      links: [],
      notice,
      passages: buildPassages(context.selectedChunks, citationIds)
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
    if (String(chunk.source_id).startsWith("resume_")) {
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

  const AVATAR_SRC = "assets/avatar-main.jpg";
  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function createRowAvatar() {
    const avatar = document.createElement("img");
    avatar.className = "chat-row-avatar";
    avatar.src = AVATAR_SRC;
    avatar.alt = "";
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  function addMessage(log, role, text, meta = {}) {
    const item = document.createElement("li");
    item.className = `chat-row ${role === "user" ? "user" : "bot"}`;

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    const body = document.createElement("p");
    body.className = "chat-text";
    bubble.appendChild(body);

    // Video, badge, and sources appear once the text has finished "typing".
    const extras = [];
    if (role !== "user" && meta.media?.type === "video") {
      extras.push(createVideoFigure(meta.media));
    }
    if (role !== "user") {
      const metaBlock = createMetaBlock(meta);
      if (metaBlock) {
        extras.push(metaBlock);
      }
    }

    if (role !== "user") {
      item.appendChild(createRowAvatar());
    }
    item.appendChild(bubble);
    log.appendChild(item);

    const finish = () => {
      body.textContent = text;
      extras.forEach((node) => bubble.appendChild(node));
      log.scrollTop = log.scrollHeight;
    };

    if (role === "user" || prefersReducedMotion()) {
      finish();
      return;
    }

    // Typewriter: reveal the answer as if it's being typed, capped at ~1.4 s.
    const steps = Math.min(text.length, 90);
    const perStep = Math.ceil(text.length / steps);
    let shown = 0;
    const tick = () => {
      shown = Math.min(text.length, shown + perStep);
      body.textContent = text.slice(0, shown);
      log.scrollTop = log.scrollHeight;
      if (shown < text.length) {
        setTimeout(tick, 15);
      } else {
        finish();
      }
    };
    tick();
  }


  function createVideoFigure(media) {
    const figure = document.createElement("figure");
    figure.className = "chat-media";
    const video = document.createElement("video");
    video.src = media.src;
    if (media.poster) {
      video.poster = media.poster;
    }
    // Silent clip: autoplay requires muted + playsinline on mobile.
    Object.assign(video, { muted: true, autoplay: true, loop: true, playsInline: true, controls: true });
    video.setAttribute("playsinline", "");
    video.setAttribute("aria-label", media.caption || "Video");
    figure.appendChild(video);
    if (media.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = media.caption;
      figure.appendChild(caption);
    }
    return figure;
  }

  function createMetaBlock(meta) {
    const showCitations = Array.isArray(meta.citations) && meta.citations.length;
    const showLinks = Array.isArray(meta.links) && meta.links.length;
    const showNotice = typeof meta.notice === "string" && meta.notice.trim();
    const showGroundedness = Boolean(meta.groundedness);
    const showPassages = Array.isArray(meta.passages) && meta.passages.length;

    if (!showCitations && !showLinks && !showNotice && !showGroundedness && !showPassages) {
      return null;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "chat-meta";

    if (showGroundedness) {
      const { score, passed, model, note } = meta.groundedness;
      const badge = document.createElement("span");
      badge.className = `chat-groundedness ${passed ? "ok" : "low"}`;
      badge.title = note || `Groundedness confidence from ${model}: how strongly the retrieved sources support this answer.`;
      badge.textContent = `${passed ? "Grounded" : "Not sure"} · ${Math.round(score * 100)}% confidence`;
      wrapper.appendChild(badge);
    }

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

    if (showPassages) {
      const details = document.createElement("details");
      details.className = "chat-passages";
      const summary = document.createElement("summary");
      summary.textContent = `View sources (${meta.passages.length})`;
      details.appendChild(summary);

      const list = document.createElement("ol");
      meta.passages.forEach((passage) => {
        const item = document.createElement("li");
        const head = document.createElement("p");
        head.className = "chat-passage-head";
        const label = passage.section ? `${passage.label} · ${passage.section}` : passage.label;
        if (passage.url) {
          const anchor = document.createElement("a");
          anchor.href = passage.url;
          anchor.textContent = label;
          anchor.target = "_blank";
          anchor.rel = "noopener";
          head.appendChild(anchor);
        } else {
          head.textContent = label;
        }
        const text = document.createElement("p");
        text.className = "chat-passage-text";
        text.textContent = passage.text;
        item.append(head, text);
        list.appendChild(item);
      });
      details.appendChild(list);
      wrapper.appendChild(details);
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

    // Typing indicator: my avatar with a spinning ring, bouncing dots, and the status text.
    const typingAvatar = document.createElement("span");
    typingAvatar.className = "typing-avatar";
    typingAvatar.setAttribute("aria-hidden", "true");
    typingAvatar.appendChild(createRowAvatar());

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble chat-pending";
    bubble.setAttribute("role", "status");

    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));

    const body = document.createElement("p");
    body.className = "chat-pending-text";
    body.textContent = text;

    bubble.append(dots, body);
    item.append(typingAvatar, bubble);
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
