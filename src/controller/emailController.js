import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import Prisma from "../db/db.js";
import { sendViaSendGrid } from "../smtp/sendgridService.js";

export const sendEmail = asyncHandler(async (req, res) => {
  const { from, to, subject, body } = req.body;
  const senderMailboxId = req.mailbox?.id;

  if (!from || !to || !subject || !body || !senderMailboxId) {
    throw new ApiError(400, "Missing required fields");
  }

  // Ensure sender owns the mailbox and the domain is verified
  const fromMailbox = await Prisma.mailbox.findFirst({
    where: {
      id: senderMailboxId,
      address: from.toLowerCase(),
      domain: {
        verified: true,
      },
    },
    include: {
      domain: { select: { name: true } },
    },
  });

  if (!fromMailbox) {
    throw new ApiError(403, "Unauthorized sender or domain not verified");
  }

  console.log(fromMailbox);
  
  const fromName = fromMailbox.name || "No Name";
  console.log(fromName, "is sending an email");

  try {
    // ✅ Send via SendGrid
    await sendViaSendGrid({
      from: {
        email: from,
        name: fromName,
      },
      to,
      subject,
      html: body,
    });

    // ✅ Store the message only if recipient mailbox exists
    const toMailbox = await Prisma.mailbox.findFirst({
      where: {
        address: to.toLowerCase(),
        domain: { verified: true },
      },
    });

    if (toMailbox) {
      await Prisma.message.create({
        data: {
          from,
          to,
          subject,
          body,
          mailboxId: toMailbox.id,
        },
      });
    }

    return res
      .status(201)
      .json(new ApiResponse(201, "Email sent successfully"));
  } catch (error) {
    console.error(
      "SendGrid send failed:",
      error.response?.body || error.message
    );
    throw new ApiError(500, `SendGrid send failed: ${error.message}`);
  }
});

export const getMessages = asyncHandler(async (req, res) => {
  const { mailboxId } = req.params;
  const userId = req.mailbox?.id;

  if (!userId) {
    throw new ApiError(401, "Authentication required");
  }

  const messages = await Prisma.message.findMany({
    where: {
      mailboxId,
      mailbox: { id: userId }, // Ensure mailbox belongs to user
    },
    include: { attachments: true },
    orderBy: { createdAt: "desc" },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "Messages retrieved successfully", messages));
});
