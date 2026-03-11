#!/usr/bin/env python3
"""Build a local page index for the homepage RAG assistant.

Sources are intentionally restricted to:
1) assets/resumeilkinisler-nov5.pdf
2) UCF article "The Mind to Move Mountains"
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
RESUME_PATH = ROOT / "assets" / "resumeilkinisler-nov5.pdf"
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
    source_id = "resume_nov2025"
    source_title = "Ilkin Isler Resume (Nov 2025)"
    source_url = "assets/resumeilkinisler-nov5.pdf"

    reader = PdfReader(str(RESUME_PATH))
    chunks: List[Chunk] = []

    section_patterns = [
        "PROFESSIONAL SUMMARY",
        "EDUCATION",
        "WORK EXPERIENCE",
        "TECHNICAL SKILLS",
        "AREAS OF EXPERTISE",
        "ACADEMIA",
        "ADDITIONAL CREDENTIALS",
        "HONORS & AWARDS",
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

        for line in lines:
            heading = line.strip()
            if heading.isupper() and len(heading) <= 60:
                section = heading.title()
                continue

            for piece in chunk_text(line):
                chunk_counter += 1
                chunks.append(
                    Chunk(
                        chunk_id=f"resume-p{page_index}-c{chunk_counter}",
                        source_id=source_id,
                        source_title=source_title,
                        source_url=source_url,
                        page_index=page_index,
                        section=section,
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
            "I have been building trustworthy AI systems and LLM/RAG workflows for high-impact environments, including uncertainty-aware decision support, explainability, and hallucination-aware pipelines. I am also building personal AI assistants for home workflows and daily automation.",
        ),
        (
            "Research",
            "My research focuses on medical imaging, explainable AI, and uncertainty modeling, with the goal of building systems clinicians and real-world operators can trust. During my PhD, my dissertation centered on advanced AI algorithms for medical imaging, including tumor and organ-at-risk segmentation. More recently, I have been working on LLM and retrieval-augmented generation (RAG) systems with hallucination detection, groundedness evaluation, citation, meta tagging, and topic modeling.",
        ),
        (
            "Publications",
            "Selected publications with links: Pancreas CT/MRI segmentation (2025) https://doi.org/10.1016/j.media.2024.103382; Power-VR (2022) https://doi.org/10.1002/cav.2045; Uncertainty-Guided Tumor Segmentation (2025) https://doi.org/10.48550/arXiv.2504.12215; OAR and Tumor Segmentation with UQ (2023) https://doi.org/10.1109/ICECCME57830.2023.10252269; Enhancing OAR Segmentation (2022) https://doi.org/10.1117/12.2611498; Facial Expression Translation (2019) https://doi.org/10.48550/arXiv.1910.05595; Generative AI in Medical Imaging (2024) https://doi.org/10.1007/978-3-031-72787-0_17. Full list: https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en.",
        ),
        (
            "Strength",
            "My powerlifting PRs are Squat 355 lbs, Bench 200 lbs, and Deadlift 475 lbs. I am a European powerlifting champion and a national champion in Turkey.",
        ),
        (
            "Media",
            "My featured story is The Mind to Move Mountains (UCF News): https://www.ucf.edu/news/the-mind-to-move-mountains/.",
        ),
        (
            "Contact",
            "You can reach me at ilkinisler@gmail.com. LinkedIn: https://www.linkedin.com/in/ilkinsevgiisler/. Google Scholar: https://scholar.google.com/citations?user=ZgPdlJ0AAAAJ&hl=en.",
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
                "source_id": "resume_nov2025",
                "title": "Ilkin Isler Resume (Nov 2025)",
                "type": "pdf",
                "url": "assets/resumeilkinisler-nov5.pdf",
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
