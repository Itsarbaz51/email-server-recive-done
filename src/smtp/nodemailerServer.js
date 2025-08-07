import nodemailer from "nodemailer";
import Prisma from "../db/db.js";
import { decrypt } from "../utils/encryption.js";

export const getMailTransporter = async (fullEmail, rawPassword) => {
  console.log("getMailTransporter called for:", fullEmail);

  console.log("Parsing email address:", fullEmail);
  console.log("Raw password provided:", rawPassword);

  const [username, domainPart] = fullEmail.split("@");
  console.log("Parsed username:", username, "domainPart:", domainPart);

  if (!username || !domainPart) {
    throw new Error("Invalid email format");
  }

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: username,
      domain: {
        name: domainPart,
        verified: true,
      },
    },
    include: {
      domain: {
        select: {
          name: true,
          dkimPrivateKey: true,
          dkimSelector: true,
        },
      },
    },
  });

  if (!mailbox) {
    throw new Error("Mailbox not found or domain not verified");
  }

  if (!mailbox.domain?.dkimPrivateKey) {
    throw new Error("Domain DKIM key not configured");
  }

  const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;

  const smtpHost = `mail.${domainName}`; // ✅ dynamic SMTP hostname
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpSecure = process.env.SMTP_SECURE === "true";

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: fullEmail,
      pass: rawPassword || decrypt(mailbox.smtpPasswordEncrypted),
    },
    dkim: {
      domainName,
      keySelector: dkimSelector || "dkim",
      privateKey: dkimPrivateKey,
    },
    tls: {
      rejectUnauthorized: false,
    },
    pool: false,
    maxConnections: 1,
    maxMessages: 1,
  });

  try {
    console.log("Verifying transporter...");
    await transporter.verify();
    console.log("✅ Transporter verified for", fullEmail);
    return transporter;
  } catch (error) {
    console.error("❌ Transporter verification failed:", error);
    throw new Error(`Failed to create transporter: ${error.message}`);
  }
};
