export interface AppStoreInfo {
  trackId: number;
  trackName: string;
  description: string;
  sellerName: string;
  primaryGenreName: string;
  averageUserRating: number;
  userRatingCount: number;
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
  artworkUrl512: string;
  releaseNotes: string;
  currentVersionReleaseDate: string;
  fileSizeBytes: string;
  languageCodesISO2A: string[];
  version: string;
  price: number;
  trackContentRating: string;
  contentAdvisoryRating: string;
  sellerUrl: string;
  minimumOsVersion: string;
  formattedPrice: string;
  genres: string[];
}

export interface ASOMetrics {
  titleLength: number;
  descriptionLength: number;
  screenshotCount: number;
  ipadScreenshotCount: number;
  hasReleaseNotes: boolean;
  releaseNotesLength: number;
  daysSinceUpdate: number;
  appSizeMB: number;
  localizationCount: number;
  averageRating: number;
  ratingCount: number;
  price: number;
  genreCount: number;
}

export interface AuditCategory {
  name: string;
  score: number;
  findings: string[];
  recommendations: string[];
}

export interface CompetitorComparison {
  metrics: Array<{
    label: string;
    mainApp: string;
    competitors: Array<{ name: string; value: string }>;
  }>;
  summary: string;
}

export interface AuditResult {
  overallScore: number;
  categories: AuditCategory[];
  competitorComparison?: CompetitorComparison;
}

/**
 * Parse an App Store ID from various input formats:
 * - "123456789"
 * - "id123456789"
 * - "https://apps.apple.com/us/app/app-name/id123456789"
 * - "https://apps.apple.com/app/id123456789"
 */
export function parseAppId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Full URL: extract id from path
  const urlMatch = trimmed.match(/\/id(\d+)/);
  if (urlMatch) return urlMatch[1];

  // "id123456789" format
  const idMatch = trimmed.match(/^id(\d+)$/i);
  if (idMatch) return idMatch[1];

  // Pure numeric
  if (/^\d+$/.test(trimmed)) return trimmed;

  return null;
}

/**
 * Fetch app metadata from Apple iTunes Lookup API
 */
export async function fetchAppStoreInfo(
  appId: string,
): Promise<AppStoreInfo> {
  const res = await fetch(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=us`,
  );
  if (!res.ok) throw new Error(`iTunes API error: ${res.status}`);
  const json: any = await res.json();

  if (!json.results || json.results.length === 0) {
    throw new Error("App not found on the App Store");
  }

  const r = json.results[0];
  return {
    trackId: r.trackId,
    trackName: r.trackName ?? "",
    description: r.description ?? "",
    sellerName: r.sellerName ?? "",
    primaryGenreName: r.primaryGenreName ?? "",
    averageUserRating: r.averageUserRating ?? 0,
    userRatingCount: r.userRatingCount ?? 0,
    screenshotUrls: r.screenshotUrls ?? [],
    ipadScreenshotUrls: r.ipadScreenshotUrls ?? [],
    artworkUrl512: r.artworkUrl512 ?? "",
    releaseNotes: r.releaseNotes ?? "",
    currentVersionReleaseDate: r.currentVersionReleaseDate ?? "",
    fileSizeBytes: r.fileSizeBytes ?? "0",
    languageCodesISO2A: r.languageCodesISO2A ?? [],
    version: r.version ?? "",
    price: r.price ?? 0,
    trackContentRating: r.trackContentRating ?? "",
    contentAdvisoryRating: r.contentAdvisoryRating ?? "",
    sellerUrl: r.sellerUrl ?? "",
    minimumOsVersion: r.minimumOsVersion ?? "",
    formattedPrice: r.formattedPrice ?? "",
    genres: r.genres ?? [],
  };
}

export interface AppReview {
  author: string;
  title: string;
  content: string;
  rating: number;
  version: string;
  date: string;
}

/**
 * Fetch bad reviews (1-3 stars) from Apple's RSS feed.
 * Returns up to `limit` reviews sorted worst-first.
 */
export async function fetchBadReviews(
  appId: string,
  limit = 10,
): Promise<AppReview[]> {
  const reviews: AppReview[] = [];

  // Fetch up to 3 pages (50 reviews each) to find enough bad ones
  for (let page = 1; page <= 3; page++) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/us/rss/customerreviews/page=${page}/id=${appId}/sortby=mostrecent/json`,
      );
      if (!res.ok) break;
      const json: any = await res.json();
      const entries = json?.feed?.entry;
      if (!entries || !Array.isArray(entries)) break;

      for (const e of entries) {
        const rating = parseInt(e["im:rating"]?.label, 10);
        if (isNaN(rating) || rating > 3) continue;
        reviews.push({
          author: e.author?.name?.label ?? "Anonymous",
          title: e.title?.label ?? "",
          content: e.content?.label ?? "",
          rating,
          version: e["im:version"]?.label ?? "",
          date: e.updated?.label ?? "",
        });
      }

      if (reviews.length >= limit) break;
    } catch {
      break;
    }
  }

  // Sort worst first, then cap
  return reviews.sort((a, b) => a.rating - b.rating).slice(0, limit);
}

/**
 * Compute ASO-relevant metrics from raw App Store data
 */
export function extractASOMetrics(info: AppStoreInfo): ASOMetrics {
  const daysSinceUpdate = info.currentVersionReleaseDate
    ? Math.floor(
        (Date.now() - new Date(info.currentVersionReleaseDate).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : -1;

  return {
    titleLength: info.trackName.length,
    descriptionLength: info.description.length,
    screenshotCount: info.screenshotUrls.length,
    ipadScreenshotCount: info.ipadScreenshotUrls.length,
    hasReleaseNotes: info.releaseNotes.length > 0,
    releaseNotesLength: info.releaseNotes.length,
    daysSinceUpdate,
    appSizeMB: Math.round(parseInt(info.fileSizeBytes, 10) / (1024 * 1024)),
    localizationCount: info.languageCodesISO2A.length,
    averageRating: info.averageUserRating,
    ratingCount: info.userRatingCount,
    price: info.price,
    genreCount: info.genres.length,
  };
}
