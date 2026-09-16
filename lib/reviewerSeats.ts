/**
 * Which seat a person actually holds — from the assignment, not from the row.
 *
 * The frontend mirror of `backend/utils/reviewer_slots.effective_role()`.
 *
 * Why this exists: `extraction_results.reviewer_role` is documented as "a
 * denormalised label, never a key", and it goes stale. Measured on the live
 * Analgesics Calibration project: Esther is assigned `reviewer_2` on both
 * papers, and 2 of her 7 saved rows carry `NULL`. A screen reading the column
 * therefore labelled an assigned R2 as "Extra", while Allocations — reading
 * `review_assignments` — correctly showed R2. Two screens, two answers, same
 * reviewer, same moment.
 *
 * `review_assignments` is the authority, so anything that renders a seat should
 * resolve through here. The row's own label is kept only as a last resort, for
 * the legacy rows that have no assignment behind them at all (27 of 77 live
 * manual rows hold no seat, and most of those are genuinely seatless work).
 */

export interface SeatAssignment {
  reviewer_user_id: string;
  document_id: string;
  reviewer_role: string;
}

export interface SeatResolver {
  /**
   * The seat for this person on this paper.
   *
   * Falls back, in order, to: their only project-wide seat (assignments are
   * project-level, so a reviewer is usually in one seat throughout), then
   * whatever the row claimed, then null — which renders as "Extra", meaning a
   * save that is genuinely outside the R1/R2 comparison.
   */
  (userId: string | null | undefined, documentId?: string | null, rowRole?: string | null): string | null;
}

export function buildSeatResolver(assignments: readonly SeatAssignment[]): SeatResolver {
  const byPersonDoc = new Map<string, string>();
  const byPerson = new Map<string, Set<string>>();

  for (const a of assignments) {
    if (!a?.reviewer_user_id || !a.reviewer_role) continue;
    if (a.document_id) {
      byPersonDoc.set(`${a.reviewer_user_id}|${a.document_id}`, a.reviewer_role);
    }
    let seats = byPerson.get(a.reviewer_user_id);
    if (!seats) {
      seats = new Set<string>();
      byPerson.set(a.reviewer_user_id, seats);
    }
    seats.add(a.reviewer_role);
  }

  return (userId, documentId, rowRole) => {
    if (!userId) return rowRole ?? null;

    if (documentId) {
      const exact = byPersonDoc.get(`${userId}|${documentId}`);
      if (exact) return exact;
    }

    // No assignment for this exact paper. One seat across the project is still
    // an answer; two or more is ambiguous and the row's own label is better
    // than picking one arbitrarily.
    const seats = byPerson.get(userId);
    if (seats && seats.size === 1) return [...seats][0];

    return rowRole ?? null;
  };
}
