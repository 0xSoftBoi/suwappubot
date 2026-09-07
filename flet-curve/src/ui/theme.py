"""Three themes: light, dark, and Chad."""

from __future__ import annotations

import flet as ft

#: The seed the Material themes are generated from.
SEED = ft.Colors.INDIGO

# -- Chad's palette: Tango, as linux.org.ru uses it ------------------------

PAGE = "#D3D7CF"       # Aluminium 2  --main-background
PANEL = "#EEEEEC"      # Aluminium 1  --article-background
INK = "#3B4245"        #              --text-color
HEADING = "#232829"    #              --header-color
TITLE = "#171B1C"      #              --table-link-color
QUIET = "#555753"      # Aluminium 5  --blockquote-color
RULE = "#BABDB6"       # Aluminium 3  --table-border-color
BORDER = "#888A85"     # Aluminium 4  (tango leaves this one undefined)
HOVER = "#AD7FA8"      # Plum 1       --table-hover-background
ACTIVE = "#C17D11"     # Chocolate 2  --icon-button-active-color
LABEL = "#E9B96E"      # Chocolate 1  --tagpage-group-label-background
BROWN = "#8F5902"      # Chocolate 3  --main-menu-color
ORANGE = "#CE5C00"     # Orange 3     --tag-color
LINK = "#204A87"       # Sky Blue 3   --link-color
SKY = "#729FCF"        # Sky Blue 1   --button-primary-background
GREEN = "#4E9A06"      # Chameleon 3  --signature-user-color
DANGER = "#CC0000"     # Scarlet 2    --button-danger-background

#: Half a step above `PANEL`, for the one surface Material calls raised --
#: which here is a button's face.
RAISED = "#F3F3F1"

#: A hard shadow: no blur, no spread, one constant opacity.
PANEL_SHADOW = ft.BoxShadow(
    spread_radius=0,
    blur_radius=0,
    offset=ft.Offset(3, 3),
    color=ft.Colors.with_opacity(0.20, TITLE),
)

#: The same, smaller, for things that sit inside a panel.
INSET_SHADOW = ft.BoxShadow(
    spread_radius=0,
    blur_radius=0,
    offset=ft.Offset(2, 2),
    color=ft.Colors.with_opacity(0.16, TITLE),
)

#: A sheet of paper lying on the page, for the one thing here that is a
#: *picture* rather than a panel of controls: the route diagram.  Soft and
#: blurred where Chad's is hard and offset, because outside Chad the app is
#: Material and a hard shadow would be the only one in it.
PAPER_SHADOW = ft.BoxShadow(
    spread_radius=0,
    blur_radius=14,
    offset=ft.Offset(0, 3),
    color=ft.Colors.with_opacity(0.16, "#000000"),
)

#: For the top bar, which spans the window: straight down, with no sideways
#: offset.
BAR_SHADOW = ft.BoxShadow(
    spread_radius=0,
    blur_radius=0,
    offset=ft.Offset(0, 3),
    color=ft.Colors.with_opacity(0.20, TITLE),
)

#: The page's scrollbar, which is the only one there is: the window scrolls,
#: not the widgets (see `CurveApp.body`).
SCROLLBAR = ft.ScrollbarTheme(thumb_visibility=True, interactive=True, thickness=8)

#: Theme names as the app stores them, in the order the button cycles.
NAMES = ("light", "dark", "chad")


def material() -> ft.Theme:
    """Light or dark, generated from the seed as before."""
    return ft.Theme(color_scheme_seed=SEED, scrollbar_theme=SCROLLBAR)


def chad() -> ft.Theme:
    """The Tango theme, spelled out slot by slot."""
    return ft.Theme(
        scrollbar_theme=SCROLLBAR,
        color_scheme=ft.ColorScheme(
            primary=ACTIVE,
            on_primary=PANEL,
            primary_container=LABEL,
            on_primary_container=BROWN,
            secondary=BROWN,
            on_secondary=PANEL,
            secondary_container=LABEL,
            on_secondary_container=TITLE,
            tertiary=LINK,
            on_tertiary=PANEL,
            tertiary_container=SKY,
            on_tertiary_container=TITLE,
            error=DANGER,
            on_error=PANEL,
            error_container="#EFC7C2",
            on_error_container=DANGER,
            surface=PANEL,
            on_surface=INK,
            on_surface_variant=QUIET,
            surface_bright="#F6F6F4",
            surface_dim=PAGE,
            surface_container_lowest="#FFFFFF",
            surface_container_low=RAISED,
            surface_container=PAGE,
            surface_container_high="#C9CDC6",
            surface_container_highest=RULE,
            surface_tint=LABEL,
            outline=BORDER,
            outline_variant=RULE,
            shadow=TITLE,
            scrim=TITLE,
            inverse_surface=INK,
            on_inverse_surface=PANEL,
            inverse_primary=LABEL,
        ),
    )


