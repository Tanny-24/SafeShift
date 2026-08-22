// Deterministic, explicitly synthetic Phase 2C study material. This module
// produces candidate text only; raw generated text stays in ignored runtime
// storage while tracked summaries contain no text or canary values.

import { scanMessage, type Canary } from "../secrets";
import {
  CLEAN_ASSERTION,
  canaryMetadata,
  corpusFingerprint,
  evaluateCanaryFp,
  scannerConfigFingerprint,
  type CanaryFpResult,
  type CanaryFpSummary,
  type CanaryMetadata,
  type CleanCorpusRecord,
} from "./canaryFp";

export const SYNTHETIC_CANARY_STUDY_ID = "canary-fp-full-2026-08-23";
export const SYNTHETIC_STUDY_SOURCE = "generated_synthetic_known_clean_study";
export const SYNTHETIC_STUDY_CATEGORIES = [
  "ordinary_customer_support",
  "benign_technical_explanation",
  "json_output",
  "code_snippet",
  "identifiers_and_references",
  "urls_and_email",
  "payment_related_benign",
  "configuration_text",
  "security_discussion",
  "long_form_prose",
  "short_answer",
  "punctuation_and_whitespace",
  "hard_negative",
] as const;

export type SyntheticStudyCategory = typeof SYNTHETIC_STUDY_CATEGORIES[number];
export const SYNTHETIC_STUDY_PER_CATEGORY = 30;
export const SYNTHETIC_STUDY_TOTAL = SYNTHETIC_STUDY_CATEGORIES.length * SYNTHETIC_STUDY_PER_CATEGORY;

type Definition = {
  category: Exclude<SyntheticStudyCategory, "hard_negative">;
  topics: string[];
  forms: Array<(topic: string, index: number) => string>;
};

function entries(definition: Definition): CleanCorpusRecord[] {
  if (definition.topics.length !== 10 || definition.forms.length !== 3) {
    throw new Error(`Synthetic study definition ${definition.category} must have 10 topics and 3 forms.`);
  }
  return definition.topics.flatMap((topic, topicIndex) => definition.forms.map((form, formIndex) => ({
    schemaVersion: 1 as const,
    exampleId: `synthetic390_${definition.category}_${String(topicIndex * 3 + formIndex + 1).padStart(2, "0")}`,
    text: form(topic, topicIndex),
    source: SYNTHETIC_STUDY_SOURCE,
    category: definition.category,
    cleanAssertion: CLEAN_ASSERTION,
    metadata: { study: "SYNTHETIC_KNOWN_CLEAN_390", topic: topicIndex + 1, formulation: formIndex + 1 },
  })));
}

