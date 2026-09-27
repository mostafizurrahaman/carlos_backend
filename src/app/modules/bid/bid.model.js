const mongoose = require("mongoose");
const { Schema, model } = mongoose;

// 1. Bids Schema
const bidsSchema = new Schema(
  {
    service: {
      type: mongoose.Schema.ObjectId,
      ref: "Services",
    },
    partner: {
      type: mongoose.Schema.ObjectId,
      ref: "Partner",
    },
    serviceType: {
      type: String,
      enum: ["Goods", "Waste", "Second-hand items", "Recyclable materials"],
    },
    price: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["Win", "Outbid", "Pending"],
      default: "Pending",
    },
  },
  {
    timestamps: true,
  },
);

// 2. Review Schema
const reviewSchema = new Schema(
  {
    serviceId: {
      type: mongoose.Schema.ObjectId,
      ref: "Services",
    },
    partnerId: {
      type: mongoose.Schema.ObjectId,
      ref: "Partner",
    },
    userId: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    rating: {
      type: Number,
      default: 0,
    },
    comment: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// 3. Enhanced File Claim Schema (Features 10 & 11)
const fileClaimSchema = new Schema(
  {
    serviceId: {
      type: mongoose.Schema.ObjectId,
      ref: "Services",
      required: true,
    },
    user: {
      type: mongoose.Schema.ObjectId,
      refPath: "userType",
      required: true,
    },
    userType: {
      type: String,
      enum: ["User", "Partner"],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    orderId: {
      type: String,
      required: true,
    },
    // Specific claim types (damages, cancellations, price disputes, etc.)
    claimType: {
      type: String,
      enum: [
        "SERVICE_NON_COMPLIANCE",
        "DAMAGES",
        "CANCELLATION_ISSUE",
        "PRICE_DISCREPANCY",
        "LOCATION_PROBLEM",
        "LACK_OF_RESPONSE",
        "DELIVERY_PROBLEM",
        "OTHER",
      ],
      required: true,
      default: "OTHER",
    },
    // Flag to indicate if the claim was filed during an active service
    isDuringActiveService: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      required: true,
    },
    fileClaimImage: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "in-progress", "resolved", "rejected"],
      default: "pending",
    },
    // Internal admin review notes
    adminNotes: [
      {
        adminId: { type: mongoose.Schema.ObjectId, ref: "Admin" },
        note: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // Final claim decision & resolution outcome
    finalDecision: {
      resolutionType: {
        type: String,
        enum: ["REFUND", "PENALTY_APPLIED", "NO_ACTION", "DISMISSED"],
      },
      decisionNotes: String,
      penaltyOrRefundAmount: Number,
      resolvedAt: Date,
      resolvedBy: { type: mongoose.Schema.ObjectId, ref: "Admin" },
    },
  },
  {
    timestamps: true,
  },
);

const FileClaim = model("FileClaim", fileClaimSchema);
const Review = model("Review", reviewSchema);
const Bids = model("Bids", bidsSchema);

module.exports = { Review, Bids, FileClaim };
