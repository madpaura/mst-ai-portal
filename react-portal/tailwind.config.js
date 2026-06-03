/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                // ── Semantic theming tokens (PRD #150 / slice #151) ──
                // Each maps to a CSS variable defined per theme×mode in
                // index.css. Dark mode is a variable flip — no `dark:` needed.
                // surfaces
                "canvas":         "var(--canvas)",
                "surface":        "var(--surface)",
                "surface-muted":  "var(--surface-muted)",
                // text (4-rank hierarchy)
                "text-strong":    "var(--text-strong)",
                "text":           "var(--text)",
                "text-muted":     "var(--text-muted)",
                "text-faint":     "var(--text-faint)",
                // borders
                "border-base":    "var(--border-base)",
                "border-strong":  "var(--border-strong)",
                // brand — primary/accent use RGB-channel vars so Tailwind
                // opacity modifiers (bg-primary/10, border-primary/20, …) work.
                "primary":        "rgb(var(--primary) / <alpha-value>)",
                "primary-subtle": "var(--primary-subtle)",
                "accent":         "rgb(var(--accent) / <alpha-value>)",
                // state (fg + paired subtle fill)
                "success":         "var(--success)",
                "success-subtle":  "var(--success-subtle)",
                "warning":         "var(--warning)",
                "warning-subtle":  "var(--warning-subtle)",
                "danger":          "var(--danger)",
                "danger-subtle":   "var(--danger-subtle)",
                "info":            "var(--info)",
                "info-subtle":     "var(--info-subtle)",

                // ── Legacy mode-specific tokens (kept for non-breaking) ──
                // Page/layout backgrounds
                "background-light": "#f5f7f8",
                "background-dark": "#0a0f14",
                // Card / modal backgrounds
                "card-light": "#ffffff",
                "card-dark": "#131a22",
                // Sidebar / header backgrounds
                "sidebar-light": "#f8fafc",
                "sidebar-dark": "#0d1218",
                // Form input backgrounds
                "input-light": "#ffffff",
                "input-dark": "#0f172a",
                // Secondary panel / section backgrounds
                "panel-light": "#f1f5f9",
                "panel-dark": "#1e293b",
                // Muted / secondary button backgrounds
                "muted-light": "#e2e8f0",
                "muted-dark": "#1e293b",
                // Border colors
                "border-light": "#e2e8f0",
                "border-dark": "#1e293b",
            },
            fontFamily: {
                "sans": ["Space Grotesk", "system-ui", "sans-serif"],
                "display": ["Space Grotesk", "sans-serif"]
            },
            borderRadius: {
                "DEFAULT": "0.25rem",
                "lg": "0.5rem",
                "xl": "0.75rem",
                "2xl": "1rem",
                "full": "9999px"
            },
        },
    },
    plugins: [],
}
