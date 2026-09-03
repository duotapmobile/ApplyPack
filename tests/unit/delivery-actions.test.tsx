import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryActions } from "@/components/portal/delivery-actions";

const props = {
  itemId: "11111111-1111-4111-8111-111111111111",
  deliveredAt: "2026-09-03T12:00:00.000Z",
  jobLabel: "Example Employer Operations Assistant",
};

  afterEach(cleanup);
describe("customer delivery download controls", () => {
  it("renders editable Word and PDF choices for each reviewed document", () => {
    render(<DeliveryActions {...props} pdfAvailable />);

    expect(screen.getByRole("link", { name: /editable Word resume/i })).toHaveAttribute(
      "href",
      "/api/customer/deliveries/11111111-1111-4111-8111-111111111111?kind=resume&format=docx",
    );
    expect(screen.getByRole("link", { name: /PDF resume/i })).toHaveAttribute(
      "href",
      "/api/customer/deliveries/11111111-1111-4111-8111-111111111111?kind=resume&format=pdf",
    );
    expect(screen.getByRole("link", { name: /editable Word cover letter/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PDF cover letter/i })).toBeInTheDocument();
    expect(screen.getByText(/Open with Google Docs/)).toBeInTheDocument();
    expect(screen.getByText(/Use the PDF for viewing, printing, or sending/)).toBeInTheDocument();
  });

  it("keeps historical Word downloads without showing broken PDF controls", () => {
    render(<DeliveryActions {...props} pdfAvailable={false} />);

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /PDF resume/i })).not.toBeInTheDocument();
    expect(screen.getByText(/earlier delivery includes editable Word files only/i)).toBeInTheDocument();
  });
});
