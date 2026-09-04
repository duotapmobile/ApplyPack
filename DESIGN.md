# ApplyPack.work UI/UX Design Specification

## Scope

This file controls only the UI and UX of ApplyPack.work:

- Visual direction
- Page composition
- Section separation
- Grid and spacing
- Bento-card behavior
- Typography
- Color use
- Buttons and links
- Navigation
- Forms and uploads
- Responsive behavior
- Interaction states
- Accessibility
- Motion
- Component reuse
- Visual QA

This file does not control copy, pricing, package names, turnaround promises, policies, business rules, or legal language. Pull all final text and product facts from the separate approved copy and product sources. Do not invent missing content to fill a layout.

Reference image: `338bc0bb2b1eba4841b06acbe3de9cb8.webp`

The image is visual inspiration only. Do not copy its brand, people, words, illustrations, or exact composition.

## Design goal

Create a highly polished, modern service website that feels clear, human, trustworthy, and easy to navigate. The page should never feel like a generic template or a stack of identical SaaS cards.

The reference succeeds because it uses:

- Clearly defined sections
- A strong visual change between light and dark areas
- Large headlines with generous white space
- Several different methods of presenting information
- Asymmetrical bento layouts
- Large product visuals
- Rounded containers
- High-contrast buttons
- A strong final call-to-action panel
- Enough visual repetition to feel consistent without making every section identical

Apply these principles to ApplyPack using document, application, and workflow visuals.

## Non-negotiable experience rules

1. Each major section must be visually distinct from the sections around it.
2. The page must use varied composition, not repeated centered headings followed by three equal cards.
3. Bento layouts must organize information, not create decorative clutter.
4. Every primary action must be immediately recognizable.
5. Buttons that lead to another page must look interactive before hover.
6. The design must work at 320px without horizontal scrolling.
7. The mobile experience must be intentionally recomposed, not merely stacked.
8. All components must meet WCAG 2.2 AA.
9. No essential information may depend on motion, color, hover, or tiny text.
10. Use actual approved brand assets exactly as supplied.

## Visual personality

The interface should feel:

- Modern
- Warm
- Clear
- Capable
- Personal
- Calm
- Premium but not luxurious
- Professional without looking corporate

Avoid:

- Generic corporate blue as the dominant color
- Neon effects
- Loud gradients behind text
- Heavy glassmorphism
- Excessive shadows
- Tiny gray type
- Identical cards in every section
- Dense blocks of copy
- Stock-photo-heavy layouts
- AI sparkles, robot graphics, magic wands, or sci-fi styling
- Decorative resume designs that conflict with an ATS-safe service
- Purple borders running down the full sides of the site

## Color system

The Apply Pack logo palette is approved and controlling. Use these exact source colors. Semantic tokens may use white and neutral text colors where required for readability, but must not substitute a competing accent palette.

| Logo token | Value | Primary role |
| --- | --- | --- |
| `--logo-yellow` | `#fdc403` | Warm highlight and selected detail |
| `--logo-green` | `#03ab63` | Success and grounded accent |
| `--logo-violet` | `#5a57e9` | Primary action and selected state |
| `--logo-orange` | `#fd9d02` | Warm emphasis and caution |
| `--logo-navy` | `#021185` | Dark brand panel and high-contrast brand text |
| `--logo-blue` | `#069fec` | Information and connection accent |
| `--logo-cyan` | `#2dd7fb` | Light information accent |
| `--logo-bright-green` | `#02d051` | Positive state and secondary green accent |

Semantic mapping:

| Token | Value | Role |
| --- | --- | --- |
| `--canvas` | `#f6f9ff` | Main background |
| `--surface` | `#ffffff` | Cards and raised surfaces |
| `--ink` | `#030b20` | Primary text |
| `--muted` | `#536277` | Supporting text |
| `--border` | `#bdcde0` | Borders and separators |
| `--deep` | `#021185` | Dark brand sections |
| `--primary` | `#5a57e9` | Primary actions and selected states |
| `--focus` | `#021185` | Keyboard focus ring on light surfaces |
| `--error` | `#b42318` | Error state |
| `--success` | `#03ab63` | Success state |