def theme_for(name: str) -> tuple[ft.Theme, ft.ThemeMode]:
    """The theme and the mode that goes with it."""
    if name == "chad":
        return chad(), ft.ThemeMode.LIGHT
    if name == "dark":
        return material(), ft.ThemeMode.DARK
    return material(), ft.ThemeMode.LIGHT


def is_chad(page: ft.Page) -> bool:
    """Is the Chad theme the one on screen?"""
    scheme = getattr(getattr(page, "theme", None), "color_scheme", None)
    return bool(scheme and scheme.primary == ACTIVE)


#: The two annotations under an estimate, as flat fills for Chad.
NOTE_IMPACT_CHAD = "#F6E7A6"
NOTE_FEE_CHAD = "#D3E1F2"

#: The same two, as hues to tint a Material surface with.
NOTE_HUES = {
    "impact": ("#F9A825", "#FFC107"),   # (light theme, dark theme)
    "fee": ("#0288D1", "#4FC3F7"),
}
NOTE_ALPHA_LIGHT = 0.14
NOTE_ALPHA_DARK = 0.22


def is_dark(page: ft.Page) -> bool:
    """Is a dark palette on screen?"""
    mode = getattr(page, "theme_mode", None)
    if mode == ft.ThemeMode.DARK:
        return True
    if mode == ft.ThemeMode.LIGHT:
        return False
    return getattr(page, "platform_brightness", None) == ft.Brightness.DARK


def note_tint(page: ft.Page, kind: str) -> str | None:
    """The background for one of the annotation bands, in this theme."""
    hues = NOTE_HUES.get(kind)
    if hues is None:
        return None
    if is_chad(page):
        return NOTE_IMPACT_CHAD if kind == "impact" else NOTE_FEE_CHAD
    dark = is_dark(page)
    return ft.Colors.with_opacity(
        NOTE_ALPHA_DARK if dark else NOTE_ALPHA_LIGHT, hues[1 if dark else 0]
    )


def panel_shadow(page: ft.Page, *, inset: bool = False) -> ft.BoxShadow | None:
    """The hard shadow, under Chad only. None elsewhere."""
    if not is_chad(page):
        return None
    return INSET_SHADOW if inset else PANEL_SHADOW


def paper_shadow(page: ft.Page) -> ft.BoxShadow:
    """What lifts a sheet off the page, in whichever theme is drawn.

    Unlike `panel_shadow` this is never `None`: a diagram reads as a picture
    *on* something, and without a shadow it is a rectangle of background with
    a line round it -- which is what the route frame looked like in the two
    Material themes, where `panel_shadow` correctly returns nothing.
    """
    return PANEL_SHADOW if is_chad(page) else PAPER_SHADOW


def paper_bg(page: ft.Page) -> str:
    """The sheet's own colour: the lightest surface in a light theme and the
    deepest in a dark one, so it separates from the page either way."""
    return PANEL if is_chad(page) else ft.Colors.SURFACE_CONTAINER_LOWEST


def bar_shadow(page: ft.Page) -> ft.BoxShadow | None:
    """The top bar's shadow: straight down. None outside Chad."""
    return BAR_SHADOW if is_chad(page) else None


def border_side(page: ft.Page) -> ft.BorderSide | None:
    """A hairline outline, under Chad only."""
    return ft.BorderSide(1, ft.Colors.OUTLINE_VARIANT) if is_chad(page) else None


def field_border() -> ft.BorderSide:
    """What a Material text field draws its outline with.

    Not a scheme colour, which is why this is a function and not a token:
    Flutter's `OutlineInputBorder` defaults to `const BorderSide()`, which is
    opaque black, and nothing here overrides it.  So a control that wants to
    sit beside an input -- the Swap tab's coin picker is a `SearchBar`, which
    styles itself as a search bar otherwise -- has to use the same constant
    rather than a token that merely resembles it in one of the themes.
    Measured at the pool page's amount box: (0, 0, 0) in light and in dark,
    where `Colors.ON_SURFACE` comes out white and reads as a focus ring.

    If the app ever gives its inputs a decoration theme, this moves with it.

    Written as hex, not as `Colors.BLACK`: the named colour resolves to
    nothing on a `SearchBar`'s `bar_border_side` and the frame simply is not
    drawn -- `#000000`, `with_opacity(1, BLACK)` and every scheme token all
    draw, and only the name does not.
    """
    return ft.BorderSide(1, "#000000")


def panel_border(page: ft.Page) -> ft.Border | None:
    """The same outline, on all four sides. None outside Chad."""
    side = border_side(page)
    return ft.Border.all(side.width, side.color) if side else None


def rows_theme(page: ft.Page) -> ft.Theme | None:
    """A theme for the rows alone, colouring the hover plum."""
    return ft.Theme(hover_color=HOVER) if is_chad(page) else None


def header_bg(page: ft.Page) -> str | None:
    """The strip behind a table's column headings."""
    return RULE if is_chad(page) else None
