const catchAsync = require("../../../shared/catchasync");
const sendResponse = require("../../../shared/sendResponse");
const LegalAgreementService = require("./legalAgreement.service");

// Accept terms, privacy policy, or partner contract with digital evidence
const acceptLegalAgreement = catchAsync(async (req, res) => {
  const result = await LegalAgreementService.acceptLegalAgreement(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Legal agreement accepted successfully",
    data: result,
  });
});

// Get personalized dynamic contract preview for partner
const getPartnerContractPreview = catchAsync(async (req, res) => {
  const { userId } = req.user;
  const result = await LegalAgreementService.getPartnerContractPreview(userId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Partner contract preview retrieved successfully",
    data: result,
  });
});

// Get latest active document (Terms / Privacy / Partner Contract)
const getActiveDocument = catchAsync(async (req, res) => {
  const { type } = req.params;
  const result = await LegalAgreementService.getActiveDocument(type);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Active legal document retrieved successfully",
    data: result,
  });
});

// Admin endpoint to publish new version of legal documents
const createLegalDocument = catchAsync(async (req, res) => {
  const result = await LegalAgreementService.createLegalDocument(req);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "New legal document version published successfully",
    data: result,
  });
});

// Check current user's legal agreement acceptance status
const getMyConsentStatus = catchAsync(async (req, res) => {
  const { userId, role } = req.user;
  const result = await LegalAgreementService.checkLegalConsentStatus(
    userId,
    role,
  );
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Legal consent status retrieved successfully",
    data: result,
  });
});

// Admin endpoint to view digital legal consent evidence
const getLegalConsentEvidence = catchAsync(async (req, res) => {
  const result = await LegalAgreementService.getLegalConsentEvidence(req.query);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Legal consent evidence records retrieved successfully",
    data: result,
  });
});

// Admin endpoint to view system traceability audit logs
const getSystemTraceabilityLogs = catchAsync(async (req, res) => {
  const result = await LegalAgreementService.getSystemTraceabilityLogs(
    req.query,
  );
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "System traceability logs retrieved successfully",
    data: result,
  });
});

// Admin endpoint to view legal document versions history
const getLegalDocumentsHistory = catchAsync(async (req, res) => {
  const { type } = req.query;
  const result = await LegalAgreementService.getLegalDocumentsHistory(type);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Legal documents history retrieved successfully",
    data: result,
  });
});

const LegalAgreementController = {
  acceptLegalAgreement,
  getPartnerContractPreview,
  getActiveDocument,
  createLegalDocument,
  getMyConsentStatus,
  getLegalConsentEvidence,
  getSystemTraceabilityLogs,
  getLegalDocumentsHistory,
};

module.exports = { LegalAgreementController };
