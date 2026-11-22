const httpStatus = require("http-status");
const ApiError = require("../../../errors/ApiError");
const Partner = require("../partner/partner.model");
const User = require("../user/user.model");
const {
  LegalDocument,
  LegalConsentEvidence,
} = require("./legalAgreement.model");
const { recordTraceability } = require("../../../helpers/traceabilityLogger");

const DOC_TYPES = [
  "TERMS_AND_CONDITIONS",
  "PRIVACY_NOTICE",
  "PARTNER_SERVICE_CONTRACT",
];

const DOC_TYPE_ALIASES = {
  terms_of_service: "TERMS_AND_CONDITIONS",
  "terms-of-service": "TERMS_AND_CONDITIONS",
  terms: "TERMS_AND_CONDITIONS",
  terms_and_conditions: "TERMS_AND_CONDITIONS",
  "terms-and-conditions": "TERMS_AND_CONDITIONS",
  privacy_policy: "PRIVACY_NOTICE",
  "privacy-policy": "PRIVACY_NOTICE",
  privacy: "PRIVACY_NOTICE",
  privacy_notice: "PRIVACY_NOTICE",
  "privacy-notice": "PRIVACY_NOTICE",
  partner_agreement: "PARTNER_SERVICE_CONTRACT",
  "partner-agreement": "PARTNER_SERVICE_CONTRACT",
  partner_service_contract: "PARTNER_SERVICE_CONTRACT",
  "partner-service-contract": "PARTNER_SERVICE_CONTRACT",
  contract: "PARTNER_SERVICE_CONTRACT",
};

const normalizeDocType = (type) => {
  if (!type || typeof type !== "string") return type;
  const key = type.trim().toLowerCase();
  return DOC_TYPE_ALIASES[key] || type.trim().toUpperCase();
};

// "v1.0.0", "1.0" and "1" are the same version
const normalizeVersion = (version) => {
  let v = String(version ?? "").trim().toLowerCase().replace(/^v/, "");
  while (/\.0+$/.test(v)) v = v.replace(/\.0+$/, "");
  return v;
};

const getActiveDocs = async (role) => {
  const types =
    role === "PARTNER"
      ? DOC_TYPES
      : DOC_TYPES.filter((t) => t !== "PARTNER_SERVICE_CONTRACT");
  const docs = await Promise.all(
    types.map((type) =>
      LegalDocument.findOne({ type, isActive: true })
        .sort({ createdAt: -1 })
        .select("type version")
        .lean(),
    ),
  );
  return docs.filter(Boolean);
};

/**
 * 1. Record legal consent evidence (Terms, Privacy Policy, Partner Contract)
 * Captures IP, user-agent, device metadata, and a snapshot of partner tax/legal info.
 *
 * Body: { documentType?, documentTypes?, documentVersion?, deviceInfo? }
 * - documentType / documentTypes: which documents are accepted. If neither is sent,
 *   every document the caller still has to accept is accepted.
 * - documentVersion: optional; when omitted (or equal to the active one) the active
 *   version is recorded, so the consent status turns false right away.
 */
