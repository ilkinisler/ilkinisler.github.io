from __future__ import annotations

import hashlib
import json
import math
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List
from urllib.parse import urljoin

STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "should",
    "so",
    "that",
    "the",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "to",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}

THEME_EXPANSIONS = [
    {
        "match": ["about", "background", "story", "journey", "moved", "turkey", "ucf"],
        "add": ["phd", "turkey", "ucf", "journey", "motive"],
    },
    {
        "match": ["project", "projects", "build", "building", "work"],
        "add": ["platform", "mcp", "rag", "llm", "engineer"],
    },
    {
        "match": ["research", "publication", "paper", "medical", "imaging"],
        "add": ["medical", "imaging", "uncertainty", "explainable", "trustworthy", "tumor"],
    },
    {
        "match": [
            "strength",
            "powerlifting",
            "athlete",
            "champion",
            "record",
            "deadlift",
            "squat",
            "bench",
            "pr",
            "max",
        ],
        "add": ["powerlifting", "champion", "record", "european", "ipsu", "deadlift", "squat", "bench", "pr"],
    },
    {
        "match": ["media", "article", "feature", "youtube", "interview"],
        "add": ["article", "mind", "move", "mountains", "media"],
    },
    {
        "match": ["contact", "reach", "email", "linkedin", "scholar"],
        "add": ["email", "linkedin", "scholar", "contact"],
    },
]

TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
SENTENCE_PATTERN = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")


@dataclass
class Chunk:
    chunk_id: str
    source_id: str
    source_title: str
    source_url: str
    page_index: int
    section: str
    text: str
    normalized_text: str
    tokens: List[str]
    term_freq: Dict[str, int]
    length: int
    vector: Dict[int, float]


