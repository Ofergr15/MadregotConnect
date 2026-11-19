# App icon

`club-logo-512.png` is the club logo copied from the PWA (`public/images/icon-512.png`).
It is the best source the club has today; no original vector or high-resolution file exists.

The App Store icon is generated from it:

```bash
swift ios/scripts/make-app-icon.swift ios/Design/AppIcon/club-logo-512.png
```

Output: `Madregot/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png`
1024×1024, sRGB, **no alpha channel**, square corners (iOS applies its own mask).
Spec: https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon/

## Known limitation: upscaled source

The source is 512×512, so the icon is a **2× upscale** and will look softer than a native
1024 asset, most visibly on the curved lettering. A higher-quality logo (vector/SVG/PDF,
or a ≥1024px PNG) is tracked for later.

## Swapping in a better logo

1. Put the new file in this folder (any name).
2. Run the script with that path (optionally a background hex as the second argument,
   e.g. `FFFFFF`).
3. Check the result has no transparency: `sips -g hasAlpha <output>` must say `no`.

Nothing else references the source file, so replacing it needs no code change.
