// src/helpers/calculateCategoryMarkup.js
const Category = require("../app/modules/category/category.model");
const Variable = require("../app/modules/variable/variable.model");

/**
 * Calculates effective markup amount for a given category and base price.
 * Supports:
 * 1. percentage (e.g., 10% of basePrice)
 * 2. fixed (e.g., flat $15 markup)
 * 3. formula (e.g., "basePrice * 0.12 + 5")
 * Falls back to global Variable surcharge if no category-specific markup exists.
 */
const calculateCategoryMarkup = async (categoryId, basePrice) => {
  const numBase = Number(basePrice) || 0;

  // If no categoryId is provided, fallback to global variable surcharge
  if (!categoryId) {
    const globalVar = await Variable.findOne().lean();
    const globalSurcharge = Number(globalVar?.surcharge || 0);
    return (numBase * globalSurcharge) / 100;
  }

  const categoryDoc = await Category.findById(categoryId).lean();

  // If category has no custom markup configured, fallback to global surcharge
  if (
    !categoryDoc ||
    categoryDoc.markupValue === undefined ||
    categoryDoc.markupValue === null
  ) {
    const globalVar = await Variable.findOne().lean();
    const globalSurcharge = Number(globalVar?.surcharge || 0);
    return (numBase * globalSurcharge) / 100;
  }

  const {
    markupType = "percentage",
    markupValue = 0,
    markupFormula = null,
  } = categoryDoc;

  // 1. Fixed Markup (e.g., flat $20)
  if (markupType === "fixed") {
    return Number(markupValue || 0);
  }

  // 2. Percentage Markup (e.g., 15%)
  if (markupType === "percentage") {
    return (numBase * Number(markupValue || 0)) / 100;
  }

  // 3. Formula Markup (e.g., "basePrice * 0.08 + 10")
  if (markupType === "formula" && markupFormula) {
    try {
      const sanitizedFormula = markupFormula.replace(/basePrice/g, numBase);
      const computed = Function(`"use strict"; return (${sanitizedFormula})`)();
      return isNaN(computed) ? 0 : Number(computed);
    } catch (err) {
      console.error("[Formula Evaluation Error]:", err.message);
      return (numBase * Number(markupValue || 0)) / 100;
    }
  }

  return 0;
};

module.exports = { calculateCategoryMarkup };