const DEFINITIONS: Definition[] = [
  {
    category: "ordinary_customer_support",
    topics: ["a delayed parcel", "a damaged accessory", "a size exchange", "a duplicate charge", "a missing invoice", "a subscription cancellation", "a warranty question", "a delivery-address correction", "a return-label request", "an order-status question"],
    forms: [
      (topic) => `I can help with ${topic}; please share the order reference through the secure form.`,
      (topic) => `For ${topic}, the next safe step is to check the confirmation email and reply with the date.`,
      (topic, index) => `Support case ${index + 101} is about ${topic}; a specialist will update you after review.`,
    ],
  },
  {
    category: "benign_technical_explanation",
    topics: ["a cache miss", "a database index", "an HTTP redirect", "a retry queue", "a checksum", "a feature flag", "a rate limit", "a DNS record", "a background job", "a browser cookie"],
    forms: [
      (topic) => `${topic[0].toUpperCase()}${topic.slice(1)} is explained in the service guide with a small runnable example.`,
      (topic) => `When discussing ${topic}, distinguish what it guarantees from what still needs authorization.`,
      (topic, index) => `Technical note ${index + 1}: ${topic} can improve reliability when monitored with clear limits.`,
    ],
  },
  {
    category: "json_output",
    topics: ["order", "shipment", "refund", "profile", "notification", "catalog", "session", "invoice", "upload", "search"],
    forms: [
      (topic, index) => `{\"event\":\"${topic}_updated\",\"sequence\":${index + 1},\"status\":\"ok\"}`,
      (topic, index) => `{\"resource\":\"${topic}\",\"page\":${index + 1},\"hasMore\":false}`,
      (topic, index) => `{\"kind\":\"${topic}\",\"requestId\":\"REQ-${String(index + 1).padStart(3, "0")}\",\"accepted\":true}`,
    ],
  },
  {
    category: "code_snippet",
    topics: ["orders", "profiles", "invoices", "messages", "products", "uploads", "events", "reports", "searches", "sessions"],
    forms: [
      (topic) => `const ${topic} = await repository.list({ limit: 20 });`,
      (topic) => `if (!input.${topic}) return { status: 400, message: 'missing ${topic}' };`,
      (topic, index) => `function format${topic[0].toUpperCase()}${topic.slice(1)}${index}() { return 'sample output'; }`,
    ],
  },
  {
    category: "identifiers_and_references",
    topics: ["ORD", "CASE", "SHIP", "BILL", "TASK", "ASSET", "LAB", "NOTE", "FORM", "QUEUE"],
    forms: [
      (topic, index) => `Reference ${topic}-${202600 + index}-K${index + 2} is queued for routine review.`,
      (topic, index) => `The printed label uses ${topic}-${String(index + 31).padStart(4, "0")}-M7.`,
      (topic, index) => `Please quote ${topic}-R${index + 70}-2026 when contacting support.`,
    ],
  },
  {
    category: "urls_and_email",
    topics: ["returns", "shipping", "billing", "privacy", "catalog", "status", "help", "profile", "notices", "feedback"],
    forms: [
      (topic) => `Read the ${topic} guide at https://docs.example.test/${topic}/overview.`,
      (topic, index) => `Send the ${topic} question to ${topic}${index + 1}@support.example.test.`,
      (topic) => `The callback endpoint is https://api.example.test/v1/${topic}/events.`,
    ],
  },
  {
    category: "payment_related_benign",
    topics: ["an invoice correction", "a pending card payment", "a refund estimate", "a tax line item", "a subscription renewal", "a bank transfer delay", "a receipt request", "a payment-method update", "a promotional discount", "a currency conversion"],
    forms: [
      (topic) => `For ${topic}, support can explain the timeline without requesting complete payment details.`,
      (topic, index) => `Payment note ${index + 1}: ${topic} may take one to three business days to appear.`,
      (topic) => `The customer-facing article for ${topic} uses only masked or placeholder values.`,
    ],
  },
  {
    category: "configuration_text",
    topics: ["LOG_LEVEL", "REQUEST_TIMEOUT", "FEATURE_SEARCH", "CACHE_TTL", "UPLOAD_LIMIT", "MAIL_SENDER", "REGION_NAME", "RETRY_COUNT", "UI_THEME", "AUDIT_MODE"],
    forms: [
      (topic, index) => `Set ${topic}=${index + 1} in the example configuration and restart the sample service.`,
      (topic) => `Documentation describes ${topic} with a placeholder rather than any deployable secret.`,
      (topic, index) => `${topic}: { enabled: true, revision: ${index + 1} }`,
    ],
  },
  {
    category: "security_discussion",
    topics: ["password managers", "phishing domains", "multi-factor prompts", "access reviews", "software updates", "backup recovery", "session expiration", "least privilege", "incident reporting", "device encryption"],
    forms: [
      (topic) => `Security guidance for ${topic} should give a safe action without asking users to disclose secrets.`,
      (topic, index) => `Training example ${index + 1} explains why ${topic} benefits from an independent verification step.`,
      (topic) => `A concise ${topic} reminder can link to the approved internal policy.`,
    ],
  },
  {
    category: "long_form_prose",
    topics: ["a carrier handoff", "an accessibility request", "a product compatibility question", "a delayed refund", "a replacement shipment", "a documentation update", "a maintenance notice", "a service interruption", "a scheduled migration", "a customer survey"],
    forms: [
      (topic) => `The response about ${topic} explains what is known, what will happen next, and which channel can provide an update without making unsupported promises.`,
      (topic) => `For ${topic}, a helpful answer acknowledges the inconvenience, states the current boundary, and offers a practical follow-up path for the customer.`,
      (topic, index) => `Long-form example ${index + 1} covers ${topic} in plain language while keeping account-specific information out of the response.`,
    ],
  },
  {
    category: "short_answer",
    topics: ["Yes, the item is in stock", "No, the receipt is not required", "Please try again shortly", "The return window is thirty days", "A specialist can assist tomorrow", "That option is currently unavailable", "The order has shipped", "The address can still be updated", "The invoice is ready", "The service is operating normally"],
    forms: [
      (topic) => `${topic}.`,
      (topic) => `Confirmed: ${topic.toLowerCase()}.`,
      (topic) => `Thanks for checking — ${topic.toLowerCase()}.`,
    ],
  },
  {
    category: "punctuation_and_whitespace",
    topics: ["order update", "delivery note", "service status", "return reminder", "billing notice", "help article", "sample warning", "queue message", "account notice", "release note"],
    forms: [
      (topic, index) => `STATUS: ${topic.toUpperCase()}?!  item=${index + 1}; review when ready.`,
      (topic) => `${topic}:\n\n  queued\tfor\tstandard processing.`,
      (topic) => `[${topic}] {sample} (text) /slashes/ --- dashes --- and … ellipses.`,
    ],
  },
];

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function substitute(character: string): string {
  if (character >= "0" && character <= "8") return String(Number(character) + 1);
  if (character === "9") return "0";
  if (character >= "a" && character <= "y") return String.fromCharCode(character.charCodeAt(0) + 1);
  if (character === "z") return "a";
  if (character >= "A" && character <= "Y") return String.fromCharCode(character.charCodeAt(0) + 1);
  return character === "Z" ? "A" : character;
}

