const mongoose = require("mongoose");
const { Schema, model } = mongoose;

// ১. ভার্সন অনুযায়ী আইনি ডকুমেন্ট টেমপ্লেট (Terms, Privacy, Partner Contract)
const legalDocumentSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "TERMS_AND_CONDITIONS",
        "PRIVACY_NOTICE",
        "PARTNER_SERVICE_CONTRACT",
      ],
      required: true,
      index: true,
    },
    version: {
      type: String, // যেমন: "v1.0.0", "v2.0.0"
      required: true,
    },
    title: { type: String, required: true },
    content: { type: String, required: true }, // চুক্তির মূল লেখা/টেমপ্লেট
    isActive: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// ২. ইউজার ও পার্টনারের ডিজিটাল সম্মতির প্রমাণ
const legalConsentEvidenceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      refPath: "userRole",
      required: true,
      index: true,
    },
    authId: {
      type: Schema.Types.ObjectId,
      ref: "Auth",
      required: true,
    },
    userRole: {
      type: String,
      enum: ["User", "Partner", "Admin"],
      required: true,
    },
    documentType: {
      type: String,
      enum: [
        "TERMS_AND_CONDITIONS",
        "PRIVACY_NOTICE",
        "PARTNER_SERVICE_CONTRACT",
      ],
      required: true,
    },
    documentVersion: {
      type: String,
      required: true,
    },
    accepted: {
      type: Boolean,
      default: true,
    },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
    deviceInfo: {
      platform: { type: String }, // iOS, Android, Web
      deviceId: { type: String },
      appVersion: { type: String },
    },
    // পার্টনারদের চুক্তির সময়কার লিগ্যাল ও ট্যাক্স তথ্যের স্ন্যাপশট
    legalTaxSnapshot: {
      legalName: String,
      rfcOrTaxId: String,
      officialAddress: String,
      bankName: String,
      bankAccountNumber: String,
    },
    acceptedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

// ৩. সেন্ট্রাল সিস্টেম ট্রেসেবিলিটি ও অডিট লগ
const systemTraceabilityLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorRole: { type: String, required: true },
    actorEmail: { type: String },
    actionType: {
      type: String,
      enum: [
        "TERMS_ACCEPTED",
        "PRIVACY_ACCEPTED",
        "CONTRACT_ACCEPTED",
        "CONTRACT_UPDATED",
        "TAX_INFO_CHANGED",
        "INVOICE_REQUESTED",
        "CLAIM_SUBMITTED",
        "CLAIM_RESOLVED",
        "SERVICE_CANCELLED",
        "SERVICE_RESUMED",
      ],
      required: true,
      index: true,
    },
    targetEntity: { type: String },
    targetId: { type: Schema.Types.ObjectId },
    ipAddress: { type: String },
    deviceInfo: { type: Schema.Types.Mixed },
    metaData: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

const LegalDocument = model("LegalDocument", legalDocumentSchema);
const LegalConsentEvidence = model(
  "LegalConsentEvidence",
  legalConsentEvidenceSchema,
);
const SystemTraceabilityLog = model(
  "SystemTraceabilityLog",
  systemTraceabilityLogSchema,
);

module.exports = { LegalDocument, LegalConsentEvidence, SystemTraceabilityLog };
