---
name: apply-nudges
description: Apply a list of UI tweaks made in nudgix (a prompt that starts with /apply-nudges) to the project code. Handles token swaps, layout changes, moving and removing elements, and text edits. The adapter line says how the project writes styles (CSS variables, Tailwind and so on).
---

# apply-nudges

After `/apply-nudges` comes an `adapter:` line and then the changes checked in nudgix, one block per element. Apply them to the code.

## Steps

1. Read the `adapter:` line and follow the matching section under "Adapters"
2. For each block, find the code from its location line
3. Apply the change lines below it as described in "Change lines"
4. When done, list the files and places you changed

## Rules

- Write values with the project's tokens. Do not hard-code values
- A current value ending in `?` is a guess from the computed value. Check how the code actually writes it before changing it
- If the place to change is a shared component that also affects other pages, ask how far to go before changing it
- If a line is unclear or cannot be expressed with a token, ask instead of guessing

## Location line

The first line of each block. One of these shapes:

```
src/components/Card.tsx:33 (src/app/page.tsx:65) Card "News" <div>
src/style.css:12 "Pricing" <section>
/dashboard Card<Dashboard "News" <div> .card .card--wide
```

- File and line first: where the element is written. In parentheses, where that component is used. Then the component name, the start of the text and the tag
- For plain HTML and CSS, the file and line point at the CSS rule that styles the element
- Without a file: the page URL, the component chain (inner to outer, joined with `<`), the text, the tag, attributes and style hints (classes or selectors)

## Change lines

Indented under the location line.

### Token swaps

```
color --text-muted→--text-default
paddingBlock --space-2→--space-4
```

"property current→new". How the token is written depends on the adapter.

- `padding` is all four sides, `paddingBlock` top and bottom, `paddingInline` left and right
- The current value can be:
  - a token: known from the code (class or CSS rule)
  - `a|b?`: tokens with the same computed value. Check the code
  - `-`: no value (0)
  - `(12px)`: a value that matches no token
- A new value in parentheses such as `(13px)` was tried without a token. See if a close token fits. If none does, ask before hard-coding it

### Layout

```
flexDirection row→column
justifyContent normal→space-between
```

"CSS property current computed value→new value". Elements that are not flex also get a line like `display block→flex`. Write it the way the project writes styles.

### Moving elements

```
move after Card "Terms update"
move to first
move into CardContent "Next actions" after DateGroup "2026-01-27"
move into CardContent "Next actions" as first
```

Change the order in the markup (JSX, HTML). Do not use CSS `order`. If the parent and the destination are in different components, confirm how to restructure first.

### Visual offset

```
offset x+40 y+20px
```

The element was shifted only visually (40px right, 20px down). Do not reproduce it with `translate` or `position`. Get close with spacing, gap and layout tokens, and ask if no token fits.

### Removal

```
remove
```

Remove the element. Ask first if it is rendered conditionally or lives in a shared component.

### Text

```
text "Terms update"→"Our terms changed"
```

Change the text. If it comes from props, constants or API data, confirm where to change it.

## Adapters

### css-vars

Styles are plain CSS (or CSS Modules, styled-components and so on) with custom properties.

- Token names are CSS custom properties such as `--space-4`. Write them as `var(--space-4)`
- Change the CSS rule that styles the element. The location line points at it when nudgix could tell
- If the rule is shared by other elements and only this one should change, ask whether to add a modifier class
