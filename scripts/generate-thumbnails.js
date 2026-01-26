#!/usr/bin/env node
/**
 * Generate thumbnails for archive images
 * Usage: node scripts/generate-thumbnails.js
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

const HIRES_DIR = './public/hires';
const THUMBS_DIR = './public/thumbs';
const THUMB_SIZE = 300; // pixels (max dimension)
const QUALITY = 80; // WebP quality

async function main() {
  // Create thumbs directory if it doesn't exist
  await fs.mkdir(THUMBS_DIR, { recursive: true });

  // Get all files in hires directory
  const files = await fs.readdir(HIRES_DIR);
  const imageFiles = files.filter(f =>
    /\.(jpg|jpeg|png|webp|gif|tiff?)$/i.test(f)
  );

  console.log(`Found ${imageFiles.length} images to process`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of imageFiles) {
    const inputPath = path.join(HIRES_DIR, file);
    const outputName = file.replace(/\.(jpg|jpeg|png|gif|tiff?)$/i, '.webp');
    const outputPath = path.join(THUMBS_DIR, outputName);

    try {
      // Check if thumbnail already exists
      try {
        await fs.access(outputPath);
        skipped++;
        continue;
      } catch {
        // File doesn't exist, proceed with generation
      }

      await sharp(inputPath)
        .resize(THUMB_SIZE, THUMB_SIZE, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: QUALITY })
        .toFile(outputPath);

      processed++;
      if (processed % 10 === 0) {
        console.log(`Processed ${processed}/${imageFiles.length}...`);
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
      errors++;
    }
  }

  console.log(`\nDone!`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  // Calculate size savings
  const hiresStats = await getDirSize(HIRES_DIR);
  const thumbsStats = await getDirSize(THUMBS_DIR);

  console.log(`\nSize comparison:`);
  console.log(`  Hires: ${(hiresStats / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Thumbs: ${(thumbsStats / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Reduction: ${((1 - thumbsStats / hiresStats) * 100).toFixed(1)}%`);
}

async function getDirSize(dir) {
  const files = await fs.readdir(dir);
  let total = 0;
  for (const file of files) {
    try {
      const stat = await fs.stat(path.join(dir, file));
      if (stat.isFile()) total += stat.size;
    } catch {
      // ignore
    }
  }
  return total;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