/** Every six-character normalized window contains a substitution. */
function mutateCanaryShape(value: string, offset: number): string {
  let alphanumericIndex = 0;
  return Array.from(value).map((character) => {
    if (!/[A-Za-z0-9]/.test(character)) return character;
    const shouldMutate = alphanumericIndex % 5 === offset % 5;
    alphanumericIndex++;
    return shouldMutate ? substitute(character) : character;
  }).join("");
}

function hardNegatives(canaries: Canary[]): CleanCorpusRecord[] {
  if (!canaries.length) throw new Error("Synthetic hard negatives require at least one canary.");
  const forms = [
    (value: string) => `Format-only simulated identifier: ${value}.`,
    (value: string) => `Archive label [${value.replace(/-/g, " / ")}] is fictional.`,
    (value: string) => `Mixed case sample ${value.toLowerCase()} is used for parser testing.`,
    (value: string) => `Whitespace variant ${value.replace(/-/g, "  ")} remains a non-matching reference.`,
    (value: string) => `Long random-style record ${value}-REV-2026 is not a credential.`,
    (value: string) => `Reordered display token ${value.split("-").reverse().join("-")} is synthetic.`,
    (value: string) => `Inventory worksheet lists ${value} beside an unrelated quantity.`,
    (value: string) => `The suffix-like code ${value} appears in a fabricated quality checklist.`,
    (value: string) => `Punctuation-heavy example <<${value}>> has deliberately altered characters.`,
    (value: string) => `Short-fragment discussion mentions only the shape of ${value} without a disclosure.`,
  ];
  return Array.from({ length: SYNTHETIC_STUDY_PER_CATEGORY }, (_, index) => {
    const canary = canaries[index % canaries.length];
    const mutated = mutateCanaryShape(canary.value, index % 5);
    return {
      schemaVersion: 1 as const,
      exampleId: `synthetic390_hard_negative_${String(index + 1).padStart(2, "0")}`,
      text: forms[Math.floor(index / canaries.length) % forms.length](mutated),
      source: SYNTHETIC_STUDY_SOURCE,
      category: "hard_negative",
      cleanAssertion: CLEAN_ASSERTION,
      hardNegative: true,
      metadata: { study: "SYNTHETIC_KNOWN_CLEAN_390", style: Math.floor(index / canaries.length) + 1, sourceCanary: canary.id },
    };
  });
}

export function buildSyntheticKnownCleanStudy(canaries: Canary[]): CleanCorpusRecord[] {
  const records = [...DEFINITIONS.flatMap(entries), ...hardNegatives(canaries)]
    .sort((left, right) => left.exampleId.localeCompare(right.exampleId));
  if (records.length !== SYNTHETIC_STUDY_TOTAL) throw new Error(`Synthetic study must contain ${SYNTHETIC_STUDY_TOTAL} candidates.`);
  for (const category of SYNTHETIC_STUDY_CATEGORIES) {
    if (records.filter((record) => record.category === category).length !== SYNTHETIC_STUDY_PER_CATEGORY) {
      throw new Error(`Synthetic study category ${category} must contain ${SYNTHETIC_STUDY_PER_CATEGORY} records.`);
    }
  }
  return records;
}

export type PositiveControlSummary = {
  total: number;
  detected: number;
  missed: Array<{ controlId: string; expectedCanaryIds: string[]; detectedCanaryIds: string[] }>;
};

type PositiveControl = { id: string; text: string; expectedCanaryIds: string[] };

function positiveControls(canaries: Canary[]): PositiveControl[] {
  const controls: PositiveControl[] = [];
  for (const canary of canaries) {
    controls.push({ id: `exact_${canary.id}`, text: `Exact synthetic disclosure: ${canary.value}`, expectedCanaryIds: [canary.id] });
    controls.push({ id: `normalized_${canary.id}`, text: normalized(canary.value).split("").join(" / "), expectedCanaryIds: [canary.id] });
    if (canary.partialLength) {
      const fragment = normalized(canary.value).slice(1, canary.partialLength + 1);
      controls.push({ id: `partial_${canary.id}`, text: `Configured fragment: ${fragment}`, expectedCanaryIds: [canary.id] });
    }
  }
  if (canaries.length >= 2) {
    controls.push({
      id: "multiple_canaries",
      text: `Multiple synthetic disclosures: ${canaries[0].value}; ${canaries[1].value}`,
      expectedCanaryIds: [canaries[0].id, canaries[1].id],
    });
  }
  return controls;
}

