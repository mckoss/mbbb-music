export interface MapLabelTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface MapIconObstacle {
  x: number;
  y: number;
  radius: number;
}

export interface MapLabelPlacement extends MapLabelTarget {
  angle: number;
  distance: number;
}

interface Rect { x: number; y: number; width: number; height: number }

function overlapArea(a: Rect, b: Rect, pad = 0): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, width + pad) * Math.max(0, height + pad);
}

function outsideArea(rect: Rect, viewport: { width: number; height: number }, pad = 6): number {
  const left = Math.max(0, pad - rect.x);
  const top = Math.max(0, pad - rect.y);
  const right = Math.max(0, rect.x + rect.width - (viewport.width - pad));
  const bottom = Math.max(0, rect.y + rect.height - (viewport.height - pad));
  return (left + right) * rect.height + (top + bottom) * rect.width;
}

function hitsCircle(rect: Rect, obstacle: MapIconObstacle, pad = 4): boolean {
  const nearestX = Math.max(rect.x, Math.min(obstacle.x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(obstacle.y, rect.y + rect.height));
  return Math.hypot(nearestX - obstacle.x, nearestY - obstacle.y) < obstacle.radius + pad;
}

function candidates(target: MapLabelTarget, viewport: { width: number; height: number }): MapLabelPlacement[] {
  const result: MapLabelPlacement[] = [];
  const maxDistance = Math.hypot(viewport.width, viewport.height);
  for (let extra = 0; extra <= maxDistance; extra += 24) {
    for (let angle = 0; angle < 360; angle += 15) {
      const theta = (angle * Math.PI) / 180;
      const dx = Math.cos(theta);
      const dy = Math.sin(theta);
      const support = Math.abs(dx) * target.width / 2 + Math.abs(dy) * target.height / 2;
      const distance = target.radius + 7 + support + extra;
      result.push({
        ...target,
        angle,
        distance,
        x: target.x + dx * distance - target.width / 2,
        y: target.y + dy * distance - target.height / 2,
      });
    }
  }
  return result;
}

function densityOrder(targets: MapLabelTarget[]): MapLabelTarget[] {
  return [...targets].sort((a, b) => {
    const nearest = (target: MapLabelTarget) => Math.min(...targets.filter((other) => other !== target).map((other) => Math.hypot(target.x - other.x, target.y - other.y)), Infinity);
    return nearest(a) - nearest(b);
  });
}

function solveOrder(
  order: MapLabelTarget[],
  viewport: { width: number; height: number },
  obstacles: MapIconObstacle[],
): MapLabelPlacement[] {
  const placed: MapLabelPlacement[] = [];
  for (const target of order) {
    let best: MapLabelPlacement | null = null;
    let bestScore = Infinity;
    for (const candidate of candidates(target, viewport)) {
      const outside = outsideArea(candidate, viewport);
      const overlap = placed.reduce((sum, other) => sum + overlapArea(candidate, other, 5), 0);
      const iconHits = obstacles.reduce((sum, obstacle) => sum + (hitsCircle(candidate, obstacle) ? 1 : 0), 0);
      const score = outside * 1e9 + overlap * 1e7 + iconHits * 1e10 + candidate.distance;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
        if (!outside && !overlap && !iconHits && candidate.distance <= target.radius + Math.max(target.width, target.height)) break;
      }
    }
    placed.push(best!);
  }
  return placed;
}

function layoutScore(
  placements: MapLabelPlacement[],
  viewport: { width: number; height: number },
  obstacles: MapIconObstacle[],
): number {
  let score = placements.reduce((sum, placement) =>
    sum + outsideArea(placement, viewport) * 1e9 + placement.distance, 0);
  for (let i = 0; i < placements.length; i++) {
    score += obstacles.reduce((sum, obstacle) => sum + (hitsCircle(placements[i], obstacle) ? 1e10 : 0), 0);
    for (let j = i + 1; j < placements.length; j++) score += overlapArea(placements[i], placements[j], 5) * 1e7;
  }
  return score;
}

/**
 * Place every member/gig datablock in screen space. Several deterministic
 * orderings are tried because the densest point should not always claim the
 * same scarce space first; the least-overlapping complete layout wins.
 */
export function layoutMemberMapLabels(
  targets: MapLabelTarget[],
  viewport: { width: number; height: number },
  extraObstacles: MapIconObstacle[] = [],
): MapLabelPlacement[] {
  if (!targets.length) return [];
  const obstacles = [
    ...targets.map(({ x, y, radius }) => ({ x, y, radius })),
    ...extraObstacles,
  ];
  const dense = densityOrder(targets);
  const orders = [
    dense,
    [...dense].reverse(),
    [...targets].sort((a, b) => a.x - b.x),
    [...targets].sort((a, b) => b.x - a.x),
    [...targets].sort((a, b) => a.y - b.y),
    [...targets].sort((a, b) => b.y - a.y),
  ];
  let best = solveOrder(orders[0], viewport, obstacles);
  let bestScore = layoutScore(best, viewport, obstacles);
  for (const order of orders.slice(1)) {
    const attempt = solveOrder(order, viewport, obstacles);
    const score = layoutScore(attempt, viewport, obstacles);
    if (score < bestScore) {
      best = attempt;
      bestScore = score;
    }
  }
  const byId = new Map(best.map((placement) => [placement.id, placement]));
  return targets.map(({ id }) => byId.get(id)!);
}

/** Closest point on a datablock edge for its leader line. */
export function mapLabelLeaderEnd(placement: Rect, target: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(placement.x, Math.min(target.x, placement.x + placement.width)),
    y: Math.max(placement.y, Math.min(target.y, placement.y + placement.height)),
  };
}