const acceptLegalAgreement = async (req) => {
  const { documentType, documentTypes, documentVersion, deviceInfo } = req.body || {};
  const { userId, authId, role, emailAuth } = req.user;

  // Extract client IP and user-agent metadata
  const ipAddress =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
  const userAgent = req.headers["user-agent"] || "unknown";

  let requestedTypes = [];
  if (Array.isArray(documentTypes) && documentTypes.length) {
    requestedTypes = documentTypes.map(normalizeDocType);
  } else if (documentType) {
    requestedTypes = [normalizeDocType(documentType)];
  }

  const invalid = requestedTypes.filter((t) => !DOC_TYPES.includes(t));
  if (invalid.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Unknown document type: ${invalid.join(", ")}`,
    );
  }

  const activeDocs = await getActiveDocs(role);
  const activeByType = new Map(activeDocs.map((d) => [d.type, d]));

  if (!requestedTypes.length) {
    const status = await checkLegalConsentStatus(userId, role);
    requestedTypes = status.missingDocuments.map((d) => d.type);
    if (!requestedTypes.length) {
      return { needLegalConsent: false, accepted: [] };
    }
  }

  let legalTaxSnapshot = null;
  let userModelType = "User";

  // If partner, capture a snapshot of current legal, tax, and banking details
  if (role === "PARTNER") {
    userModelType = "Partner";
    const partner = await Partner.findById(userId);
    if (!partner) throw new ApiError(httpStatus.NOT_FOUND, "Partner not found");

    legalTaxSnapshot = {
      legalName: partner.name,
      rfcOrTaxId: partner.exterior_number || "N/A",
      officialAddress:
        `${partner.street || ""} ${partner.neighborhood || ""} ${partner.city || ""}`.trim(),
      bankName: partner.bank_name || "N/A",
      bankAccountNumber: partner.bank_account_number || "N/A",
    };
  }

  const evidences = [];
  for (const type of requestedTypes) {
    const active = activeByType.get(type);
    // Record the active version unless the app explicitly accepted a different one
    let versionToRecord = active?.version;
    if (
      documentVersion &&
      (!active || normalizeVersion(documentVersion) !== normalizeVersion(active.version))
    ) {
      versionToRecord = String(documentVersion);
    }
    if (!versionToRecord) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `There is no active ${type} document to accept.`,
      );
    }

    // Save digital evidence
    const evidence = await LegalConsentEvidence.create({
      userId,
      authId,
      userRole: userModelType,
      documentType: type,
      documentVersion: versionToRecord,
      accepted: true,
      ipAddress,
      userAgent,
      deviceInfo,
      legalTaxSnapshot,
    });

    // Record audit traceability log
    await recordTraceability({
      actorId: userId,
      actorRole: role,
      actorEmail: emailAuth,
      actionType:
        type === "TERMS_AND_CONDITIONS"
          ? "TERMS_ACCEPTED"
          : type === "PRIVACY_NOTICE"
            ? "PRIVACY_ACCEPTED"
            : "CONTRACT_ACCEPTED",
      targetEntity: "LegalConsentEvidence",
      targetId: evidence._id,
      ipAddress,
      deviceInfo,
      metaData: { version: versionToRecord, clientVersion: documentVersion || null },
    });

    evidences.push(evidence);
  }

  // Single document keeps the old response shape (the evidence record)
  return evidences.length === 1 ? evidences[0] : evidences;
};

/**
 * 2. Generate dynamic partner contract preview
 * Injects actual partner legal & banking data into contract template placeholders.
 */
const getPartnerContractPreview = async (userId) => {
  const partner = await Partner.findById(userId);
  if (!partner) throw new ApiError(404, "Partner not found");

  // Retrieve the latest active partner contract template
  const latestContract = await LegalDocument.findOne({
    type: "PARTNER_SERVICE_CONTRACT",
    isActive: true,
  }).sort({ createdAt: -1 });

  if (!latestContract) {
    throw new ApiError(404, "Active partner contract template not found");
  }

  // Replace placeholders with real partner data
  let compiledText = latestContract.content
    .replace(/\{\{PARTNER_NAME\}\}/g, partner.name || "N/A")
    .replace(/\{\{PARTNER_EMAIL\}\}/g, partner.email || "N/A")
    .replace(/\{\{PARTNER_PHONE\}\}/g, partner.phone_number || "N/A")
    .replace(
      /\{\{PARTNER_ADDRESS\}\}/g,
      `${partner.street || ""} ${partner.city || ""}, ${partner.country || ""}`.trim(),
    )
    .replace(/\{\{BANK_NAME\}\}/g, partner.bank_name || "N/A")
    .replace(/\{\{BANK_ACCOUNT\}\}/g, partner.bank_account_number || "N/A");

  return {
    version: latestContract.version,
    contractText: compiledText,
    partnerDetails: partner,
  };
};

/**
 * 3. Fetch current active legal document by type (Terms, Privacy, Contract)
 */
const getActiveDocument = async (type) => {
  const normalizedType = normalizeDocType(type);

  const doc = await LegalDocument.findOne({
    type: normalizedType,
    isActive: true,
  }).sort({
    createdAt: -1,
  });
  if (!doc) {
    throw new ApiError(404, `Active document for ${type} not found`);
  }
  return doc;
};

/**
 * 4. Admin API to publish a new version of Terms, Privacy, or Partner Contract
 */
const createLegalDocument = async (req) => {
  const { version, title, content } = req.body;
  const type = normalizeDocType(req.body.type);
  const { userId, emailAuth } = req.user;

  if (!type || !version || !content || !title) {
    throw new ApiError(
      400,
      "type, version, title, and content are required fields",
    );
  }

  // Deactivate previous versions of this document type
  await LegalDocument.updateMany({ type }, { isActive: false });

  // Create new active version
  const newDoc = await LegalDocument.create({
    type,
    version,
    title,
    content,
    isActive: true,
  });

  // Log version update in traceability audit log
  await recordTraceability({
    actorId: userId,
    actorRole: "Admin",
    actorEmail: emailAuth,
    actionType: "CONTRACT_UPDATED",
    targetEntity: "LegalDocument",
    targetId: newDoc._id,
    metaData: { type, version },
  });

  return newDoc;
};

/**
 * 5. Check whether the user/partner has accepted the latest active legal documents
 * Returns boolean flags and details of pending documents to accept.
 */
const checkLegalConsentStatus = async (userId, userRole) => {
  // 1. Latest active version of each required document
  const activeDocs = await getActiveDocs(userRole);

  // 2. Everything this user accepted before (type/version compared loosely)
  const acceptedEvidence = await LegalConsentEvidence.find({
    userId,
    accepted: true,
  })
    .select("documentType documentVersion")
    .lean();

  const acceptedSet = new Set(
    acceptedEvidence.map(
      (e) => `${normalizeDocType(e.documentType)}_${normalizeVersion(e.documentVersion)}`,
    ),
  );

  // 3. Consent is needed only for an active version the user has not accepted yet
  const missingDocuments = activeDocs
    .filter((doc) => !acceptedSet.has(`${doc.type}_${normalizeVersion(doc.version)}`))
    .map((doc) => ({ type: doc.type, requiredVersion: doc.version }));

  return {
    needLegalConsent: missingDocuments.length > 0,
    missingDocuments,
  };
};

/**
 * 6. Get all legal consent evidence records (with filter, search, pagination)
 */
const getLegalConsentEvidence = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const filter = {};
  if (query.documentType && query.documentType !== "all") {
    filter.documentType = query.documentType;
  }
  if (query.userRole && query.userRole !== "all") {
    filter.userRole = query.userRole;
  }
  if (query.version) {
    filter.documentVersion = query.version;
  }

  const [data, total] = await Promise.all([
    LegalConsentEvidence.find(filter)
      .populate({
        path: "userId",
        select: "name email phone_number profile_image",
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LegalConsentEvidence.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total },
    data,
  };
};

/**
 * 7. Get system traceability and audit logs (with filters & pagination)
 */
const getSystemTraceabilityLogs = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 15;
  const skip = (page - 1) * limit;

  const filter = {};
  if (query.actionType && query.actionType !== "all") {
    filter.actionType = query.actionType;
  }
  if (query.actorRole && query.actorRole !== "all") {
    filter.actorRole = query.actorRole;
  }
  if (query.startDate && query.endDate) {
    filter.createdAt = {
      $gte: new Date(query.startDate),
      $lte: new Date(query.endDate),
    };
  }

  const [data, total] = await Promise.all([
    SystemTraceabilityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SystemTraceabilityLog.countDocuments(filter),
  ]);

  return {
    meta: { page, limit, total },
    data,
  };
};

/**
 * 8. Get legal documents version history
 */
const getLegalDocumentsHistory = async (type) => {
  const filter = type ? { type } : {};
  const documents = await LegalDocument.find(filter)
    .sort({ createdAt: -1 })
    .lean();
  return documents;
};

module.exports = {
  acceptLegalAgreement,
  getPartnerContractPreview,
  getActiveDocument,
  createLegalDocument,
  checkLegalConsentStatus,
  getLegalConsentEvidence,
  getSystemTraceabilityLogs,
  getLegalDocumentsHistory,
};
