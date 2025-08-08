import dns from "dns/promises";
import axios from "axios";
import Prisma from "../db/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

export const addDomain = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const userId = req.user.id;
  console.log(`Adding domain: ${name} for user: ${userId}`);
  

  if (!name || !userId) {
    throw new ApiError(400, "Domain name and user ID required");
  }

  // Check for existing domain
  const exists = await Prisma.domain.findUnique({ where: { name } });
  if (exists) throw new ApiError(409, "Domain already exists");

  // Step 1: Fetch SendGrid DNS records
  const sendgridData = await getSendGridDNSRecords(name);

  // Step 2: Create domain in DB
  const domain = await Prisma.domain.create({
    data: {
      name,
      userId,
      sendgridDomainId: sendgridData.id.toString(),
      verified: false,
    },
  });

  // Step 3: Generate all DNS records (MX + SendGrid DKIM + CNAME + SPF)
  const dnsRecords = [
    {
      type: "MX",
      name: name,
      value: "mail.yoursaas.com",
      priority: 10,
      domainId: domain.id,
    },
    ...sendgridData.dns.map((r) => ({
      type: r.record_type,
      name: r.host,
      value: r.data,
      priority: r.priority || null,
      domainId: domain.id,
    })),
  ];

  // Step 4: Save DNS records
  await Prisma.dnsRecord.createMany({ data: dnsRecords });

  return res.status(201).json(
    new ApiResponse(201, "Domain added and DNS records saved", {
      domain,
      dnsRecords,
    })
  );
});

export const verifyDomain = asyncHandler(async (req, res) => {
  const { domainId } = req.params;

  const domain = await Prisma.domain.findUnique({
    where: { id: domainId },
    include: { dnsRecords: true },
  });

  if (!domain) throw new ApiError(404, "Domain not found");

  let allValid = true;

  for (const record of domain.dnsRecords) {
    const isValid = await verifyDnsRecord(record);
    if (!isValid) allValid = false;

    await Prisma.dnsRecord.update({
      where: { id: record.id },
      data: { verified: isValid },
    });
  }

  // ✅ Step: Also validate in SendGrid API
  if (domain.sendgridDomainId) {
    try {
      const sendgridRes = await validateDomain(domain.sendgridDomainId);
      if (!sendgridRes.valid) allValid = false;
    } catch (err) {
      console.error("SendGrid validation failed", err.response?.data || err);
      allValid = false;
    }
  }

  if (allValid) {
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
      const flattened = result.flat().map((r) => (Array.isArray(r) ? r.join("") : r));
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
    return response.data;
  } catch (err) {
    console.error("SendGrid DNS fetch failed", err.response?.data || err);
    throw new ApiError(500, "Failed to fetch SendGrid DNS records");
  }
}
