const express = require("express");
const auth = require("../../middlewares/auth");
const { ENUM_USER_ROLE, ENUM_ADMIN_ACCESS } = require("../../../utils/enums");
const { LegalAgreementController } = require("./legalAgreement.controller");
const checkAdminAccess = require("../../middlewares/checkAdminAccess");

const router = express.Router();

// 1. Submit acceptance evidence for Terms, Privacy Policy, or Partner Contract
router.post(
  "/accept",
  auth(ENUM_USER_ROLE.USER, ENUM_USER_ROLE.PARTNER, ENUM_USER_ROLE.ADMIN),
  LegalAgreementController.acceptLegalAgreement,
);

// 2. Get dynamic contract preview with partner legal & tax data populated
router.get(
  "/partner-contract/preview",
  auth(ENUM_USER_ROLE.PARTNER),
  LegalAgreementController.getPartnerContractPreview,
);

// 3. Fetch active document by type (TERMS_AND_CONDITIONS, PRIVACY_NOTICE, PARTNER_SERVICE_CONTRACT)
router.get("/active/:type", LegalAgreementController.getActiveDocument);

// 4. Admin endpoint to create and publish a new version of legal documents
router.post(
  "/publish",
  auth(ENUM_USER_ROLE.ADMIN, ENUM_USER_ROLE.SUPER_ADMIN),
  checkAdminAccess(ENUM_ADMIN_ACCESS.ACC_TO_SETTINGS_EDIT),
  LegalAgreementController.createLegalDocument,
);

// Check if user has accepted the latest terms/privacy/contract
router.get(
  "/my-consent-status",
  auth(ENUM_USER_ROLE.USER, ENUM_USER_ROLE.PARTNER),
  LegalAgreementController.getMyConsentStatus,
);

// 5. Admin endpoint to view digital legal consent evidence records
router.get(
  "/evidence",
  auth(ENUM_USER_ROLE.ADMIN, ENUM_USER_ROLE.SUPER_ADMIN),
  LegalAgreementController.getLegalConsentEvidence,
);

// 6. Admin endpoint to view system traceability audit logs
router.get(
  "/traceability",
  auth(ENUM_USER_ROLE.ADMIN, ENUM_USER_ROLE.SUPER_ADMIN),
  LegalAgreementController.getSystemTraceabilityLogs,
);

// 7. Admin endpoint to view legal documents version history
router.get(
  "/documents/history",
  auth(ENUM_USER_ROLE.ADMIN, ENUM_USER_ROLE.SUPER_ADMIN),
  LegalAgreementController.getLegalDocumentsHistory,
);

module.exports = router;
