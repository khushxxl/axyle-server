const TRUSTMRR_API_KEY = "tmrr_e4a218a0051bf39f7bbc5f7ec36b4b5c";
const TRUSTMRR_API_BASE = "https://trustmrr.com/api/v1";

export interface TrustMRRStartup {
  slug: string;
  name: string;
  icon: string | null;
  xHandle: string | null;
  revenue: {
    last30Days: number;
    mrr: number;
    total: number;
  };
  customers: number;
  activeSubscriptions: number;
  growth30d: number; // decimal like 0.12 = 12%
}

export interface TrustMRRMetrics {
  mrr: number;
  revenue30Days: number;
  activeSubscriptions: number;
  growth30d: number;
  totalRevenue: number;
}

const headers = {
  Authorization: `Bearer ${TRUSTMRR_API_KEY}`,
  "Content-Type": "application/json",
};

export async function searchStartups(
  xHandle: string,
): Promise<TrustMRRStartup[]> {
  const handle = xHandle.replace(/^@/, "");
  const res = await fetch(
    `${TRUSTMRR_API_BASE}/startups?xHandle=${encodeURIComponent(handle)}`,
    { headers },
  );
  if (!res.ok) throw new Error(`TrustMRR API error: ${res.status}`);
  const json: any = await res.json();
  if (Array.isArray(json.data)) return json.data;
  if (json.data && typeof json.data === "object") return [json.data];
  return [];
}

export async function getStartupBySlug(
  slug: string,
): Promise<TrustMRRStartup | null> {
  const res = await fetch(
    `${TRUSTMRR_API_BASE}/startups/${encodeURIComponent(slug)}`,
    { headers },
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`TrustMRR API error: ${res.status}`);
  }
  const json: any = await res.json();
  return json.data || null;
}

export function extractMetrics(startup: TrustMRRStartup): TrustMRRMetrics {
  return {
    mrr: startup.revenue?.mrr ?? 0,
    revenue30Days: startup.revenue?.last30Days ?? 0,
    activeSubscriptions: startup.activeSubscriptions ?? 0,
    growth30d: startup.growth30d ?? 0,
    totalRevenue: startup.revenue?.total ?? 0,
  };
}
