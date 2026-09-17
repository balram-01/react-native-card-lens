#!/usr/bin/env python3
"""
Universal multilingual business card data generator.

Extends mr_card_data.py with:
  - 5 card archetypes: Retail/Services, Corporate, Medical/Doctor,
    Contractor/Trades, Bilingual (regional + English)
  - Language variants: Marathi, Hindi, Gujarati, Tamil, Telugu, Kannada,
    Bengali, Malayalam, and English (pure/mixed)
  - Multi-script OCR noise models tuned per script family
  - Evidence-constrained labelling (same architecture as mr_card_data.py)

Usage:
    python multilingual_card_data.py --out data/multilingual_cards_train.jsonl --count 8000
    python multilingual_card_data.py --preview 12  # print samples and exit
"""

from __future__ import annotations

import argparse
import json
import os
import random
import unicodedata
from typing import Dict, List, Optional, Tuple

from universal_card_extractors import (
    normalize_text_universal, similarity, skeleton,
    _INDIC_DIGIT_TABLE,
)

# ─── Language configuration ───────────────────────────────────────────────────
#
# Each language entry defines:
#   lang_code  : short ID used in record IDs
#   weight     : proportion of the dataset (will be normalized)
#   digit_xlit : translate ASCII digits to this script for "Indic-format" phones
#   system_prompt: system prompt variant fed to the SLM during training

