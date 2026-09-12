# CardFlowAI — Extraction API Specification
## Request Payload & Response Data Contracts

This document provides the exhaustive specification for the document & business card extraction API in CardFlowAI. It details the **exact request payload** sent by the application, the **asynchronous 202 job creation response**, the **job status polling responses**, and the **synchronous 200 OK fallback response**, along with all error conditions and field mappings.

---

## 1. Overview & Architecture

CardFlowAI uses a microservice architecture for AI OCR & Vision processing:

- **Service Base URL:** `http://69.62.73.51:8001` (Fallback: `http://69.62.73.51:8000` / `:3001`)
- **Extraction Endpoint:** `POST /api/v1/extract`
- **Job Status Endpoint:** `GET /api/v1/jobs/{jobId}/status`
- **Pre-scan Quota Check:** `GET /api/v1/cards/extract/check`
- **Authentication:** `Bearer <JWT_ACCESS_TOKEN>`

### Workflow Diagram

```
Mobile App / Client
       │
       ├──── 1. POST /api/v1/extract (Base64 file + docTypeHint) ─────────►
       │                                                                  │
       │◄─── 2. HTTP 202 Accepted { jobId: "uuid", status: "processing" } ┤
       │                                                                  │
       ├──── 3. GET /api/v1/jobs/{jobId}/status (Poll every 1.5–2s) ──────┤
       │◄─── 4. HTTP 200 OK { status: "processing", currentNode: "ocr" } ─┤
       │                                                                  │
       ├──── 5. GET /api/v1/jobs/{jobId}/status (Poll) ───────────────────┤
       │◄─── 6. HTTP 200 OK { status: "completed", result: { data: ... } }┘
```

---

## 2. Request Payload (`POST /api/v1/extract`)

### 2.1 HTTP Headers

| Header | Type | Value / Description | Required |
|---|---|---|---|
| `Content-Type` | string | `application/json` | ✅ Yes |
| `Authorization` | string | `Bearer <access_token>` | ✅ Yes |
| `Accept` | string | `application/json` | Optional |

---

### 2.2 Complete JSON Request Body

```json
{
  "fileBase64": "iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByaNyMAAAABHNCSVQICAgIfAhkiAAAAAlwSFlz...",
  "fileName": "card_1773489123000.jpg",
  "docTypeHint": "business_card",
  "userId": 42,
  "userName": "Harshal Patil",
  "userEmail": "harshal@example.com"
}
```

---

### 2.3 Request Payload Field Definitions

| Field | Type | Required | Constraints & Description |
|---|---|---|---|
| `fileBase64` | `string` | **Yes** | **Raw Base64-encoded string** of the document or card image.<br>• **Do NOT** include data URI prefixes (e.g. no `data:image/jpeg;base64,`).<br>• Decoded binary size must be **≤ 6 MB** (approx. 8 MB Base64 character length).<br>• If multiple cards or front/back scans are selected, the mobile app bundles them into a multi-page PDF encoded into this Base64 string. |
| `fileName` | `string` | **Yes** | Original filename including file extension (e.g. `card_scan.jpg`, `document.pdf`). Used by the server for MIME type detection.<br>• **Supported extensions:** `.jpg`, `.jpeg`, `.png`, `.pdf`, `.webp`, `.tiff`, `.bmp`. |
| `docTypeHint` | `string` | No | Classification hint for the extraction pipeline.<br>• **Allowed values:** `"business_card"`, `"hospital_bill"`, `"gfe"`, `"auto"`.<br>• Default: `"auto"` (the mobile app explicitly sends `"business_card"` for business card scanning). |
| `userId` | `number` | No | Numeric user identifier of the authenticated user submitting the scan. |
| `userName` | `string` | No | Name of the user submitting the document (defaults to `"Unknown User"` if omitted). |
| `userEmail` | `string` | No | Email of the user submitting the document (defaults to `"unknown@example.com"` if omitted). |

---

## 3. Initial Responses (`POST /api/v1/extract`)

### 3.1 HTTP 202 Accepted — Extraction Job Initiated (Standard Async Flow)

This is the standard response returned when background queue processing is active.