Color rules:

- Use dark text on light logo-color tints.
- Reserve violet and navy for high-value actions and selected states. Use blue as an accent unless paired with navy text.
- Use yellow and orange as emphasis colors, not paragraph backgrounds. Use yellow for focus on navy surfaces.
- Use no more than three accent colors inside one section.
- Do not assign random colors to equivalent components.
- Do not use color as the only signal.
- Use a solid backing behind text when a gradient is present.
- All foreground and background combinations must pass WCAG 2.2 AA contrast testing.
## Gradient direction

Use gradients sparingly.

Hero:

- Mostly white or off-white
- A soft pale-gold glow near one corner
- A low-opacity lavender wash near the visual
- Optional faint mint transition
- No hard rainbow band
- No neon glow

Dark feature panel:

- Solid `--deep` base
- Very subtle purple and gold corner bloom
- Text always sits over the solid dark area

Final CTA:

- Dark base
- One restrained blurred color area
- No animated gradient

## Typography

The approved site-wide type system is:

- Headings: Source Serif Pro
- Body, navigation, buttons, labels, and controls: Lato
- Heading fallback: `Georgia, serif`
- Body fallback: `Arial, ui-sans-serif, system-ui, sans-serif`
- Monospace is permitted only for code, machine-readable records, and diagnostic data.

| Style | Desktop size | Mobile size |
| --- | --- | --- |
| Homepage H1 | `4rem` to `4.5rem` | `2.5rem` to `2.875rem` |
| Interior H1 | `3.25rem` to `4rem` | `2.25rem` to `2.75rem` |
| Homepage H2 | `2.625rem` to `3.25rem` | `1.875rem` to `2.25rem` |
| Subsection heading | `1.5rem` to `2.25rem` | `1.375rem` to `1.75rem` |
| Body | `1.0625rem` to `1.1875rem` | `1rem` to `1.125rem` |
| Supporting text | `0.9375rem` minimum | `0.9375rem` minimum |
| Button | `1rem`, bold | `1rem`, bold |

Rules:

- Body text never drops below 16px.
- Limit normal text lines to approximately 60 to 72 characters.
- Keep hero and major section headings compact.
- Use tight heading line height, approximately 0.98 to 1.1.
- Use comfortable body line height, approximately 1.5 to 1.7.
- Do not center paragraphs longer than three short lines.
- Do not reduce font size to force content into a card.
- Do not use decorative alternates, swashes, or ligatures that make individual letters look distorted.
- Use balanced wrapping for headings and readable wrapping for body copy.
## Grid and spacing

### Page frame

- Maximum content width: 1240px
- Desktop side padding: 40px
- Tablet side padding: 28px
- Mobile side padding: 18px
- Desktop section spacing: 72px to 96px
- Tablet section spacing: 64px to 80px
- Mobile section spacing: 48px to 64px

### Grid

- Desktop: 12 columns, 24px gap
- Tablet: 8 columns, 20px gap
- Mobile: 4 columns, 16px gap

### Shape

- Standard card radius: 24px
- Large panel radius: 32px
- Small control radius: 14px
- Use one consistent pill-button treatment only if it matches the approved brand
- Standard border: 1px solid `--border`

### Shadow

Use subtle shadows only where they communicate elevation.

Recommended:

```css
box-shadow: 0 18px 48px rgba(23, 19, 31, 0.08);
```

Do not apply the same shadow to every card. Pastel cards may remain flat.

## Page composition

The homepage contains exactly seven primary content sections, excluding the global header and footer. The required order is:

1. The offer
2. What a real match means
3. How experience connects to new roles
4. What Apply Pack takes off the customer''s plate
5. How it works and before-and-after proof
6. Pricing and customer control
7. Founder story, trust, FAQ, and final action

