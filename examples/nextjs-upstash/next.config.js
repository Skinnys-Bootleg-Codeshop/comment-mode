/** @type {import('next').NextConfig} */
const path = require('path');

// This example lives inside the comment-mode repository, which has its own
// package-lock.json at the repository root; without this, Next.js can't
// tell whether that or this directory's own package-lock.json is the real
// workspace root and prints a warning on every build. This directory is the
// workspace root for this example.
const nextConfig = {
  turbopack: {
    root: path.join(__dirname)
  }
};

module.exports = nextConfig;
