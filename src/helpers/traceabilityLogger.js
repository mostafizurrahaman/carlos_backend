// src/helpers/traceabilityLogger.js
const {
  SystemTraceabilityLog,
} = require("../app/modules/manage/legalAgreement.model");

const recordTraceability = async ({
  actorId,
  actorRole,
  actorEmail,
  actionType,
  targetEntity = null,
  targetId = null,
  ipAddress = null,
  deviceInfo = null,
  metaData = {},
}) => {
  try {
    await SystemTraceabilityLog.create({
      actorId,
      actorRole,
      actorEmail,
      actionType,
      targetEntity,
      targetId,
      ipAddress,
      deviceInfo,
      metaData,
    });
  } catch (err) {
    console.error("[Traceability Error]:", err.message);
  }
};

module.exports = { recordTraceability };
