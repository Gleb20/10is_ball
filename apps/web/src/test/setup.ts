import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are disabled in this project, so Testing Library cannot
// auto-register cleanup reliably. Keep every component test isolated.
afterEach(() => cleanup());
