const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Services = require('../src/app/modules/services/services.model');
const { FileClaim } = require('../src/app/modules/bid/bid.model');
const { deriveClaimStatus } = require('../src/helpers/claimStatus');

async function backfill() {
  const url = process.env.MONGO_URL;
  if (!url) {
    throw new Error("MONGO_URL not found in .env");
  }

  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  console.log("Connected successfully!\n");

  const allServices = await Services.find({}, '_id status claimStatus activeClaimId').lean();
  console.log(`Found ${allServices.length} total services in database.\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const service of allServices) {
    // Find all claims filed against this service
    const claims = await FileClaim.find({ serviceId: service._id }).sort({ createdAt: -1 }).select('status').lean();

    const { claimStatus: targetStatus, activeClaimId: targetClaimId } =
      deriveClaimStatus(claims);

    const currentClaimStatus = service.claimStatus || "none";
    const currentClaimId = service.activeClaimId ? String(service.activeClaimId) : null;
    const newClaimId = targetClaimId ? String(targetClaimId) : null;

    if (currentClaimStatus !== targetStatus || currentClaimId !== newClaimId) {
      await Services.updateOne(
        { _id: service._id },
        {
          $set: {
            claimStatus: targetStatus,
            activeClaimId: targetClaimId,
          },
        }
      );

      console.log(`[UPDATED] Service ${service._id}:`);
      console.log(`  - claimStatus: "${currentClaimStatus}" -> "${targetStatus}"`);
      console.log(`  - activeClaimId: ${currentClaimId} -> ${newClaimId}`);
      console.log(`  - Total claims found: ${claims.length}`);
      updatedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log("\n============================================");
  console.log("BACKFILL COMPLETED SUCCESSFULLY");
  console.log("============================================");
  console.log(`Total services processed: ${allServices.length}`);
  console.log(`Updated services:         ${updatedCount}`);
  console.log(`Already in-sync services: ${skippedCount}`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

backfill().catch(err => {
  console.error("Backfill failed with error:", err);
  process.exit(1);
});
