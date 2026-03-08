export interface KeywordResult {
  keyword: string;
  score: number; // 0-100 competition/difficulty score
  difficulty: "easy" | "medium" | "hard";
  topApps: KeywordApp[];
  resultCount: number;
}

export interface KeywordApp {
  trackId: number;
  trackName: string;
  sellerName: string;
  artworkUrl100: string;
  averageUserRating: number;
  userRatingCount: number;
  primaryGenreName: string;
  formattedPrice: string;
}

/**
 * Search iTunes for apps matching a keyword and return competition data
 */
export async function searchKeyword(keyword: string): Promise<{
  apps: KeywordApp[];
  resultCount: number;
}> {
  const res = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&entity=software&country=us&limit=10`,
  );
  if (!res.ok) return { apps: [], resultCount: 0 };
  const json: any = await res.json();
  const results = json.results || [];

  return {
    resultCount: json.resultCount || 0,
    apps: results.map((r: any) => ({
      trackId: r.trackId,
      trackName: r.trackName ?? "",
      sellerName: r.sellerName ?? "",
      artworkUrl100: r.artworkUrl100 ?? "",
      averageUserRating: r.averageUserRating ?? 0,
      userRatingCount: r.userRatingCount ?? 0,
      primaryGenreName: r.primaryGenreName ?? "",
      formattedPrice: r.formattedPrice ?? "Free",
    })),
  };
}

/**
 * Calculate keyword difficulty based on top apps' strength
 * Factors: avg rating count of top 5, avg rating, number of results
 */
export function calculateDifficulty(apps: KeywordApp[], resultCount: number): {
  score: number;
  difficulty: "easy" | "medium" | "hard";
} {
  if (apps.length === 0) return { score: 5, difficulty: "easy" };

  const top5 = apps.slice(0, 5);

  // Average review count of top 5 (normalized to 0-40 range)
  const avgReviews = top5.reduce((s, a) => s + a.userRatingCount, 0) / top5.length;
  const reviewScore = Math.min(40, (avgReviews / 500000) * 40);

  // Average rating of top 5 (normalized to 0-25 range)
  const avgRating = top5.reduce((s, a) => s + a.averageUserRating, 0) / top5.length;
  const ratingScore = (avgRating / 5) * 25;

  // Result saturation (normalized to 0-20 range)
  const saturationScore = Math.min(20, (resultCount / 50) * 20);

  // Brand dominance — if top app has 10x more reviews than #5
  const brandScore =
    top5.length >= 5 && top5[4].userRatingCount > 0
      ? Math.min(15, ((top5[0].userRatingCount / top5[4].userRatingCount) / 100) * 15)
      : 0;

  const score = Math.round(Math.min(100, reviewScore + ratingScore + saturationScore + brandScore));
  const difficulty = score >= 65 ? "hard" : score >= 35 ? "medium" : "easy";

  return { score, difficulty };
}
