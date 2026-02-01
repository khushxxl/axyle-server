/**
 * Test script for email functionality
 * Run with: npx tsx src/test-email.ts
 */

import dotenv from "dotenv";
import { emailService } from "./services/emailService";

// Load environment variables
dotenv.config();

async function testWelcomeEmail() {
  console.log("Testing welcome email...");
  console.log("RESEND_API_KEY configured:", !!process.env.RESEND_API_KEY);
  console.log(
    "FROM EMAIL:",
    process.env.RESEND_FROM_EMAIL || "onboarding@yourdomain.com",
  );

  try {
    // Update this with your test email
    const testEmail = process.env.TEST_EMAIL || "your-email@example.com";

    if (testEmail === "your-email@example.com") {
      console.error("\nError: Please set TEST_EMAIL environment variable");
      console.log(
        "Example: TEST_EMAIL=your@email.com npx tsx src/test-email.ts",
      );
      process.exit(1);
    }

    console.log(`\nSending welcome email to: ${testEmail}\n`);

    await emailService.sendWelcomeEmail({
      email: testEmail,
      name: "Test User",
    });

    console.log("\n✅ Test email sent successfully!");
    console.log("Check your inbox and Resend dashboard for the email.");
  } catch (error) {
    console.error("\n❌ Error sending test email:", error);
    process.exit(1);
  }
}

testWelcomeEmail();
