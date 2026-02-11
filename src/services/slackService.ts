/**
 * Slack integration service — sends notifications via Incoming Webhooks.
 * All public functions are fire-and-forget: errors are logged, never thrown.
 */

const TIMEOUT_MS = 5000;

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string }>;
  fields?: Array<{ type: string; text: string }>;
}

async function sendSlackMessage(
  webhookUrl: string,
  blocks: SlackBlock[],
  text: string
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch (error) {
    console.error("Slack webhook error:", error);
    return false;
  }
}

export async function testWebhook(webhookUrl: string): Promise<boolean> {
  return sendSlackMessage(
    webhookUrl,
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Axyle* connected successfully! :white_check_mark:\nYou'll receive notifications in this channel.",
        },
      },
    ],
    "Axyle connected successfully!"
  );
}

export async function sendPaymentNotification(
  webhookUrl: string,
  eventData: {
    type: string;
    app_user_id?: string;
    product_id?: string;
    price_in_purchased_currency?: number;
    currency?: string;
    store?: string;
    country_code?: string;
  }
): Promise<void> {
  try {
    const emojiMap: Record<string, string> = {
      INITIAL_PURCHASE: ":tada:",
      RENEWAL: ":arrows_counterclockwise:",
      CANCELLATION: ":x:",
      UNCANCELLATION: ":leftwards_arrow_with_hook:",
      NON_RENEWING_PURCHASE: ":shopping_bags:",
      EXPIRATION: ":hourglass:",
      BILLING_ISSUE: ":warning:",
      PRODUCT_CHANGE: ":repeat:",
      SUBSCRIPTION_PAUSED: ":double_vertical_bar:",
      REFUND_REVERSED: ":moneybag:",
    };

    const emoji = emojiMap[eventData.type] || ":bell:";
    const typeLabel = eventData.type.replace(/_/g, " ").toLowerCase();

    const fields: Array<{ type: string; text: string }> = [];
    if (eventData.product_id) {
      fields.push({ type: "mrkdwn", text: `*Product:*\n${eventData.product_id}` });
    }
    if (eventData.price_in_purchased_currency != null && eventData.currency) {
      fields.push({
        type: "mrkdwn",
        text: `*Price:*\n${eventData.price_in_purchased_currency} ${eventData.currency}`,
      });
    }
    if (eventData.app_user_id) {
      fields.push({ type: "mrkdwn", text: `*User:*\n${eventData.app_user_id}` });
    }
    if (eventData.store) {
      fields.push({ type: "mrkdwn", text: `*Store:*\n${eventData.store}` });
    }

    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *Payment Event — ${typeLabel}*`,
        },
      },
    ];

    if (fields.length > 0) {
      blocks.push({ type: "section", fields });
    }

    await sendSlackMessage(webhookUrl, blocks, `Payment event: ${typeLabel}`);
  } catch (error) {
    console.error("Slack payment notification error:", error);
  }
}

export async function sendCrashNotification(
  webhookUrl: string,
  crashData: {
    eventName: string;
    userId?: string;
    deviceInfo?: string;
    projectName?: string;
    count?: number;
  }
): Promise<void> {
  try {
    const fields: Array<{ type: string; text: string }> = [
      { type: "mrkdwn", text: `*Event:*\n\`${crashData.eventName}\`` },
    ];

    if (crashData.count && crashData.count > 1) {
      fields.push({ type: "mrkdwn", text: `*Count:*\n${crashData.count} occurrences` });
    }
    if (crashData.userId) {
      fields.push({ type: "mrkdwn", text: `*User:*\n${crashData.userId}` });
    }
    if (crashData.deviceInfo) {
      fields.push({ type: "mrkdwn", text: `*Device:*\n${crashData.deviceInfo}` });
    }

    const title = crashData.projectName
      ? `:rotating_light: *Crash detected in ${crashData.projectName}*`
      : `:rotating_light: *Crash detected*`;

    const blocks: SlackBlock[] = [
      { type: "section", text: { type: "mrkdwn", text: title } },
      { type: "section", fields },
    ];

    await sendSlackMessage(webhookUrl, blocks, `Crash detected: ${crashData.eventName}`);
  } catch (error) {
    console.error("Slack crash notification error:", error);
  }
}

export async function sendQuotaWarning(
  webhookUrl: string,
  projectName: string,
  usage: number,
  limit: number
): Promise<void> {
  try {
    const percentage = Math.round((usage / limit) * 100);
    const emoji = percentage >= 100 ? ":no_entry:" : ":warning:";
    const status =
      percentage >= 100
        ? "Event limit reached — new events are being rejected."
        : `You've used *${percentage}%* of your monthly event limit.`;

    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *Event Quota Warning — ${projectName}*\n${status}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Used:*\n${usage.toLocaleString()}` },
          { type: "mrkdwn", text: `*Limit:*\n${limit.toLocaleString()}` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "Upgrade your plan to increase the event limit." },
        ],
      },
    ];

    await sendSlackMessage(
      webhookUrl,
      blocks,
      `Event quota warning for ${projectName}: ${percentage}% used`
    );
  } catch (error) {
    console.error("Slack quota warning error:", error);
  }
}
