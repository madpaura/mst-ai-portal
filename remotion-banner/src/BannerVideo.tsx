import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";

export interface BannerProps {
  variant: "A" | "B" | "C";
  companyLogo: string;
  seriesTag: string;
  topic: string;
  subtopic: string;
  episode: string;
  duration: string;
  presenter: string;
  presenterInitial: string;
  durationInSeconds?: number;
}

// ── Shared Logo SVG ──────────────────────────────────────

const AILogoSVG: React.FC<{ size: number; frame: number; fps: number; darkBg?: boolean }> = ({
  size,
  frame,
  fps,
  darkBg,
}) => {
  const iconPop = spring({ frame: frame - 8, fps, config: { damping: 12 } });
  const barDraw = interpolate(frame, [15, 26], [26, 0], { extrapolateRight: "clamp" });
  const bar2Draw = interpolate(frame, [17, 28], [26, 0], { extrapolateRight: "clamp" });
  const dotScale = interpolate(frame, [25, 32], [0, 1], { extrapolateRight: "clamp" });
  const triFade = interpolate(frame, [26, 34], [0, 1], { extrapolateRight: "clamp" });
  const ringOpacity = Math.abs(Math.sin((frame / fps) * Math.PI * 0.9)) * 0.5;
  const ringScale = 1 + Math.abs(Math.sin((frame / fps) * Math.PI * 0.9)) * 0.25;
  const ring2Opacity = Math.abs(Math.sin(((frame + 22) / fps) * Math.PI * 0.9)) * 0.4;
  const ring2Scale = 1 + Math.abs(Math.sin(((frame + 22) / fps) * Math.PI * 0.9)) * 0.25;

  const bgFill = darkBg ? "rgba(255,255,255,0.08)" : "#0d2d6b";
  const strokeFill = darkBg ? "rgba(255,255,255,0.2)" : "#1e4282";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      style={{
        transform: `scale(${iconPop}) rotate(${interpolate(iconPop, [0, 1], [-12, 0])}deg)`,
        opacity: iconPop,
      }}
    >
      <circle cx="36" cy="36" r="34" fill={bgFill} />
      <circle cx="36" cy="36" r="34" fill="none" stroke={strokeFill} strokeWidth="2" />
      <circle
        cx="36" cy="36" r="34" fill="none" stroke="#e05018" strokeWidth="1.5"
        opacity={ringOpacity}
        style={{ transform: `scale(${ringScale})`, transformOrigin: "center", transformBox: "fill-box" }}
      />
      <circle
        cx="36" cy="36" r="34" fill="none" stroke={strokeFill} strokeWidth="1"
        opacity={ring2Opacity}
        style={{ transform: `scale(${ring2Scale})`, transformOrigin: "center", transformBox: "fill-box" }}
      />
      <line
        x1="24.5" y1="23" x2="24.5" y2="49" stroke="#c03010" strokeWidth="5" strokeLinecap="round"
        strokeDasharray="26" strokeDashoffset={barDraw}
      />
      <line
        x1="24.5" y1="23" x2="24.5" y2="49" stroke="#e85520" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray="26" strokeDashoffset={bar2Draw}
      />
      <circle cx="24.5" cy="36" r="4.5" fill="#e06030" opacity={dotScale} style={{ transform: `scale(${dotScale})`, transformOrigin: "center", transformBox: "fill-box" }} />
      <circle cx="24.5" cy="36" r="3" fill="#f07840" opacity={dotScale} style={{ transform: `scale(${dotScale})`, transformOrigin: "center", transformBox: "fill-box" }} />
      <polygon points="28,23 50,36 28,49" fill="white" opacity={triFade} />
    </svg>
  );
};

// ── VARIANT A — Classic ──────────────────────────────────

