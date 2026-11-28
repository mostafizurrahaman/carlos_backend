// src/helpers/calculateCategoryMarkup.js
const Category = require("../app/modules/category/category.model");
const Variable = require("../app/modules/variable/variable.model");

/**
 * Currency: basePrice / winBid / bid prices are stored in USD. Convert to MXN
 * only when charging Stripe in MXN (see payment.service createCheckoutSessionStripe).
 *
 * Markup (surcharge) rule. Every screen and the Stripe charge use this file,
 * so the Offers price, the Payment price and the charged amount always match.
 *
 * Rule is set by the admin on the Variable document:
 *   markupSource: "category" -> Category Management markup
 *                              (falls back to Variable % if the category has none set)
 *                 "variable" -> Variable Management surcharge %
 *                 "higher"   -> whichever of the two gives the larger amount
 *   markupScope:  "all"      -> move (freight) and sell categories
 *                 "freight"  -> only move/freight categories; sell gets no markup
 */
const DEFAULT_SOURCE = "category";
const DEFAULT_SCOPE = "all";

const getPricingConfig = async () => {
  const v = await Variable.findOne()
    .select("surcharge markupSource markupScope")
    .lean();
  return {
    surchargePercent: Number(v?.surcharge || 0),
    markupSource: v?.markupSource || DEFAULT_SOURCE,
    markupScope: v?.markupScope || DEFAULT_SCOPE,
  };
};

const categoryMarkupAmount = (categoryDoc, numBase) => {
  const {
    markupType = "percentage",
    markupValue = 0,
    markupFormula = null,
  } = categoryDoc;

  if (markupType === "fixed") return Number(markupValue || 0);
  if (markupType === "percentage") return (numBase * Number(markupValue || 0)) / 100;
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

const hasCategoryMarkup = (categoryDoc) =>
  !!categoryDoc &&
  categoryDoc.markupValue !== undefined &&
  categoryDoc.markupValue !== null;

/**
 * Markup amount for a base price.
 * @param {ObjectId|string} categoryId
 * @param {number} basePrice  partner bid / winBid (the raw amount)
 * @param {"move"|"sell"} [mainService] used for the "freight" scope when the
 *        category is missing; otherwise the category's own serviceType is used.
 */
const calculateCategoryMarkup = async (categoryId, basePrice, mainService) => {
  const numBase = Number(basePrice) || 0;
  const config = await getPricingConfig();
  const categoryDoc = categoryId ? await Category.findById(categoryId).lean() : null;

  const serviceType = categoryDoc?.serviceType || mainService;
  if (config.markupScope === "freight" && serviceType === "sell") {
    return 0;
  }

  const variableAmount = (numBase * config.surchargePercent) / 100;
  const categoryAmount = hasCategoryMarkup(categoryDoc)
    ? categoryMarkupAmount(categoryDoc, numBase)
    : null;

  let amount;
  if (config.markupSource === "variable") {
    amount = variableAmount;
  } else if (config.markupSource === "higher") {
    amount = Math.max(variableAmount, categoryAmount ?? 0);
  } else {
    amount = categoryAmount ?? variableAmount;
  }
  return Math.round(amount * 100) / 100;
};

const getServiceCategoryId = (service) => {
  const c = Array.isArray(service?.category) ? service.category[0] : service?.category;
  return c?._id || c || null;
};

/**
 * Final price shown to the customer (USER) for a base price:
 *   move -> base + markup (customer pays the platform surcharge)
 *   sell -> base - markup (platform keeps a commission from the seller)
 */
const getUserFacingPrice = async (service, basePrice) => {
  if (basePrice === null || basePrice === undefined || basePrice === "") return basePrice;
  const markup = await calculateCategoryMarkup(
    getServiceCategoryId(service),
    basePrice,
    service?.mainService,
  );
  const base = Number(basePrice);
  const final = service?.mainService === "sell" ? base - markup : base + markup;
  return Math.round(final * 100) / 100;
};

module.exports = {
  calculateCategoryMarkup,
  getUserFacingPrice,
  getServiceCategoryId,
  getPricingConfig,
};
