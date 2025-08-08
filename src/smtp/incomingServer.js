import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";
import { SMTPServer } from "smtp-server";
import { decrypt } from "../utils/encryption.js";

export const incomingServer = new SMTPServer({
  authOptional: false, 

  

  onConnect(session, callback) {
    console.log("📡 Client connected", session.id);
    callback();
  },

  // Mail from validation
  async onMailFrom(address, session, callback) {
    try {
      if (!address || !address.address) {
        return callback(new Error("Invalid sender address"));
      }

      console.log(`✉️ Mail from ${address.address}`);
      callback();
    } catch (err) {
      console.error("MailFrom error:", err);
      callback(err);
    }
  },

  // Recipient validation
  async onRcptTo(address, session, callback) {
    try {
      const to = address?.address?.toLowerCase();
      console.log(`✅ Valid recipient: ${to}`);
      callback();
    } catch (err) {
      console.error("RcptTo error:", err);
      callback(err);
    }
  },

  // Data processing
  async onData(stream, session, callback) {
    try {
      let rawEmail = Buffer.alloc(0);
      let emailSize = 0;
      const maxEmailSize = 25 * 1024 * 1024; // 25MB limit

      stream.on("data", (chunk) => {
        emailSize += chunk.length;
        if (emailSize > maxEmailSize) {
          stream.destroy(new Error("Email size exceeds limit"));
          return;
        }
        rawEmail = Buffer.concat([rawEmail, chunk]);
      });

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        callback(err);
      });

      stream.on("end", async () => {
        try {
          if (emailSize === 0) {
            return callback(new Error("Empty email received"));
          }

          const parsed = await simpleParser(rawEmail);

          // Validate essential email fields
          if (!parsed.from || !parsed.from.text) {
            return callback(new Error("Missing sender information"));
          }

          // Process each recipient
          for (const rcpt of session.envelope.rcptTo) {
            try {
              const to = rcpt.address.toLowerCase();

              const mailbox = await Prisma.mailbox.findFirst({
                where: {
                  address: to,
                  domain: { verified: true },
                },
                select: {
                  id: true,
                },
              });

              if (mailbox) {
                await Prisma.message.create({
                  data: {
                    from: session.envelope.mailFrom.address,
                    to,
                    subject: parsed.subject || "(No Subject)", // Limit subject length
                    body: parsed.text || "", // Limit HTML length
                    mailboxId: mailbox.id,
                  },
                });
                console.log(`📨 Stored message for ${to}`);
              }
            } catch (recipientErr) {
              console.error(
                `Error processing recipient ${rcpt.address}:`,
                recipientErr
              );
              // Continue with next recipient even if one fails
            }
          }

          callback();
        } catch (parseErr) {
          console.error("Email parsing error:", parseErr);
          callback(new Error("Failed to process email content"));
        }
      });
    } catch (err) {
      console.error("Data handling error:", err);
      callback(err);
    }
  },
});