const VariantA: React.FC<BannerProps & { frame: number; fps: number }> = (props) => {
  const { frame, fps } = props;

  const samsungFade = spring({ frame: frame - 2, fps, config: { damping: 15 } });
  const centerFade = spring({ frame: frame - 5, fps, config: { damping: 12 } });
  const centerY = interpolate(centerFade, [0, 1], [16, 0]);
  const divGrow = interpolate(frame, [10, 24], [0, 1], { extrapolateRight: "clamp" });
  const barUp = spring({ frame: frame - 16, fps, config: { damping: 12 } });
  const barY = interpolate(barUp, [0, 1], [100, 0]);

  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily: "'DM Sans', sans-serif" }}>
      {/* Corner accents */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 120, height: 120, borderTop: "4px solid #0a2a5e", borderLeft: "4px solid #0a2a5e" }} />
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 120, height: 120, borderBottom: "4px solid #0a2a5e", borderRight: "4px solid #0a2a5e" }} />

      {/* Horizontal lines */}
      <div style={{ position: "absolute", width: "100%", height: 1, top: "18%", background: "linear-gradient(90deg, transparent, #0a2a5e28, #0a2a5e48, #0a2a5e28, transparent)" }} />
      <div style={{ position: "absolute", width: "100%", height: 1, bottom: "20%", background: "linear-gradient(90deg, transparent, #0a2a5e28, #0a2a5e48, #0a2a5e28, transparent)" }} />

      {/* Dot pattern */}
      <svg style={{ position: "absolute", right: "4%", top: "50%", transform: "translateY(-50%)", opacity: 0.055 }} width="200" height="200" viewBox="0 0 200 200">
        <pattern id="dpa" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.8" fill="#0a2a5e" /></pattern>
        <rect width="200" height="200" fill="url(#dpa)" />
      </svg>

      {/* Samsung top */}
      <div style={{
        position: "absolute", top: "8%", left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: samsungFade, transform: `scale(${interpolate(samsungFade, [0, 1], [0.92, 1])})`,
      }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, letterSpacing: "0.36em", color: "#1428A0", fontSize: 36, textTransform: "uppercase" }}>
          {props.companyLogo}
        </span>
      </div>

      {/* Center content */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: centerFade, transform: `translateY(${centerY}px)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 50 }}>
          <AILogoSVG size={160} frame={frame} fps={fps} />
          <div style={{
            width: 3, height: 160,
            background: "linear-gradient(180deg, transparent, #0a2a5e55, transparent)",
            transform: `scaleY(${divGrow})`, transformOrigin: "center",
          }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 120, letterSpacing: "-0.03em", color: "#0a2a5e", lineHeight: 1 }}>
              AI <span style={{ color: "#e35a1a" }}>Ignite</span>
            </div>
            <div style={{ fontWeight: 300, fontSize: 28, letterSpacing: "0.22em", color: "#6b7a99", textTransform: "uppercase", marginTop: 8 }}>
              {props.seriesTag}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "#0a2a5e",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "24px 60px",
        transform: `translateY(${barY}%)`,
        opacity: barUp,
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, color: "#fff", fontSize: 36, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {props.topic}
          </div>
          <div style={{ fontWeight: 300, color: "#8aadd6", fontSize: 26, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {props.subtopic}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
          <div style={{ background: "rgba(227,90,26,0.3)", border: "1px solid rgba(227,90,26,0.45)", borderRadius: 30, padding: "8px 22px", fontSize: 26, color: "#f8a87a", whiteSpace: "nowrap" }}>
            {props.episode}
          </div>
          <div style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 30, padding: "8px 22px", fontSize: 26, color: "#b8cee8", whiteSpace: "nowrap" }}>
            {props.duration}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0, marginLeft: 30 }}>
          <div style={{
            width: 60, height: 60, borderRadius: "50%", background: "#e35a1a",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 28, color: "#fff",
          }}>
            {props.presenterInitial}
          </div>
          <div style={{ fontSize: 26, color: "#b8cee8", whiteSpace: "nowrap" }}>{props.presenter}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── VARIANT B — Split ────────────────────────────────────

const VariantB: React.FC<BannerProps & { frame: number; fps: number }> = (props) => {
  const { frame, fps } = props;

  const slideRight = spring({ frame: frame - 3, fps, config: { damping: 12 } });
  const slideX = interpolate(slideRight, [0, 1], [-100, 0]);
  const rightFade = spring({ frame: frame - 10, fps, config: { damping: 12 } });
  const rightY = interpolate(rightFade, [0, 1], [16, 0]);
  const samsungFade = spring({ frame: frame - 5, fps, config: { damping: 15 } });

  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily: "'DM Sans', sans-serif" }}>
      {/* Left panel */}
      <div style={{
        position: "absolute", top: 0, left: 0, bottom: 0, width: "36%",
        background: "#0a2a5e",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 40,
        transform: `translateX(${slideX}%)`,
        opacity: slideRight,
      }}>
        <div style={{ opacity: samsungFade * 0.6 }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, letterSpacing: "0.2em", color: "#fff", fontSize: 28, textTransform: "uppercase" }}>
            {props.companyLogo}
          </span>
        </div>
        <AILogoSVG size={140} frame={frame} fps={fps} darkBg />
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 80, letterSpacing: "-0.03em", color: "#fff", lineHeight: 1, textAlign: "center" }}>
          AI <span style={{ color: "#e35a1a" }}>Ignite</span>
        </div>
        <div style={{ fontWeight: 300, fontSize: 22, letterSpacing: "0.2em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
          {props.seriesTag}
        </div>
      </div>

      {/* Right panel */}
      <div style={{
        position: "absolute", top: 0, left: "36%", right: 0, bottom: 0,
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: 80, gap: 24,
        opacity: rightFade, transform: `translateY(${rightY}px)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ background: "#e35a1a", color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 28, padding: "8px 22px", borderRadius: 6 }}>
            {props.episode}
          </div>
          <div style={{ background: "#f0f3fa", color: "#0a2a5e", fontSize: 26, padding: "8px 22px", borderRadius: 6, border: "1px solid #d0d8ee" }}>
            {props.duration}
          </div>
        </div>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 64, color: "#0a2a5e", lineHeight: 1.15 }}>
          {props.topic}
        </div>
        <div style={{ width: 70, height: 4, background: "#e35a1a", borderRadius: 2 }} />
        <div style={{ fontWeight: 400, fontSize: 32, color: "#6b7a99" }}>
          {props.subtopic}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 8 }}>
          <div style={{
            width: 60, height: 60, borderRadius: "50%", background: "#0a2a5e",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 28, color: "#fff",
          }}>
            {props.presenterInitial}
          </div>
          <div>
            <div style={{ fontSize: 28, color: "#0a2a5e", fontWeight: 500 }}>{props.presenter}</div>
            <div style={{ fontSize: 22, color: "#9aa" }}>Presenter</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── VARIANT C — Minimal ──────────────────────────────────

