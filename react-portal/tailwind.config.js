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
                "primary": "#258cf4",
                "accent": "#00ff9d",
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
