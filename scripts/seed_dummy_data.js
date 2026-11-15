const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../src/app/modules/user/user.model');
const Partner = require('../src/app/modules/partner/partner.model');
const Admin = require('../src/app/modules/admin/admin.model');
const Category = require('../src/app/modules/category/category.model');
const Services = require('../src/app/modules/services/services.model');
const { Bids, FileClaim, Review } = require('../src/app/modules/bid/bid.model');
const { Transaction } = require('../src/app/modules/payment/payment.model');
const Variable = require('../src/app/modules/variable/variable.model');

async function seed() {
  const url = process.env.MONGO_URL;
  if (!url) {
    throw new Error("MONGO_URL not configured in .env");
  }

  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  console.log("Connected successfully!");

  // 1. Ensure Platform Variables exist
  const existingVars = await Variable.findOne();
  if (!existingVars) {
    console.log("Seeding default platform variables...");
    await Variable.create({
      surcharge: 10,
      coverageRadius: 60,
      minimumStartFee: 25,
      maximumStartFee: 200,
      minimumWeightLoad: 50,
      maximumWeightLoad: 8000,
      minimumDurationFee: 15,
      maximumDistanceOfFee: 150,
      perDollarMexicanPeso: 20,
    });
    console.log("Default variables created.");
  } else {
    console.log("Variables already exist.");
  }

  // 2. Fetch Users, Partners, and Admins
  const users = await User.find().limit(5);
  const partners = await Partner.find().limit(5);
  const admin = await Admin.findOne();

  if (users.length === 0 || partners.length === 0) {
    console.error("Missing users or partners in database! Please ensure at least 1 user and 1 partner exist.");
    process.exit(1);
  }

  // Update empty profile images for users if needed
  if (!users[0].profile_image) {
    users[0].profile_image = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80";
    await users[0].save();
    console.log(`Updated profile image for user: ${users[0].name}`);
  }

  // 3. Seed Categories if none exist
  let categories = await Category.find();
  if (categories.length === 0) {
    console.log("Seeding categories...");
    const sampleCategories = [
      // Goods (Move)
      {
        serviceType: 'move',
        subServiceType: 'Goods',
        category: 'Furniture & Home Appliances',
        category_spain: 'Muebles y Electrodomésticos',
        markupType: 'percentage',
        markupValue: 12,
      },
      {
        serviceType: 'move',
        subServiceType: 'Goods',
        category: 'Office & Industrial Equipment',
        category_spain: 'Equipo de Oficina e Industrial',
        markupType: 'fixed',
        markupValue: 35,
      },
      // Waste (Move)
      {
        serviceType: 'move',
        subServiceType: 'Waste',
        category: 'Construction Debris & Rubble',
        category_spain: 'Escombros de Construcción',
        markupType: 'percentage',
        markupValue: 15,
      },
      {
        serviceType: 'move',
        subServiceType: 'Waste',
        category: 'General Bulky Household Waste',
        category_spain: 'Residuos Domésticos Voluminosos',
        markupType: 'percentage',
        markupValue: 10,
      },
      // Recyclable materials (Sell)
      {
        serviceType: 'sell',
        subServiceType: 'Recyclable materials',
        category: 'Scrap Metal & Heavy Copper',
        category_spain: 'Chatarra y Cobre Pesado',
        markupType: 'fixed',
        markupValue: 20,
      },
      {
        serviceType: 'sell',
        subServiceType: 'Recyclable materials',
        category: 'Cardboard & Industrial Plastics',
        category_spain: 'Cartón y Plásticos Industriales',
        markupType: 'percentage',
        markupValue: 8,
      },
      // Second-hand items (Sell)
      {
        serviceType: 'sell',
        subServiceType: 'Second-hand items',
        category: 'Pre-owned Furniture & Sofas',
        category_spain: 'Muebles y Sillones de Segunda Mano',
        markupType: 'percentage',
        markupValue: 10,
      },
      {
        serviceType: 'sell',
        subServiceType: 'Second-hand items',
        category: 'Vintage Electronics & Hardware',
        category_spain: 'Electrónica y Hardware Vintage',
        markupType: 'fixed',
        markupValue: 18,
      },
    ];

    categories = await Category.insertMany(sampleCategories);
    console.log(`Created ${categories.length} categories.`);
  } else {
    console.log(`Found ${categories.length} existing categories.`);
  }

  // 4. Seed Services (Auctions)
  let services = await Services.find();
  if (services.length === 0) {
    console.log("Seeding services/auctions...");
    const sampleServices = [
      {
        user: users[0]._id,
        confirmedPartner: partners[0]._id,
        mainService: 'move',
        service: 'Goods',
        category: [categories[0]._id],
        scheduleDate: new Date(Date.now() + 86400000 * 2),
        scheduleTime: '10:00 AM',
        numberOfItems: 14,
        weightMTS: '1.5',
        weightKG: 1500,
        description: 'Full 2-bedroom apartment furniture relocation including sectional sofa, refrigerator, washer, and dining set.',
        deadlineDate: new Date(Date.now() + 86400000 * 1),
        deadlineTime: '06:00 PM',
        price: 320,
        bestBid: 290,
        winBid: 290,
        isLoaderNeeded: true,
        loadFloorNo: 2,
        loadingAddress: 'Av. Paseo de la Reforma 222, Juárez, Cuauhtémoc, CDMX',
        loadingLocation: {
          type: 'Point',
          coordinates: [-99.1623, 19.4294],
        },
        unloadingAddress: 'Av. Insurgentes Sur 1602, Crédito Constructor, Benito Juárez, CDMX',
        unloadingLocation: {
          type: 'Point',
          coordinates: [-99.1812, 19.3621],
        },
        image: [
          'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'in-progress',
        paymentStatus: 'paid',
        paymentMethod: 'Stripe',
        transactionId: 'TXN-98421094',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000 * 3),
        distance: 8.5,
      },
      {
        user: (users[1] || users[0])._id,
        confirmedPartner: partners[0]._id,
        mainService: 'move',
        service: 'Waste',
        category: [categories[2] ? categories[2]._id : categories[0]._id],
        scheduleDate: new Date(Date.now() + 86400000 * 4),
        scheduleTime: '09:00 AM',
        numberOfItems: 25,
        weightMTS: '3.2',
        weightKG: 3200,
        description: 'Construction debris removal after kitchen remodel: drywalls, tile pieces, concrete fragments, and timber frames.',
        deadlineDate: new Date(Date.now() + 86400000 * 3),
        deadlineTime: '04:00 PM',
        price: 450,
        bestBid: 410,
        winBid: 410,
        isLoaderNeeded: true,
        loadFloorNo: 1,
        loadingAddress: 'Calle Durango 187, Roma Norte, Cuauhtémoc, CDMX',
        loadingLocation: {
          type: 'Point',
          coordinates: [-99.1654, 19.4187],
        },
        unloadingAddress: 'Carretera Federal México-Toluca KM 22, Cuajimalpa, CDMX',
        unloadingLocation: {
          type: 'Point',
          coordinates: [-99.2841, 19.3512],
        },
        image: [
          'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'accepted',
        paymentStatus: 'paid',
        paymentMethod: 'PayPal',
        transactionId: 'TXN-74128963',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000 * 5),
        distance: 19.2,
      },
      {
        user: users[0]._id,
        confirmedPartner: (partners[1] || partners[0])._id,
        mainService: 'sell',
        service: 'Second-hand items',
        category: [categories[6] ? categories[6]._id : categories[0]._id],
        scheduleDate: new Date(Date.now() - 86400000 * 2),
        scheduleTime: '02:00 PM',
        numberOfItems: 6,
        weightMTS: '0.8',
        weightKG: 800,
        description: 'Solid oak dining table with 6 matching upholstered chairs in excellent condition ready for consignment pickup.',
        deadlineDate: new Date(Date.now() - 86400000 * 3),
        deadlineTime: '12:00 PM',
        price: 600,
        bestBid: 580,
        winBid: 580,
        isLoaderNeeded: false,
        loadFloorNo: 1,
        loadingAddress: 'Av. Horacio 1520, Polanco, Miguel Hidalgo, CDMX',
        loadingLocation: {
          type: 'Point',
          coordinates: [-99.2012, 19.4345],
        },
        unloadingAddress: 'Av. División del Norte 2462, Portales Norte, Benito Juárez, CDMX',
        unloadingLocation: {
          type: 'Point',
          coordinates: [-99.1587, 19.3684],
        },
        image: [
          'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'completed',
        paymentStatus: 'paid',
        paymentMethod: 'BankTransfer',
        transactionId: 'TXN-31298451',
        startDate: new Date(Date.now() - 86400000 * 5),
        endDate: new Date(Date.now() - 86400000 * 1),
        distance: 14.8,
      },
      {
        user: (users[2] || users[0])._id,
        confirmedPartner: null,
        mainService: 'move',
        service: 'Goods',
        category: [categories[1] ? categories[1]._id : categories[0]._id],
        scheduleDate: new Date(Date.now() + 86400000 * 6),
        scheduleTime: '11:30 AM',
        numberOfItems: 8,
        weightMTS: '2.1',
        weightKG: 2100,
        description: 'Corporate server racks and high-density network switches transfer between branch headquarters.',
        deadlineDate: new Date(Date.now() + 86400000 * 2),
        deadlineTime: '05:00 PM',
        price: 750,
        bestBid: 680,
        isLoaderNeeded: true,
        loadFloorNo: 4,
        loadingAddress: 'Av. Santa Fe 495, Cruz Manca, Cuajimalpa, CDMX',
        loadingLocation: {
          type: 'Point',
          coordinates: [-99.2587, 19.3612],
        },
        unloadingAddress: 'Av. Revolución 1425, Tlacopac, Álvaro Obregón, CDMX',
        unloadingLocation: {
          type: 'Point',
          coordinates: [-99.1912, 19.3587],
        },
        image: [
          'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'pending',
        paymentStatus: 'pending',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000 * 7),
        distance: 11.4,
      },
      {
        user: users[0]._id,
        confirmedPartner: partners[0]._id,
        mainService: 'sell',
        service: 'Recyclable materials',
        category: [categories[4] ? categories[4]._id : categories[0]._id],
        scheduleDate: new Date(Date.now() + 86400000 * 3),
        scheduleTime: '08:00 AM',
        numberOfItems: 40,
        weightMTS: '4.5',
        weightKG: 4500,
        description: 'Sorted industrial copper piping, brass fixtures, and aluminum extrusions collected from commercial renovation.',
        deadlineDate: new Date(Date.now() + 86400000 * 1),
        deadlineTime: '03:00 PM',
        price: 1200,
        bestBid: 1150,
        winBid: 1150,
        isLoaderNeeded: true,
        loadFloorNo: 1,
        loadingAddress: 'Calzada Vallejo 1110, Industrial Vallejo, Azcapotzalco, CDMX',
        loadingLocation: {
          type: 'Point',
          coordinates: [-99.1678, 19.4921],
        },
        unloadingAddress: 'Av. Ceylán 485, Cosmopolita, Azcapotzalco, CDMX',
        unloadingLocation: {
          type: 'Point',
          coordinates: [-99.1723, 19.4754],
        },
        image: [
          'https://images.unsplash.com/photo-1605600659873-d808a13e4d2a?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'accepted',
        paymentStatus: 'paid',
        paymentMethod: 'Stripe',
        transactionId: 'TXN-82019483',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000 * 4),
        distance: 6.2,
      },
    ];

    services = await Services.insertMany(sampleServices);
    console.log(`Created ${services.length} services/auctions.`);
  } else {
    console.log(`Found ${services.length} existing services.`);
  }

  // 5. Seed Bids
  let bids = await Bids.find();
  if (bids.length === 0) {
    console.log("Seeding bids...");
    const sampleBids = [
      {
        service: services[0]._id,
        partner: partners[0]._id,
        serviceType: 'Goods',
        price: 290,
        status: 'Win',
      },
      {
        service: services[1]._id,
        partner: partners[0]._id,
        serviceType: 'Waste',
        price: 410,
        status: 'Win',
      },
      {
        service: services[2]._id,
        partner: (partners[1] || partners[0])._id,
        serviceType: 'Second-hand items',
        price: 580,
        status: 'Win',
      },
      {
        service: services[3]._id,
        partner: partners[0]._id,
        serviceType: 'Goods',
        price: 680,
        status: 'Pending',
      },
      {
        service: services[4]._id,
        partner: partners[0]._id,
        serviceType: 'Recyclable materials',
        price: 1150,
        status: 'Win',
      },
    ];
    bids = await Bids.insertMany(sampleBids);
    console.log(`Created ${bids.length} bids.`);
  }

  // 6. Seed FileClaims (Disputes & Claims)
  let claims = await FileClaim.find();
  if (claims.length === 0) {
    console.log("Seeding file claims...");
    const sampleClaims = [
      {
        serviceId: services[0]._id,
        user: users[0]._id,
        userType: 'User',
        name: users[0].name,
        orderId: String(services[0]._id),
        claimType: 'DAMAGES',
        isDuringActiveService: true,
        description: 'Dining room table leg was fractured and the leather recliner sofa suffered severe scratches during loading maneuvers.',
        fileClaimImage: [
          'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80',
          'https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'pending',
        adminNotes: [
          {
            adminId: admin ? admin._id : undefined,
            note: 'Requested photo verification of damaged furniture leg before transit vs post transit.',
            createdAt: new Date(Date.now() - 3600000 * 4),
          },
        ],
      },
      {
        serviceId: services[1]._id,
        user: partners[0]._id,
        userType: 'Partner',
        name: partners[0].name,
        orderId: String(services[1]._id),
        claimType: 'PRICE_DISCREPANCY',
        isDuringActiveService: false,
        description: 'Customer added 12 extra cement sacks and hazardous paint cans not listed in original order description. Demanding cargo surcharge compensation.',
        fileClaimImage: [
          'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'in-progress',
        adminNotes: [
          {
            adminId: admin ? admin._id : undefined,
            note: 'Customer contacted to confirm additional weight. Weight scale tickets requested.',
            createdAt: new Date(Date.now() - 3600000 * 12),
          },
        ],
      },
      {
        serviceId: services[2]._id,
        user: users[0]._id,
        userType: 'User',
        name: users[0].name,
        orderId: String(services[2]._id),
        claimType: 'SERVICE_NON_COMPLIANCE',
        isDuringActiveService: false,
        description: 'Partner showed up 3.5 hours late without proper protective blankets or strapping, risking consignment goods.',
        fileClaimImage: [
          'https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'resolved',
        adminNotes: [
          {
            adminId: admin ? admin._id : undefined,
            note: 'GPS timeline confirms delayed arrival by partner. Penalty fine calculated.',
            createdAt: new Date(Date.now() - 86400000 * 1),
          },
        ],
        finalDecision: {
          resolutionType: 'PENALTY_APPLIED',
          decisionNotes: 'Applied $45 partner delay surcharge penalty and remitted courtesy voucher to user.',
          penaltyOrRefundAmount: 45,
          resolvedAt: new Date(),
          resolvedBy: admin ? admin._id : undefined,
        },
      },
      {
        serviceId: services[4]._id,
        user: (users[1] || users[0])._id,
        userType: 'User',
        name: (users[1] || users[0]).name,
        orderId: String(services[4]._id),
        claimType: 'LOCATION_PROBLEM',
        isDuringActiveService: false,
        description: 'Unloaded recyclable pallets at adjacent private warehouse dock without authorization, resulting in gate impound fees.',
        fileClaimImage: [
          'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80',
        ],
        status: 'resolved',
        adminNotes: [
          {
            adminId: admin ? admin._id : undefined,
            note: 'Gate security receipt inspected and reimbursed to customer.',
            createdAt: new Date(Date.now() - 86400000 * 2),
          },
        ],
        finalDecision: {
          resolutionType: 'REFUND',
          decisionNotes: 'Full refund of impound gate charge ($80 USD) issued back to user account.',
          penaltyOrRefundAmount: 80,
          resolvedAt: new Date(Date.now() - 86400000 * 1),
          resolvedBy: admin ? admin._id : undefined,
        },
      },
      {
        serviceId: services[0]._id,
        user: users[0]._id,
        userType: 'User',
        name: users[0].name,
        orderId: String(services[0]._id),
        claimType: 'CANCELLATION_ISSUE',
        isDuringActiveService: false,
        description: 'Customer claims partner cancelled initial slot without rescheduling notice.',
        fileClaimImage: [],
        status: 'rejected',
        adminNotes: [
          {
            adminId: admin ? admin._id : undefined,
            note: 'Chat logs show user explicitly accepted reschedule via in-app conversation.',
            createdAt: new Date(Date.now() - 3600000 * 8),
          },
        ],
        finalDecision: {
          resolutionType: 'DISMISSED',
          decisionNotes: 'Evidence verifies mutual consent for rescheduled slot. Claim dismissed.',
          penaltyOrRefundAmount: 0,
          resolvedAt: new Date(),
          resolvedBy: admin ? admin._id : undefined,
        },
      },
    ];

    claims = await FileClaim.insertMany(sampleClaims);
    console.log(`Created ${claims.length} file claims.`);
  } else {
    console.log(`Found ${claims.length} existing file claims.`);
  }

  // 7. Seed Transactions
  let transactions = await Transaction.find();
  if (transactions.length === 0) {
    console.log("Seeding transactions...");
    const sampleTransactions = [
      {
        serviceId: services[0]._id,
        payUserType: 'User',
        payUser: users[0]._id,
        receiveUserType: 'Partner',
        receiveUser: partners[0]._id,
        amount: 290,
        partnerAmount: 261,
        paymentMethod: 'Stripe',
        transactionId: 'TXN-98421094',
        paymentStatus: 'Completed',
        isFinish: true,
        payType: 'move',
      },
      {
        serviceId: services[1]._id,
        payUserType: 'User',
        payUser: (users[1] || users[0])._id,
        receiveUserType: 'Partner',
        receiveUser: partners[0]._id,
        amount: 410,
        partnerAmount: 369,
        paymentMethod: 'PayPal',
        transactionId: 'TXN-74128963',
        paymentStatus: 'Completed',
        isFinish: true,
        payType: 'move',
      },
      {
        serviceId: services[2]._id,
        payUserType: 'User',
        payUser: users[0]._id,
        receiveUserType: 'Partner',
        receiveUser: (partners[1] || partners[0])._id,
        amount: 580,
        partnerAmount: 522,
        paymentMethod: 'BankTransfer',
        transactionId: 'TXN-31298451',
        paymentStatus: 'Completed',
        isFinish: true,
        payType: 'sell',
      },
      {
        serviceId: services[4]._id,
        payUserType: 'User',
        payUser: users[0]._id,
        receiveUserType: 'Partner',
        receiveUser: partners[0]._id,
        amount: 1150,
        partnerAmount: 1035,
        paymentMethod: 'Stripe',
        transactionId: 'TXN-82019483',
        paymentStatus: 'Completed',
        isFinish: true,
        payType: 'sell',
      },
    ];

    transactions = await Transaction.insertMany(sampleTransactions);
    console.log(`Created ${transactions.length} transactions.`);
  } else {
    console.log(`Found ${transactions.length} existing transactions.`);
  }

  // 8. Seed Reviews
  let reviews = await Review.find();
  if (reviews.length === 0) {
    console.log("Seeding reviews...");
    const sampleReviews = [
      {
        serviceId: services[2]._id,
        partnerId: (partners[1] || partners[0])._id,
        userId: users[0]._id,
        rating: 5,
        comment: 'Excellent, punctual service. Everything arrived safely and was handled with great care!',
      },
      {
        serviceId: services[0]._id,
        partnerId: partners[0]._id,
        userId: users[0]._id,
        rating: 4,
        comment: 'Good communication and smooth truck dispatch despite rain.',
      },
    ];
    reviews = await Review.insertMany(sampleReviews);
    console.log(`Created ${reviews.length} reviews.`);
  }

  console.log("\n============================================");
  console.log("✅ DUMMY DATA SEEDING COMPLETE!");
  console.log("============================================");
  console.log(`- Categories: ${categories.length}`);
  console.log(`- Services / Auctions: ${services.length}`);
  console.log(`- Bids: ${bids.length}`);
  console.log(`- File Claims: ${claims.length}`);
  console.log(`- Transactions: ${transactions.length}`);
  console.log(`- Reviews: ${reviews.length}`);

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});

