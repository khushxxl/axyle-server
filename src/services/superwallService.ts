/**
 * Superwall Service
 * Handles communication with Superwall API v2 for fetching paywall revenue data
 */

import axios, { AxiosError } from "axios";

const SUPERWALL_BASE_URL = "https://api.superwall.com/v2";

/**
 * Format a date string to YYYY-MM-DD (Superwall API rejects ISO timestamps with timezone)
 */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toISOString().split("T")[0];
}

/**
 * Format end date — add 1 day so Superwall includes the full end date
 */
function formatEndDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

export interface SuperwallConfig {
  apiKey: string;
}

export interface SuperwallApplication {
  id: string;
  name: string;
  platform: string;
  bundle_id?: string;
  app_id?: string;
  integrated: boolean;
}

export interface SuperwallProject {
  id: string;
  name: string;
  organization_id: number;
  applications: SuperwallApplication[];
  created_at: string;
  updated_at: string;
  archived: boolean;
}

export interface SuperwallStatistic {
  key: string;
  chart: string;
  name: string;
  value: { type: string; value: number };
  description: string;
}

export interface SuperwallTransaction {
  id: string;
  is_processing: boolean;
  placement: string;
  event_type: string;
  store: string;
  price: number;
  purchased_at: string;
  integration: string;
  user: { app_user_id: string };
  paywall: { name: string };
}

/**
 * List all Superwall projects for an organization
 */
export async function listProjects(
  config: SuperwallConfig,
): Promise<SuperwallProject[]> {
  const url = `${SUPERWALL_BASE_URL}/projects`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      params: { limit: 100 },
    });
    return response.data.data || response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "Superwall API Error:",
      axiosError.response?.data || axiosError.message,
    );
    throw error;
  }
}

/**
 * Validate API key by attempting to list projects
 */
export async function validateApiKey(
  config: SuperwallConfig,
): Promise<{ valid: boolean; projects?: SuperwallProject[]; error?: string }> {
  try {
    const projects = await listProjects(config);
    return { valid: true, projects };
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    if (status === 401 || status === 403) {
      return { valid: false, error: "Invalid API key" };
    }
    return {
      valid: false,
      error: axiosError.message || "Failed to validate API key",
    };
  }
}

/**
 * Get application statistics (revenue metrics)
 */
export async function getApplicationStatistics(
  config: SuperwallConfig,
  projectId: string,
  applicationId: string,
  from: string,
  to: string,
  environment: "PRODUCTION" | "SANDBOX" = "PRODUCTION",
): Promise<SuperwallStatistic[]> {
  const url = `${SUPERWALL_BASE_URL}/projects/${projectId}/applications/${applicationId}/statistics`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      params: { environment, from: formatDate(from), to: formatEndDate(to) },
    });
    return response.data.statistics || response.data.data || [];
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "Superwall statistics error:",
      axiosError.response?.data || axiosError.message,
    );
    throw error;
  }
}

/**
 * Get recent transactions
 */
export async function getRecentTransactions(
  config: SuperwallConfig,
  projectId: string,
  applicationId: string,
  from: string,
  to: string,
  environment: "PRODUCTION" | "SANDBOX" = "PRODUCTION",
): Promise<SuperwallTransaction[]> {
  const url = `${SUPERWALL_BASE_URL}/projects/${projectId}/applications/${applicationId}/recent-transactions`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      params: { environment, from: formatDate(from), to: formatEndDate(to) },
    });
    return response.data.data || [];
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "Superwall transactions error:",
      axiosError.response?.data || axiosError.message,
    );
    throw error;
  }
}

/**
 * Get chart definitions (lists available charts like MRR, revenue, etc.)
 */
export async function getChartDefinitions(
  config: SuperwallConfig,
  applicationId: string,
): Promise<any[]> {
  const url = `${SUPERWALL_BASE_URL}/charts/definitions`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      params: { application_id: applicationId },
    });
    return response.data.data || response.data || [];
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "Superwall chart definitions error:",
      axiosError.response?.data || axiosError.message,
    );
    return [];
  }
}

/**
 * Fetch chart data (e.g., MRR, revenue over time)
 */
export async function getChartData(
  config: SuperwallConfig,
  body: Record<string, any>,
): Promise<any> {
  const url = `${SUPERWALL_BASE_URL}/charts/data`;
  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "Superwall chart data error:",
      axiosError.response?.data || axiosError.message,
    );
    return null;
  }
}

/**
 * Register a webhook endpoint with Superwall so it sends events to our server
 */
export async function registerWebhook(
  config: SuperwallConfig,
  superwallProjectId: string,
  webhookUrl: string,
  name: string = "Axyle",
): Promise<{ id: string } | { error: string }> {
  const url = `${SUPERWALL_BASE_URL}/projects/${superwallProjectId}/webhook_endpoints`;
  try {
    const response = await axios.post(
      url,
      { url: webhookUrl, name },
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );
    return { id: response.data.id || response.data.endpoint_id || "registered" };
  } catch (error) {
    const axiosError = error as AxiosError;
    // 409 = webhook already exists for this URL, which is fine
    if (axiosError.response?.status === 409) {
      return { id: "already_exists" };
    }
    console.error(
      "Superwall webhook registration error:",
      axiosError.response?.data || axiosError.message,
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
 * Delete a webhook endpoint from Superwall
 */
export async function deleteWebhook(
  config: SuperwallConfig,
  superwallProjectId: string,
  webhookEndpointId: string,
): Promise<{ success: boolean; error?: string }> {
  const url = `${SUPERWALL_BASE_URL}/projects/${superwallProjectId}/webhook_endpoints/${webhookEndpointId}`;
  try {
    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
    });
    return { success: true };
  } catch (error) {
    const axiosError = error as AxiosError;
    console.error(
      "Superwall webhook deletion error:",
      axiosError.response?.data || axiosError.message,
    );
    return {
      success: false,
      error: axiosError.message || "Failed to delete webhook",
    };
  }
}
