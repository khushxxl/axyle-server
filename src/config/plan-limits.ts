/**
 * Plan limits config - must stay in sync with web/src/config/plan-limits.ts
 * Used for server-side enforcement (projects, team, funnels, events).
 */

export type PlanId = "free" | "starter" | "pro" | "scale";

export interface PlanLimits {
  /** Max events per calendar month (across all user's projects). -1 = unlimited */
  eventsPerMonth: number;
  /** Max projects the user can be a member of. -1 = unlimited */
  projects: number;
  /** Max team members per project (including owner). -1 = unlimited */
  teamSeatsPerProject: number;
  /** Max funnels total across all projects. -1 = unlimited */
  funnels: number;
  /** Data retention in days. -1 = unlimited */
  dataRetentionDays: number;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    eventsPerMonth: 0,
    projects: 0,
    teamSeatsPerProject: 1,
    funnels: 0,
    dataRetentionDays: 0,
  },
  starter: {
    eventsPerMonth: 50_000,
    projects: 1,
    teamSeatsPerProject: 1,
    funnels: 3,
    dataRetentionDays: 14,
  },
  pro: {
    eventsPerMonth: 1_500_000,
    projects: -1,
    teamSeatsPerProject: 5,
    funnels: -1,
    dataRetentionDays: 365,
  },
  scale: {
    eventsPerMonth: 6_000_000,
    projects: -1,
    teamSeatsPerProject: 15,
    funnels: -1,
    dataRetentionDays: 365 * 3,
  },
};

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  const key = (plan?.toLowerCase() || "free") as PlanId;
  return PLAN_LIMITS[key] ?? PLAN_LIMITS.free;
}

export function isUnlimited(value: number): boolean {
  return value === -1;
}
