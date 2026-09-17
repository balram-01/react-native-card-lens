# Marathi Card Extraction — hybrid pipeline

Replaces the single-model "make the SLM do everything" approach with a hybrid
one, because that's the only route to near-perfect accuracy on a 0.5B model.

```
OCR text
  ├─ normalize_text          NFC, ०-९ → 0-9, strip ZWJ/ZWNJ
  ├─ extract_deterministic   phones, landlines, pincode, GSTIN, email, website
  │                          → regex + checksum. ~95-99% measured.
  ├─ residual_text           matched spans blanked out
  ├─ SLM (QLoRA, GBNF)       companyName, tagline, services, persons, address
  ├─ apply_aliases + snap    gazetteer repair (नागपुर→नागपूर, सचालक→संचालक)
  └─ merge                   deterministic fields always override the model
```

## Files

| File | Purpose |
| --- | --- |
| `mr_card_extractors.py` | Normalization, deterministic extractors, GSTIN checksum, skeleton edit distance, gazetteer snapping |
| `mr_card_data.py` | Synthetic generator: stochastic character-level Devanagari noise, evidence-constrained labels |
| `train_marathi_card_llm.py` | QLoRA training (real 4-bit), token-length audit, LoRA merge for GGUF |
| `eval_marathi_card.py` | Per-field metrics + hallucination rate, sliced by noise severity |
| `card_schema.gbnf` | Grammar for llama.rn — makes invalid JSON impossible |

## ⚡ 1-Step Automated Training (Recommended)

Run the entire pipeline (dependency validation, dataset synthesis, baseline evaluation, token audit, QLoRA training, adapter merging, validation evaluation, and GGUF export instructions) with a single command:

```bash
# Full production run (4,000 cards, 3 epochs)
python scripts/auto_train.py --install-deps

# Or quick test run (1,000 cards, 1 epoch)
python scripts/auto_train.py --preset quick
```

## Manual Step-by-Step Run Order

If you prefer running individual stages manually:

```bash
pip install -U torch transformers datasets peft trl bitsandbytes accelerate

python mr_card_data.py --out data/marathi_cards_train.jsonl --count 4000
python eval_marathi_card.py --gold data/marathi_cards_train_val.jsonl --rules-only
python train_marathi_card_llm.py --audit          # ALWAYS before training
python train_marathi_card_llm.py --train
python eval_marathi_card.py --gold data/marathi_cards_train_val.jsonl \
                            --model output/qwen2.5-0.5b-marathi-merged
python train_marathi_card_llm.py --merge          # then convert to GGUF
```

## Measured rules-only baseline (400 held-out synthetic cards)

This is the floor the model has to beat, and it needs zero training:

```
phoneNumbers F1   95.76%   (P 96.76 / R 94.78)
pincode exact     94.50%
gstin exact       99.50%
emails F1         99.33%
websites F1       99.57%
hallucination      0.00%
companyName        4.00%   <- the model's actual job
services F1        0.00%   <- the model's actual job
address CER       83.50%   <- the model's actual job
```

Two things follow. First, do not train the model on phones or pincodes; you
would be spending capacity to get *worse* than a regex. Second, the model only
has to earn its keep on four fields, which is a realistic ask for 0.5B.

Pincode goes above 99% once you pass a real Maharashtra PIN whitelist:
`extract_deterministic(text, valid_pincodes=my_pin_set)`.

## Why 100% isn't the right target

At severity 0.55 the input genuinely no longer contains the company name — the
line is destroyed. The correct output there is `null`, not a guess. The
generator enforces this: a field appears in the label only if it survived the
noise (see `RECOVERABILITY_THRESHOLD`). Keep-rates from the last build:

```
severity 0.0    company 100%   address 98%   phones 100%
severity 0.10   company  99%   address 93%   phones  83%
severity 0.28   company  96%   address 82%   phones  58%
severity 0.55   company  86%   address 65%   phones  34%
```

So the ceiling on that tier is ~86%, and a model reporting higher is
hallucinating. Track **hallucination rate** as your primary metric. A model at
0.95 F1 with 12% hallucination is worse in production than 0.90 F1 with 1%,
because wrong output looks plausible and the user saves it to their contacts.

## The synthetic data ceiling

Synthetic noise gets you a working model, not a shipping one. Once training
runs clean, do this:

1. Photograph 150–200 real cards. Run each through ML Kit *and* PaddleOCR.
2. Hand-label the JSON.
3. Use that set as your **only** eval set. Synthetic eval flatters the model
   because the noise distribution matches training exactly.
4. Add the real pairs to training at roughly 1:10 against synthetic.
5. Every real failure you see goes into `OCR_ALIASES` or the gazetteers in
   `mr_card_extractors.py` — that's a permanent fix, unlike a retrain.

Edit distance cannot recover `हायोक → चौक` (skeletons `हायक` vs `चक` share
almost nothing). Those need the alias table or the model. Grow the table from
your real-card error log.

## React Native integration

```ts
import { recognizeText } from 'react-native-card-lens';
import { initLlama } from 'llama.rn';

const ctx = await initLlama({ model: modelPath, n_ctx: 1024, n_gpu_layers: 0 });
const grammar = await readGbnf('card_schema.gbnf');

const { rawText } = await recognizeText(uri, { engine: 'mlkit', script: 'devanagari' });

// Deterministic pass runs in JS — port extract_deterministic's regexes.
const det = extractDeterministic(rawText);

const { text } = await ctx.completion({
  prompt: buildChatML(det.residualText),
  grammar,                 // schema validity guaranteed
  temperature: 0,          // extraction is not a creative task
  n_predict: 320,
});

const card = merge(det, JSON.parse(text));
```

Keep `temperature: 0`. Sampling on an extraction task buys you nothing and
costs you determinism, which you need for reproducible bug reports.

## Quantization

Don't assume Q4_K_M is fine. Devanagari is more sensitive to quantization than
Latin script because the embedding rows are less frequently trained. Build
Q4_K_M, Q5_K_M and Q8_0, run `eval_marathi_card.py` on each, and pick on
measured accuracy against your size budget — not on size alone.

## Known limitations

- The generator's layouts are single-column. Real cards are frequently
  two-column, and OCR reading order in those is genuinely scrambled. The line
  shuffle approximates this but doesn't reproduce it; real data is the fix.
- `snap()` uses linear scan over the gazetteers. Fine for a few hundred
  entries; if you grow them past a few thousand, switch to a BK-tree or a
  symmetric-delete index.
- No handling of English/Marathi bilingual cards where the same field appears
  in both scripts. Worth adding to the generator once you see how common it is
  in your real sample.
