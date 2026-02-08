/**
 * Email service using Resend
 * Handles sending transactional emails to users
 */

import { Resend } from "resend";

const WEB_URL = process.env.WEB_URL || "http://localhost:3000";
const LOGO_URL =
  process.env.EMAIL_LOGO_URL ||
  "https://i.ibb.co/YBVWTyGH/Frame-2147259039-3.png";

let resendInstance: Resend | null = null;

function getResendClient(): Resend {
  if (!resendInstance) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resendInstance = new Resend(process.env.RESEND_API_KEY);
  }
  return resendInstance;
}

interface WelcomeEmailData {
  email: string;
  name?: string;
}

/**
 * Send welcome email to new users
 */
export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn(
        "RESEND_API_KEY not configured. Skipping welcome email send.",
      );
      return;
    }

    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "onboarding@yourdomain.com";
    const fromName = process.env.RESEND_FROM_NAME || "Axyle";

    const resend = getResendClient();

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: data.email,
      subject: "Welcome to Axyle",
      html: getWelcomeEmailHTML(data),
    });

    console.log(`Welcome email sent to ${data.email}`);
  } catch (error) {
    console.error("Error sending welcome email:", error);
    // Don't throw - we don't want to fail user registration if email fails
  }
}

/**
 * Generate HTML content for welcome email
 */
