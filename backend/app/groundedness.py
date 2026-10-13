from __future__ import annotations

import threading
from typing import List

# Vectara HHEM-2.1-Open: scores how well a premise (retrieved context) supports a
# hypothesis (generated answer), 0 = unsupported, 1 = fully supported.
# The model ships custom code (trust_remote_code), so the revision is pinned to the
# version that was reviewed: it only uses torch/transformers, no I/O or network.
HHEM_MODEL_ID = "vectara/hallucination_evaluation_model"
HHEM_REVISION = "de9a5e6ba9ba49531a022dba17e35ffeb2a6fad8"
HHEM_LABEL = "HHEM-2.1-Open"


class HHEMScorer:
    """Lazily loads HHEM on first use so the API starts fast and stays usable if loading fails."""

    def __init__(self, model_id: str = HHEM_MODEL_ID, revision: str = HHEM_REVISION) -> None:
        self.model_id = model_id
        self.revision = revision
        self._model = None
        self._load_error: str = ""
        self._lock = threading.Lock()

    @property
    def label(self) -> str:
        return HHEM_LABEL

    @property
    def available(self) -> bool:
        return self._ensure_loaded()

    def score(self, premise: str, hypothesis: str) -> float | None:
        """Return P(hypothesis is supported by premise) in [0, 1], or None if HHEM is unavailable."""
        if not premise.strip() or not hypothesis.strip() or not self._ensure_loaded():
            return None
        scores = self._model.predict([(premise, hypothesis)])
        return float(scores[0])

    def warm_up(self) -> None:
        self._ensure_loaded()

    def _ensure_loaded(self) -> bool:
        if self._model is not None:
            return True
        if self._load_error:
            return False
        with self._lock:
            if self._model is not None:
                return True
            try:
                from transformers import AutoModelForSequenceClassification

                model = AutoModelForSequenceClassification.from_pretrained(
                    self.model_id,
                    revision=self.revision,
                    trust_remote_code=True,
                )
                model.eval()
                self._model = model
            except Exception as error:  # missing deps, no network, incompatible transformers
                self._load_error = f"{type(error).__name__}: {error}"
                return False
        return True

    @property
    def load_error(self) -> str:
        return self._load_error


def build_premise(chunk_texts: List[str]) -> str:
    return "\n\n".join(text.strip() for text in chunk_texts if text and text.strip())
