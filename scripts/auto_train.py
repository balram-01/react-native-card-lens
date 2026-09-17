#!/usr/bin/env python3
"""
Automated End-to-End Training & Evaluation Pipeline for Marathi Business Card SLM.

Runs the complete lifecycle with a single command:
  1. Verifies dependencies (torch, transformers, peft, trl, bitsandbytes, accelerate).
  2. Synthesizes 4-tier realistic OCR-degraded Marathi card data (mr_card_data.py).
  3. Measures the rules-only baseline score (eval_marathi_card.py --rules-only).
  4. Audits Devanagari token length and fertility.
  5. Fine-tunes the base model with QLoRA 4-bit (train_marathi_card_llm.py --train).
  6. Merges LoRA adapter into FP16 base model for GGUF export.
  7. Evaluates the fine-tuned model against held-out gold validation data.
  8. (Optional) Exports to GGUF format for llama.rn on-device mobile use.

Usage:
  python auto_train.py                         # Run full production pipeline
  python auto_train.py --preset quick          # Fast 1-epoch test run (~10 mins)
  python auto_train.py --model Qwen/Qwen2.5-0.5B-Instruct
  python auto_train.py --install-deps          # Auto-install Python packages first
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")
TRAIN_DATA = os.path.join(DATA_DIR, "marathi_cards_train.jsonl")
VAL_DATA = os.path.join(DATA_DIR, "marathi_cards_train_val.jsonl")
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"

REQUIRED_PACKAGES = [
    "torch",
    "transformers",
    "datasets",
    "peft",
    "trl",
    "bitsandbytes",
    "accelerate",
]


def log_step(step_num: int, total_steps: int, title: str) -> None:
    print("\n" + "═" * 78)
    print(f"  STEP {step_num}/{total_steps}: {title}")
    print("═" * 78 + "\n")


def check_and_install_deps(auto_install: bool = False) -> bool:
    missing = []
    for pkg in REQUIRED_PACKAGES:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)

    if not missing:
        print("✓ All required Python dependencies are installed.")
        return True

    print(f"⚠️  Missing {len(missing)} package(s): {', '.join(missing)}")
    if auto_install:
        print("📦 Auto-installing missing packages...")
        cmd = [sys.executable, "-m", "pip", "install", "-U"] + missing
        res = subprocess.run(cmd)
        return res.returncode == 0
    else:
        print("\nRun this command to install dependencies:")
        print(f"  pip install -U {' '.join(missing)}\n")
        print("Or re-run with: python auto_train.py --install-deps")
        return False


def run_command(cmd: list[str], desc: str, cwd: str = SCRIPT_DIR) -> bool:
    print(f"▶ [{desc}]")
    print(f"  $ {' '.join(cmd)}\n")
    t0 = time.time()
    res = subprocess.run(cmd, cwd=cwd)
    elapsed = time.time() - t0
    if res.returncode != 0:
        print(f"\n❌ Error in {desc} (Exit code: {res.returncode}, took {elapsed:.1f}s)")
        return False
    print(f"\n✓ Completed {desc} in {elapsed:.1f}s")
    return True


def export_gguf_instructions(merged_dir: str, out_gguf_name: str = "mr-card-q4.gguf") -> None:
    print("\n" + "─" * 78)
    print("📱 GGUF ON-DEVICE EXPORT INSTRUCTIONS (for llama.rn / React Native)")
    print("─" * 78)
    print(f"Your fine-tuned model is merged in: {merged_dir}")
    print("\nTo generate the quantized GGUF for Android & iOS:")
    print("  git clone https://github.com/ggml-org/llama.cpp.git")
    print("  cd llama.cpp")
    print("  cmake -B build && cmake --build build --config Release -j")
    print("  pip install -r requirements.txt")
    print(f"  python3 convert_hf_to_gguf.py {merged_dir} --outfile mr-card-f16.gguf --outtype f16")
    print(f"  ./build/bin/llama-quantize mr-card-f16.gguf {out_gguf_name} Q4_K_M")
    print(f"\nThen copy {out_gguf_name} into your React Native app or host on HuggingFace!")
    print("─" * 78 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Automated End-to-End Marathi Card SLM Trainer & Evaluator"
    )
    parser.add_argument(
        "--preset",
        choices=["quick", "balanced", "production"],
        default="production",
        help="quick: 1000 cards / 1 epoch, balanced: 2500 cards / 2 epochs, production: 4000 cards / 3 epochs",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="HuggingFace base model")
    parser.add_argument("--count", type=int, default=None, help="Synthetic cards to generate")
    parser.add_argument("--epochs", type=float, default=None, help="Training epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Per-device batch size")
    parser.add_argument("--grad-accum", type=int, default=4, help="Gradient accumulation steps")
    parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--install-deps", action="store_true", help="Auto-install missing pip packages")
    parser.add_argument("--skip-gen", action="store_true", help="Skip dataset generation if file exists")
    parser.add_argument("--skip-train", action="store_true", help="Skip training (only eval/merge)")
    parser.add_argument("--skip-eval", action="store_true", help="Skip post-training evaluation")
    parser.add_argument("--export-gguf", action="store_true", help="Attempt automated llama.cpp conversion")

    args = parser.parse_args()

    # Preset configurations
    if args.preset == "quick":
        count = args.count or 1000
        epochs = args.epochs or 1.0
    elif args.preset == "balanced":
        count = args.count or 2500
        epochs = args.epochs or 2.0
    else:  # production
        count = args.count or 4000
        epochs = args.epochs or 3.0

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    adapter_dir = os.path.join(OUTPUT_DIR, "marathi-card-lora")
    merged_dir = os.path.join(OUTPUT_DIR, "marathi-card-merged")

    total_steps = 7
    current_step = 1

    print("\n" + "★" * 78)
    print("  MARATHI CARD SLM AUTOMATED TRAINING PIPELINE")
    print(f"  Base Model : {args.model}")
    print(f"  Preset     : {args.preset.upper()} (Count: {count}, Epochs: {epochs})")
    print("★" * 78)

    # ── Step 1: Check Dependencies ─────────────────────────────────────────────
    log_step(current_step, total_steps, "Validating Python Dependencies")
    current_step += 1
    deps_ok = check_and_install_deps(auto_install=args.install_deps)
    if not deps_ok:
        sys.exit(1)

    # ── Step 2: Synthetic Dataset Generation ───────────────────────────────────
    log_step(current_step, total_steps, f"Generating {count} Realistic Marathi Cards")
    current_step += 1
    if args.skip_gen and os.path.exists(TRAIN_DATA) and os.path.exists(VAL_DATA):
        print(f"✓ Skipping data generation (--skip-gen). Using existing: {TRAIN_DATA}")
    else:
        cmd = [
            sys.executable,
            os.path.join(SCRIPT_DIR, "mr_card_data.py"),
            "--out",
            TRAIN_DATA,
            "--count",
            str(count),
        ]
        if not run_command(cmd, "Dataset Synthesis"):
            sys.exit(1)

    # ── Step 3: Rules-Only Baseline Evaluation ─────────────────────────────────
    log_step(current_step, total_steps, "Measuring Rules-Only Baseline Accuracy")
    current_step += 1
    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, "eval_marathi_card.py"),
        "--gold",
        VAL_DATA,
        "--rules-only",
    ]
    run_command(cmd, "Baseline Rules Evaluation")

    # ── Step 4: Token Length & Fertility Audit ─────────────────────────────────
    log_step(current_step, total_steps, f"Auditing Tokenizer Fertility for {args.model}")
    current_step += 1
    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, "train_marathi_card_llm.py"),
        "--audit",
        "--model",
        args.model,
        "--data-file",
        TRAIN_DATA,
    ]
    if not run_command(cmd, "Devanagari Token Length Audit"):
        sys.exit(1)

    # ── Step 5: QLoRA Fine-Tuning ──────────────────────────────────────────────
    log_step(current_step, total_steps, f"Fine-Tuning {args.model} via QLoRA 4-bit")
    current_step += 1
    if args.skip_train:
        print("✓ Skipping training (--skip-train).")
    else:
        cmd = [
            sys.executable,
            os.path.join(SCRIPT_DIR, "train_marathi_card_llm.py"),
            "--train",
            "--model",
            args.model,
            "--data-file",
            TRAIN_DATA,
            "--output-dir",
            adapter_dir,
            "--epochs",
            str(epochs),
            "--batch-size",
            str(args.batch_size),
            "--grad-accum",
            str(args.grad_accum),
            "--lr",
            str(args.lr),
        ]
        if not run_command(cmd, "QLoRA SFT Training"):
            sys.exit(1)

    # ── Step 6: LoRA Merge for GGUF ────────────────────────────────────────────
    log_step(current_step, total_steps, "Merging LoRA Adapter into FP16 Base Model")
    current_step += 1
    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, "train_marathi_card_llm.py"),
        "--merge",
        "--model",
        args.model,
        "--output-dir",
        adapter_dir,
        "--merged-dir",
        merged_dir,
    ]
    if not run_command(cmd, "Model Weight Merging"):
        sys.exit(1)

    # ── Step 7: Final Held-Out Evaluation ──────────────────────────────────────
    log_step(current_step, total_steps, "Evaluating Fine-Tuned Model Against Validation Set")
    current_step += 1
    if not args.skip_eval:
        cmd = [
            sys.executable,
            os.path.join(SCRIPT_DIR, "eval_marathi_card.py"),
            "--gold",
            VAL_DATA,
            "--model",
            merged_dir,
        ]
        run_command(cmd, "Post-Training Model Evaluation")

    # ── Step 8: GGUF Export Instructions / Tooling ─────────────────────────────
    export_gguf_instructions(merged_dir)

    print("\n" + "🎉" * 39)
    print("  AUTOMATED PIPELINE COMPLETED SUCCESSFULLY!")
    print(f"  Artifacts saved to: {OUTPUT_DIR}")
    print("🎉" * 39 + "\n")


if __name__ == "__main__":
    main()