function getWelcomeEmailHTML(data: WelcomeEmailData): string {
  const displayName = data.name || "there";
  const dashboardUrl = `${WEB_URL}/dashboard`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Welcome to Axyle</title>
  <!--[if mso]>
  <noscript>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding: 40px 24px; text-align: center; background: #0f0f12;"><img src="${LOGO_URL}" alt="Axyle" width="48" height="48" style="display: inline-block;" /></td></tr></table>
  </noscript>
  <![endif]-->
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f0f12; -webkit-font-smoothing: antialiased; }
    .wrapper { background-color: #0f0f12; padding: 32px 16px; }
    .container { max-width: 560px; margin: 0 auto; background-color: #18181b; border-radius: 16px; overflow: hidden; border: 1px solid #27272a; }
    .header { padding: 40px 32px 32px; text-align: center; background: linear-gradient(180deg, #1a1a1f 0%, #18181b 100%); color-scheme: dark; }
    .logo { width: 56px; height: 56px; display: block; margin: 0 auto 20px; border-radius: 12px; }
    .header h1 { color: #ffffff !important; font-size: 24px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.02em; -webkit-text-fill-color: #ffffff; }
    .header .tagline { color: #a1a1aa !important; font-size: 14px; margin: 0; -webkit-text-fill-color: #a1a1aa; }
    .content { padding: 0 32px 36px; color: #d4d4d8; line-height: 1.65; }
    .content h2 { color: #ffffff; font-size: 18px; font-weight: 600; margin: 0 0 20px; }
    .content p { margin: 0 0 18px; font-size: 15px; }
    .feature-list { margin: 24px 0; padding: 0; list-style: none; }
    .feature-list li { padding: 14px 0; border-bottom: 1px solid #27272a; font-size: 15px; color: #d4d4d8; }
    .feature-list li:last-child { border-bottom: none; }
    .feature-list strong { color: #ffffff; font-weight: 600; }
    .feature-list .muted { color: #71717a; font-weight: 400; }
    .button-wrap { text-align: center; margin: 28px 0; }
    .button { display: inline-block; background: #ffffff; color: #0f0f12 !important; text-decoration: none; padding: 14px 28px; border-radius: 9999px; font-size: 15px; font-weight: 600; }
    .footer { padding: 28px 32px; text-align: center; border-top: 1px solid #27272a; background: #0f0f12; }
    .footer .logo-sm { width: 32px; height: 32px; border-radius: 8px; margin-bottom: 10px; vertical-align: middle; }
    .footer p { color: #71717a; font-size: 13px; margin: 6px 0; }
    .footer a { color: #a78bfa; text-decoration: none; }
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 20px 12px; }
      .header, .content { padding-left: 24px; padding-right: 24px; }
      .header h1 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #18181b;"><tr><td style="padding: 40px 32px 32px; text-align: center; background-color: #18181b; color: #ffffff;">
        <img src="${LOGO_URL}" alt="Axyle" class="logo" width="56" height="56" />
        <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 6px;"><span style="color: #ffffff;">Welcome to Axyle</span></h1>
        <p class="tagline" style="color: #a1a1aa; font-size: 14px; margin: 0;"><span style="color: #a1a1aa;">Track. Analyze. Grow.</span></p>
        </td></tr></table>
      </div>
      <div class="content">
        <h2>Hi ${displayName},</h2>
        <p>Thanks for signing up. We're excited to help you track, analyze, and grow your mobile apps.</p>
        <p>Here's what you can do with Axyle:</p>
        <ul class="feature-list">
          <li><strong>Track events</strong> <span class="muted">- Monitor user interactions in real time</span></li>
          <li><strong>Build funnels</strong> <span class="muted">- See conversion paths and drop-offs</span></li>
          <li><strong>Create segments</strong> <span class="muted">- Group users by behavior and properties</span></li>
          <li><strong>Ask AI</strong> <span class="muted">- Get insights in plain English</span></li>
        </ul>
        <p>Choose a plan on the pricing page, then head to your dashboard to start exploring.</p>
        <div class="button-wrap">
          <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
        </div>
        <p style="font-size: 14px; color: #71717a;">If you have questions, reply to this email or check out our docs.</p>
      </div>
      <div class="footer">
        <img src="${LOGO_URL}" alt="Axyle" class="logo-sm" width="32" height="32" />
        <p><strong style="color: #d4d4d8;">Axyle</strong></p>
        <p>Track. Analyze. Grow.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

interface ProjectInviteEmailData {
  email: string;
  projectName: string;
  inviterName?: string;
  acceptLink: string;
}

/**
 * Send project invite email (no account required; link goes to accept page then login/signup if needed)
 */
export async function sendProjectInviteEmail(
  data: ProjectInviteEmailData,
): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn(
        "RESEND_API_KEY not configured. Skipping project invite email.",
      );
      return;
    }

    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "onboarding@yourdomain.com";
    const fromName = process.env.RESEND_FROM_NAME || "Axyle";

    const resend = getResendClient();

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: data.email,
      subject: `You're invited to join ${data.projectName}`,
      html: getProjectInviteEmailHTML(data),
    });

    console.log(`Project invite email sent to ${data.email}`);
  } catch (error) {
    console.error("Error sending project invite email:", error);
    throw error; // Caller may want to show "invite sent" even if email fails
  }
}

function getProjectInviteEmailHTML(data: ProjectInviteEmailData): string {
  const inviter = data.inviterName || "A teammate";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>You're invited to ${data.projectName}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f0f12; -webkit-font-smoothing: antialiased; }
    .wrapper { background-color: #0f0f12; padding: 32px 16px; }
    .container { max-width: 560px; margin: 0 auto; background-color: #18181b; border-radius: 16px; overflow: hidden; border: 1px solid #27272a; }
    .header { padding: 40px 32px 32px; text-align: center; background: linear-gradient(180deg, #1a1a1f 0%, #18181b 100%); color-scheme: dark; }
    .logo { width: 56px; height: 56px; display: block; margin: 0 auto 20px; border-radius: 12px; }
    .header h1 { color: #ffffff !important; font-size: 24px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.02em; -webkit-text-fill-color: #ffffff; }
    .header .tagline { color: #a1a1aa !important; font-size: 14px; margin: 0; -webkit-text-fill-color: #a1a1aa; }
    .content { padding: 0 32px 36px; color: #d4d4d8; line-height: 1.65; }
    .content h2 { color: #ffffff; font-size: 18px; font-weight: 600; margin: 0 0 20px; }
    .content p { margin: 0 0 18px; font-size: 15px; }
    .button-wrap { text-align: center; margin: 28px 0; }
    .button { display: inline-block; background: #ffffff; color: #0f0f12 !important; text-decoration: none; padding: 14px 28px; border-radius: 9999px; font-size: 15px; font-weight: 600; }
    .footer { padding: 28px 32px; text-align: center; border-top: 1px solid #27272a; background: #0f0f12; }
    .footer .logo-sm { width: 32px; height: 32px; border-radius: 8px; margin-bottom: 10px; vertical-align: middle; }
    .footer p { color: #71717a; font-size: 13px; margin: 6px 0; }
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 20px 12px; }
      .header, .content { padding-left: 24px; padding-right: 24px; }
      .header h1 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #18181b;"><tr><td style="padding: 40px 32px 32px; text-align: center; background-color: #18181b; color: #ffffff;">
        <img src="${LOGO_URL}" alt="Axyle" class="logo" width="56" height="56" />
        <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 6px;"><span style="color: #ffffff;">You're invited</span></h1>
        <p class="tagline" style="color: #a1a1aa; font-size: 14px; margin: 0;"><span style="color: #a1a1aa;">Track. Analyze. Grow.</span></p>
        </td></tr></table>
      </div>
      <div class="content">
        <h2>Hi there,</h2>
        <p><strong style="color: #ffffff;">${inviter}</strong> has invited you to collaborate on the project <strong style="color: #ffffff;">${data.projectName}</strong> on Axyle.</p>
        <p>Click the button below to accept. You'll sign in or create an account, then you'll be added to the project.</p>
        <div class="button-wrap">
          <a href="${data.acceptLink}" class="button">Accept invitation</a>
        </div>
        <p style="font-size: 14px; color: #71717a;">If you didn't expect this invite, you can ignore this email.</p>
      </div>
      <div class="footer">
        <img src="${LOGO_URL}" alt="Axyle" class="logo-sm" width="32" height="32" />
        <p><strong style="color: #d4d4d8;">Axyle</strong></p>
        <p>Track. Analyze. Grow.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

interface ThankYouJoiningEmailData {
  email: string;
  name?: string;
  planName?: string;
}

/**
 * Send "Thank you for joining" email when user gets a paid plan
 */
export async function sendThankYouJoiningEmail(
  data: ThankYouJoiningEmailData,
): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn(
        "RESEND_API_KEY not configured. Skipping thank-you joining email.",
      );
      return;
    }

    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "onboarding@yourdomain.com";
    const fromName = process.env.RESEND_FROM_NAME || "Axyle";

    const resend = getResendClient();

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: data.email,
      subject: "Thank you for joining Axyle",
      html: getThankYouJoiningEmailHTML(data),
    });

    console.log(`Thank-you joining email sent to ${data.email}`);
  } catch (error) {
    console.error("Error sending thank-you joining email:", error);
  }
}

function getThankYouJoiningEmailHTML(data: ThankYouJoiningEmailData): string {
  const displayName = data.name || "there";
  const planName = data.planName || "your plan";
  const dashboardUrl = `${WEB_URL}/dashboard`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Thank you for joining Axyle</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f0f12; -webkit-font-smoothing: antialiased; }
    .wrapper { background-color: #0f0f12; padding: 32px 16px; }
    .container { max-width: 560px; margin: 0 auto; background-color: #18181b; border-radius: 16px; overflow: hidden; border: 1px solid #27272a; }
    .header { padding: 40px 32px 32px; text-align: center; background: linear-gradient(180deg, #1a1a1f 0%, #18181b 100%); color-scheme: dark; }
    .logo { width: 56px; height: 56px; display: block; margin: 0 auto 20px; border-radius: 12px; }
    .header h1 { color: #ffffff !important; font-size: 24px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.02em; -webkit-text-fill-color: #ffffff; }
    .header .tagline { color: #a1a1aa !important; font-size: 14px; margin: 0; -webkit-text-fill-color: #a1a1aa; }
    .content { padding: 0 32px 36px; color: #d4d4d8; line-height: 1.65; }
    .content h2 { color: #ffffff; font-size: 18px; font-weight: 600; margin: 0 0 20px; }
    .content p { margin: 0 0 18px; font-size: 15px; }
    .button-wrap { text-align: center; margin: 28px 0; }
    .button { display: inline-block; background: #ffffff; color: #0f0f12 !important; text-decoration: none; padding: 14px 28px; border-radius: 9999px; font-size: 15px; font-weight: 600; }
    .footer { padding: 28px 32px; text-align: center; border-top: 1px solid #27272a; background: #0f0f12; }
    .footer .logo-sm { width: 32px; height: 32px; border-radius: 8px; margin-bottom: 10px; vertical-align: middle; }
    .footer p { color: #71717a; font-size: 13px; margin: 6px 0; }
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 20px 12px; }
      .header, .content { padding-left: 24px; padding-right: 24px; }
      .header h1 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #18181b;"><tr><td style="padding: 40px 32px 32px; text-align: center; background-color: #18181b; color: #ffffff;">
        <img src="${LOGO_URL}" alt="Axyle" class="logo" width="56" height="56" />
        <h1 style="color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 6px;"><span style="color: #ffffff;">Thank you for joining</span></h1>
        <p class="tagline" style="color: #a1a1aa; font-size: 14px; margin: 0;"><span style="color: #a1a1aa;">Track. Analyze. Grow.</span></p>
        </td></tr></table>
      </div>
      <div class="content">
        <h2>Hi ${displayName},</h2>
        <p>Thank you for subscribing to ${planName}. You're all set to track, analyze, and grow your mobile apps.</p>
        <p>Head to your dashboard to connect your app, create projects, and start exploring events and funnels.</p>
        <div class="button-wrap">
          <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
        </div>
        <p style="font-size: 14px; color: #71717a;">If you have questions, reply to this email or check out our docs.</p>
      </div>
      <div class="footer">
        <img src="${LOGO_URL}" alt="Axyle" class="logo-sm" width="32" height="32" />
        <p><strong style="color: #d4d4d8;">Axyle</strong></p>
        <p>Track. Analyze. Grow.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Export email service interface
 */
export const emailService = {
  sendWelcomeEmail,
  sendProjectInviteEmail,
  sendThankYouJoiningEmail,
};
