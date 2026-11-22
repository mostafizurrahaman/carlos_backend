const httpStatus = require("http-status");
const Partner = require("../partner/partner.model");
const User = require("../user/user.model");
const Services = require("../services/services.model");
const { ENUM_USER_ROLE, ENUM_SERVICE_STATUS } = require("../../../utils/enums");
const config = require("../../../config");
const ApiError = require("../../../errors/ApiError");
const { Transaction, StripeAccount } = require("./payment.model");
const stripe = require("stripe")(config.stripe.stripe_secret_key);
const stripePublic = require("stripe")(config.stripe.stripe_public_key);
const { LogsDashboardService } = require("../logs-dashboard/logsdashboard.service");
const Admin = require("../admin/admin.model");
const Variable = require("../variable/variable.model");
const VariableCount = require("../variable/variable.count");
const { ServicesService } = require("../services/services.service");
const { Bids } = require("../bid/bid.model");
const { NotificationService } = require("../notification/notification.service");
const { calculateCategoryMarkup, getUserFacingPrice } = require("../../../helpers/calculateCategoryMarkup");
const { default: mongoose } = require("mongoose");

const DOMAIN_URL = process.env.RESET_PASS_UI_LINK;

//Stripe Payment =====================
const createCheckoutSessionStripe = async (req) => {
  try {
    const { serviceId, price, currency, partnerId } = req.body;
    const { userId, role } = req.user;

    // "price" is accepted for backward compatibility but is never used for the charge
    if (!currency || !serviceId || !partnerId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Missing required fields.');
    }

    const partner = await Partner.findOne({ _id: partnerId });
    if (!partner) {
      throw new ApiError(404, "Partner account is Deactivated, please find another partner.");
    }
    const service = await Services.findById(serviceId);
    if (!service) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Invalid service ID.');
    }

    const bidDetails = await Bids.findOne({
      service: serviceId,
      partner: partnerId,
    });

    if (!bidDetails?.price) {
      throw new ApiError(404, "Bid not found for this service and partner.");
    }


    let user;
    let payUserRole;
    if (role === ENUM_USER_ROLE.USER) {
      user = await User.findById(userId);
      payUserRole = 'User';
    } else if (role === ENUM_USER_ROLE.PARTNER) {
      user = await Partner.findById(userId);
      payUserRole = 'Partner';
    } else if (role === ENUM_USER_ROLE.ADMIN) {
      user = await Admin.findById(userId);
      payUserRole = 'Admin';
    }

    let receiveUser;
    let receiveUserRole;
    if (service.mainService === "sell") {
      receiveUser = service.user;
      receiveUserRole = 'User';
    } else if (service.mainService === "move") {
      receiveUser = new mongoose.Types.ObjectId(partnerId);
      receiveUserRole = 'Partner';
    } else {
      throw new ApiError(httpStatus.NOT_FOUND, 'Invalid service type.');
    }

    const bankAccount = await StripeAccount.findOne({ user: receiveUser });

    if (!bankAccount || !bankAccount?.stripeAccountId || !bankAccount?.externalAccountId) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Payment Receive Back Account Information is missing!");
    }

    const stripeAccount = await stripe.accounts.retrieve(bankAccount?.stripeAccountId);

    if (!stripeAccount) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Payment Receive Back Account Not Found.");
    }

    if (!stripeAccount.capabilities?.transfers || stripeAccount.capabilities.transfers !== "active") {
      throw new ApiError(httpStatus.BAD_REQUEST, "Payment Receive Back Account Unverified");
    }

    const externalAccount = stripeAccount.external_accounts?.data?.find(
      (account) => account.id === bankAccount.externalAccountId
    );

    if (!externalAccount) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Payment Receive Back Account Not Found.");
    }

    // Only the right party may pay: the customer for a move, the buying partner for a sell
    if (service.mainService === "move" && String(service.user) !== String(userId)) {
      throw new ApiError(httpStatus.FORBIDDEN, "You can only pay for your own service.");
    }
    if (service.mainService === "sell" && String(partnerId) !== String(userId)) {
      throw new ApiError(httpStatus.FORBIDDEN, "You can only pay for your own offer.");
    }

    // Amount comes from the DB, never from the app's "price".
    // move: customer pays bid + markup (same number as Offers / order-details).
    // sell: buying partner pays their bid; the seller gets bid - markup on success.
    const chargeMxn =
      service.mainService === "move"
        ? await getUserFacingPrice(service, bidDetails.price)
        : Number(bidDetails.price);

    const normalizedCurrency = String(currency).toLowerCase();
    let chargeAmount;
    if (normalizedCurrency === "mxn") {
      chargeAmount = chargeMxn;
    } else if (normalizedCurrency === "usd") {
      const { dollarCost } = await VariableCount.convertPesoToDollar(chargeMxn);
      chargeAmount = dollarCost;
    } else {
      throw new ApiError(httpStatus.BAD_REQUEST, "Unsupported currency.");
    }

    if (Math.abs(Number(price) - chargeAmount) > 0.01) {
      console.warn(
        `[Stripe] Client price ${price} differs from DB amount ${chargeAmount} for service ${serviceId}; charging DB amount.`
      );
    }

    const unitAmount = Math.round(chargeAmount * 100);
    if (!(unitAmount > 0)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid amount for this service.");
    }

    let session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      success_url: `${DOMAIN_URL}/payment/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN_URL}/cancel`,
      customer_email: `${user?.email}`,
      client_reference_id: serviceId,
      metadata: {
        payUser: userId,
        payUserType: payUserRole,
        receiveUser: receiveUser.toHexString(),
        receiveUserType: receiveUserRole,
        serviceId: serviceId,
        stripeAccountId: bankAccount?.stripeAccountId,
        partnerId: partnerId,
        winBid: bidDetails.price,
        chargedAmount: chargeAmount,
      },
      line_items: [
        {
          price_data: {
            currency: normalizedCurrency,
            unit_amount: unitAmount,
            product_data: {
              name: service.service,
              description: `Service ID: ${serviceId} | ${service.description}`,
            },
          },
          quantity: 1,
        },
      ],
    });

    return { url: session.url };

  } catch (error) {
    throw new ApiError(400, error.message);
  }
};

