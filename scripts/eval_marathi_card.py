#!/usr/bin/env python3
"""
Evaluation harness for Marathi business card extraction.

Without this, "100% accuracy" is unmeasurable and every change you make is a
coin flip. Metrics, per field:

  companyName / tagline  exact match, plus normalized-similarity match
  providedServices       set precision / recall / F1 (skeleton-matched)
  phoneNumbers           set P/R/F1 on exact digit strings
  pincode / gstin        exact match (these should be 100% — they come from
                         the deterministic layer, not the model)
  addressLines           1 - normalized character error rate
  contactPersons         name+role pair F1

And the one that matters most for a card scanner:

  HALLUCINATION RATE     fraction of populated output fields with no supporting
                         evidence in the input OCR text.

A model that scores 0.95 F1 with a 12% hallucination rate is worse in
production than one at 0.90 F1 with 1%, because the wrong outputs look
completely plausible and the user saves them into their contacts.

Usage:
  # score predictions you generated elsewhere (jsonl: {"id","prediction"})
  python eval_marathi_card.py --gold data/marathi_cards_train_val.jsonl \
                              --pred preds.jsonl

  # or run a HF checkpoint directly
  python eval_marathi_card.py --gold data/marathi_cards_train_val.jsonl \
                              --model output/qwen2.5-0.5b-marathi-merged

  # baseline: deterministic layer only, no model at all
  python eval_marathi_card.py --gold data/marathi_cards_train_val.jsonl --rules-only
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from mr_card_extractors import (extract_deterministic, levenshtein,
                                normalize_text, similarity, skeleton)

SIM_MATCH = 0.85  # threshold for "close enough to count as the same string"


# ─── Matching primitives ─────────────────────────────────────────────────────

def set_prf(gold: List[str], pred: List[str], fuzzy: bool) -> Tuple[int, int, int]:
    """Greedy one-to-one matching. Returns (tp, fp, fn)."""
    remaining = list(gold)
    tp = 0
    for p in pred:
        hit = None
        for g in remaining:
            if (similarity(p, g) >= SIM_MATCH) if fuzzy else (p == g):
                hit = g
                break
        if hit is not None:
            remaining.remove(hit)
            tp += 1
    return tp, len(pred) - tp, len(remaining)


def cer(gold: str, pred: str) -> float:
    g, p = normalize_text(gold or ""), normalize_text(pred or "")
    if not g:
        return 0.0 if not p else 1.0
    return min(1.0, levenshtein(g, p) / len(g))


# ─── Hallucination detection ─────────────────────────────────────────────────

def has_evidence(value: str, ocr_text: str, kind: str) -> bool:
    """Is there anything in the OCR text that could have produced this value?

    Digits must appear exactly (after Devanagari normalization). Text must
    share a consonant skeleton with some window of the input — that tolerates
    legitimate OCR healing while catching outright invention.
    """
    if not value:
        return True
    text = normalize_text(ocr_text)

    if kind == "digits":
        digits = re.sub(r"\D", "", text)
        return re.sub(r"\D", "", value) in digits

    if kind == "ascii":
        return value.lower() in text.lower()

    sv = skeleton(value)
    if not sv:
        return True
    st = skeleton(text)
    if sv in st:
        return True
    # Sliding window similarity — healing changes characters, invention
    # produces skeletons that appear nowhere in the input.
    w = len(sv)
    best = 0.0
    for i in range(0, max(len(st) - w, 0) + 1):
        window = st[i:i + w]
        score = 1.0 - levenshtein(sv, window) / max(len(sv), len(window), 1)
        best = max(best, score)
        if best >= 0.62:
            return True
    return best >= 0.62


def count_hallucinations(pred: Dict, ocr_text: str) -> Tuple[int, int, List[str]]:
    """(hallucinated, populated, descriptions)"""
    bad: List[str] = []
    populated = 0

    for key, kind in (("companyName", "text"), ("tagline", "text")):
        v = pred.get(key)
        if v:
            populated += 1
            if not has_evidence(v, ocr_text, kind):
                bad.append(f"{key}={v!r}")

    for key, kind in (("providedServices", "text"), ("phoneNumbers", "digits"),
                      ("emails", "ascii"), ("websites", "ascii"),
                      ("addressLines", "text")):
        for v in pred.get(key) or []:
            populated += 1
            if not has_evidence(v, ocr_text, kind):
                bad.append(f"{key}={v!r}")

    for person in pred.get("contactPersons") or []:
        if person.get("name"):
            populated += 1
            if not has_evidence(person["name"], ocr_text, "text"):
                bad.append(f"person={person['name']!r}")

    for key in ("pincode", "gstin"):
        v = pred.get(key)
        if v:
            populated += 1
            if not has_evidence(v, ocr_text, "digits" if key == "pincode" else "ascii"):
                bad.append(f"{key}={v!r}")

    return len(bad), populated, bad


# ─── Scoring ─────────────────────────────────────────────────────────────────

def evaluate(rows: List[Dict], verbose_failures: int = 5) -> Dict:
    agg = defaultdict(float)
    counts = defaultdict(int)
    sets = defaultdict(lambda: [0, 0, 0])
    failures = []

    for row in rows:
        gold, pred, ocr = row["gold"], row["pred"], row["noisy_ocr"]

        if pred is None:  # unparseable JSON
            counts["invalid_json"] += 1
            counts["n"] += 1
            continue
        counts["n"] += 1

        for key in ("companyName", "tagline"):
            g, p = gold.get(key), pred.get(key)
            counts[f"{key}_n"] += 1
            if (g or None) == (p or None):
                agg[f"{key}_exact"] += 1
                agg[f"{key}_fuzzy"] += 1
            elif g and p and similarity(g, p) >= SIM_MATCH:
                agg[f"{key}_fuzzy"] += 1

        for key, fuzzy in (("providedServices", True), ("phoneNumbers", False),
                           ("emails", False), ("websites", False)):
            tp, fp, fn = set_prf(gold.get(key) or [], pred.get(key) or [], fuzzy)
            s = sets[key]
            s[0] += tp; s[1] += fp; s[2] += fn

        gp = [f"{x.get('name','')}|{x.get('role','')}" for x in gold.get("contactPersons") or []]
        pp = [f"{x.get('name','')}|{x.get('role','')}" for x in pred.get("contactPersons") or []]
        tp, fp, fn = set_prf(gp, pp, True)
        s = sets["contactPersons"]
        s[0] += tp; s[1] += fp; s[2] += fn

        for key in ("pincode", "gstin"):
            counts[f"{key}_n"] += 1
            if (gold.get(key) or None) == (pred.get(key) or None):
                agg[f"{key}_exact"] += 1

        g_addr = " ".join(gold.get("addressLines") or [])
        p_addr = " ".join(pred.get("addressLines") or [])
        agg["address_cer"] += cer(g_addr, p_addr)
        counts["address_n"] += 1

        n_bad, n_pop, descs = count_hallucinations(pred, ocr)
        agg["halluc"] += n_bad
        agg["populated"] += n_pop
        if n_bad and len(failures) < verbose_failures:
            failures.append((row.get("id", "?"), descs, ocr))

    def f1(key):
        tp, fp, fn = sets[key]
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        return p, r, (2 * p * r / (p + r) if p + r else 0.0)

    n = max(counts["n"], 1)
    report = {
        "n": counts["n"],
        "invalid_json_rate": counts["invalid_json"] / n,
        "companyName_exact": agg["companyName_exact"] / max(counts["companyName_n"], 1),
        "companyName_fuzzy": agg["companyName_fuzzy"] / max(counts["companyName_n"], 1),
        "tagline_exact": agg["tagline_exact"] / max(counts["tagline_n"], 1),
        "pincode_exact": agg["pincode_exact"] / max(counts["pincode_n"], 1),
        "gstin_exact": agg["gstin_exact"] / max(counts["gstin_n"], 1),
        "address_cer": agg["address_cer"] / max(counts["address_n"], 1),
        "hallucination_rate": agg["halluc"] / max(agg["populated"], 1),
    }
    for key in ("providedServices", "phoneNumbers", "emails", "websites",
                "contactPersons"):
        p, r, f = f1(key)
        report[f"{key}_P"] = p
        report[f"{key}_R"] = r
        report[f"{key}_F1"] = f

    return {"report": report, "failures": failures}


def print_report(result: Dict, by_severity: Optional[Dict[float, Dict]] = None) -> None:
    r = result["report"]
    print(f"\n{'='*62}\nn = {r['n']}")
    print(f"invalid JSON          {r['invalid_json_rate']:>7.2%}   "
          "(should be 0.00% with a GBNF grammar)")
    print(f"\n-- fields the MODEL owns --")
    print(f"companyName exact     {r['companyName_exact']:>7.2%}")
    print(f"companyName fuzzy     {r['companyName_fuzzy']:>7.2%}")
    print(f"tagline exact         {r['tagline_exact']:>7.2%}")
    print(f"services F1           {r['providedServices_F1']:>7.2%}  "
          f"(P {r['providedServices_P']:.2%} / R {r['providedServices_R']:.2%})")
    print(f"contactPersons F1     {r['contactPersons_F1']:>7.2%}")
    print(f"address CER           {r['address_cer']:>7.2%}  (lower is better)")
    print(f"\n-- fields the RULES own (expect ~100%) --")
    print(f"phoneNumbers F1       {r['phoneNumbers_F1']:>7.2%}  "
          f"(P {r['phoneNumbers_P']:.2%} / R {r['phoneNumbers_R']:.2%})")
    print(f"pincode exact         {r['pincode_exact']:>7.2%}")
    print(f"gstin exact           {r['gstin_exact']:>7.2%}")
    print(f"emails F1             {r['emails_F1']:>7.2%}")
    print(f"websites F1           {r['websites_F1']:>7.2%}")
    print(f"\n>> HALLUCINATION RATE {r['hallucination_rate']:>7.2%}  "
          "<< watch this one")

    if by_severity:
        print(f"\n{'severity':<10}{'company':>10}{'services F1':>14}"
              f"{'phones F1':>12}{'halluc':>10}")
        for sev in sorted(by_severity):
            s = by_severity[sev]["report"]
            print(f"{sev:<10}{s['companyName_fuzzy']:>9.1%}"
                  f"{s['providedServices_F1']:>13.1%}"
                  f"{s['phoneNumbers_F1']:>11.1%}"
                  f"{s['hallucination_rate']:>9.1%}")

    if result["failures"]:
        print(f"\n-- sample hallucinations --")
        for cid, descs, ocr in result["failures"]:
            print(f"\n[{cid}] {'; '.join(descs)}")
            print("  input: " + ocr.replace("\n", " | ")[:130])
    print("=" * 62)


# ─── Prediction backends ─────────────────────────────────────────────────────

EMPTY = {"companyName": None, "tagline": None, "providedServices": [],
         "contactPersons": [], "phoneNumbers": [], "emails": [],
         "websites": [], "addressLines": [], "pincode": None, "gstin": None}


def parse_json_loose(text: str) -> Optional[Dict]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def predict_rules_only(ocr: str) -> Dict:
    """Baseline with zero model involvement. Establishes the floor you must
    beat, and shows which fields the model isn't needed for at all."""
    det = extract_deterministic(ocr)
    out = dict(EMPTY)
    out.update(det.as_dict())
    return out


