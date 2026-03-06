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
                "background-light": "#f5f7f8",
                "background-dark": "#0a0f14",
                "card-light": "#ffffff",
                "card-dark": "#131a22",
                "sidebar-light": "#f8fafc",
                "sidebar-dark": "#0d1218",
                "accent": "#00ff9d"
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
