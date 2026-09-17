#!/usr/bin/env python3
"""
Universal deterministic extraction layer for multilingual Indian business cards.

Extends mr_card_extractors with:
  - Universal Indic digit normalization (Devanagari, Gujarati, Tamil, Telugu,
    Bengali, Kannada, Malayalam, Odia, Gurmukhi, Khmer)
  - Multi-script anchor keywords for Phone, Address, Designation, Tax fields
  - Extended city and role gazetteers covering all major Indian states
  - Doctor/Clinic, Corporate, Bilingual, and Contractor card archetype support
  - OCR alias tables for English, Hindi, and South Indian script drift

Pipeline position (unchanged from mr_card_extractors):
    OCR text -> normalize_text_universal -> extract_deterministic
             -> SLM (companyName / tagline / services / persons / address)
             -> snap_to_gazetteer -> merge -> validate
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

# ─── Universal Indic digit normalization ──────────────────────────────────────
#
# Build a single mega-translation table once. Order matches Unicode blocks.
# Priority: all regional scripts -> ASCII 0-9.

def _make_indic_digit_table() -> dict:
    """Build a translation table for every Indic script digit block to ASCII."""
    blocks = [
        "\u0966",  # Devanagari  ०
        "\u09e6",  # Bengali     ০
        "\u0a66",  # Gurmukhi    ੦
        "\u0ae6",  # Gujarati    ૦
        "\u0b66",  # Odia        ୦
        "\u0be6",  # Tamil       ௦
        "\u0c66",  # Telugu      ౦
        "\u0ce6",  # Kannada     ೦
        "\u0d66",  # Malayalam   ൦
        "\u0e50",  # Thai        ๐
        "\u0ed0",  # Lao         ໐
        "\u1040",  # Myanmar     ၀
        "\u17e0",  # Khmer       ០
        "\u1090",  # Myanmar Shan ႐
        "\ua8d0",  # Saurashtra  ꣐
        "\ua900",  # Kayah Li    ꤀
        "\u1c50",  # Ol Chiki    ᱐
        "\u1946",  # Limbu       ᥆
        "\u19d0",  # New Tai Lue ᧐
    ]
    table = {}
    for start in blocks:
        base = ord(start)
        for i in range(10):
            table[base + i] = ord("0") + i
    return table

_INDIC_DIGIT_TABLE = _make_indic_digit_table()
_ZERO_WIDTH = re.compile("[\u200b\u200c\u200d\ufeff]")

# Diacritics for building the consonant skeleton used in fuzzy matching.
# Covers Devanagari + broad Indic range.
_DIACRITICS = re.compile(
    "["
    "\u0900-\u0903"   # Devanagari combining marks
    "\u093a-\u094f"   # Devanagari matras + virama
    "\u0951-\u0957"
    "\u093c\u0962\u0963"
    "\u09bc\u09be-\u09cc\u09d7"  # Bengali
    "\u0a3c\u0a3e-\u0a4c"        # Gurmukhi
    "\u0abe-\u0acc\u0abc"        # Gujarati
    "\u0b3c\u0b3e-\u0b4c"        # Odia
    "\u0bbe-\u0bcc"              # Tamil
    "\u0cbe-\u0ccc\u0cbc"        # Kannada
    "\u0d3e-\u0d4c"              # Malayalam
    "\u200c\u200d"
    "]"
)


def normalize_text_universal(text: str) -> str:
    """NFC-normalize, convert ALL Indic script digits to ASCII, tidy whitespace.

    Always run this before anything else. Normalizes every Indic script digit
    block to plain ASCII so regexes need not be duplicated per script.
    """
    text = unicodedata.normalize("NFC", text)
    text = _ZERO_WIDTH.sub("", text)
    text = text.translate(_INDIC_DIGIT_TABLE)
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def skeleton(text: str) -> str:
    """Consonant skeleton: NFC, strip diacritics, strip non-letters, casefold."""
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


# ─── Universal multi-script anchor keywords ───────────────────────────────────
#
# Used to disambiguate labeled fields and score pincode candidates.

PHONE_LABELS = {
    # English
    "mob", "mobile", "cell", "ph", "phone", "tel", "contact",
    # Devanagari / Hindi / Marathi
    "मो", "मो.", "मोबा.", "मोबाईल", "भ्रमणध्वनी", "दूरध्वनी", "फोन", "संपर्क",
    # Gujarati
    "ફોન", "મોબાઇલ",
    # Tamil
    "போன்", "தொலைபேசி",
    # Telugu
    "ఫోన్", "మొబైల్",
    # Kannada
    "ಫೋನ್", "ಮೊಬೈಲ್",
    # Bengali
    "ফোন", "মোবাইল",
    # Malayalam
    "ഫോൺ", "മൊബൈൽ",
}

ADDRESS_LABELS = {
    # English
    "address", "addr", "add", "office",
    # Devanagari / Hindi / Marathi
    "पत्ता", "पत्ता:", "पता", "पता:", "कार्यालय",
    # Gujarati
    "સરનામું",
    # Tamil
    "முகவரி", "அலுவலகம்",
    # Telugu
    "చిరునామా", "కార్యాలయం",
    # Kannada
    "ವಿಳಾಸ",
    # Bengali
    "ঠিকানা",
    # Malayalam
    "വിലാസം",
}

DESIGNATION_LABELS = {
    # English
    "proprietor", "prop", "owner", "director", "md", "ceo", "cto", "partner",
    "manager", "founder", "consultant", "chairman", "dr", "dr.", "advocate",
    # Devanagari / Hindi / Marathi
    "संचालक", "सह-संचालक", "व्यवस्थापक", "प्रोप्रायटर", "अध्यक्ष", "उपाध्यक्ष",
    "सचिव", "भागीदार", "मालक", "मुख्य सल्लागार", "सेल्स मॅनेजर", "अभियंता",
    "डॉक्टर", "अधिवक्ता", "लेखापाल", "प्रमुख", "संस्थापक",
    # Gujarati
    "પ્રોપ્રાઇટર", "ભાગીદાર", "સ્થાપક",
    # Tamil
    "உரிமையாளர்", "இயக்குனர்", "நிர்வாகி",
    # Telugu
    "యజమాని", "డైరెక్టర్", "నిర్వాహకుడు",
}

EMAIL_LABELS = {"email", "e-mail", "mail", "ई-मेल", "ईमेल", "இமெயில்"}
GST_LABELS = {"gstin", "gst", "gst no", "gst no.", "gst number"}
PAN_LABELS = {"pan", "pan no", "pan no.", "pan number"}

# All label sets merged for residual text cleanup
ALL_LABEL_NOISE: frozenset = frozenset(
    PHONE_LABELS | ADDRESS_LABELS | EMAIL_LABELS | GST_LABELS | PAN_LABELS
)

# ─── Extended multilingual gazetteers ─────────────────────────────────────────

# All major Indian cities — essential for pincode candidate scoring
# and for post-SLM address repair.
ALL_INDIA_CITIES = [
    # Maharashtra
    "नागपूर", "पुणे", "मुंबई", "नाशिक", "छत्रपती संभाजीनगर", "कोल्हापूर",
    "सोलापूर", "अमरावती", "नांदेड", "अकोला", "जळगाव", "सांगली", "सातारा",
    "लातूर", "अहिल्यानगर", "चंद्रपूर", "परभणी", "धुळे", "बीड", "वर्धा",
    "ठाणे", "नवी मुंबई", "पिंपरी चिंचवड", "भुसावळ", "यवतमाळ",
    # Gujarat
    "Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar",
    "Gandhinagar", "Anand", "Nadiad",
    "અમદાવાદ", "સુરત", "વડોદરા", "રાજકોટ", "ભાવનગર", "ગાંધીનગર",
    # Tamil Nadu
    "Chennai", "Coimbatore", "Madurai", "Salem", "Tiruchirappalli",
    "Tiruppur", "Erode", "Vellore", "Thanjavur",
    "சென்னை", "கோயம்புத்தூர்", "மதுரை",
    # Andhra Pradesh / Telangana
    "Hyderabad", "Visakhapatnam", "Vijayawada", "Guntur", "Warangal",
    "హైదరాబాద్", "విశాఖపట్నం", "విజయవాడ",
    # Karnataka
    "Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi",
    "ಬೆಂಗಳೂರು", "ಮೈಸೂರು", "ಹುಬ್ಬಳ್ಳಿ",
    # West Bengal
    "Kolkata", "Asansol", "Siliguri", "Durgapur",
    "কলকাতা", "আসানসোল", "শিলিগুড়ি",
    # Rajasthan
    "Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer",
    # Uttar Pradesh
    "Lucknow", "Kanpur", "Agra", "Varanasi", "Prayagraj", "Ghaziabad",
    # Punjab / Haryana / Delhi
    "New Delhi", "Delhi", "Gurgaon", "Noida", "Faridabad", "Ludhiana",
    "Amritsar", "Chandigarh",
    # Madhya Pradesh
    "Bhopal", "Indore", "Jabalpur", "Gwalior",
    # Other major
    "Patna", "Bhubaneswar", "Ranchi", "Raipur", "Dehradun", "Shimla",
    "Thiruvananthapuram", "Kochi", "Kozhikode",
    "തിരുവനന്തപുരം", "കൊച്ചി",
]

# Roles spanning Hindi, English, Medical and Corporate card archetypes
ALL_ROLES = [
    # Devanagari / Marathi / Hindi
    "संचालक", "सह-संचालक", "व्यवस्थापक", "प्रोप्रायटर", "अध्यक्ष", "उपाध्यक्ष",
    "सचिव", "भागीदार", "मालक", "मुख्य सल्लागार", "सेल्स मॅनेजर", "अभियंता",
    "डॉक्टर", "अधिवक्ता", "लेखापाल", "प्रमुख", "संस्थापक",
    # English (common on Indian bilingual cards)
    "Proprietor", "Director", "Managing Director", "Partner",
    "Owner", "Founder", "Chairman", "Manager", "CEO", "COO",
    "Sales Manager", "Engineer", "Consultant", "Advocate",
    "Doctor", "Dr.", "Chartered Accountant", "CA",
    "M.B.B.S", "M.D.", "M.S.", "BDS", "Pediatrician", "Gynecologist",
    # Gujarati
    "પ્રોપ્રાઇટર", "ભાગીદાર", "સ્થાપક", "સંચાલક",
    # Tamil
    "உரிமையாளர்", "இயக்குனர்", "நிர்வாகி",
    # Telugu
    "యజమాని", "డైరెక్టర్",
]

# Business suffixes extended across all Indian regional languages
ALL_BUSINESS_SUFFIXES = [
    # Marathi
    "मोटर्स", "एंटरप्रायझेस", "ट्रेडर्स", "इंडस्ट्रीज", "ज्वेलर्स", "गॅरेज",
    "सेवा केंद्र", "इलेक्ट्रॉनिक्स", "ट्रॅव्हल्स", "कन्स्ट्रक्शन", "भांडार",
    "स्टोअर्स", "क्लिनिक", "असोसिएट्स", "हार्डवेअर", "सेंटर", "अँड कंपनी",
    "फर्निचर", "मेडिकल", "ऑटोमोबाईल्स", "डेअरी", "बेकरी", "प्रिंटर्स",
    # English (common on bilingual cards)
    "Motors", "Enterprises", "Traders", "Industries", "Jewellers",
    "Electronics", "Travels", "Construction", "Stores", "Clinic",
    "Associates", "Hardware", "Agency", "Company", "Services",
    "Automobiles", "Dairy", "Bakery", "Printers", "Solutions",
    "Realtors", "Hospital", "Nursing Home",
    # Gujarati
    "એન્ટરપ્રાઇઝ", "ટ્રેડર્સ", "જ્વેલર્સ",
    # Tamil
    "வணிகர்கள்", "தொழில்",
]

# Address-related words for pincode candidate scoring
ALL_ADDRESS_WORDS = [
    # Marathi
    "पत्ता", "चौक", "नगर", "पेठ", "रोड", "मार्ग", "गल्ली", "वाडी", "कॉलनी",
    "सोसायटी", "बिल्डिंग", "कॉम्प्लेक्स", "दुकान", "गाळा", "मजला", "जिल्हा",
    # English
    "Road", "Street", "Colony", "Nagar", "Layout", "Extension", "Block",
    "Phase", "Sector", "Plot", "Flat", "Floor", "Building", "Complex",
    "Main", "Cross", "Bypass", "Highway", "Market",
    # Hindi
    "मार्केट", "बाजार", "मुहल्ला",
    # Gujarati
    "સોસાયટી", "રોડ",
    # Tamil
    "தெரு", "நகர்",
    # Telugu
    "రోడ్", "నగర్",
]

# ─── Extended OCR alias tables ─────────────────────────────────────────────────
#
# Grow this from your real-card error log. Each entry is a bug seen once that
# will never be misidentified again.

OCR_ALIASES: Dict[str, str] = {
    # Marathi / Devanagari drift
    "हायोक": "चौक", "चाक": "चौक", "पता": "पत्ता", "मोटसी": "मोटर्स",
    "मोटसि": "मोटर्स", "रथा": "रिक्षा", "रत्था": "रिक्षा", "सव्हिस": "सर्व्हिस",
    "एटरप्रायझेस": "एंटरप्रायझेस", "सचालक": "संचालक", "नागपुर": "नागपूर",
    # English OCR drift (common on bilingual cards)
    "Proprieter": "Proprietor", "Prpprietor": "Proprietor",
    "Dirctor": "Director", "Managr": "Manager",
    "Enterrrises": "Enterprises", "Enterpiises": "Enterprises",
    "Industires": "Industries", "Industres": "Industries",
    "Assocites": "Associates", "Associattes": "Associates",
    "Electtonics": "Electronics", "Electornics": "Electronics",
    "Construcion": "Construction", "Constraction": "Construction",
    # Qualification drift on doctor cards
    "MBBS": "M.B.B.S", "MD": "M.D.", "BDS": "B.D.S",
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

    Returns the original value untouched if nothing clears `threshold`. Never
    force a match: a wrong snap is worse than leaving the raw string.
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
    r"|\b[A-Za-z0-9\-]+\.(?:com|in|co\.in|net|org|shop|store|business)\b"
)
GSTIN_RE = re.compile(r"\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9])\b")
PAN_RE = re.compile(r"\b([A-Z]{5}[0-9]{4}[A-Z])\b")
PINCODE_RE = re.compile(r"\b([1-9]\d{5})\b")

# Indian mobile: 10 digits starting 6-9, tolerating +91/0 prefixes and separators.
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


def extract_deterministic(
    raw_text: str, valid_pincodes: Optional[set] = None
) -> DeterministicResult:
    """Pull every rule-recoverable field out of normalized OCR text.

    Works for any Indian language card. Call normalize_text_universal() first.
    `residual_text` is the input with all matched spans blanked out — feed that
    to the SLM so it can't waste tokens re-deriving digits, and so a phone
    number can never leak into `companyName`.
    """
    text = normalize_text_universal(raw_text)
    result = DeterministicResult()
    spans: List[Tuple[int, int]] = []

    for m in EMAIL_RE.finditer(text):
        result.emails.append(m.group(0).lower())
        spans.append(m.span())

    for m in URL_RE.finditer(text):
        if any(s <= m.start() < e for s, e in spans):
            continue
        result.websites.append(m.group(0).lower().rstrip(".,;"))
        spans.append(m.span())

    for m in GSTIN_RE.finditer(text):
        if gstin_is_valid(m.group(1)):
            result.gstin = m.group(1)
            spans.append(m.span())

    # Three-stage phone resolution — order is load-bearing.
    # Stage 1: "0" + valid 10-digit mobile (must run before landline).
    for m in re.finditer(r"(?<!\d)0([6-9]\d{9})(?!\d)", text):
        result.phoneNumbers.append(m.group(1))
        spans.append(m.span())

    # Stage 2: landlines (must precede general mobile, or 0712-2233445 is eaten as mobile).
    for m in LANDLINE_RE.finditer(text):
        if any(s <= m.start() < e for s, e in spans):
            continue
        result.landlines.append(f"{m.group(1)}-{m.group(2)}")
        spans.append(m.span())

    # Stage 3: remaining mobiles, tolerating internal separators.
    for m in MOBILE_RE.finditer(text):
        if any(s < m.end() and m.start() < e for s, e in spans):
            continue
        digits = re.sub(r"\D", "", m.group(1))
        if len(digits) == 10 and digits[0] in "6789":
            result.phoneNumbers.append(digits)
            spans.append(m.span())

    # Pincode: score candidates by address context, prefer the last.
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
        score = sum(1 for w in ALL_ADDRESS_WORDS + ALL_INDIA_CITIES if w in line)
        score += 1 if re.search(r"[-–]\s*$", text[line_start:m.start()]) else 0
        phone_label = re.search(
            r"(?i)(mob|cell|ph|tel|" + "|".join(re.escape(l) for l in PHONE_LABELS) + ")",
            line,
        )
        tail = text.count("\n", m.end()) <= 1
        if score == 0 and not (tail and not phone_label):
            continue
        candidates.append((score, m.start(), code, m.span()))

    if candidates:
        _, _, code, span = max(candidates, key=lambda c: (c[0], c[1]))
        result.pincode = code
        spans.append(span)

    result.phoneNumbers = _dedupe(result.phoneNumbers)
    result.landlines = _dedupe(result.landlines)
    result.emails = _dedupe(result.emails)
    result.websites = _dedupe(result.websites)

    # Build residual text: blank extracted spans, then strip label-only lines.
    chars = list(text)
    for start, end in spans:
        for i in range(start, min(end, len(chars))):
            if chars[i] != "\n":
                chars[i] = " "

    result.residual_text = "\n".join(
        re.sub(r"\s{2,}", " ", line).strip(" .:-|•■▪▸►")
        for line in "".join(chars).split("\n")
    )

    # Drop lines that are nothing but a field label for an extracted value.
    result.residual_text = "\n".join(
        line
        for line in result.residual_text.split("\n")
        if line.strip() and skeleton(line) and line.strip().casefold() not in ALL_LABEL_NOISE
    )
    result.spans = spans
    return result


# ─── Post-SLM repair ─────────────────────────────────────────────────────────

def repair_model_output(parsed: Dict) -> Dict:
    """Snap the SLM's fuzzy fields onto known multilingual vocabulary."""
    out = dict(parsed)

    if out.get("companyName"):
        out["companyName"] = snap_tokens(out["companyName"], ALL_BUSINESS_SUFFIXES, 0.80)

    persons = []
    for person in out.get("contactPersons") or []:
        person = dict(person)
        if person.get("role"):
            person["role"] = snap(person["role"], ALL_ROLES, 0.70)
        persons.append(person)
    if persons:
        out["contactPersons"] = persons

    lines = []
    for line in out.get("addressLines") or []:
        line = snap_tokens(line, ALL_INDIA_CITIES + ALL_ADDRESS_WORDS, 0.78)
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
    import json

    samples = [
        # Marathi automotive card with STD phone + GSTIN
        (
            "Marathi Automotive",
            "साहु मोटसी\nMAYURI\nMob. ८८८८८ ३२१०४ / ९९२१५६३६३०\n"
            "दूरध्वनी : ०७१२-२२३३४४५\nGSTIN : 27AAPFU0939F1ZV\n"
            "■ ई-रथा\nश्री-गरसानेवा हायोक, नागपुर - 440024",
        ),
        # Gujarati business card with Gujarati digits
        (
            "Gujarati Business",
            "શ્રી ગણેશ ટ્રેડર્સ\nMob: ૯૮૨૫૧૨૩૪૫૬\nSurat - 395003",
        ),
        # Tamil doctor card
        (
            "Tamil Doctor",
            "Dr. K. Suresh M.B.B.S, M.D.\nSunrise Clinic\nPhone: 9840123456\n"
            "21, Nehru Street, Chennai - 600001",
        ),
        # Bilingual English/Hindi corporate card
        (
            "Hindi Corporate",
            "Anand Kumar Joshi\nDirector / संचालक\nTech Solutions Pvt. Ltd.\n"
            "Mobile: 9876543210\nEmail: anand@techsol.in\nLucknow - 226001",
        ),
    ]

    for label, text in samples:
        print(f"\n{'='*66}\n[{label}]")
        res = extract_deterministic(text)
        print(json.dumps(res.as_dict(), ensure_ascii=False, indent=2))
        print("--- residual for SLM ---")
        print(res.residual_text)