The numbered visual patterns below are a reusable component inventory. They do not authorize additional homepage sections. Combine them inside the seven required sections, and remove a pattern when it does not advance the section''s purpose.

### 1. Header

- Light background
- Logo left
- Short primary navigation right
- One high-contrast action at the far right
- Optional secondary account or status link only if the product supports it
- Becomes sticky after scrolling
- Sticky state uses a solid background, subtle bottom border, and slight blur only if contrast remains strong

Mobile:

- Logo left
- Menu control right
- Full-height or large-sheet navigation
- Primary action remains visible inside the menu
- Correct focus trap and focus return

### 2. Hero

Use a two-column desktop composition:

- Left: copy area and two actions
- Right: application-package visual

The visual should combine two or three approved artifact types, such as:

- Resume page
- Cover-letter page
- Job-posting card
- Checklist
- Delivery folder or package view

The visual may use slight overlap and rotation, but document edges and hierarchy must remain clear. Keep the tilt under 6 degrees. Use soft shadows and pastel backing shapes. Avoid unreadable miniature document text.

The primary action must be visually dominant. The secondary action must use a border or lower-emphasis treatment.

### 3. Narrow trust or orientation strip

Use one full-width horizontal band containing three or four compact items. This section should be visually lighter than the hero and should not become another card grid.

Options:

- Simple text with vertical separators
- Small icons and short labels
- A slow static word band

Do not use an auto-scrolling marquee for essential information.

### 4. Asymmetrical bento section

Use a 12-column grid with deliberate size variation:

- One 7-column lead card
- One 5-column supporting card
- Two 4-column compact cards
- One 8-column wide card

Do not force this exact arrangement if the approved content count differs. Maintain asymmetry and clear priority.

Each bento card may contain:

- One eyebrow
- One heading
- One short text block
- One visual or compact list
- One optional link

Never place full paragraphs, multiple CTAs, and a detailed illustration in the same card.

### 5. Large dark showcase panel

This is the strongest visual translation from the reference.

- Full content width
- Dark rounded container
- Generous internal spacing
- Three distinct rows or zones
- Alternate text and visual positions on desktop
- Use light document previews against the dark surface
- Keep each zone visually connected, not boxed into separate floating cards
- Use subtle accent colors to distinguish zones

On mobile, each zone becomes:

1. Heading and supporting text
2. Visual preview
3. Optional descriptive link

Do not alternate the mobile reading order.

### 6. Process or journey section

Use a visual sequence rather than another bento grid.

Recommended pattern:

- Large numbered circles or markers
- Short connector line on desktop
- Vertical sequence on mobile
- One icon or miniature visual per step
- Clear action below the full sequence

Do not use a horizontally scrollable process on mobile.

### 7. Split visual section

Use one side for a large approved artifact preview and the other for a concise explanation or checklist.

Possible arrangements:

- Document preview left, content right
- Content left, annotated comparison right
- Stacked before-and-after frames with one explanation panel

Use a strong visual change from the previous section. If the process section is light and open, this section may use a pale tinted background or bordered surface.

### 8. Decision section

Present selection or comparison information with immediate visual clarity.

- Use one wide option card when there is one core choice.
- Use a comparison grid only when multiple real choices exist.
- Do not create fake tiers for symmetry.
- Keep the main selection control visible without hover.
- Use clear selected, hover, focus, disabled, and loading states.
- Avoid tiny comparison tables on mobile.

### 9. Trust or testimonial section

Use verified assets only. The design may support:

- One large quote with one or two small supporting cards
- A founder note paired with a visual
- Three testimonial cards with varied heights

Do not include placeholder portraits or quotes in production.

### 10. FAQ preview

- Use accessible accordion rows
- Generous 20px to 24px vertical padding
- Clear dividers
- Plus or chevron indicator
- Entire row is clickable
- Expanded content remains left aligned
- A visible route to the full FAQ page appears below

### 11. Final CTA panel

- Large dark rounded panel
- One headline area
- One short supporting area
- One dominant button
- One low-emphasis secondary link at most
- Spacious and visually simple

