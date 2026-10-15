import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// The favorite sports live in localStorage: don't let one test's leak into the
// next.
afterEach(() => localStorage.clear());
