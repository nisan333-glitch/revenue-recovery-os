// Unhandled-message and failure detection for the NH bridge · PURE. No clock, no network, no disk.
//
// WHY THIS EXISTS. The bridge records a message and replies with a ledger receipt, and until now nothing
// looked at the pair. So a message that was never recorded — because the receiver skipped it, because the
// issue is outside the allow-list, or because the comment carried no envelope at all — was indistinguishable
// from one that went through. Silence looked like success, which is the one thing a coordination channel
// must never do.
//
// WHAT IT ANSWERS. For one issue's comments, in arrival order: which messages have a matching ledger
// receipt, which do not, and which comments carried something unusable. It decides nothing about content
// and it never reads a body: a body may hold anything, and this is a delivery check.
//
// THREE OUTCOMES AND THEY STAY DISTINGUISHABLE. `handled` is a message with a receipt whose `message_id`
// and `body_sha256` both match. `unhandled` is a message with no such receipt — the thing this exists to
// find. `unusable` is a comment the wire format rejected, which is a sender fault and not a delivery
// failure, so it is counted apart rather than folded into the other two.

export const INBOX_SCHEME = "nh-inbox/v1";

/** One comment, reduced to the delivery facts. The body is deliberately absent. */
export interface InboxComment {
  readonly commentId: number;
  readonly createdAt: string;
  readonly author: string;
  /** Present when the comment carried exactly one well-formed envelope. */
  readonly messageId: string | null;
  readonly bodySha256: string | null;
  /** Present when the comment is a ledger receipt produced by the receiver. */
  readonly receiptForMessageId: string | null;
  readonly receiptBodySha256: string | null;
  /** Why the wire format rejected it, if it did. */
  readonly errors: readonly string[];
}

export interface InboxFinding {
  readonly messageId: string;
  readonly commentId: number;
  readonly createdAt: string;
  readonly author: string;
}

export interface UnusableFinding {
  readonly commentId: number;
  readonly createdAt: string;
  readonly errors: readonly string[];
}

export interface InboxReport {
  readonly scheme: typeof INBOX_SCHEME;
  readonly issue: number;
  readonly commentsExamined: number;
  readonly messages: number;
  readonly receipts: number;
  readonly handled: readonly InboxFinding[];
  /** Messages with no matching receipt. THE REASON THIS TOOL EXISTS. */
  readonly unhandled: readonly InboxFinding[];
  /** A receipt whose message_id matches but whose body hash does not — a corrupted pair, not a delivery. */
  readonly hashMismatched: readonly InboxFinding[];
  /** Receipts naming a message that is not in this issue. Reported, never ignored. */
  readonly orphanReceipts: readonly { readonly messageId: string; readonly commentId: number }[];
  readonly unusable: readonly UnusableFinding[];
  /**
   * `true` only when at least one comment was examined AND nothing is unhandled, mismatched or orphaned.
   * An EMPTY issue is NOT healthy: a checker that reports success having looked at nothing is worse than
   * no checker, so `commentsExamined === 0` is its own outcome.
   */
  readonly healthy: boolean;
  readonly examinedSomething: boolean;
}

/**
 * Build the report. PURE and TOTAL: the same comments always produce the same answer.
 *
 * Matching requires BOTH the message id and the body hash to agree. Matching on the id alone would call a
 * pair delivered when the receipt describes different bytes, which is exactly the case a delivery check
 * must catch rather than wave through.
 */