def predict_hf(rows: List[Dict], model_dir: str, max_new_tokens: int,
               grammar_free: bool = True) -> List[Optional[Dict]]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from mr_card_data import SYSTEM_PROMPT

    tok = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForCausalLM.from_pretrained(
        model_dir, torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
    ).eval()

    preds = []
    for i, row in enumerate(rows, 1):
        prompt = (f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"
                  f"<|im_start|>user\n{row['noisy_ocr']}<|im_end|>\n"
                  f"<|im_start|>assistant\n")
        ids = tok(prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(**ids, max_new_tokens=max_new_tokens,
                                 do_sample=False, temperature=None, top_p=None,
                                 pad_token_id=tok.eos_token_id)
        text = tok.decode(out[0][ids.input_ids.shape[1]:], skip_special_tokens=True)
        preds.append(parse_json_loose(text))
        if i % 25 == 0:
            print(f"  {i}/{len(rows)}")
    return preds


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold", required=True, help="jsonl with noisy_ocr + json")
    ap.add_argument("--pred", help="jsonl with id + prediction (dict or string)")
    ap.add_argument("--model", help="HF checkpoint dir to run inline")
    ap.add_argument("--rules-only", action="store_true",
                    help="deterministic baseline, no model")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-new-tokens", type=int, default=400)
    args = ap.parse_args()

    gold_rows = [json.loads(l) for l in open(args.gold, encoding="utf-8")]
    if args.limit:
        gold_rows = gold_rows[:args.limit]

    if args.pred:
        by_id = {}
        for line in open(args.pred, encoding="utf-8"):
            row = json.loads(line)
            p = row.get("prediction")
            by_id[row["id"]] = p if isinstance(p, dict) else parse_json_loose(str(p))
        preds = [by_id.get(r["id"]) for r in gold_rows]
    elif args.rules_only:
        preds = [predict_rules_only(r["noisy_ocr"]) for r in gold_rows]
    elif args.model:
        preds = predict_hf(gold_rows, args.model, args.max_new_tokens)
    else:
        ap.error("pass one of --pred / --model / --rules-only")

    rows = [{"id": g.get("id"), "gold": g["json"], "pred": p,
             "noisy_ocr": g["noisy_ocr"], "severity": g.get("severity")}
            for g, p in zip(gold_rows, preds)]

    result = evaluate(rows)
    by_sev = {}
    for sev in sorted({r["severity"] for r in rows if r["severity"] is not None}):
        by_sev[sev] = evaluate([r for r in rows if r["severity"] == sev],
                               verbose_failures=0)
    print_report(result, by_sev or None)


if __name__ == "__main__":
    main()
