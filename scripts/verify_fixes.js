const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { ContactNumber } = require("../src/app/modules/manage/manage.model");
const Services = require("../src/app/modules/services/services.model");
const { FileClaim } = require("../src/app/modules/bid/bid.model");
const VariableCount = require("../src/app/modules/variable/variable.count");

async function verify() {
  console.log("Connecting to MongoDB Atlas...");
  await mongoose.connect(process.env.MONGO_URL || process.env.DATABASE_URL);
  console.log("Connected successfully!");

  // 1. Seed & verify contact number
  let contact = await VariableCount.getContactNumber();
  console.log("1. Contact number retrieved:", contact?.contact);

  // 2. Check FileClaim adminNotes stripping query
  const testClaim = await FileClaim.findOne({}).select("-adminNotes").lean();
  console.log("2. Claim query with select('-adminNotes'): adminNotes exists?", testClaim ? ("adminNotes" in testClaim) : "No claim found");

  // 3. Check Services claimStatus
  const services = await Services.find({}).select("_id claimStatus activeClaimId").lean();
  console.log(`3. Services found: ${services.length}. Sample:`, services.slice(0, 3));

  // 4. Verify payout hold check logic
  const openClaimExists = await FileClaim.exists({ status: { $in: ["pending", "in-progress"] } });
  console.log("4. Any open claims exist in DB?", Boolean(openClaimExists));

  await mongoose.disconnect();
  console.log("Verification finished cleanly.");
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
