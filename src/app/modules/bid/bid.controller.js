const catchAsync = require("../../../shared/catchasync");
const sendResponse = require("../../../shared/sendResponse");
const { BidService } = require("./bid.services");

const partnerBidPost = catchAsync(async (req, res) => {
  const result = await BidService.partnerBidPost(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Bids successfully",
    data: result,
  });
});

const partnerAllBids = catchAsync(async (req, res) => {
  const result = await BidService.partnerAllBids(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "All bids get successfully",
    data: result,
  });
});

const filterBidsByMove = catchAsync(async (req, res) => {
  const result = await BidService.filterBidsByMove(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Get successfully",
    data: result,
  });
});

const filterBidsByHistory = catchAsync(async (req, res) => {
  const result = await BidService.filterBidsByHistory(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Get successfully",
    data: result,
  });
});

const getBitProfilePartner = catchAsync(async (req, res) => {
  const result = await BidService.getBitProfilePartner(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Get review successfully",
    data: result,
  });
});

// Partner ratings & performance summary (Feature 8)
const getPartnerRatingsSummary = catchAsync(async (req, res) => {
  const { partnerId } = req.params;
  const result = await BidService.getPartnerRatingsSummary(partnerId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Partner ratings summary retrieved successfully",
    data: result,
  });
});

const postReviewMove = catchAsync(async (req, res) => {
  const result = await BidService.postReviewMove(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Review successfully",
    data: result,
  });
});

const getPartnerReviews = catchAsync(async (req, res) => {
  const result = await BidService.getPartnerReviews(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Review successfully",
    data: result,
  });
});

const orderDetailsPageFileClaim = catchAsync(async (req, res) => {
  const result = await BidService.orderDetailsPageFileClaim(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Get successfully",
    data: result,
  });
});

const createFileClaim = catchAsync(async (req, res) => {
  const result = await BidService.createFileClaim(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "File claim submitted successfully",
    data: result,
  });
});

// Admin adds internal review note to a claim (Feature 11)
const addAdminClaimNote = catchAsync(async (req, res) => {
  const { claimId } = req.params;
  const { note } = req.body;
  const result = await BidService.addAdminClaimNote(claimId, note, req.user);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin claim note added successfully",
    data: result,
  });
});

// Admin resolves a claim with a final decision (Feature 11)
const resolveAdminClaim = catchAsync(async (req, res) => {
  const result = await BidService.resolveAdminClaim(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Claim resolved and decision recorded successfully",
    data: result,
  });
});

const updateStatusFileClaim = catchAsync(async (req, res) => {
  const result = await BidService.updateStatusFileClaim(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "File claim status updated successfully",
    data: result,
  });
});

const applyPenaltyPercent = catchAsync(async (req, res) => {
  const result = await BidService.applyPenaltyPercent(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Penalty applied successfully!",
    data: result,
  });
});

const statusServicesDetails = catchAsync(async (req, res) => {
  const result = await BidService.statusServicesDetails(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Get successfully!",
    data: result,
  });
});

const getAllFileClaims = catchAsync(async (req, res) => {
  const result = await BidService.getAllFileClaims(req);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Get successfully!",
    data: result,
  });
});

const BidController = {
  partnerBidPost,
  partnerAllBids,
  filterBidsByMove,
  filterBidsByHistory,
  postReviewMove,
  getPartnerReviews,
  getPartnerRatingsSummary,
  getBitProfilePartner,
  orderDetailsPageFileClaim,
  createFileClaim,
  addAdminClaimNote,
  resolveAdminClaim,
  updateStatusFileClaim,
  applyPenaltyPercent,
  statusServicesDetails,
  getAllFileClaims,
};

module.exports = { BidController };
