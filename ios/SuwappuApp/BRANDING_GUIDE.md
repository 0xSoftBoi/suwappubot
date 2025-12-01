# Suwappu Branding Guide - Japanese Pink Petals Theme

## Brand Identity

Suwappu embraces a Japanese aesthetic with cherry blossom (sakura) pink petals as the core visual identity. This creates a calming, elegant, and trustworthy brand experience for users managing their cross-chain swaps.

## Color Palette

### Primary Colors

- **Sakura Pink Light** (`#FFD9E6`)
  - RGB: (255, 217, 230)
  - Usage: Backgrounds, subtle accents

- **Sakura Pink Medium** (`#F2B3CC`)
  - RGB: (242, 179, 204)
  - Usage: Secondary buttons, hover states

- **Sakura Pink Deep** (`#E68CB3`)
  - RGB: (230, 140, 179)
  - Usage: Primary buttons, headings, active states

### Supporting Colors

- **Petal White** (`#FFFBFE`)
  - RGB: (255, 251, 254)
  - Usage: Card backgrounds, clean surfaces

- **Branch Brown** (`#664D40`)
  - RGB: (102, 77, 64)
  - Usage: Text on light backgrounds, subtle borders

- **Sky Blue** (`#B3D9F2`)
  - RGB: (179, 217, 242)
  - Usage: Accent elements, informational highlights

## Typography

- **App Title**: Rounded, Bold, 32pt
- **Section Headers**: Rounded, Semibold, 20pt
- **Body Text**: System Default, Regular, 16pt

## Iconography

### Petal Icons
- 🌸 Single cherry blossom (primary)
- 🌺 Multiple blossoms (decorative)
- 💮 Falling petals (animations)
- 🌿 Branch (accent)

### Usage Guidelines
- Use petal emojis sparingly for emphasis
- Primary petal (🌸) for main actions and headers
- Falling petals for animations and backgrounds
- Maintain consistent sizing (typically 16-24pt)

## Visual Elements

### Gradients

**Sakura Gradient** (Primary)
- Colors: Light → Medium → Deep Pink
- Direction: Top-left to bottom-right
- Usage: Buttons, logos, hero sections

**Petal Gradient** (Background)
- Colors: White → Light Pink
- Direction: Top to bottom
- Usage: Screen backgrounds, cards

### Shadows

- **Soft Shadow**: `sakuraPinkDark.opacity(0.3)`, radius: 8-10pt
- **Card Shadow**: `sakuraPink.opacity(0.1)`, radius: 8pt
- Usage: Elevation, depth, button presses

### Borders

- **Subtle Border**: `sakuraPink.opacity(0.3)`, width: 1pt
- Usage: Card outlines, input fields, dividers

## Component Styles

### Buttons

**Primary Button** (SakuraButton)
- Background: Sakura Gradient
- Text: White, Semibold
- Icon: Petal emoji (optional)
- Corner Radius: 12pt
- Shadow: Soft shadow
- Height: 48pt minimum

**Secondary Button** (SakuraSecondaryButton)
- Background: Petal White
- Text: Deep Pink, Medium weight
- Border: Subtle border
- Corner Radius: 12pt

### Cards

**Sakura Card** (SakuraCard)
- Background: Petal White
- Border: Subtle border
- Corner Radius: 16pt
- Shadow: Card shadow
- Padding: 16pt

### Backgrounds

**Animated Petal Background** (PetalBackgroundView)
- Base: Petal Gradient
- Animated Elements: Falling petals (15 instances)
- Opacity: 0.6 for petals
- Duration: 3-5 seconds per cycle

## Implementation

All branding elements are centralized in:
- `Utils/Branding.swift` - Colors, typography, theme
- `Views/Components/PetalBackgroundView.swift` - Animated backgrounds
- `Views/Components/SakuraButton.swift` - Branded buttons
- `Views/Components/SakuraCard.swift` - Branded cards

## Usage Examples

```swift
// Using brand colors
.foregroundColor(BrandColors.sakuraPinkDeep)
.background(BrandColors.sakuraGradient)

// Using branded components
SakuraButton(title: "Swap", icon: "🌸", action: {})
SakuraCard(title: "Portfolio", icon: "🌸") { ... }

// Using petal background
PetalBackgroundView()
```

## Accessibility

- Ensure sufficient contrast ratios (WCAG AA minimum)
- Deep pink on white: ✅ Passes
- White on gradient: ✅ Passes
- Provide alternative text for decorative petals
- Support Dynamic Type for all text

## Brand Voice

The sakura theme conveys:
- **Elegance**: Sophisticated, refined
- **Trust**: Calming, reliable
- **Innovation**: Modern, forward-thinking
- **Simplicity**: Clean, uncluttered

## Do's and Don'ts

### ✅ Do
- Use sakura pink as primary brand color
- Include subtle petal animations
- Maintain consistent spacing and sizing
- Use gradients for depth and interest
- Keep backgrounds light and airy

### ❌ Don't
- Overuse petal emojis (max 2-3 per screen)
- Use harsh, saturated pinks
- Create busy, cluttered layouts
- Mix with other strong color themes
- Forget accessibility considerations

## Future Enhancements

- Custom sakura petal SVG icons
- Seasonal variations (spring emphasis)
- Dark mode adaptation
- Custom font with Japanese influence
- Animated logo with falling petals