```json
{
  "success": true,
  "code": "PROCESSING",
  "message": "Extraction started.",
  "data": {
    "jobId": "163d5c3b-d9f9-40db-9677-1ea726065f79",
    "status": "processing"
  },
  "errors": null,
  "meta": null
}
```

---

### 3.2 HTTP 200 OK — Synchronous Immediate Completion (Fallback Flow)

When the backend runs synchronously or completes immediately:

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "Extraction completed.",
  "data": {
    "jobId": "b3d2e6f0-9c1a-4e3b-8f2a-1a2b3c4d5e6f",
    "status": "completed",
    "documentType": "business_card",
    "persisted": true,
    "cardId": 4821,
    "overallConfidence": 0.95,
    "needsHumanReview": false,
    "result": {
      "docType": "business_card",
      "data": {
        "fullName": "Rahul Sharma",
        "jobTitle": "Chief Technology Officer",
        "companyName": "TechNova Solutions",
        "category": "Information Technology",
        "email": "rahul.sharma@technova.io",
        "phonePrimary": "+91 98765 43210",
        "phoneSecondary": "+91 22 2876 5432",
        "website": "https://www.technova.io",
        "address": "102, Innovation Hub, BKC",
        "city": "Mumbai",
        "state": "Maharashtra",
        "providedServices": [
          "Enterprise Software",
          "Cloud Migration",
          "AI Solutions"
        ],
        "contacts": [
          {
            "name": "Rahul Sharma",
            "role": "Chief Technology Officer",
            "phones": [
              {
                "type": "primary",
                "number": "+91 98765 43210",
                "numberType": "mobile"
              },
              {
                "type": "secondary",
                "number": "+91 22 2876 5432",
                "numberType": "work"
              }
            ]
          }
        ],
        "meta": {}
      },
      "confidence": {
        "fullName": 0.99,
        "jobTitle": 0.96,
        "companyName": 0.98,
        "email": 0.97,
        "phonePrimary": 0.99,
        "website": 0.94,
        "address": 0.91,
        "city": 0.95,
        "state": 0.95
      },
      "needsReview": [],
      "overallConfidence": 0.95
    },
    "auditTrail": [
      {
        "node": "preprocess",
        "timestamp": "2026-09-12T10:25:01Z",
        "details": "Image normalized and contrast enhanced"
      },
      {
        "node": "classify",
        "timestamp": "2026-09-12T10:25:02Z",
        "details": "Document classified as business_card"
      },
      {
        "node": "extract_business_card",
        "timestamp": "2026-09-12T10:25:04Z",
        "details": "Vision extraction completed"
      },
      {
        "node": "validate",
        "timestamp": "2026-09-12T10:25:05Z",
        "details": "Regex validation passed"
      }
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

---

## 4. Polling Endpoint (`GET /api/v1/jobs/{jobId}/status`)

When `POST /api/v1/extract` returns **202 Accepted**, the mobile client polls this endpoint every **1.5–2 seconds** until terminal status is reached (`completed`, `needs_review`, or `failed`).

### Request
```http
GET /api/v1/jobs/163d5c3b-d9f9-40db-9677-1ea726065f79/status HTTP/1.1
Host: 69.62.73.51:8001
Authorization: Bearer <access_token>
```

---

### 4.1 Response: Processing (In-Flight Progress)

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "Job status retrieved.",
  "data": {
    "jobId": "163d5c3b-d9f9-40db-9677-1ea726065f79",
    "status": "processing",
    "statusMessage": "Your document is being processed.",
    "currentNode": "extract_business_card",
    "currentStepMessage": "Extracting details...",
    "retryCount": 0,
    "retryStrategy": "default",
    "updatedAt": "2026-09-12T10:25:03.120Z"
  },
  "errors": null,
  "meta": null
}
```

#### Progress Nodes & User Messages

| `currentNode` | Stage Label | UI Progress % |
|---|---|---|
| `preprocess` | Reading document... | 18% |
| `classify` | Identifying document type... | 38% |
| `extract_business_card` / `extract` | Extracting details... | 62% |
| `validate` | Verifying extracted data... | 82% |
| `flag_review` | Flagging for review... | 92% |
| `finalise` / `finalize` | Finishing up... | 98% |

---

### 4.2 Response: Completed (High Confidence, Ready to Save)

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "Job status retrieved.",
  "data": {
    "jobId": "163d5c3b-d9f9-40db-9677-1ea726065f79",
    "status": "completed",
    "statusMessage": "Extraction complete.",
    "currentNode": "finalize",
    "retryCount": 0,
    "retryStrategy": "default",
    "updatedAt": "2026-09-12T10:25:06.400Z",
    "documentType": "business_card",
    "needsHumanReview": false,
    "result": {
      "docType": "business_card",
      "data": {
        "fullName": "Priya Deshmukh",
        "jobTitle": "Managing Director",
        "companyName": "Apex Technologies India Pvt Ltd",
        "category": "Information Technology",
        "email": "priya.deshmukh@apextech.in",
        "phonePrimary": "+91 91234 56789",
        "phoneSecondary": "+91 20 6677 8899",
        "website": "https://www.apextech.in",
        "address": "Level 4, Cyber City, Magarpatta",
        "city": "Pune",
        "state": "Maharashtra",
        "providedServices": [
          "Cloud ERP",
          "Custom Software",
          "DevOps Consulting"
        ],
        "contacts": [
          {
            "name": "Priya Deshmukh",
            "role": "Managing Director",
            "phones": [
              {
                "type": "primary",
                "number": "+91 91234 56789",
                "numberType": "mobile"
              },
              {
                "type": "secondary",
                "number": "+91 20 6677 8899",
                "numberType": "office"
              }
            ]
          }
        ],
        "meta": {}
      },
      "confidence": {
        "fullName": 0.98,
        "jobTitle": 0.94,
        "companyName": 0.97,
        "email": 0.99,
        "phonePrimary": 0.96,
        "phoneSecondary": 0.92,
        "website": 0.95,
        "address": 0.89,
        "city": 0.93,
        "state": 0.93
      },
      "needsReview": [],
      "overallConfidence": 0.95
    },
    "auditTrail": [
      { "node": "preprocess", "timestamp": "2026-09-12T10:25:01Z", "details": "Processed image resolution: 1920x1080" },
      { "node": "classify", "timestamp": "2026-09-12T10:25:02Z", "details": "Type: business_card (0.99 confidence)" },
      { "node": "extract_business_card", "timestamp": "2026-09-12T10:25:04Z", "details": "Fields extracted via OCR/LLM engine" },
      { "node": "validate", "timestamp": "2026-09-12T10:25:05Z", "details": "All mandatory contact keys present" },
      { "node": "finalize", "timestamp": "2026-09-12T10:25:06Z", "details": "Standardized payload formatted" }
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

---

### 4.3 Response: Needs Review (Low Confidence on Certain Fields)

When OCR confidence is below threshold for some fields, `status` is `"needs_review"` and `needsReview` contains the field names:

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "Job status retrieved.",
  "data": {
    "jobId": "163d5c3b-d9f9-40db-9677-1ea726065f79",
    "status": "needs_review",
    "statusMessage": "Extraction completed with items flagged for verification.",
    "currentNode": "flag_review",
    "retryCount": 1,
    "retryStrategy": "retry_low_confidence",
    "updatedAt": "2026-09-12T10:25:07.110Z",
    "documentType": "business_card",
    "needsHumanReview": true,
    "result": {
      "docType": "business_card",
      "data": {
        "fullName": "Amit K. Verma",
        "jobTitle": "Regional Sales Lead",
        "companyName": "OmniGlobal Logistics",
        "category": "Logistics & Supply Chain",
        "email": "averma@omniglobal.com",
        "phonePrimary": "+91 99887 76655",
        "phoneSecondary": null,
        "website": "www.omni-global.biz",
        "address": "Plot 45, GIDC Industrial Estate",
        "city": "Vadodara",
        "state": "Gujarat",
        "providedServices": ["Freight Forwarding", "Warehousing"],
        "contacts": [
          {
            "name": "Amit K. Verma",
            "role": "Regional Sales Lead",
            "phones": [
              {
                "type": "primary",
                "number": "+91 99887 76655",
                "numberType": "mobile"
              }
            ]
          }
        ],
        "meta": {}
      },
      "confidence": {
        "fullName": 0.94,
        "jobTitle": 0.88,
        "companyName": 0.92,
        "email": 0.89,
        "phonePrimary": 0.95,
        "website": 0.62,
        "address": 0.58
      },
      "needsReview": ["website", "address"],
      "overallConfidence": 0.78
    },
    "auditTrail": [
      { "node": "preprocess", "timestamp": "2026-09-12T10:25:01Z" },
      { "node": "extract_business_card", "timestamp": "2026-09-12T10:25:04Z" },
      { "node": "validate", "timestamp": "2026-09-12T10:25:05Z" },
      { "node": "flag_review", "timestamp": "2026-09-12T10:25:07Z", "details": "Fields below 0.70 confidence: website, address" }
    ],
    "extractionMeta": {
      "totalPages": 1,
      "detectedLanguage": "en",
      "needsHumanReview": true,
      "needsReviewFields": ["website", "address"],
      "retryCount": 1
    }
  },
  "errors": null,
  "meta": null
}
```

---

### 4.4 Response: Job Failed (Pipeline Error)

```json
{
  "success": true,
  "code": "SUCCESS",
  "message": "Job status retrieved.",
  "data": {
    "jobId": "163d5c3b-d9f9-40db-9677-1ea726065f79",
    "status": "failed",
    "statusMessage": "Extraction failed.",
    "currentNode": "extract_business_card",
    "retryCount": 2,
    "retryStrategy": "default",
    "updatedAt": "2026-09-12T10:25:12.000Z",
    "errorMessage": "Unable to extract card details: Unreadable text or blurry image."
  },
  "errors": null,
  "meta": null
}
```

---

## 5. Error Responses Reference

### 5.1 HTTP 400 Bad Request — Deactivated User / Malformed Body

```json
{
  "success": false,
  "code": "INVALID_USER",
  "message": "User account is deactivated or invalid.",
  "data": {
    "jobId": "00000000-0000-0000-0000-000000000000",
    "status": "failed"
  },
  "errors": null,
  "meta": null
}
```

---

### 5.2 HTTP 401 Unauthorized — Expired / Missing Token

```json
{
  "success": false,
  "code": "TOKEN_EXPIRED",
  "message": "Your session has expired. Please log in again.",
  "data": null,
  "errors": null,
  "meta": null
}
```

---

### 5.3 HTTP 402 Payment Required — Monthly Scan Limit Reached

```json
{
  "success": false,
  "code": "SCAN_LIMIT_REACHED",
  "message": "You have reached your scan limit for this billing cycle. Please upgrade your plan.",
  "data": {
    "scansRemaining": 0,
    "scansUsed": 50,
    "scanLimit": 50,
    "plan": "Free Tier"
  },
  "errors": null,
  "meta": null
}
```

---

### 5.4 HTTP 413 Payload Too Large — Exceeds Binary Size Limit

```json
{
  "success": false,
  "code": "FILE_TOO_LARGE",
  "message": "The file is 6.8 MB, which exceeds the maximum allowed limit of 6 MB.",
  "data": {
    "jobId": "163d5c3b-d9f9-40db-9677-1ea726065f79",
    "status": "failed"
  },
  "errors": {
    "fileBase64": [
      "File exceeds maximum allowed size of 6 MB."
    ]
  },
  "meta": null
}
```

---

### 5.5 HTTP 415 Unsupported Media Type

```json
{
  "success": false,
  "code": "UNSUPPORTED_FILE_TYPE",
  "message": "Unsupported file format. Accepted formats: pdf, jpg, jpeg, png, tiff, webp, bmp.",
  "data": null,
  "errors": null,
  "meta": null
}
```

---

### 5.6 HTTP 422 Unprocessable Entity — Validation Failure

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed.",
  "data": null,
  "errors": {
    "fileBase64": [
      "fileBase64 is required."
    ],
    "docTypeHint": [
      "Must be one of: auto, business_card, gfe, hospital_bill"
    ]
  },
  "meta": null
}
```

---

### 5.7 HTTP 404 Not Found — Invalid Job ID on Status Poll

```json
{
  "success": false,
  "code": "JOB_NOT_FOUND",
  "message": "No extraction job found with id: 163d5c3b-d9f9-40db-9677-1ea726065f79",
  "data": null,
  "errors": null,
  "meta": null
}
```

---

### 5.8 HTTP 504 Gateway Timeout (Infrastructure Layer)

If extraction takes longer than 29 seconds on API Gateway / Cloudflare, a 504 response is returned before Lambda/Service finishes:

```json
{
  "success": false,
  "code": "GATEWAY_TIMEOUT",
  "message": "Extraction server timed out (504 Gateway Timeout). Please check your internet connection and try scanning again.",
  "data": null,
  "errors": null,
  "meta": null
}
```

---

## 6. Detailed Response Field Specification

### 6.1 Outer Response Envelope

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | `true` if HTTP request succeeded, `false` otherwise |
| `code` | `string` | Machine-readable status code (`SUCCESS`, `PROCESSING`, `FILE_TOO_LARGE`, etc.) |
| `message` | `string` | User-friendly feedback message |
| `data` | `object \| null` | Extraction response payload |
| `errors` | `object \| null` | Validation error dictionary (`{ fieldName: ["error reason"] }`) |
| `meta` | `object \| null` | Metadata, pagination, or debugging flags |

---

### 6.2 Extracted Business Card Data (`data.result.data`)

| Key | Type | Description | Example |
|---|---|---|---|
| `fullName` | `string` | Full name of the primary cardholder | `"Rahul Sharma"` |
| `jobTitle` | `string` | Job designation / role | `"Chief Technology Officer"` |
| `companyName` | `string` | Organization / Business name | `"TechNova Solutions"` |
| `category` | `string` | Business sector / industry | `"Information Technology"` |
| `email` | `string` | Primary business email | `"rahul.sharma@technova.io"` |
| `phonePrimary` | `string` | Primary contact number | `"+91 98765 43210"` |
| `phoneSecondary` | `string \| null` | Secondary or office phone number | `"+91 22 2876 5432"` |
| `website` | `string` | Company or personal URL | `"https://www.technova.io"` |
| `address` | `string` | Street address line | `"102, Innovation Hub, BKC"` |
| `city` | `string` | City / Town | `"Mumbai"` |
| `state` | `string` | State / Province | `"Maharashtra"` |
| `providedServices` | `string[]` | List of offered products / services | `["Cloud ERP", "AI Solutions"]` |
| `contacts` | `object[]` | Nested contact persons found on card | `[{ name, role, phones: [{ type, number, numberType }] }]` |
| `meta` | `object` | Arbitrary custom key-value pairs | `{}` |

---

### 6.3 Confidence Scores (`data.result.confidence`)

Dictionary mapping extracted camelCase keys to floating-point scores between `0.0` (0%) and `1.0` (100%):

```json
{
  "fullName": 0.99,
  "jobTitle": 0.96,
  "companyName": 0.98,
  "email": 0.97,
  "phonePrimary": 0.99,
  "phoneSecondary": 0.92,
  "website": 0.94,
  "address": 0.91,
  "city": 0.95,
  "state": 0.95
}
```

---

## 7. Client-Side UI Field Mapping in CardFlowAI

When the response arrives, the CardFlowAI mobile app maps the backend data model into display fields for the user:

```typescript
// Mapping priority implemented in CardFlowAI (src/screens/CardPreviewOCR/hooks.ts):
const fullName = contactPerson?.name || data.fullName || data.name || '';
const company = data.companyName || data.company || '';
const designation = contactPerson?.role || data.jobTitle || data.designation || '';
const primaryPhone = allPhones.find(p => p.type === 'primary')?.number || data.phonePrimary || data.mobile || '';
const secondaryPhone = allPhones.find(p => p.type === 'secondary')?.number || data.phoneSecondary || '';
const email = data.email || contactPerson?.email || '';
const website = data.website || '';
const city = data.address?.city || data.city || '';
const state = data.address?.state || data.state || '';
const address = data.address?.line1 || (typeof data.address === 'string' ? data.address : '');
const category = data.category || (data.providedServices?.[0] || '');
```