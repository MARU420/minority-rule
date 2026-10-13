/** Remote E2E against a deployed server: URL from REMOTE_URL env. */
import { io as clientIO } from "socket.io-client";

const URL = process.env.REMOTE_URL;
if (!URL) {
  console.error("set REMOTE_URL");
  process.exit(2);
}
const TIMEOUT = 240_000;
const timer = setTimeout(() => {
  console.error("E2E TIMEOUT");
  process.exit(2);
}, TIMEOUT);

function makeClient(name) {
  const s = clientIO(URL, { transports: ["websocket", "polling"], timeout: 60000 });
  const seen = [];
  s.onAny((event, payload) => seen.push({ event, payload }));
  s.on("SAFE_ERROR", (p) => console.log(`[${name} SAFE_ERROR]`, JSON.stringify(p)));
  s.on("QUESTION_ACCEPTED", () => console.log(`[${name}] question accepted`));
  s.on("VOTE_ACCEPTED", () => console.log(`[${name}] vote accepted`));
  return { s, seen };
}
const waitFor = (s, event, pred = () => true) =>
  new Promise((resolve) => {
    const h = (payload) => {
      if (pred(payload)) {
        s.off(event, h);
        resolve(payload);
      }
    };
    s.on(event, h);
  });
const emit = (s, event, payload) =>
  new Promise((resolve) => {
    s.emit(event, payload);
    setTimeout(resolve, 60);
  });
async function session(client, name) {
  client.s.emit("ISSUE_SESSION", { displayName: name });
  return waitFor(client.s, "SESSION_ISSUED");
}

try {
  const A = makeClient("A");
  const B = makeClient("B");
  const C = makeClient("C");
  const a = await session(A, "Alice");
  const b = await session(B, "Bob");
  const c = await session(C, "Cara");
  for (const [cl, ses] of [[A, a], [B, b], [C, c]]) {
    cl.s.emit("AUTHENTICATE", { sessionId: ses.sessionId, token: ses.token });
    await waitFor(cl.s, "AUTHENTICATED");
  }

  A.s.emit("CREATE_ROOM", {
    displayName: "Alice",
    settings: { targetParticipants: 3, minParticipants: 3, votingDurationSec: 8, roundIntroSec: 0, submissionDurationSec: 30 },
  });
  const { code } = await waitFor(A.s, "ROOM_CREATED");
  console.log("room", code);
  B.s.emit("JOIN_ROOM", { code, displayName: "Bob" });
  await waitFor(B.s, "ROOM_JOINED");
  C.s.emit("JOIN_ROOM", { code, displayName: "Cara" });
  await waitFor(C.s, "ROOM_JOINED");

  // negative: spoofed vote from outsider session before start
  const X = makeClient("X");
  const x = await session(X, "Mallory");
  X.s.emit("AUTHENTICATE", { sessionId: x.sessionId, token: x.token });
  await waitFor(X.s, "AUTHENTICATED");
  X.s.emit("SUBMIT_VOTE", { code, vote: "YES" });
  const safeErr = await waitFor(X.s, "SAFE_ERROR");
  if (safeErr.message !== "not-participant") throw new Error(`spoof not rejected: ${JSON.stringify(safeErr)}`);
  console.log("spoof rejected ok");

  A.s.emit("START_MATCH", { code });
  await waitFor(A.s, "MATCH_STARTED");
  // oversized question rejected
  A.s.emit("SUBMIT_QUESTION", { code, text: "x".repeat(400) });
  const qerr = await waitFor(A.s, "SAFE_ERROR");
  if (!String(qerr.message).startsWith("bad-question")) throw new Error("oversize not rejected");
  console.log("oversize rejected ok");

  const questions = [
    "Should the table target the leader? (YES/NO)",
    "Is bluffing acceptable here? (YES/NO)",
    "Should ties punish everyone? (YES/NO)",
  ];
  await emit(A.s, "SUBMIT_QUESTION", { code, text: questions[0] });
  await emit(B.s, "SUBMIT_QUESTION", { code, text: questions[1] });
  await emit(C.s, "SUBMIT_QUESTION", { code, text: questions[2] });

  const votePlan = [
    ["YES", "YES", "NO"], // minority NO (Cara) wins
    ["YES", "NO", "NO"], // minority YES (Alice) wins
    ["YES", "YES", "NO"], // minority NO wins
  ];
  let resolved = 0;
  let votingP = waitFor(A.s, "ROUND_STARTED", (p) => p.voting === true);
  for (let r = 0; r < 3; r++) {
    await votingP;
    const resolvedP = waitFor(A.s, "ROUND_RESOLVED");
    await emit(A.s, "SUBMIT_VOTE", { code, vote: votePlan[r][0] });
    await emit(B.s, "SUBMIT_VOTE", { code, vote: votePlan[r][1] });
    await emit(C.s, "SUBMIT_VOTE", { code, vote: votePlan[r][2] });
    const res = await resolvedP;
    resolved++;
    console.log(`round ${r + 1} raw:`, JSON.stringify(res));
    if (res.pot !== 30) throw new Error(`round ${r}: pot ${res.pot} != 30`);
    if (!["YES", "NO"].includes(res.minority)) throw new Error(`round ${r}: bad minority`);
    console.log(`round ${r + 1}: ${res.yes}Y/${res.no}N minority=${res.minority} pot=${res.pot}`);
    // vote privacy over the wire: no pre-resolution event may carry choices
    for (const cl of [A, B, C]) {
      for (const e of cl.seen.filter((e) => e.event === "VOTE_STATUS_UPDATED")) {
        if (JSON.stringify(e.payload).includes('"YES"') || JSON.stringify(e.payload).includes('"NO"'))
          throw new Error("vote choice leaked in VOTE_STATUS_UPDATED");
      }
    }
    if (r < 2) {
      votingP = waitFor(A.s, "ROUND_STARTED", (p) => p.voting === true);
      await emit(A.s, "READY_NEXT", { code });
    }
  }
  const done = await waitFor(A.s, "MATCH_COMPLETED");
  if (done.leaderboard.length !== 3) throw new Error("leaderboard wrong size");
  const supply = done.leaderboard.reduce((s, p) => s + p.balance, 0);
  if (supply !== 300) throw new Error(`supply ${supply} != 300`);
  if (done.leaderboard[0].balance < done.leaderboard[2].balance) throw new Error("leaderboard unsorted");
  console.log("MATCH_COMPLETED ok, supply=300, leaderboard sorted");
  console.log(`E2E PASS: ${resolved} rounds resolved`);
} finally {
  clearTimeout(timer);
}
process.exit(0);
