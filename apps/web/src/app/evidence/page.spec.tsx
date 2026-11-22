import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import EvidenceRedirectPage from "./page";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: jest.fn(),
  }),
}));

describe("EvidenceRedirectPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("redirects cleanly to /verify and displays redirection message", () => {
    render(<EvidenceRedirectPage />);

    expect(mockReplace).toHaveBeenCalledWith("/verify");
    expect(
      screen.getByText(/Redirecting to Verification Workspace.../i),
    ).toBeInTheDocument();
  });
});
