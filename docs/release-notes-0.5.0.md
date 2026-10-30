# Iron Hands Forge 0.5.0

Forge is now a single-marine offline armour studio with Astartes-inspired modular customisation and ten Body Frame templates. Windows and Linux packages carry the prepared resource library and runtime.

- Armour navigation follows the game: Helm, Pauldrons, Breastplate, Wargear, Gauntlets and Greaves. Additional mod slots remain in Accessories.
- Chapter heraldry is fixed to the left pauldron. Company is fixed to the right and includes Avernii, Garrsak, Raukaan, Kaargul, Haarmek, Sorrgol, Borrgos, Morlaag, Vurgaan and Dorrvok. Both sides retain independent palettes.
- Native source decal carriers are reused on compatible mod shoulders. Shoulders without a valid source carrier explain their limitation in the selector.
- Terminator, Chaplain and Apothecary initialise their own source outfits. Changing class resets the outfit to that class's defaults.
- Source-bound geometry repairs, name-based duplicate filtering, and the Iron Hands armour/accessory library are included. Guardsman, Astropath and Comissar/Commissar choices are excluded.
- The folded servo-arm pose, left bionic arms, four walk/run preview modes, IHF1 exchange and selected-geometry GLB export are preserved.

Existing IHF1 identifiers remain readable. Older five-marine workspaces migrate to one active marine after a backup. Keep the complete extracted app folder together. No installed game, mod, Python or system Node.js is required.

Custom STL helmet conversions remain under separate visual review. Existing source-unavailable choices remain disabled with a reason. Cloth physics and full game foot IK are outside the preview's motion model. Every possible armour combination has not received an individual visual review.

Source validation: 200 passing Node tests, five environment-dependent skips, 35 passing Python tests; offline browser verification of ten templates, ten company decals, 840 excluded-name searches, save/IHF1/embedded-texture GLB and responsive layout. The Linux release workflow additionally gates the native launcher lifecycle and seven-class bionic/motion acceptance on Ubuntu.
