#!/usr/bin/env python3
"""
QLoRA fine-tuning for Marathi business card extraction.

Fixes over the original script:
  * Actually 4-bit (BitsAndBytesConfig + prepare_model_for_kbit_training).
    The original imported prepare_model_for_kbit_training and never used it,
    so it was full-precision LoRA under a QLoRA name.
  * No bf16/fp16 conflict. Picks one based on device capability.
  * Works with current TRL (SFTConfig / processing_class) and falls back to
    the pre-0.10 signature.
  * Completion-only loss, so gradient goes into the JSON instead of into
    memorizing the system prompt.
  * Token-length audit BEFORE training. With a 400-token system prompt and
    max_seq_length=512, the original was silently truncating labels — i.e.
    training the model to emit unterminated JSON.
  * Seeded and reproducible.
  * Held-out eval split with loss tracking.

Usage:
    pip install -U torch transformers datasets peft trl bitsandbytes accelerate
    python mr_card_data.py --out data/marathi_cards_train.jsonl --count 4000
    python train_marathi_card_llm.py --audit          # check lengths first
    python train_marathi_card_llm.py --train
    python train_marathi_card_llm.py --merge          # for GGUF export
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
DEFAULT_DATA = "data/marathi_cards_train.jsonl"
DEFAULT_OUT = "output/qwen2.5-0.5b-marathi-card-lora"
RESPONSE_TEMPLATE = "<|im_start|>assistant\n"


def pick_device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# ─── Token length audit ──────────────────────────────────────────────────────

def audit(data_file: str, base_model: str, max_seq_length: int) -> None:
    """Report token length distribution and tokenizer fertility on Devanagari.

    Run this before every training run. Two things kill Devanagari SLM
    fine-tunes silently: truncated labels, and a tokenizer that spends 8 tokens
    on a two-word Marathi phrase leaving no capacity for reasoning.
    """
    import json
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

    lengths, label_lengths = [], []
    with open(data_file, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            ids = tok(row["text"], add_special_tokens=False).input_ids
            lengths.append(len(ids))
            target = row["text"].split(RESPONSE_TEMPLATE, 1)[-1]
            label_lengths.append(len(tok(target, add_special_tokens=False).input_ids))

    lengths.sort()
    label_lengths.sort()

    def pct(xs, p):
        return xs[min(int(p * len(xs)), len(xs) - 1)]

    over = sum(1 for n in lengths if n > max_seq_length)
    print(f"examples            : {len(lengths)}")
    print(f"total tokens  p50/p95/p99/max : "
          f"{pct(lengths,.5)}/{pct(lengths,.95)}/{pct(lengths,.99)}/{lengths[-1]}")
    print(f"label tokens  p50/p95/max     : "
          f"{pct(label_lengths,.5)}/{pct(label_lengths,.95)}/{label_lengths[-1]}")
    print(f"max_seq_length={max_seq_length} -> {over} examples "
          f"({over/len(lengths):.1%}) TRUNCATED")
    if over:
        print("  ^ every one of those has a cut-off JSON label. Raise "
              "max_seq_length or shorten the system prompt before training.")

    print("\ntokenizer fertility (tokens per character):")
    for probe in ["साहु मोटर्स", "श्री गणेश एंटरप्रायझेस",
                  "पत्ता : मानेवाडा चौक, नागपूर", "Shahu Motors"]:
        n = len(tok(probe, add_special_tokens=False).input_ids)
        print(f"  {n:>3} tokens / {len(probe):>3} chars  ({n/len(probe):.2f})  {probe}")
    print("\n  >1.0 tokens/char on Marathi means this tokenizer is a poor fit. "
          "Compare an Indic-pretrained base before blaming model size.")

    # On-device latency estimate — the number users actually feel.
    p95 = pct(label_lengths, .95)
    for tps in (10, 20, 40):
        print(f"  ~{p95/tps:.1f}s to emit a p95 label at {tps} tok/s on device")


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
    # bf16 needs Ampere (SM80+); older cards must use fp16.
    bf16_ok = device == "cuda" and torch.cuda.is_bf16_supported()
    print(f"device={device}  bf16={bf16_ok}  4bit={four_bit and device == 'cuda'}")

    if four_bit and device != "cuda":
        print("note: bitsandbytes 4-bit is CUDA-only — falling back to plain LoRA.")
        four_bit = False

    tok = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "right"  # required for causal LM training

    load_kwargs = {"trust_remote_code": True}
    if four_bit:
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16 if bf16_ok else torch.float16,
        )
        load_kwargs["device_map"] = {"": 0}
    else:
        load_kwargs["torch_dtype"] = (
            torch.bfloat16 if bf16_ok else torch.float32
        )

    model = AutoModelForCausalLM.from_pretrained(base_model, **load_kwargs)
    if four_bit:
        model = prepare_model_for_kbit_training(model,
                                                use_gradient_checkpointing=True)
    model.config.use_cache = False

    peft_config = LoraConfig(
        r=32,                      # 16 is thin for a cross-script repair task
        lora_alpha=64,
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

    # Completion-only loss. Without this, most of the gradient is spent
    # reproducing the system prompt and the user's OCR text.
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
        warmup_ratio=0.03,
        logging_steps=20,
        save_strategy="epoch",
        save_total_limit=2,
        bf16=bf16_ok,
        fp16=(device == "cuda" and not bf16_ok),
        optim="paged_adamw_8bit" if four_bit else "adamw_torch",
        gradient_checkpointing=four_bit,
        seed=seed,
        report_to="none",
    )
    if eval_ds is not None:
        common.update(eval_strategy="epoch", per_device_eval_batch_size=batch_size)

    # TRL moved these args into SFTConfig and renamed tokenizer ->
    # processing_class around 0.10. Support both.
    try:
        from trl import SFTConfig
        args = SFTConfig(max_seq_length=max_seq_length,
                         dataset_text_field="text",
                         packing=False, **common)
        trainer = SFTTrainer(model=model, args=args,
                             train_dataset=train_ds, eval_dataset=eval_ds,
                             processing_class=tok, peft_config=peft_config,
                             data_collator=collator)
    except (ImportError, TypeError):
        from transformers import TrainingArguments
        trainer = SFTTrainer(
            model=model, args=TrainingArguments(**common),
            train_dataset=train_ds, eval_dataset=eval_ds,
            dataset_text_field="text", max_seq_length=max_seq_length,
            tokenizer=tok, peft_config=peft_config, data_collator=collator,
            packing=False,
        )

    trainer.train()
    trainer.model.save_pretrained(output_dir)
    tok.save_pretrained(output_dir)
    print(f"\nadapter saved -> {output_dir}")
    print("next: python train_marathi_card_llm.py --merge")


# ─── Merge for GGUF export ───────────────────────────────────────────────────

def merge_adapter(base_model: str, adapter_dir: str, merged_dir: str) -> None:
    """Merge LoRA into an fp16 base. Required before convert_hf_to_gguf.py.

    The original guide pointed convert_hf_to_gguf.py straight at the adapter
    directory — there is no base model there, so it fails. Also: never merge
    into a 4-bit-loaded model; dequantization loses accuracy.
    """
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    base = AutoModelForCausalLM.from_pretrained(
        base_model, torch_dtype=torch.float16, trust_remote_code=True,
        device_map="cpu",
    )
    merged = PeftModel.from_pretrained(base, adapter_dir).merge_and_unload()
    merged.save_pretrained(merged_dir, safe_serialization=True)
    AutoTokenizer.from_pretrained(adapter_dir).save_pretrained(merged_dir)
    print(f"merged fp16 model -> {merged_dir}\n")
    print("GGUF export:")
    print("  git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp")
    print("  cmake -B build && cmake --build build --config Release -j")
    print("  pip install -r requirements.txt")
    print(f"  python convert_hf_to_gguf.py ../{merged_dir} "
          "--outfile mr-card-f16.gguf --outtype f16")
    print("  ./build/bin/llama-quantize mr-card-f16.gguf mr-card-q4.gguf Q4_K_M")
    print("\nVerify the quantized model BEFORE shipping — Q4_K_M sometimes")
    print("costs several points on Devanagari. Compare Q4_K_M vs Q5_K_M vs Q8_0")
    print("with eval_marathi_card.py and pick on measured accuracy, not size.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-file", default=DEFAULT_DATA)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--output-dir", default=DEFAULT_OUT)
    ap.add_argument("--merged-dir", default="output/qwen2.5-0.5b-marathi-merged")
    ap.add_argument("--max-seq-length", type=int, default=1024)
    ap.add_argument("--epochs", type=float, default=3)
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--no-4bit", action="store_true")
    ap.add_argument("--audit", action="store_true")
    ap.add_argument("--train", action="store_true")
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.data_file) and (args.train or args.audit):
        sys.exit(f"missing {args.data_file} — run mr_card_data.py first")

    if args.audit:
        audit(args.data_file, args.model, args.max_seq_length)
        return
    if args.merge:
        merge_adapter(args.model, args.output_dir, args.merged_dir)
        return
    if args.train:
        run_training(args.data_file, args.output_dir, args.model,
                     args.max_seq_length, args.epochs, args.batch_size,
                     args.grad_accum, args.lr, args.seed,
                     four_bit=not args.no_4bit)
        return
    ap.print_help()


if __name__ == "__main__":
    main()
