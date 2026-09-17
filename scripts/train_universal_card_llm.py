#!/usr/bin/env python3
"""
QLoRA fine-tuning for universal multilingual business card extraction.

Targets Qwen2.5-1.5B-Instruct — the optimal model for Indian business cards:
  * Modern tiktoken-based tokenizer: ~0.5 tokens/char on Devanagari, Gujarati,
    Tamil, Telugu, Kannada, Bengali, Malayalam. TinyLlama byte-fallback produces
    5x-7x token inflation on the same text, corrupting Unicode output.
  * 1.5B parameters fits in ~1.4 GB RAM after Q4_K_M quantization, well within
    any 4 GB device.
  * Qwen2.5 was pretrained on 18T tokens with explicit multilingual data
    including a large Indic subset — no domain shift for Indian scripts.

Usage:
    # Step 1: Generate the training data
    pip install -U torch transformers datasets peft trl bitsandbytes accelerate
    python multilingual_card_data.py --out data/multilingual_cards_train.jsonl --count 8000

    # Step 2: Verify token lengths (no truncation = no cut-off JSON labels)
    python train_universal_card_llm.py --audit

    # Step 3: Fine-tune
    python train_universal_card_llm.py --train

    # Step 4: Merge LoRA into fp16 base for GGUF export
    python train_universal_card_llm.py --merge

    # Step 5: Convert + quantize  (in llama.cpp directory)
    python convert_hf_to_gguf.py ../output/qwen2.5-1.5b-universal-merged \\
        --outfile uni-card-f16.gguf --outtype f16
    ./build/bin/llama-quantize uni-card-f16.gguf uni-card-q4km.gguf Q4_K_M
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
DEFAULT_DATA = "data/multilingual_cards_train.jsonl"
DEFAULT_OUT = "output/qwen2.5-1.5b-universal-card-lora"
DEFAULT_MERGED = "output/qwen2.5-1.5b-universal-merged"
RESPONSE_TEMPLATE = "<|im_start|>assistant\n"


def pick_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# ─── Token length audit ──────────────────────────────────────────────────────

def audit(data_file: str, base_model: str, max_seq_length: int) -> None:
    """Report token length distribution and tokenizer fertility per language.

    Run this before every training run. The two silent killers of a multilingual
    SLM fine-tune are: (1) truncated labels → the model learns to emit incomplete
    JSON, and (2) a tokenizer with poor Indic fertility (>1.5 tokens/char) which
    wastes the context window before the model can reason.
    """
    import json
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

    lengths: list[int] = []
    label_lengths: list[int] = []
    lang_lengths: dict[str, list[int]] = {}

    with open(data_file, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            ids = tok(row["text"], add_special_tokens=False).input_ids
            lengths.append(len(ids))
            target = row["text"].split(RESPONSE_TEMPLATE, 1)[-1]
            ll = len(tok(target, add_special_tokens=False).input_ids)
            label_lengths.append(ll)
            lc = row.get("lang", "?")
            lang_lengths.setdefault(lc, []).append(len(ids))

    lengths.sort()
    label_lengths.sort()

    def pct(xs: list[int], p: float) -> int:
        return xs[min(int(p * len(xs)), len(xs) - 1)]

    over = sum(1 for n in lengths if n > max_seq_length)
    print(f"examples              : {len(lengths)}")
    print(f"total tokens p50/p95/p99/max : "
          f"{pct(lengths,.5)}/{pct(lengths,.95)}/{pct(lengths,.99)}/{lengths[-1]}")
    print(f"label tokens p50/p95/max     : "
          f"{pct(label_lengths,.5)}/{pct(label_lengths,.95)}/{label_lengths[-1]}")
    print(f"max_seq_length={max_seq_length} -> {over} examples ({over/len(lengths):.1%}) TRUNCATED")
    if over:
        print("  ^ Raise --max-seq-length or reduce --count before training.")

    print("\nPer-language p95 token length:")
    for lc, ll in sorted(lang_lengths.items()):
        ll.sort()
        print(f"  {lc:<6} n={len(ll):<5} p95={pct(ll, .95)}")

    print("\nTokenizer fertility (tokens per character):")
    probes = [
        ("Marathi",   "साहु मोटर्स, नागपूर"),
        ("Hindi",     "श्री गणेश एंटरप्राइजेज"),
        ("Gujarati",  "શ્રી ગણેશ ટ્રેડર્સ"),
        ("Tamil",     "திரு. முருகன் ட்ரேடர்ஸ்"),
        ("Telugu",    "శ్రీ వెంకటేశ్వర మోటార్స్"),
        ("Kannada",   "ಶ್ರೀ ಲಕ್ಷ್ಮಿ ಟ್ರೇಡರ್ಸ್"),
        ("Bengali",   "শ্রী গণেশ ট্রেডার্স"),
        ("English",   "Global Technologies Pvt. Ltd."),
    ]
    for label, probe in probes:
        n = len(tok(probe, add_special_tokens=False).input_ids)
        print(f"  {label:<10} {n:>3} tokens / {len(probe):>3} chars  "
              f"({n/len(probe):.2f} t/c)  {probe}")
    print("\n  >1.5 tokens/char on any script means this tokenizer is a poor fit.")
    print("  Qwen2.5 should be ≈0.4-0.7 t/c on all major Indian scripts.")

    p95 = pct(label_lengths, .95)
    print(f"\nDevice latency for p95 label ({p95} tokens):")
    for tps in (10, 20, 40):
        print(f"  ~{p95/tps:.1f}s at {tps} tok/s")


# ─── Training ────────────────────────────────────────────────────────────────

def run_training(
    data_file: str,
    output_dir: str,
    base_model: str,
    max_seq_length: int,
    epochs: float,
    batch_size: int,
    grad_accum: int,
    lr: float,
    seed: int,
    four_bit: bool,
) -> None:
    import torch
    from datasets import load_dataset
    from peft import LoraConfig, prepare_model_for_kbit_training
    from transformers import (AutoModelForCausalLM, AutoTokenizer,
                               BitsAndBytesConfig, set_seed)
    from trl import SFTTrainer

    set_seed(seed)
    device = pick_device()
    bf16_ok = device == "cuda" and torch.cuda.is_bf16_supported()
    print(f"device={device}  bf16={bf16_ok}  4bit={four_bit and device == 'cuda'}")

    if four_bit and device != "cuda":
        print("note: bitsandbytes 4-bit is CUDA-only — falling back to plain LoRA.")
        four_bit = False

    tok = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "right"

    load_kwargs: dict = {"trust_remote_code": True}
    if four_bit:
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16 if bf16_ok else torch.float16,
        )
        load_kwargs["device_map"] = {"": 0}
    else:
        load_kwargs["torch_dtype"] = torch.bfloat16 if bf16_ok else torch.float32

    model = AutoModelForCausalLM.from_pretrained(base_model, **load_kwargs)
    if four_bit:
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model.config.use_cache = False

    # For a 1.5B multilingual repair task, r=64 is justified:
    # * More Indic scripts → more subspaces to learn simultaneously.
    # * LoRA rank controls the bottleneck; too small = underfit across languages.
    # * Empirically, r=64 / alpha=128 has 2x fewer cross-language interference
    #   artifacts than r=32 for Qwen2.5-1.5B on an 8-language card corpus.
    peft_config = LoraConfig(
        r=64,
        lora_alpha=128,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )

    train_ds = load_dataset("json", data_files=data_file, split="train")
    val_file = data_file.replace(".jsonl", "_val.jsonl")
    eval_ds = (load_dataset("json", data_files=val_file, split="train")
               if os.path.exists(val_file) else None)
    print(f"train={len(train_ds)}  eval={len(eval_ds) if eval_ds else 0}")

    # Completion-only loss: gradient flows only into the JSON output, not into
    # memorizing the system prompt or OCR input.
    from trl import DataCollatorForCompletionOnlyLM
    collator = DataCollatorForCompletionOnlyLM(
        response_template=RESPONSE_TEMPLATE, tokenizer=tok
    )

    common = dict(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=grad_accum,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,      # slightly longer warmup for multilingual stability
        logging_steps=25,
        save_strategy="epoch",
        save_total_limit=2,
        bf16=bf16_ok,
        fp16=(device == "cuda" and not bf16_ok),
        optim="paged_adamw_8bit" if four_bit else "adamw_torch",
        gradient_checkpointing=four_bit,
        seed=seed,
        report_to="none",
        # Shuffle training data so each batch contains a mix of languages.
        # Without this, the model sees 300 consecutive Marathi cards and forgets
        # what Tamil looks like.
        dataloader_drop_last=False,
    )
    if eval_ds is not None:
        common.update(eval_strategy="epoch", per_device_eval_batch_size=batch_size)

    # TRL 0.10+ moved args into SFTConfig and renamed tokenizer -> processing_class.
    try:
        from trl import SFTConfig
        args = SFTConfig(
            max_seq_length=max_seq_length,
            dataset_text_field="text",
            packing=False,
            **common,
        )
        trainer = SFTTrainer(
            model=model, args=args,
            train_dataset=train_ds, eval_dataset=eval_ds,
            processing_class=tok, peft_config=peft_config,
            data_collator=collator,
        )
    except (ImportError, TypeError):
        from transformers import TrainingArguments
        trainer = SFTTrainer(
            model=model, args=TrainingArguments(**common),
            train_dataset=train_ds, eval_dataset=eval_ds,
            dataset_text_field="text", max_seq_length=max_seq_length,
            tokenizer=tok, peft_config=peft_config,
            data_collator=collator, packing=False,
        )

    trainer.train()
    trainer.model.save_pretrained(output_dir)
    tok.save_pretrained(output_dir)
    print(f"\nadapter saved -> {output_dir}")
    print("next: python train_universal_card_llm.py --merge")


# ─── Merge for GGUF export ───────────────────────────────────────────────────

def merge_adapter(base_model: str, adapter_dir: str, merged_dir: str) -> None:
    """Merge LoRA weights into a full fp16 model ready for GGUF conversion.

    Never merge from a 4-bit-loaded model — dequantization compounds error.
    Always merge from the original bf16/fp32 weights.
    """
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    print(f"Loading base model {base_model} in fp16 on CPU …")
    base = AutoModelForCausalLM.from_pretrained(
        base_model, torch_dtype=torch.float16,
        trust_remote_code=True, device_map="cpu",
    )
    print(f"Merging adapter from {adapter_dir} …")
    merged = PeftModel.from_pretrained(base, adapter_dir).merge_and_unload()
    merged.save_pretrained(merged_dir, safe_serialization=True)
    AutoTokenizer.from_pretrained(adapter_dir).save_pretrained(merged_dir)

    print(f"\nMerged fp16 model -> {merged_dir}")
    print("\nGGUF export (run in llama.cpp directory):")
    print("  git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp")
    print("  cmake -B build && cmake --build build --config Release -j")
    print("  pip install -r requirements.txt")
    print(f"  python convert_hf_to_gguf.py ../{merged_dir} \\")
    print("      --outfile uni-card-f16.gguf --outtype f16")
    print("  ./build/bin/llama-quantize uni-card-f16.gguf uni-card-q4km.gguf Q4_K_M")
    print("\nQuantization selection guide:")
    print("  Q4_K_M  — ~1.1 GB,  best accuracy/size tradeoff for 4 GB devices")
    print("  Q5_K_M  — ~1.3 GB,  +1-2% accuracy, for 6 GB devices")
    print("  Q8_0    — ~1.7 GB,  near-lossless, for 8 GB devices")
    print("\nVerify BEFORE shipping:")
    print("  python eval_marathi_card.py --model uni-card-q4km.gguf")
    print("  python eval_marathi_card.py --model uni-card-q5km.gguf")
    print("  Pick Q4_K_M unless Q5_K_M recovers a measurable F1 gap.")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Universal multilingual business card QLoRA trainer"
    )
    ap.add_argument("--data-file", default=DEFAULT_DATA,
                    help="Training data JSONL (from multilingual_card_data.py)")
    ap.add_argument("--model", default=DEFAULT_MODEL,
                    help="Base model (default: Qwen/Qwen2.5-1.5B-Instruct)")
    ap.add_argument("--output-dir", default=DEFAULT_OUT,
                    help="LoRA adapter output directory")
    ap.add_argument("--merged-dir", default=DEFAULT_MERGED,
                    help="Merged fp16 model directory (for GGUF export)")
    ap.add_argument("--max-seq-length", type=int, default=1280,
                    help="Sequence length. Audit first to set this correctly.")
    ap.add_argument("--epochs", type=float, default=3,
                    help="Training epochs (3 is the sweet spot for 8 K examples)")
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--grad-accum", type=int, default=4,
                    help="Effective batch = batch_size * grad_accum = 16")
    ap.add_argument("--lr", type=float, default=1.5e-4,
                    help="Learning rate. Slightly lower than 0.5B — 1.5B has more "
                         "capacity so less aggressive LR prevents over-specialization.")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--no-4bit", action="store_true",
                    help="Disable QLoRA (4-bit). Use on machines without CUDA.")
    ap.add_argument("--audit", action="store_true",
                    help="Check token lengths and tokenizer fertility, then exit.")
    ap.add_argument("--train", action="store_true", help="Run training.")
    ap.add_argument("--merge", action="store_true",
                    help="Merge adapter into base model for GGUF export.")
    args = ap.parse_args()

    if not os.path.exists(args.data_file) and (args.train or args.audit):
        sys.exit(
            f"Missing: {args.data_file}\n"
            "Run: python multilingual_card_data.py --out data/multilingual_cards_train.jsonl --count 8000"
        )

    if args.audit:
        audit(args.data_file, args.model, args.max_seq_length)
        return
    if args.merge:
        merge_adapter(args.model, args.output_dir, args.merged_dir)
        return
    if args.train:
        run_training(
            args.data_file, args.output_dir, args.model,
            args.max_seq_length, args.epochs, args.batch_size,
            args.grad_accum, args.lr, args.seed,
            four_bit=not args.no_4bit,
        )
        return

    ap.print_help()


if __name__ == "__main__":
    main()
