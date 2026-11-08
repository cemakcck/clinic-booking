import "@testing-library/jest-dom/vitest";

// Clinic times are Europe/Istanbul; running tests in another zone makes TZ bugs fail loudly.
process.env.TZ = "America/New_York";
// resetDemo seeds the demo staff accounts with this password.
process.env.DEMO_PASSWORD ??= "demo-password";
