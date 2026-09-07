import sharp from "sharp";
import { mkdir } from "node:fs/promises";

// Package the fal.ai artwork into the platform formats. The crop removes the
// generated scene outside the icon tile; the alpha follows the tile silhouette.
const size = 736;
const mask = Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" rx="210" fill="white"/></svg>');
const cropped = await sharp("assets/icon-source.png").extract({ left: 148, top: 136, width: size, height: size }).resize(1024, 1024).png().toBuffer();
const icon = await sharp(cropped).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
await sharp(icon).toFile("assets/icon.png");
await mkdir("assets/icon.iconset", { recursive: true });
const macIcon = await sharp(icon).resize(824, 824).extend({ top: 100, bottom: 100, left: 100, right: 100, background: '#0000' }).png().toBuffer();
for (const scale of [16, 32, 128, 256, 512]) {
  await sharp(macIcon).resize(scale, scale).png().toFile(`assets/icon.iconset/icon_${scale}x${scale}.png`);
  await sharp(macIcon).resize(scale * 2, scale * 2).png().toFile(`assets/icon.iconset/icon_${scale}x${scale}@2x.png`);
}