const stripeCheckAndUpdateStatusSuccess = async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return { status: "failed", message: "Missing session ID in the request." };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return { status: "failed", message: "Session not found." };
    }

    if (session.payment_status !== 'paid') {
      return { status: "failed", message: "Payment not approved." };
    }

    const { receiveUser, payUser, payUserType, receiveUserType, serviceId, winBid, partnerId } = session.metadata;
    // const accepted = await ServicesService.conformPartner(serviceId, partnerId)
    const service = await Services.findById(serviceId);
    if (!service) {
      return {
        status: "failed",
        message: "Service not found!",
        text: 'Payment succeeded, but the service could not be found. Please contact support.'
      };
    }

    if (service.paymentStatus === 'paid') {
      const existingTransaction = await Transaction.findOne({ serviceId: service._id, active: true });
      return { status: "success", result: existingTransaction };
    }

    service.paymentStatus = 'paid';
    service.transactionId = session.payment_intent;
    service.paymentMethod = 'Stripe';
    await service.save();

    let amount = Number(session.amount_total) / 100;


    let totalAmount = Number(amount);
    if (session.currency === 'mxn') {
      const { dollarCost } = await VariableCount.convertPesoToDollar(amount);
      totalAmount = dollarCost;
    }

    let receiverAmount = Number(winBid);
    if (service.mainService === "sell") {
      const categoryId = Array.isArray(service.category)
        ? service.category[0]?._id || service.category[0]
        : service.category?._id || service.category;
      const markup = await calculateCategoryMarkup(categoryId, winBid);
      receiverAmount = Number(winBid) - markup;
    }

    await Services.findByIdAndUpdate(
      serviceId,
      {
        confirmedPartner: partnerId,
        status: ENUM_SERVICE_STATUS.ACCEPTED,
        winBid: winBid,
      },
      { new: true }
    );

    const bulkOps = [
      {
        updateMany: {
          filter: { service: serviceId },
          update: { $set: { status: "Outbid" } },
        },
      },
      {
        updateOne: {
          filter: { service: serviceId, partner: partnerId },
          update: { $set: { status: "Win" } },
        },
      },
    ];

    await Bids.bulkWrite(bulkOps);

    const transactionData = {
      serviceId,
      payUser,
      payUserType,
      receiveUser,
      receiveUserType,
      paymentMethod: 'Stripe',
      amount: totalAmount,
      partnerAmount: receiverAmount,
      paymentStatus: "Completed",
      isFinish: false,
      payType: service.mainService,
      transactionId: session.payment_intent,
      paymentDetails: {
        email: session.customer_email,
        payId: sessionId,
        currency: "USD",
      }
    };
    const newTransaction = await Transaction.create(transactionData);

    if (service.mainService === 'sell') {
      await NotificationService.sendNotification({
        title: {
          eng: "Auction sold successfully.",
          span: "Subasta con éxito"
        },
        message: {
          eng: "Your auction has been sold successfully.",
          span: "Tu subasta se ha vendido con éxito."
        },
        user: service?.user,
        userType: 'User',
        types: 'service',
        getId: serviceId,
      });

      await NotificationService.sendNotification({
        title: {
          eng: "Auction Won",
          span: "Subasta ganada"
        },
        message: {
          eng: "You have successfully won the auction. Your payment has been completed.",
          span: "Has ganado la subasta con éxito. Tu pago ha sido completado."
        },
        user: partnerId,
        userType: 'Partner',
        types: 'service',
        getId: serviceId,
      });
    } else if (service.mainService === 'move') {
      await NotificationService.sendNotification({
        title: {
          eng: "Payment Successful.",
          span: "Pago recibido."
        },
        message: {
          eng: `Your payment has been successfully received.`,
          span: `Tu pago ha sido recibido exitosamente.`
        },
        user: service?.user,
        userType: 'User',
        types: 'service',
        getId: serviceId,
      });

      await NotificationService.sendNotification({
        title: {
          eng: "Auction Won.",
          span: "Subasta Ganada.",
        },
        message: {
          eng: "Congratulations! You have won the auction. Please review the service details.",
          span: "¡Felicidades! Has ganado la subasta. Por favor revisa los detalles del servicio.",
        },
        user: partnerId,
        userType:'Partner',
        types: 'service',
        getId: serviceId,
      });
    }

    return { status: "success", result: newTransaction };

  } catch (error) {
    console.error('Error processing Stripe payment:', error);
    return { status: "failed", message: "Payment execution failed", error: error.message };
  }
};

