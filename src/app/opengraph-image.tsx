import { ImageResponse } from "next/og";

export const alt = "ApplyPack - We find the jobs. We get you ready to apply.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#fbfafc", color: "#17131f", padding: 64, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", flex: 1, borderRadius: 36, overflow: "hidden", border: "2px solid #dcd8e3" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "68%", padding: 54, background: "#ddd4ff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 800 }}>
            <span style={{ display: "flex", width: 54, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", background: "#5637d7", color: "white" }}>A</span>
            ApplyPack
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#5637d7", fontSize: 21, fontWeight: 800, letterSpacing: 2 }}>24-HOUR JOB SEARCH HELP</span>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 18, fontSize: 64, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>
              <span>We find the jobs.</span>
              <span>We get you ready to apply.</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 28, width: "32%", padding: 42, background: "#12102e", color: "white" }}>
          <div style={{ display: "flex", flexDirection: "column" }}><strong style={{ fontSize: 62 }}>$20</strong><span style={{ fontSize: 22 }}>10 matched jobs</span></div>
          <div style={{ height: 2, background: "#3b355d" }} />
          <div style={{ display: "flex", flexDirection: "column" }}><strong style={{ fontSize: 62 }}>$8</strong><span style={{ fontSize: 22 }}>per Apply Pack</span></div>
        </div>
      </div>
    </div>,
    size,
  );
}
