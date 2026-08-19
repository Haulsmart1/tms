/* Job-order optimization for one vehicle's day.

   TomTom's computeBestOrder reorders individual waypoints and pins the first
   and last in place, but the Planning page's unit is the whole job and no job
   is pinned. So the server fetches an NxN travel-time matrix between job
   representative points (Matrix Routing v2, see app/api/tomtom/matrix) and
   this module picks the order entirely in-process, where it is unit testable
   and costs no further API calls.

   The path is OPEN: a day starts at the first job and ends at the last. There
   is no depot in the schema to return to, so this is not a cycle.

   Exact search runs to 8 jobs (8! = 40,320 paths, with pruning, microseconds).
   Above that, nearest-neighbour from every start improved by 2-opt: not
   provably optimal, but a vehicle with 9+ jobs in one day is already rare. */

const EXACT_LIMIT = 8;

/** Total travel seconds along an open path through `order`. */
export function pathSeconds(order: number[], matrix: number[][]): number {
  let total = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    total += matrix[order[i]][order[i + 1]];
  }
  return total;
}

/** Precondition: `matrix` is square with non-negative, non-NaN entries
    (Infinity is fine for unreachable pairs; NaN would silently corrupt every
    comparison it touches). The TomTom matrix parser upholds this. */
export function bestOrder(matrix: number[][]): number[] {
  const n = matrix.length;
  if (n <= 1) return matrix.map((_, i) => i);
  if (n <= EXACT_LIMIT) return exhaustive(matrix);
  return twoOpt(nearestNeighbour(matrix), matrix);
}

function exhaustive(matrix: number[][]): number[] {
  const n = matrix.length;
  let best = Array.from({ length: n }, (_, i) => i);
  let bestCost = pathSeconds(best, matrix);
  const current: number[] = [];
  const used = new Array(n).fill(false);

  function walk(cost: number) {
    if (cost >= bestCost) return; // prune: this prefix already loses
    if (current.length === n) {
      best = current.slice();
      bestCost = cost;
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const hop = current.length === 0 ? 0 : matrix[current[current.length - 1]][i];
      used[i] = true;
      current.push(i);
      walk(cost + hop);
      current.pop();
      used[i] = false;
    }
  }

  walk(0);
  return best;
}

function nearestNeighbour(matrix: number[][]): number[] {
  const n = matrix.length;
  // An all-Infinity matrix must yield SOME permutation, never an empty order.
  let best: number[] = Array.from({ length: n }, (_, i) => i);
  let bestCost = pathSeconds(best, matrix);
  // The path is open, so the start matters: try them all and keep the winner.
  for (let start = 0; start < n; start++) {
    const order = [start];
    const used = new Array(n).fill(false);
    used[start] = true;
    while (order.length < n) {
      const last = order[order.length - 1];
      let next = -1;
      for (let i = 0; i < n; i++) {
        if (!used[i] && (next === -1 || matrix[last][i] < matrix[last][next])) next = i;
      }
      used[next] = true;
      order.push(next);
    }
    const cost = pathSeconds(order, matrix);
    if (cost < bestCost) {
      bestCost = cost;
      best = order;
    }
  }
  return best;
}

function twoOpt(order: number[], matrix: number[][]): number[] {
  let current = order.slice();
  let currentCost = pathSeconds(current, matrix);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const candidate = current
          .slice(0, i)
          .concat(current.slice(i, j + 1).reverse(), current.slice(j + 1));
        const cost = pathSeconds(candidate, matrix);
        if (cost < currentCost) {
          current = candidate;
          currentCost = cost;
          improved = true;
        }
      }
    }
  }
  return current;
}