const paymentStatusCancel = async (req, res) => {
  return { status: "canceled" }
}

//Stripe Refund Payment =================
const stripeRefundPayment = async (req, res) => {
  const { saleId, amount, serviceId } = req.body;
  const { userId, emailAuth, role } = req.user;

  try {
    if (!saleId || !amount || !serviceId) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Missing required parameters!");
    }
    const service = await Services.findById(serviceId);
    if (!service) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Service not found!");
    }

    const originalTx = await Transaction.findOne({ transactionId: saleId, serviceId });
    if (!originalTx) {
      throw new ApiError(httpStatus.NOT_FOUND, "Original transaction not found for this refund.");
    }

    const refund = await stripe.refunds.create({
      payment_intent: saleId,
      amount: Math.round(amount * 100),
      // currency: 'usd',
    });
    service.paymentStatus = 'refunded';
    await service.save();


    const transactionData = {
      serviceId,
      payUser: originalTx.payUser,
      payUserType: originalTx.payUserType,
      receiveUser: originalTx.receiveUser,
      receiveUserType: originalTx.receiveUserType,
      isFinish: true,
      paymentMethod: 'Stripe',
      amount: Number(refund.amount) / 100,
      paymentStatus: "Refunded",
      transactionId: refund.id,
      paymentDetails: {
        payId: refund.charge,
        currency: refund.currency,
      },
    };

    const newTransaction = await Transaction.create(transactionData);

    // log=====
    const newTask = {
      admin: userId,
      email: emailAuth,
      description: `Refund successful: Service ID ${serviceId} refunded via Stripe.`,
      types: "Refund",
      activity: "task",
      status: "Success",
    };
    await LogsDashboardService.createTaskDB(newTask)
    //=====

    // Send notifications to both parties
    await NotificationService.sendNotification({
      title: {
        eng: "Payment Refunded",
        span: "Pago Reembolsado"
      },
      message: {
        eng: `Your payment for service has been successfully refunded.`,
        span: `Su pago por el servicio ha sido reembolsado con éxito.`
      },
      user: originalTx.payUser,
      userType: originalTx.payUserType,
      types: 'service',
      getId: serviceId,
    });

    await NotificationService.sendNotification({
      title: {
        eng: "Service Refunded",
        span: "Servicio Reembolsado"
      },
      message: {
        eng: `The payment for the service has been refunded.`,
        span: `El pago del servicio ha sido reembolsado.`
      },
      user: originalTx.receiveUser,
      userType: originalTx.receiveUserType,
      types: 'service',
      getId: serviceId,
    });

    return { success: true, transaction: newTransaction };

  } catch (error) {
    // Log =====
    const newTask = {
      admin: userId,
      email: emailAuth,
      description: `Refund failed: Service ID ${serviceId},  ${error.message || "An unexpected error occurred"}.`,
      types: "Failed",
      activity: "task",
      status: "Error",
    };
    await LogsDashboardService.createTaskDB(newTask)
    // =====
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, error.message || "Failed to process refund.");
  }
};

