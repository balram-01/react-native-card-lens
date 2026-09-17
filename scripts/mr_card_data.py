#!/usr/bin/env python3
"""
Synthetic Marathi business card generator with a *stochastic* OCR noise model.

Two things separate this from a lexical replacement table:

1. Noise is character-level and probabilistic (matra substitution, ligature
   decomposition, ZWJ injection, space insert/delete, char drop, line drop,
   line shuffle, line join). A closed dictionary of 10 corruptions teaches the
   model those 10 mappings and nothing transferable; a character model produces
   corruptions it has never seen, which is the point.

2. Targets are EVIDENCE-CONSTRAINED. A field only appears in the label if it
   survived the noise well enough to be recoverable from that specific input.
   Labelling a destroyed address with the pristine ground truth trains the
   model to invent plausible Maharashtra addresses — the single worst failure
   mode for a card scanner, because the output looks perfect and is wrong.

Layout, field presence, phone formatting and company names are all randomized,
so the model cannot learn "line 1 is the company" as a positional shortcut.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import unicodedata
from typing import Dict, List, Optional, Tuple

from mr_card_extractors import normalize_text, similarity, skeleton

# ─── Combinatorial vocabulary ────────────────────────────────────────────────
# 30 prefixes x 23 suffixes x optional middles = thousands of company names.
# 14 hard-coded companies is memorization scale; the model just learns to map
# any input to its nearest known company.

NAME_PREFIXES = [
    "साई", "श्री गणेश", "ओम", "महालक्ष्मी", "जय भवानी", "विठ्ठल कृपा", "माऊली",
    "शिवनेरी", "बालाजी", "रुचिरा", "साहु", "देशमुख", "तुळजाभवानी", "खंडोबा",
    "समर्थ", "एकवीरा", "दत्त कृपा", "गजानन", "रेणुका", "पांडुरंग", "अंबिका",
    "नवनाथ", "सिद्धिविनायक", "यशोदा", "प्रगती", "संगम", "नवजीवन", "अन्नपूर्णा",
    "भैरवनाथ", "जोतिबा",
]

NAME_MIDDLES = ["", "", "", "ट्रेडिंग", "अ‍ॅग्रो", "मल्टी", "न्यू", "स्टार", "ग्लोबल"]

NAME_SUFFIXES = [
    "मोटर्स", "एंटरप्रायझेस", "ट्रेडर्स", "इंडस्ट्रीज", "ज्वेलर्स", "ऑटो गॅरेज",
    "कृषी सेवा केंद्र", "इलेक्ट्रॉनिक्स", "ट्रॅव्हल्स", "कन्स्ट्रक्शन",
    "मिष्टान्न भांडार", "किराणा स्टोअर्स", "क्लिनिक", "लीगल असोसिएट्स",
    "हार्डवेअर", "साडी सेंटर", "अँड कंपनी", "फर्निचर मार्ट", "मेडिकल स्टोअर्स",
    "ऑटोमोबाईल्स", "डेअरी फार्म", "बेकरी", "प्रिंटर्स",
]

CATEGORY_BY_SUFFIX = {
    "मोटर्स": "Automotive", "ऑटो गॅरेज": "Automotive", "ऑटोमोबाईल्स": "Automotive",
    "ज्वेलर्स": "Jewelry", "कृषी सेवा केंद्र": "Agriculture",
    "इलेक्ट्रॉनिक्स": "Electronics", "ट्रॅव्हल्स": "Travel",
    "कन्स्ट्रक्शन": "Construction", "मिष्टान्न भांडार": "Food",
    "बेकरी": "Food", "डेअरी फार्म": "Food", "किराणा स्टोअर्स": "Grocery",
    "क्लिनिक": "Medical", "मेडिकल स्टोअर्स": "Medical",
    "लीगल असोसिएट्स": "Legal", "हार्डवेअर": "Hardware",
    "साडी सेंटर": "Clothing", "प्रिंटर्स": "Printing",
    "फर्निचर मार्ट": "Hardware",
}

TAGLINES = {
    "Automotive": ["ई-रिक्षा व ई-बाईक विक्रेते", "सर्व प्रकारच्या दुचाकींची दुरुस्ती", "सेल्स सर्व्हिस अँड स्पेअर्स"],
    "Printing": ["प्रिंटिंग व स्टेशनरी", "मल्टीकलर ऑफसेट प्रिंटिंग"],
    "Jewelry": ["शुद्ध ९१६ हॉलमार्क सुवर्ण अलंकार", "सोने-चांदी विक्रेते"],
    "Agriculture": ["खते, बियाणे व कीटकनाशके विक्रेते", "शेतकरी हिताय"],
    "Electronics": ["टीव्ही, फ्रीज व वाशिंग मशीन सेल्स व सर्व्हिस"],
    "Travel": ["दैनिक वातानुकूलित बस सेवा", "देशांतर्गत व परदेश सहली"],
    "Construction": ["बिल्डर्स अँड डेव्हलपर्स", "गुणवत्तापूर्ण बांधकाम"],
    "Food": ["शुद्ध तुपातील रुचकर मिठाई व फरसाण", "ताजे व स्वादिष्ट पदार्थ"],
    "Grocery": ["घाऊक व किरकोळ भुसार मालाचे व्यापारी"],
    "Medical": ["बालरोग व कुटुंब आरोग्य केंद्र", "२४ तास सेवा उपलब्ध"],
    "Legal": ["अधिवक्ता व कायदेशीर सल्लागार"],
    "Hardware": ["पाईप्स, फिटिंग्ज व पेंट्स विक्रेते"],
    "Clothing": ["पैठणी, सिल्क व फॅन्सी साड्यांचे भव्य दालन"],
    "General": ["गुणवत्ता हीच आमची ओळख", "विश्वासाची ६० वर्षे"],
}

PRODUCTS = {
    "Automotive": ["ई-रिक्षा", "ई-बाईक", "सेल्स सर्व्हिस अँड स्पेअर्स", "बॅटरी रिप्लेसमेंट", "ऑईल चेंज", "टायर बदल"],
    "Printing": ["व्हिजिटिंग कार्ड", "लग्नपत्रिका", "फ्लेक्स बॅनर", "झेरॉक्स", "लॅमिनेशन"],
    "Jewelry": ["सोन्याचे दागिने", "चांदीचे भांडी", "डायमंड रिंग्ज", "मोती माळा"],
    "Agriculture": ["हायब्रीड बियाणे", "सेंद्रिय खते", "ठिबक सिंचन साहित्य", "स्प्रे पंप"],
    "Electronics": ["स्मार्ट टीव्ही", "इन्व्हर्टर बॅटरी", "एअर कंडिशनर", "दुरुस्ती"],
    "Travel": ["बस बुकिंग", "टेम्पो ट्रॅव्हलर", "विमान तिकीट", "हॉटेल बुकिंग"],
    "Construction": ["२ व ३ बीएचके फ्लॅट्स", "रो-हाऊसेस", "कमर्शियल शॉप्स", "रेनोव्हेशन"],
    "Food": ["काजू कतली", "गुलाबजाम", "बदाम हलवा", "स्पेशल फरसाण", "पेढे"],
    "Grocery": ["तांदूळ", "डाळी", "खाद्यतेल", "मसाले"],
    "Medical": ["सामान्य तपासणी", "रक्त तपासणी", "सोनोग्राफी", "लसीकरण"],
    "Legal": ["मालमत्ता खरेदी-विक्री", "करार लेखन", "न्यायालयीन कामकाज"],
    "Hardware": ["प्लंबिंग पाईप्स", "वॉटर टँक", "सीमेंट", "इंटेरियर पेंट्स"],
    "Clothing": ["येवला पैठणी", "कांजीवरम सिल्क", "नऊवारी साडी", "डिझायनर कुर्ते"],
    "General": ["घाऊक विक्री", "किरकोळ विक्री", "होम डिलिव्हरी"],
}

FIRST_NAMES = ["सचिन", "रमेश", "राहुल", "विजय", "अमित", "संजय", "संतोष", "प्रशांत",
               "सुनील", "गणेश", "ज्ञानेश्वर", "प्रमोद", "संदीप", "अतुल", "महेश",
               "नितीन", "सुरेखा", "वैशाली", "प्रिया", "मंगला", "अनिल", "दिलीप"]

LAST_NAMES = ["पाटील", "जोशी", "देशमुख", "पवार", "कुलकर्णी", "शिंदे", "गायकवाड",
              "सावंत", "कांबळे", "जाधव", "मोरे", "भोसले", "कदम", "चव्हाण",
              "वाघमारे", "माने", "साळुंखे", "थोरात", "शेजाळ", "इंगळे"]

ROLES = ["संचालक", "सह-संचालक", "व्यवस्थापक", "प्रोप्रायटर", "अध्यक्ष", "उपाध्यक्ष",
         "सचिव", "भागीदार", "मालक", "मुख्य सल्लागार", "सेल्स मॅनेजर", "संस्थापक"]

CITIES = [
    {"city": "नागपूर", "areas": ["श्री नगर", "मानेवाडा चौक", "धरमपेठ", "सदर", "इतवारी"], "pins": ["440024", "440010", "440002"]},
    {"city": "पुणे", "areas": ["सदाशिव पेठ", "डेक्कन जिमखाना", "कोथरूड", "हडपसर", "शिवाजीनगर"], "pins": ["411030", "411038", "411005"]},
    {"city": "मुंबई", "areas": ["दादर पश्चिम", "अंधेरी पूर्व", "बोरिवली", "वाशी"], "pins": ["400028", "400069", "400092"]},
    {"city": "नाशिक", "areas": ["रविवार कारंजा", "कॉलेज रोड", "गंगापूर रोड", "पंचवटी"], "pins": ["422002", "422005"]},
    {"city": "छत्रपती संभाजीनगर", "areas": ["सिडको", "क्रांती चौक", "उस्मानपुरा"], "pins": ["431001", "431005"]},
    {"city": "कोल्हापूर", "areas": ["शाहूपुरी", "राजारामपुरी", "लक्ष्मीपुरी"], "pins": ["416001", "416008"]},
    {"city": "नांदेड", "areas": ["वजिराबाद", "शिवाजी नगर", "तरोडा नाका"], "pins": ["431601", "431602"]},
    {"city": "सोलापूर", "areas": ["सात रस्ता", "होटगी रोड", "विजापूर रोड"], "pins": ["413001", "413004"]},
]

JUNK_LINES = ["शुभेच्छा!", "जय महाराष्ट्र", "श्री स्वामी समर्थ", "॥ श्री ॥",
              "एकदा भेट द्या", "वेळ : सकाळी ९ ते रात्री ९", "रविवार सुट्टी",
              "WhatsApp उपलब्ध", "होम डिलिव्हरी उपलब्ध", "Thank You!"]

DEV_DIGITS = str.maketrans("0123456789", "०१२३४५६७८९")

# ─── Character-level Devanagari OCR noise model ──────────────────────────────

# Visually confusable matras — the dominant OCR error class in Devanagari.
MATRA_CONFUSIONS = {
    "\u093e": ["\u093f", "\u0940", ""],      # ा -> ि ी ∅
    "\u093f": ["\u0940", "\u093e", ""],      # ि
    "\u0940": ["\u093f", "\u093e"],          # ी
    "\u0941": ["\u0942", ""],                # ु
    "\u0942": ["\u0941", ""],                # ू
    "\u0947": ["\u0948", "\u0945"],          # े
    "\u0948": ["\u0947"],                    # ै
    "\u094b": ["\u094c", "\u093e", "\u0949"],  # ो
    "\u094c": ["\u094b"],                    # ौ
    "\u0902": ["", "\u0901"],                # ं -> dropped
}

# Consonant pairs that OCR swaps at low resolution.
CONSONANT_CONFUSIONS = {
    "र": ["द", "स"], "स": ["म", "स्", "र"], "म": ["स", "भ"], "भ": ["म"],
    "ब": ["व"], "व": ["ब"], "घ": ["ध"], "ध": ["घ"], "ठ": ["ढ"], "ढ": ["ठ"],
    "प": ["य"], "य": ["प"], "ख": ["रव"], "ण": ["न"], "न": ["ण"],
    "त": ["ल"], "ल": ["त"], "ज": ["ञ"], "छ": ["ङ"],
}

# Ligature decomposition: OCR flattens the conjunct and loses the virama.
LIGATURE_BREAKS = {
    "र्स": "सी", "र्व": "व", "र्ष": "ष", "र्थ": "थ", "र्म": "म", "र्क": "क",
    "क्ष": "त्थ", "ज्ञ": "ज", "त्र": "त", "प्र": "प", "श्र": "श", "द्व": "व",
    "व्ह": "व", "न्ह": "न", "ल्ह": "ल", "ट्र": "ट", "ड्र": "ड", "स्त": "स",
}

VIRAMA = "\u094d"


def _noisy_char_pass(text: str, rate: float, rng: random.Random) -> str:
    out = []
    for ch in text:
        r = rng.random()
        if r < rate and ch in MATRA_CONFUSIONS:
            out.append(rng.choice(MATRA_CONFUSIONS[ch]))
        elif r < rate and ch in CONSONANT_CONFUSIONS:
            out.append(rng.choice(CONSONANT_CONFUSIONS[ch]))
        elif r < rate * 0.35:
            continue  # dropped glyph
        elif r < rate * 0.45:
            out.append(ch + "\u200c")  # spurious ZWNJ
        else:
            out.append(ch)
    return "".join(out)


def _break_ligatures(text: str, rate: float, rng: random.Random) -> str:
    for src, dst in LIGATURE_BREAKS.items():
        if src in text and rng.random() < rate:
            text = text.replace(src, dst, 1)
    if rng.random() < rate * 0.4:
        text = text.replace(VIRAMA, "", 1)
    return text


def _mangle_spaces(text: str, rate: float, rng: random.Random) -> str:
    chars = []
    for ch in text:
        if ch == " " and rng.random() < rate * 0.6:
            continue  # words glued together
        chars.append(ch)
        if ch != " " and rng.random() < rate * 0.12:
            chars.append(" ")  # word split mid-token
    return "".join(chars)


def corrupt_line(line: str, severity: float, rng: random.Random) -> str:
    """Apply the full character-level noise stack to one line."""
    out = _break_ligatures(line, severity, rng)
    out = _noisy_char_pass(out, severity * 0.5, rng)
    out = _mangle_spaces(out, severity, rng)
    return out


# ─── Card assembly ───────────────────────────────────────────────────────────

def _format_phone(digits: str, rng: random.Random) -> str:
    style = rng.random()
    if style < 0.25:
        s = digits
    elif style < 0.45:
        s = f"{digits[:5]} {digits[5:]}"
    elif style < 0.6:
        s = f"+91 {digits[:5]}-{digits[5:]}"
    elif style < 0.75:
        s = f"0{digits}"
    else:
        s = f"{digits[:4]} {digits[4:7]} {digits[7:]}"
    return s.translate(DEV_DIGITS) if rng.random() < 0.55 else s


def _gstin(state: str, rng: random.Random) -> str:
    from mr_card_extractors import _GST_CODE
    body = (state
            + "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(5))
            + "".join(rng.choice("0123456789") for _ in range(4))
            + rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
            + rng.choice("123456789")
            + "Z")
    total = 0
    for i, ch in enumerate(body):
        v = _GST_CODE.index(ch) * (2 if i % 2 else 1)
        total += v // 36 + v % 36
    return body + _GST_CODE[(36 - total % 36) % 36]


def build_card(rng: random.Random) -> Tuple[List[Tuple[str, str]], Dict]:
    """Return (tagged_lines, clean_truth).

    tagged_lines is [(field_name, text)] so noise can be applied per line and
    the label rebuilt from only the lines that survived.
    """
    suffix = rng.choice(NAME_SUFFIXES)
    category = CATEGORY_BY_SUFFIX.get(suffix, "General")
    middle = rng.choice(NAME_MIDDLES)
    company = " ".join(x for x in [rng.choice(NAME_PREFIXES), middle, suffix] if x)

    city = rng.choice(CITIES)
    area = rng.choice(city["areas"])
    pin = rng.choice(city["pins"])

    lines: List[Tuple[str, str]] = [("companyName", company)]

    truth: Dict = {
        "companyName": company,
        "tagline": None,
        "providedServices": [],
        "contactPersons": [],
        "phoneNumbers": [],
        "emails": [],
        "websites": [],
        "addressLines": [],
        "pincode": None,
        "gstin": None,
    }

    # Tagline present ~75% of the time.
    if rng.random() < 0.75:
        tagline = rng.choice(TAGLINES.get(category, TAGLINES["General"]))
        if rng.random() < 0.3:
            tagline = f"{rng.choice(['MAYURI', 'SHREE', 'STAR', 'ROYAL'])} • {tagline}"
        truth["tagline"] = tagline
        lines.append(("tagline", tagline))

    # 0, 1 or 2 contact persons — not always exactly one.
    n_persons = rng.choices([0, 1, 2], weights=[0.15, 0.65, 0.20])[0]
    for _ in range(n_persons):
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        role = rng.choice(ROLES)
        truth["contactPersons"].append({"name": name, "role": role})
        fmt = rng.choice([f"{name} ({role})", f"{name}\n{role}", f"{role} : {name}"])
        lines.append(("contactPersons", fmt))

    # 1-3 phones, varied formatting.
    for _ in range(rng.choices([1, 2, 3], weights=[0.45, 0.4, 0.15])[0]):
        digits = str(rng.randint(6000000000, 9999999999))
        truth["phoneNumbers"].append(digits)
        label = rng.choice(["मो.", "मोबाईल :", "Mob.", "Cell :", "भ्रमणध्वनी :", ""])
        lines.append(("phoneNumbers", f"{label} {_format_phone(digits, rng)}".strip()))

    # Email ~40%, website ~30%, GSTIN ~35% — these must not be permanently empty
    # in training data or the model learns to always emit [] and null.
    slug = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(rng.randint(5, 10)))
    if rng.random() < 0.40:
        email = f"{slug}@{rng.choice(['gmail.com', 'yahoo.in', 'rediffmail.com', 'outlook.com'])}"
        truth["emails"].append(email)
        lines.append(("emails", f"{rng.choice(['Email :', 'ई-मेल :', ''])} {email}".strip()))
    if rng.random() < 0.30:
        site = f"www.{slug}.{rng.choice(['com', 'in', 'co.in'])}"
        truth["websites"].append(site)
        lines.append(("websites", site))
    if rng.random() < 0.35:
        g = _gstin(rng.choice(["27", "27", "29"]), rng)
        truth["gstin"] = g
        lines.append(("gstin", f"GSTIN : {g}"))

    # Services: 0-4.
    pool = PRODUCTS.get(category, PRODUCTS["General"])
    for prod in rng.sample(pool, k=min(rng.randint(0, 4), len(pool))):
        truth["providedServices"].append(prod)
        bullet = rng.choice(["■ ", "• ", "* ", "> ", ""])
        lines.append(("providedServices", f"{bullet}{prod}"))

    # Address: 1-2 lines, pincode present ~70%.
    addr_prefix = rng.choice(["पत्ता : ", "पत्ता- ", "", "मु.पो. "])
    addr = f"{addr_prefix}{area}, {city['city']}"
    printed = addr
    if rng.random() < 0.70:
        # Canonical label keeps ASCII digits; the printed card may use ०-९.
        addr += f" - {pin}"
        printed = addr if rng.random() < 0.5 else f"{printed} - {pin.translate(DEV_DIGITS)}"
        truth["pincode"] = pin
    truth["addressLines"].append(addr)
    lines.append(("addressLines", printed))

    # Junk / decorative lines real cards are full of.
    for _ in range(rng.choices([0, 1, 2], weights=[0.5, 0.35, 0.15])[0]):
        lines.append(("__junk__", rng.choice(JUNK_LINES)))

    return lines, truth


# ─── Evidence-constrained labelling ──────────────────────────────────────────

RECOVERABILITY_THRESHOLD = 0.55


def apply_noise_and_relabel(
    lines: List[Tuple[str, str]], truth: Dict, severity: float, rng: random.Random
) -> Tuple[str, Dict]:
    """Corrupt each line, then rebuild the label from surviving evidence only.

    A value is kept in the label if its corrupted form still has >=55% skeleton
    similarity to the clean form (the model can plausibly heal it). Below that
    the evidence is gone and keeping the label would be teaching hallucination.
    Digits are exact: a phone or pincode whose digits were damaged is dropped.
    """
    kept = {
        "companyName": None, "tagline": None, "providedServices": [],
        "contactPersons": [], "phoneNumbers": [], "emails": [], "websites": [],
        "addressLines": [], "pincode": None, "gstin": None,
    }
    out_lines: List[str] = []
    person_idx = 0
    phone_idx = 0
    service_idx = 0

    for field_name, text in lines:
        # Whole-line loss (cropped edge, dark footer, contrast inversion).
        if rng.random() < severity * 0.18:
            if field_name in ("phoneNumbers",):
                phone_idx += 1
            elif field_name == "contactPersons":
                person_idx += 1
            elif field_name == "providedServices":
                service_idx += 1
            continue

        # Emails, websites and GSTIN are ASCII — OCR damages them far less, and
        # the deterministic layer validates them anyway.
        ascii_field = field_name in ("emails", "websites", "gstin")
        noisy = text if ascii_field else corrupt_line(text, severity, rng)
        out_lines.append(noisy)

        if field_name == "__junk__":
            continue

        if ascii_field:
            if field_name == "gstin":
                kept["gstin"] = truth["gstin"]
            else:
                kept[field_name] = list(truth[field_name])
            continue

        if field_name == "phoneNumbers":
            clean_digits = truth["phoneNumbers"][phone_idx]
            noisy_digits = "".join(c for c in normalize_text(noisy) if c.isdigit())
            # Keep only if the exact 10-digit run survived.
            if clean_digits in noisy_digits:
                kept["phoneNumbers"].append(clean_digits)
            phone_idx += 1
            continue

        if field_name == "contactPersons":
            person = truth["contactPersons"][person_idx]
            if similarity(person["name"], noisy) > 0.35 or similarity(
                f"{person['name']} {person['role']}", noisy
            ) >= RECOVERABILITY_THRESHOLD:
                kept["contactPersons"].append(person)
            person_idx += 1
            continue

        if field_name == "providedServices":
            prod = truth["providedServices"][service_idx]
            if similarity(prod, noisy) >= RECOVERABILITY_THRESHOLD:
                kept["providedServices"].append(prod)
            service_idx += 1
            continue

        if field_name == "addressLines":
            addr = truth["addressLines"][0]
            if similarity(addr, noisy) >= RECOVERABILITY_THRESHOLD:
                kept["addressLines"].append(addr)
            # Pincode is digits: keep only if those exact 6 digits survived.
            if truth["pincode"]:
                noisy_digits = "".join(c for c in normalize_text(noisy) if c.isdigit())
                if truth["pincode"] in noisy_digits:
                    kept["pincode"] = truth["pincode"]
            continue

        # companyName / tagline
        if similarity(truth[field_name] or "", noisy) >= RECOVERABILITY_THRESHOLD:
            kept[field_name] = truth[field_name]

    # Line order shuffle: real OCR reading order is unreliable in multi-column
    # layouts. Keep the company near the top most of the time but not always.
    if rng.random() < severity * 0.5 and len(out_lines) > 2:
        head = out_lines[:1]
        tail = out_lines[1:]
        rng.shuffle(tail)
        out_lines = head + tail if rng.random() < 0.6 else head + tail

    # Line joins — two logical lines OCR'd as one.
    if rng.random() < severity * 0.5 and len(out_lines) > 3:
        i = rng.randrange(len(out_lines) - 1)
        out_lines[i] = out_lines[i] + out_lines.pop(i + 1)

    return "\n".join(l for l in out_lines if l.strip()), kept


# ─── ChatML formatting ───────────────────────────────────────────────────────
# Short system prompt on purpose. The schema is enforced by GBNF grammar at
# inference, so paying 400 tokens per example to restate it is pure waste — and
# with max_seq_length=512 it was what pushed your labels past truncation.

SYSTEM_PROMPT = (
    "Extract Marathi business card fields from OCR text as JSON. "
    "Repair OCR damage. Only output values supported by the text; use null or "
    "[] when absent. Never invent."
)

RESPONSE_TEMPLATE = "<|im_start|>assistant\n"


def format_chatml(noisy: str, label: Dict) -> str:
    target = json.dumps(label, ensure_ascii=False, separators=(",", ":"))
    return (
        f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"
        f"<|im_start|>user\n{noisy}<|im_end|>\n"
        f"{RESPONSE_TEMPLATE}{target}<|im_end|>"
    )


# ─── Dataset build ───────────────────────────────────────────────────────────

SEVERITY_TIERS = [0.0, 0.10, 0.28, 0.55]  # clean ML Kit -> badly degraded


def create_dataset(out_path: str, count: int, seed: int = 1337,
                   val_fraction: float = 0.0) -> None:
    rng = random.Random(seed)
    records = []
    for i in range(count):
        severity = SEVERITY_TIERS[i % len(SEVERITY_TIERS)]
        lines, truth = build_card(rng)
        noisy, label = apply_noise_and_relabel(lines, truth, severity, rng)
        if not noisy.strip():
            continue
        records.append({
            "id": f"card_mr_{i:05d}",
            "severity": severity,
            "text": format_chatml(noisy, label),
            "noisy_ocr": noisy,
            "json": label,
            "clean_truth": truth,
        })

    rng.shuffle(records)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)

    if val_fraction > 0:
        n_val = int(len(records) * val_fraction)
        splits = [(out_path, records[n_val:]),
                  (out_path.replace(".jsonl", "_val.jsonl"), records[:n_val])]
    else:
        splits = [(out_path, records)]

    for path, rows in splits:
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {len(rows)} examples -> {path}")

    # Report label-drop rates. If the harshest tier keeps almost everything,
    # your noise is too gentle; if it keeps nothing, it's too harsh.
    for sev in SEVERITY_TIERS:
        rows = [r for r in records if r["severity"] == sev]
        if not rows:
            continue
        kept_company = sum(1 for r in rows if r["json"]["companyName"]) / len(rows)
        kept_addr = sum(1 for r in rows if r["json"]["addressLines"]) / len(rows)
        kept_phone = sum(
            len(r["json"]["phoneNumbers"]) / max(len(r["clean_truth"]["phoneNumbers"]), 1)
            for r in rows
        ) / len(rows)
        print(f"  severity {sev:<5} n={len(rows):<5} "
              f"company kept {kept_company:.0%}  address kept {kept_addr:.0%}  "
              f"phones kept {kept_phone:.0%}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Marathi card synthetic data generator")
    ap.add_argument("--out", default="data/marathi_cards_train.jsonl")
    ap.add_argument("--count", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--val-fraction", type=float, default=0.1)
    ap.add_argument("--preview", type=int, default=0, help="print N samples and exit")
    args = ap.parse_args()

    if args.preview:
        rng = random.Random(args.seed)
        for i in range(args.preview):
            sev = SEVERITY_TIERS[i % len(SEVERITY_TIERS)]
            lines, truth = build_card(rng)
            noisy, label = apply_noise_and_relabel(lines, truth, sev, rng)
            print(f"\n{'='*66}\nseverity={sev}")
            print(noisy)
            print("-" * 66)
            print(json.dumps(label, ensure_ascii=False, indent=1))
        return

    create_dataset(args.out, args.count, args.seed, args.val_fraction)


if __name__ == "__main__":
    main()
