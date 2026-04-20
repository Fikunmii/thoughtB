/**
 * generate-icons.js
 * ─────────────────
 * Generates all PWA icon sizes from a single source SVG.
 * Run once after you have your icon design.
 *
 * Usage:
 *   node generate-icons.js
 *
 * Requires:
 *   npm install sharp   (run this first — sharp is not in package.json by default)
 *
 * Input:
 *   frontend/public/icons/icon-source.svg  (your master icon — make this first)
 *
 * Output:
 *   frontend/public/icons/icon-72.png
 *   frontend/public/icons/icon-96.png
 *   frontend/public/icons/icon-128.png
 *   frontend/public/icons/icon-144.png
 *   frontend/public/icons/icon-152.png
 *   frontend/public/icons/icon-192.png
 *   frontend/public/icons/icon-384.png
 *   frontend/public/icons/icon-512.png
 */

const sharp = require("sharp");
const path  = require("path");
const fs    = require("fs");

const SOURCE = path.join(__dirname, "public/icons/icon-source.svg");
const OUTPUT = path.join(__dirname, "public/icons");
const SIZES  = [72, 96, 128, 144, 152, 192, 384, 512];

if (!fs.existsSync(SOURCE)) {
  console.error(`\nSource icon not found: ${SOURCE}`);
  console.error("Create frontend/public/icons/icon-source.svg first.\n");
  console.error("The icon should be:");
  console.error("  - Square (equal width and height)");
  console.error("  - Dark background (#0f0e0b) with gold symbol (#c8a96e)");
  console.error("  - At least 512×512 viewBox");
  console.error("  - Simple enough to read at 72×72 pixels\n");
  process.exit(1);
}

async function generate() {
  fs.mkdirSync(OUTPUT, { recursive: true });

  for (const size of SIZES) {
    const outPath = path.join(OUTPUT, `icon-${size}.png`);
    await sharp(SOURCE)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`✓ icon-${size}.png`);
  }

  console.log(`\nAll icons written to ${OUTPUT}`);
  console.log("Place frontend/public/icons/ in your repo and deploy.\n");
}

generate().catch(console.error);