class LocalPageIndexRAG:
    """No-vector-DB RAG over a local page-index JSON with cached hashed embeddings."""

    CACHE_VERSION = "local-hybrid-v1"

    def __init__(
        self,
        page_index_path: Path,
        cache_path: Path,
        frontend_base_url: str = "https://ilkinisler.com",
        embedding_dims: int = 640,
        rebuild_cache: bool = False,
        openai_api_key: str = "",
        openai_model: str = "gpt-5-nano",
        openai_endpoint: str = "https://api.openai.com/v1/chat/completions",
        llm_temperature: float = 0.15,
        llm_max_tokens: int = 520,
    ) -> None:
        self.page_index_path = Path(page_index_path)
        self.cache_path = Path(cache_path)
        self.frontend_base_url = frontend_base_url.rstrip("/") + "/"
        self.embedding_dims = int(embedding_dims)
        self.openai_api_key = str(openai_api_key or "").strip()
        self.openai_model = str(openai_model or "gpt-5-nano").strip()
        self.openai_endpoint = str(openai_endpoint or "https://api.openai.com/v1/chat/completions").strip()
        self.llm_temperature = float(llm_temperature)
        self.llm_max_tokens = int(llm_max_tokens)

        if not self.page_index_path.exists():
            raise FileNotFoundError(f"Page index not found: {self.page_index_path}")

        payload = json.loads(self.page_index_path.read_text(encoding="utf-8"))
        self.generated_at = str(payload.get("generated_at", ""))
        self.sources = payload.get("sources", [])
        self.raw_chunks = payload.get("chunks", [])

        if not self.raw_chunks:
            raise ValueError("page-index.json has no chunks")

        self.doc_freq: Dict[str, int] = {}
        self.semantic_idf: Dict[str, float] = {}
        self.chunk_vector_cache: Dict[str, Dict[int, float]] = {}

        self._prepare_chunks()
        self._load_or_build_cache(rebuild_cache=rebuild_cache)

    @property
    def chunk_count(self) -> int:
        return len(self.chunks)

    def chat(self, question: str) -> dict:
        question = (question or "").strip()
        if not question:
            return {
                "answer": "Please ask a question.",
                "citations": [],
                "support": [],
                "links": [],
                "notice": "",
            }

        retrieved = self.retrieve(question, top_k=6)
        retrieval_assessment = self._assess_retrieval_strength(retrieved)

        if not retrieval_assessment["passed"]:
            return {
                "answer": "I do not have enough reliable evidence in the current sources to answer that clearly yet.",
                "citations": [],
                "support": [],
                "links": [],
                "notice": "Try a more specific question and I will pull the most relevant source links.",
                "retrieval": retrieval_assessment,
            }

        selected_chunks = [row["chunk"] for row in retrieved[:6]]
        draft_answer = self._build_extractive_answer(question, retrieved)
        llm_notice = ""
        llm_result = self._ask_grounded_llm(question, selected_chunks)

        answer_text = llm_result.get("answer", "").strip() if llm_result else ""
        if not answer_text:
            answer_text = draft_answer
            if self.openai_api_key:
                llm_notice = "LLM was unavailable, so I returned a source-grounded summary."

        grounding = self._score_sentence_grounding(answer_text, selected_chunks)
        policy = self._apply_response_policy(answer_text, grounding, selected_chunks)

        citation_ids: List[str] = []
        if llm_result:
            citation_ids.extend(llm_result.get("citations", []))
        for item in grounding["per_sentence"]:
            chunk_id = item.get("chunk_id")
            if chunk_id:
                citation_ids.append(chunk_id)

        if not citation_ids:
            citation_ids.extend(chunk.chunk_id for chunk in selected_chunks[:3])

        return {
            "answer": policy["answer"],
            "citations": self._normalize_citations(citation_ids, selected_chunks),
            "support": self._format_support_scores(grounding),
            "links": policy["links"],
            "notice": self._append_notice(llm_notice, policy["notice"]),
            "retrieval": retrieval_assessment,
        }

    def _ask_grounded_llm(self, question: str, selected_chunks: List[Chunk]) -> dict | None:
        if not self.openai_api_key or not self.openai_model or not selected_chunks:
            return None

        allowed_ids = [chunk.chunk_id for chunk in selected_chunks]
        context_blocks = []
        for chunk in selected_chunks:
            header = (
                f"[{chunk.chunk_id}] source={chunk.source_title}; "
                f"section={chunk.section}; page_index={chunk.page_index}"
            )
            context_blocks.append(f"{header}\n{chunk.text}")

        system_prompt = " ".join(
            [
                "You are Ask Ilkin, a grounding-first assistant.",
                "Answer strictly using the supplied context chunks.",
                "If the answer is missing, say: I do not have that in the current knowledge base.",
                "Never fabricate details.",
                "Return strict JSON with keys answer and citations.",
                "citations must be an array of chunk IDs from the allowed list.",
            ]
        )

        user_prompt = "\n".join(
            [
                f"Question: {question}",
                "",
                f"Allowed chunk IDs: {', '.join(allowed_ids)}",
                "",
                "Context chunks:",
                "\n\n".join(context_blocks),
                "",
                "Return format:",
                '{"answer":"...","citations":["chunk-id"]}',
            ]
        )

        payload = {
            "model": self.openai_model,
            "temperature": self.llm_temperature,
            "max_tokens": self.llm_max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        request = urllib.request.Request(
            self.openai_endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.openai_api_key}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return None

        try:
            response_payload = json.loads(raw)
        except json.JSONDecodeError:
            return None

        content = self._extract_assistant_text(response_payload)
        parsed = self._parse_llm_json(content, allowed_ids)
        if not parsed.get("answer"):
            return None
        return parsed

    def _extract_assistant_text(self, payload: dict) -> str:
        choice_content = (
            ((payload.get("choices") or [{}])[0] or {}).get("message", {}) or {}
        ).get("content")

        if isinstance(choice_content, list):
            parts: List[str] = []
            for part in choice_content:
                if isinstance(part, str):
                    parts.append(part)
                elif isinstance(part, dict):
                    parts.append(str(part.get("text", "")))
            return " ".join(parts).strip()

        if isinstance(choice_content, str):
            return choice_content.strip()

        output_text = payload.get("output_text")
        if isinstance(output_text, str):
            return output_text.strip()

        output = payload.get("output") or []
        if output and isinstance(output[0], dict):
            output_content = output[0].get("content")
            if isinstance(output_content, list):
                parts = []
                for part in output_content:
                    if isinstance(part, dict):
                        parts.append(str(part.get("text", "")))
                text = " ".join(parts).strip()
                if text:
                    return text

        return ""

    def _parse_llm_json(self, raw_content: str, allowed_ids: List[str]) -> dict:
        cleaned = str(raw_content or "").strip()
        cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"^```\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"```$", "", cleaned).strip()

        def parse_candidate(candidate: str) -> dict | None:
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError:
                return None

            answer = str(parsed.get("answer", "")).strip() if isinstance(parsed, dict) else ""
            citations_raw = parsed.get("citations", []) if isinstance(parsed, dict) else []
            citations = []
            if isinstance(citations_raw, list):
                for item in citations_raw:
                    chunk_id = str(item or "").strip()
                    if chunk_id and chunk_id in allowed_ids:
                        citations.append(chunk_id)
            return {"answer": answer, "citations": citations}

        direct = parse_candidate(cleaned)
        if direct:
            return direct

        object_match = re.search(r"\{[\s\S]*\}", cleaned)
        if object_match:
            fallback = parse_candidate(object_match.group(0))
            if fallback:
                return fallback

        return {"answer": cleaned, "citations": []}

    def retrieve(self, question: str, top_k: int = 6) -> List[dict]:
        raw_tokens = [self._stem(token) for token in self._tokenize(question)]
        query_tokens = self._expand_query_tokens(raw_tokens)
        if not query_tokens:
            return []

        lexical_rows: List[dict] = []
        query_vector = self._build_query_vector(query_tokens)

        k1 = 1.35
        b = 0.75
        normalized_question = self._normalize(question)

        for chunk in self.chunks:
            lexical_score = 0.0
            matches = 0

            for term in query_tokens:
                tf = float(chunk.term_freq.get(term, 0))
                if tf <= 0:
                    continue

                df = float(self.doc_freq.get(term, 0))
                idf = math.log(1 + (self.total_docs - df + 0.5) / (df + 0.5))
                denom = tf + k1 * (1 - b + b * (chunk.length / max(self.average_length, 1)))
                lexical_score += idf * ((tf * (k1 + 1)) / denom)
                matches += 1

            if matches == 0:
                continue

            if normalized_question and normalized_question in chunk.normalized_text:
                lexical_score += 1.15

            if re.search(r"powerlift|champion|record|deadlift|squat|bench|pr|max", normalized_question) and re.search(
                r"powerlift|champion|record|ipsu|deadlift|squat|bench|pr", chunk.normalized_text
            ):
                lexical_score += 0.75

            if re.search(r"research|paper|publication|medical|tumor|uncertainty", normalized_question) and re.search(
                r"research|journal|conference|medical|tumor|uncertainty", chunk.normalized_text
            ):
                lexical_score += 0.65

            semantic_score = self._cosine_sparse(query_vector, chunk.vector)

            lexical_rows.append(
                {
                    "chunk": chunk,
                    "lexical_score": lexical_score,
                    "semantic_score": semantic_score,
                    "matches": matches,
                }
            )

        if not lexical_rows:
            return []

        max_lexical = max(row["lexical_score"] for row in lexical_rows) or 1.0
        for row in lexical_rows:
            lexical_norm = row["lexical_score"] / max_lexical
            row["score"] = 0.58 * lexical_norm + 0.42 * row["semantic_score"]

        lexical_rows.sort(key=lambda row: row["score"], reverse=True)
        return lexical_rows[: max(1, int(top_k))]

    def _prepare_chunks(self) -> None:
        chunks: List[Chunk] = []

        for raw in self.raw_chunks:
            text = str(raw.get("text", "")).strip()
            if not text:
                continue

            tokens = [self._stem(token) for token in self._tokenize(text)]
            term_freq: Dict[str, int] = {}
            unique_tokens = set()
            for token in tokens:
                term_freq[token] = term_freq.get(token, 0) + 1
                unique_tokens.add(token)

            for token in unique_tokens:
                self.doc_freq[token] = self.doc_freq.get(token, 0) + 1

            chunks.append(
                Chunk(
                    chunk_id=str(raw.get("chunk_id", "")),
                    source_id=str(raw.get("source_id", "")),
                    source_title=str(raw.get("source_title", "Source")),
                    source_url=str(raw.get("source_url", "")),
                    page_index=int(raw.get("page_index", 0) or 0),
                    section=str(raw.get("section", "")),
                    text=text,
                    normalized_text=self._normalize(text),
                    tokens=tokens,
                    term_freq=term_freq,
                    length=max(len(tokens), 1),
                    vector={},
                )
            )

        self.chunks = chunks
        self.total_docs = len(self.chunks)
        self.average_length = (
            sum(chunk.length for chunk in self.chunks) / max(self.total_docs, 1)
        )

    def _load_or_build_cache(self, rebuild_cache: bool) -> None:
        cache_payload = None

        if not rebuild_cache and self.cache_path.exists():
            try:
                cache_payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                cache_payload = None

        valid_cache = bool(
            cache_payload
            and cache_payload.get("version") == self.CACHE_VERSION
            and cache_payload.get("source_generated_at") == self.generated_at
            and int(cache_payload.get("dims", 0)) == self.embedding_dims
        )

        if valid_cache:
            self.semantic_idf = {
                str(token): float(value)
                for token, value in cache_payload.get("semantic_idf", {}).items()
            }
            sparse_vectors = cache_payload.get("chunk_vectors", {})
            self.chunk_vector_cache = {
                chunk_id: {int(i): float(v) for i, v in items}
                for chunk_id, items in sparse_vectors.items()
            }
        else:
            self._build_semantic_vectors()
            self._write_cache()

        for chunk in self.chunks:
            chunk.vector = self.chunk_vector_cache.get(chunk.chunk_id, {})

    def _build_semantic_vectors(self) -> None:
        semantic_df: Dict[str, int] = {}
        for chunk in self.chunks:
            for token in set(chunk.tokens):
                semantic_df[token] = semantic_df.get(token, 0) + 1

        self.semantic_idf = {
            token: math.log((self.total_docs + 1.0) / (df + 1.0)) + 1.0
            for token, df in semantic_df.items()
        }

        self.chunk_vector_cache = {}
        for chunk in self.chunks:
            vector = self._build_vector(chunk.term_freq)
            self.chunk_vector_cache[chunk.chunk_id] = vector

    def _build_query_vector(self, query_tokens: List[str]) -> Dict[int, float]:
        tf: Dict[str, int] = {}
        for token in query_tokens:
            tf[token] = tf.get(token, 0) + 1
        return self._build_vector(tf)

    def _build_vector(self, term_freq: Dict[str, int]) -> Dict[int, float]:
        vector: Dict[int, float] = {}
        for token, raw_tf in term_freq.items():
            idf = self.semantic_idf.get(token, 0.0)
            if idf <= 0:
                continue

            weight = (1.0 + math.log(max(raw_tf, 1))) * idf
            index = self._stable_hash(token) % self.embedding_dims
            vector[index] = vector.get(index, 0.0) + weight

        norm = math.sqrt(sum(weight * weight for weight in vector.values()))
        if norm <= 0:
            return {}

        return {index: value / norm for index, value in vector.items()}

    def _write_cache(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "version": self.CACHE_VERSION,
            "source_generated_at": self.generated_at,
            "dims": self.embedding_dims,
            "semantic_idf": self.semantic_idf,
            "chunk_vectors": {
                chunk_id: [[int(index), float(value)] for index, value in sorted(vector.items())]
                for chunk_id, vector in self.chunk_vector_cache.items()
            },
        }
        self.cache_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
        )

    def _build_extractive_answer(self, question: str, retrieved: List[dict]) -> str:
        query_tokens = set(self._expand_query_tokens([self._stem(t) for t in self._tokenize(question)]))
        candidates: List[dict] = []

        for rank, row in enumerate(retrieved[:4]):
            chunk = row["chunk"]
            base_score = float(row.get("score", 0.0))

            for sentence in self._split_sentences(chunk.text):
                sentence_tokens = [self._stem(t) for t in self._tokenize(sentence)]
                if not sentence_tokens:
                    continue

                sentence_set = set(sentence_tokens)
                overlap = len(sentence_set & query_tokens) / max(len(sentence_set), 1)
                if rank > 1 and overlap < 0.1:
                    continue

                score = 0.66 * overlap + 0.34 * base_score
                candidates.append(
                    {
                        "score": score,
                        "sentence": sentence.strip(),
                        "chunk_id": chunk.chunk_id,
                    }
                )

        if not candidates:
            best_chunk = retrieved[0]["chunk"]
            fallback = self._split_sentences(best_chunk.text)
            if fallback:
                return fallback[0]
            return "I do not have that in the current knowledge base."

        unique = []
        seen = set()
        for item in sorted(candidates, key=lambda x: x["score"], reverse=True):
            normalized = self._normalize(item["sentence"])
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            unique.append(item["sentence"])
            if len(unique) >= 3:
                break

        if not unique:
            return "I do not have that in the current knowledge base."

        return " ".join(unique)

    def _score_sentence_grounding(self, answer_text: str, selected_chunks: List[Chunk]) -> dict:
        sentences = self._split_sentences(answer_text)
        per_sentence = []

        for sentence in sentences:
            sentence_tokens = [self._stem(t) for t in self._tokenize(sentence)]
            sentence_set = set(sentence_tokens)
            normalized_sentence = self._normalize(sentence)

            best_score = 0.0
            best_chunk_id = ""

            for chunk in selected_chunks:
                chunk_token_set = set(chunk.tokens)
                overlap_count = len(sentence_set & chunk_token_set)
                overlap_score = overlap_count / max(len(sentence_set), 1)

                phrase_bonus = 1.0 if normalized_sentence and normalized_sentence in chunk.normalized_text else 0.0
                score = min(1.0, overlap_score * 0.72 + phrase_bonus * 0.28)

                if score > best_score:
                    best_score = score
                    best_chunk_id = chunk.chunk_id

            per_sentence.append(
                {
                    "sentence": sentence,
                    "score": best_score,
                    "chunk_id": best_chunk_id,
                    "is_major_claim": len(sentence_tokens) >= 4,
                    "is_supported": best_score >= 0.56 and bool(best_chunk_id),
                }
            )

        average_support = sum(item["score"] for item in per_sentence) / max(len(per_sentence), 1)
        major_claims = [item for item in per_sentence if item["is_major_claim"]]
        supported_major_claims = [item for item in major_claims if item["is_supported"]]

        return {
            "per_sentence": per_sentence,
            "average_support": average_support,
            "major_claim_count": len(major_claims),
            "supported_major_claim_count": len(supported_major_claims),
        }

    def _apply_response_policy(self, answer_text: str, grounding: dict, selected_chunks: List[Chunk]) -> dict:
        has_source_per_major_claim = (
            grounding["major_claim_count"] == 0
            or grounding["supported_major_claim_count"] >= grounding["major_claim_count"]
        )
        allow_full = grounding["average_support"] >= 0.62 and has_source_per_major_claim

        if allow_full:
            return {"answer": answer_text, "notice": "", "links": []}

        supported_sentences = [
            item["sentence"] for item in grounding["per_sentence"] if item["score"] >= 0.56
        ]
        shortened = " ".join(supported_sentences[:2]).strip()

        if not shortened:
            shortened = "I do not have enough reliable evidence in the current sources to answer that clearly yet."
        else:
            shortened = (
                f"{shortened} I can share this partial answer, but I may be "
                "missing enough evidence for a complete response."
            )

        links = self._build_source_links(selected_chunks)
        notice = "I found only partial support in the sources."
        if links:
            notice = f"{notice} Use the source links below for full details."

        return {"answer": shortened, "notice": notice, "links": links}

    def _build_source_links(self, selected_chunks: List[Chunk]) -> List[dict]:
        links: List[dict] = []
        seen_sources = set()

        for chunk in selected_chunks:
            if not chunk.source_id or chunk.source_id in seen_sources:
                continue

            href = self._resolve_source_url(chunk.source_url)
            if not href:
                continue

            seen_sources.add(chunk.source_id)
            label = chunk.source_title or "Source"
            if chunk.source_id == "resume_nov2025":
                label = "Open Resume"
            elif chunk.source_id == "ucf_mind_to_move_mountains_2026":
                label = "Open UCF Article"

            links.append({"label": label, "href": href})
            if len(links) >= 2:
                break

        return links

    def _resolve_source_url(self, source_url: str) -> str:
        source_url = str(source_url or "").strip()
        if not source_url:
            return ""
        if source_url.startswith("local://"):
            return ""
        if source_url.startswith("http://") or source_url.startswith("https://"):
            return source_url
        return urljoin(self.frontend_base_url, source_url)

    def _append_notice(self, current_notice: str, next_notice: str) -> str:
        base = str(current_notice or "").strip()
        incoming = str(next_notice or "").strip()
        if not incoming:
            return base
        if not base:
            return incoming
        return f"{base} {incoming}"

    def _normalize_citations(self, citation_ids: List[str], selected_chunks: List[Chunk]) -> List[dict]:
        known = {chunk.chunk_id: chunk for chunk in selected_chunks}
        results = []
        seen_sources = set()

        for chunk_id in citation_ids:
            chunk = known.get(chunk_id)
            source_key = chunk.source_id if chunk else ""
            if not chunk or source_key in seen_sources:
                continue

            seen_sources.add(source_key)
            results.append({"id": source_key or chunk.chunk_id, "label": self._citation_label(chunk)})

        return results[:5]

    def _citation_label(self, chunk: Chunk) -> str:
        if chunk.source_id == "resume_nov2025":
            return "Resume"
        if chunk.source_id == "ucf_mind_to_move_mountains_2026":
            return "The Mind to Move Mountains"
        if chunk.source_id == "ilkin_profile_facts":
            return "Profile Facts"
        return chunk.source_title or "Source"

    def _format_support_scores(self, grounding: dict) -> List[dict]:
        results = []
        for idx, item in enumerate(grounding["per_sentence"]):
            results.append(
                {
                    "label": f"S{idx + 1}: {item['score']:.2f}",
                    "supported": bool(item["score"] >= 0.56),
                }
            )
        return results

    def _assess_retrieval_strength(self, retrieved: List[dict]) -> dict:
        if not retrieved:
            return {
                "passed": False,
                "top_score": 0.0,
                "average_top_score": 0.0,
                "top_matches": 0,
            }

        top = retrieved[0]
        sample = retrieved[:3]

        top_score = float(top.get("score", 0.0))
        top_matches = int(top.get("matches", 0))
        average_top_score = sum(float(item.get("score", 0.0)) for item in sample) / max(len(sample), 1)

        return {
            "passed": top_score >= 0.42 and average_top_score >= 0.3 and top_matches >= 1,
            "top_score": top_score,
            "average_top_score": average_top_score,
            "top_matches": top_matches,
        }

    def _cosine_sparse(self, left: Dict[int, float], right: Dict[int, float]) -> float:
        if not left or not right:
            return 0.0

        if len(left) > len(right):
            left, right = right, left

        dot = 0.0
        for index, value in left.items():
            dot += value * right.get(index, 0.0)

        return max(0.0, min(1.0, dot))

    def _expand_query_tokens(self, tokens: List[str]) -> List[str]:
        expanded = set(tokens)
        token_set = set(tokens)

        for item in THEME_EXPANSIONS:
            match_tokens = [self._stem(token) for token in item["match"]]
            if any(token in token_set for token in match_tokens):
                for term in item["add"]:
                    expanded.add(self._stem(term))

        return [token for token in expanded if token]

    def _tokenize(self, text: str) -> List[str]:
        return [
            token
            for token in TOKEN_PATTERN.findall(str(text or "").lower())
            if token and token not in STOP_WORDS and len(token) > 1
        ]

    def _stem(self, token: str) -> str:
        token = str(token or "").lower().strip()
        if len(token) > 5 and token.endswith("ing"):
            return token[:-3]
        if len(token) > 4 and token.endswith("ed"):
            return token[:-2]
        if len(token) > 4 and token.endswith("es"):
            return token[:-2]
        if len(token) > 3 and token.endswith("s"):
            return token[:-1]
        return token

    def _split_sentences(self, text: str) -> List[str]:
        compact = str(text or "").strip()
        if not compact:
            return []
        compact = compact.replace("•", ". ")
        compact = re.sub(r"\\s+o\\s+", ". ", compact)
        compact = re.sub(r"\\s+", " ", compact).strip()
        return [part.strip() for part in SENTENCE_PATTERN.split(compact) if part.strip()]

    def _normalize(self, text: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s+]", " ", str(text).lower())).strip()

    def _stable_hash(self, token: str) -> int:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        return int.from_bytes(digest, byteorder="big", signed=False)
