/**
 * RevenueCat Service
 * Handles communication with RevenueCat API for fetching app revenue metrics
 */

import axios, { AxiosError } from "axios";

const REVENUECAT_BASE_URL = "https://api.revenuecat.com/v2";

export interface RevenueCatMetric {
  id: string;
  name?: string;
  value: number;
  unit?: string;
  description?: string;
  period?: string;
  last_updated_at_iso8601?: string;
}

export interface RevenueCatOverviewResponse {
  metrics: RevenueCatMetric[];
}

export interface ParsedMetrics {
  monthlyRecurringRevenue?: MetricData;
  revenue28Days?: MetricData;
  activeSubscriptions?: MetricData;
  activeTrials?: MetricData;
  newCustomers?: MetricData;
  activeUsers?: MetricData;
  installs?: MetricData;
  [key: string]: MetricData | undefined;
}

export interface MetricData {
  value: number;
  unit?: string;
  description?: string;
  period?: string;
  lastUpdated?: string;
}

export interface RevenueSummary {
  mrr: number;
  revenue28Days: number;
  activeSubscriptions: number;
  activeTrials: number;
  averageRevenuePerSubscriber: string;
  trialConversionPotential: number;
}

export interface RevenueCatConfig {
  secretKey: string;
  projectId: string;
}

/**
 * Fetches overview metrics from RevenueCat API
 */
export async function getOverviewMetrics(
  config: RevenueCatConfig,
  currency: string = "USD"
): Promise<RevenueCatOverviewResponse> {
  const url = `${REVENUECAT_BASE_URL}/projects/${config.projectId}/metrics/overview`;
  const params = currency !== "USD" ? { currency } : {};

  try {
    const response = await axios.get<RevenueCatOverviewResponse>(url, {
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        Accept: "application/json",
      },
      params,
    });

    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "RevenueCat API Error:",
      axiosError.response?.data || axiosError.message
    );
    throw error;
  }
}

/**
 * Parse the overview metrics response into a cleaner format
 */
export function parseOverviewMetrics(
  data: RevenueCatOverviewResponse
): ParsedMetrics {
  const metrics: ParsedMetrics = {};

  if (data.metrics && Array.isArray(data.metrics)) {
    const metricMap: Record<string, string> = {
      mrr: "monthlyRecurringRevenue",
      revenue: "revenue28Days",
      active_subscriptions: "activeSubscriptions",
      active_trials: "activeTrials",
      new_customers: "newCustomers",
      active_users: "activeUsers",
      installs: "installs",
    };

    data.metrics.forEach((metric) => {
      const key = metricMap[metric.id] || metric.id;

      metrics[key] = {
        value: metric.value,
        unit: metric.unit,
        description: metric.description,
        period: metric.period,
        lastUpdated: metric.last_updated_at_iso8601,
      };
    });
  }

  return metrics;
}

/**
 * Get a specific metric by ID
 */
export async function getSpecificMetric(
  config: RevenueCatConfig,
  metricId: string,
  currency: string = "USD"
): Promise<RevenueCatMetric | null> {
  const rawData = await getOverviewMetrics(config, currency);
  const metric = rawData.metrics?.find((m) => m.id === metricId);
  return metric || null;
}

/**
 * Get revenue summary (simplified response)
 */
export async function getRevenueSummary(
  config: RevenueCatConfig,
  currency: string = "USD"
): Promise<RevenueSummary> {
  const rawData = await getOverviewMetrics(config, currency);

  const mrr = rawData.metrics?.find((m) => m.id === "mrr");
  const revenue = rawData.metrics?.find((m) => m.id === "revenue");
  const activeSubs = rawData.metrics?.find((m) => m.id === "active_subscriptions");
  const activeTrials = rawData.metrics?.find((m) => m.id === "active_trials");

  const mrrValue = mrr?.value || 0;
  const activeSubsValue = activeSubs?.value || 0;

  return {
    mrr: mrrValue,
    revenue28Days: revenue?.value || 0,
    activeSubscriptions: activeSubsValue,
    activeTrials: activeTrials?.value || 0,
    averageRevenuePerSubscriber:
      activeSubsValue > 0 ? (mrrValue / activeSubsValue).toFixed(2) : "0",
    trialConversionPotential: activeTrials?.value || 0,
  };
}

/**
 * Get list of available metric IDs
 */
export function getAvailableMetricIds(): string[] {
  return [
    "mrr",
    "revenue",
    "active_subscriptions",
    "active_trials",
    "new_customers",
    "active_users",
    "installs",
  ];
}

/**
 * Validate RevenueCat credentials by making a test API call
 */
export async function validateCredentials(
  config: RevenueCatConfig
): Promise<{ valid: boolean; error?: string }> {
  try {
    await getOverviewMetrics(config);
    return { valid: true };
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    if (status === 401) {
      return { valid: false, error: "Invalid API key" };
    } else if (status === 404) {
      return { valid: false, error: "Project not found" };
    } else {
      return {
        valid: false,
        error: axiosError.message || "Failed to validate credentials",
      };
    }
  }
}

/**
 * Register a webhook integration with RevenueCat API v2
 * so RevenueCat sends payment events to our endpoint automatically.
 */
export async function registerWebhook(
  config: RevenueCatConfig,
  webhookUrl: string,
  projectName: string
): Promise<{ id: string } | { error: string }> {
  const url = `${REVENUECAT_BASE_URL}/projects/${config.projectId}/integrations/webhooks`;

  try {
    const response = await axios.post(
      url,
      {
        name: `Axyle – ${projectName}`,
        url: webhookUrl,
        environment: "production",
        event_types: null, // all events
      },
      {
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    return { id: response.data.id };
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "RevenueCat webhook registration error:",
      axiosError.response?.data || axiosError.message
    );
    return {
      error:
        (axiosError.response?.data as any)?.message ||
        axiosError.message ||
        "Failed to register webhook",
    };
  }
}

/**
 * Delete a webhook integration from RevenueCat
 */
export async function deleteWebhook(
  config: RevenueCatConfig,
  webhookIntegrationId: string
): Promise<{ success: boolean; error?: string }> {
  const url = `${REVENUECAT_BASE_URL}/projects/${config.projectId}/integrations/webhooks/${webhookIntegrationId}`;

  try {
    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        Accept: "application/json",
      },
    });
    return { success: true };
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "RevenueCat webhook deletion error:",
      axiosError.response?.data || axiosError.message
    );
    return {
      success: false,
      error: axiosError.message || "Failed to delete webhook",
    };
  }
}
