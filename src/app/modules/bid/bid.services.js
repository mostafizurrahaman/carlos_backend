const { default: mongoose } = require("mongoose");
const ApiError = require("../../../errors/ApiError");
const Partner = require("../partner/partner.model");
const Services = require("../services/services.model");
const VariableCount = require("../variable/variable.count");
const { Review, Bids, FileClaim } = require("./bid.model");
const { Transaction, StripeAccount } = require("../payment/payment.model");
const User = require("../user/user.model");
const { NotificationService } = require("../notification/notification.service");
const QueryBuilder = require("../../../builder/queryBuilder");
const httpStatus = require("http-status");
const {
  LogsDashboardService,
} = require("../logs-dashboard/logsdashboard.service");
const Notification = require("../notification/notification.model");
const { ENUM_USER_ROLE } = require("../../../utils/enums");
const Variable = require("../variable/variable.model");
const config = require("../../../config");
const stripe = require("stripe")(config.stripe.stripe_secret_key);
const {
  calculateCategoryMarkup,
  getUserFacingPrice,
} = require("../../../helpers/calculateCategoryMarkup");
const { recordTraceability } = require("../../../helpers/traceabilityLogger");
const { getStripeRefundUnits } = require("../../../helpers/stripeRefundAmount");
const {
  OPEN_CLAIM_STATUSES,
  syncServiceClaimStatus,
  fillMissingClaimStatus,
} = require("../../../helpers/claimStatus");

// =======================================================
// Claim helpers: parties and notifications
// =======================================================
const claimRef = (serviceId) => `#${String(serviceId).slice(-6)}`;

// Older claims have no filedByRole; derive it from userType.
const getFiledByRole = (claim) =>
  claim.filedByRole || (claim.userType === "Partner" ? "PARTNER" : "USER");

const getClaimParties = (service) => ({
  USER: service?.user ? { id: service.user._id || service.user, type: "User" } : null,
  PARTNER: service?.confirmedPartner
    ? { id: service.confirmedPartner._id || service.confirmedPartner, type: "Partner" }
    : null,
});

const notifyClaimRecipient = (recipient, { types, serviceId, title, message }) => {
  if (!recipient?.id) return null;
  return NotificationService.sendNotification({
    title,
    message,
    user: recipient.id,
    userType: recipient.type,
    types,
    // The app reads getId first; both carry the SERVICE id, never the claim id.
    getId: serviceId,
    serviceId,
  });
};

const notifyAdminsAboutClaim = ({ title, message, serviceId }) =>
  Notification.create({
    title,
    message,
    userType: "Admin",
    types: "claim",
    admin: true,
    getId: serviceId,
    serviceId,
  }).catch((err) => console.error("[Claim admin notification]", err.message));

const CLAIM_STATUS_TEXT = {
  "in-progress": {
    types: "claim_in_progress",
    title: { eng: "Claim Under Review", span: "Reclamación en Revisión" },
    eng: (ref) => `The claim for Service ${ref} is now under review by our team.`,
    span: (ref) => `La reclamación del Servicio ${ref} está siendo revisada por nuestro equipo.`,
  },
  resolved: {
    types: "claim_resolved",
    title: { eng: "Claim Resolved", span: "Reclamación Resuelta" },
    eng: (ref) => `The claim for Service ${ref} has been resolved.`,
    span: (ref) => `La reclamación del Servicio ${ref} ha sido resuelta.`,
  },
  rejected: {
    types: "claim_rejected",
    title: { eng: "Claim Rejected", span: "Reclamación Rechazada" },
    eng: (ref) => `The claim for Service ${ref} has been rejected.`,
    span: (ref) => `La reclamación del Servicio ${ref} ha sido rechazada.`,
  },
};

// Status change (in-progress / resolved / rejected) -> notify BOTH parties.
const notifyClaimStatusChange = async (claim, status) => {
  const text = CLAIM_STATUS_TEXT[status];
  if (!text) return;
  const service = await Services.findById(claim.serviceId)
    .select("user confirmedPartner")
    .lean();
  const parties = getClaimParties(service);
  const ref = claimRef(claim.serviceId);
  const payload = {
    types: text.types,
    serviceId: claim.serviceId,
    title: text.title,
    message: { eng: text.eng(ref), span: text.span(ref) },
  };
  await Promise.all([
    notifyClaimRecipient(parties.USER, payload),
    notifyClaimRecipient(parties.PARTNER, payload),
  ]);
};

