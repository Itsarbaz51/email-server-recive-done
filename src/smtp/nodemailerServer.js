export const getMailTransporter = async (email, password) => {
  console.log(`Creating transporter for: ${email}`);

<<<<<<< HEAD
export const getMailTransporter = async (fullEmail, rawPassword) => {
  console.log("getMailTransporter called for:", fullEmail);

  const [username, domainPart] = fullEmail.split("@");

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

  const smtpHost = `mail.${domainName}`; // FIXED
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpSecure = process.env.SMTP_SECURE === "true";

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: fullEmail,
      pass: rawPassword,
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

=======
>>>>>>> 92ac26b9a242ea50d0a9b68ae94907f816d73c08
  try {
    const mailbox = await Prisma.mailbox.findFirst({
      where: {
        address: email.toLowerCase(),
        domain: { verified: true },
      },
    });

    if (!mailbox) {
      throw new Error("Mailbox not found or domain not verified");
    }

    const transporter = nodemailer.createTransport({
      host: "13.203.241.137",
      port: 25,
      secure: false,
      auth: {
        user: email,
        pass: password || decrypt(mailbox.smtpPasswordEncrypted),
      },
      tls: {
        rejectUnauthorized: false, // टेस्टिंग के लिए
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
    });

    console.log("Verifying transporter...");
    await transporter.verify();
    console.log("Transporter verified successfully");

    return transporter;
  } catch (error) {
    console.error("Transporter creation failed:", error);
    throw new Error(`Failed to create transporter: ${error.message}`);
  }
};
