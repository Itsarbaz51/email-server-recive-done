import nodemailer from "nodemailer";
import Prisma from "../db/db.js";
import { decrypt } from "../utils/encryption.js";

export const getMailTransporter = async (fullEmail, rawPassword) => {
  console.log("Parsing email address:", fullEmail);
  console.log("Raw password provided:", rawPassword);

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: fullEmail,
      domain: {
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
    port: 587,
    secure: smtpSecure,
    auth: {
      user: fullEmail,
      pass: rawPassword || decrypt(mailbox.smtpPasswordEncrypted),
    },
    tls: {
      rejectUnauthorized: false,
    },

    logger: true, // Add this
    debug: true,
  });

  try {
    console.log("Verifying transporter...", transporter);
    await transporter.verify();
    console.log("✅ Transporter verified for", fullEmail);
    return transporter;
  } catch (error) {
    console.error("❌ Transporter verification failed:", error);
    throw new Error(`Failed to create transporter: ${error.message}`);
  }
};
