// Entry point for .github/workflows/nh-receiver.yml. Reads the triggering comment's id from the environment,
// replays the issue through receiver.ts and posts at most one reply. Holds no secret beyond the run's own
// GITHUB_TOKEN (issues: write, contents: read). Exit 0 = handled or ignored; exit 1 = failed, visibly.
import { createHash } from "node:crypto";
import { handle, type Comment, type Deps } from "./receiver.ts";

const API = "https://api.github.com";

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`missing environment variable ${name}`);
  return v;
}

async function api(path: string, token: string, init?: { method: string; body: string }): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "nh-coordination-receiver",
      ...(init ? { "content-type": "application/json" } : {}),
    },
    ...(init ? { body: init.body } : {}),
  });
  if (!res.ok) throw new Error(`GitHub API ${init?.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}`);
  return (await res.json()) as unknown;
}

async function main(): Promise<number> {
  const repo = need("NH_REPO");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("NH_REPO is malformed");
  const issue = Number(need("NH_ISSUE_NUMBER"));
  const commentId = Number(need("NH_COMMENT_ID"));
  if (!Number.isInteger(issue) || !Number.isInteger(commentId)) throw new Error("issue or comment id is not an integer");
  const allowed = need("NH_ALLOWED_ISSUES").split(",").map((s) => Number(s.trim()));
  if (!allowed.includes(issue)) {
    console.log(`issue #${issue} is not in the allowed list; ignoring`);
    return 0;
  }
  const token = need("GH_TOKEN");

  const deps: Deps = {
    sha256: (t) => createHash("sha256").update(t, "utf8").digest("hex"),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
    listComments: async () => {
      const out: Comment[] = [];
      for (let page = 1; page <= 20; page++) {
        const rows = (await api(`/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`, token)) as Array<{
          id: number;
          body?: string;
          created_at: string;
          updated_at: string;
          author_association: string;
          user?: { type?: string } | null;
        }>;
        for (const r of rows) {
          out.push({
            id: r.id,
            body: r.body ?? "",
            created_at: r.created_at,
            updated_at: r.updated_at,
            author_association: r.author_association,
            user_type: r.user?.type ?? "",
          });
        }
        if (rows.length < 100) return out;
      }
      throw new Error("issue has more comments than the receiver will replay");
    },
    postComment: async (body) => {
      await api(`/repos/${repo}/issues/${issue}/comments`, token, { method: "POST", body: JSON.stringify({ body }) });
    },
  };

  await handle(commentId, deps);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`receiver failed: ${err instanceof Error ? err.message : "unknown error"}`);
    process.exit(1);
  },
);
