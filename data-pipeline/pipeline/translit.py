"""Macedonian Cyrillic -> Latin transliteration and search normalisation.

Uses the official romanisation of Macedonian (adopted by the Government of
North Macedonia and BGN/PCGN 2013). The backend contains an identical Java
implementation (``mk.accessibleskopje.common.Transliteration``); keep them in sync.
"""

from __future__ import annotations

import unicodedata

_MK = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ѓ": "gj", "е": "e",
    "ж": "zh", "з": "z", "ѕ": "dz", "и": "i", "ј": "j", "к": "k", "л": "l",
    "љ": "lj", "м": "m", "н": "n", "њ": "nj", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "ќ": "kj", "у": "u", "ф": "f", "х": "h", "ц": "c",
    "ч": "ch", "џ": "dzh", "ш": "sh",
    # Serbian/Russian letters occasionally found in names
    "ђ": "dj", "ћ": "c", "й": "j", "ы": "y", "э": "e", "ю": "ju", "я": "ja",
    "щ": "shch", "ъ": "", "ь": "", "ё": "jo",
}


def to_latin(text: str) -> str:
    """Transliterate Macedonian Cyrillic to Latin, preserving capitalisation."""
    out = []
    for ch in text:
        low = ch.lower()
        if low in _MK:
            rep = _MK[low]
            if ch != low and rep:
                rep = rep[0].upper() + rep[1:]
            out.append(rep)
        else:
            out.append(ch)
    return "".join(out)


def has_cyrillic(text: str) -> bool:
    return any("Ѐ" <= ch <= "ӿ" for ch in text)


def normalize_for_search(text: str) -> str:
    """Lowercase, transliterate and strip diacritics (Albanian ë/ç, etc.) so that
    "Македонија", "Makedonija" and "makedonija" all match each other."""
    t = to_latin(text.lower())
    t = unicodedata.normalize("NFKD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = "".join(ch if ch.isalnum() else " " for ch in t)
    return " ".join(t.split())