This should resemble the strong closing block in the reference without copying its exact gradient or text placement.

### 12. Footer

- Light background after the dark CTA panel
- Logo and short brand area
- Grouped navigation links
- Legal links
- Contact method
- Comfortable padding
- No oversized footer sitemap

## Bento system

### Card variants

Build reusable variants instead of unique one-off cards:

1. `feature`, large card with visual
2. `compact`, short supporting fact
3. `document`, artifact preview
4. `process`, number or icon plus explanation
5. `quote`, verified testimonial or founder note
6. `action`, one message and one route
7. `dark`, high-contrast feature

### Bento behavior

- A card's size must reflect its importance.
- Keep padding between 28px and 40px on desktop.
- Use 20px to 24px padding on mobile.
- Align text to the top unless the card is intentionally a centered action card.
- One card may break the grid edge visually, but its actual box must stay inside the page container.
- Do not nest bento cards.
- Do not use more than six bento cards in one section.
- Keep at least one quiet, non-card section between two dense card groups.

## Buttons and page links

Buttons must be easy to spot and must clearly lead somewhere.

### Primary action

- Filled `--ink` or `--primary`
- White text
- Minimum height: 48px desktop, 52px mobile
- Horizontal padding: 24px to 30px
- Semibold label
- Optional arrow icon after the label
- High-contrast hover and active states
- Visible focus ring

### Secondary action

- White or transparent background
- 2px dark border
- Dark text
- Same height and visual weight as other controls
- Must remain visible on pastel and white backgrounds

### Text link

- Descriptive label
- Visible underline by default within body content
- Arrow may reinforce direction but cannot be the only clickable element
- Do not use vague labels when the copy source supplies a specific destination

### Routing behavior

- Navigation actions use real anchor elements.
- Form and state actions use real button elements.
- Never use clickable `div` elements.
- Never use empty links or `javascript:void(0)`.
- Buttons intended to link to another page must use a valid route from the application.
- Do not route every homepage action to a section anchor.
- The full control is clickable, not only its arrow.
- External destinations require a visible external-link cue when the context could surprise the user.

### Action density

- Maximum two adjacent actions in a normal section.
- Only one may be primary.
- Do not add a button to every card.
- Repeat the main action at logical decision points, not after every paragraph.

## Forms and upload UX

The intake and upload experience must be visually consistent with the marketing site but simpler and more focused.

### Form layout

- Single main column
- Maximum form width: 720px
- Optional summary rail on desktop only
- Persistent progress indicator for multi-step flows
- One primary action at the bottom of each step
- Back action visually secondary
- No hidden required fields

### Fields

- Visible persistent labels
- Instructions above the field
- Supporting text below the label or field
- Minimum field height: 48px
- Strong focus state
- Error state includes icon, text, and border treatment
- Preserve entered values after validation errors
- Do not use placeholders as labels

### File upload

Provide both:

- A visible file-selection control
- Drag-and-drop enhancement

Display:

- Accepted type
- Size limit
- Filename
- File size
- Upload state
- Success state
- Remove or replace action
- Specific error message

Keyboard and screen-reader users must have the same functionality as pointer users.

### Progress

Use a compact step indicator:

- Current step has text and a strong marker
- Completed steps use a check and remain distinguishable without color
- Future steps remain readable
- Mobile may show current step and total rather than every long label

### Review and completion states

Design all states:

- Empty
- In progress
- Uploading
- Saving
- Validation error
- Network error
- Payment processing
- Payment failure
- Success
- Duplicate submission prevention

Never rely on a spinner alone. Pair it with status text.

## Navigation UX

- The current page must be identifiable.
- Keyboard focus order follows visual order.
- Sticky navigation must not cover anchored content.
- Add a skip-to-main-content link.
- Mobile menu closes with Escape, close control, or route selection.
- Mobile menu restores focus to the trigger.
- Do not hide the primary action inside a submenu.
- Logo links to the homepage.

## Current layout measurements

Desktop:

