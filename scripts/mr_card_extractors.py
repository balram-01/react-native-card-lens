#!/usr/bin/env python3
"""
Deterministic extraction layer for Marathi/Devanagari business cards.

This module owns every field that can be recovered by rule rather than by a
model: phone numbers, pincode, email, website, GSTIN. These reach ~100%
accuracy without any training, so the SLM should never be asked to produce
them. It also provides gazetteer snapping (consonant-skeleton edit distance),
which is what repairs OCR drift like नागपुर -> नागपूर and सचालक -> संचालक.

Pipeline position:
    OCR text -> normalize_text -> extract_deterministic -> strip matched spans
             -> SLM (company / tagline / services / persons / address)
             -> snap_to_gazetteer -> merge -> validate
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

# ─── Unicode normalization ───────────────────────────────────────────────────

DEV_TO_ASCII = str.maketrans("०१२३४५६७८९", "0123456789")

# Matras, virama, anusvara, candrabindu, nukta, avagraha — dropped when building
# the "consonant skeleton" used for fuzzy matching. OCR corrupts these far more
# often than it corrupts base consonants.
_DIACRITICS = re.compile(
    "["
    "\u0900-\u0903"   # inverted candrabindu, candrabindu, anusvara, visarga
    "\u093A-\u094F"   # matras + virama
    "\u0951-\u0957"   # stress/accent marks
    "\u093C"          # nukta
    "\u0962-\u0963"   # vocalic l matras
    "\u200C\u200D"    # ZWNJ / ZWJ
    "]"
)

_ZERO_WIDTH = re.compile("[\u200B\u200C\u200D\uFEFF]")


def normalize_text(text: str) -> str:
    """NFC-normalize, convert Devanagari digits to ASCII, tidy whitespace.

    Always run this before anything else. PaddleOCR and ML Kit disagree on
    decomposed vs composed forms, and a stray ZWJ will silently break every
    string comparison you make downstream.
    """
    text = unicodedata.normalize("NFC", text)
    text = _ZERO_WIDTH.sub("", text)
    text = text.translate(DEV_TO_ASCII)
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def skeleton(text: str) -> str:
    """Consonant skeleton: NFC, strip diacritics, strip non-letters, casefold.

    साहु मोटर्स -> साहमटरस ;  साहु मोटसी -> साहमटस
    This makes edit distance robust to the matra/ligature damage that dominates
    Devanagari OCR error.
    """
    text = unicodedata.normalize("NFC", text)
    text = _DIACRITICS.sub("", text)
    text = re.sub(r"[^\w]", "", text, flags=re.UNICODE)
    return text.casefold()


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similarity(a: str, b: str) -> float:
    """Skeleton-normalized similarity in [0, 1]."""
    sa, sb = skeleton(a), skeleton(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    return 1.0 - levenshtein(sa, sb) / max(len(sa), len(sb))


# ─── Gazetteers ──────────────────────────────────────────────────────────────

MH_CITIES = [
    "नागपूर", "पुणे", "मुंबई", "नाशिक", "छत्रपती संभाजीनगर", "कोल्हापूर",
    "सोलापूर", "अमरावती", "नांदेड", "अकोला", "जळगाव", "सांगली", "सातारा",
    "लातूर", "अहिल्यानगर", "चंद्रपूर", "परभणी", "धुळे", "बीड", "वर्धा",
    "ठाणे", "नवी मुंबई", "पिंपरी चिंचवड", "इचलकरंजी", "भुसावळ", "यवतमाळ",
]

ROLES = [
    "संचालक", "सह-संचालक", "व्यवस्थापक", "प्रोप्रायटर", "अध्यक्ष", "उपाध्यक्ष",
    "सचिव", "भागीदार", "मालक", "मुख्य सल्लागार", "सेल्स मॅनेजर", "अभियंता",
    "डॉक्टर", "अधिवक्ता", "लेखापाल", "प्रमुख", "संस्थापक",
]

ADDRESS_WORDS = [
    "पत्ता", "चौक", "नगर", "पेठ", "रोड", "मार्ग", "गल्ली", "वाडी", "पुरा",
    "पुरी", "कॉलनी", "सोसायटी", "बिल्डिंग", "कॉम्प्लेक्स", "दुकान", "गाळा",
    "मजला", "समोर", "जवळ", "शेजारी", "ता.", "जि.", "तालुका", "जिल्हा",
]

BUSINESS_SUFFIXES = [
    "मोटर्स", "एंटरप्रायझेस", "ट्रेडर्स", "इंडस्ट्रीज", "ज्वेलर्स", "गॅरेज",
    "सेवा केंद्र", "इलेक्ट्रॉनिक्स", "ट्रॅव्हल्स", "कन्स्ट्रक्शन", "भांडार",
    "स्टोअर्स", "क्लिनिक", "असोसिएट्स", "हार्डवेअर", "सेंटर", "अँड कंपनी",
    "फर्निचर", "मेडिकल", "ऑटोमोबाईल्स", "डेअरी", "बेकरी", "प्रिंटर्स",
]


# Edit distance has a hard limit: हायोक -> चौक shares almost no skeleton
# (हायक vs चक), so no threshold recovers it. These are the corruptions that
# need an explicit learned mapping. Grow this table from your real-card error
# log — every entry here is a bug you saw once and will never see again.
OCR_ALIASES: Dict[str, str] = {
    "हायोक": "चौक",
    "चाक": "चौक",
    "पता": "पत्ता",
    "मोटसी": "मोटर्स",
    "मोटसि": "मोटर्स",
    "रथा": "रिक्षा",
    "रत्था": "रिक्षा",
    "सव्हिस": "सर्व्हिस",
    "एटरप्रायझेस": "एंटरप्रायझेस",
}


def apply_aliases(text: str) -> str:
    """Token-wise alias substitution. Run before gazetteer snapping."""
    out = []
    for tok in text.split():
        stripped = tok.strip(".,;:-()[]")
        repl = OCR_ALIASES.get(stripped)
        out.append(tok.replace(stripped, repl) if repl else tok)
    return " ".join(out)


def snap(value: str, vocabulary: Iterable[str], threshold: float = 0.72) -> str:
    """Snap an OCR-damaged token to the closest gazetteer entry.

    Returns the original value untouched if nothing clears `threshold` — never
    force a match, since a wrong snap is worse than leaving the raw string.
    """
    if not value:
        return value
    best, best_score = value, 0.0
    for candidate in vocabulary:
        score = similarity(value, candidate)
        if score > best_score:
            best, best_score = candidate, score
    return best if best_score >= threshold else value


def snap_tokens(text: str, vocabulary: Iterable[str], threshold: float = 0.78) -> str:
    """Word-wise snapping inside a longer string (e.g. an address line)."""
    text = apply_aliases(text)
    return " ".join(snap(tok, vocabulary, threshold) for tok in text.split())


# ─── Deterministic field extractors ──────────────────────────────────────────

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(
    r"\b(?:https?://|www\.)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}(?:/\S*)?"
    r"|\b[A-Za-z0-9\-]+\.(?:com|in|co\.in|net|org|shop|store)\b"
)
GSTIN_RE = re.compile(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9])\b")
PINCODE_RE = re.compile(r"\b([1-9]\d{5})\b")

# Mobile: 10 digits starting 6-9, tolerating +91/0 prefixes and internal
# separators that OCR loves to insert (8888 832104 / 88888-32104).
MOBILE_RE = re.compile(r"(?:(?:\+?91|0)[\s\-]?)?([6-9](?:[\s\-]?\d){9})\b")
# Landline: 2-4 digit STD code, hyphen/space, 6-8 digit subscriber number.
LANDLINE_RE = re.compile(r"\b(0\d{2,4})[\s\-]?(\d{6,8})\b")

_GST_CODE = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin_is_valid(gstin: str) -> bool:
    """Mod-36 checksum on the 15th character. Kills false positives dead."""
    if len(gstin) != 15:
        return False
    total = 0
    for i, ch in enumerate(gstin[:14]):
        if ch not in _GST_CODE:
            return False
        v = _GST_CODE.index(ch) * (2 if i % 2 else 1)
        total += v // 36 + v % 36
    return _GST_CODE[(36 - total % 36) % 36] == gstin[14]


def _dedupe(seq: Iterable[str]) -> List[str]:
    seen, out = set(), []
    for item in seq:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


@dataclass
class DeterministicResult:
    phoneNumbers: List[str] = field(default_factory=list)
    landlines: List[str] = field(default_factory=list)
    emails: List[str] = field(default_factory=list)
    websites: List[str] = field(default_factory=list)
    gstin: Optional[str] = None
    pincode: Optional[str] = None
    residual_text: str = ""
    spans: List[Tuple[int, int]] = field(default_factory=list)

    def as_dict(self) -> Dict:
        return {
            "phoneNumbers": self.phoneNumbers,
            "landlines": self.landlines,
            "emails": self.emails,
            "websites": self.websites,
            "gstin": self.gstin,
            "pincode": self.pincode,
        }


def extract_deterministic(raw_text: str, valid_pincodes: Optional[set] = None) -> DeterministicResult:
    """Pull every rule-recoverable field out of normalized OCR text.

    `residual_text` is the input with all matched spans blanked out — feed that
    to the SLM so it can't waste tokens re-deriving digits, and so a phone
    number can never leak into `companyName`.
    """
    text = normalize_text(raw_text)
    result = DeterministicResult()
    spans: List[Tuple[int, int]] = []

    for m in EMAIL_RE.finditer(text):
        result.emails.append(m.group(0).lower())
        spans.append(m.span())

    for m in URL_RE.finditer(text):
        # An email's domain would otherwise be re-matched as a website.
        if any(s <= m.start() < e for s, e in spans):
            continue
        result.websites.append(m.group(0).lower().rstrip(".,;"))
        spans.append(m.span())

    for m in GSTIN_RE.finditer(text):
        if gstin_is_valid(m.group(1)):
            result.gstin = m.group(1)
            spans.append(m.span())

    # Three-stage phone resolution, and the order is load-bearing.
    #
    # Stage 1: "0" + a valid 10-digit mobile (09003076916). Must run first or
    # the landline pattern eats it as STD 0900 + subscriber 3076916.
    for m in re.finditer(r"(?<!\d)0([6-9]\d{9})(?!\d)", text):
        result.phoneNumbers.append(m.group(1))
        spans.append(m.span())

    # Stage 2: landlines. Must precede the general mobile pattern, or
    # "0712-2233445" is consumed as the mobile 7122233445.
    for m in LANDLINE_RE.finditer(text):
        if any(s <= m.start() < e for s, e in spans):
            continue
        result.landlines.append(f"{m.group(1)}-{m.group(2)}")
        spans.append(m.span())

    # Stage 3: everything else, tolerating internal separators.
    for m in MOBILE_RE.finditer(text):
        if any(s < m.end() and m.start() < e for s, e in spans):
            continue
        digits = re.sub(r"\D", "", m.group(1))
        if len(digits) == 10 and digits[0] in "6789":
            result.phoneNumbers.append(digits)
            spans.append(m.span())

    # Pincode: a card can contain several 6-digit runs (a mangled phone, a
    # licence number). Score candidates by whether their line looks like an
    # address, then prefer the last one — pincodes come at the end.
    candidates = []
    for m in PINCODE_RE.finditer(text):
        if any(s < m.end() and m.start() < e for s, e in spans):
            continue
        code = m.group(1)
        if valid_pincodes and code not in valid_pincodes:
            continue
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", m.end())
        line = text[line_start:line_end if line_end != -1 else len(text)]
        score = sum(1 for w in ADDRESS_WORDS + MH_CITIES if w in line)
        score += 1 if re.search(r"[-–]\s*$", text[line_start:m.start()]) else 0
        # A mangled phone often leaves a stray 6-digit run. Reject candidates
        # with no address context unless they sit in the last two lines and
        # aren't sitting under a phone label.
        phone_label = re.search(
            r"(?i)(mob|cell|ph|tel|फोन|मो|मोबा|भ्रमण|दूरध्वनी)", line
        )
        tail = text.count("\n", m.end()) <= 1
        if score == 0 and not (tail and not phone_label):
            continue
        candidates.append((score, m.start(), code, m.span()))

    if candidates:
        # Highest address score wins; ties go to the later occurrence, since
        # pincodes come at the end of an address.
        _, _, code, span = max(candidates, key=lambda c: (c[0], c[1]))
        result.pincode = code
        spans.append(span)

    result.phoneNumbers = _dedupe(result.phoneNumbers)
    result.landlines = _dedupe(result.landlines)
    result.emails = _dedupe(result.emails)
    result.websites = _dedupe(result.websites)

    chars = list(text)
    for start, end in spans:
        for i in range(start, min(end, len(chars))):
            if chars[i] != "\n":
                chars[i] = " "
    result.residual_text = "\n".join(
        re.sub(r"\s{2,}", " ", line).strip(" .:-|•■")
        for line in "".join(chars).split("\n")
    )
    # Lines that were nothing but a label for an extracted value ("Mob.",
    # "GSTIN", "दूरध्वनी") carry no residual signal — drop them so the SLM
    # isn't tempted to treat them as a tagline.
    labels = {"mob", "mob.", "cell", "cell.", "ph", "ph.", "tel", "tel.", "gstin",
              "gst", "email", "e-mail", "web", "website", "मो", "मो.", "मोबा.",
              "मोबाईल", "भ्रमणध्वनी", "दूरध्वनी", "फोन", "ईमेल", "संपर्क"}
    result.residual_text = "\n".join(
        line for line in result.residual_text.split("\n")
        if line.strip() and skeleton(line) and line.strip().casefold() not in labels
    )
    result.spans = spans
    return result


# ─── Post-SLM repair ─────────────────────────────────────────────────────────

def repair_model_output(parsed: Dict) -> Dict:
    """Snap the SLM's fuzzy fields onto known vocabulary. Non-destructive."""
    out = dict(parsed)

    if out.get("companyName"):
        out["companyName"] = snap_tokens(out["companyName"], BUSINESS_SUFFIXES, 0.80)

    persons = []
    for person in out.get("contactPersons") or []:
        person = dict(person)
        if person.get("role"):
            person["role"] = snap(person["role"], ROLES, 0.70)
        persons.append(person)
    if persons:
        out["contactPersons"] = persons

    lines = []
    for line in out.get("addressLines") or []:
        line = snap_tokens(line, MH_CITIES + ADDRESS_WORDS, 0.78)
        lines.append(line)
    if lines:
        out["addressLines"] = lines

    return out


