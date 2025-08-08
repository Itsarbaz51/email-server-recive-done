import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const SENDGRID_API = "https://api.sendgrid.com/v3";
const HEADERS = {
  Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
  "Content-Type": "application/json",
};

/**
 * Create domain in SendGrid and get DNS records
 */
export async function createDomain(domain) {
  const res = await axios.post(
    `${SENDGRID_API}/whitelabel/domains`,
    {
      domain,
      automatic_security: true,
    },
    { headers: HEADERS }
  );
  return res.data; // contains id + dns records
}

/**
 * Validate domain DNS records in SendGrid
 */
export async function validateDomain(domainId) {
  const res = await axios.post(
    `${SENDGRID_API}/whitelabel/domains/${domainId}/validate`,
    {},
    { headers: HEADERS }
  );
  return res.data;
}

export async function sendViaSendGrid({ from, to, subject, html }) {
  const data = {
    personalizations: [
      {
        to: Array.isArray(to)
          ? to.map((email) => ({ email }))
          : [{ email: to }],
        subject,
      },
    ],
    from: {
      email: from.email,
      name: from.name || "No Name",
    },
    content: [
      {
        type: "text/html",
        value: html,
      },
    ],
  };

  const res = await axios.post(`${SENDGRID_API}/mail/send`, data, {
    headers: HEADERS,
  });

  return res.data;
}
