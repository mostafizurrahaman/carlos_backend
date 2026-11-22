// src/helpers/claimStatus.js
// Single source of truth for a service's claimStatus.
const OPEN_CLAIM_STATUSES = ["pending", "in-progress"];

/**
 * Picks the claim that represents the service's dispute state.
 * Open claims (pending first, then in-progress) win over closed ones;
 * otherwise the latest closed claim decides. `claims` must be sorted newest first.
 */
const pickActiveClaim = (claims = []) => {
  if (!claims.length) return null;
  return (
    claims.find((c) => c.status === "pending") ||
    claims.find((c) => c.status === "in-progress") ||
    claims[0]
  );
};

const deriveClaimStatus = (claims = []) => {
  const active = pickActiveClaim(claims);
  return {
    claimStatus: active ? active.status || "pending" : "none",
    activeClaimId: active ? active._id : null,
  };
};

/**
 * Recomputes claimStatus/activeClaimId for a service from its claims and saves it.
 * Required lazily to avoid a circular require between the service and bid models.
 */
const syncServiceClaimStatus = async (serviceId) => {
  const Services = require("../app/modules/services/services.model");
  const { FileClaim } = require("../app/modules/bid/bid.model");

  const claims = await FileClaim.find({ serviceId })
    .sort({ createdAt: -1 })
    .select("status")
    .lean();
  const state = deriveClaimStatus(claims);
  await Services.updateOne({ _id: serviceId }, { $set: state });
  return state;
};

/**
 * Fills claimStatus on already-loaded (lean) service objects whose document
 * has no claimStatus yet (services created before the field existed).
 */
const fillMissingClaimStatus = async (services = []) => {
  const missing = services.filter((s) => s && !s.claimStatus);
  if (!missing.length) return services;

  const { FileClaim } = require("../app/modules/bid/bid.model");
  const claims = await FileClaim.find({
    serviceId: { $in: missing.map((s) => s._id) },
  })
    .sort({ createdAt: -1 })
    .select("status serviceId")
    .lean();

  const byService = new Map();
  for (const c of claims) {
    const key = String(c.serviceId);
    if (!byService.has(key)) byService.set(key, []);
    byService.get(key).push(c);
  }

  for (const s of missing) {
    Object.assign(s, deriveClaimStatus(byService.get(String(s._id)) || []));
  }
  return services;
};

module.exports = {
  OPEN_CLAIM_STATUSES,
  pickActiveClaim,
  deriveClaimStatus,
  syncServiceClaimStatus,
  fillMissingClaimStatus,
};