//Create Connect account ===================== 
const createAndUpdateConnectedAccount = async (req, res) => {
  try {
    const { userId, role, accountId } = req.query;

    console.log("rtr", userId, role)

    if (!userId || !role) {
      throw new ApiError(400, "UserId and role not found!");
    }

    let existingUser;
    if (role === "USER") {
      existingUser = await User.findById(userId);
    } else if (role === "PARTNER") {
      existingUser = await Partner.findById(userId);
    }
    if (!existingUser) {
      throw new ApiError(httpStatus.NOT_FOUND, `${role} not found.`);
    }

    let accountLink;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "MX",
        // dob: { day: 1, month: 1, year: 1990 },
        email: existingUser?.email,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
      });

      accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${DOMAIN_URL}/payment/stripe_bank/create?userId=${userId}&role=${role}`,
        return_url: `${DOMAIN_URL}/payment/stripe_bank/success?userId=${userId}&role=${role}&accountId=${account.id}`,
        type: "account_onboarding",

      });
    } else {
      accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${DOMAIN_URL}/payment/stripe_bank/create?userId=${userId}&role=${role}&accountId=${accountId}`,
        return_url: `${DOMAIN_URL}/payment/stripe_bank/success/update?userId=${userId}&role=${role}&accountId=${accountId}`,
        type: "account_onboarding",
      });
    }

    return { url: accountLink.url };

  } catch (error) {
    console.error("Stripe Error:", error);
    throw new ApiError(error.statusCode || 500, error.message || "Internal Server Error");
  }
};