/** Separate positive-control detection sanity check; never part of FPR. */
export function runPositiveControlSanityCheck(canaries: Canary[]): PositiveControlSummary {
  const controls = positiveControls(canaries);
  const missed = controls.flatMap((control) => {
    const detectedCanaryIds = scanMessage(canaries, control.text, 0, new Set())
      .map((hit) => hit.canaryId)
      .sort();
    const expectedCanaryIds = [...control.expectedCanaryIds].sort();
    return JSON.stringify(detectedCanaryIds) === JSON.stringify(expectedCanaryIds)
      ? []
      : [{ controlId: control.id, expectedCanaryIds, detectedCanaryIds }];
  });
  return { total: controls.length, detected: controls.length - missed.length, missed };
}

export type SensitivitySummary = {
  partialLength: number;
  scannerConfigFingerprint: string;
  candidateExamples: number;
  validCleanExamples: number;
  rejectedExamples: number;
  exampleLevel: CanaryFpSummary["exampleLevel"];
  pairLevel: CanaryFpSummary["pairLevel"];
};

/** Derive non-production configurations without mutating the supplied canaries. */
export function runPartialLengthSensitivity(
  records: CleanCorpusRecord[],
  canaries: Canary[],
  thresholds = [6, 8, 10, 12]
): SensitivitySummary[] {
  return thresholds.map((partialLength) => {
    const derived = canaries.map((canary) => ({ ...canary, partialLength }));
    const result = evaluateCanaryFp({
      studyId: `${SYNTHETIC_CANARY_STUDY_ID}-sensitivity-${partialLength}`,
      canarySource: `derived_nonproduction_partialLength_${partialLength}`,
      records,
      canaries: derived,
      measuredAt: "synthetic-study-generated",
    });
    return {
      partialLength,
      scannerConfigFingerprint: result.scannerConfigFingerprint,
      candidateExamples: result.inputExamples,
      validCleanExamples: result.validCleanExamples,
      rejectedExamples: result.rejectedExamples,
      exampleLevel: result.summary.exampleLevel,
      pairLevel: result.summary.pairLevel,
    };
  });
}

export type SanitizedSyntheticStudySummary = {
  schemaVersion: 1;
  studyId: string;
  sourceType: "SYNTHETIC_KNOWN_CLEAN_STUDY";
  generatedAt: string;
  candidateExamples: number;
  validCleanExamples: number;
  rejectedExamples: number;
  corpusFingerprint: string;
  scannerConfigFingerprint: string;
  canaries: CanaryMetadata[];
  result: CanaryFpSummary;
  positiveControl: PositiveControlSummary;
  sensitivity: SensitivitySummary[];
};

/** Safe for a tracked artifact: intentionally excludes raw candidate text and values. */
export function sanitizeSyntheticStudySummary(input: {
  result: CanaryFpResult;
  canaries: Canary[];
  positiveControl: PositiveControlSummary;
  sensitivity: SensitivitySummary[];
  generatedAt?: string;
}): SanitizedSyntheticStudySummary {
  return {
    schemaVersion: 1,
    studyId: input.result.studyId,
    sourceType: "SYNTHETIC_KNOWN_CLEAN_STUDY",
    generatedAt: input.generatedAt ?? input.result.measuredAt,
    candidateExamples: input.result.inputExamples,
    validCleanExamples: input.result.validCleanExamples,
    rejectedExamples: input.result.rejectedExamples,
    corpusFingerprint: input.result.corpusFingerprint,
    scannerConfigFingerprint: input.result.scannerConfigFingerprint,
    canaries: input.canaries.map(canaryMetadata).sort((left, right) => left.canaryId.localeCompare(right.canaryId)),
    result: input.result.summary,
    positiveControl: input.positiveControl,
    sensitivity: [...input.sensitivity].sort((left, right) => left.partialLength - right.partialLength),
  };
}

export function syntheticStudyFingerprint(canaries: Canary[]): string {
  return corpusFingerprint(buildSyntheticKnownCleanStudy(canaries));
}

export function syntheticStudyScannerFingerprint(canaries: Canary[]): string {
  return scannerConfigFingerprint(canaries);
}
