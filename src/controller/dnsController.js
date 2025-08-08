import dns from "dns/promises";
import axios from "axios";
import Prisma from "../db/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { validateDomain } from "../smtp/sendgridService.js";

export const addDomain = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const userId = req.user.id;
  console.log(`Adding domain: ${name} for user: ${userId}`);

  if (!name || !userId) {
    throw new ApiError(400, "Domain name and user ID required");
  }

  // Check if domain already exists (compound unique)
  const exists = await Prisma.domain.findUnique({
    where: {
      name_adminId: {
        name,
        adminId: userId,
      },
    },
  });

  if (exists) {
    throw new ApiError(409, "Domain already exists");
  }

  // Create domain in SendGrid and get DNS records
  const sendgridData = await getSendGridDNSRecords(name);
  if (!sendgridData?.id || !sendgridData?.dns) {
    throw new ApiError(500, "Failed to get DNS records from SendGrid");
  }

  // Create domain in your DB
  const createdDomain = await Prisma.domain.create({
    data: {
      name,
      adminId: userId, // or userId: userId depending on schema
      sendgridDomainId: sendgridData.id.toString(),
      verified: false,
    },
  });

  // Convert SendGrid DNS object into array of DNS records
  const sendgridDNS = Object.entries(sendgridData.dns).map(([key, value]) => ({
    type: value?.type || "CNAME",
    name: value?.host || "",
    value: value?.data || "",
    ttl: value?.ttl || 3600,
    priority: null,
    domainId: createdDomain.id,
  }));

  // Add custom MX record for your platform
  const mxRecord = {
    type: "MX",
    name: name,
    value: "mail.yoursaas.com", // your mail server domain
    priority: 10,
    ttl: 3600,
    domainId: createdDomain.id,
  };

  const allRecords = [mxRecord, ...sendgridDNS];

  // Save DNS records to DB
  await Prisma.dnsRecord.createMany({
    data: allRecords,
  });

  return res.status(201).json(
    new ApiResponse(201, "Domain added and DNS records saved", {
      domain: createdDomain,
      dnsRecords: allRecords,
    })
  );
});

export const verifyDomain = asyncHandler(async (req, res) => {
  const { domainId } = req.params;

  const domain = await Prisma.domain.findFirst({
    where: { id: domainId },
    include: { dnsRecords: true },
  });

  if (!domain) throw new ApiError(404, "Domain not found");

  let allValid = true;

  // ✅ Step 1: Local DNS verification
  for (const record of domain.dnsRecords) {
    const isValid = await verifyDnsRecord(record);
    if (!isValid) allValid = false;

    await Prisma.dnsRecord.update({
      where: { id: record.id },
      data: { verified: isValid },
    });
  }

  // ✅ Step 2: SendGrid validation
  const sendgridRes = await validateDomain(domain.sendgridDomainId);
  console.log("sendgridRes", sendgridRes);

  if (sendgridRes && sendgridRes.validation_results) {
    const { dkim1, dkim2, mail_cname } = sendgridRes.validation_results;

    const sendgridResults = [
      { key: "s1._domainkey", result: dkim1 },
      { key: "s2._domainkey", result: dkim2 },
      { key: "em", result: mail_cname },
    ];

    for (const record of domain.dnsRecords) {
      const matching = sendgridResults.find((sg) =>
        record.name.includes(sg.key)
      );
      if (matching) {
        await Prisma.dnsRecord.update({
          where: { id: record.id },
          data: { verified: matching.result.valid },
        });
        if (!matching.result.valid) allValid = false;
      }
    }
  }

  if (allValid && sendgridRes?.valid) {
    await Prisma.domain.update({
      where: { id: domain.id },
      data: { verified: true },
    });
  }

  return res.status(200).json(
    new ApiResponse(200, "Domain DNS records verified", {
      domainVerified: allValid,
    })
  );
});

export async function verifyDnsRecord(record) {
  try {
    const result = await dns.resolve(record.name, record.type);

    if (record.type === "MX") {
      return result.some((r) => r.exchange === record.value);
    }

    if (record.type === "TXT") {
      const flattened = result
        .flat()
        .map((r) => (Array.isArray(r) ? r.join("") : r));
      return flattened.includes(record.value);
    }

    return result.includes(record.value);
  } catch (error) {
    return false;
  }
}

async function getSendGridDNSRecords(domain) {
  try {
    const response = await axios.post(
      "https://api.sendgrid.com/v3/whitelabel/domains",
      {
        domain,
        automatic_security: true,
        custom_spf: true,
        default: false,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("response", response);

    return response.data;
  } catch (err) {
    console.error("SendGrid DNS fetch failed", err.response?.data || err);
    throw new ApiError(500, "Failed to fetch SendGrid DNS records");
  }
}
