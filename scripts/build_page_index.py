#!/usr/bin/env python3
"""Build a local page index for the homepage RAG assistant.

Sources are intentionally restricted to:
1) assets/Ilkin_Isler_Resume.pdf
2) UCF article "The Mind to Move Mountains"
3) First-party profile facts below
"""

from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, List

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "page-index.json"
RESUME_PATH = ROOT / "assets" / "Ilkin_Isler_Resume.pdf"
RESUME_SOURCE_ID = "resume_oct2026"
RESUME_SOURCE_TITLE = "Ilkin Isler Resume (Oct 2026)"
ARTICLE_PUBLIC_URL = "https://www.ucf.edu/news/the-mind-to-move-mountains/"
ARTICLE_API_URL = "https://www.ucf.edu/news/wp-json/wp/v2/posts/150753"

MAX_CHUNK_CHARS = 560
MIN_CHUNK_CHARS = 120

PHONE_PATTERN = re.compile(
    r"(?:\+?\d{1,2}\s*)?\(?\d{3}\)?(?:\s+|-\s*)\d{3}(?:\s+|-\s*)\d{4}"
)


@dataclass
class Chunk:
    chunk_id: str
    source_id: str
    source_title: str
    source_url: str
    page_index: int
    section: str
    text: str


def normalize_text(text: str) -> str:
    text = unescape(text)
    text = text.replace("\u2019", "'")
    text = text.replace("\u2018", "'")
    text = text.replace("\u2013", "-")
    text = text.replace("\u2014", "-")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = PHONE_PATTERN.sub("[redacted]", text)
    return text


def strip_tags(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html)
    return normalize_text(text)


def split_sentences(text: str) -> List[str]:
    compact = normalize_text(text)
    if not compact:
        return []
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", compact)
    return [part.strip() for part in parts if part.strip()]


def chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS) -> List[str]:
    sentences = split_sentences(text)
    if not sentences:
        compact = normalize_text(text)
        return [compact] if compact else []

    chunks: List[str] = []
    current: List[str] = []
    current_len = 0

    for sentence in sentences:
        sentence_len = len(sentence)
        if current and current_len + 1 + sentence_len > max_chars:
            chunk = " ".join(current).strip()
            if chunk:
                chunks.append(chunk)
            current = [sentence]
            current_len = sentence_len
        else:
            current.append(sentence)
            current_len += sentence_len + (1 if current_len else 0)

    if current:
        chunk = " ".join(current).strip()
        if chunk:
            chunks.append(chunk)

    merged: List[str] = []
    buffer = ""
    for chunk in chunks:
        if len(chunk) < MIN_CHUNK_CHARS and merged:
            merged[-1] = f"{merged[-1]} {chunk}".strip()
        elif len(chunk) < MIN_CHUNK_CHARS and not merged:
            buffer = f"{buffer} {chunk}".strip()
        else:
            if buffer:
                chunk = f"{buffer} {chunk}".strip()
                buffer = ""
            merged.append(chunk)

    if buffer:
        if merged:
            merged[-1] = f"{merged[-1]} {buffer}".strip()
        else:
            merged.append(buffer)

    return [chunk for chunk in merged if chunk]


class ArticleParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.capture_tags = {"p", "h2", "h3", "li"}
        self.current_tag = ""
        self.current_parts: List[str] = []
        self.blocks: List[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.capture_tags:
            self.current_tag = tag
            self.current_parts = []

    def handle_data(self, data: str) -> None:
        if self.current_tag:
            self.current_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.current_tag and tag == self.current_tag:
            text = normalize_text(" ".join(self.current_parts))
            if text:
                self.blocks.append({"tag": tag, "text": text})
            self.current_tag = ""
            self.current_parts = []


def extract_resume_chunks() -> List[Chunk]:
    source_id = RESUME_SOURCE_ID
    source_title = RESUME_SOURCE_TITLE
    source_url = "assets/Ilkin_Isler_Resume.pdf"

    reader = PdfReader(str(RESUME_PATH))
    chunks: List[Chunk] = []

    section_patterns = [
        "PROFESSIONAL SUMMARY",
        "EDUCATION",
        "WORK EXPERIENCE",
        "PROFESSIONAL EXPERIENCE",
        "TECHNICAL SKILLS",
        "AREAS OF EXPERTISE",
        "ACADEMIA",
        "ADDITIONAL CREDENTIALS",
        "HONORS & AWARDS",
        "PUBLICATIONS & ACADEMIC SERVICE",
        "ADDITIONAL",
    ]

    for page_index, page in enumerate(reader.pages, start=1):
        raw = page.extract_text() or ""
        text = raw
        for marker in section_patterns:
            text = text.replace(marker, f"\n{marker}\n")
        text = text.replace("•", "\n• ")
        text = text.replace("|", " | ")
        text = re.sub(r"[ \t]+", " ", text)
        text = text.replace(" \n", "\n").replace("\n ", "\n")

        lines = [line.strip() for line in text.split("\n") if line.strip()]
        section = f"Resume Page {page_index}"
        chunk_counter = 0

        # PDF text wraps bullets across lines; join continuation lines back onto
        # their bullet so chunks never end mid-sentence.
        blocks: List[tuple[str, str]] = []
        current: List[str] = []
        for line in lines:
            if line.isupper() and len(line) <= 60:
                if current:
                    blocks.append((section, " ".join(current)))
                    current = []
                section = line.title()
                continue
            starts_block = (
                line.startswith("•")
                or re.match(r"^[A-Z][\w &/,-]{2,40}:", line)  # skill rows, "Peer Reviewer:", "Athletics:"
                or re.search(r"((19|20)\d{2}|Present)\s*$", line)  # role and degree lines ending in a date
            )
            if starts_block and current:
                blocks.append((section, " ".join(current)))
                current = []
            current.append(line)
        if current:
            blocks.append((section, " ".join(current)))

        for block_section, block in blocks:
            for piece in chunk_text(block.lstrip("• ")):
                chunk_counter += 1
                chunks.append(
                    Chunk(
                        chunk_id=f"resume-p{page_index}-c{chunk_counter}",
                        source_id=source_id,
                        source_title=source_title,
                        source_url=source_url,
                        page_index=page_index,
                        section=block_section,
                        text=piece,
                    )
                )

    return chunks


def extract_article_chunks() -> List[Chunk]:
    source_id = "ucf_mind_to_move_mountains_2026"
    source_title = "The Mind to Move Mountains (UCF News)"
    source_url = ARTICLE_PUBLIC_URL

    request = urllib.request.Request(
        ARTICLE_API_URL,
        headers={"User-Agent": "ilkin-page-index-builder/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    parser = ArticleParser()
    parser.feed(payload.get("content", {}).get("rendered", ""))

    chunks: List[Chunk] = []
    chunk_counter = 0
    block_index = 0
    current_section = "Article"

    title_text = normalize_text(payload.get("title", {}).get("rendered", ""))
    if title_text:
        chunk_counter += 1
        chunks.append(
            Chunk(
                chunk_id=f"mind-p0-c{chunk_counter}",
                source_id=source_id,
                source_title=source_title,
                source_url=source_url,
                page_index=0,
                section="Title",
                text=title_text,
            )
        )

    excerpt_text = strip_tags(payload.get("excerpt", {}).get("rendered", ""))
    if excerpt_text:
        chunk_counter += 1
        chunks.append(
            Chunk(
                chunk_id=f"mind-p0-c{chunk_counter}",
                source_id=source_id,
                source_title=source_title,
                source_url=source_url,
                page_index=0,
                section="Excerpt",
                text=excerpt_text,
            )
        )

    for block in parser.blocks:
        text = block["text"]
        tag = block["tag"]
        if len(text) < 20:
            continue

        if tag in {"h2", "h3"}:
            current_section = text
            continue

        block_index += 1
        section = current_section
        for piece in chunk_text(text):
            chunk_counter += 1
            chunks.append(
                Chunk(
                    chunk_id=f"mind-p{block_index}-c{chunk_counter}",
                    source_id=source_id,
                    source_title=source_title,
                    source_url=source_url,
                    page_index=block_index,
                    section=section,
                    text=piece,
                )
            )

    return chunks


def extract_profile_chunks() -> List[Chunk]:
    source_id = "ilkin_profile_facts"
    source_title = "Ilkin Profile Facts"
    source_url = "local://profile-facts"

    facts = [
        (
            "Background",
            "I moved from Turkey to the United States to pursue AI at UCF, where I earned my MS in Computer Science in 2022 and my PhD in 2025.",
        ),
        (
            "Projects",
            "At work I build enterprise AI systems: an in-house AI platform for deploying, orchestrating, and governing AI tools, agents, and multi-agent workflows (including MCP servers, tool calling, and agent skills), LLM evaluation and hallucination detection pipelines, and human-in-the-loop tools for finance and cost estimating. On my own time I build personal AI assistants for home workflows and daily automation, and this site's grounded assistant.",
        ),
        (
            "Finance Initiative",
            "One of my two main initiatives at work is AI for finance reporting and forecasting. Finance teams kept a separate, frequently reworked spreadsheet for every project, so monthly reporting meant hours of manual consolidation. As solution architect, I designed from scratch, and led the developers who built, human-in-the-loop AI tools that bring project finance data into one adaptable source of truth, surface the top cost drivers each month, flag transactions worth a closer look, and support forecasting while the analyst stays in control of every number. I started from how analysts actually close a month, kept every output reviewable, and evaluated new methods before they reached the team. Cash Flow & Earned Value is in production with 70+ finance users globally, saving 15–30 minutes per analysis and about an hour per forecast; Monthly Update Insights and Risk & Contingency have their first versions in production, with more in development.",
        ),
        (
            "Estimating Initiative",
            "My other main initiative is AI-assisted cost estimating, which I lead along with its developers. Estimating large, one-of-a-kind projects depends on deep expertise and messy, non-standardized inputs, and the estimators were skeptical at first. I designed from scratch, and my developers built, the Estimator Builder: a suite of 12 purpose-built, human-in-the-loop applications for about 80 users, with 6+ shipped, that read design drawings to draft scope, turn messy scope lists into structured estimates and track how they change, and retrieve everything previously paid for an item. Instead of replacing their Excel workflows, the tools accept their existing files and return results in the same format; we started with small validated wins and added automation as trust grew. The conversation moved from whether it would work to what else we could automate. I am also building, from scratch and as the sole engineer (Python and Neo4j, deployed through our CI/CD pipeline), a project-intelligence tool on a temporal knowledge-graph architecture similar to Graphiti: project decks, schedules, and budget updates are ingested as episodes, an LLM extracts entities and relationships into a graph, facts keep their history instead of being overwritten, and retrieval combines semantic search, keyword search, and graph traversal. It gives senior leadership one view of what changed across a project and how it affects budgets, plans, and schedules.",
        ),
        (
            "Research",
            "My research is about building AI that people can rely on, which starts with knowing when a model is wrong. During my PhD I designed 3D neural network architectures, loss functions, and uncertainty quantification methods for tumor and organ-at-risk segmentation; my self-supervised and uncertainty-guided approaches achieved state-of-the-art results at publication. Today I apply the same idea to LLMs: retrieval-augmented generation, hallucination detection, groundedness and citation checks, and evaluation pipelines that decide when an answer can be trusted, or when the system should decline to answer.",
        ),
        (
            "Publications",
            "Selected publications with links: Pancreas CT/MRI segmentation (2025) https://doi.org/10.1016/j.media.2024.103382; Power-VR (2022) https://doi.org/10.1002/cav.2045; Uncertainty-Guided Tumor Segmentation (2025) https://doi.org/10.48550/arXiv.2504.12215; OAR and Tumor Segmentation with UQ (2023) https://doi.org/10.1109/ICECCME57830.2023.10252269; Enhancing OAR Segmentation (2022) https://doi.org/10.1117/12.2611498; Facial Expression Translation (2019) https://doi.org/10.48550/arXiv.1910.05595; Generative AI in Medical Imaging (2024) https://doi.org/10.1007/978-3-031-72787-0_17. Full list: https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en.",
        ),
        (
            "Strength",
            "My powerlifting PRs are Squat 355 lbs, Bench 200 lbs, and Deadlift 475 lbs. I am a European powerlifting champion (1st Place Overall at the IPSU European Championship) and a two-time Overall Champion of Türkiye. I am still holding deadlift records in Turkiye since 2020 and in Florida since 2022. These include both junior and open records, and I broke both while I was a junior. Sources: USAPL records database https://usapl.liftingdatabase.com/records-default?priority=0&recordtypeid=120382&categoryid=&weightclassid= and IPF Turkiye records https://powerlifting.org.tr/turkiye-rekorlari.",
        ),
        (
            "Media",
            "My featured story is The Mind to Move Mountains (UCF News): https://www.ucf.edu/news/the-mind-to-move-mountains/.",
        ),
        (
            "Contact",
            "You can reach me at ilkinisler@gmail.com. LinkedIn: https://www.linkedin.com/in/ilkinsevgiisler/. Google Scholar: https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en. GitHub: https://github.com/ilkinisler.",
        ),
        (
            "This Assistant",
            "This assistant answers only from my resume, the UCF News feature, and these first-party facts. It uses hybrid retrieval (BM25-style keyword matching plus embedding similarity), declines to answer when retrieval confidence is low instead of guessing, and checks that each answer sentence is supported by a source. I built it as a small, public example of the grounded, hallucination-aware systems I build at work.",
        ),
    ]

    chunks: List[Chunk] = []
    for index, (section, fact) in enumerate(facts, start=1):
        chunks.append(
            Chunk(
                chunk_id=f"profile-p1-c{index}",
                source_id=source_id,
                source_title=source_title,
                source_url=source_url,
                page_index=1,
                section=section,
                text=fact,
            )
        )

    return chunks


def build_page_index(chunks: Iterable[Chunk]) -> dict:
    chunk_list = list(chunks)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pipeline": "page-index-rag-v1",
        "sources": [
            {
                "source_id": RESUME_SOURCE_ID,
                "title": RESUME_SOURCE_TITLE,
                "type": "pdf",
                "url": "assets/Ilkin_Isler_Resume.pdf",
                "note": "Primary professional record",
            },
            {
                "source_id": "ucf_mind_to_move_mountains_2026",
                "title": "The Mind to Move Mountains (UCF News)",
                "type": "article",
                "url": ARTICLE_PUBLIC_URL,
                "published": "2026-02-24",
                "note": "Personal story and motivations",
            },
            {
                "source_id": "ilkin_profile_facts",
                "title": "Ilkin Profile Facts",
                "type": "manual",
                "url": "local://profile-facts",
                "note": "First-party facts provided directly by Ilkin Isler",
            },
        ],
        "chunks": [
            {
                "chunk_id": chunk.chunk_id,
                "source_id": chunk.source_id,
                "source_title": chunk.source_title,
                "source_url": chunk.source_url,
                "page_index": chunk.page_index,
                "section": chunk.section,
                "text": chunk.text,
            }
            for chunk in chunk_list
        ],
    }


def main() -> None:
    if not RESUME_PATH.exists():
        raise FileNotFoundError(f"Resume not found: {RESUME_PATH}")

    resume_chunks = extract_resume_chunks()
    article_chunks = extract_article_chunks()
    profile_chunks = extract_profile_chunks()
    payload = build_page_index([*resume_chunks, *article_chunks, *profile_chunks])

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    print(f"Wrote {OUTPUT_PATH}")
    print(f"Resume chunks: {len(resume_chunks)}")
    print(f"Article chunks: {len(article_chunks)}")
    print(f"Profile chunks: {len(profile_chunks)}")
    print(f"Total chunks: {len(payload['chunks'])}")


if __name__ == "__main__":
    main()
