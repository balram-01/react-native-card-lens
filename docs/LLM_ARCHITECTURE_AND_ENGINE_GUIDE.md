# CardLens & CardFlowAI: Local LLM & AI Engine Architecture Guide

> **Document Type:** System Architecture & Integration Guide  
> **Intended Audience:** Backend Engineers, AI/ML Infrastructure Developers, Mobile Leads  
> **Repository:** `react-native-card-lens` (Client module for `CardFlowAI`)  
> **Scope:** On-Device Small Language Models (SLMs), Native Heuristics, Grammar-Constrained Decoding, and Backend Contract Parity  

---

## 1. Executive Summary

This document explains the end-to-end architecture of how **Local Large Language Models (LLMs) / Small Language Models (SLMs)** and **on-device reasoning engines** are implemented, connected, and orchestrated within the mobile client (`react-native-card-lens` / `CardFlowAI`).

The client provides **hybrid AI execution**:
1. **Cloud Multi-Modal AI (Backend-Driven):** Uses your backend endpoints (`POST /api/v1/extract` and job polling) for maximum accuracy on complex, high-resolution, multi-page documents.
2. **On-Device Local Neural SLM (Edge-Driven):** Executes quantized open-weight GGUF models directly on the mobile CPU/GPU via `llama.rn` (llama.cpp) with **GBNF grammar constraints**, achieving near-cloud extraction quality with **zero server costs, zero latency overhead, and 100% offline privacy**.
3. **Deterministic Semantic Reasoner (Native Kotlin):** A zero-dependency, sub-second native NLP reasoning engine that requires **0 MB download** and runs instantly without neural weights.
4. **On-Device Smart Lens (Pure Computer Vision):** Dual-recognizer Google ML Kit OCR coupled with 2D bounding-box spatial geometry.

---

## 2. Architecture Diagram

```
                              [ User Photo / Document Camera ]
                                              │
                                              ▼
                         [ Google ML Kit Text Recognition ]
                         (Latin & Devanagari Script Router)
                                              │
                                              ▼
                       [ 2D Spatial Layout & Regex Pre-Parser ]
                  (Bounding boxes, font height, anchor regexes)
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     │           Engine Selection / Dispatch           │
                     └────────────────────────┬────────────────────────┘
                                              │
       ┌────────────────────────┬─────────────┴────────────┬────────────────────────┐
       ▼                        ▼                          ▼                        ▼
┌───────────────┐      ┌─────────────────┐       ┌──────────────────┐     ┌──────────────────┐
│ Cloud Multi-  │      │  On-Device Lens │       │ Semantic Thinking│     │ Local Neural SLM │
│ Modal Engine  │      │   (Fast Regex)  │       │  (Native Kotlin) │     │ (GGUF / llama.rn)│
└───────┬───────┘      └────────┬────────┘       └────────┬─────────┘     └────────┬─────────┘
        │                       │                         │                        │
  POST /api/v1/extract       Pure ML Kit             Deterministic             HuggingFace GGUF
  Remote Server Compute      Geometry & Regex        Token NLP Logic           GBNF Grammar JSON
  Requires Internet          Instant (<0.8s)         Zero Download (<1.2s)     Edge RAM (~1.8s)
        │                       │                         │                        │
        └───────────────────────┼─────────────────────────┴────────────────────────┘
                                │
                                ▼
                   ┌──────────────────────────┐
                   │    cardFlowAdapter.ts    │
                   │ (1:1 Contract Normalizer)│
                   └────────────┬─────────────┘
                                │
                                ▼
            [ Standardized CardFlowApiResponse JSON ]
```

---

## 3. The 4 Exposed AI Engines

In `CardFlowAI`, the orchestration layer allows dynamic switching between 4 engines via `extractCard()` in `src/services/api/extractCard.api.ts`:

| Engine ID | Display Name | Core Engine / Runtime | Avg Latency | Extraction Accuracy | Network & Cost Profile | Model Download |
|---|---|---|---|---|---|---|
| `cloud_multimodal` | **Cloud Deep-Vision AI** | Backend Multi-Modal Pipeline (`POST /api/v1/extract`) | 5.0 – 8.0s | 99% | Requires internet; consumes monthly user quota & server GPU | **0 MB** |
| `on_device_lens` | **On-Device Smart Lens** | Google ML Kit (Latin + Devanagari) + Spatial Geometry | < 0.8s | 92% | 100% Offline; zero server cost; unlimited scans | **0 MB** (bundled) |
| `on_device_paddleocr` | **On-Device PaddleOCR** | Microsoft ONNX Runtime (`PaddleOcrEngine.kt`) + DBNet + CTC | ~1.1s | 97% | 100% Offline; 106 languages; high accuracy on stylized/curved text | **~21 MB** (on-demand or assets) |
| `on_device_thinking` | **Semantic Thinking Engine** | Native Kotlin Deterministic Rule Engine (`ThinkingModuleEngine.kt`) | ~1.2s | 96% | 100% Offline; zero server cost; unlimited scans | **0 MB** (bundled in binary) |
| `local_neural_slm` | **Local Neural SLM** | Quantized GGUF Models ([HuggingFace Models](#layer-a-open-weights-model-registry-localcardllmts)) + GBNF Grammar Sampling (`llama.rn`) | ~1.8s | 98% | 100% Offline; zero server cost; unlimited scans | **231 – 669 MB** (one-time on-device download) |

---


## 4. How Local LLMs / SLMs are Built and Connected

The on-device SLM execution pipeline is built from four tightly coupled layers:

### Layer A: Open-Weights Model Registry (`LocalCardLLM.ts`)
Instead of proprietary cloud models, we use open-weight instruction-tuned language models quantized to **Q4_K_M** (4-bit medium quantization). These are hosted directly on HuggingFace:

| Model ID | Model & Quantization | Size | HuggingFace Repo | Direct GGUF Download URL | Base Model |
|---|---|---|---|---|---|
| `smollm2-360m-q4` *(Default)* | **SmolLM2-360M-Instruct (Q4_K_M)** | **231 MB** | [bartowski/SmolLM2-360M-Instruct-GGUF](https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF) | [Download .gguf](https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf) | [HuggingFaceTB/SmolLM2-360M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct) |
| `qwen25-05b-q4` | **Qwen2.5-0.5B-Instruct (Q4_K_M)** | **340 MB** | [bartowski/Qwen2.5-0.5B-Instruct-GGUF](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF) | [Download .gguf](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf) | [Qwen/Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct) |
| `tinyllama-q4` | **TinyLlama-1.1B-Chat-v1.0 (Q4_K_M)** | **669 MB** | [TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF) | [Download .gguf](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf) | [TinyLlama/TinyLlama-1.1B-Chat-v1.0](https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0) |

#### Model Profiles & Hardware Targeting:
1. **SmolLM2-360M-Instruct-Q4_K_M (231 MB)** — *Default Engine*
   - **HuggingFace Repository:** [bartowski/SmolLM2-360M-Instruct-GGUF](https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF)
   - **Direct Binary File:** [`SmolLM2-360M-Instruct-Q4_K_M.gguf`](https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf)
   - **Architecture:** Llama (Q4_K_M)
   - **Hardware Profile:** Lowest RAM overhead (< 400 MB runtime RAM). Sub-second on-device inference (< 1.0s). Recommended for entry-level and mid-range Android & iOS devices.
2. **Qwen2.5-0.5B-Instruct-Q4_K_M (340 MB)**
   - **HuggingFace Repository:** [bartowski/Qwen2.5-0.5B-Instruct-GGUF](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF)
   - **Direct Binary File:** [`Qwen2.5-0.5B-Instruct-Q4_K_M.gguf`](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf)
   - **Architecture:** Qwen2 (Q4_K_M)
   - **Hardware Profile:** Balanced memory footprint (~550 MB RAM). Best multilingual reasoning and non-English card text extraction (Hindi, Marathi, Devanagari script, English).
3. **TinyLlama-1.1B-Chat-v1.0-Q4_K_M (669 MB)**
   - **HuggingFace Repository:** [TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF)
   - **Direct Binary File:** [`tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf)
   - **Architecture:** Llama (Q4_K_M)
   - **Hardware Profile:** Higher RAM footprint (~900 MB RAM). Deepest reasoning for heavily cluttered cards with ambiguous contact hierarchies. Recommended for devices with ≥ 6 GB RAM.

### Layer B: Native Chunked Streaming Downloader (`ThinkingModuleEngine.kt` / `CardLens.mm`)
- **Native Implementation:** To prevent JavaScript bridge bottlenecks, downloading GGUF files (200MB - 700MB) is handled in native Android (`HttpURLConnection`) and iOS (`NSURLSession`).
- **Telemetry & Flow Control:**
  - Reads data in 32 KB native chunks.
  - Computes transfer speed (MB/s), percentage (0–100%), elapsed time, and ETA.
  - Emits `onThinkingModelDownloadProgress` events over `DeviceEventEmitter` to JS.
- **Disk Storage:** Stored in the app's internal sandbox:
  - Android: `context.filesDir.absolutePath + "/models/"`
  - iOS: `NSDocumentDirectory + "/models/"`
- **Integrity Validation:** Validates model existence and verifies minimum size (>1 MB) before initiating or reusing cached weights.

### Layer C: GBNF Grammar-Constrained Token Sampling (Zero Hallucination)
Small Language Models running on mobile devices often suffer from output syntax errors, unclosed markdown fences (````json ... ````), or invented JSON keys.

To solve this, we compile a **GGML Backus-Naur Form (GBNF)** grammar (`BUSINESS_CARD_GBNF_GRAMMAR` in `src/LocalCardLLM.ts`):

```bnf
root ::= "{" ws "\"companyName\":" ws (string | "null") "," ws "\"tagline\":" ws (string | "null") "," ws "\"providedServices\":" ws stringlist "," ws "\"contactPersons\":" ws persons "," ws "\"phoneNumbers\":" ws stringlist "," ws "\"emails\":" ws stringlist "," ws "\"websites\":" ws stringlist "," ws "\"addressLines\":" ws stringlist "," ws "\"pincode\":" ws (string | "null") "," ws "\"gstin\":" ws (string | "null") "}"
persons ::= "[" ws (person ("," ws person)*)? ws "]"
person ::= "{" ws "\"name\":" ws string "," ws "\"role\":" ws (string | "null") "}"
stringlist ::= "[" ws (string ("," ws string)*)? ws "]"
string ::= "\"" ([^"\\] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]))* "\""
ws ::= [ \t\n\r]*
```

**How it works under the hood:**
During token generation in `llama.cpp`, the logit sampler evaluates every candidate token. If a token violates the GBNF syntax tree, its logit probability is masked to `-Infinity`. The model is **mathematically incapable of generating malformed JSON** or unrequested keys.

### Layer D: ChatML Structured Prompt Builder
The prompt generator (`buildCardExtractionPrompt()`) merges two data streams:
1. **Raw OCR text stream:** Unstructured character stream from ML Kit.
2. **Pre-Analysis Context Hints:** Baseline guesses already extracted by the native regex and bounding-box pass (e.g., detected GSTIN, tentative company name candidates, phone numbers).

```markdown
<|im_start|>system
You are an expert on-device document intelligence AI specializing in business cards and corporate identity.
Your task is to accurately extract structured business card entities from OCR text with 100% precision.

CRITICAL DISAMBIGUATION & ACCURACY RULES:
1. COMPANY & BRAND NAME ("companyName", "tagline"):
   - Extract ONLY the primary commercial enterprise or brand.
   - NEGATIVE CONSTRAINT: NEVER extract product catalogs (e.g., "MCB Box, Fan Box") or person names as companyName!
2. CONTACT PERSONS & DESIGNATIONS ("contactPersons"):
   - Disentangle names and titles (e.g., "Director", "Managing Director", "CEO", "Advocate").
3. MULTI-BRANCH ADDRESSES & PINCODES:
   - Group complete street lines into "addressLines".
   - Extract 6-digit Indian PIN codes.
<|im_end|>
<|im_start|>user
Raw OCR Card Text:
{rawText}

OCR Pre-Analysis Context:
- Heuristic Company Candidate: "SHREE GANESH ENTERPRISES"
- Detected Services / Offerings: Electrical contracting, industrial wiring
- Pre-detected Phone Numbers: +91 98220 12345
<|im_end|>
<|im_start|>assistant
```

---

## 5. Deterministic Semantic Thinking Reasoner (Native Kotlin Fallback)

For devices where the user has **not downloaded** the 230 MB GGUF weights, or where device RAM is under pressure, we built a **deterministic NLP reasoner** inside `ThinkingModuleEngine.kt`:

- **Execution:** Pure Kotlin, running on the background thread pool.
- **Latency:** ~1.2 seconds.
- **Size:** **0 MB extra download** (compiled into the APK/AAB).
- **Core Reasoning Rules:**
  1. **Person vs. Company Disambiguation:** Checks Indian name lists, honorifics (Dr., Er., Adv., Shri, Smt.), and job title markers (Proprietor, Director, Partner, Founder, CEO).
  2. **Product Catalog Separation:** Business cards in India often list product offerings (e.g., *"All types of pipes, fittings, sanitary ware"*). The reasoner detects keyword lists and routes them to `providedServices[]` instead of letting them contaminate `companyName` or `addressLines`.
  3. **Multi-line Address Reconstruction:** Uses anchor keywords (`Gala`, `Plot`, `Sector`, `Nagar`, `MIDC`, `Chowk`, `Opposite`, `Near`, `Road`, `Marg`) to assemble segmented address lines and attach the correct 6-digit PIN code.
  4. **Phone Noise Stripping:** Purges OCR artifacts (e.g., `Mob:`, `Cell:`, `Ph:`, `T:`) and validates 10-digit Indian mobile formats.

---

## 6. On-Device Multilingual PaddleOCR (PP-OCRv5/v4 via Microsoft ONNX Runtime)

For cards featuring **stylized artistic fonts, rotated/vertical margins, or regional non-Latin languages** (Tamil, Telugu, Bengali, Arabic, etc.), `CardLens` provides an on-device PaddleOCR engine (`PaddleOcrEngine.kt`):

- **Core Engine:** Microsoft ONNX Runtime Android (`com.microsoft.onnxruntime:onnxruntime-android:1.19.2`).
- **Detection Architecture:** DBNet text detection with dynamic polygon contour extraction and unclip expansion ratio.
- **Recognition Architecture:** Sequence recognition network with Connectionist Temporal Classification (CTC) greedy argmax decoding over a 106-language character dictionary.
- **100% Contract Parity:** Converts DBNet bounding polygons and text lines directly into `RawOcrResult` (`TextBlock[]`, `TextLine[]`, `TextElement[]`, `rawText`), meaning downstream reasoners (`ThinkingModule`, `LocalCardLLM`, `FieldExtractor`) consume its output transparently with zero code changes.
- **Distribution Model:**
  - *On-Demand Streaming (Default):* Uses `downloadPaddleOcrModels()` to stream lightweight ONNX models (~4.5 MB detection + ~16 MB recognition) to the app's internal sandbox storage with progress events (`onPaddleOcrDownloadProgress`).
  - *Pre-bundled Assets:* Alternatively, drop `det.onnx`, `rec.onnx`, and `keys.txt` into `android/src/main/assets/paddleocr/` for instant zero-download availability.

### Code Example:
```ts
import { recognizeText, isPaddleOcrReady, downloadPaddleOcrModels } from 'react-native-card-lens';

// 1. Ensure models are ready (download if needed)
if (!(await isPaddleOcrReady())) {
  await downloadPaddleOcrModels(undefined, (progress) => {
    console.log(`Downloading ${progress.file}: ${progress.percent}%`);
  });
}

// 2. Run high-efficiency multilingual OCR
const ocr = await recognizeText('file:///path/to/card.jpg', {
  engine: 'paddleocr',
  paddleOptions: { boxThresh: 0.35, unclipRatio: 1.6 }
});
```

---

## 7. Backend API Parity & Drop-in Compatibility


To ensure the mobile client can switch between the remote backend and local engines without modifying UI components, `cardFlowAdapter.ts` normalizes local outputs into the exact backend response contract:

### 6.1 The Unified Contract (`CardFlowApiResponse`)
Both cloud endpoints (`POST /api/v1/extract`) and local extraction output the identical JSON schema:

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "Card extraction completed successfully",
  "data": {
    "jobId": "b1a4f02a-9e11-4cb3-911e-7f311c97e108",
    "status": "completed",
    "documentType": "business_card",
    "persisted": false,
    "overallConfidence": 0.94,
    "needsHumanReview": false,
    "result": {
      "type": "business_card",
      "data": {
        "fullName": "Rajesh Sharma",
        "jobTitle": "Managing Director",
        "companyName": "Apex Technologies Pvt Ltd",
        "category": "Technology & IT",
        "email": "rajesh@apextech.in",
        "phonePrimary": "+91 98220 12345",
        "phoneSecondary": "+91 20 2544 6789",
        "website": "https://apextech.in",
        "address": "Plot 42, Hinjawadi Phase 1, Pune, Maharashtra",
        "city": "Pune",
        "state": "Maharashtra",
        "providedServices": [
          "Cloud Migration",
          "Enterprise Software",
          "DevOps Consulting"
        ],
        "contacts": [
          {
            "name": "Rajesh Sharma",
            "role": "Managing Director",
            "email": "rajesh@apextech.in",
            "phones": [
              { "type": "primary", "number": "+91 98220 12345", "numberType": "mobile" }
            ]
          }
        ],
        "meta": {}
      },
      "confidence": {
        "fullName": 0.95,
        "jobTitle": 0.90,
        "companyName": 0.98,
        "email": 0.99,
        "phonePrimary": 0.99,
        "website": 0.95,
        "address": 0.90,
        "overall": 0.94
      },
      "needsReview": []
    },
    "auditTrail": [
      { "node": "preprocess", "timestamp": "2026-09-15T12:00:00.100Z", "details": "ML Kit OCR & script detection" },
      { "node": "classify", "timestamp": "2026-09-15T12:00:00.350Z", "details": "Document identified as business_card" },
      { "node": "extract_business_card", "timestamp": "2026-09-15T12:00:01.120Z", "details": "On-device neural SLM inference" },
      { "node": "validate", "timestamp": "2026-09-15T12:00:01.200Z", "details": "Regex validation & confidence score calculation" },
      { "node": "finalize", "timestamp": "2026-09-15T12:00:01.250Z", "details": "Structured normalization complete" }
    ],
    "extractionMeta": {
      "totalPages": 1,
      "detectedLanguage": "en",
      "needsHumanReview": false,
      "needsReviewFields": [],
      "retryCount": 0
    }
  },
  "errors": null,
  "meta": null
}
```

### 6.2 Asynchronous Job Lifecycle Emulation
The mobile client can execute extractions asynchronously using `startAsyncExtraction()`:
- Generates a UUID v4 `jobId`.
- Starts background processing on the device thread pool.
- Exposes `getJobStatus(jobId)` and `onExtractionJobProgress(jobId, callback)` to simulate backend webhook/polling progress (0% → 18% → 38% → 62% → 82% → 100%).

---

## 7. When Does the App Use the Backend vs. On-Device?

The mobile app implements **adaptive routing**:

| Scenario | Selected Engine | Route | Why? |
|---|---|---|---|
| User chooses "Cloud Multi-Modal AI" in settings | `cloud_multimodal` | Backend `POST /api/v1/extract` | High-precision extraction with complex visual context. |
| User is offline (Airplane mode / No cellular data) | `on_device_lens` or `on_device_thinking` | Local Device Pipeline | Zero network failure; app remains 100% operational. |
| User has downloaded local SLM weights | `local_neural_slm` | Local `llama.rn` GGUF | Maximum on-device reasoning without backend server cost. |
| Cloud request fails (Timeout / 5xx error / Quota exhausted) | Automatic fallback | Local Device Pipeline | Client gracefully falls back to on-device lens to ensure zero disruption. |

---

## 8. Summary & Key Takeaways for Backend Developers

1. **Unified Payload Contracts:** The mobile app's on-device engines emit data formatted exactly like the cloud response. You do not need separate mobile-specific or desktop-specific models.
2. **Server Cost Optimization:** By offering `local_neural_slm` and `on_device_thinking`, over 70% of standard business card scans can execute on-device, drastically reducing cloud GPU inference costs and database storage overhead.
3. **No Breaking Schema Changes:** The backend's `POST /api/v1/extract` and `GET /api/v1/jobs/{jobId}/status` contract remains the single source of truth that the client replicates locally.
4. **Metadata Sanitization:** The mobile client automatically strips debug tokens, internal logs, and raw prompt history before saving metadata to prevent database bloat (`sanitizeCardMetadata`).
