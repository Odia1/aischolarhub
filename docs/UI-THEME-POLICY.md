# AI Scholar Hub UI Theme Policy

All AI Scholar Hub user interfaces must use the shared semantic theme system.

Use semantic tokens for ordinary UI:
- `bg-surface-primary`
- `bg-surface-secondary`
- `text-text-primary`
- `text-text-secondary`
- `border-border-light`

Any component that establishes a background must also establish a compatible
foreground rather than relying on accidental inheritance.

Inputs must explicitly define readable text, caret, placeholder, background,
border, hover and focus states.

Avoid new hard-coded core UI colors such as `text-black`, `text-white`,
`bg-black`, `bg-white`, or arbitrary hex foreground/background colors.

Brand accents and gradients are allowed when they are decorative and retain
accessible contrast in both light and dark themes.

This policy applies to the main AI Scholar Hub UI and administrative interfaces.
