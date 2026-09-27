const { model, Schema } = require("mongoose");

const categorySchema = new Schema(
  {
    serviceType: {
      type: String,
      enum: ["move", "sell"],
      required: [true, "Service type is required"],
    },
    subServiceType: {
      type: String,
      enum: ["Goods", "Waste", "Second-hand items", "Recyclable materials"],
      required: [true, "subServiceType is required"],
    },
    category: {
      type: String,
      required: true,
    },
    category_spain: {
      type: String,
      required: true,
    },

    // ============================================
    // Category-Specific Independent Markup (Feature 7)
    // ============================================
    markupType: {
      type: String,
      enum: ["percentage", "fixed", "formula"],
      default: "percentage",
    },
    markupValue: {
      type: Number,
      default: 0, // e.g., 10 for 10% or 25 for flat $25
    },
    markupFormula: {
      type: String, // e.g., "basePrice * 0.12 + 5"
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const Category = model("Category", categorySchema);

module.exports = Category;