// =======================================================
// 1. Partner Bid Placement with Category-Specific Markup
// =======================================================
const partnerBidPost = async (req) => {
  const { serviceId } = req.params;
  const { userId } = req.user;
  const { price } = req.body;

  if (!price || isNaN(price)) {
    throw new ApiError(400, "Price must be a valid number");
  }

  const foundService = await Services.findById(serviceId);
  if (!foundService) {
    throw new ApiError(404, "Service not found");
  }

  const categoryId = Array.isArray(foundService.category)
    ? foundService.category[0]
    : foundService.category;

  if (foundService.mainService === "move") {
    const { minimumBed, maximumBed } =
      await VariableCount.calculateBedCosts(foundService);

    if (price < minimumBed) {
      throw new ApiError(400, "offer_to_low");
    } else if (price > maximumBed) {
      throw new ApiError(400, "offer_to_high");
    }

    const bankAccount = await StripeAccount.findOne({ user: userId });
    if (
      !bankAccount ||
      !bankAccount?.stripeAccountId ||
      !bankAccount?.externalAccountId
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please add your bank informations in your profile.",
      );
    }

    try {
      const stripeAccount = await stripe.accounts.retrieve(
        bankAccount?.stripeAccountId,
      );
      if (!stripeAccount) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Unable to find or validate your bank account.",
        );
      }
      const externalAccount = stripeAccount.external_accounts?.data.find(
        (account) => account.id === bankAccount.externalAccountId,
      );
      if (!externalAccount) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Please add your bank informations.",
        );
      }
    } catch (error) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Error validating bank account: ${error.message}`,
      );
    }
  } else if (foundService.mainService === "sell") {
    // Calculate category-specific markup instead of global surcharge (Feature 7)
    const markupAmount = await calculateCategoryMarkup(
      categoryId,
      foundService.minPrice,
    );
    const minOfferPrice = Number(foundService.minPrice) + markupAmount;

    if (price <= minOfferPrice) {
      throw new ApiError(400, "offer_to_low");
    }
  } else {
    throw new ApiError(400, "Invalid service type, please try later.");
  }

  const existingBid = await Bids.findOne({
    service: serviceId,
    partner: userId,
  });

  const data = {
    service: serviceId,
    partner: userId,
    status: "Pending",
    price,
    serviceType: foundService.service,
  };

  const bitData = await Bids.findOne({ service: serviceId }).sort({
    price: -1,
  });

  let updateService;
  let updatedBid;
  let updatePrice = foundService?.bestBid;

  if (bitData && (bitData.price < price || foundService.bestBid < price)) {
    updatePrice = price;
  }

  if (existingBid) {
    updatedBid = await Bids.findByIdAndUpdate(
      existingBid._id,
      { price, status: "Pending" },
      { new: true },
    );
    if (bitData?.price < price || foundService?.bestBid < price) {
      updatePrice = price;
    }
  } else {
    updatedBid = await Bids.create(data);
    updateService = await Services.findByIdAndUpdate(
      serviceId,
      {
        $push: { bids: updatedBid._id },
        bestBid: updatePrice,
      },
      { new: true },
    );
  }

  await NotificationService.sendNotification({
    title: {
      eng: "New Bid Received",
      span: "Nueva Oferta Recibida",
    },
    message: {
      eng: `You have received a new bid for your service.`,
      span: `Has recibido una nueva oferta para tu servicio.`,
    },
    user: foundService.user,
    userType: "User",
    getId: serviceId,
    types: "service",
  });

  return {
    service: updateService,
    bids: updatedBid,
  };
};

// =======================================================
// 2. Partner Bid Profile View with Dynamic Category Markup
// =======================================================
const getBitProfilePartner = async (req) => {
  const { bidId } = req.query;
  const { role } = req.user;

  let bids = await Bids.findById(bidId)
    .populate("partner")
    .populate({ path: "service", select: "mainService category" });

  if (!bids) {
    throw new ApiError(404, "Bids not found!");
  }

  if (role === ENUM_USER_ROLE.USER && bids.price && bids.service) {
    bids.price = await getUserFacingPrice(bids.service, bids.price);
  }

  const partnerId = bids.partner._id;
  const all_review = await Review.find({ partnerId }).populate({
    path: "userId",
    select: "name email profile_image",
  });

  const pisoVariable = await VariableCount.getPisoVariable();
  return { bids, all_review, piso: pisoVariable };
};

const partnerAllBids = async (req) => {
  const { userId } = req.user;
  const result = await Bids.find({ partner: userId }).populate("service");
  if (!result || result.length === 0) {
    throw new ApiError(404, "Bids not found yet");
  }
  return result;
};

const filterBidsByMove = async (req) => {
  const { categories, serviceType } = req.query;
  const { userId } = req.user;

  if (!serviceType) {
    throw new ApiError(400, "Please provide serviceType");
  }

  const filteredBids = await Bids.find({ partner: userId, status: "Pending" })
    .populate({
      path: "service",
      match: {
        service: serviceType || { $exists: true },
        category: categories ? { $in: categories } : { $exists: true },
      },
    })
    .exec();

  return filteredBids.filter((bid) => bid.service !== null);
};

const filterBidsByHistory = async (req) => {
  const {
    categories,
    serviceStatus,
    bitStatus,
    page = 1,
    limit = 10,
  } = req.query;
  const { serviceType } = req.body;
  const { userId } = req.user;

  const pageNumber = parseInt(page) || 1;
  const limitNumber = parseInt(limit) || 10;
  const skip = (pageNumber - 1) * limitNumber;

  try {
    const bidQuery = {
      partner: userId,
      status: bitStatus || { $in: ["Win", "Outbid", "Pending"] },
    };

    const serviceQuery = {
      ...(serviceType && { service: serviceType }),
      ...(categories && {
        category: {
          $in: Array.isArray(categories) ? categories : [categories],
        },
      }),
      ...(serviceStatus && { status: serviceStatus }),
    };

    const allFilteredBids = await Bids.find(bidQuery)
      .populate({
        path: "service",
        match: serviceQuery,
      })
      .lean();

    const totalBids = allFilteredBids.filter((bid) => bid.service).length;

    const filteredBids = await Bids.find(bidQuery)
      .populate({
        path: "partner",
        select: "_id name profile_image email rating",
      })
      .populate({
        path: "service",
        match: serviceQuery,
        populate: [
          {
            path: "user",
            select: "_id name profile_image email",
          },
          {
            path: "category",
            select: "_id category category_spain",
          },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    const validBids = filteredBids.filter((bid) => bid.service);

    const result = validBids.slice(skip, skip + limitNumber).map((bid) => ({
      ...bid,
      isServiceCompleted:
        bid.service &&
        (bid.service.status === "completed" || bid.service.status === "cancel"),
    }));

    const pisoVariable = await VariableCount.getPisoVariable();

    return {
      piso: pisoVariable,
      page: pageNumber,
      totalBids,
      totalPage: Math.ceil(totalBids / limitNumber),
      limit: limitNumber,
      result,
    };
  } catch (error) {
    console.error("Error in filterBidsByHistory:", error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "An error occurred while filtering bids.",
    );
  }
};

const orderDetailsPageFileClaim = async (req) => {
  const serviceId = req.query.serviceId || req.body.serviceId || req.params.serviceId;
  const { role } = req.user;

  let service = await Services.findById(serviceId)
    .populate({
      path: "user",
      select: "name profile_image email",
    })
    .populate({
      path: "confirmedPartner",
      select: "name profile_image email rating",
    })
    .populate({
      path: "category",
      select: "_id category category_spain",
    });

  if (!service) {
    throw new ApiError(404, "Service not found");
  }

  // Same final price as the Offers screen and the Stripe charge
  if (role === ENUM_USER_ROLE.USER && service.winBid) {
    service.winBid = await getUserFacingPrice(service, service.winBid);
  }

  const payment = await Transaction.findOne({ serviceId, active: true }).select(
    "amount paymentMethod",
  );
  return { service, payment };
};

// =======================================================
// 4. Reviews Management
// =======================================================
const postReviewMove = async (req) => {
  const { serviceId, partnerId } = req.query;
  const { userId } = req.user;
  const { comment, rating } = req.body;

  if (!comment || typeof comment !== "string" || comment.trim() === "") {
    throw new ApiError(
      400,
      "Comment is required and must be a non-empty string.",
    );
  }

  if (!rating || isNaN(rating) || rating < 1 || rating > 5) {
    throw new ApiError(400, "Rating must be a number between 1 and 5.");
  }

  if (!partnerId || !mongoose.isValidObjectId(partnerId)) {
    throw new ApiError(400, "Invalid partner ID.");
  }

  if (!mongoose.isValidObjectId(serviceId)) {
    throw new ApiError(400, "Invalid service ID.");
  }

  const service = await Services.findById(serviceId);
  if (!service) {
    throw new ApiError(404, "Service not found.");
  }

  const partner = await Partner.findById(partnerId);
  if (!partner) {
    throw new ApiError(404, "Partner not found.");
  }

  const result = await Review.create({
    comment: comment.trim(),
    rating,
    partnerId,
    userId,
    serviceId,
  });

  const reviews = await Review.find({ partnerId });
  const totalRating = reviews?.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0)
    : 0;

  const averageRating = reviews.length
    ? parseFloat((totalRating / reviews.length).toFixed(1))
    : 0;

  await Partner.findByIdAndUpdate(partnerId, { rating: averageRating });
  await Services.findByIdAndUpdate(serviceId, { isReviewed: true });

  return result;
};

const getPartnerReviews = async (req) => {
  const { partnerId } = req.query;
  const result = await Review.find({ partnerId }).populate({
    path: "userId",
    select: "name email profile_image",
  });
  return result;
};

// Partner ratings summary, breakdown, reviews & performance history (Feature 8)
const getPartnerRatingsSummary = async (partnerId) => {
  if (!partnerId || !mongoose.isValidObjectId(partnerId)) {
    throw new ApiError(400, "Valid partner ID is required.");
  }

  const partner = await Partner.findById(partnerId).select(
    "name email phone_number profile_image rating is_block createdAt",
  );
  if (!partner) {
    throw new ApiError(404, "Partner not found.");
  }

  const reviews = await Review.find({ partnerId })
    .populate({
      path: "userId",
      select: "name email profile_image",
    })
    .populate({
      path: "serviceId",
      select: "_id mainService subServiceType startingDate endingDate status",
    })
    .sort({ createdAt: -1 });

  const totalReviews = reviews.length;
  const starCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sumRating = 0;

  reviews.forEach((rev) => {
    const star = Math.min(5, Math.max(1, Math.round(rev.rating || 0)));
    starCounts[star] = (starCounts[star] || 0) + 1;
    sumRating += Number(rev.rating || 0);
  });

  const averageRating =
    totalReviews > 0
      ? parseFloat((sumRating / totalReviews).toFixed(1))
      : partner.rating || 0;

  const starBreakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: starCounts[star],
    percentage:
      totalReviews > 0
        ? Math.round((starCounts[star] / totalReviews) * 100)
        : 0,
  }));

  // Also count total completed services for performance monitoring
  const completedServicesCount = await Services.countDocuments({
    confirmedPartner: partnerId,
    status: { $in: ["completed", "Completed"] },
  });

  return {
    partner,
    summary: {
      averageRating,
      totalReviews,
      completedServicesCount,
      starBreakdown,
    },
    averageRating,
    totalReviews,
    completedServicesCount,
    ratingDistribution: starCounts,
    reviews,
  };
};

// =======================================================
// 5. Enhanced Claims Management (Features 10 & 11)
// =======================================================
const createFileClaim = async (req) => {
  const serviceId = req.query.serviceId || req.body.serviceId || req.params.serviceId;
  const { userId, role, emailAuth } = req.user;
  const {
    description,
    claimType = "OTHER",
    isDuringActiveService = true,
  } = req.body;
  const { fileClaimImage } = req.files || {};
  console.log({ fileClaimImage })

  const service = await Services.findById(serviceId);
  if (!service) {
    throw new ApiError(404, "Service not found.");
  }

  let images = [];
  if (fileClaimImage && Array.isArray(fileClaimImage)) {
    images = fileClaimImage.map(
      (file) => `/images/file-claim/${file.filename}`,
    );
  }

  let user;
  let userType = "User";
  let filedByRole;
  if (role === "USER") {
    if (String(service.user) !== String(userId)) {
      throw new ApiError(403, "You can only file a claim on your own service.");
    }
    user = await User.findById(userId);
    userType = "User";
    filedByRole = "USER";
  } else if (role === "PARTNER") {
    if (String(service.confirmedPartner) !== String(userId)) {
      throw new ApiError(403, "You can only file a claim on a service assigned to you.");
    }
    user = await Partner.findById(userId);
    userType = "Partner";
    filedByRole = "PARTNER";
  } else if (role === "ADMIN" || role === "SUPER_ADMIN") {
    user = { name: `Admin (${emailAuth || "XM Support"})` };
    userType = "User";
    filedByRole = "ADMIN";
  } else {
    throw new ApiError(403, "Unauthorized to perform this action.");
  }

  const result = await FileClaim.create({
    fileClaimImage: images,
    user: userId,
    name: user?.name || "Administrator",
    orderId: serviceId,
    serviceId,
    claimType,
    isDuringActiveService:
      isDuringActiveService === "false"
        ? false
        : Boolean(isDuringActiveService),
    description,
    userType,
    filedByRole,
    status: "pending",
  });

  // Mark the service as disputed so its flow and lists reflect the claim
  await syncServiceClaimStatus(serviceId);

  // Record digital traceability for the claim submission
  await recordTraceability({
    actorId: userId,
    actorRole: role,
    actorEmail: emailAuth,
    actionType: "CLAIM_SUBMITTED",
    targetEntity: "FileClaim",
    targetId: result._id,
    metaData: { serviceId, claimType, description },
  });

  await Notification.create({
    title: {
      eng: "New File Claim Submitted",
      span: "Se ha enviado una nueva reclamación de archivo",
    },
    message: {
      eng: `${user.name} has submitted a new ${claimType} claim for Service ID: ${serviceId}.`,
      span: `${user.name} ha enviado una nueva reclamación de ${claimType} para el Servicio ID: ${serviceId}.`,
    },
    userType: "Admin",
    types: "claim",
    admin: true,
    getId: service._id,
    serviceId: service._id,
  });

  // Notify the OTHER party (user files -> partner, partner files -> user).
  // A claim filed by an admin goes to both parties.
  const parties = getClaimParties(service);
  const recipients =
    filedByRole === "USER"
      ? [parties.PARTNER]
      : filedByRole === "PARTNER"
        ? [parties.USER]
        : [parties.USER, parties.PARTNER];
  const ref = claimRef(service._id);
  await Promise.all(
    recipients.map((recipient) =>
      notifyClaimRecipient(recipient, {
        types: "claim",
        serviceId: service._id,
        title: {
          eng: "Claim Filed on Your Service",
          span: "Reclamación Presentada en tu Servicio",
        },
        message: {
          eng: `A claim has been filed for Service ${ref}. You can review it and contest it in the Claims tab.`,
          span: `Se ha presentado una reclamación para el Servicio ${ref}. Puedes revisarla e impugnarla en la pestaña Reclamaciones.`,
        },
      }),
    ),
  );

  return result;
};

// Admin adds an internal note to a claim
const addAdminClaimNote = async (claimId, note, adminUser) => {
  if (!claimId || !mongoose.isValidObjectId(claimId)) {
    throw new ApiError(400, "Valid claimId is required");
  }
  if (!note || typeof note !== "string") {
    throw new ApiError(400, "Note is required");
  }

  const claim = await FileClaim.findByIdAndUpdate(
    claimId,
    {
      $push: {
        adminNotes: {
          adminId: adminUser.userId,
          note: note.trim(),
          createdAt: new Date(),
        },
      },
    },
    { new: true },
  );

  if (!claim) throw new ApiError(404, "Claim not found");
  return claim;
};

// Contest a claim. Only the party who did NOT file it, only while open, only once.
// Every rule failure is a 400 with a message the app shows to the user as-is.
const contestClaim = async (req) => {
  const { claimId } = req.body || {};
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const { userId, role, emailAuth } = req.user;

  if (![ENUM_USER_ROLE.USER, ENUM_USER_ROLE.PARTNER].includes(role)) {
    throw new ApiError(400, "Only the user or the partner of the service can contest a claim.");
  }
  if (!claimId || !mongoose.isValidObjectId(claimId)) {
    throw new ApiError(400, "A valid claim is required.");
  }
  if (reason.length < 10 || reason.length > 1000) {
    throw new ApiError(400, "Please write a reason between 10 and 1000 characters.");
  }

  const claim = await FileClaim.findById(claimId);
  if (!claim) {
    throw new ApiError(400, "This claim no longer exists.");
  }

  const service = await Services.findById(claim.serviceId)
    .select("user confirmedPartner")
    .lean();
  const parties = getClaimParties(service);
  const callerParty = parties[role];
  if (!callerParty || String(callerParty.id) !== String(userId)) {
    throw new ApiError(400, "You are not part of this service, so you cannot contest this claim.");
  }

  const filedByRole = getFiledByRole(claim);
  if (filedByRole === role) {
    throw new ApiError(400, "You filed this claim, so you cannot contest it.");
  }
  if (!OPEN_CLAIM_STATUSES.includes(claim.status)) {
    throw new ApiError(400, "This claim is already closed and can no longer be contested.");
  }
  if (claim.contest?.reason) {
    throw new ApiError(400, "This claim has already been contested. A claim can only be contested once.");
  }

  const contest = { reason, createdAt: new Date(), by: userId, byRole: role };

  // Conditional update so two simultaneous requests cannot both contest
  const updated = await FileClaim.findOneAndUpdate(
    { _id: claim._id, contest: null, status: { $in: OPEN_CLAIM_STATUSES } },
    { $set: { contest } },
    { new: true },
  );
  if (!updated) {
    throw new ApiError(400, "This claim has already been contested. A claim can only be contested once.");
  }

  await recordTraceability({
    actorId: userId,
    actorRole: role,
    actorEmail: emailAuth,
    actionType: "CLAIM_CONTESTED",
    targetEntity: "FileClaim",
    targetId: claim._id,
    metaData: { serviceId: claim.serviceId, reason },
  });

  const ref = claimRef(claim.serviceId);
  const contesterEng = role === ENUM_USER_ROLE.PARTNER ? "The partner" : "The customer";
  const contesterSpan = role === ENUM_USER_ROLE.PARTNER ? "El socio" : "El cliente";

  // Notify the filer (an admin-filed claim has no app recipient)
  if (filedByRole !== "ADMIN") {
    await notifyClaimRecipient(parties[filedByRole], {
      types: "claim_contested",
      serviceId: claim.serviceId,
      title: { eng: "Your Claim Was Contested", span: "Tu Reclamación fue Impugnada" },
      message: {
        eng: `${contesterEng} has contested your claim for Service ${ref}. Our team will review both sides.`,
        span: `${contesterSpan} ha impugnado tu reclamación del Servicio ${ref}. Nuestro equipo revisará ambas partes.`,
      },
    });
  }

  await notifyAdminsAboutClaim({
    serviceId: claim.serviceId,
    title: { eng: "Claim Contested", span: "Reclamación Impugnada" },
    message: {
      eng: `${contesterEng} contested the claim on Service ${ref}: "${reason}"`,
      span: `${contesterSpan} impugnó la reclamación del Servicio ${ref}: "${reason}"`,
    },
  });

  return { claimId: updated._id, contest: updated.contest };
};

// Admin finalizes and resolves a claim with a formal decision
const resolveAdminClaim = async (req) => {
  const { claimId, resolutionType, decisionNotes, penaltyOrRefundAmount } =
    req.body;
  const { userId, emailAuth } = req.user;

  if (!claimId || !mongoose.isValidObjectId(claimId)) {
    throw new ApiError(400, "Valid claimId is required");
  }
  if (
    !resolutionType ||
    !["REFUND", "PENALTY_APPLIED", "NO_ACTION", "DISMISSED"].includes(
      resolutionType,
    )
  ) {
    throw new ApiError(
      400,
      "Valid resolutionType (REFUND, PENALTY_APPLIED, NO_ACTION, DISMISSED) is required",
    );
  }

  const claim = await FileClaim.findById(claimId);
  if (!claim) throw new ApiError(404, "Claim not found");

  claim.status = resolutionType === "DISMISSED" ? "rejected" : "resolved";
  claim.finalDecision = {
    resolutionType,
    decisionNotes: decisionNotes || "",
    penaltyOrRefundAmount: Number(penaltyOrRefundAmount || 0),
    resolvedAt: new Date(),
    resolvedBy: userId,
  };

  await claim.save();

  // Keep the service's dispute state in sync with the resolved claim
  await syncServiceClaimStatus(claim.serviceId);

  // Record traceability log for claim resolution
  await recordTraceability({
    actorId: userId,
    actorRole: "Admin",
    actorEmail: emailAuth,
    actionType: "CLAIM_RESOLVED",
    targetEntity: "FileClaim",
    targetId: claim._id,
    metaData: { resolutionType, penaltyOrRefundAmount, decisionNotes },
  });

  // Notify BOTH parties of the decision
  await notifyClaimStatusChange(claim, claim.status);

  return claim;
};

const updateStatusFileClaim = async (req) => {
  const { claimId, status } = req.body;
  const { userId, emailAuth } = req.user;

  if (!claimId || !mongoose.isValidObjectId(claimId)) {
    throw new ApiError(400, "Invalid or missing claimId.");
  }

  const allowedStatuses = ["pending", "in-progress", "resolved", "rejected"];
  if (!status || !allowedStatuses.includes(status)) {
    throw new ApiError(
      400,
      `Invalid or missing status. Allowed values: ${allowedStatuses.join(", ")}`,
    );
  }

  try {
    const previous = await FileClaim.findById(claimId).select("status").lean();
    if (!previous) {
      throw new ApiError(404, "File claim not found.");
    }

    const result = await FileClaim.findByIdAndUpdate(
      claimId,
      { status },
      { new: true },
    );

    // Keep the service's dispute state in sync with its claims
    await syncServiceClaimStatus(result.serviceId);

    // Status changed to in-progress / resolved / rejected -> notify both parties
    if (previous.status !== status) {
      await notifyClaimStatusChange(result, status);
      await recordTraceability({
        actorId: userId,
        actorRole: "Admin",
        actorEmail: emailAuth,
        actionType: "CLAIM_STATUS_CHANGED",
        targetEntity: "FileClaim",
        targetId: result._id,
        metaData: { from: previous.status, to: status },
      });
    }

    const newTask = {
      admin: userId,
      email: emailAuth,
      description: `File claim with ID ${claimId} successfully updated to status '${status}'.`,
      types: "Update",
      activity: status === "resolved" ? "task" : "progressing",
      status: "Success",
      attended: "complaints",
    };
    await LogsDashboardService.createTaskDB(newTask);

    return result;
  } catch (error) {
    const newTask = {
      admin: userId,
      email: emailAuth,
      description: `Failed to update file claim with ID ${claimId}: ${error.message || "Unknown error"
        }.`,
      types: "Failed",
      activity: status === "resolved" ? "task" : "progressing",
      status: "Error",
    };
    await LogsDashboardService.createTaskDB(newTask);

    throw new ApiError(
      error.statusCode || error.status || httpStatus.INTERNAL_SERVER_ERROR,
      error.message ||
      "An error occurred while updating the file claim status.",
    );
  }
};

const getAllFileClaims = async (req) => {
  try {
    const query = req.query;

    const resultQuery = new QueryBuilder(
      FileClaim.find()
        .populate({
          path: "serviceId",
          populate: [
            { path: "user", select: "_id name email profile_image" },
            {
              path: "confirmedPartner",
              select: "_id name email profile_image",
            },
          ],
        })
        .populate({
          path: "user",
          select: "name email profile_image",
        })
        .populate({
          path: "adminNotes.adminId",
          select: "name email profile_image",
        })
        .populate({
          path: "finalDecision.resolvedBy",
          select: "name email",
        }),
      query,
    )
      .search(["orderId", "name", "status", "claimType"])
      .filter()
      .sort()
      .paginate()
      .fields();

    const result = await resultQuery.modelQuery;
    const meta = await resultQuery.countTotal();

    return {
      success: true,
      data: result,
      meta,
    };
  } catch (error) {
    console.error("Error fetching file claims:", error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "An error occurred while fetching file claims.",
    );
  }
};

const applyPenaltyPercent = async (req, options = {}) => {
  const { serviceId, amountPercent, reason, id } = req.body;

  if (!serviceId || !mongoose.isValidObjectId(serviceId)) {
    throw new ApiError(400, "Invalid or missing serviceId.");
  }

  const fileClaim = await FileClaim.findById(id);
  if (!fileClaim) {
    throw new ApiError(400, "Invalid or missing file claim 'id'.");
  }

  // A penalty decided on a claim must go through executeClaimDecision (admin confirmation, runs once)
  if (!options.fromDecision && fileClaim.finalDecision?.resolutionType === "PENALTY_APPLIED") {
    throw new ApiError(400, "This claim's penalty is applied through 'Execute decision', not manually.");
  }

  // The penalty must belong to a claim on this same service
  if (String(fileClaim.serviceId) !== String(serviceId)) {
    throw new ApiError(400, "This claim does not belong to the given service.");
  }

  const percentValue = parseFloat(amountPercent);
  if (isNaN(percentValue) || percentValue <= 0) {
    throw new ApiError(400, "Invalid or missing cut amount percentage.");
  }

  const service = await Services.findById(serviceId);
  if (!service) {
    throw new ApiError(404, "Service not found.");
  }

  const transaction = await Transaction.findOne({ serviceId, active: true });
  if (!transaction?.partnerAmount) {
    throw new ApiError(404, "No transactions found for this service.");
  }

  const { partnerAmount } = transaction;
  const cutAmount = Number(partnerAmount) * (percentValue / 100);

  const fineTransaction = {
    ...transaction.toObject(),
    partnerAmount: cutAmount,
    payType: "fine",
    finePercent: percentValue,
    fineReason: reason,
    active: true,
    fileClaimImage: fileClaim.fileClaimImage,
  };

  delete fineTransaction._id;
  delete fineTransaction.createdAt;
  delete fineTransaction.updatedAt;

  if (service.mainService === "sell") {
    const user = await User.findById(service.user);
    if (!user || user.wallet === undefined) {
      throw new ApiError(404, "User not found or wallet not initialized.");
    }

    user.wallet -= cutAmount;
    await user.save();

    await NotificationService.sendNotification({
      title: {
        eng: "Penalty Applied",
        span: "Sanción Aplicada",
      },
      message: {
        eng: `A penalty of ${percentValue}% (${reason}) has been deducted from your wallet.`,
        span: `Se ha deducido una sanción de ${percentValue}% (${reason}) de tu billetera.`,
      },
      user: user._id,
      userType: "User",
      types: "none",
    });
  } else if (service.mainService === "move") {
    const partner = await Partner.findById(service.confirmedPartner);
    if (!partner || partner.wallet === undefined) {
      throw new ApiError(404, "Partner not found or wallet not initialized.");
    }

    partner.wallet -= cutAmount;
    await partner.save();

    await NotificationService.sendNotification({
      title: {
        eng: "Penalty Applied",
        span: "Sanción Aplicada",
      },
      message: {
        eng: `A penalty of ${percentValue}% (${reason}) has been deducted from your wallet.`,
        span: `Se ha deducido una sanción de ${percentValue}% (${reason}) de tu billetera.`,
      },
      user: partner._id,
      userType: "Partner",
      types: "none",
    });
  } else {
    throw new ApiError(400, "Unsupported service type.");
  }

  const result = await Transaction.create(fineTransaction);
  transaction.active = false;
  await transaction.save();

  return { service, result };
};

const statusServicesDetails = async (req) => {
  const serviceId = req.query.serviceId || req.body.serviceId || req.params.serviceId;
  if (!serviceId) {
    throw new ApiError(400, "Service ID is required.");
  }

  const service = await Services.findById(serviceId)
    .populate({
      path: "user",
      select: "name email profile_image",
    })
    .populate({
      path: "confirmedPartner",
      select: "name email profile_image rating location",
    })
    .populate({
      path: "category",
      select: "_id category",
    })
    .lean();

  if (service && (!service.claimStatus || service.claimStatus === "none")) {
    const activeClaim = await FileClaim.findOne({ serviceId })
      .sort({ createdAt: -1 })
      .select("status")
      .lean();
    if (activeClaim) {
      service.claimStatus = activeClaim.status;
      service.activeClaimId = activeClaim._id;
    } else {
      service.claimStatus = "none";
      service.activeClaimId = null;
    }
  }

  return service;
};

// Admin-confirmed execution of a resolved claim's money decision.
// Nothing moves money until the admin sends confirm: true.
const executeClaimDecision = async (req) => {
  const { claimId, confirm } = req.body;
  const { userId, emailAuth } = req.user;

  if (!claimId || !mongoose.isValidObjectId(claimId)) {
    throw new ApiError(400, "Valid claimId is required");
  }
  if (confirm !== true) {
    throw new ApiError(400, "Admin confirmation (confirm: true) is required before money is moved");
  }

  const claim = await FileClaim.findById(claimId);
  if (!claim) throw new ApiError(404, "Claim not found");
  if (claim.status !== "resolved") {
    throw new ApiError(400, "Claim must be resolved before its decision can be executed");
  }

  const decision = claim.finalDecision || {};
  if (!["REFUND", "PENALTY_APPLIED"].includes(decision.resolutionType)) {
    throw new ApiError(400, "This decision does not move money");
  }
  const amount = Number(decision.penaltyOrRefundAmount || 0);
  if (!(amount > 0)) {
    throw new ApiError(400, "Decision amount must be greater than zero");
  }

  // Lock first so the same decision cannot run twice
  const locked = await FileClaim.findOneAndUpdate(
    { _id: claimId, "finalDecision.executed": { $ne: true } },
    {
      $set: {
        "finalDecision.executed": true,
        "finalDecision.executedAt": new Date(),
        "finalDecision.executedBy": userId,
      },
    },
    { new: true },
  );
  if (!locked) {
    throw new ApiError(409, "This decision has already been executed");
  }

  try {
    const transaction = await Transaction.findOne({ serviceId: claim.serviceId, active: true });
    if (!transaction || transaction.paymentStatus !== "Completed") {
      throw new ApiError(400, "No completed payment found for this service");
    }

    let reference;
    if (decision.resolutionType === "REFUND") {
      if (transaction.paymentMethod !== "Stripe") {
        throw new ApiError(400, "Automatic refund is supported only for Stripe payments");
      }
      // Decision amount is USD; Stripe refunds in the currency that was charged
      const refundUnits = await getStripeRefundUnits({
        paymentIntentId: transaction.transactionId,
        amountUsd: amount,
        paidUsd: transaction.amount,
      });
      const refund = await stripe.refunds.create({
        payment_intent: transaction.transactionId,
        amount: refundUnits,
      });
      reference = refund.id;
    } else {
      // Penalty goes through applyPenaltyPercent so the wallet and fine record stay consistent
      const percent = (amount / Number(transaction.partnerAmount)) * 100;
      if (!(percent > 0 && percent <= 100)) {
        throw new ApiError(400, "Penalty amount is more than the partner amount");
      }
      await applyPenaltyPercent(
        {
          body: {
            serviceId: String(claim.serviceId),
            amountPercent: percent,
            reason: decision.decisionNotes || claim.claimType,
            id: String(claim._id),
          },
        },
        { fromDecision: true },
      );
      reference = "penalty-applied";
    }

    await FileClaim.updateOne(
      { _id: claimId },
      { $set: { "finalDecision.executionRef": reference } },
    );

    await recordTraceability({
      actorId: userId,
      actorRole: "Admin",
      actorEmail: emailAuth,
      actionType: "CLAIM_DECISION_EXECUTED",
      targetEntity: "FileClaim",
      targetId: claim._id,
      metaData: { resolutionType: decision.resolutionType, amount, reference },
    });

    return { claimId, resolutionType: decision.resolutionType, amount, reference };
  } catch (error) {
    // Nothing (or not everything) moved: unlock so an admin can retry after fixing the cause
    await FileClaim.updateOne(
      { _id: claimId },
      {
        $set: { "finalDecision.executed": false },
        $unset: { "finalDecision.executedAt": "", "finalDecision.executedBy": "" },
      },
    );
    throw error;
  }
};

// Claims on the caller's services.
// USER: every claim on services the user owns (filed by them or against them).
// PARTNER: every claim on services assigned to the partner, filed by or against them.
const getMyFileClaims = async (req) => {
  const { userId, role } = req.user;
  const serviceFilter =
    role === ENUM_USER_ROLE.PARTNER ? { confirmedPartner: userId } : { user: userId };
  const serviceIds = await Services.find(serviceFilter).distinct("_id");

  const claims = await FileClaim.find({
    $or: [{ user: userId }, { serviceId: { $in: serviceIds } }],
  })
    .select("-adminNotes -finalDecision.resolvedBy -finalDecision.executedBy")
    .sort({ createdAt: -1 })
    .populate({
      path: "serviceId",
      select:
        "_id status claimStatus activeClaimId service mainService pickup_address drop_off_address user confirmedPartner winBid createdAt",
      populate: [
        { path: "user", select: "name email profile_image" },
        { path: "confirmedPartner", select: "name email profile_image" },
      ],
    })
    .lean();

  await fillMissingClaimStatus(claims.map((c) => c.serviceId).filter(Boolean));

  return claims.map((claim) => {
    const filedByRole = getFiledByRole(claim);
    const contest = claim.contest?.reason
      ? { reason: claim.contest.reason, createdAt: claim.contest.createdAt, byRole: claim.contest.byRole }
      : null;
    return {
      ...claim,
      filedByRole,
      filedBy: { _id: claim.user, role: filedByRole },
      contest,
      canContest:
        filedByRole !== role &&
        OPEN_CLAIM_STATUSES.includes(claim.status) &&
        !contest,
    };
  });
};

// GET /bids/post/:serviceId - offers for a service.
// USER sees the final price (same rule as order-details and the Stripe charge).
const getServiceOffers = async (req) => {
  const { serviceId } = req.params;
  const { userId, role } = req.user;

  if (!mongoose.isValidObjectId(serviceId)) {
    throw new ApiError(400, "Invalid service id.");
  }
  const service = await Services.findById(serviceId)
    .select("user mainService category status confirmedPartner winBid")
    .lean();
  if (!service) {
    throw new ApiError(404, "Service not found");
  }

  const filter = { service: serviceId };
  if (role === ENUM_USER_ROLE.USER && String(service.user) !== String(userId)) {
    throw new ApiError(403, "You can only see offers on your own service.");
  }
  if (role === ENUM_USER_ROLE.PARTNER) {
    filter.partner = userId; // a partner only sees their own offer
  }

  const bids = await Bids.find(filter)
    .populate({ path: "partner", select: "_id name profile_image rating" })
    .sort({ price: -1 })
    .lean();

  const result =
    role === ENUM_USER_ROLE.USER
      ? await Promise.all(
          bids.map(async (bid) => ({
            ...bid,
            price: await getUserFacingPrice(service, bid.price),
          })),
        )
      : bids;

  return { serviceId, mainService: service.mainService, bids: result };
};

const BidService = {
  partnerBidPost,
  partnerAllBids,
  filterBidsByMove,
  filterBidsByHistory,
  postReviewMove,
  getPartnerReviews,
  getPartnerRatingsSummary, // Added
  getBitProfilePartner,
  orderDetailsPageFileClaim,
  createFileClaim,
  contestClaim,
  addAdminClaimNote, // Added
  resolveAdminClaim, // Added
  updateStatusFileClaim,
  applyPenaltyPercent,
  statusServicesDetails,
  getAllFileClaims,
  getMyFileClaims,
  getServiceOffers,
  executeClaimDecision,
};

module.exports = { BidService };