LANGUAGES = [
    {
        "lang_code": "mr",
        "weight": 0.30,
        "digit_xlit": str.maketrans("0123456789", "०१२३४५६७८९"),
        "phone_labels": ["मो.", "मोबाईल :", "Mob.", "Cell :", "भ्रमणध्वनी :"],
        "addr_prefix": ["पत्ता : ", "पत्ता- ", "", "मु.पो. "],
        "system_prompt": (
            "Extract Marathi/Hindi business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
    {
        "lang_code": "hi",
        "weight": 0.25,
        "digit_xlit": str.maketrans("0123456789", "०१२३४५६७८९"),
        "phone_labels": ["मो.", "मोबाइल :", "फ़ोन :", "संपर्क :"],
        "addr_prefix": ["पता : ", "पता- ", "", "सड़क : "],
        "system_prompt": (
            "Extract Hindi business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
    {
        "lang_code": "gu",
        "weight": 0.12,
        "digit_xlit": str.maketrans("0123456789", "૦૧૨૩૪૫૬૭૮૯"),
        "phone_labels": ["મો.", "ફોન :", "Mob."],
        "addr_prefix": ["સરનામું : ", "", "સ.ન. "],
        "system_prompt": (
            "Extract Gujarati business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
    {
        "lang_code": "ta",
        "weight": 0.08,
        "digit_xlit": str.maketrans("0123456789", "௦௧௨௩௪௫௬௭௮௯"),
        "phone_labels": ["போன் :", "தொலைபேசி :", "Mob."],
        "addr_prefix": ["முகவரி : ", "", "தெரு : "],
        "system_prompt": (
            "Extract Tamil business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
    {
        "lang_code": "te",
        "weight": 0.06,
        "digit_xlit": str.maketrans("0123456789", "౦౧౨౩౪౫౬౭౮౯"),
        "phone_labels": ["ఫోన్ :", "మొబైల్ :", "Mob."],
        "addr_prefix": ["చిరునామా : ", ""],
        "system_prompt": (
            "Extract Telugu business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
    {
        "lang_code": "kn",
        "weight": 0.04,
        "digit_xlit": str.maketrans("0123456789", "೦೧೨೩೪೫೬೭೮೯"),
        "phone_labels": ["ಫೋನ್ :", "ಮೊಬೈಲ್ :", "Mob."],
        "addr_prefix": ["ವಿಳಾಸ : ", ""],
        "system_prompt": (
            "Extract Kannada business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
    {
        "lang_code": "bn",
        "weight": 0.04,
        "digit_xlit": str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯"),
        "phone_labels": ["ফোন :", "মোবাইল :", "Mob."],
        "addr_prefix": ["ঠিকানা : ", ""],
        "system_prompt": (
            "Extract Bengali business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
    {
        "lang_code": "en",
        "weight": 0.11,
        "digit_xlit": str.maketrans("0123456789", "0123456789"),  # no-op
        "phone_labels": ["Mob:", "Mobile:", "Ph:", "Tel:", "Cell:"],
        "addr_prefix": ["Address: ", "Addr: ", ""],
        "system_prompt": (
            "Extract English business card fields from OCR text as JSON. "
            "Repair OCR damage. Use null or [] when absent. Never invent."
        ),
    },
]

# ─── Per-archetype vocabulary ─────────────────────────────────────────────────
#
# Each archetype provides multilingual vocabulary pools. The generator picks
# a language first, then a matching archetype subset.

ARCHETYPE_VOCABS: Dict[str, Dict] = {

    # ── 1. Retail & Services ────────────────────────────────────────────────
    "retail": {
        "company_prefixes": {
            "mr": ["साई", "श्री गणेश", "ओम", "महालक्ष्मी", "जय भवानी", "माऊली",
                   "बालाजी", "समर्थ", "अंबिका", "नवनाथ", "यशोदा", "प्रगती",
                   "साहु", "देशमुख", "विठ्ठल कृपा", "गजानन"],
            "hi": ["श्री", "जय", "माता", "भारत", "राज", "नेशनल", "सुपर", "भारती"],
            "gu": ["શ્રી", "જય", "અંબા", "મહાલક્ષ્મી", "સ્ટાર", "ગ્લોબલ"],
            "ta": ["Sri", "Jai", "Raja", "Annamalai", "Murugan", "Saravana"],
            "te": ["Sri", "Sree", "Vijaya", "Lakshmi", "Balaji"],
            "kn": ["Shri", "Lakshmi", "Vijaya", "Mahalakshmi"],
            "bn": ["শ্রী", "মা", "দুর্গা", "জয়"],
            "en": ["New", "Global", "Star", "Royal", "Modern", "Classic", "Prime"],
        },
        "company_suffixes": {
            "mr": ["मोटर्स", "एंटरप्रायझेस", "ट्रेडर्स", "इंडस्ट्रीज", "ज्वेलर्स",
                   "इलेक्ट्रॉनिक्स", "किराणा स्टोअर्स", "हार्डवेअर", "फर्निचर मार्ट",
                   "बेकरी", "भांडार", "सेंटर", "अँड कंपनी"],
            "hi": ["मोटर्स", "एंटरप्राइजेज", "ट्रेडर्स", "इंडस्ट्रीज", "ज्वेलर्स",
                   "इलेक्ट्रॉनिक्स", "किराना स्टोर", "हार्डवेयर", "फर्नीचर",
                   "बेकरी", "भंडार", "केंद्र", "एंड कंपनी"],
            "gu": ["મોટર્સ", "ટ્રેડર્સ", "ઇન્ડસ્ટ્રીઝ", "એન્ટરપ્રાઇઝ", "સ્ટોર"],
            "ta": ["Motors", "Traders", "Enterprises", "Hardware", "Jewellers"],
            "te": ["Motors", "Traders", "Enterprises", "Hardware", "Jewellers"],
            "kn": ["Motors", "Traders", "Enterprises", "Hardware"],
            "bn": ["ট্রেডার্স", "এন্টারপ্রাইজ", "স্টোর"],
            "en": ["Motors", "Traders", "Enterprises", "Industries", "Jewellers",
                   "Electronics", "Hardware", "Bakery", "Stores", "Centre"],
        },
        "roles": {
            "mr": ["संचालक", "प्रोप्रायटर", "मालक", "भागीदार", "संस्थापक"],
            "hi": ["संचालक", "मालिक", "प्रोपराइटर", "भागीदार", "संस्थापक"],
            "gu": ["સ્વામી", "ભાગીદાર", "પ્રોપ્રાઇટર"],
            "ta": ["உரிமையாளர்", "இயக்குனர்"],
            "te": ["యజమాని", "డైరెక్టర్"],
            "kn": ["ಮಾಲೀಕ", "ನಿರ್ದೇಶಕ"],
            "bn": ["মালিক", "পরিচালক"],
            "en": ["Proprietor", "Owner", "Director", "Partner", "Founder"],
        },
        "taglines": {
            "mr": ["ई-रिक्षा व ई-बाईक विक्रेते", "घाऊक व किरकोळ विक्री",
                   "गुणवत्ता हीच आमची ओळख", "होम डिलिव्हरी उपलब्ध",
                   "सर्व प्रकारचे इलेक्ट्रिक वाहन"],
            "hi": ["थोक और खुदरा विक्रेता", "गुणवत्ता हमारी पहचान",
                   "होम डिलीवरी उपलब्ध"],
            "gu": ["જથ્થાબંધ અને છૂટક", "ઘરે ડિલિવરી"],
            "ta": ["Wholesale & Retail", "Home Delivery Available"],
            "te": ["Wholesale & Retail", "Home Delivery"],
            "kn": ["Wholesale & Retail", "Home Delivery"],
            "bn": ["পাইকারি ও খুচরা", "হোম ডেলিভারি"],
            "en": ["Wholesale & Retail Dealers", "Home Delivery Available",
                   "Quality is Our Identity"],
        },
        "services_pool": {
            "mr": ["ई-रिक्षा", "ई-बाईक", "स्पेअर पार्ट्स", "बॅटरी रिप्लेसमेंट",
                   "व्हिजिटिंग कार्ड", "फ्लेक्स बॅनर", "घाऊक विक्री", "किरकोळ विक्री"],
            "hi": ["ई-रिक्शा", "ई-बाइक", "स्पेयर पार्ट्स", "बैटरी", "होम डिलीवरी"],
            "gu": ["ઈ-રિક્ષા", "ઈ-બાઇક", "સ્પેર પાર્ટ્સ"],
            "ta": ["E-Rickshaw", "E-Bike", "Spare Parts", "Home Delivery"],
            "te": ["E-Rickshaw", "E-Bike", "Spare Parts"],
            "kn": ["E-Rickshaw", "E-Bike", "Spare Parts"],
            "bn": ["ই-রিক্সা", "ই-বাইক", "হোম ডেলিভারি"],
            "en": ["Home Delivery", "Wholesale", "Retail", "Custom Orders", "Bulk Supply"],
        },
    },

    # ── 2. Corporate / Executive ────────────────────────────────────────────
    "corporate": {
        "company_prefixes": {
            "mr": ["प्रगती", "यश", "शिखर", "उत्कर्ष", "अग्रणी"],
            "hi": ["प्रगति", "यश", "शिखर", "उत्कर्ष", "अग्रणी"],
            "gu": ["પ્રગતિ", "ઉત્કર્ષ", "ગ્લોબલ"],
            "ta": ["Agni", "Vel", "Kavi", "Muthu"],
            "te": ["Vijaya", "Srinivasa", "Lakshmi"],
            "kn": ["Vijaya", "Shubha", "Nandi"],
            "bn": ["উন্নতি", "আগমন"],
            "en": ["Apex", "Nexus", "Zenith", "Vertex", "Summit", "Horizon",
                   "Prime", "Global", "Allied", "United"],
        },
        "company_suffixes": {
            "mr": ["सोल्यूशन्स", "टेक्नॉलॉजी", "इन्फ्रास्ट्रक्चर", "कन्सल्टन्सी"],
            "hi": ["सॉल्यूशंस", "टेक्नोलॉजी", "इन्फ्रास्ट्रक्चर"],
            "gu": ["સોલ્યુશન્સ", "ટેક્નૉલૉજી", "ઇન્ફ્રાસ્ટ્રક્ચર"],
            "ta": ["Solutions", "Technologies", "Infrastructure", "Consultancy"],
            "te": ["Solutions", "Technologies", "Infrastructure"],
            "kn": ["Solutions", "Technologies", "Infrastructure"],
            "bn": ["সলিউশন্স", "টেকনোলজি"],
            "en": ["Solutions", "Technologies", "Infrastructure", "Consultancy",
                   "Services", "Systems", "Group", "Corp", "Pvt. Ltd.", "Ltd."],
        },
        "roles": {
            "mr": ["संचालक", "व्यवस्थापकीय संचालक", "मुख्य कार्यकारी अधिकारी",
                   "सल्लागार", "अभियंता", "वित्त व्यवस्थापक"],
            "hi": ["निदेशक", "प्रबंध निदेशक", "मुख्य कार्यकारी अधिकारी", "सलाहकार"],
            "gu": ["ડાયરેક્ટર", "એમ.ડી.", "CEO"],
            "ta": ["Director", "Managing Director", "CEO", "Manager"],
            "te": ["Director", "Managing Director", "CEO"],
            "kn": ["Director", "Managing Director", "CEO"],
            "bn": ["পরিচালক", "ব্যবস্থাপনা পরিচালক"],
            "en": ["Director", "Managing Director", "CEO", "CFO", "CTO",
                   "Manager", "General Manager", "Senior Manager", "Consultant",
                   "Engineer", "Architect", "Analyst"],
        },
        "taglines": {
            "mr": ["गुणवत्ता, विश्वासार्हता, उत्कृष्टता", "आपल्या यशासाठी आम्ही वचनबद्ध"],
            "hi": ["गुणवत्ता, विश्वसनीयता, उत्कृष्टता"],
            "gu": ["ગુણવત્તા, વિશ્વસનીયતા, ઉત્કૃષ્ટતા"],
            "ta": ["Quality, Reliability, Excellence"],
            "te": ["Quality, Reliability, Excellence"],
            "kn": ["Quality, Reliability, Excellence"],
            "bn": ["মান, নির্ভরযোগ্যতা, উৎকর্ষতা"],
            "en": ["Quality, Reliability, Excellence",
                   "Committed to Your Success",
                   "Innovation Driven, Client Focused"],
        },
        "services_pool": {
            "mr": ["IT सल्ला", "सॉफ्टवेअर विकास", "क्लाऊड सोल्यूशन्स", "डेटा अ‍ॅनालिटिक्स"],
            "hi": ["IT सलाह", "सॉफ्टवेयर विकास", "क्लाउड सॉल्यूशन"],
            "gu": ["IT કન્સલ્ટિંગ", "સૉફ્ટવૅર ડૅવૅલૉપ"],
            "ta": ["IT Consulting", "Software Development", "Cloud Solutions"],
            "te": ["IT Consulting", "Software Development"],
            "kn": ["IT Consulting", "Software Development"],
            "bn": ["আইটি কনসালটিং", "সফটওয়্যার ডেভেলপমেন্ট"],
            "en": ["IT Consulting", "Software Development", "Cloud Solutions",
                   "Data Analytics", "Digital Marketing", "Project Management",
                   "Business Analysis", "ERP Implementation"],
        },
    },

    # ── 3. Medical / Doctor ──────────────────────────────────────────────────
    "medical": {
        "company_prefixes": {
            "mr": ["श्री गजानन", "साई", "जीवन", "आरोग्य", "संजीवनी", "नवजीवन"],
            "hi": ["श्री", "जीवन", "आरोग्य", "संजीवनी", "नवजीवन", "स्वास्थ्य"],
            "gu": ["શ્રી", "જીવન", "આરોગ્ય", "સ્વાસ્થ્ય"],
            "ta": ["Dr.", "Life", "Health", "Jeeva", "Muthu"],
            "te": ["Dr.", "Life", "Arogya", "Jeevana"],
            "kn": ["Dr.", "Jeevana", "Arogya"],
            "bn": ["ডা.", "জীবন", "আরোগ্য"],
            "en": ["Life", "Health", "Wellness", "Care", "Healing", "Sunrise",
                   "Apollo", "City", "Metro"],
        },
        "company_suffixes": {
            "mr": ["क्लिनिक", "हॉस्पिटल", "मेडिकल सेंटर", "नर्सिंग होम", "दवाखाना"],
            "hi": ["क्लीनिक", "अस्पताल", "मेडिकल सेंटर", "नर्सिंग होम"],
            "gu": ["ક્લિનિક", "હૉસ્પિટલ", "મેડિકલ સેન્ટર"],
            "ta": ["Clinic", "Hospital", "Medical Centre", "Nursing Home"],
            "te": ["Clinic", "Hospital", "Medical Centre"],
            "kn": ["Clinic", "Hospital", "Medical Centre"],
            "bn": ["ক্লিনিক", "হাসপাতাল", "নার্সিং হোম"],
            "en": ["Clinic", "Hospital", "Medical Centre", "Nursing Home",
                   "Health Centre", "Poly Clinic", "Diagnostics"],
        },
        "roles": {
            "mr": ["बालरोगतज्ज्ञ", "स्त्रीरोगतज्ज्ञ", "हाडांचे तज्ज्ञ", "सर्जन",
                   "सामान्य चिकित्सक", "दंतचिकित्सक"],
            "hi": ["बाल रोग विशेषज्ञ", "स्त्री रोग विशेषज्ञ", "हड्डी विशेषज्ञ",
                   "सामान्य चिकित्सक", "दंत चिकित्सक"],
            "gu": ["બાળ રોગ નિષ્ણાત", "સ્ત્રી રોગ નિષ્ણાત", "સામાન્ય ચિકિત્સક"],
            "ta": ["Pediatrician", "Gynecologist", "Orthopedic", "Surgeon",
                   "General Physician", "Dentist"],
            "te": ["Pediatrician", "Gynecologist", "General Physician"],
            "kn": ["Pediatrician", "Gynecologist", "General Physician"],
            "bn": ["শিশুরোগ বিশেষজ্ঞ", "স্ত্রীরোগ বিশেষজ্ঞ"],
            "en": ["M.B.B.S, M.D.", "M.B.B.S, M.S.", "M.B.B.S",
                   "Pediatrician", "Gynecologist", "Orthopedic Surgeon",
                   "General Physician", "Dentist (BDS)", "ENT Specialist",
                   "Cardiologist", "Dermatologist"],
        },
        "taglines": {
            "mr": ["बालरोग व कुटुंब आरोग्य केंद्र", "२४ तास सेवा उपलब्ध",
                   "वेळ : सकाळी ९ ते १२, संध्याकाळी ५ ते ९"],
            "hi": ["बाल एवं परिवार स्वास्थ्य केंद्र", "२४ घंटे सेवा उपलब्ध"],
            "gu": ["૨૪ કલાક સેવા ઉપલબ્ધ", "બાળ અને કૌટુંબિક આરોગ્ય"],
            "ta": ["24 Hours Service", "Child & Family Health Centre"],
            "te": ["24 Hours Service", "Child & Family Health Centre"],
            "kn": ["24 Hours Service", "Child & Family Health Centre"],
            "bn": ["২৪ ঘণ্টা পরিষেবা", "শিশু ও পরিবার স্বাস্থ্য কেন্দ্র"],
            "en": ["24 Hours Emergency Service", "Child & Family Health Centre",
                   "OPD Timing: 9AM-1PM, 5PM-9PM", "By Appointment Only"],
        },
        "services_pool": {
            "mr": ["सामान्य तपासणी", "रक्त तपासणी", "सोनोग्राफी", "लसीकरण",
                   "आहार सल्ला", "ECG", "X-Ray"],
            "hi": ["सामान्य जाँच", "रक्त परीक्षण", "सोनोग्राफी", "टीकाकरण",
                   "आहार परामर्श"],
            "gu": ["સામાન્ય તપાસ", "રક્ત પરીક્ષણ", "સોનોગ્રાફી"],
            "ta": ["General Checkup", "Blood Test", "Sonography", "Vaccination"],
            "te": ["General Checkup", "Blood Test", "Sonography"],
            "kn": ["General Checkup", "Blood Test", "Sonography"],
            "bn": ["সাধারণ পরীক্ষা", "রক্ত পরীক্ষা", "সোনোগ্রাফি"],
            "en": ["General Consultation", "Blood Tests", "Sonography",
                   "Vaccination", "ECG", "Dietary Advice", "Home Visits"],
        },
    },

    # ── 4. Contractor / Trades ───────────────────────────────────────────────
    "contractor": {
        "company_prefixes": {
            "mr": ["श्री", "ओम", "महाराष्ट्र", "भारत", "नॅशनल", "सुपर", "स्टार"],
            "hi": ["श्री", "ओम", "भारत", "राष्ट्रीय", "सुपर"],
            "gu": ["શ્રી", "ઓમ", "ગ્લોબલ", "નૅશનલ"],
            "ta": ["Sri", "National", "Super", "India"],
            "te": ["Sri", "National", "India"],
            "kn": ["Sri", "National", "India"],
            "bn": ["শ্রী", "জাতীয়", "ভারত"],
            "en": ["National", "India", "Super", "Star", "Allied", "Bharat"],
        },
        "company_suffixes": {
            "mr": ["कन्स्ट्रक्शन", "बिल्डर्स", "इन्फ्रास्ट्रक्चर", "प्रोजेक्ट्स",
                   "कॉन्ट्रॅक्टर्स", "अर्थवर्क"],
            "hi": ["कंस्ट्रक्शन", "बिल्डर्स", "इन्फ्रास्ट्रक्चर", "प्रोजेक्ट्स",
                   "कॉन्ट्रैक्टर्स"],
            "gu": ["કન્સ્ટ્રક્શન", "બિલ્ડર્સ", "ઇન્ફ્રાસ્ટ્રક્ચર"],
            "ta": ["Construction", "Builders", "Infrastructure", "Projects"],
            "te": ["Construction", "Builders", "Infrastructure"],
            "kn": ["Construction", "Builders", "Infrastructure"],
            "bn": ["কনস্ট্রাকশন", "বিল্ডার্স", "ইনফ্রাস্ট্রাকচার"],
            "en": ["Construction", "Builders", "Infrastructure", "Projects",
                   "Contractors", "Earthworks", "Developers"],
        },
        "roles": {
            "mr": ["संचालक", "मालक", "ठेकेदार", "प्रोजेक्ट मॅनेजर"],
            "hi": ["संचालक", "मालिक", "ठेकेदार", "प्रोजेक्ट मैनेजर"],
            "gu": ["ઠેકેદાર", "ડૅવૅલૉપર"],
            "ta": ["Contractor", "Developer", "Owner"],
            "te": ["Contractor", "Developer"],
            "kn": ["Contractor", "Developer"],
            "bn": ["ঠিকাদার", "উন্নয়নকারী"],
            "en": ["Contractor", "Developer", "Owner", "Project Manager",
                   "Site Engineer", "Civil Engineer"],
        },
        "taglines": {
            "mr": ["उच्च दर्जाचे बांधकाम", "वेळेवर काम पूर्ण करणे", "लाखाची माती सोन्याची"],
            "hi": ["उच्च गुणवत्ता का निर्माण", "समय पर काम पूर्ण करना"],
            "gu": ["ઉચ્ચ ગુણવત્તાનું બાંધકામ"],
            "ta": ["Quality Construction", "On Time Delivery"],
            "te": ["Quality Construction", "On Time Delivery"],
            "kn": ["Quality Construction", "On Time Delivery"],
            "bn": ["উচ্চমানের নির্মাণ"],
            "en": ["Quality Construction", "On Time, Every Time",
                   "Trusted for Decades", "MSME Registered"],
        },
        "services_pool": {
            "mr": ["बांधकाम", "रिनोव्हेशन", "इंटेरिअर", "पेंटिंग", "प्लंबिंग", "वायरिंग",
                   "RCC काम", "टाइल्स", "फ्लोरिंग"],
            "hi": ["निर्माण", "नवीकरण", "इंटीरियर", "पेंटिंग", "प्लंबिंग", "वायरिंग"],
            "gu": ["બાંધકામ", "રિનોવેશન", "ઇન્ટેરિયર", "પ્લંબિંગ"],
            "ta": ["Construction", "Renovation", "Interior", "Painting", "Plumbing"],
            "te": ["Construction", "Renovation", "Interior", "Plumbing"],
            "kn": ["Construction", "Renovation", "Interior", "Plumbing"],
            "bn": ["নির্মাণ", "সংস্কার", "ইন্টেরিয়র"],
            "en": ["Construction", "Renovation", "Interior Design",
                   "Painting", "Plumbing", "Electrical", "RCC Work",
                   "Tiling", "Flooring"],
        },
    },

    # ── 5. Bilingual (Regional Header + English Details) ─────────────────────
    # Uses retail / corporate vocabulary but mixes both scripts.
    "bilingual": {
        "company_prefixes": {
            "mr": ["साई", "श्री गणेश", "ओम", "महालक्ष्मी", "विठ्ठल कृपा"],
            "hi": ["श्री", "जय", "माता", "राज", "नेशनल"],
            "gu": ["શ્રી", "જય", "અંબા"],
            "ta": ["Sri", "Jai", "Raja"],
            "te": ["Sri", "Sree", "Vijaya"],
            "kn": ["Shri", "Lakshmi", "Vijaya"],
            "bn": ["শ্রী", "মা"],
            "en": ["New", "Global", "Star", "Prime"],
        },
        "company_suffixes": {
            "mr": ["Motors", "Enterprises", "Traders", "Industries",
                   "Solutions", "Technologies"],
            "hi": ["Motors", "Enterprises", "Traders", "Solutions"],
            "gu": ["Motors", "Traders", "Enterprises"],
            "ta": ["Motors", "Traders", "Enterprises"],
            "te": ["Motors", "Traders", "Enterprises"],
            "kn": ["Motors", "Traders", "Enterprises"],
            "bn": ["Motors", "Traders", "Enterprises"],
            "en": ["Motors", "Traders", "Enterprises", "Solutions", "Services"],
        },
        "roles": {
            "mr": ["Proprietor", "Director", "Partner", "Founder", "Owner"],
            "hi": ["Proprietor", "Director", "Partner", "Owner"],
            "gu": ["Proprietor", "Director", "Partner"],
            "ta": ["Proprietor", "Director", "Owner"],
            "te": ["Proprietor", "Director"],
            "kn": ["Proprietor", "Director"],
            "bn": ["Proprietor", "Director"],
            "en": ["Proprietor", "Director", "Partner", "Founder", "CEO"],
        },
        "taglines": {
            "mr": ["गुणवत्ता हीच आमची ओळख | Quality is Our Identity",
                   "सर्व प्रकारची सेवा | All Types of Services"],
            "hi": ["गुणवत्ता हमारी पहचान | Quality is Our Identity"],
            "gu": ["ગુણવત્તા | Quality Service"],
            "ta": ["தரம் | Quality Service"],
            "te": ["నాణ్యత | Quality Service"],
            "kn": ["ಗುಣಮಟ್ಟ | Quality Service"],
            "bn": ["মান | Quality Service"],
            "en": ["Quality Service | Since 2005"],
        },
        "services_pool": {
            "mr": ["Sales & Service", "Repairs", "Home Delivery", "Wholesale"],
            "hi": ["Sales & Service", "Repairs", "Home Delivery"],
            "gu": ["Sales & Service", "Repairs"],
            "ta": ["Sales & Service", "Repairs", "Home Delivery"],
            "te": ["Sales & Service", "Repairs"],
            "kn": ["Sales & Service", "Repairs"],
            "bn": ["Sales & Service", "Repairs"],
            "en": ["Sales & Service", "Repairs", "Installation", "Warranty"],
        },
    },
}

# ─── First / Last names per language ─────────────────────────────────────────

FIRST_NAMES = {
    "mr": ["सचिन", "रमेश", "राहुल", "विजय", "अमित", "संजय", "संतोष", "प्रशांत",
           "सुनील", "गणेश", "ज्ञानेश्वर", "प्रमोद", "संदीप", "अतुल", "महेश",
           "नितीन", "सुरेखा", "वैशाली", "प्रिया", "मंगला", "अनिल", "दिलीप"],
    "hi": ["राजेश", "सुरेश", "महेश", "रमेश", "दिनेश", "नरेश", "रवि", "अजय",
           "विजय", "सुनीता", "प्रिया", "अनीता", "पूजा", "नेहा", "काजल"],
    "gu": ["Rajesh", "Suresh", "Mahesh", "Priya", "Sunita", "Kavita",
           "Hitesh", "Paresh", "Jignesh", "Nikita", "Pooja"],
    "ta": ["Suresh", "Rajesh", "Priya", "Kavita", "Anand", "Lakshmi",
           "Muthu", "Selvi", "Kumar", "Vani", "Ravi"],
    "te": ["Suresh", "Rajesh", "Priya", "Anand", "Lakshmi", "Ravi",
           "Srinivas", "Padma", "Vijaya", "Ramesh"],
    "kn": ["Suresh", "Rajesh", "Priya", "Anand", "Ravi", "Srinivas",
           "Rekha", "Kavitha", "Geetha"],
    "bn": ["রাজেশ", "সুরেশ", "প্রিয়া", "অনন্দ", "লক্ষ্মী", "রবি"],
    "en": ["Rajesh", "Suresh", "Priya", "Anand", "Vijay", "Ravi",
           "Anil", "Sunita", "Kavita", "Nikhil", "Rohit"],
}

LAST_NAMES = {
    "mr": ["पाटील", "जोशी", "देशमुख", "पवार", "कुलकर्णी", "शिंदे", "गायकवाड",
           "सावंत", "कांबळे", "जाधव", "मोरे", "भोसले", "कदम", "चव्हाण"],
    "hi": ["शर्मा", "गुप्ता", "सिंह", "यादव", "तिवारी", "पांडेय", "मिश्रा",
           "वर्मा", "अग्रवाल", "चौधरी"],
    "gu": ["Patel", "Shah", "Desai", "Joshi", "Mehta", "Modi", "Thakkar"],
    "ta": ["Kumar", "Rajan", "Krishnan", "Murugan", "Subramaniam",
           "Natarajan", "Balaji"],
    "te": ["Reddy", "Naidu", "Rao", "Varma", "Sharma", "Krishna", "Babu"],
    "kn": ["Gowda", "Reddy", "Rao", "Sharma", "Nair", "Kumar"],
    "bn": ["দাস", "সেন", "ঘোষ", "বন্দ্যোপাধ্যায়", "চট্টোপাধ্যায়"],
    "en": ["Sharma", "Patel", "Singh", "Kumar", "Gupta", "Shah",
           "Joshi", "Mehta", "Reddy", "Rao"],
}

CITIES_BY_LANG: Dict[str, List[Dict]] = {
    "mr": [
        {"city": "नागपूर", "areas": ["श्री नगर", "मानेवाडा चौक", "धरमपेठ", "सदर", "इतवारी"],
         "pins": ["440024", "440010", "440002"]},
        {"city": "पुणे", "areas": ["सदाशिव पेठ", "डेक्कन जिमखाना", "कोथरूड", "हडपसर"],
         "pins": ["411030", "411038", "411005"]},
        {"city": "मुंबई", "areas": ["दादर पश्चिम", "अंधेरी पूर्व", "बोरिवली"],
         "pins": ["400028", "400069", "400092"]},
        {"city": "नाशिक", "areas": ["रविवार कारंजा", "गंगापूर रोड", "पंचवटी"],
         "pins": ["422002", "422005"]},
        {"city": "छत्रपती संभाजीनगर", "areas": ["सिडको", "क्रांती चौक", "उस्मानपुरा"],
         "pins": ["431001", "431005"]},
    ],
    "hi": [
        {"city": "लखनऊ", "areas": ["हजरतगंज", "गोमती नगर", "अलीगंज"],
         "pins": ["226001", "226010"]},
        {"city": "कानपुर", "areas": ["सिविल लाइंस", "किदवई नगर", "श्याम नगर"],
         "pins": ["208001", "208011"]},
        {"city": "जयपुर", "areas": ["जौहरी बाजार", "अजमेर रोड", "वैशाली नगर"],
         "pins": ["302001", "302006"]},
        {"city": "भोपाल", "areas": ["न्यू मार्केट", "एमपी नगर", "कोलार रोड"],
         "pins": ["462001", "462011"]},
    ],
    "gu": [
        {"city": "Ahmedabad", "areas": ["Navrangpura", "Maninagar", "Satellite", "Vastrapur"],
         "pins": ["380009", "380008", "380015"]},
        {"city": "Surat", "areas": ["Adajan", "Vesu", "Katargam", "Ring Road"],
         "pins": ["395009", "395007", "395004"]},
        {"city": "Rajkot", "areas": ["Kalawad Road", "Kothariya", "150 Feet Ring Road"],
         "pins": ["360005", "360002"]},
    ],
    "ta": [
        {"city": "Chennai", "areas": ["Anna Nagar", "T. Nagar", "Vadapalani", "Adyar"],
         "pins": ["600040", "600017", "600026"]},
        {"city": "Coimbatore", "areas": ["RS Puram", "Gandhipuram", "Peelamedu"],
         "pins": ["641002", "641012"]},
        {"city": "Madurai", "areas": ["Anna Nagar", "Tallakulam", "KK Nagar"],
         "pins": ["625020", "625002"]},
    ],
    "te": [
        {"city": "Hyderabad", "areas": ["Ameerpet", "Banjara Hills", "Kukatpally", "KPHB"],
         "pins": ["500016", "500034", "500072"]},
        {"city": "Vijayawada", "areas": ["MG Road", "Governorpet", "Suryaraopet"],
         "pins": ["520002", "520010"]},
    ],
    "kn": [
        {"city": "Bengaluru", "areas": ["Jayanagar", "Malleshwaram", "Koramangala", "HSR Layout"],
         "pins": ["560041", "560003", "560034"]},
        {"city": "Mysuru", "areas": ["VV Mohalla", "Kuvempunagar", "JP Nagar"],
         "pins": ["570002", "570023"]},
    ],
    "bn": [
        {"city": "Kolkata", "areas": ["Park Street", "Salt Lake", "Behala", "Jadavpur"],
         "pins": ["700016", "700091", "700034"]},
        {"city": "Asansol", "areas": ["Burnpur Road", "Court Compound"],
         "pins": ["713301", "713302"]},
    ],
    "en": [
        {"city": "Mumbai", "areas": ["Dadar West", "Andheri East", "Borivali", "Navi Mumbai"],
         "pins": ["400028", "400069", "400066"]},
        {"city": "Nagpur", "areas": ["Sitabuldi", "Dharampeth", "Sadar", "Gandhibagh", "Hingna Road", "Badkas Chowk", "Manish Nagar"],
         "pins": ["440012", "440010", "440001", "440002"]},
        {"city": "Amsterdam", "areas": ["Centrum", "Keizersgracht", "Amstel Business Park"],
         "pins": ["1015 CJ", "1096 HA"]},
        {"city": "Delhi", "areas": ["Lajpat Nagar", "Connaught Place", "Karol Bagh"],
         "pins": ["110024", "110001"]},
        {"city": "Bangalore", "areas": ["Jayanagar", "Koramangala", "HSR Layout"],
         "pins": ["560041", "560034"]},
        {"city": "Hyderabad", "areas": ["Banjara Hills", "Ameerpet", "Kukatpally"],
         "pins": ["500034", "500016"]},
        {"city": "Chennai", "areas": ["Anna Nagar", "T. Nagar", "Adyar"],
         "pins": ["600040", "600017"]},
        {"city": "Pune", "areas": ["Koregaon Park", "Aundh", "Wakad"],
         "pins": ["411001", "411007"]},
    ],
}

JUNK_LINES: Dict[str, List[str]] = {
    "mr": ["॥ परमात्मा एक ॥", "।। श्री गणेशाय नमः ।।", "श्री जानूबाई देवी प्रसन्न", "श्री स्वामी समर्थ", "शुभेच्छा!", "जय महाराष्ट्र", "एकदा भेट द्या",
           "WhatsApp उपलब्ध", "होम डिलिव्हरी उपलब्ध", "Thank You!", "रविवार सुट्टी"],
    "hi": ["॥ परमात्मा एक ॥", "।। श्री गणेशाय नमः ।।", "जय माता दी", "शुभकामनाएं!", "जय भारत", "WhatsApp उपलब्ध", "Thank You!", "रविवार बंद"],
    "gu": ["WhatsApp ઉપલબ્ધ", "Thank You!", "રવિવાર બંધ"],
    "ta": ["Thank You!", "Sunday Holiday", "WhatsApp Available", "Home Delivery"],
    "te": ["Thank You!", "Sunday Holiday", "WhatsApp Available"],
    "kn": ["Thank You!", "Sunday Holiday", "WhatsApp Available"],
    "bn": ["ধন্যবাদ!", "রবিবার বন্ধ", "WhatsApp উপলব্ধ"],
    "en": ["Thank You!", "Sunday Holiday", "WhatsApp: Available",
           "Home Delivery Available", "Quality Guaranteed"],
}

# ─── OCR noise model ──────────────────────────────────────────────────────────
#
# Devanagari, Gujarati, Bengali share the same matra/ligature noise model
# since they are all Brahmic scripts with similar error classes.
# Latin-script languages (Tamil romanized, Telugu romanized, English) get a
# lighter OCR model focused on character swaps and spacing.

MATRA_CONFUSIONS = {
    "\u093e": ["\u093f", "\u0940", ""],   # ा → ि ी ∅  (Devanagari)
    "\u093f": ["\u0940", "\u093e", ""],
    "\u0940": ["\u093f", "\u093e"],
    "\u0941": ["\u0942", ""],
    "\u0942": ["\u0941", ""],
    "\u0947": ["\u0948", "\u0945"],
    "\u0948": ["\u0947"],
    "\u094b": ["\u094c", "\u093e", "\u0949"],
    "\u094c": ["\u094b"],
    "\u0902": ["", "\u0901"],
    # Gujarati vowel signs (similar confusions)
    "\u0abe": ["\u0abf", "\u0ac0", ""],  # ા → િ ી ∅
    "\u0abf": ["\u0ac0", "\u0abe", ""],
    "\u0ac0": ["\u0abf", "\u0abe"],
    "\u0ac1": ["\u0ac2", ""],
    "\u0ac2": ["\u0ac1", ""],
}

CONSONANT_CONFUSIONS = {
    "र": ["द", "स"], "स": ["म", "स्", "र"], "म": ["स", "भ"], "भ": ["म"],
    "ब": ["व"], "व": ["ब"], "घ": ["ध"], "ध": ["घ"], "ठ": ["ढ"], "ढ": ["ठ"],
    "प": ["य"], "य": ["प"], "ण": ["न"], "न": ["ण"], "त": ["ल"], "ल": ["त"],
}

LIGATURE_BREAKS = {
    "र्स": "सी", "र्व": "व", "र्ष": "ष", "र्थ": "थ", "र्म": "म",
    "क्ष": "त्थ", "ज्ञ": "ज", "त्र": "त", "प्र": "प", "श्र": "श",
    "व्ह": "व", "न्ह": "न", "ल्ह": "ल",
}

VIRAMA = "\u094d"

LATIN_CHAR_SWAPS = {
    "a": ["e", "o"], "e": ["a", "i"], "i": ["l", "1"],
    "l": ["i", "1"], "o": ["0", "c"], "0": ["o", "O"],
    "r": ["n"], "n": ["r", "m"], "m": ["rn", "n"],
    "h": ["b"], "b": ["h", "6"],
}


def _noisy_char_pass_indic(text: str, rate: float, rng: random.Random) -> str:
    out = []
    for ch in text:
        r = rng.random()
        if r < rate and ch in MATRA_CONFUSIONS:
            out.append(rng.choice(MATRA_CONFUSIONS[ch]))
        elif r < rate and ch in CONSONANT_CONFUSIONS:
            out.append(rng.choice(CONSONANT_CONFUSIONS[ch]))
        elif r < rate * 0.35:
            continue
        elif r < rate * 0.45:
            out.append(ch + "\u200c")
        else:
            out.append(ch)
    return "".join(out)


def _noisy_char_pass_latin(text: str, rate: float, rng: random.Random) -> str:
    out = []
    for ch in text:
        r = rng.random()
        if r < rate * 0.4 and ch.lower() in LATIN_CHAR_SWAPS:
            replacement = rng.choice(LATIN_CHAR_SWAPS[ch.lower()])
            out.append(replacement if ch.islower() else replacement.upper())
        elif r < rate * 0.2:
            continue
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
            continue
        chars.append(ch)
        if ch != " " and rng.random() < rate * 0.12:
            chars.append(" ")
    return "".join(chars)


BRAHMIC_LANGS = {"mr", "hi", "gu", "bn", "ml"}


def corrupt_line(line: str, severity: float, lang_code: str, rng: random.Random) -> str:
    if lang_code in BRAHMIC_LANGS:
        out = _break_ligatures(line, severity, rng)
        out = _noisy_char_pass_indic(out, severity * 0.5, rng)
    else:
        out = _noisy_char_pass_latin(line, severity * 0.3, rng)
    out = _mangle_spaces(out, severity, rng)
    return out


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _format_phone(digits: str, lang_cfg: Dict, rng: random.Random) -> str:
    xlit = lang_cfg["digit_xlit"]
    style = rng.random()
    if style < 0.25:
        s = digits
    elif style < 0.45:
        s = f"{digits[:5]} {digits[5:]}"
    elif style < 0.60:
        s = f"+91 {digits[:5]}-{digits[5:]}"
    elif style < 0.75:
        s = f"0{digits}"
    else:
        s = f"{digits[:4]} {digits[4:7]} {digits[7:]}"
    return s.translate(xlit) if rng.random() < 0.55 else s


def _gstin(state_code: str, rng: random.Random) -> str:
    _GST_CODE = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    body = (
        state_code
        + "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(5))
        + "".join(rng.choice("0123456789") for _ in range(4))
        + rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        + rng.choice("123456789")
        + "Z"
    )
    total = 0
    for i, ch in enumerate(body):
        v = _GST_CODE.index(ch) * (2 if i % 2 else 1)
        total += v // 36 + v % 36
    return body + _GST_CODE[(36 - total % 36) % 36]


STATE_CODES = {
    "mr": "27", "hi": "09", "gu": "24", "ta": "33", "te": "36",
    "kn": "29", "bn": "19", "en": "27",
}


# ─── Card assembly ─────────────────────────────────────────────────────────────

def _pick_archetype(lang_code: str, rng: random.Random) -> str:
    """Doctor cards only in mr/hi/en/gu/ta/te/kn/bn. All others always available."""
    weights = {"retail": 0.40, "corporate": 0.25, "medical": 0.15,
               "contractor": 0.10, "bilingual": 0.10}
    archetypes = list(weights.keys())
    wts = [weights[a] for a in archetypes]
    return rng.choices(archetypes, weights=wts, k=1)[0]


def build_card(rng: random.Random, lang_cfg: Dict) -> Tuple[List[Tuple[str, str]], Dict]:
    """Return (tagged_lines, clean_truth) for the given language config."""
    lc = lang_cfg["lang_code"]
    archetype = _pick_archetype(lc, rng)
    vocab = ARCHETYPE_VOCABS[archetype]

    # Doctor cards prefix personal name with Dr.
    is_doctor = (archetype == "medical")

    prefix = rng.choice(vocab["company_prefixes"].get(lc, vocab["company_prefixes"]["en"]))
    suffix = rng.choice(vocab["company_suffixes"].get(lc, vocab["company_suffixes"]["en"]))
    company = f"{prefix} {suffix}"

    city_data = rng.choice(CITIES_BY_LANG.get(lc, CITIES_BY_LANG["en"]))
    area = rng.choice(city_data["areas"])
    pin = rng.choice(city_data["pins"])

    lines: List[Tuple[str, str]] = [("companyName", company)]
    truth: Dict = {
        "companyName": company, "tagline": None, "providedServices": [],
        "contactPersons": [], "phoneNumbers": [], "emails": [],
        "websites": [], "addressLines": [], "pincode": None, "gstin": None,
    }

    # Tagline ~75%
    if rng.random() < 0.75:
        tagline = rng.choice(vocab["taglines"].get(lc, vocab["taglines"]["en"]))
        truth["tagline"] = tagline
        lines.append(("tagline", tagline))

    # Persons (0-2)
    n_persons = rng.choices([0, 1, 2], weights=[0.15, 0.65, 0.20])[0]
    for _ in range(n_persons):
        fname = rng.choice(FIRST_NAMES.get(lc, FIRST_NAMES["en"]))
        lname = rng.choice(LAST_NAMES.get(lc, LAST_NAMES["en"]))
        role = rng.choice(vocab["roles"].get(lc, vocab["roles"]["en"]))
        if is_doctor:
            name = f"Dr. {fname} {lname}"
        else:
            name = f"{fname} {lname}"
        truth["contactPersons"].append({"name": name, "role": role})
        fmt = rng.choice([
            f"{name} ({role})", f"{name}\n{role}", f"{role} : {name}",
            f"{name}\n{role} | {company}",
        ])
        lines.append(("contactPersons", fmt))

    # Phones (1-3)
    for _ in range(rng.choices([1, 2, 3], weights=[0.45, 0.4, 0.15])[0]):
        digits = str(rng.randint(6000000000, 9999999999))
        truth["phoneNumbers"].append(digits)
        label = rng.choice(lang_cfg["phone_labels"] + [""])
        lines.append(("phoneNumbers", f"{label} {_format_phone(digits, lang_cfg, rng)}".strip()))

    # Email ~40%, website ~30%, GSTIN ~30%
    slug = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz")
                   for _ in range(rng.randint(5, 10)))
    if rng.random() < 0.40:
        email = f"{slug}@{rng.choice(['gmail.com', 'yahoo.com', 'rediffmail.com', 'outlook.com'])}"
        truth["emails"].append(email)
        lines.append(("emails", f"{rng.choice(['Email:', 'E-mail:', ''])} {email}".strip()))
    if rng.random() < 0.30:
        site = f"www.{slug}.{rng.choice(['com', 'in', 'co.in'])}"
        truth["websites"].append(site)
        lines.append(("websites", site))
    if rng.random() < 0.30 and archetype != "medical":
        g = _gstin(STATE_CODES.get(lc, "27"), rng)
        truth["gstin"] = g
        lines.append(("gstin", f"GSTIN : {g}"))

    # Services (0-4)
    pool = vocab["services_pool"].get(lc, vocab["services_pool"]["en"])
    for svc in rng.sample(pool, k=min(rng.randint(0, 4), len(pool))):
        truth["providedServices"].append(svc)
        bullet = rng.choice(["■ ", "• ", "* ", "> ", ""])
        lines.append(("providedServices", f"{bullet}{svc}"))

    # Address (1-2 lines) + pincode ~70%
    addr_pfx = rng.choice(lang_cfg["addr_prefix"])
    addr_body = f"{area}, {city_data['city']}"
    printed = f"{addr_pfx}{addr_body}"
    if rng.random() < 0.70:
        addr_with_pin = f"{addr_pfx}{addr_body} - {pin}"
        xlit_pin = pin.translate(lang_cfg["digit_xlit"])
        printed_full = addr_with_pin if rng.random() < 0.5 else f"{printed} - {xlit_pin}"
        truth["pincode"] = pin
        truth["addressLines"].append(addr_with_pin)
        lines.append(("addressLines", printed_full))
    else:
        truth["addressLines"].append(f"{addr_pfx}{addr_body}")
        lines.append(("addressLines", printed))

    # Junk decorative lines
    junk_pool = JUNK_LINES.get(lc, JUNK_LINES["en"])
    for _ in range(rng.choices([0, 1, 2], weights=[0.5, 0.35, 0.15])[0]):
        lines.append(("__junk__", rng.choice(junk_pool)))

    return lines, truth


# ─── Evidence-constrained labelling ──────────────────────────────────────────

RECOVERABILITY_THRESHOLD = 0.55


def apply_noise_and_relabel(
    lines: List[Tuple[str, str]],
    truth: Dict,
    severity: float,
    lang_code: str,
    rng: random.Random,
) -> Tuple[str, Dict]:
    kept = {
        "companyName": None, "tagline": None, "providedServices": [],
        "contactPersons": [], "phoneNumbers": [], "emails": [], "websites": [],
        "addressLines": [], "pincode": None, "gstin": None,
    }
    out_lines: List[str] = []
    person_idx = phone_idx = service_idx = 0

    for field_name, text in lines:
        if rng.random() < severity * 0.18:
            if field_name == "phoneNumbers":
                phone_idx += 1
            elif field_name == "contactPersons":
                person_idx += 1
            elif field_name == "providedServices":
                service_idx += 1
            continue

        ascii_field = field_name in ("emails", "websites", "gstin")
        noisy = text if ascii_field else corrupt_line(text, severity, lang_code, rng)
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
            noisy_digits = "".join(c for c in normalize_text_universal(noisy) if c.isdigit())
            if clean_digits in noisy_digits:
                kept["phoneNumbers"].append(clean_digits)
            phone_idx += 1
            continue

        if field_name == "contactPersons":
            person = truth["contactPersons"][person_idx]
            if (similarity(person["name"], noisy) > 0.35
                    or similarity(f"{person['name']} {person['role']}", noisy) >= RECOVERABILITY_THRESHOLD):
                kept["contactPersons"].append(person)
            person_idx += 1
            continue

        if field_name == "providedServices":
            svc = truth["providedServices"][service_idx]
            if similarity(svc, noisy) >= RECOVERABILITY_THRESHOLD:
                kept["providedServices"].append(svc)
            service_idx += 1
            continue

        if field_name == "addressLines":
            addr = truth["addressLines"][0]
            if similarity(addr, noisy) >= RECOVERABILITY_THRESHOLD:
                kept["addressLines"].append(addr)
            if truth["pincode"]:
                noisy_digits = "".join(c for c in normalize_text_universal(noisy) if c.isdigit())
                if truth["pincode"] in noisy_digits:
                    kept["pincode"] = truth["pincode"]
            continue

        # companyName / tagline
        if similarity(truth[field_name] or "", noisy) >= RECOVERABILITY_THRESHOLD:
            kept[field_name] = truth[field_name]

    # Line shuffle (simulates multi-column OCR reading order scramble)
    if rng.random() < severity * 0.5 and len(out_lines) > 2:
        head = out_lines[:1]
        tail = out_lines[1:]
        rng.shuffle(tail)
        out_lines = head + tail

    # Line join (two logical lines OCR'd as one)
    if rng.random() < severity * 0.5 and len(out_lines) > 3:
        i = rng.randrange(len(out_lines) - 1)
        out_lines[i] = out_lines[i] + out_lines.pop(i + 1)

    return "\n".join(l for l in out_lines if l.strip()), kept


# ─── ChatML formatting ────────────────────────────────────────────────────────

RESPONSE_TEMPLATE = "<|im_start|>assistant\n"


def format_chatml(noisy: str, label: Dict, system_prompt: str) -> str:
    target = json.dumps(label, ensure_ascii=False, separators=(",", ":"))
    return (
        f"<|im_start|>system\n{system_prompt}<|im_end|>\n"
        f"<|im_start|>user\n{noisy}<|im_end|>\n"
        f"{RESPONSE_TEMPLATE}{target}<|im_end|>"
    )


# ─── Dataset build ─────────────────────────────────────────────────────────────

SEVERITY_TIERS = [0.0, 0.10, 0.28, 0.55]


def create_dataset(
    out_path: str,
    count: int,
    seed: int = 1337,
    val_fraction: float = 0.10,
) -> None:
    rng = random.Random(seed)

    # Build cumulative weights for language sampling
    total_w = sum(l["weight"] for l in LANGUAGES)
    lang_weights = [l["weight"] / total_w for l in LANGUAGES]

    records = []
    for i in range(count):
        severity = SEVERITY_TIERS[i % len(SEVERITY_TIERS)]
        lang_cfg = rng.choices(LANGUAGES, weights=lang_weights, k=1)[0]
        lc = lang_cfg["lang_code"]

        lines, truth = build_card(rng, lang_cfg)
        noisy, label = apply_noise_and_relabel(lines, truth, severity, lc, rng)
        if not noisy.strip():
            continue

        records.append({
            "id": f"card_{lc}_{i:05d}",
            "lang": lc,
            "severity": severity,
            "text": format_chatml(noisy, label, lang_cfg["system_prompt"]),
            "noisy_ocr": noisy,
            "json": label,
            "clean_truth": truth,
        })

    rng.shuffle(records)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)

    if val_fraction > 0:
        n_val = int(len(records) * val_fraction)
        splits = [
            (out_path, records[n_val:]),
            (out_path.replace(".jsonl", "_val.jsonl"), records[:n_val]),
        ]
    else:
        splits = [(out_path, records)]

    for path, rows in splits:
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {len(rows)} examples -> {path}")

    # Statistics
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
              f"company {kept_company:.0%}  address {kept_addr:.0%}  phones {kept_phone:.0%}")

    # Language distribution
    print("\nLanguage distribution:")
    from collections import Counter
    lang_counts = Counter(r["lang"] for r in records)
    for lc, cnt in sorted(lang_counts.items(), key=lambda x: -x[1]):
        print(f"  {lc:<6} {cnt:>5} ({cnt / len(records):.1%})")


def main() -> None:
    ap = argparse.ArgumentParser(description="Universal multilingual card data generator")
    ap.add_argument("--out", default="data/multilingual_cards_train.jsonl")
    ap.add_argument("--count", type=int, default=8000)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--val-fraction", type=float, default=0.10)
    ap.add_argument("--preview", type=int, default=0, help="print N samples and exit")
    args = ap.parse_args()

    if args.preview:
        rng = random.Random(args.seed)
        total_w = sum(l["weight"] for l in LANGUAGES)
        lang_weights = [l["weight"] / total_w for l in LANGUAGES]
        for i in range(args.preview):
            sev = SEVERITY_TIERS[i % len(SEVERITY_TIERS)]
            lang_cfg = rng.choices(LANGUAGES, weights=lang_weights, k=1)[0]
            lines, truth = build_card(rng, lang_cfg)
            noisy, label = apply_noise_and_relabel(
                lines, truth, sev, lang_cfg["lang_code"], rng
            )
            print(f"\n{'=' * 66}\n[{lang_cfg['lang_code']}] severity={sev}")
            print(noisy)
            print("-" * 66)
            print(json.dumps(label, ensure_ascii=False, indent=1))
        return

    create_dataset(args.out, args.count, args.seed, args.val_fraction)


if __name__ == "__main__":
    main()
