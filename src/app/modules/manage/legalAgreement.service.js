const httpStatus = require("http-status");
const ApiError = require("../../../errors/ApiError");
const Partner = require("../partner/partner.model");
const User = require("../user/user.model");
const {
  LegalDocument,
  LegalConsentEvidence,
} = require("./legalAgreement.model");
const { recordTraceability } = require("../../../helpers/traceabilityLogger");

/**
 * 1. Record legal consent evidence (Terms, Privacy Policy, Partner Contract)
 * Captures IP, user-agent, device metadata, and a snapshot of partner tax/legal info.
 */
const acceptLegalAgreement = async (req) => {
  const { documentType, documentVersion, deviceInfo } = req.body;
  const { userId, authId, role, emailAuth } = req.user;

  // Extract client IP and user-agent metadata
  const ipAddress =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
  const userAgent = req.headers["user-agent"] || "unknown";

  if (!documentType || !documentVersion) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "documentType and documentVersion are required",
    );
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

  // Save digital evidence
  const evidence = await LegalConsentEvidence.create({
    userId,
    authId,
    userRole: userModelType,
    documentType,
    documentVersion,
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
      documentType === "TERMS_AND_CONDITIONS"
        ? "TERMS_ACCEPTED"
        : documentType === "PRIVACY_NOTICE"
          ? "PRIVACY_ACCEPTED"
          : "CONTRACT_ACCEPTED",
    targetEntity: "LegalConsentEvidence",
    targetId: evidence._id,
    ipAddress,
    deviceInfo,
    metaData: { version: documentVersion },
  });

  return evidence;
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
  const doc = await LegalDocument.findOne({ type, isActive: true }).sort({
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
  const { type, version, title, content } = req.body;
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
  // 1. Fetch latest active versions of required documents
  const [activeTerms, activePrivacy, activeContract] = await Promise.all([
    LegalDocument.findOne({ type: "TERMS_AND_CONDITIONS", isActive: true })
      .select("version")
      .lean(),
    LegalDocument.findOne({ type: "PRIVACY_NOTICE", isActive: true })
      .select("version")
      .lean(),
    userRole === "PARTNER"
      ? LegalDocument.findOne({
          type: "PARTNER_SERVICE_CONTRACT",
          isActive: true,
        })
          .select("version")
          .lean()
      : Promise.resolve(null),
  ]);

  // 2. Fetch all consent evidence previously recorded for this user
  const acceptedEvidence = await LegalConsentEvidence.find({
    userId,
    accepted: true,
  })
    .select("documentType documentVersion")
    .lean();

  const acceptedMap = new Set(
    acceptedEvidence.map((e) => `${e.documentType}_${e.documentVersion}`),
  );

  const missingDocuments = [];

  // Check Terms and Conditions
  if (
    activeTerms &&
    !acceptedMap.has(`TERMS_AND_CONDITIONS_${activeTerms.version}`)
  ) {
    missingDocuments.push({
      type: "TERMS_AND_CONDITIONS",
      requiredVersion: activeTerms.version,
    });
  }

  // Check Privacy Notice
  if (
    activePrivacy &&
    !acceptedMap.has(`PRIVACY_NOTICE_${activePrivacy.version}`)
  ) {
    missingDocuments.push({
      type: "PRIVACY_NOTICE",
      requiredVersion: activePrivacy.version,
    });
  }

  // Check Partner Service Contract (Only for Partners)
  if (
    userRole === "PARTNER" &&
    activeContract &&
    !acceptedMap.has(`PARTNER_SERVICE_CONTRACT_${activeContract.version}`)
  ) {
    missingDocuments.push({
      type: "PARTNER_SERVICE_CONTRACT",
      requiredVersion: activeContract.version,
    });
  }

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
