import { ImageResponse } from "next/og";
import { communityCoordinate, decodeEntity } from "@voxboard/protocol";
import { fetchBoardSnapshot } from "@/lib/nostr/server";

export const alt = "Voxboard board";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Dynamic OG card for a shared board link: board name + idea count on the paper-and-ink brand. Satori
 * (next/og) renders inline styles, not Tailwind, so the brand values are mirrored here by hand.
 */
export default async function Image({ params }: { params: Promise<{ naddr: string }> }) {
  const { naddr } = await params;
  const decoded = decodeEntity(naddr);

  let name = "Voxboard";
  let description = "Open feedback boards on Nostr";
  let ideaCount = 0;
  if (decoded && decoded.type === "board") {
    const snapshot = await fetchBoardSnapshot(communityCoordinate(decoded.ref), decoded.relays);
    if (snapshot.board) {
      name = snapshot.board.name;
      description = snapshot.board.description ?? description;
      ideaCount = snapshot.ideas.length;
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fbfaf7",
          color: "#1a1a18",
          padding: "72px",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "#2b4bf2" }} />
          <div style={{ fontSize: 30, letterSpacing: "-0.5px" }}>Voxboard</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: "-2px", lineHeight: 1.05 }}>
            {name}
          </div>
          <div style={{ fontSize: 30, color: "#6b6b63", lineHeight: 1.3, maxWidth: 980 }}>
            {description.slice(0, 140)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#6b6b63" }}>
          <span>{ideaCount} ideas</span>
          <span>Feedback boards on Nostr</span>
        </div>
      </div>
    ),
    size,
  );
}
