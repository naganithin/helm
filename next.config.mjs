export default {
  devIndicators: false, // no Next.js badge in the corner
  // a second build/dev server (e.g. for checks) can use its own folder without clobbering the running one
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
