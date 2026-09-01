# ApplyPack DESIGN.md Handoff

The user will create a separate `DESIGN.md` after receiving this package.

## Required filename and location

Preferred location in the confirmed ApplyPack repository root:

```text
DESIGN.md
```

A copy may also remain in:

```text
C:\Users\mskir\Desktop\Apply_Pack\Chat docs\DESIGN.md
```

## Authority

`DESIGN.md` is the authority for:

- Brand presentation
- Color system
- Typography
- Spacing
- Responsive layout
- Component visual design
- Illustration style
- Homepage visual simulations
- Animation direction
- Logo usage
- Mobile and desktop appearance

It is not the authority for changing:

- Prices
- Turnaround commitments
- Customer rights or disclaimers
- Payment behavior
- Security controls
- Data-retention behavior
- Accessibility requirements
- Product scope
- Backend order state

## Agent requirement

Before changing public visual presentation, the agent must search for and read `DESIGN.md` completely.

If `DESIGN.md` is missing when the preflight begins, the agent must ask the user whether:

1. The design file will be supplied before frontend work begins, or
2. The backend should be implemented first while preserving the current site's existing design.

The agent must not stop all backend work merely because `DESIGN.md` is not ready.

## Accessibility boundary

When a visual instruction conflicts with WCAG 2.2 Level AA or makes a critical transaction unusable with a keyboard or assistive technology, the agent must preserve the design intent while implementing an accessible equivalent. Record the change and explain it in the final accessibility report.
