/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import { Layout, doc, signedCover } from "./views.tsx";
import type { SlotView } from "./slots.ts";
import type { AccessRequest } from "./access.ts";

const fmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});
const when = (iso: string): string => {
  try {
    return fmt.format(new Date(iso));
  } catch {
    return iso;
  }
};

/** One slot card. `mine` = the current phone is already in. `phone` present = authed. */
const SlotCard: FC<{ s: SlotView; authed: boolean; mine: boolean; big?: boolean }> = ({ s, authed, mine, big }) => {
  const full = s.spotsLeft <= 0;
  return (
    <article class={`slot${big ? " big" : ""}`}>
      <div class="slot-cover">
        {s.gameOpen ? (
          <div class="open-cover">🎲<span>Game to be picked</span></div>
        ) : s.coverGameId && s.coverSource ? (
          <img src={signedCover(s.coverGameId, s.coverSource)} alt={s.gameName ?? ""} loading="lazy" />
        ) : (
          <div class="open-cover">🎲<span>{s.gameName}</span></div>
        )}
      </div>
      <div class="slot-body">
        <div class="slot-title">{s.gameOpen ? "Open slot" : s.gameName}</div>
        <div class="slot-meta">
          <span>🗓 {when(s.start)}</span>
          {s.location ? <span>📍 {s.location}</span> : null}
        </div>
        <div class="slot-count">
          <span class={`spots${full ? " full" : ""}`}>{s.taken} / {s.capacity} in</span>
          {full ? <span class="tag">Full</span> : <span class="tag ok">{s.spotsLeft} left</span>}
        </div>
        {authed ? (
          mine ? (
            <form method="post" action={`/slot/${s.id}/leave`}>
              <button class="btn leave" type="submit">Leave</button>
            </form>
          ) : full ? (
            <button class="btn" disabled>Full</button>
          ) : (
            <form method="post" action={`/slot/${s.id}/join`} class="join">
              {s.gameOpen ? <input name="gamePref" placeholder="Game you'd like (optional)" autocomplete="off" /> : null}
              <button class="btn play" type="submit">I want to play</button>
            </form>
          )
        ) : (
          <a class="btn play" href={`#want-${s.id}`}>I want to play</a>
        )}
      </div>
      {!authed ? <PhoneAsk slotId={s.id} /> : null}
    </article>
  );
};

/** Phone/WhatsApp request form, revealed via :target when "I want to play" is tapped. */
const PhoneAsk: FC<{ slotId: string }> = ({ slotId }) => (
  <div class="phoneask" id={`want-${slotId}`}>
    <div class="phoneask-inner">
      <a class="x" href="#" aria-label="Close">✕</a>
      <h3>Want to play?</h3>
      <p class="note">Drop your WhatsApp — the owner approves and you get a pass link to join.</p>
      <form method="post" action="/access/request">
        <input type="hidden" name="slotId" value={slotId} />
        <input name="name" placeholder="Your name (optional)" autocomplete="name" />
        <input name="phone" type="tel" placeholder="WhatsApp e.g. 5511999998888" required autocomplete="tel" />
        <button class="btn play" type="submit">Request to play</button>
      </form>
    </div>
  </div>
);

export function playPage(opts: { slots: SlotView[]; authed: boolean; mine: Set<string>; identity?: string }): string {
  const { slots, authed, mine, identity } = opts;
  return doc(
    <Layout title="Play a game">
      <div class="topbar">
        <div>
          <div class="title">🎲 Play a game</div>
          <div class="sub">{slots.length} upcoming slot{slots.length === 1 ? "" : "s"}</div>
        </div>
        <div class="right">
          <a class="btn" href="/">Collection</a>
          {authed ? (
            <>
              <span class="badge">{identity}</span>
              <a class="btn" href="/auth/logout">Exit</a>
            </>
          ) : null}
        </div>
      </div>
      <main class="play">
        {slots.length === 0 ? (
          <p class="empty">No game slots scheduled yet. Check back soon.</p>
        ) : (
          <div class="slots">{slots.map((s) => <SlotCard s={s} authed={authed} mine={mine.has(s.id)} />)}</div>
        )}
      </main>
    </Layout>,
  );
}