const saveStripeAccount = async (req, res) => {
  try {
    const { userId, role, accountId } = req.query;

    if (!userId || !role || !accountId) {
      return res.status(400).json({ message: "Missing query parameters" });
    }

    let user;
    let userType;
    if (role === "USER") {
      userType = "User";
      user = await User.findById(userId);
    } else if (role === "PARTNER") {
      userType = "Partner";
      user = await Partner.findById(userId);
    }
    if (!user) return res.status(404).json({ message: `${role} not found.` });

    const account = await stripe.accounts.retrieve(accountId);
    console.log("account", account)

    if (!account.details_submitted) {
      return res.status(400).json({ message: "Onboarding not completed" });
    }

    const individual = account?.individual;
    const bank_info = account.external_accounts?.data[0] || {};
    const business_name = `${individual?.first_name} ${individual?.last_name}`

    console.log("=======", bank_info)
    console.log("account", account.individual)

    const newStripeAccount = StripeAccount({
      name: user?.name || "Unknown",
      email: user?.email,
      user: userId,
      userType: userType,
      stripeAccountId: accountId,
      externalAccountId: account.external_accounts?.data[0]?.id,
      bank_info: {
        bank_name: bank_info?.bank_name,
        account_holder_name: bank_info?.account_holder_name || user?.name,
        account_number: "****" + bank_info?.last4,
        routing_number: bank_info?.routing_number || null,
        country: bank_info?.country || "MX",
        currency: bank_info?.currency || "mxn",
      },
      business_profile: {
        business_name: business_name || user.name,
        website: bank_info?.url || "www.example.com",
      },
    });

    newStripeAccount.save()

    if (role === "USER") {
      await User.findByIdAndUpdate(
        userId,
        {
          bank_name: bank_info?.bank_name || null,
          bank_holder_name: bank_info?.account_holder_name || user?.name,
          bank_account_number: bank_info?.last4 ? "****" + bank_info.last4 : null,
          routing_number: bank_info?.routing_number || null,
        },
        { new: true }
      );
    } else if (role === "PARTNER") {
      await Partner.findByIdAndUpdate(
        userId,
        {
          bank_name: bank_info?.bank_name || null,
          bank_holder_name: bank_info?.account_holder_name || user?.name,
          bank_account_number: bank_info?.last4 ? "****" + bank_info.last4 : null,
          routing_number: bank_info?.routing_number || null,
        },
        { new: true }
      );
    }

    return newStripeAccount;
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

const updateStripeAccount = async (req, res) => {
  try {
    const { userId, role, accountId } = req.query;

    if (!userId || !role || !accountId) {
      throw new ApiError(400, "Missing query parameters")
    }

    let user;
    if (role === "USER") {
      user = await User.findById(userId);
    } else if (role === "PARTNER") {
      user = await Partner.findById(userId);
    }

    if (!user) throw new ApiError(400, `${role} not found.`)

    const account = await stripe.accounts.retrieve(accountId);

    console.log("========", account)

    if (!account?.individual) throw new ApiError(400, 'Stripe account not found.')

    const individual = account?.individual;
    const bank_info = account.external_accounts?.data[0] || {};
    const business_name = `${individual?.first_name} ${individual?.last_name}`

    const newStripeAccount = await StripeAccount.findOneAndUpdate(
      { user: userId, stripeAccountId: accountId },
      {
        name: user?.name || "Unknown",
        bank_info: {
          bank_name: bank_info?.bank_name || null,
          account_holder_name: bank_info?.account_holder_name || user?.name,
          account_number: bank_info?.last4 ? "****" + bank_info.last4 : null,
          routing_number: bank_info?.routing_number || null,
          country: bank_info?.country || "MX",
          currency: bank_info?.currency || "mxn",
        },
        business_profile: {
          business_name: business_name || user.name,
          website: bank_info?.url || "www.example.com",
        },
      },
      { new: true }
    );

    if (role === "USER") {
      await User.findByIdAndUpdate(
        userId,
        {
          bank_name: bank_info?.bank_name || null,
          bank_holder_name: bank_info?.account_holder_name || user?.name,
          bank_account_number: bank_info?.last4 ? "****" + bank_info.last4 : null,
          routing_number: bank_info?.routing_number || null,
        },
        { new: true }
      );
    } else if (role === "PARTNER") {
      await Partner.findByIdAndUpdate(
        userId,
        {
          bank_name: bank_info?.bank_name || null,
          bank_holder_name: bank_info?.account_holder_name || user?.name,
          bank_account_number: bank_info?.last4 ? "****" + bank_info.last4 : null,
          routing_number: bank_info?.routing_number || null,
        },
        { new: true }
      );
    }



    return newStripeAccount;
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =================== 
const TransferBalance = async ({ bankAccount, amount }) => {
  // try {
  //   if (!bankAccount || !bankAccount.stripeAccountId || !bankAccount.externalAccountId) {
  //     throw new ApiError(400, "Invalid bank account data provided!");
  //   }

  //   if (!amount || isNaN(amount) || amount <= 0) {
  //     throw new ApiError(400, "Invalid transfer amount!");
  //   }
  //   const amountInCent = amount * 100;

  //   const transfer = await stripe.transfers.create({
  //     amount: amountInCent,
  //     currency: 'mxn',
  //     destination: bankAccount.stripeAccountId,
  //   });

  //   // const balance = await stripe.balance.retrieve({
  //   //   stripeAccount: bankAccount.stripeAccountId,  
  //   // });

  //   // Payout to bank
  //   const payout = await stripe.payouts.create(
  //     {
  //       amount: amountInCent,
  //       currency: 'mxn',
  //     },
  //     {
  //       stripeAccount: bankAccount.stripeAccountId,
  //     },
  //   );

  //   if (!payout) {
  //     throw new ApiError(500, "Failed to complete the payout.");
  //   }

  //   return payout;

  // } catch (error) {
  //   if (error.code === 'balance_insufficient') {
  //     throw new ApiError(400, "Insufficient funds in Stripe balance. Please wait for payments are available.");
  //   }
  //   console.error("Payout Error:", error);
  //   throw new ApiError(500, "Internal server error: " + error.message);
  // }
};




//Bank Transfer Payment ------------
const PaymentService = {
  createAndUpdateConnectedAccount,
  createCheckoutSessionStripe,
  paymentStatusCancel,
  stripeCheckAndUpdateStatusSuccess,
  stripeRefundPayment,
  TransferBalance,
  saveStripeAccount,
  updateStripeAccount
}

module.exports = PaymentService;

