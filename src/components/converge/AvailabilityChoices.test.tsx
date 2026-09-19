// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { AvailabilityChoices } from "./AvailabilityChoices";
import type { DateAnswer } from "@/lib/availability";
afterEach(cleanup);
function Example() {
  const [answer, setAnswer] = useState<DateAnswer>();
  const [favorite, setFavorite] = useState(false);
  return <AvailabilityChoices date="2026-10-09" duration={3} answer={answer} favorite={favorite} onAnswer={(value) => { setAnswer(value); if (value !== "available") setFavorite(false); }} onFavorite={() => setFavorite(!favorite)} />;
}
it("offers direct answers, an independent favorite, and an explicit clear action", async () => {
  const user = userEvent.setup();
  render(<Example />);
  expect(screen.getByText("Unanswered")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Maybe:/ }));
  expect(screen.getByRole("button", { name: /^Maybe:/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: /^Favorite:/ }).hasAttribute("disabled")).toBe(true);
  await user.click(screen.getByRole("button", { name: /^Available:/ }));
  await user.click(screen.getByRole("button", { name: /^Favorite:/ }));
  expect(screen.getByRole("button", { name: /^Favorite:/ }).getAttribute("aria-pressed")).toBe("true");
  await user.click(screen.getByRole("button", { name: /^Cannot:/ }));
  expect(screen.getByRole("button", { name: /^Favorite:/ }).getAttribute("aria-pressed")).toBe("false");
  await user.click(screen.getByRole("button", { name: /^Clear answer:/ }));
  expect(screen.getByText("Unanswered")).toBeTruthy();
});
