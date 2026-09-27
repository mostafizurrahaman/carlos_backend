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
} = require("../../../helpers/calculateCategoryMarkup");
const { recordTraceability } = require("../../../helpers/traceabilityLogger");

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

  const categoryId = Array.isArray(bids.service?.category)
    ? bids.service.category[0]
    : bids.service?.category;

  const categoryMarkup = await calculateCategoryMarkup(categoryId, bids.price);

  if (role === ENUM_USER_ROLE.USER && bids.service?.mainService === "move") {
    if (bids.price) {
      bids.price = Number(bids.price) + categoryMarkup;
    }
  }

  if (role === ENUM_USER_ROLE.USER && bids.service?.mainService === "sell") {
    if (bids.price) {
      bids.price = Number(bids.price) - categoryMarkup;
    }
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
  const { serviceId } = req.query;
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

  const categoryId = Array.isArray(service.category)
    ? service.category[0]?._id
    : service.category?._id;
  const categoryMarkup = await calculateCategoryMarkup(
    categoryId,
    service.winBid,
  );

  if (role === ENUM_USER_ROLE.USER && service.mainService === "move") {
    if (service.winBid) {
      service.winBid = Number(service.winBid) + categoryMarkup;
    }
  }
  if (role === ENUM_USER_ROLE.USER && service.mainService === "sell") {
    if (service.winBid) {
      service.winBid = Number(service.winBid) - categoryMarkup;
    }
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
  const { serviceId } = req.query;
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
  if (role === "USER") {
    user = await User.findById(userId);
    userType = "User";
  } else if (role === "PARTNER") {
    user = await Partner.findById(userId);
    userType = "Partner";
  } else if (role === "ADMIN" || role === "SUPER_ADMIN") {
    user = { name: `Admin (${emailAuth || "XM Support"})` };
    userType = "User";
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
    status: "pending",
  });

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
    types: "none",
    admin: true,
  });

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

  // Notify user or partner
  await NotificationService.sendNotification({
    title: {
      eng: "File Claim Resolved",
      span: "Reclamación Resuelta",
    },
    message: {
      eng: `Your claim has been resolved with decision: ${resolutionType}.`,
      span: `Su reclamación ha sido resuelta con la decisión: ${resolutionType}.`,
    },
    user: claim.user,
    userType: claim.userType,
    types: "none",
  });

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
    const result = await FileClaim.findByIdAndUpdate(
      claimId,
      { status },
      { new: true },
    );

    if (!result) {
      throw new ApiError(404, "File claim not found.");
    }

    if (status === "resolved") {
      await NotificationService.sendNotification({
        title: {
          eng: "File Claim Resolved.",
          span: "Reclamación Resuelta.",
        },
        message: {
          eng: `Your claim against ${result?.userType === "User" ? "partner" : "user"
            } has been resolved.`,
          span: `Tu reclamación contra ${result?.userType === "User" ? "el socio" : "el usuario"
            } ha sido resuelta.`,
        },
        user: result.user,
        userType: result.userType,
        types: "none",
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
      error.status || httpStatus.INTERNAL_SERVER_ERROR,
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

const applyPenaltyPercent = async (req) => {
  const { serviceId, amountPercent, reason, id } = req.body;

  if (!serviceId || !mongoose.isValidObjectId(serviceId)) {
    throw new ApiError(400, "Invalid or missing serviceId.");
  }

  const fileClaim = await FileClaim.findById(id);
  if (!fileClaim) {
    throw new ApiError(400, "Invalid or missing file claim 'id'.");
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
  const { serviceId } = req.query;
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
    });

  return service;
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
  addAdminClaimNote, // Added
  resolveAdminClaim, // Added
  updateStatusFileClaim,
  applyPenaltyPercent,
  statusServicesDetails,
  getAllFileClaims,
};

module.exports = { BidService };