export function buildInboxReport(issue: number, comments: readonly InboxComment[]): InboxReport {
  const receiptsById = new Map<string, InboxComment[]>();
  for (const c of comments) {
    if (c.receiptForMessageId === null) continue;
    const list = receiptsById.get(c.receiptForMessageId) ?? [];
    list.push(c);
    receiptsById.set(c.receiptForMessageId, list);
  }

  const handled: InboxFinding[] = [];
  const unhandled: InboxFinding[] = [];
  const hashMismatched: InboxFinding[] = [];
  const unusable: UnusableFinding[] = [];
  const messageIds = new Set<string>();

  for (const c of comments) {
    if (c.errors.length > 0) {
      unusable.push({ commentId: c.commentId, createdAt: c.createdAt, errors: Object.freeze([...c.errors]) });
      continue;
    }
    if (c.messageId === null) continue;
    messageIds.add(c.messageId);
    const finding: InboxFinding = {
      messageId: c.messageId, commentId: c.commentId, createdAt: c.createdAt, author: c.author,
    };
    const receipts = receiptsById.get(c.messageId) ?? [];
    if (receipts.length === 0) {
      unhandled.push(finding);
    } else if (receipts.some((r) => r.receiptBodySha256 === c.bodySha256)) {
      handled.push(finding);
    } else {
      hashMismatched.push(finding);
    }
  }

  const orphanReceipts = Object.freeze(
    comments
      .filter((c) => c.receiptForMessageId !== null && !messageIds.has(c.receiptForMessageId))
      .map((c) => Object.freeze({ messageId: c.receiptForMessageId!, commentId: c.commentId })),
  );

  const examinedSomething = comments.length > 0;
  return Object.freeze({
    scheme: INBOX_SCHEME,
    issue,
    commentsExamined: comments.length,
    messages: messageIds.size,
    receipts: [...receiptsById.values()].reduce((n, l) => n + l.length, 0),
    handled: Object.freeze(handled),
    unhandled: Object.freeze(unhandled),
    hashMismatched: Object.freeze(hashMismatched),
    orphanReceipts,
    unusable: Object.freeze(unusable),
    healthy:
      examinedSomething && unhandled.length === 0 && hashMismatched.length === 0 && orphanReceipts.length === 0,
    examinedSomething,
  });
}

/**
 * Exit code. 0 healthy · 1 something is unhandled or corrupted · 2 NOTHING WAS EXAMINED.
 *
 * The third is separate on purpose and is the same rule `coordination:validate` already keeps: an empty
 * look is not a clean bill of health.
 */
export function inboxExitCode(report: InboxReport): 0 | 1 | 2 {
  if (!report.examinedSomething) return 2;
  return report.healthy ? 0 : 1;
}

/** Render it. Counts and ids only — never a body, never a sender's prose. */
export function renderInboxReport(report: InboxReport): string {
  const lines: string[] = [];
  lines.push(`NH INBOX · issue #${report.issue} · ${report.scheme}`);
  lines.push(
    `examined ${report.commentsExamined} comment(s) · ${report.messages} message(s) · ${report.receipts} receipt(s)`,
  );
  lines.push("");
  lines.push(`handled:          ${report.handled.length}`);
  lines.push(`UNHANDLED:        ${report.unhandled.length}`);
  lines.push(`hash mismatched:  ${report.hashMismatched.length}`);
  lines.push(`orphan receipts:  ${report.orphanReceipts.length}`);
  lines.push(`unusable:         ${report.unusable.length}`);
  for (const u of report.unhandled) {
    lines.push(`  UNHANDLED ${u.messageId} · comment ${u.commentId} · ${u.createdAt} · from ${u.author}`);
  }
  for (const m of report.hashMismatched) {
    lines.push(`  HASH MISMATCH ${m.messageId} · comment ${m.commentId} — the receipt describes other bytes`);
  }
  for (const o of report.orphanReceipts) {
    lines.push(`  ORPHAN RECEIPT for ${o.messageId} · comment ${o.commentId} — no such message in this issue`);
  }
  for (const u of report.unusable) {
    lines.push(`  UNUSABLE comment ${u.commentId} · ${u.errors.length} wire error(s)`);
  }
  lines.push("");
  lines.push(
    !report.examinedSomething
      ? "NOTHING WAS EXAMINED. An empty look is not a clean bill of health."
      : report.healthy
        ? "HEALTHY · every message in this issue has a matching ledger receipt."
        : "NOT HEALTHY · at least one message was never recorded, or a pair does not agree.",
  );
  return lines.join("\n");
}
