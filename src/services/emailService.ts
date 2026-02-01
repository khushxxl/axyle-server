/**
 * Email service using Resend
 * Handles sending transactional emails to users
 */

import { Resend } from "resend";

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
    const fromName = process.env.RESEND_FROM_NAME || "Your App";

    const resend = getResendClient();

    await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: data.email,
      subject: "Welcome to Your App",
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

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Your App</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f4f4f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      font-size: 28px;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 40px 30px;
      color: #3f3f46;
      line-height: 1.6;
    }
    .content h2 {
      color: #18181b;
      font-size: 20px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    .content p {
      margin: 0 0 16px 0;
      font-size: 16px;
    }
    .feature-list {
      margin: 24px 0;
      padding: 0;
      list-style: none;
    }
    .feature-list li {
      padding: 12px 0;
      border-bottom: 1px solid #e4e4e7;
      font-size: 15px;
    }
    .feature-list li:last-child {
      border-bottom: none;
    }
    .feature-list li strong {
      color: #18181b;
      font-weight: 600;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      margin: 24px 0;
      transition: opacity 0.2s;
    }
    .button:hover {
      opacity: 0.9;
    }
    .footer {
      background-color: #fafafa;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e4e4e7;
    }
    .footer p {
      color: #71717a;
      font-size: 14px;
      margin: 8px 0;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 30px 20px;
      }
      .header {
        padding: 30px 20px;
      }
      .header h1 {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Your App</h1>
    </div>
    
    <div class="content">
      <h2>Hi ${displayName},</h2>
      
      <p>
        Thanks for joining us. We're excited to have you on board and help you track, analyze, and grow your application.
      </p>
      
      <p>
        Here's what you can do with your new account:
      </p>
      
      <ul class="feature-list">
        <li><strong>Track Events:</strong> Monitor user interactions and behaviors in real-time</li>
        <li><strong>Build Funnels:</strong> Understand your conversion paths and optimize them</li>
        <li><strong>Create Segments:</strong> Group users based on behaviors and properties</li>
        <li><strong>AI Insights:</strong> Get intelligent recommendations to improve your metrics</li>
      </ul>
      
      <p>
        Ready to get started? Head to your dashboard and begin exploring.
      </p>
      
      <center>
        <a href="${process.env.WEB_URL || "http://localhost:3000"}/dashboard" class="button">
          Go to Dashboard
        </a>
      </center>
      
      <p>
        If you have any questions or need help getting started, feel free to reach out to our support team.
      </p>
    </div>
    
    <div class="footer">
      <p>
        <strong>Your App</strong>
      </p>
      <p>
        Track. Analyze. Grow.
      </p>
      <p style="margin-top: 16px;">
        Need help? <a href="mailto:support@yourdomain.com">Contact Support</a>
      </p>
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
    const fromName = process.env.RESEND_FROM_NAME || "Your App";

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
  <title>Project invitation</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; }
    .header h1 { color: #ffffff; font-size: 24px; font-weight: 600; margin: 0; }
    .content { padding: 40px 30px; color: #3f3f46; line-height: 1.6; }
    .content h2 { color: #18181b; font-size: 18px; font-weight: 600; margin: 0 0 16px 0; }
    .content p { margin: 0 0 16px 0; font-size: 16px; }
    .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; margin: 24px 0; }
    .footer { background-color: #fafafa; padding: 24px 30px; text-align: center; border-top: 1px solid #e4e4e7; }
    .footer p { color: #71717a; font-size: 14px; margin: 8px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>You're invited</h1></div>
    <div class="content">
      <h2>Hi there,</h2>
      <p><strong>${inviter}</strong> has invited you to collaborate on the project <strong>${data.projectName}</strong>.</p>
      <p>Click the button below to accept the invitation. You'll sign in or create an account, then you'll be added to the project.</p>
      <p><a href="${data.acceptLink}" class="button">Accept invitation</a></p>
      <p style="font-size: 14px; color: #71717a;">If you didn't expect this invite, you can ignore this email.</p>
    </div>
    <div class="footer">
      <p><strong>Your App</strong></p>
      <p>Track. Analyze. Grow.</p>
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
};
