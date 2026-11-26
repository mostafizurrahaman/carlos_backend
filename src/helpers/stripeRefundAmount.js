// src/helpers/stripeRefundAmount.js
const config = require("../config");
const ApiError = require("../errors/ApiError");
const stripe = require("stripe")(config.stripe.stripe_secret_key);

/**
 * Converts a refund amount in USD (the unit of winBid, Transaction.amount and
 * claim decisions) into the smallest unit of the currency the PaymentIntent was
 * actually charged in (MXN centavos or USD cents).
 *
 * For a non-USD charge the ratio refund / amount paid (both USD) is applied to
 * the charged amount, so the exchange rate used at payment time is kept and a
 * full refund returns exactly what was charged.
 *
 * @param {string} paymentIntentId
 * @param {number} amountUsd  amount to refund, in USD
 * @param {number} paidUsd    Transaction.amount of the original payment, in USD
 * @returns {Promise<number>} amount for stripe.refunds.create, in the charge currency's smallest unit
 */
const getStripeRefundUnits = async ({ paymentIntentId, amountUsd, paidUsd }) => {
  const refundUsd = Number(amountUsd);
  if (!(refundUsd > 0)) {
    throw new ApiError(400, "Refund amount must be greater than zero");
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const received = Number(intent.amount_received || 0);
  const alreadyRefunded = Number(intent.latest_charge?.amount_refunded || 0);
  const refundable = received - alreadyRefunded;
  if (!(refundable > 0)) {
    throw new ApiError(400, "This payment has already been fully refunded");
  }

  let units;
  if (intent.currency === "usd") {
    units = Math.round(refundUsd * 100);
  } else {
    const paid = Number(paidUsd);
    if (!(paid > 0)) {
      throw new ApiError(400, "Original payment amount is missing");
    }
    // Within a cent of the amount paid counts as a full refund
    units =
      Math.abs(refundUsd - paid) < 0.01
        ? received
        : Math.round((refundUsd / paid) * received);
  }

  // Allow 1 unit of rounding slack, then never ask Stripe for more than is left
  if (units > refundable + 1) {
    throw new ApiError(
      400,
      alreadyRefunded > 0
        ? "Refund amount is more than the amount left to refund"
        : "Refund amount is more than the amount paid",
    );
  }
  return Math.min(units, refundable);
};

module.exports = { getStripeRefundUnits };