def merge(deterministic: DeterministicResult, model_output: Dict) -> Dict:
    """Deterministic fields always win. The model never overrides a regex."""
    merged = {
        "companyName": model_output.get("companyName"),
        "tagline": model_output.get("tagline"),
        "providedServices": model_output.get("providedServices") or [],
        "contactPersons": model_output.get("contactPersons") or [],
        "addressLines": model_output.get("addressLines") or [],
    }
    merged.update(deterministic.as_dict())
    return merged


if __name__ == "__main__":
    sample = (
        "साहु मोटसी\n"
        "MAYURI\n"
        "Mob. ८८८८८ ३२१०४ / ९९२१५६३६३०\n"
        "दूरध्वनी : ०७१२-२२३३४४५\n"
        "sahumotors@gmail.com  |  www.sahumotors.in\n"
        "GSTIN : 27AAPFU0939F1ZV\n"
        "■ ई-रथा\n"
        "श्री-गरसानेवा हायोक, नागपुर - 440024"
    )
    res = extract_deterministic(sample)
    import json
    print(json.dumps(res.as_dict(), ensure_ascii=False, indent=2))
    print("--- residual for the SLM ---")
    print(res.residual_text)
    print("--- snapping ---")
    print(snap_tokens("नागपुर", MH_CITIES),
          snap("सचालक", ROLES),
          snap_tokens("हायोक", ADDRESS_WORDS))
