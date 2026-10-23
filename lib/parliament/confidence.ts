// Confidence is calculated, not asked for: models are bad at rating their own certainty.
// Each area mixes (a) whether the Blueprint covers it and the user confirmed it, and (b) the strictest member's score.
import { AREAS, type Area, type Blueprint, type Coverage, type MemberReview } from "../types";

const has = (s: string | undefined) => Boolean(s && s.trim());

function filled(bp: Blueprint, area: Area): boolean {
  switch (area) {
    case "users": return bp.roles.length > 0;
    case "features": return bp.features.length > 0;
    case "pages": return bp.pages.length > 0;
    case "data": return bp.entities.length > 0;
    case "api": return bp.endpoints.length > 0;
    case "auth": return has(bp.auth.method);
    case "payments": return has(bp.payments.mode);
    case "scale": return has(bp.nonFunctional.users);
    case "hosting": return has(bp.nonFunctional.hosting) || has(bp.nonFunctional.region);
  }
}

export function coverage(bp: Blueprint, answeredAreas: Set<string>): Coverage {
  return Object.fromEntries(
    AREAS.map((a) => [a, !filled(bp, a) ? "missing" : answeredAreas.has(a) ? "answered" : "defaulted"]),
  ) as Coverage;
}

const COVERAGE_SCORE = { missing: 0, defaulted: 0.75, answered: 1 } as const;

export function confidence(bp: Blueprint, answeredAreas: Set<string>, reviews: MemberReview[]) {
  const cov = coverage(bp, answeredAreas);
  const areaConfidence = {} as Record<Area, number>;
  for (const a of AREAS) {
    const scores = reviews.map((r) => r.scores[a]).filter((s): s is number => typeof s === "number");
    const member = scores.length ? (Math.min(...scores) - 1) / 4 : 0.5;
    areaConfidence[a] = Math.round((0.5 * COVERAGE_SCORE[cov[a]] + 0.5 * member) * 100) / 100;
  }
  const overall = AREAS.reduce((sum, a) => sum + areaConfidence[a], 0) / AREAS.length;
  return { coverage: cov, areaConfidence, overall: Math.round(overall * 100) / 100 };
}