export function slotPage(opts: { slot: SlotView; authed: boolean; mine: boolean }): string {
  const { slot, authed, mine } = opts;
  return doc(
    <Layout title={slot.gameOpen ? "Open slot" : slot.gameName ?? "Slot"}>
      <div class="topbar">
        <div class="title">🎲 {slot.gameOpen ? "Open slot" : slot.gameName}</div>
        <a class="btn" href="/play">All slots</a>
      </div>
      <main class="play one">
        <div class="slots">
          <SlotCard s={slot} authed={authed} mine={mine} big />
        </div>
      </main>
    </Layout>,
  );
}

/** Confirmation shown after a phone request; offers a wa.me deep link to notify the owner. */
export function requestSentPage(opts: { phone: string; ownerWa: string; approved: boolean }): string {
  const { phone, ownerWa, approved } = opts;
  const text = encodeURIComponent(`Hi! I'd like to play a board game. My WhatsApp: ${phone}`);
  return doc(
    <Layout title="Request sent">
      <div class="topbar">
        <div class="title">🎲 {approved ? "You're in" : "Request sent"}</div>
        <a class="btn" href="/play">Slots</a>
      </div>
      <main class="play one">
        <div class="notice">
          {approved ? (
            <>
              <h2>You're approved 🎉</h2>
              <p class="note">You can join any open slot now.</p>
              <a class="btn play" href="/play">See the slots</a>
            </>
          ) : (
            <>
              <h2>Request received</h2>
              <p class="note">The owner will approve you shortly. Tap below to ping them on WhatsApp now.</p>
              {ownerWa ? <a class="btn play" href={`https://wa.me/${ownerWa}?text=${text}`} target="_blank" rel="noopener">Message the owner</a> : null}
            </>
          )}
        </div>
      </main>
    </Layout>,
  );
}

/** Admin view: pending/approved requests with approve/deny + generated pass links. */
export function requestsAdminPage(opts: { requests: AccessRequest[]; baseUrl: string; passLinks: Record<string, string> }): string {
  const { requests, passLinks } = opts;
  const pending = requests.filter((r) => r.status === "pending");
  const others = requests.filter((r) => r.status !== "pending");
  return doc(
    <Layout title="Access requests">
      <div class="topbar">
        <div class="title">🎲 Access requests</div>
        <a class="btn" href="/play">Slots</a>
      </div>
      <main class="play">
        <h2 class="sec">Pending ({pending.length})</h2>
        {pending.length === 0 ? <p class="note">Nothing pending.</p> : null}
        {pending.map((r) => (
          <div class="req">
            <div class="req-info">
              <b>{r.name ?? "Someone"}</b>
              <span class="note">📱 {r.phone}</span>
              {r.message ? <span class="note">"{r.message}"</span> : null}
            </div>
            <div class="req-actions">
              <form method="post" action="/admin/requests/approve">
                <input type="hidden" name="phone" value={r.phone} />
                <button class="btn play" type="submit">Approve</button>
              </form>
              <form method="post" action="/admin/requests/deny">
                <input type="hidden" name="phone" value={r.phone} />
                <button class="btn leave" type="submit">Deny</button>
              </form>
            </div>
          </div>
        ))}
        <h2 class="sec">Approved &amp; denied</h2>
        {others.map((r) => (
          <div class="req">
            <div class="req-info">
              <b>{r.name ?? r.phone}</b>
              <span class="note">📱 {r.phone} · {r.status}</span>
              {r.status === "approved" && passLinks[r.phone] ? (
                <input class="note" readonly value={passLinks[r.phone]} onclick="this.select()" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ffffff33;background:#0009;color:#fff" />
              ) : null}
            </div>
            {r.status === "approved" ? (
              <div class="req-actions">
                <a class="btn" href={`https://wa.me/${r.phone}?text=${encodeURIComponent("Your pass link: " + (passLinks[r.phone] ?? ""))}`} target="_blank" rel="noopener">Send link</a>
              </div>
            ) : null}
          </div>
        ))}
      </main>
    </Layout>,
  );
}
