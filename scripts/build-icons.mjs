import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

// Package the fal.ai artwork into the platform formats. The crop removes the
// generated scene outside the icon tile; the alpha follows the tile silhouette.
const size = 736;
const mask = Buffer.from('<svg width="1024" height="1024"><rect width="1024" height="1024" rx="210" fill="white"/></svg>');
const cropped = await sharp("assets/icon-source.png").extract({ left: 148, top: 136, width: size, height: size }).resize(1024, 1024).png().toBuffer();
const icon = await sharp(cropped).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
await sharp(icon).toFile("assets/icon.png");
const windowsSizes = [16, 24, 32, 48, 64, 128, 256];
const windowsImages = await Promise.all(windowsSizes.map((size) => sharp(icon).resize(size, size).png().toBuffer()));
const directory = Buffer.alloc(6 + windowsSizes.length * 16);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(windowsSizes.length, 4);
let offset = directory.length;
windowsSizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  directory[entry] = size === 256 ? 0 : size; directory[entry + 1] = directory[entry];
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(windowsImages[index].length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
  offset += windowsImages[index].length;
});
await writeFile("assets/icon.ico", Buffer.concat([directory, ...windowsImages]));
await mkdir("assets/icon.iconset", { recursive: true });
const macIcon = await sharp(icon).resize(824, 824).extend({ top: 100, bottom: 100, left: 100, right: 100, background: '#0000' }).png().toBuffer();
for (const scale of [16, 32, 128, 256, 512]) {
  await sharp(macIcon).resize(scale, scale).png().toFile(`assets/icon.iconset/icon_${scale}x${scale}.png`);
  await sharp(macIcon).resize(scale * 2, scale * 2).png().toFile(`assets/icon.iconset/icon_${scale}x${scale}@2x.png`);
}