const VariantC: React.FC<BannerProps & { frame: number; fps: number }> = (props) => {
  const { frame, fps } = props;

  const samsungFade = spring({ frame: frame - 1, fps, config: { damping: 15 } });
  const centerFade = spring({ frame: frame - 5, fps, config: { damping: 12 } });
  const centerY = interpolate(centerFade, [0, 1], [16, 0]);

  return (
    <AbsoluteFill style={{ background: "#fff", fontFamily: "'DM Sans', sans-serif" }}>
      {/* Top stripe */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: "linear-gradient(90deg, #0a2a5e, #1a52b0, #e35a1a)" }} />
      {/* Bottom stripe */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 5, background: "#0a2a5e" }} />

      {/* Samsung top */}
      <div style={{
        position: "absolute", top: "13%", left: 0, right: 0,
        display: "flex", justifyContent: "center",
        opacity: samsungFade, transform: `scale(${interpolate(samsungFade, [0, 1], [0.92, 1])})`,
      }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, letterSpacing: "0.36em", color: "#1428A0", fontSize: 36, textTransform: "uppercase" }}>
          {props.companyLogo}
        </span>
      </div>

      {/* Center block */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32,
        opacity: centerFade, transform: `translateY(${centerY}px)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <AILogoSVG size={140} frame={frame} fps={fps} />
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 110, letterSpacing: "-0.03em", color: "#0a2a5e", lineHeight: 1 }}>
            AI <span style={{ color: "#e35a1a" }}>Ignite</span>
          </div>
        </div>
        <div style={{ fontWeight: 500, fontSize: 48, color: "#0a2a5e", textAlign: "center" }}>
          {props.topic}
        </div>
        <div style={{ fontWeight: 300, fontSize: 30, color: "#8090a8", textAlign: "center" }}>
          {props.subtopic}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <span style={{ fontWeight: 600, fontSize: 26, color: "#0a2a5e", letterSpacing: "0.06em" }}>{props.episode}</span>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e35a1a" }} />
          <span style={{ fontSize: 26, color: "#6b7a99", letterSpacing: "0.06em" }}>{props.duration}</span>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e35a1a" }} />
          <span style={{ fontSize: 26, color: "#6b7a99", letterSpacing: "0.06em" }}>{props.presenter}</span>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#e35a1a" }} />
          <span style={{ fontSize: 26, color: "#6b7a99", letterSpacing: "0.06em" }}>{props.seriesTag}</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Main Composition ─────────────────────────────────────

export const BannerVideo: React.FC<BannerProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      {/* Load Google Fonts */}
      <style>
        {`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=Space+Grotesk:wght@600;700&display=swap');`}
      </style>

      {props.variant === "A" && <VariantA {...props} frame={frame} fps={fps} />}
      {props.variant === "B" && <VariantB {...props} frame={frame} fps={fps} />}
      {props.variant === "C" && <VariantC {...props} frame={frame} fps={fps} />}
    </AbsoluteFill>
  );
};