- Maximum content width: 1180px to 1240px
- Header height: 72px to 80px
- Standard section padding: 72px to 96px
- Compact section padding: 48px to 64px
- Grid gap: 24px to 32px
- Card padding: 28px to 36px
- Homepage height target at 1440 by 900: no more than approximately 7500px
- Remove decorative minimum heights and align short two-column content to the top.

Mobile:

- Test at 360 by 800, 390 by 844, 430 by 932, and 768 by 1024.
- Horizontal page padding: 18px to 20px
- Header height: 64px to 72px
- Section padding: 48px to 64px
- Card gap: 16px to 20px
- Card padding: 20px to 24px
- Minimum touch target: 44px by 44px
- Form-control font size: at least 16px
- Put the offer, price, timing, and primary action before artwork.
- Treat mobile as a separate composition, not a narrower desktop canvas.

## Required educational interactions

The public site uses interaction only when it explains the service more clearly than static copy:

1. Why this job made the list
2. Experience connector
3. Original, tailored, and why
4. FAQ accordion

All tabs and accordions must use semantic controls, visible selected states, keyboard support, screen-reader relationships, and content that remains available in the page markup. No carousel, hover-only disclosure, drag-only control, looping animation, or scroll-jacking is allowed.

## Intake presentation

The intake is a focused task flow. Use a compact header with the logo, Help, and My ApplyPack. Do not show the full marketing navigation, marketing footer, or a large marketing sidebar. Show the current step, heading, and first control in the initial mobile viewport. New customers may begin intake without email authentication before checkout.
## Responsive rules

Test at:

- 320px
- 390px
- 768px
- 1024px
- 1280px
- 1440px

### Mobile

- Collapse all major grids to one column.
- Hero text comes before the visual.
- Preserve at least 18px side padding.
- Allow primary actions to become full width.
- Keep paired buttons stacked when each would become narrower than 160px.
- Reorder alternating desktop rows into text-first sequences.
- Remove decorative orbit lines, floating avatars, or detached chips if they create clutter.
- Document mockups may overlap less than on desktop.
- Avoid fixed-height cards.
- No horizontal card carousels for essential content.
- Sticky bottom actions must not cover form controls or browser UI.

### Tablet

- Use two columns where each item retains comfortable width.
- Do not squeeze three dense cards into one row.
- Reduce decorative overlap.
- Keep button labels on one line.

### Desktop

- Use asymmetry and white space intentionally.
- Keep all core content inside the 1240px container.
- Do not stretch content edge to edge.
- Keep text blocks narrower than their containing card when needed.

## Accessibility

Meet WCAG 2.2 AA.

Required:

- Semantic landmarks
- One `h1` per page
- Logical heading order
- Skip link
- Keyboard access to all controls
- Visible `:focus-visible` ring at least 2px thick
- Touch targets at least 44px by 44px
- Text contrast at least 4.5:1
- Large-text contrast at least 3:1
- Component and focus contrast at least 3:1
- Meaningful alt text for informative images
- Empty alt text for decorative images
- No important text inside images
- Correct accordion expanded state
- Correct form labels and descriptions
- Error summary with focus movement after invalid submission
- Status announcements for upload, save, and payment states
- Reduced-motion support
- No horizontal overflow at 320px
- Zoom support to at least 200 percent
- Content remains usable with increased text spacing

Accessibility must be built into the components, not patched onto completed pages.

## Motion

Use motion only to reinforce interaction.

Allowed:

- 160ms to 240ms hover transitions
- Small card lift when the full card is interactive
- Accordion icon rotation
- Gentle section reveal
- Progress-state changes

Not allowed:

- Continuous floating
- Scroll hijacking
- Cursor followers
- Large parallax
- Auto-rotating carousels
- Essential content in an auto-scrolling ticker
- Rapid gradients
- Motion required to understand state

Respect `prefers-reduced-motion: reduce` by removing movement rather than merely slowing it.

## Image and illustration direction

Prefer:

- Anonymized document previews
- Job-posting fragments
- Checklists
- Application-package mockups
- Interface previews
- Simple custom line illustrations
- Real approved brand elements

Avoid:

- Generic office-worker stock photos
- Fake customer headshots
- Unlicensed employer logos
- Colorful infographic resumes
- Decorative illustrations unrelated to the service
- Screenshots containing unreadable walls of text

Use people only when the approved visual strategy calls for them. If used, crop and color-block them in a way inspired by the reference, but do not recreate the same four-person hero.

## Component inventory

Build reusable components for:

- Header
- Mobile menu
- Primary button
- Secondary button
- Text link
- Hero visual
- Document preview
- Trust strip
- Bento grid
- Bento card variants
- Dark showcase panel
- Process step
- Comparison or selection card
- Testimonial or founder-note card
- FAQ accordion
- Final CTA panel
- Footer
- Form field
- Select control
- Checkbox and radio group
- File uploader
- Error summary
- Inline alert
- Progress indicator
- Loading state
- Empty state
- Success state
- Confirmation panel

All components must use shared tokens. Do not hardcode slightly different spacing, colors, radii, or shadows in individual sections.

## CSS token baseline

```css
:root {
  --canvas: #fbfafc;
  --surface: #ffffff;
  --ink: #17131f;
  --muted: #5d5868;
  --border: #dcd8e3;
  --deep: #12102e;
  --primary: #5637d7;
  --lavender: #ddd4ff;
  --mint: #c8f1df;
  --sky: #cdebfa;
  --gold: #f6d36f;
  --rose: #f3d5e5;
  --focus: #ffb000;
  --error: #b42318;
  --success: #176b4d;

  --font-heading: "Source Serif Pro", Georgia, serif;
  --font-body: "Lato", Arial, ui-sans-serif, system-ui, sans-serif;

  --radius-control: 14px;
  --radius-card: 24px;
  --radius-panel: 32px;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4rem;
  --space-9: 6rem;
  --space-10: 8rem;

  --content-max: 77.5rem;
  --text-max: 44rem;
  --transition-fast: 160ms ease;
  --transition-standard: 220ms ease;
}
```

## Performance-related UI rules

- Set explicit dimensions or aspect ratios for all images.
- Use responsive image sources.
- Lazy-load below-the-fold imagery.
- Do not lazy-load the primary hero image when it affects largest contentful paint.
- Avoid large animation libraries for basic effects.
- Limit font weights.
- Use `font-display: swap`.
- Prevent layout shift during loading.
- Use skeletons only when the wait is meaningful. Do not flash skeletons for instant local content.

## Visual QA checklist

The UI/UX is complete only when:

- Major sections are visually unmistakable.
- The page uses at least three distinct layout patterns.
- Bento cards vary in size and have a clear hierarchy.
- No two dense card grids appear directly beside each other.
- The dark showcase panel feels like a purposeful centerpiece.
- The hero action is obvious without scrolling.
- Buttons linking to other pages are visible, descriptive, and functional.
- Interactive controls have hover, active, focus, loading, disabled, error, and success states where relevant.
- Document previews reinforce a clean professional service.
- No visual placeholder can be mistaken for real content.
- The mobile design is recomposed rather than merely stacked.
- Nothing overflows at 320px.
- All text remains readable at 200 percent zoom.
- Keyboard navigation follows a logical order.
- Focus is never hidden.
- Contrast meets WCAG 2.2 AA.
- Reduced motion works.
- Empty, loading, error, and success states are designed.
- The final page feels inspired by the reference's structure and variety, but unmistakably belongs to ApplyPack.

## Codex implementation instruction

Before editing UI code, inspect the full repository, existing components, approved brand assets, existing routes, and the separate controlling copy source. Use this file only for UI and UX decisions. Do not rewrite or invent content.

Implement the design as reusable components and tokens. Connect every visible page-link action to a real route. Verify all defined viewport widths, keyboard behavior, focus management, contrast, motion preferences, form states, and loading or error states before considering the interface complete.
